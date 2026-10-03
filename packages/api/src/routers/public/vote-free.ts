import { TRPCError } from '@trpc/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

import { contests, entries, votes } from '@ticketur/db'

import { createTRPCRouter, publicProcedure } from '../../trpc'
import { getBaseUrl } from '../../lib/base-url'
import { sendVoteCode } from '../../lib/vote-emails'
import {
  consumeVoteCode,
  issueVoteCode,
  verifyVoteCode,
  VOTE_CODE_TTL_MINUTES,
  type VerifyVoteCodeFailure,
} from '../../lib/vote-otp'
import {
  castVotes,
  normalizeVoterEmail,
  voteDay,
  votingAvailability,
  type VotingClosedReason,
} from '../../lib/votes'
import { loadPublicContest } from './contests'

// Free voting: one vote per email, per category, per day.
//
// Two steps, because the voter usually has no account and the email behind a
// free vote still has to be real:
//   requestCode — mints a one-time code and emails it (lib/vote-otp.ts).
//   castFree    — takes the code and the entry, and lands the vote.
//
// ── Where each guarantee lives ──
// The checks above the transaction exist so the voter can be told WHY. The two
// that make this safe under concurrency are both single statements decided by
// the database:
//   one vote per (email, category, day) → the partial unique index
//     `votes_free_daily_unique`. Two simultaneous casts both pass the advisory
//     read; the second fails on the index, and isDailyFreeVoteConflict turns
//     that into a refusal rather than a 500.
//   the entry is active, and in this contest and category → castVotes' own
//     conditional UPDATE, which is also the statement that bumps voteCount.
//
// ── Lock order ──
// vote_otps → entries → votes. The paid path is vote_credits → entries →
// votes. Neither path touches the other's first table, so the two cannot
// deadlock each other.
//
// ── A code is single-use, and that has a cost ──
// Consuming the code is what makes an intercepted one worthless, so a voter
// who wants to vote in several categories needs a code for each, and
// MAX_REQUESTS_PER_WINDOW caps how many they can get in an hour. Carrying a
// verification across categories would need somewhere to record "this email is
// verified for this contest until T", and there is no such column: `vote_otps`
// has `consumedAt` and nothing else. Left as it is rather than quietly
// weakening single use.

const VOTING_CLOSED_MESSAGES: Record<VotingClosedReason, string> = {
  not_published: 'This contest is not open for voting.',
  not_open_yet: 'Voting has not opened for this contest yet.',
  closed: 'Voting has closed for this contest.',
}

const CODE_FAILURE_MESSAGES: Record<VerifyVoteCodeFailure, string> = {
  no_code: 'Request a code first, then enter it here.',
  expired: 'That code has expired. Request a new one.',
  consumed: 'That code has already been used. Request a new one.',
  locked: 'Too many incorrect codes. Request a new one to try again.',
  wrong: "That code isn't right. Check the email and try again.",
}

const ALREADY_VOTED_MESSAGE =
  "You've already used your free vote for this category today. Try again tomorrow, or buy votes to keep going."

const requestCodeInput = z.object({
  contestId: z.string(),
  email: z.email('Enter a valid email'),
})

const castFreeInput = z.object({
  contestId: z.string(),
  entryId: z.string(),
  email: z.email('Enter a valid email'),
  // Digits only, and the length the issuer actually mints. Checked here so an
  // obviously malformed code never costs an attempt.
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code'),
})

/** What Postgres raises when the free-vote index turns a second vote away. */
const FREE_DAILY_INDEX = 'votes_free_daily_unique'
const UNIQUE_VIOLATION = '23505'

/**
 * Whether an error is the daily free-vote index refusing a duplicate.
 *
 * The shape is the `postgres` (postgres.js) driver's `PostgresError`: SQLSTATE
 * in `code`, and the index name in `constraint_name`, which Postgres sends on
 * every unique violation. drizzle-orm 0.45.3's postgres-js session does not
 * wrap driver errors, so it arrives as thrown — but `cause` is walked anyway,
 * because a later drizzle wraps queries in `DrizzleQueryError`, and
 * `constraint` is accepted alongside `constraint_name` because node-postgres
 * spells it that way. Getting this wrong in either direction is a 500 in the
 * voter's face, so it is deliberately generous about the envelope and strict
 * about the SQLSTATE and the index name.
 */
export function isDailyFreeVoteConflict(error: unknown): boolean {
  let current: unknown = error
  for (
    let depth = 0;
    depth < 5 && current !== null && current !== undefined;
    depth++
  ) {
    if (typeof current === 'object') {
      const e = current as {
        code?: unknown
        constraint_name?: unknown
        constraint?: unknown
        message?: unknown
        cause?: unknown
      }
      if (e.code === UNIQUE_VIOLATION) {
        const constraint =
          typeof e.constraint_name === 'string'
            ? e.constraint_name
            : typeof e.constraint === 'string'
              ? e.constraint
              : null
        if (constraint === FREE_DAILY_INDEX) return true
        // No constraint name on the envelope (a driver that drops it): fall
        // back to the message, which carries the index name in Postgres'
        // own wording — 'duplicate key value violates unique constraint "…"'.
        if (
          constraint === null &&
          typeof e.message === 'string' &&
          e.message.includes(FREE_DAILY_INDEX)
        ) {
          return true
        }
      }
      current = e.cause
      continue
    }
    return false
  }
  return false
}

export const publicVoteFreeRouter = createTRPCRouter({
  /**
   * Send a one-time code to an email so it can cast its free vote.
   *
   * ── No account enumeration ──
   * This never reads the `user` table, so the answer cannot depend on whether
   * the address has a Ticketeur account: an address with one and an address
   * without one get the identical response. (It does reveal that a code went
   * to that address for this contest recently, when the cooldown refuses —
   * which the voter needs to be told, and which says nothing about accounts.)
   *
   * The code itself is never returned. It exists in memory here and in the
   * email, and as a scrypt digest in `vote_otps`.
   */
  requestCode: publicProcedure
    .input(requestCodeInput)
    .mutation(async ({ ctx, input }) => {
      const found = await loadPublicContest(
        ctx.db,
        eq(contests.id, input.contestId)
      )
      if (!found) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Contest not found' })
      }
      const { contest, event } = found

      const availability = votingAvailability(contest)
      if (!availability.open) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: VOTING_CLOSED_MESSAGES[availability.reason],
        })
      }
      if (!contest.freeVotingEnabled) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This contest does not offer free voting.',
        })
      }

      const email = normalizeVoterEmail(input.email)
      const issued = await issueVoteCode(ctx.db, {
        contestId: contest.id,
        email,
      })
      if (!issued.issued) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message:
            issued.reason === 'cooldown'
              ? `We've just sent a code to that address. Check your inbox, including spam, or try again in ${issued.retryAfterSeconds} seconds.`
              : 'Too many codes have been requested for that address. Please try again later.',
        })
      }

      // Never throws: the code is already stored, so a mail failure must not
      // turn into a refusal the voter could fix by requesting another one.
      await sendVoteCode({
        email,
        code: issued.code,
        contestTitle: contest.title,
        eventTitle: event.title,
        contestUrl: `${getBaseUrl()}/contests/${contest.slug}`,
      })

      return {
        sent: true,
        expiresAt: issued.expiresAt,
        expiresInMinutes: VOTE_CODE_TTL_MINUTES,
      }
    }),

  /**
   * Cast the free vote the code entitles this email to.
   *
   * Refuses when the contest is not publicly votable or has free voting
   * switched off, when voting is outside its window, when the entry is not
   * active or belongs to another contest, when the code is wrong, expired,
   * consumed or out of attempts, and when this email has already used its free
   * vote in this category today.
   *
   * ── The order of the checks is not arbitrary ──
   * The code is verified BEFORE the day is checked. The other way round would
   * let anyone with an email address ask the vote page whether that person had
   * voted in a category today, without proving anything.
   *
   * ── Why the duplicate is caught twice ──
   * The read below is advisory: it gives the voter a clean answer without
   * burning their code. The INDEX is the enforcement — two casts landing
   * together both pass the read, and the second one's INSERT raises 23505.
   * That rolls back the voteCount bump AND the code consumption with it, so
   * the loser is told they have voted today and still holds a usable code.
   */
  castFree: publicProcedure
    .input(castFreeInput)
    .mutation(async ({ ctx, input }) => {
      const found = await loadPublicContest(
        ctx.db,
        eq(contests.id, input.contestId)
      )
      if (!found) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Contest not found' })
      }
      const { contest } = found

      const availability = votingAvailability(contest)
      if (!availability.open) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: VOTING_CLOSED_MESSAGES[availability.reason],
        })
      }
      if (!contest.freeVotingEnabled) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This contest does not offer free voting.',
        })
      }

      // Read for the entry's CATEGORY, which the caller does not get to
      // choose: taking it from the input would let a vote be filed under a
      // category the entry is not in, and the daily allowance is per category.
      // Pinned to this contest so a cross-contest id is refused with something
      // the voter can act on; castVotes re-checks all of it inside the
      // transaction, race-safely.
      const [entry] = await ctx.db
        .select({
          id: entries.id,
          categoryId: entries.categoryId,
          status: entries.status,
          displayName: entries.displayName,
        })
        .from(entries)
        .where(
          and(eq(entries.id, input.entryId), eq(entries.contestId, contest.id))
        )
        .limit(1)
      if (!entry) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'That entry is not in this contest.',
        })
      }
      if (entry.status !== 'active') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `${entry.displayName} is no longer taking votes.`,
        })
      }

      const email = normalizeVoterEmail(input.email)

      // OUTSIDE the transaction below, deliberately: this spends one of the
      // code's attempts, and that spend has to commit even when the vote that
      // follows is refused. See verifyVoteCode.
      const verified = await verifyVoteCode(ctx.db, {
        contestId: contest.id,
        email,
        code: input.code,
      })
      if (!verified.ok) {
        throw new TRPCError({
          code:
            verified.reason === 'locked' ? 'TOO_MANY_REQUESTS' : 'UNAUTHORIZED',
          message: CODE_FAILURE_MESSAGES[verified.reason],
        })
      }

      // The CONTEST'S zone, not the server's. A vote at 23:30 UTC belongs to
      // tomorrow for an Africa/Lagos contest, and the index is on this string,
      // so getting it from anywhere else would enforce the wrong day.
      const votedOn = voteDay(contest.timeZone)

      // Advisory. Saves the common repeat voter their code and a rolled-back
      // transaction; the index is what actually decides.
      const [already] = await ctx.db
        .select({ id: votes.id })
        .from(votes)
        .where(
          and(
            eq(votes.categoryId, entry.categoryId),
            eq(votes.voterEmail, email),
            eq(votes.votedOn, votedOn),
            eq(votes.kind, 'free')
          )
        )
        .limit(1)
      if (already) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: ALREADY_VOTED_MESSAGE,
        })
      }

      const voterUserId =
        ctx.session && normalizeVoterEmail(ctx.session.user.email) === email
          ? ctx.session.user.id
          : null

      try {
        return await ctx.db.transaction(async (tx) => {
          // vote_otps first, then entries, then votes — the lock order the
          // paid path follows too.
          const spent = await consumeVoteCode(tx, { otpId: verified.otpId })
          if (!spent) {
            // Another request holding the same code got there first, or it
            // expired in the moments since it verified.
            throw new TRPCError({
              code: 'UNAUTHORIZED',
              message: CODE_FAILURE_MESSAGES.consumed,
            })
          }

          const cast = await castVotes(tx, {
            contestId: contest.id,
            categoryId: entry.categoryId,
            entryId: entry.id,
            kind: 'free',
            voterEmail: email,
            voterUserId,
            // A free vote is always one.
            quantity: 1,
            // No order funds a free vote.
            orderId: null,
            votedOn,
          })
          if (!cast.ok) {
            // Withdrawn or disqualified between the read above and this
            // statement. The throw rolls the code consumption back with it.
            throw new TRPCError({
              code: 'CONFLICT',
              message: `${entry.displayName} is no longer taking votes.`,
            })
          }

          return {
            voteId: cast.voteId,
            entryId: entry.id,
            categoryId: entry.categoryId,
            votedOn,
            voteCount: cast.voteCount,
          }
        })
      } catch (err) {
        // The index refusing a second free vote for this (email, category,
        // day). A clean "come back tomorrow", not a 500 — and the rollback has
        // already handed the code and the vote count back.
        if (isDailyFreeVoteConflict(err)) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: ALREADY_VOTED_MESSAGE,
          })
        }
        throw err
      }
    }),
})

export type PublicVoteFreeRouter = typeof publicVoteFreeRouter
