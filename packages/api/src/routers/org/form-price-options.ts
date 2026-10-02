import { TRPCError } from '@trpc/server'
import { and, eq, lte, notExists, sql } from 'drizzle-orm'
import { z } from 'zod'

import { formPriceOptions, submissions } from '@ticketur/db'

import { createTRPCRouter, organizerProcedure } from '../../trpc'
import { newId } from '../../lib/ids'
import {
  requireOwnedForm,
  requireOwnedPriceOption,
} from '../../lib/form-access'
import { MAX_PRICE_OPTIONS_PER_FORM } from '../../lib/forms'
import {
  lockFormForEdit,
  recordContentChange,
  unchangedReview,
} from '../../lib/form-review'

// price_minor is an int4 column.
const INT4_MAX = 2_147_483_647

const optionShape = {
  name: z.string().trim().min(1).max(120),
  // Minor units (kobo). 0 = a free choice on an otherwise paid form.
  priceMinor: z.number().int().min(0).max(INT4_MAX),
  // NULL = no per-option limit (the form's capacity still applies).
  quantityLimit: z
    .number()
    .int()
    .min(1)
    .max(1_000_000)
    .nullable()
    .default(null),
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

// A form with no options is free; adding the first one makes choosing an
// option (and paying for it, when it has a price) part of submitting.
//
// What an applicant pays is part of what they agree to, so an admin reviews
// the options: adding or deleting one, or changing its name or price, sends a
// published form back to review in the same transaction (lib/form-review.ts),
// reported in `sentToReview`. A quantity limit is capacity, and capacity is
// operational, so changing only that doesn't. Every mutation takes the form
// row lock first, before any option row, the order intake's spot claim locks
// them in.
export const orgFormPriceOptionsRouter = createTRPCRouter({
  // Appended after the last option.
  add: organizerProcedure
    .input(z.object({ formId: z.string(), ...optionShape }))
    .mutation(async ({ ctx, input }) => {
      const { form } = await requireOwnedForm(ctx, input.formId)
      const id = newId('fopt')

      const review = await ctx.db.transaction(async (tx) => {
        // Serialises concurrent adds, so the count cap and sortOrder hold.
        const locked = await lockFormForEdit(tx, form.id)
        const [existing] = await tx
          .select({
            count: sql<number>`COUNT(*)::int`,
            lastSort: sql<number | null>`MAX(${formPriceOptions.sortOrder})`,
          })
          .from(formPriceOptions)
          .where(eq(formPriceOptions.formId, form.id))
        if ((existing?.count ?? 0) >= MAX_PRICE_OPTIONS_PER_FORM) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `A form can have at most ${MAX_PRICE_OPTIONS_PER_FORM} options.`,
          })
        }
        await tx.insert(formPriceOptions).values({
          id,
          formId: form.id,
          name: input.name,
          priceMinor: input.priceMinor,
          quantityLimit: input.quantityLimit,
          sortOrder: (existing?.lastSort ?? -1) + 1,
        })
        return recordContentChange(tx, locked)
      })

      return { id, ...review }
    }),

  // A new price applies to submissions from now on.
  // PAID PATH: a submission already pending payment keeps the amount on its
  // order; the order, not this row, is what the applicant was charged.
  update: organizerProcedure
    .input(z.object({ id: z.string(), ...optionShape }))
    .mutation(async ({ ctx, input }) => {
      const { option } = await requireOwnedPriceOption(ctx, input.id)

      // The limit can't drop below the submissions already holding this
      // option; the guard sits in the UPDATE so a claim landing mid-edit
      // can't slip under it.
      const limitGuard =
        input.quantityLimit === null
          ? undefined
          : lte(formPriceOptions.claimed, input.quantityLimit)

      const review = await ctx.db.transaction(async (tx) => {
        const locked = await lockFormForEdit(tx, option.formId)
        const [current] = await tx
          .select({
            name: formPriceOptions.name,
            priceMinor: formPriceOptions.priceMinor,
          })
          .from(formPriceOptions)
          .where(eq(formPriceOptions.id, option.id))
          .limit(1)
        if (!current) throw new TRPCError({ code: 'NOT_FOUND' })

        const updated = await tx
          .update(formPriceOptions)
          .set({
            name: input.name,
            priceMinor: input.priceMinor,
            quantityLimit: input.quantityLimit,
          })
          .where(and(eq(formPriceOptions.id, option.id), limitGuard))
          .returning({ id: formPriceOptions.id })

        if (updated.length === 0) {
          const [held] = await tx
            .select({ claimed: formPriceOptions.claimed })
            .from(formPriceOptions)
            .where(eq(formPriceOptions.id, option.id))
            .limit(1)
          if (!held) throw new TRPCError({ code: 'NOT_FOUND' })
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `${plural(held.claimed, 'submission')} already hold "${option.name}"; its limit can't be lower than that.`,
          })
        }

        const termsChanged =
          input.name !== current.name || input.priceMinor !== current.priceMinor
        return termsChanged
          ? recordContentChange(tx, locked)
          : unchangedReview(locked)
      })

      return { id: option.id, ...review }
    }),

  // An option any submission chose is part of that applicant's record (and
  // possibly their payment), so it stays; rejected ones count too. `claimed
  // = 0` also catches a submission still in flight: its claim locks this row
  // and the DELETE re-checks the counter after it commits. The NO ACTION
  // foreign key from submissions is the last line of defence.
  delete: organizerProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { option } = await requireOwnedPriceOption(ctx, input.id)

      const review = await ctx.db.transaction(async (tx) => {
        const locked = await lockFormForEdit(tx, option.formId)
        const deleted = await tx
          .delete(formPriceOptions)
          .where(
            and(
              eq(formPriceOptions.id, option.id),
              eq(formPriceOptions.claimed, 0),
              notExists(
                tx
                  .select({ id: submissions.id })
                  .from(submissions)
                  .where(eq(submissions.priceOptionId, option.id))
              )
            )
          )
          .returning({ id: formPriceOptions.id })

        if (deleted.length === 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Submissions have chosen "${option.name}", so it can't be deleted.`,
          })
        }
        return recordContentChange(tx, locked)
      })

      return { id: option.id, ...review }
    }),
})

export type OrgFormPriceOptionsRouter = typeof orgFormPriceOptionsRouter
