import { TRPCError } from '@trpc/server'
import { eq } from 'drizzle-orm'

import type { Database, EventStatus } from '@ticketur/db'
import { contests } from '@ticketur/db'

import { hasEnded } from './predicates'
import { slugify } from './slug'

// Contest mechanics an organizer-side resolver needs that are neither access
// control (./contest-access) nor the review lifecycle (./contest-review):
// slugs, the "can this event carry a contest" rule, and reading a unique
// violation back off the driver.
//
// The voting mechanics themselves — `voteDay`, `votingAvailability`,
// `isValidTimeZone`, credits, casts — live in ./votes and are only ever
// called from here, never re-implemented.

// `price_per_vote_minor`, `vote_bundles.price_minor` and `votes` are int4
// columns.
export const INT4_MAX = 2_147_483_647

// A contest with a hundred categories is a data-entry mistake, not an awards
// night. The same reasoning as MAX_PRICE_OPTIONS_PER_FORM: a cap that no real
// organizer meets, so a runaway loop or a stuck "add" button is caught.
export const MAX_CATEGORIES_PER_CONTEST = 50
export const MAX_BUNDLES_PER_CONTEST = 20

/**
 * The public URL slug, generated ONCE at creation and never regenerated —
 * exactly `generateUniqueFormSlug`, for exactly its reason: a contest's link
 * is shared on Instagram and in WhatsApp groups before a single vote is cast,
 * and renaming the contest must not break it.
 *
 * Platform-unique (`contests.slug` carries the UNIQUE constraint), so the
 * event slug is folded in to keep collisions rare rather than to namespace
 * anything. The sequential probes are cheap because contest creation is rare;
 * the constraint is the real backstop against two creations racing.
 */
export async function generateUniqueContestSlug(
  db: Database,
  eventSlug: string,
  title: string
): Promise<string> {
  const base = slugify(`${eventSlug.slice(0, 40)} ${title}`)
  let candidate = base
  for (let n = 2; n < 1000; n++) {
    const existing = await db
      .select({ id: contests.id })
      .from(contests)
      .where(eq(contests.slug, candidate))
      .limit(1)
    if (existing.length === 0) return candidate
    candidate = `${base}-${n}`
  }
  // Pathological fallback, effectively unreachable.
  return `${base}-${Date.now()}`
}

/**
 * A contest can only be created on an event that is still the organizer's to
 * run. Mirrors `assertEventAcceptsForms`, because the reason is the same: a
 * contest hangs off its event's public page and inherits its visibility.
 */
export function assertEventAcceptsContests(event: {
  status: EventStatus
  eventDate: string | null
  endDate: string | null
}): void {
  if (event.status === 'archived' || event.status === 'suspended') {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'This event is no longer active.',
    })
  }
  if (hasEnded(event)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'This event has already ended.',
    })
  }
}

// ─── Unique violations ──────────────────────────────────────────────────────

const UNIQUE_VIOLATION = '23505'

/** The partial unique index that stops one applicant being promoted twice. */
export const ENTRY_SUBMISSION_INDEX = 'entries_submission_unique'

/**
 * Whether an error is Postgres refusing a duplicate on a named unique index.
 *
 * The envelope-walking is lifted from `isDailyFreeVoteConflict`
 * (routers/public/vote-free.ts) and generalised over the index name, for the
 * same reason it is written that way there: the `postgres` driver throws its
 * `PostgresError` with the SQLSTATE in `code` and the index in
 * `constraint_name`; drizzle 0.45.3 does not wrap it, but a later drizzle
 * wraps queries in `DrizzleQueryError`, and node-postgres spells the field
 * `constraint`. Generous about the envelope, strict about the SQLSTATE and
 * the index name — guessing wrong in either direction turns a clean refusal
 * into a 500, or a 500 into a silent success.
 *
 * It is NOT imported from vote-free.ts: that module is a public router with
 * email and order dependencies, and this is the only part of it that is
 * general.
 */
export function isUniqueViolation(error: unknown, index: string): boolean {
  let current: unknown = error
  for (
    let depth = 0;
    depth < 5 && current !== null && current !== undefined;
    depth++
  ) {
    if (typeof current !== 'object') return false
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
      if (constraint === index) return true
      // A driver that drops the constraint name still carries it in
      // Postgres' own wording: 'duplicate key value violates unique
      // constraint "…"'.
      if (
        constraint === null &&
        typeof e.message === 'string' &&
        e.message.includes(index)
      ) {
        return true
      }
    }
    current = e.cause
  }
  return false
}
