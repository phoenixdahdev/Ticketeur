import { TRPCError } from '@trpc/server'
import { and, eq, gt, notExists, sql } from 'drizzle-orm'
import { z } from 'zod'

import { contestCategories, entries, votes } from '@ticketur/db'

import { createTRPCRouter, organizerProcedure } from '../../trpc'
import { newId } from '../../lib/ids'
import {
  callerOwnsCategory,
  ownedContest,
  requireOwnedCategory,
} from '../../lib/contest-access'
import {
  assertContentEditable,
  lockContestForEdit,
  recordContentChange,
  unchangedReview,
} from '../../lib/contest-review'
import { MAX_CATEGORIES_PER_CONTEST } from '../../lib/contests'

// The things people vote in — "Face of Haiku", "Eco Creative Award". A
// contest needs at least one before it can be submitted, and the free-vote
// allowance is per category, so this is also the unit a free voter gets one
// vote in each day.
//
// A category's title and description are public wording, so an admin reviews
// them: adding one, or changing either, sends a published contest back to
// review in the same transaction. Its position in the list does not.
//
// Every mutation takes the CONTEST row's lock first, before any category row
// — the same order every other content edit uses, so they serialise rather
// than deadlock.

const categoryShape = {
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).default(''),
}

export const orgContestCategoriesRouter = createTRPCRouter({
  // Appended after the last category.
  add: organizerProcedure
    .input(z.object({ contestId: z.string(), ...categoryShape }))
    .mutation(async ({ ctx, input }) => {
      const ownership = ownedContest(ctx, input.contestId)
      const id = newId('ccat')

      const review = await ctx.db.transaction(async (tx) => {
        // Serialises concurrent adds, so the cap and the sortOrder hold —
        // and re-proves ownership under the lock.
        const locked = await lockContestForEdit(tx, ownership)
        assertContentEditable(locked)

        const [existing] = await tx
          .select({
            count: sql<number>`COUNT(*)::int`,
            lastSort: sql<number | null>`MAX(${contestCategories.sortOrder})`,
          })
          .from(contestCategories)
          .where(eq(contestCategories.contestId, locked.id))
        if ((existing?.count ?? 0) >= MAX_CATEGORIES_PER_CONTEST) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `A contest can have at most ${MAX_CATEGORIES_PER_CONTEST} categories.`,
          })
        }

        await tx.insert(contestCategories).values({
          id,
          contestId: locked.id,
          title: input.title,
          description: input.description,
          sortOrder: (existing?.lastSort ?? -1) + 1,
        })
        return recordContentChange(tx, locked)
      })

      return { id, ...review }
    }),

  // Reviewed content: this is what the public reads above the entries.
  update: organizerProcedure
    .input(z.object({ id: z.string(), ...categoryShape }))
    .mutation(async ({ ctx, input }) => {
      const { category } = await requireOwnedCategory(ctx, input.id)
      const ownership = ownedContest(ctx, category.contestId)

      const review = await ctx.db.transaction(async (tx) => {
        const locked = await lockContestForEdit(tx, ownership)

        const [current] = await tx
          .select({
            title: contestCategories.title,
            description: contestCategories.description,
          })
          .from(contestCategories)
          .where(
            and(
              eq(contestCategories.id, input.id),
              eq(contestCategories.contestId, locked.id)
            )
          )
          .limit(1)
        if (!current) throw new TRPCError({ code: 'NOT_FOUND' })

        const wordingChanged =
          input.title !== current.title ||
          input.description !== current.description
        // An edit that leaves every reviewed value as it was is no change at
        // all, so it is allowed even on a closed contest.
        if (wordingChanged) assertContentEditable(locked)

        await tx
          .update(contestCategories)
          .set({ title: input.title, description: input.description })
          .where(
            and(eq(contestCategories.id, input.id), callerOwnsCategory(ctx))
          )

        return wordingChanged
          ? recordContentChange(tx, locked)
          : unchangedReview(locked)
      })

      return { id: input.id, ...review }
    }),

  // Ordering only. Operational — it cannot put a word in front of anyone
  // that an admin has not seen — so it never interrupts a live contest.
  setOrder: organizerProcedure
    .input(
      z.object({ id: z.string(), sortOrder: z.number().int().min(0).max(9999) })
    )
    .mutation(async ({ ctx, input }) => {
      const updated = await ctx.db
        .update(contestCategories)
        .set({ sortOrder: input.sortOrder })
        .where(and(eq(contestCategories.id, input.id), callerOwnsCategory(ctx)))
        .returning({ id: contestCategories.id })
      if (updated.length === 0) throw new TRPCError({ code: 'NOT_FOUND' })
      return { id: input.id }
    }),

  // A category anybody has voted in STAYS. Deleting it would cascade through
  // its entries to the votes themselves, erasing what people chose and, for
  // paid votes, what they paid for. Both guards are in the DELETE's own
  // WHERE, so a vote landing mid-delete is seen by the statement:
  //
  //   - no ledger row in this category, and
  //   - no entry in it carrying a count. `castVotes` bumps `voteCount` in the
  //     same statement that admits the vote, holding that entry's row lock,
  //     so a cast in flight either commits first (and this matches nothing)
  //     or waits and finds the category gone.
  //
  // Deleting is NOT reviewed content: it can only take something away, and
  // taking a live contest offline for it would strand credits people have
  // already bought (../../lib/contest-review.ts explains the departure from
  // forms).
  delete: organizerProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { category } = await requireOwnedCategory(ctx, input.id)

      const deleted = await ctx.db
        .delete(contestCategories)
        .where(
          and(
            eq(contestCategories.id, input.id),
            callerOwnsCategory(ctx),
            notExists(
              ctx.db
                .select({ ok: sql`1` })
                .from(votes)
                .where(eq(votes.categoryId, contestCategories.id))
            ),
            notExists(
              ctx.db
                .select({ ok: sql`1` })
                .from(entries)
                .where(
                  and(
                    eq(entries.categoryId, contestCategories.id),
                    gt(entries.voteCount, 0)
                  )
                )
            )
          )
        )
        .returning({ id: contestCategories.id })

      if (deleted.length === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `People have already voted in “${category.title}”, so it cannot be deleted — their votes are the record of what they chose. Withdraw or disqualify the entries you want off the ballot instead.`,
        })
      }
      return { id: input.id }
    }),
})

export type OrgContestCategoriesRouter = typeof orgContestCategoriesRouter
