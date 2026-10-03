import type { ContestStatus } from '@ticketur/db'

// The optional phase in FRONT of voting: the public puts names forward, the
// organizer reviews them, and the ones they accept are promoted onto the
// ballot as entries. Voting then runs on those entries.
//
// ── Why this module imports nothing ──
// The window rule is needed in two places: the server decides every write
// with it, and the public contest page decides whether to show the form with
// it. `votingAvailability` cannot be shared that way — it lives in ./votes,
// which imports the database client and so can never be bundled for a
// browser, and voting-state.ts says exactly that. This module is deliberately
// type-only at its edges so one definition serves both sides and the two can
// never drift.
//
// The browser's copy is ADVISORY. It decides what is on screen; the server
// re-decides on every mutation with this same function and its own clock, and
// its refusal is what the voter is shown. A page left open past the closing
// time offers a form that the server then turns away in its own words — the
// same trade the voting UI already makes.

// ─── The window ─────────────────────────────────────────────────────────────

export type NominationsClosedReason =
  // The contest has NO nomination phase: both bounds are null. Not "closed",
  // not "not open yet" — nominating this contest is not a thing that exists.
  | 'no_phase'
  // Not approved, taken down, still a draft.
  | 'not_published'
  // There is a phase and it has not started.
  | 'not_open_yet'
  // It has finished, or the whole contest has.
  | 'closed'

export type NominationAvailability =
  { open: true } | { open: false; reason: NominationsClosedReason }

/** Just the columns the window rule reads. */
export type NominationWindow = {
  status: ContestStatus
  nominationsOpenAt: Date | null
  nominationsCloseAt: Date | null
}

/**
 * Whether a contest takes nominations right now, and why not when it doesn't.
 *
 * A read-time rule in the style of `votingAvailability`, with the same NULL
 * semantics and the same EXCLUSIVE close boundary (`now < closeAt` is open),
 * so the two phases cannot disagree about what a date means.
 *
 * ── The first test is the important one ──
 * Both bounds null is checked BEFORE the status and before the clock, because
 * it is a different kind of no. `contests.nominationsOpenAt` and
 * `nominationsCloseAt` both default to NULL, so every contest that exists
 * today has no nomination phase: if "unbounded" meant "always open" the way
 * it does for voting, publishing a contest would silently open a public write
 * nobody asked for. An organizer opts in by setting at least one bound.
 *
 * Given at least one bound, the nulls then read as they do for voting: no
 * `openAt` means from the moment it was published; no `closeAt` means until
 * the contest itself closes.
 */
export function nominationAvailability(
  contest: NominationWindow,
  now: Date = new Date()
): NominationAvailability {
  if (
    contest.nominationsOpenAt === null &&
    contest.nominationsCloseAt === null
  ) {
    return { open: false, reason: 'no_phase' }
  }
  if (contest.status !== 'published') {
    // 'closed' is the contest finishing normally; draft, pending_review,
    // rejected and suspended all mean "this is not a contest you can act on",
    // and the public loader never surfaces them anyway.
    return {
      open: false,
      reason: contest.status === 'closed' ? 'closed' : 'not_published',
    }
  }
  if (contest.nominationsCloseAt && now >= contest.nominationsCloseAt) {
    return { open: false, reason: 'closed' }
  }
  if (contest.nominationsOpenAt && now < contest.nominationsOpenAt) {
    return { open: false, reason: 'not_open_yet' }
  }
  return { open: true }
}

/** `nominationAvailability` as a boolean, for callers with nothing to explain. */
export function nominationsAreOpen(
  contest: NominationWindow,
  now: Date = new Date()
): boolean {
  return nominationAvailability(contest, now).open
}

/** Whether this contest has a nomination phase at all, open or not. */
export function hasNominationPhase(contest: {
  nominationsOpenAt: Date | null
  nominationsCloseAt: Date | null
}): boolean {
  return (
    contest.nominationsOpenAt !== null || contest.nominationsCloseAt !== null
  )
}

// ─── Limits ─────────────────────────────────────────────────────────────────

/**
 * Matches `entries.displayName`'s own cap, because this string becomes one:
 * a name too long to promote would be a nomination the organizer can accept
 * and then not use.
 */
export const MAX_NOMINEE_NAME = 200

/** Long enough to say why, short enough that nobody pastes a novel. */
export const MAX_NOMINATION_REASON = 1000

/** RFC 5321's limit on an address. */
export const MAX_EMAIL = 254

/** Generous for an international number with separators. */
export const MAX_PHONE = 40

/**
 * How many DIFFERENT names one verified address may put forward in one
 * category.
 *
 * The unique index stops the same name twice; this stops the same person
 * filling a category on their own. Five is past what anybody nominating in
 * good faith needs and well short of a shortlist.
 *
 * ── The honest limit ──
 * It is a count followed by an insert, not one statement, so a burst of
 * genuinely simultaneous requests from one verified address can overshoot it
 * by the size of the burst. There is no column to hang a race-free counter
 * on and the schema is frozen. The overshoot is bounded, it costs the
 * attacker a verified mailbox and one one-time code PER NOMINATION, and the
 * rule that actually matters — one nominator, one name, one category — is the
 * unique index and is race-free. Compare `issueVoteCode`'s ceiling, which is
 * honest about exactly the same thing for exactly the same reason.
 */
export const MAX_NOMINATIONS_PER_NOMINATOR_PER_CATEGORY = 5

/** The unique index that stops one nominator naming the same person twice. */
export const NOMINATION_NOMINATOR_INDEX = 'nominations_one_per_nominator_unique'

// ─── The nominee's name ─────────────────────────────────────────────────────

/**
 * The form the name is stored in, and so the form the unique index compares.
 *
 * Runs of whitespace collapse to one space, because the index is on the raw
 * column: without this, "Ada  Obi" and "Ada Obi" are two rows and the index
 * stops neither. Case is deliberately LEFT ALONE — this string is printed on
 * a public ballot the moment it is promoted, and lower-casing somebody's name
 * to make an index easier is not a trade worth making. The consequence is
 * honest and worth knowing: "ada obi" and "Ada Obi" are two nominations, and
 * the organizer is the one who notices.
 */
export function normalizeNomineeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ')
}
