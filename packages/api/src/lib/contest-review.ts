import { TRPCError } from '@trpc/server'
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm'

import type { ContestStatus } from '@ticketur/db'
import { contests } from '@ticketur/db'

import type { DbTransaction } from './votes'

// Admin review of contests. The same machinery as registration forms
// (./form-review.ts), deliberately, because a contest is the same kind of
// thing: content an organizer writes, shown to the public, charged for.
//
// Reaching 'published': an admin approving the revision they were shown.
// NOTHING on the organizer side writes it — see ORGANIZER_WRITABLE below.
//
// Staying honest: a change to reviewed content on a published contest sends
// it back to 'pending_review' in the transaction that makes the change, while
// holding the contest row's lock. Voting reads that same row's status
// (`votingAvailability` in ./votes, and the public loader's allow-list), so
// the edit and the end of voting commit together: no vote is ever cast
// against content an admin has not seen.
//
// ── The boundary: what an admin judges, so what sends a live contest back ──
// The test is one question — CAN THIS PUT WORDS OR A PRICE IN FRONT OF THE
// PUBLIC THAT NO ADMIN HAS SEEN?
//
//   reviewed:
//     - the contest's title and description
//     - a category's title and description, and adding one
//     - an entry's display name, photo and bio, and adding one (by hand or by
//       promoting a submission): an entry IS the ballot, and an organizer
//       writes every word and picks every photo on it
//     - whether free voting is on, whether paid voting is on, and the
//       per-vote price — what the public is charged is part of what they
//       agree to, exactly as a form's price options are
//     - a bundle's label, vote count and price, and adding one
//
//   not reviewed (operational — none of it can introduce unseen content):
//     - every sortOrder: categories, entries, bundles
//     - the voting and nomination windows: when, not what. The same call
//       form-review makes about a form's opensAt/closesAt
//     - the time zone. It decides when "today" rolls over for the daily free
//       vote, which is a clock, not a claim; and it cannot rewrite votes
//       already cast, because `votes.votedOn` is a string written at cast
//       time. It is refused outright if invalid (isValidTimeZone), which is
//       a different guard from review
//     - withdrawing or disqualifying an entry, and putting one back: this is
//       MODERATION. It only ever takes a name off the ballot or restores one
//       an admin already approved. Making it reviewable would mean an
//       organizer removing a cheat mid-contest took the whole contest offline
//     - retiring a bundle from sale (`active`), for the same reason
//     - DELETING a category, an entry or a bundle
//
// ── Deletion is the one place this departs from forms ──
// `org.forms.priceOptions.delete` calls recordContentChange: removing an
// option takes a live form back to review. Contests do not, and the reason is
// money that is already with us. People have BOUGHT vote credits; taking the
// contest offline because the organizer removed an entry nobody voted for
// would strand a balance they paid for. Removal cannot introduce unseen
// content, so the test above says it need not be reviewed, and the harm of
// re-reviewing it is real. (Removing anything votes have landed on is refused
// outright — a different guard, in the routers.)
//
// ── A closed contest's wording is frozen ──
// A closed contest keeps its public page: the results are the point of
// running an award, and `loadPublicContest` serves 'closed'. That page shows
// the title, the description, the categories AND every entry — unlike a
// closed form's page, which shows only a title and a description. So all
// reviewed content is frozen while closed, and changing any of it goes
// through submit. Same rule as `org.forms.update`'s frozen wording, applied
// to everything the closed page actually shows.

// ─── Statuses an organizer may write ────────────────────────────────────────

/**
 * The ONLY statuses any organizer-side write may store.
 *
 * An ALLOW-LIST, the same shape as `resolveCreateStatus` in
 * routers/events.ts: a value added to `ContestStatus` later cannot become
 * reachable by default, it has to be put here on purpose.
 *
 * 'published' and 'suspended' are absent for ANYONE, including an admin
 * calling these procedures. events.ts grants admins a create-time bypass to
 * 'upcoming' because create always makes the admin the organizer of their own
 * event; here `managedEvents` lets an admin act on any organizer's contest,
 * so a bypass would put somebody else's prices and ballot live with no review
 * on record. That is exactly the bypass form-review.ts refuses, and this
 * refuses it too. An admin approves a contest from the review screen like
 * anybody else's.
 *
 * It is a TYPE as well as a list, so a resolver that tries to write
 * 'published' does not compile.
 */
export const ORGANIZER_WRITABLE = ['draft', 'pending_review', 'closed'] as const

export type OrganizerWritableStatus = (typeof ORGANIZER_WRITABLE)[number]

/**
 * A contest is always born a draft.
 *
 * It takes no requested status at all, unlike `events.create`: a contest
 * cannot be reviewed before it has a category to vote in, so there is nothing
 * for "create and submit" to mean. `org.contests.submit` is the only writer
 * of 'pending_review', and it checks that first.
 */
export function createStatus(): OrganizerWritableStatus {
  return 'draft'
}

// ─── The row lock ───────────────────────────────────────────────────────────

/** What a content edit needs to know of its contest, read under the lock. */
export type LockedContest = {
  id: string
  status: ContestStatus
  title: string
  description: string
  freeVotingEnabled: boolean
  paidVotingEnabled: boolean
  pricePerVoteMinor: number
}

/**
 * Take the contest row's lock for the rest of the transaction and read it.
 * Every edit to reviewed content starts here, so the status it acts on cannot
 * change before it commits.
 *
 * `ownership` is the caller's own predicate (contest-access.ownedContest), so
 * the ownership test is re-made INSIDE the transaction, under the lock,
 * rather than trusted from a read that happened before it. A contest that is
 * not the caller's is NOT_FOUND here just as it is everywhere else.
 */
export async function lockContestForEdit(
  tx: DbTransaction,
  ownership: SQL
): Promise<LockedContest> {
  const [row] = await tx
    .select({
      id: contests.id,
      status: contests.status,
      title: contests.title,
      description: contests.description,
      freeVotingEnabled: contests.freeVotingEnabled,
      paidVotingEnabled: contests.paidVotingEnabled,
      pricePerVoteMinor: contests.pricePerVoteMinor,
    })
    .from(contests)
    .where(ownership)
    .for('update')
  if (!row) throw new TRPCError({ code: 'NOT_FOUND' })
  return row
}

// ─── Recording a change ─────────────────────────────────────────────────────

/**
 * What an edit did to its contest's review state. Returned to the organizer
 * so the editor can say the contest went back to review — and stopped taking
 * votes.
 */
export type ReviewEffect = {
  contestStatus: ContestStatus
  sentToReview: boolean
}

export function unchangedReview(contest: LockedContest): ReviewEffect {
  return { contestStatus: contest.status, sentToReview: false }
}

/**
 * Record a change to reviewed content, inside the transaction that made it
 * and after `lockContestForEdit`. The revision moves on, so an approval of
 * the one before fails, and a published contest goes back to review.
 *
 * The UPDATE is keyed on the id read under the lock, which is a row the
 * caller has already been proved to own.
 */
export async function recordContentChange(
  tx: DbTransaction,
  contest: LockedContest
): Promise<ReviewEffect> {
  const sendBack = contest.status === 'published'
  const now = new Date()
  await tx
    .update(contests)
    .set({
      contentRevision: sql`${contests.contentRevision} + 1`,
      ...(sendBack
        ? {
            status: 'pending_review' satisfies OrganizerWritableStatus,
            reviewRequestedAt: now,
          }
        : {}),
      updatedAt: now,
    })
    .where(eq(contests.id, contest.id))
  return {
    contestStatus: sendBack ? 'pending_review' : contest.status,
    sentToReview: sendBack,
  }
}

/**
 * Reviewed content cannot change while the contest is closed, because a
 * closed contest's public page is still showing all of it. The way to change
 * it is submit, which hides the contest until an admin approves the new
 * version — the same trade `org.forms.update` makes for a closed form's
 * title.
 */
export function assertContentEditable(contest: LockedContest): void {
  if (contest.status === 'closed') {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message:
        "This contest is closed, and its results page is still public — so what it says can't change without a review. Submit it for review to change it.",
    })
  }
}

// ─── Reading the state ──────────────────────────────────────────────────────

/** Whether a contest's content is still exactly what an admin last approved. */
export function approvedAsIs(contest: {
  contentRevision: number
  approvedRevision: number | null
}): boolean {
  return (
    contest.approvedRevision !== null &&
    contest.approvedRevision === contest.contentRevision
  )
}

/**
 * Where an organizer can send a contest to the admin queue from. A contest an
 * admin took down is submittable on purpose: it is the one and only route
 * back, and it ends at an admin approving it, so the takedown still holds.
 *
 * A closed contest is here too — it is also how voting resumes, since nothing
 * on the organizer side can write 'published'.
 */
export const SUBMITTABLE: ContestStatus[] = [
  'draft',
  'rejected',
  'closed',
  'suspended',
]

export function assertSubmittable(status: ContestStatus): void {
  if (status === 'pending_review') {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'This contest is already waiting for review.',
    })
  }
  if (status === 'published') {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'This contest is already live.',
    })
  }
}

/**
 * Why a withdrawal was refused, in the organizer's terms. An approval that
 * landed first is the one worth naming: their contest is live, not lost.
 */
export function notAwaitingReview(status: ContestStatus): TRPCError {
  return new TRPCError({
    code: 'BAD_REQUEST',
    message:
      status === 'published'
        ? 'An admin approved this contest while you were withdrawing it, so it is live now. Close it if you need voting to stop.'
        : status === 'rejected' || status === 'suspended'
          ? 'An admin has already decided on this contest. Read what they said, then submit it again.'
          : 'This contest is not waiting for review.',
  })
}

/**
 * A single conditional UPDATE's status transition, with the ownership
 * predicate folded in. Returns the WHERE every lifecycle mutation uses: the
 * contest, owned by the caller, in one of the statuses the transition is
 * allowed from. Two concurrent calls make one transition between them,
 * because the row lock serialises them and the second re-evaluates this
 * against the row the first left behind.
 */
export function transitionFrom(ownership: SQL, from: ContestStatus[]): SQL {
  return and(ownership, inArray(contests.status, from))!
}
