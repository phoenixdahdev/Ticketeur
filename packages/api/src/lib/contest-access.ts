import { TRPCError } from '@trpc/server'
import { and, eq, exists, sql, type SQL } from 'drizzle-orm'

import {
  contestCategories,
  contests,
  entries,
  events,
  voteBundles,
} from '@ticketur/db'

import type { OrganizerContext } from './form-access'

// Ownership for the organizer contest routers.
//
// The difference from ./form-access is deliberate and is the whole point of
// this module: a form resolver reads its row, then decides in JavaScript
// whether the caller may have it. Here the decision travels INSIDE the
// statement, as a predicate in its WHERE. Three things follow.
//
//   1. A resolver that forgets the predicate reads or writes nothing it is
//      allowed to, so the mistake shows up as a broken feature rather than as
//      somebody else's contest.
//   2. An UPDATE or DELETE re-checks ownership at the instant it writes,
//      under the row lock, rather than against a row read some microseconds
//      earlier. Nothing can be transferred out from under a write in flight.
//   3. Someone else's contest is NOT FOUND rather than FORBIDDEN. A
//      FORBIDDEN tells the caller the id exists, which is a small oracle over
//      a table whose ids are in public links; a miss and a non-miss are
//      indistinguishable here.
//
// `managedEvents` is the one place the rule itself is written; everything
// else composes it.

/**
 * The events this caller may act on, as SQL.
 *
 * An admin manages every organizer's events — the rule `managesEvent` applies
 * across the whole organizer API, and admins are the moderators. For an
 * organizer this binds their own user id into the statement.
 *
 * Note what this does NOT grant: no organizer-side write can reach
 * 'published' or 'suspended' (see ./contest-review), so an admin editing
 * through these procedures still cannot put a contest live unseen. That is
 * the same refusal form-review.ts makes, for the same reason.
 */
export function managedEvents(ctx: OrganizerContext): SQL {
  return ctx.session.user.role === 'admin'
    ? sql`TRUE`
    : eq(events.organizerId, ctx.session.user.id)
}

/**
 * Correlated `EXISTS` for use in any statement whose FROM is `contests`:
 * SELECT, UPDATE or DELETE. `events` appears only inside the subquery, so
 * `FOR UPDATE` on the outer statement still locks the contest row alone.
 */
export function callerOwnsContest(ctx: OrganizerContext): SQL {
  return exists(
    ctx.db
      .select({ ok: sql`1` })
      .from(events)
      .where(and(eq(events.id, contests.eventId), managedEvents(ctx)))
  )
}

/** The same, for a statement on `contest_categories`. */
export function callerOwnsCategory(ctx: OrganizerContext): SQL {
  return exists(
    ctx.db
      .select({ ok: sql`1` })
      .from(contests)
      .innerJoin(events, eq(events.id, contests.eventId))
      .where(
        and(eq(contests.id, contestCategories.contestId), managedEvents(ctx))
      )
  )
}

/** The same, for a statement on `entries`. */
export function callerOwnsEntry(ctx: OrganizerContext): SQL {
  return exists(
    ctx.db
      .select({ ok: sql`1` })
      .from(contests)
      .innerJoin(events, eq(events.id, contests.eventId))
      .where(and(eq(contests.id, entries.contestId), managedEvents(ctx)))
  )
}

/** The same, for a statement on `vote_bundles`. */
export function callerOwnsBundle(ctx: OrganizerContext): SQL {
  return exists(
    ctx.db
      .select({ ok: sql`1` })
      .from(contests)
      .innerJoin(events, eq(events.id, contests.eventId))
      .where(and(eq(contests.id, voteBundles.contestId), managedEvents(ctx)))
  )
}

/** One contest of the caller's, by id — the predicate every write starts from. */
export function ownedContest(ctx: OrganizerContext, contestId: string): SQL {
  return and(eq(contests.id, contestId), callerOwnsContest(ctx))!
}

// What the routers need of the owning event.
const eventColumns = {
  id: events.id,
  organizerId: events.organizerId,
  slug: events.slug,
  title: events.title,
  status: events.status,
  eventDate: events.eventDate,
  endDate: events.endDate,
}

/**
 * The event a contest is being created on. The ownership test is the WHERE,
 * so an event belonging to somebody else simply is not found.
 */
export async function requireOwnedEvent(
  ctx: OrganizerContext,
  eventId: string
) {
  const [event] = await ctx.db
    .select(eventColumns)
    .from(events)
    .where(and(eq(events.id, eventId), managedEvents(ctx)))
    .limit(1)
  if (!event) throw new TRPCError({ code: 'NOT_FOUND' })
  return event
}

/** A contest with its event, or null. For queries that answer null. */
export async function findOwnedContest(
  ctx: OrganizerContext,
  contestId: string
) {
  const [row] = await ctx.db
    .select({ contest: contests, event: eventColumns })
    .from(contests)
    .innerJoin(events, eq(events.id, contests.eventId))
    .where(and(eq(contests.id, contestId), managedEvents(ctx)))
    .limit(1)
  return row ?? null
}

export async function requireOwnedContest(
  ctx: OrganizerContext,
  contestId: string
) {
  const row = await findOwnedContest(ctx, contestId)
  if (!row) throw new TRPCError({ code: 'NOT_FOUND' })
  return row
}

export async function requireOwnedCategory(
  ctx: OrganizerContext,
  categoryId: string
) {
  const [row] = await ctx.db
    .select({ category: contestCategories, event: eventColumns })
    .from(contestCategories)
    .innerJoin(contests, eq(contests.id, contestCategories.contestId))
    .innerJoin(events, eq(events.id, contests.eventId))
    .where(and(eq(contestCategories.id, categoryId), managedEvents(ctx)))
    .limit(1)
  if (!row) throw new TRPCError({ code: 'NOT_FOUND' })
  return row
}

export async function requireOwnedEntry(
  ctx: OrganizerContext,
  entryId: string
) {
  const [row] = await ctx.db
    .select({ entry: entries, event: eventColumns })
    .from(entries)
    .innerJoin(contests, eq(contests.id, entries.contestId))
    .innerJoin(events, eq(events.id, contests.eventId))
    .where(and(eq(entries.id, entryId), managedEvents(ctx)))
    .limit(1)
  if (!row) throw new TRPCError({ code: 'NOT_FOUND' })
  return row
}

export async function requireOwnedBundle(
  ctx: OrganizerContext,
  bundleId: string
) {
  const [row] = await ctx.db
    .select({ bundle: voteBundles, event: eventColumns })
    .from(voteBundles)
    .innerJoin(contests, eq(contests.id, voteBundles.contestId))
    .innerJoin(events, eq(events.id, contests.eventId))
    .where(and(eq(voteBundles.id, bundleId), managedEvents(ctx)))
    .limit(1)
  if (!row) throw new TRPCError({ code: 'NOT_FOUND' })
  return row
}
