import { and, asc, desc, eq, inArray, type SQL } from 'drizzle-orm'
import { z } from 'zod'

import type { Database } from '@ticketur/db'
import {
  contestCategories,
  contests,
  entries,
  events,
  user,
  voteBundles,
} from '@ticketur/db'

import { createTRPCRouter, publicProcedure } from '../../trpc'
import { hasEnded, notCurrentlyBanned } from '../../lib/predicates'
import { getFeeRates } from '../../lib/platform-settings'
import { votingAvailability } from '../../lib/votes'

// The public face of a contest: the page people vote on, and its leaderboard.

/**
 * A contest the public may see, with the event behind it.
 *
 * An ALLOW-LIST on purpose, the same reasoning as `loadPublicForm`:
 *
 *   'published' — approved; the voting window decides whether it takes votes.
 *   'closed'    — voting is over. The page and the results stay public, which
 *                 is the point of running an award.
 *
 * Everything else is invisible. 'draft' and 'pending_review' have not been
 * approved; 'rejected' was turned down (often for exactly the content nobody
 * should see); 'suspended' IS the admin takedown state, so it must be the one
 * status that cannot resolve. A deny-list (`status <> 'draft'`) would publish
 * every status added after it by default — this one hides a new status until
 * somebody adds it here on purpose.
 *
 * A contest can be no more visible than its event, so the event's own public
 * rules apply too: approved and live, or archived and genuinely past (the
 * public event page's rule — archived but still upcoming means the organizer
 * pulled it), and run by an organizer who is not banned.
 *
 * Exported so `vote-checkout` resolves a contest through exactly this gate.
 * A second loader would be a second definition of "public", and the two would
 * drift the first time a status was added.
 */
export async function loadPublicContest(db: Database, match: SQL) {
  const [row] = await db
    .select({
      contest: contests,
      event: {
        id: events.id,
        slug: events.slug,
        title: events.title,
        status: events.status,
        eventDate: events.eventDate,
        endDate: events.endDate,
        eventTime: events.eventTime,
        location: events.location,
        bannerUrl: events.bannerUrl,
      },
    })
    .from(contests)
    .innerJoin(events, eq(events.id, contests.eventId))
    .innerJoin(user, eq(user.id, events.organizerId))
    .where(
      and(
        match,
        inArray(contests.status, ['published', 'closed']),
        inArray(events.status, ['upcoming', 'archived']),
        notCurrentlyBanned
      )
    )
    .limit(1)
  if (!row) return null
  if (row.event.status === 'archived' && !hasEnded(row.event)) return null
  return row
}

// What the public is told about a contest. Explicit, so a column added to
// `contests` later (a reviewer's note, a rejection reason) cannot leak by
// being swept up in a `select()`.
function publicContestFields(contest: typeof contests.$inferSelect) {
  return {
    id: contest.id,
    slug: contest.slug,
    title: contest.title,
    description: contest.description,
    status: contest.status,
    votingOpensAt: contest.votingOpensAt,
    votingClosesAt: contest.votingClosesAt,
    nominationsOpenAt: contest.nominationsOpenAt,
    nominationsCloseAt: contest.nominationsCloseAt,
    freeVotingEnabled: contest.freeVotingEnabled,
    paidVotingEnabled: contest.paidVotingEnabled,
    // Minor units (kobo) for a single loose vote. 0 means bundles only.
    pricePerVoteMinor: contest.pricePerVoteMinor,
  }
}

// An entry as the public sees it. `status` is carried, not filtered on: a
// withdrawn or disqualified entry stays on the page with the votes it already
// has — erasing it would rewrite the record for everyone who voted — but it
// is flagged, and `acceptsVotes` is the one field the UI should gate on.
// castVotes enforces the same rule in SQL, so a stale page cannot vote for one.
function publicEntryFields(entry: typeof entries.$inferSelect) {
  return {
    id: entry.id,
    categoryId: entry.categoryId,
    displayName: entry.displayName,
    photoUrl: entry.photoUrl,
    bio: entry.bio,
    status: entry.status,
    acceptsVotes: entry.status === 'active',
    voteCount: entry.voteCount,
    sortOrder: entry.sortOrder,
  }
}

export const publicContestsRouter = createTRPCRouter({
  // null — no such contest, not approved, taken down, or its event isn't
  // public. Otherwise the whole ballot: categories, entries, and the bundles
  // on sale with the fee rate that applies to them.
  bySlug: publicProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ ctx, input }) => {
      const found = await loadPublicContest(
        ctx.db,
        eq(contests.slug, input.slug)
      )
      if (!found) return null
      const { contest, event } = found

      const categories = await ctx.db
        .select({
          id: contestCategories.id,
          title: contestCategories.title,
          description: contestCategories.description,
          sortOrder: contestCategories.sortOrder,
        })
        .from(contestCategories)
        .where(eq(contestCategories.contestId, contest.id))
        .orderBy(asc(contestCategories.sortOrder), asc(contestCategories.id))

      const entryRows = await ctx.db
        .select()
        .from(entries)
        .where(eq(entries.contestId, contest.id))
        .orderBy(asc(entries.sortOrder), asc(entries.id))

      // Retired bundles stay in the table for the orders that reference them;
      // only active ones are on sale.
      const bundles = await ctx.db
        .select({
          id: voteBundles.id,
          label: voteBundles.label,
          votes: voteBundles.votes,
          priceMinor: voteBundles.priceMinor,
          sortOrder: voteBundles.sortOrder,
        })
        .from(voteBundles)
        .where(
          and(
            eq(voteBundles.contestId, contest.id),
            eq(voteBundles.active, true)
          )
        )
        .orderBy(asc(voteBundles.sortOrder), asc(voteBundles.priceMinor))

      // The vote service-fee rate travels with the bundle prices it applies
      // to. The page cannot render a price without this query, so the rate is
      // there on the first paint — no second round trip, and no moment at
      // which a bundle price is on screen without the fee the voter will
      // actually be charged on top of it. DISPLAY only: buyVotes re-reads the
      // rate server-side and THAT figure is what is stored and charged.
      const feeRates = await getFeeRates(ctx.db)

      return {
        contest: publicContestFields(contest),
        event,
        // Whether votes can be cast right now, and why not when they can't.
        voting: votingAvailability(contest),
        // Basis points (500 = 5%). Apply it with calculateFeeMinor from
        // @ticketur/api/lib/fees, the same function the server charges with.
        serviceFeeBps: feeRates.vote,
        categories,
        entries: entryRows.map(publicEntryFields),
        bundles,
      }
    }),

  // The standings, highest first. Scoped to one category when given, and
  // ordered on `entries_leaderboard_idx`.
  leaderboard: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        categoryId: z.string().nullable().default(null),
        limit: z.number().int().min(1).max(200).default(100),
      })
    )
    .query(async ({ ctx, input }) => {
      // Through the same gate as bySlug: a leaderboard is contest content, so
      // it must not be the hole a draft or suspended contest leaks through.
      const found = await loadPublicContest(
        ctx.db,
        eq(contests.slug, input.slug)
      )
      if (!found) return null
      const { contest } = found

      const rows = await ctx.db
        .select()
        .from(entries)
        .where(
          and(
            eq(entries.contestId, contest.id),
            input.categoryId
              ? eq(entries.categoryId, input.categoryId)
              : undefined
          )
        )
        // sortOrder then id after voteCount, so a page of tied entries comes
        // back in the same order every time rather than at the planner's whim.
        .orderBy(
          desc(entries.voteCount),
          asc(entries.sortOrder),
          asc(entries.id)
        )
        .limit(input.limit)

      // Ties share a rank (1, 2, 2, 4), which is what a leaderboard means.
      let rank = 0
      let previousVotes: number | null = null
      const standings = rows.map((entry, index) => {
        if (previousVotes === null || entry.voteCount !== previousVotes) {
          rank = index + 1
          previousVotes = entry.voteCount
        }
        return { rank, ...publicEntryFields(entry) }
      })

      return {
        contest: publicContestFields(contest),
        voting: votingAvailability(contest),
        categoryId: input.categoryId,
        standings,
      }
    }),
})

export type PublicContestsRouter = typeof publicContestsRouter
