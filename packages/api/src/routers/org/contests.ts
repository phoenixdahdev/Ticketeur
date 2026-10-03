import { TRPCError } from '@trpc/server'
import { and, asc, desc, eq, gt, notExists, sql } from 'drizzle-orm'
import { z } from 'zod'

import type { Database } from '@ticketur/db'
import {
  contestCategories,
  contests,
  entries,
  events,
  voteBundles,
  voteCredits,
  votes,
} from '@ticketur/db'

import { createTRPCRouter, organizerProcedure } from '../../trpc'
import { newId } from '../../lib/ids'
import {
  findOwnedContest,
  managedEvents,
  ownedContest,
  requireOwnedContest,
  requireOwnedEvent,
} from '../../lib/contest-access'
import {
  assertContentEditable,
  assertSubmittable,
  createStatus,
  lockContestForEdit,
  notAwaitingReview,
  recordContentChange,
  SUBMITTABLE,
  transitionFrom,
  unchangedReview,
  type OrganizerWritableStatus,
} from '../../lib/contest-review'
import {
  assertEventAcceptsContests,
  generateUniqueContestSlug,
  INT4_MAX,
} from '../../lib/contests'
import { getFeeRates } from '../../lib/platform-settings'
import {
  DEFAULT_VOTE_TIME_ZONE,
  isValidTimeZone,
  votingAvailability,
} from '../../lib/votes'

import { orgContestCategoriesRouter } from './contest-categories'
import { orgContestEntriesRouter } from './contest-entries'
import { orgContestNominationsRouter } from './contest-nominations'
import { orgVoteBundlesRouter } from './vote-bundles'

// The organizer's side of contests and voting: building one, getting it
// reviewed, filling its ballot, and pricing its votes.
//
// ── Every statement that writes `contests.status`, exhaustively ──
//   create    → 'draft'          (contest-review.createStatus)
//   submit    → 'pending_review'
//   withdraw  → 'draft'
//   close     → 'closed'
//   recordContentChange → 'pending_review', and only from 'published'
// That is the whole list, and every literal in it is typed
// `OrganizerWritableStatus`, so writing 'published' or 'suspended' from here
// is a compile error as well as a policy. Approval is the admin's.
//
// ── Ownership ──
// Every statement carries the owner in its own WHERE, through
// ../../lib/contest-access. Nothing here decides access by looking at a row
// it has already read.

// ─── Input ──────────────────────────────────────────────────────────────────

// Settings shared by create and update. Update replaces them wholesale, as
// events.update and forms.update do, so the settings screen sends the full
// set every time.
const settingsShape = {
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).default(''),
  // The IANA zone the contest is run in. Checked against the runtime below,
  // not just for shape: a typo here would silently move the boundary the
  // daily free vote resets on.
  timeZone: z.string().trim().min(1).max(100).default(DEFAULT_VOTE_TIME_ZONE),
  // NULL opensAt = open the moment it is published; NULL closesAt = open
  // until the organizer closes it. `votingAvailability` reads both.
  votingOpensAt: z.date().nullable().default(null),
  votingClosesAt: z.date().nullable().default(null),
  // NULL on both = no nomination phase; entries are added directly.
  nominationsOpenAt: z.date().nullable().default(null),
  nominationsCloseAt: z.date().nullable().default(null),
  freeVotingEnabled: z.boolean().default(true),
  paidVotingEnabled: z.boolean().default(true),
  // Minor units (kobo) for one loose vote. 0 with paid voting on means
  // bundles only.
  pricePerVoteMinor: z.number().int().min(0).max(INT4_MAX).default(0),
}

type SettingsValues = {
  timeZone: string
  votingOpensAt: Date | null
  votingClosesAt: Date | null
  nominationsOpenAt: Date | null
  nominationsCloseAt: Date | null
}

function refineSettings(v: SettingsValues, ctx: z.RefinementCtx) {
  // Refused at WRITE time, in one place both create and update go through.
  // `voteDay` falls back to a usable zone rather than throwing, which is
  // right for a vote in flight and wrong as a way to store rubbish: a
  // contest that says "Afrika/Lagos" would roll its day over in UTC and
  // nobody would ever see why.
  if (!isValidTimeZone(v.timeZone)) {
    ctx.addIssue({
      code: 'custom',
      path: ['timeZone'],
      message: 'That is not a time zone this server knows.',
    })
  }
  if (
    v.votingOpensAt &&
    v.votingClosesAt &&
    v.votingClosesAt <= v.votingOpensAt
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['votingClosesAt'],
      message: 'Voting must close after it opens',
    })
  }
  if (
    v.nominationsOpenAt &&
    v.nominationsCloseAt &&
    v.nominationsCloseAt <= v.nominationsOpenAt
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['nominationsCloseAt'],
      message: 'Nominations must close after they open',
    })
  }
}

const createInput = z
  .object({ eventId: z.string(), ...settingsShape })
  .superRefine(refineSettings)

const updateInput = z
  .object({ id: z.string(), ...settingsShape })
  .superRefine(refineSettings)

// ─── Counts ─────────────────────────────────────────────────────────────────

// Correlated scalar subqueries rather than LEFT JOINs: three joins onto one
// contest would multiply the rows and every count would come back wrong.
const countColumns = {
  categoryCount: sql<number>`(SELECT COUNT(*) FROM ${contestCategories} WHERE ${contestCategories.contestId} = ${contests.id})::int`,
  entryCount: sql<number>`(SELECT COUNT(*) FROM ${entries} WHERE ${entries.contestId} = ${contests.id})::int`,
  // Allocations, not ledger rows: one paid cast can carry several votes.
  voteCount: sql<number>`(SELECT COALESCE(SUM(${entries.voteCount}), 0) FROM ${entries} WHERE ${entries.contestId} = ${contests.id})::int`,
}

// ─── Submit preconditions ───────────────────────────────────────────────────

async function assertReadyToSubmit(
  db: Database,
  contest: {
    id: string
    freeVotingEnabled: boolean
    paidVotingEnabled: boolean
    pricePerVoteMinor: number
    votingClosesAt: Date | null
  },
  action: string
): Promise<void> {
  if (contest.votingClosesAt && contest.votingClosesAt <= new Date()) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Voting is set to close in the past. Move that time later or clear it before ${action}.`,
    })
  }
  if (!contest.freeVotingEnabled && !contest.paidVotingEnabled) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Turn on free voting, paid voting or both before ${action} — nobody can vote otherwise.`,
    })
  }

  const [categories] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(contestCategories)
    .where(eq(contestCategories.contestId, contest.id))
  if ((categories?.count ?? 0) === 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Add at least one category before ${action}. A category is the thing people vote in.`,
    })
  }

  // Paid voting with no per-vote price and no bundle on sale is a checkout
  // that refuses every attempt (`buyVotes` turns both away). Catch it here
  // rather than let an approved contest sell nothing.
  if (contest.paidVotingEnabled && contest.pricePerVoteMinor === 0) {
    const [bundles] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(voteBundles)
      .where(
        and(eq(voteBundles.contestId, contest.id), eq(voteBundles.active, true))
      )
    if ((bundles?.count ?? 0) === 0) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Paid voting is on but there is nothing to buy. Set a price per vote, add a bundle, or turn paid voting off before ${action}.`,
      })
    }
  }
}

// ─── Router ─────────────────────────────────────────────────────────────────

export const orgContestsRouter = createTRPCRouter({
  // ─── Queries ──────────────────────────────────────────────────────────────

  // Contests on one event, or on every event the caller organizes. Newest
  // first. The owner is bound into this statement; `eventId` only narrows it
  // further, so passing someone else's event id returns nothing rather than
  // their contests.
  list: organizerProcedure
    .input(z.object({ eventId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select({
          id: contests.id,
          eventId: contests.eventId,
          eventTitle: events.title,
          title: contests.title,
          slug: contests.slug,
          status: contests.status,
          timeZone: contests.timeZone,
          votingOpensAt: contests.votingOpensAt,
          votingClosesAt: contests.votingClosesAt,
          freeVotingEnabled: contests.freeVotingEnabled,
          paidVotingEnabled: contests.paidVotingEnabled,
          pricePerVoteMinor: contests.pricePerVoteMinor,
          // Set while rejected or suspended (and kept through resubmission),
          // so the list can say why.
          rejectionReason: contests.rejectionReason,
          reviewRequestedAt: contests.reviewRequestedAt,
          reviewedAt: contests.reviewedAt,
          createdAt: contests.createdAt,
          updatedAt: contests.updatedAt,
          ...countColumns,
        })
        .from(contests)
        .innerJoin(events, eq(events.id, contests.eventId))
        .where(
          and(
            managedEvents(ctx),
            input.eventId ? eq(contests.eventId, input.eventId) : undefined
          )
        )
        .orderBy(desc(contests.createdAt))
    }),

  // Everything the editor needs. Null when missing or not the caller's, as
  // events.byId and forms.byId do.
  byId: organizerProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const found = await findOwnedContest(ctx, input.id)
      if (!found) return null
      const { contest, event } = found

      const [categories, entryRows, bundles, countRows, feeRates] =
        await Promise.all([
          ctx.db
            .select()
            .from(contestCategories)
            .where(eq(contestCategories.contestId, contest.id))
            .orderBy(
              asc(contestCategories.sortOrder),
              asc(contestCategories.id)
            ),
          ctx.db
            .select()
            .from(entries)
            .where(eq(entries.contestId, contest.id))
            .orderBy(asc(entries.sortOrder), asc(entries.id)),
          // Retired bundles are shown to the organizer (they still back
          // orders) but marked; only `active` ones are on sale.
          ctx.db
            .select()
            .from(voteBundles)
            .where(eq(voteBundles.contestId, contest.id))
            .orderBy(asc(voteBundles.sortOrder), asc(voteBundles.priceMinor)),
          ctx.db
            .select(countColumns)
            .from(contests)
            .where(eq(contests.id, contest.id)),
          // The vote service-fee rate travels with the bundle prices it
          // applies to, exactly as public.contests.bySlug ships it: the
          // editor already makes this query, so a price is never on screen
          // beside no fee. DISPLAY only — buyVotes re-reads the rate and
          // that figure is what the voter is charged.
          getFeeRates(ctx.db),
        ])

      return {
        contest,
        event: {
          id: event.id,
          slug: event.slug,
          title: event.title,
          status: event.status,
          eventDate: event.eventDate,
          endDate: event.endDate,
        },
        categories,
        entries: entryRows,
        bundles,
        // Basis points (500 = 5%).
        serviceFeeBps: feeRates.vote,
        counts: countRows[0] ?? {
          categoryCount: 0,
          entryCount: 0,
          voteCount: 0,
        },
        // Whether votes can be cast right now; null unless published. One
        // definition, shared with the public page and the cast guard.
        availability:
          contest.status === 'published' ? votingAvailability(contest) : null,
      }
    }),

  // ─── Mutations ────────────────────────────────────────────────────────────

  // Starts as a draft. Categories, entries and bundles are added afterwards,
  // because a contest cannot be reviewed before it has somewhere to vote.
  create: organizerProcedure
    .input(createInput)
    .mutation(async ({ ctx, input }) => {
      const event = await requireOwnedEvent(ctx, input.eventId)
      assertEventAcceptsContests(event)

      const id = newId('contest')
      // Derived server-side, never client-supplied, and never regenerated.
      const slug = await generateUniqueContestSlug(
        ctx.db,
        event.slug,
        input.title
      )

      await ctx.db.insert(contests).values({
        id,
        eventId: event.id,
        slug,
        title: input.title,
        description: input.description,
        timeZone: input.timeZone,
        votingOpensAt: input.votingOpensAt,
        votingClosesAt: input.votingClosesAt,
        nominationsOpenAt: input.nominationsOpenAt,
        nominationsCloseAt: input.nominationsCloseAt,
        freeVotingEnabled: input.freeVotingEnabled,
        paidVotingEnabled: input.paidVotingEnabled,
        pricePerVoteMinor: input.pricePerVoteMinor,
        status: createStatus(),
      })

      return { id, slug, status: createStatus() }
    }),

  // Settings and wording. Status changes go through submit, withdraw and
  // close, and the slug never changes.
  //
  // Reviewed here: the title, the description, and the three money settings
  // (free on/off, paid on/off, the per-vote price). Operational: the time
  // zone and both windows. See ../../lib/contest-review.ts for why.
  update: organizerProcedure
    .input(updateInput)
    .mutation(async ({ ctx, input }) => {
      const ownership = ownedContest(ctx, input.id)

      const review = await ctx.db.transaction(async (tx) => {
        const locked = await lockContestForEdit(tx, ownership)
        const contentChanged =
          input.title !== locked.title ||
          input.description !== locked.description ||
          input.freeVotingEnabled !== locked.freeVotingEnabled ||
          input.paidVotingEnabled !== locked.paidVotingEnabled ||
          input.pricePerVoteMinor !== locked.pricePerVoteMinor
        if (contentChanged) assertContentEditable(locked)

        await tx
          .update(contests)
          .set({
            title: input.title,
            description: input.description,
            timeZone: input.timeZone,
            votingOpensAt: input.votingOpensAt,
            votingClosesAt: input.votingClosesAt,
            nominationsOpenAt: input.nominationsOpenAt,
            nominationsCloseAt: input.nominationsCloseAt,
            freeVotingEnabled: input.freeVotingEnabled,
            paidVotingEnabled: input.paidVotingEnabled,
            pricePerVoteMinor: input.pricePerVoteMinor,
            updatedAt: new Date(),
          })
          .where(ownership)

        return contentChanged
          ? recordContentChange(tx, locked)
          : unchangedReview(locked)
      })

      return { id: input.id, ...review }
    }),

  // Sends the contest to the admin review queue: a draft, a rejected contest
  // once fixed, a closed one being restarted, or one an admin took down and
  // the organizer has since fixed. An organizer cannot publish. Votes are
  // money, and the ballot is theirs to write, so a contest goes live only
  // when an admin approves it.
  submit: organizerProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { contest, event } = await requireOwnedContest(ctx, input.id)
      assertSubmittable(contest.status)
      assertEventAcceptsContests(event)
      await assertReadyToSubmit(ctx.db, contest, 'submitting it')

      const now = new Date()
      const next: OrganizerWritableStatus = 'pending_review'
      const updated = await ctx.db
        .update(contests)
        .set({ status: next, reviewRequestedAt: now, updatedAt: now })
        .where(transitionFrom(ownedContest(ctx, input.id), SUBMITTABLE))
        .returning({ id: contests.id })

      if (updated.length === 0) {
        const current = await findOwnedContest(ctx, input.id)
        if (!current) throw new TRPCError({ code: 'NOT_FOUND' })
        assertSubmittable(current.contest.status)
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'This contest changed while it was being submitted. Try again.',
        })
      }

      return { id: contest.id, status: next }
    }),

  // Pulls a contest back out of the admin queue, to a draft, so the organizer
  // can keep working instead of waiting.
  //
  // Withdrawing and an admin approving are the same race from two sides, and
  // both live in a WHERE on one row: the row lock serialises them, the second
  // to arrive re-evaluates its condition against what the first left, and
  // exactly one wins. A withdrawal can never silently discard an approval.
  withdraw: organizerProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { contest } = await requireOwnedContest(ctx, input.id)
      if (contest.status !== 'pending_review') {
        throw notAwaitingReview(contest.status)
      }

      const next: OrganizerWritableStatus = 'draft'
      const updated = await ctx.db
        .update(contests)
        .set({
          status: next,
          // Nothing is waiting for an admin now; submitting again stamps a
          // fresh time and goes to the back of the queue.
          reviewRequestedAt: null,
          updatedAt: new Date(),
        })
        .where(transitionFrom(ownedContest(ctx, input.id), ['pending_review']))
        .returning({ id: contests.id })

      if (updated.length === 0) {
        const current = await findOwnedContest(ctx, input.id)
        if (!current) throw new TRPCError({ code: 'NOT_FOUND' })
        throw notAwaitingReview(current.contest.status)
      }

      return { id: contest.id, status: next }
    }),

  // Ends voting and keeps every vote. `votingAvailability` reads this same
  // row, so once it commits nothing can be cast. The results page stays
  // public — that is the point of running an award — which is also why a
  // closed contest's wording is frozen (contest-review.assertContentEditable).
  close: organizerProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const next: OrganizerWritableStatus = 'closed'
      const updated = await ctx.db
        .update(contests)
        .set({ status: next, updatedAt: new Date() })
        .where(transitionFrom(ownedContest(ctx, input.id), ['published']))
        .returning({ id: contests.id })
      if (updated.length === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Only a live contest can be closed.',
        })
      }
      return { id: input.id, status: next }
    }),

  // Only a contest nobody has voted in and nobody has bought credits for.
  // Both are records: a vote is somebody's choice and a credit is somebody's
  // money. A contest with either can only be closed.
  //
  // Both guards sit in the DELETE's own WHERE, so a vote or a purchase
  // landing mid-delete is seen by the statement rather than by a read that
  // happened before it.
  delete: organizerProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const deleted = await ctx.db
        .delete(contests)
        .where(
          and(
            ownedContest(ctx, input.id),
            notExists(
              ctx.db
                .select({ ok: sql`1` })
                .from(votes)
                .where(eq(votes.contestId, contests.id))
            ),
            notExists(
              ctx.db
                .select({ ok: sql`1` })
                .from(voteCredits)
                .where(
                  and(
                    eq(voteCredits.contestId, contests.id),
                    gt(voteCredits.purchased, 0)
                  )
                )
            )
          )
        )
        .returning({ id: contests.id })

      if (deleted.length === 0) {
        // Tell them which it was. A contest that is not theirs never got
        // here — `ownedContest` already made it NOT_FOUND.
        const current = await findOwnedContest(ctx, input.id)
        if (!current) throw new TRPCError({ code: 'NOT_FOUND' })
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'People have already voted in this contest or bought votes for it, so it cannot be deleted. Close it instead — the results stay public.',
        })
      }
      return { id: input.id }
    }),

  categories: orgContestCategoriesRouter,
  nominations: orgContestNominationsRouter,
  entries: orgContestEntriesRouter,
  bundles: orgVoteBundlesRouter,
})

export type OrgContestsRouter = typeof orgContestsRouter
