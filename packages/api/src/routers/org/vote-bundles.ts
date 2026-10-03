import { TRPCError } from '@trpc/server'
import { and, eq, notExists, sql } from 'drizzle-orm'
import { z } from 'zod'

import { orders, voteBundles } from '@ticketur/db'

import { createTRPCRouter, organizerProcedure } from '../../trpc'
import { newId } from '../../lib/ids'
import {
  callerOwnsBundle,
  ownedContest,
  requireOwnedBundle,
} from '../../lib/contest-access'
import {
  assertContentEditable,
  lockContestForEdit,
  recordContentChange,
  unchangedReview,
} from '../../lib/contest-review'
import { INT4_MAX, MAX_BUNDLES_PER_CONTEST } from '../../lib/contests'

// Packs of votes sold at a price — "20 votes — ₦1,000". Buying one grants a
// BALANCE for the contest; the voter spends it across the entries
// afterwards. The same shape as a form's price options, and reviewed for the
// same reason: what the public is charged is part of what they agree to.
//
// Reviewed: a bundle's label, how many votes it grants, its price, and
// adding one. Not reviewed: its position in the list, and retiring it from
// sale — retiring can only take an offer away, and the price it charged was
// approved when it went up.
//
// The platform service fee is added on top at checkout and shown to the
// voter as its own line (lib/fees.ts); `priceMinor` is what the organizer
// receives against.

const bundleShape = {
  label: z.string().trim().min(1).max(120),
  // The pack size. Capped well under the int4 ceiling so `votes` times
  // anything downstream stays sane.
  votes: z.number().int().min(1).max(100_000),
  // Minor units (kobo), before the service fee.
  priceMinor: z.number().int().min(0).max(INT4_MAX),
}

export const orgVoteBundlesRouter = createTRPCRouter({
  // Appended after the last bundle, active.
  add: organizerProcedure
    .input(z.object({ contestId: z.string(), ...bundleShape }))
    .mutation(async ({ ctx, input }) => {
      const ownership = ownedContest(ctx, input.contestId)
      const id = newId('vbundle')

      const review = await ctx.db.transaction(async (tx) => {
        // Serialises concurrent adds, so the cap and the sortOrder hold.
        const locked = await lockContestForEdit(tx, ownership)
        assertContentEditable(locked)

        const [existing] = await tx
          .select({
            count: sql<number>`COUNT(*)::int`,
            lastSort: sql<number | null>`MAX(${voteBundles.sortOrder})`,
          })
          .from(voteBundles)
          .where(eq(voteBundles.contestId, locked.id))
        if ((existing?.count ?? 0) >= MAX_BUNDLES_PER_CONTEST) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `A contest can have at most ${MAX_BUNDLES_PER_CONTEST} bundles.`,
          })
        }

        await tx.insert(voteBundles).values({
          id,
          contestId: locked.id,
          label: input.label,
          votes: input.votes,
          priceMinor: input.priceMinor,
          sortOrder: (existing?.lastSort ?? -1) + 1,
          active: true,
        })
        return recordContentChange(tx, locked)
      })

      return { id, ...review }
    }),

  // A new price applies to purchases from now on. PAID PATH: an order
  // already in flight keeps the amount written on it — `buyVotes` copies the
  // price onto the order and fulfilment reads it there, so editing a bundle
  // mid-payment cannot change what somebody bought.
  update: organizerProcedure
    .input(z.object({ id: z.string(), ...bundleShape }))
    .mutation(async ({ ctx, input }) => {
      const { bundle } = await requireOwnedBundle(ctx, input.id)
      const ownership = ownedContest(ctx, bundle.contestId)

      const review = await ctx.db.transaction(async (tx) => {
        const locked = await lockContestForEdit(tx, ownership)

        const [current] = await tx
          .select({
            label: voteBundles.label,
            votes: voteBundles.votes,
            priceMinor: voteBundles.priceMinor,
          })
          .from(voteBundles)
          .where(
            and(
              eq(voteBundles.id, input.id),
              eq(voteBundles.contestId, locked.id)
            )
          )
          .limit(1)
        if (!current) throw new TRPCError({ code: 'NOT_FOUND' })

        const termsChanged =
          input.label !== current.label ||
          input.votes !== current.votes ||
          input.priceMinor !== current.priceMinor
        if (termsChanged) assertContentEditable(locked)

        await tx
          .update(voteBundles)
          .set({
            label: input.label,
            votes: input.votes,
            priceMinor: input.priceMinor,
          })
          .where(and(eq(voteBundles.id, input.id), callerOwnsBundle(ctx)))

        return termsChanged
          ? recordContentChange(tx, locked)
          : unchangedReview(locked)
      })

      return { id: input.id, ...review }
    }),

  // On sale, or retired. Operational: retiring takes an offer away, and
  // putting one back puts back a price an admin already approved. A live
  // contest keeps selling the rest.
  setActive: organizerProcedure
    .input(z.object({ id: z.string(), active: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const updated = await ctx.db
        .update(voteBundles)
        .set({ active: input.active })
        .where(and(eq(voteBundles.id, input.id), callerOwnsBundle(ctx)))
        .returning({ id: voteBundles.id })
      if (updated.length === 0) throw new TRPCError({ code: 'NOT_FOUND' })
      return { id: input.id, active: input.active }
    }),

  // Ordering only; never interrupts a live contest.
  setOrder: organizerProcedure
    .input(
      z.object({ id: z.string(), sortOrder: z.number().int().min(0).max(9999) })
    )
    .mutation(async ({ ctx, input }) => {
      const updated = await ctx.db
        .update(voteBundles)
        .set({ sortOrder: input.sortOrder })
        .where(and(eq(voteBundles.id, input.id), callerOwnsBundle(ctx)))
        .returning({ id: voteBundles.id })
      if (updated.length === 0) throw new TRPCError({ code: 'NOT_FOUND' })
      return { id: input.id }
    }),

  // Only while no money has come in for this contest. A vote purchase names
  // the CONTEST on `orders.referenceId` and copies the price onto the order,
  // so no row points at a bundle and deleting one breaks nothing technically
  // — but once a contest has been paid into, what was on sale is part of its
  // history, and `active` exists to take a bundle off sale without erasing
  // it. The guard is in the DELETE's own WHERE, so a payment landing
  // mid-delete is seen by the statement.
  delete: organizerProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { bundle } = await requireOwnedBundle(ctx, input.id)

      const deleted = await ctx.db
        .delete(voteBundles)
        .where(
          and(
            eq(voteBundles.id, input.id),
            callerOwnsBundle(ctx),
            notExists(
              ctx.db
                .select({ ok: sql`1` })
                .from(orders)
                .where(
                  and(
                    eq(orders.type, 'vote_purchase'),
                    eq(orders.referenceId, voteBundles.contestId),
                    eq(orders.status, 'paid')
                  )
                )
            )
          )
        )
        .returning({ id: voteBundles.id })

      if (deleted.length === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Votes have already been bought in this contest, so “${bundle.label}” stays on the record. Retire it instead — it comes off sale at once and nobody can buy it again.`,
        })
      }
      return { id: input.id }
    }),
})

export type OrgVoteBundlesRouter = typeof orgVoteBundlesRouter
