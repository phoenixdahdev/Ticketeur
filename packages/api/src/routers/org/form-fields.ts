import { TRPCError } from '@trpc/server'
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'

import { formFields, submissions } from '@ticketur/db'

import { createTRPCRouter, organizerProcedure } from '../../trpc'
import { newId } from '../../lib/ids'
import { requireOwnedField, requireOwnedForm } from '../../lib/form-access'
import {
  checkFieldDefinition,
  fieldDefinitionShape,
  MAX_FIELDS_PER_FORM,
  toFieldColumns,
} from '../../lib/form-fields'
import { lockForm, type DbTransaction } from '../../lib/forms'
import {
  lockFormForEdit,
  recordContentChange,
  sameFieldContent,
  unchangedReview,
} from '../../lib/form-review'

const addInput = z
  .object({ formId: z.string(), ...fieldDefinitionShape })
  .superRefine(checkFieldDefinition)

const updateInput = z
  .object({ id: z.string(), ...fieldDefinitionShape })
  .superRefine(checkFieldDefinition)

// The form's complete field list in its new order.
const reorderInput = z.object({
  formId: z.string(),
  fieldIds: z.array(z.string()).min(1).max(MAX_FIELDS_PER_FORM),
})

// How many submissions hold an answer to this field (jsonb key-exists).
async function answeredCount(
  tx: DbTransaction,
  formId: string,
  fieldId: string
): Promise<number> {
  const [row] = await tx
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(submissions)
    .where(
      and(
        eq(submissions.formId, formId),
        sql`${submissions.answersJson} ? ${fieldId}`
      )
    )
  return row?.count ?? 0
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

// Every mutation here runs under the form row lock (lockFormForEdit, or
// lockForm for reorder), the lock intake's spot claim also takes, so a
// submission is never validated against a field list that is halfway through
// changing, and concurrent edits apply one after another.
//
// Fields are the questions an admin approved, so adding, changing or deleting
// one sends a published form back to review in the same transaction (see
// lib/form-review.ts); each mutation reports that in `sentToReview`.
// Reordering asks nothing new and leaves the review alone.
export const orgFormFieldsRouter = createTRPCRouter({
  // Appended after the last field; reorder moves it.
  add: organizerProcedure.input(addInput).mutation(async ({ ctx, input }) => {
    const { form } = await requireOwnedForm(ctx, input.formId)
    const id = newId('ffld')

    const review = await ctx.db.transaction(async (tx) => {
      const locked = await lockFormForEdit(tx, form.id)
      const [existing] = await tx
        .select({
          count: sql<number>`COUNT(*)::int`,
          lastPosition: sql<number | null>`MAX(${formFields.position})`,
        })
        .from(formFields)
        .where(eq(formFields.formId, form.id))
      if ((existing?.count ?? 0) >= MAX_FIELDS_PER_FORM) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `A form can have at most ${MAX_FIELDS_PER_FORM} fields.`,
        })
      }
      await tx.insert(formFields).values({
        id,
        formId: form.id,
        position: (existing?.lastPosition ?? -1) + 1,
        ...toFieldColumns(input),
      })
      return recordContentChange(tx, locked)
    })

    return { id, ...review }
  }),

  // Takes the whole definition. Allowed on a live form, though it then goes
  // back to review: label, help text, required-ness and choices can change at
  // any time (answers already given keep their stored value). Only the type
  // is frozen once answered. Sending the definition the field already has
  // changes nothing, so it doesn't take a live form offline.
  update: organizerProcedure
    .input(updateInput)
    .mutation(async ({ ctx, input }) => {
      const { field } = await requireOwnedField(ctx, input.id)
      const columns = toFieldColumns(input)

      const review = await ctx.db.transaction(async (tx) => {
        const locked = await lockFormForEdit(tx, field.formId)
        const [current] = await tx
          .select()
          .from(formFields)
          .where(eq(formFields.id, field.id))
          .limit(1)
        if (!current) throw new TRPCError({ code: 'NOT_FOUND' })
        if (sameFieldContent(current, columns)) return unchangedReview(locked)

        // A new type would leave the answers already given in the old type's
        // shape: text where a number is now expected, one URL where a list
        // is. Once anyone has answered, a new field is the honest change.
        if (columns.type !== current.type) {
          const answered = await answeredCount(tx, field.formId, field.id)
          if (answered > 0) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: `${plural(answered, 'submission')} already answered "${field.label}", so its type can't change. Add a new field instead.`,
            })
          }
        }

        await tx
          .update(formFields)
          .set(columns)
          .where(eq(formFields.id, field.id))
        return recordContentChange(tx, locked)
      })

      return { id: field.id, ...review }
    }),

  // Answers are applicants' records: deleting a field someone has answered
  // would drop those answers from every review screen and export. A field
  // nobody has answered yet can go.
  delete: organizerProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { field } = await requireOwnedField(ctx, input.id)

      const review = await ctx.db.transaction(async (tx) => {
        const locked = await lockFormForEdit(tx, field.formId)
        const answered = await answeredCount(tx, field.formId, field.id)
        if (answered > 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `${plural(answered, 'submission')} already answered "${field.label}", so it can't be deleted. Make it optional instead.`,
          })
        }
        await tx.delete(formFields).where(eq(formFields.id, field.id))
        return recordContentChange(tx, locked)
      })

      return { id: field.id, ...review }
    }),

  // One call, one UPDATE: positions become each field's index in `fieldIds`.
  // The list must name every field of the form exactly once; anything else
  // means the builder is looking at a stale list, and guessing where the
  // missing fields belong would reorder behind the organizer's back.
  // Not a change to reviewed content: the same questions in another order
  // can't ask anything new, so a live form stays live.
  reorder: organizerProcedure
    .input(reorderInput)
    .mutation(async ({ ctx, input }) => {
      const { form } = await requireOwnedForm(ctx, input.formId)

      await ctx.db.transaction(async (tx) => {
        await lockForm(tx, form.id)
        const current = await tx
          .select({ id: formFields.id })
          .from(formFields)
          .where(eq(formFields.formId, form.id))

        const currentIds = new Set(current.map((f) => f.id))
        const requested = new Set(input.fieldIds)
        const isPermutation =
          requested.size === input.fieldIds.length &&
          requested.size === currentIds.size &&
          input.fieldIds.every((id) => currentIds.has(id))
        if (!isPermutation) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              'The field list has changed since it was loaded. Refresh and try again.',
          })
        }

        const position = sql`CASE ${formFields.id} ${sql.join(
          input.fieldIds.map(
            (id, index) => sql`WHEN ${id} THEN ${index}::integer`
          ),
          sql` `
        )} END`
        await tx
          .update(formFields)
          .set({ position })
          .where(eq(formFields.formId, form.id))
      })

      return { formId: form.id, fieldIds: input.fieldIds }
    }),
})

export type OrgFormFieldsRouter = typeof orgFormFieldsRouter
