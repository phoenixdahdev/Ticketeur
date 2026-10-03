import { TRPCError } from '@trpc/server'
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'

import type { NominationStatus } from '@ticketur/db'
import { contestCategories, contests, events, nominations } from '@ticketur/db'

import { createTRPCRouter, organizerProcedure } from '../../trpc'
import { newId } from '../../lib/ids'
import {
  callerOwnsNomination,
  managedEvents,
  ownedContest,
  requireOwnedContest,
  requireOwnedNomination,
} from '../../lib/contest-access'
import {
  assertContentEditable,
  lockContestForEdit,
  recordContentChange,
} from '../../lib/contest-review'
import { MAX_NOMINEE_NAME } from '../../lib/nominations'
import { insertEntry } from './contest-entries'

// The organizer's side of the nomination phase: read what the public put
// forward, accept or turn down each name, and move the accepted ones onto
// the ballot.
//
// ── What is reviewed, and why PROMOTION is ──
// The test in lib/contest-review.ts is one question: CAN THIS PUT WORDS IN
// FRONT OF THE PUBLIC THAT NO ADMIN HAS SEEN? Run it on each of the three
// things here:
//
//   approve / reject — NO. A nomination is never public. It exists on this
//     screen and nowhere else, and deciding about it changes nothing a
//     visitor can see. Making it reviewable would mean an organizer working
//     through a hundred pending names took their live contest offline a
//     hundred times. So these are plain conditional UPDATEs: moderation, in
//     the same sense that withdrawing an entry is.
//
//   promote — YES, emphatically. It inserts an `entries` row, and that row
//     IS the ballot: a name on a public page people are charged to vote for.
//     contest-review.ts already says adding an entry is reviewed "by hand or
//     by promoting a submission", and this is a third source for exactly the
//     same act. If anything the case is stronger than for the other two: the
//     words came from a MEMBER OF THE PUBLIC rather than from the organizer,
//     so they are the least-seen content that can reach a ballot. So
//     promotion calls `assertContentEditable` and `recordContentChange`,
//     exactly as `entries.promote` and `entries.add` do, and on a live
//     contest it stops the voting until an admin has read the new ballot.
//
// ── Ownership ──
// Every statement here binds the caller, through ./contest-access, rather
// than inheriting it from a read above: someone else's contest is NOT_FOUND,
// never FORBIDDEN, and never silently writable.

const statusEnum = z.enum(['pending', 'approved', 'rejected'])

// 'all' is a separate word rather than an absent filter, so the UI's default
// tab is explicit in the query key.
const statusFilter = z.enum(['all', 'pending', 'approved', 'rejected'])

const STATUS_ORDER: Record<NominationStatus, number> = {
  pending: 0,
  approved: 1,
  rejected: 2,
}

export const orgContestNominationsRouter = createTRPCRouter({
  // ─── Queries ──────────────────────────────────────────────────────────────

  /**
   * What the public has put forward on this contest, newest first.
   *
   * The owner is bound into this statement in its own right — `managedEvents`
   * in the WHERE, over the join to `events` — and not inherited from the
   * `requireOwnedContest` above it. A resolver that dropped the predicate
   * would read nothing rather than read somebody else's nominations.
   */
  list: organizerProcedure
    .input(
      z.object({
        contestId: z.string(),
        status: statusFilter.default('all'),
        categoryId: z.string().nullable().default(null),
        limit: z.number().int().min(1).max(500).default(200),
      })
    )
    .query(async ({ ctx, input }) => {
      const { contest } = await requireOwnedContest(ctx, input.contestId)

      const rows = await ctx.db
        .select({
          id: nominations.id,
          categoryId: nominations.categoryId,
          categoryTitle: contestCategories.title,
          nomineeName: nominations.nomineeName,
          nomineeEmail: nominations.nomineeEmail,
          nomineePhone: nominations.nomineePhone,
          reason: nominations.reason,
          nominatedByEmail: nominations.nominatedByEmail,
          status: nominations.status,
          // Non-null once promoted: this nomination is on the ballot.
          entryId: nominations.entryId,
          createdAt: nominations.createdAt,
          updatedAt: nominations.updatedAt,
        })
        .from(nominations)
        .innerJoin(contests, eq(contests.id, nominations.contestId))
        .innerJoin(events, eq(events.id, contests.eventId))
        .leftJoin(
          contestCategories,
          eq(contestCategories.id, nominations.categoryId)
        )
        .where(
          and(
            eq(nominations.contestId, contest.id),
            input.status === 'all'
              ? undefined
              : eq(nominations.status, input.status),
            input.categoryId
              ? eq(nominations.categoryId, input.categoryId)
              : undefined,
            managedEvents(ctx)
          )
        )
        .orderBy(desc(nominations.createdAt), asc(nominations.id))
        .limit(input.limit)

      // The badges on the filter tabs. A second statement rather than a count
      // of `rows`, because `rows` is capped by `limit` and a tab saying "200
      // pending" on a contest with a thousand would simply be wrong. Owner
      // bound here too.
      const tallies = await ctx.db
        .select({
          status: nominations.status,
          total: sql<number>`count(*)::int`,
        })
        .from(nominations)
        .innerJoin(contests, eq(contests.id, nominations.contestId))
        .innerJoin(events, eq(events.id, contests.eventId))
        .where(and(eq(nominations.contestId, contest.id), managedEvents(ctx)))
        .groupBy(nominations.status)

      const counts = { pending: 0, approved: 0, rejected: 0, total: 0 }
      for (const row of tallies) {
        counts[row.status] = row.total
        counts.total += row.total
      }

      return {
        counts,
        // Capped reads deserve to say so, rather than letting the organizer
        // believe they have seen everything.
        truncated: rows.length === input.limit,
        nominations: rows.sort(
          (a, b) =>
            STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
            b.createdAt.getTime() - a.createdAt.getTime() ||
            (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
        ),
      }
    }),

  // ─── Mutations ────────────────────────────────────────────────────────────

  /**
   * Accept or turn down a nomination. NOT reviewed content — see the header.
   *
   * Nobody is emailed. A rejection in particular carries no message to the
   * nominee: they may not know they were nominated at all, and "you were
   * nominated and turned down" is a sentence this platform has no business
   * sending to a stranger on an organizer's behalf.
   *
   * Both guards are in the UPDATE's own WHERE:
   *   - `callerOwnsNomination`: ownership is re-decided at the instant of the
   *     write, under the row lock.
   *   - `entry_id IS NULL`: once a nomination is on the ballot its status is
   *     the record of how it got there. Flipping it to 'rejected' would leave
   *     a rejected nomination pointing at a live entry people are voting for.
   *     Taking the entry off the ballot is `entries.setStatus`'s job.
   */
  setStatus: organizerProcedure
    .input(z.object({ id: z.string(), status: statusEnum }))
    .mutation(async ({ ctx, input }) => {
      const updated = await ctx.db
        .update(nominations)
        .set({ status: input.status, updatedAt: new Date() })
        .where(
          and(
            eq(nominations.id, input.id),
            callerOwnsNomination(ctx),
            isNull(nominations.entryId)
          )
        )
        .returning({
          id: nominations.id,
          nomineeName: nominations.nomineeName,
        })

      const row = updated[0]
      if (row) return { id: row.id, status: input.status }

      // Nothing matched. Say which of the two it was — but only for a
      // nomination this caller owns, so the lookup cannot be used to probe
      // whether an id exists.
      const { nomination } = await requireOwnedNomination(ctx, input.id)
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `“${nomination.nomineeName}” is already on the ballot. Withdraw or disqualify their entry instead — that is what takes a name off it.`,
      })
    }),

  /**
   * Move an accepted nomination onto the ballot: one `entries` row, in the
   * category it was nominated in, linked back from `nominations.entryId`.
   *
   * REVIEWED CONTENT. See the header for why; the consequence is that on a
   * live contest this stops the voting and sends the contest back to the
   * admin queue, exactly as adding any other entry does.
   *
   * ── It cannot happen twice, and the guard is in the statement ──
   * The UPDATE that claims the nomination carries `entry_id IS NULL` in its
   * own WHERE. Two promotions arriving together both insert an entry; both
   * then reach that UPDATE; the first commits with `entry_id` set, and the
   * second — which blocked on the row lock — re-evaluates the WHERE against
   * the committed row, matches nothing, and throws. The throw rolls ITS entry
   * insert back with it, so the loser leaves no orphan on the ballot. A read
   * before the insert would not do this: both would read NULL.
   *
   * The category is NOT the caller's to choose. A nomination was made in a
   * category, people may already have discussed it there, and moving it
   * somewhere else at promotion time would quietly rewrite what was
   * nominated. Move the entry afterwards if it is genuinely in the wrong
   * place.
   */
  promote: organizerProcedure
    .input(
      z.object({
        id: z.string(),
        // Omitted = the name as it was nominated.
        displayName: z.string().trim().min(1).max(MAX_NOMINEE_NAME).optional(),
        // The nominator's reason is written FOR THE ORGANIZER, not for a
        // public ballot, so it is never copied across on its own. The
        // organizer writes the bio, or leaves it empty.
        bio: z.string().trim().max(2000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { nomination } = await requireOwnedNomination(ctx, input.id)

      if (nomination.status !== 'approved') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'Only an accepted nomination can go on the ballot. Accept it first.',
        })
      }
      // An early, friendlier version of the guard that actually decides,
      // below. This one can be stale; that one cannot.
      if (nomination.entryId !== null) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `“${nomination.nomineeName}” is already on the ballot.`,
        })
      }

      const ownership = ownedContest(ctx, nomination.contestId)
      const entryId = newId('entry')

      const review = await ctx.db.transaction(async (tx) => {
        const locked = await lockContestForEdit(tx, ownership)
        assertContentEditable(locked)

        // `submissionId` stays NULL: this entry came from a nomination, not
        // from a registration. The link in the other direction —
        // `nominations.entryId`, set below — is the record of where it came
        // from, and `entries_submission_unique` is partial precisely so an
        // entry with no submission behind it is allowed.
        await insertEntry(tx, locked, {
          id: entryId,
          categoryId: nomination.categoryId,
          submissionId: null,
          displayName: input.displayName ?? nomination.nomineeName,
          photoUrl: null,
          bio: input.bio ?? '',
        })

        const claimed = await tx
          .update(nominations)
          .set({ entryId, status: 'approved', updatedAt: new Date() })
          .where(
            and(
              eq(nominations.id, input.id),
              // Both of these bind the owner: `locked.id` is a contest this
              // caller has already been proved to own, under the lock, and
              // the EXISTS re-decides it inside this very statement.
              eq(nominations.contestId, locked.id),
              callerOwnsNomination(ctx),
              eq(nominations.status, 'approved'),
              isNull(nominations.entryId)
            )
          )
          .returning({ id: nominations.id })

        if (claimed.length === 0) {
          // Somebody promoted it between the read above and this statement,
          // or un-accepted it. Throwing here rolls the entry insert back.
          throw new TRPCError({
            code: 'CONFLICT',
            message: `“${nomination.nomineeName}” was just put on the ballot by somebody else, or taken off the accepted list. Reload to see where it stands.`,
          })
        }

        return recordContentChange(tx, locked)
      })

      return { id: input.id, entryId, ...review }
    }),
})

export type OrgContestNominationsRouter = typeof orgContestNominationsRouter
