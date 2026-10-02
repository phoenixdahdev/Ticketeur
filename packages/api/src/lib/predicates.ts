import { and, eq, ne, sql } from 'drizzle-orm'

import { events, forms, orderItems, orders, reports, user } from '@ticketur/db'

// ─── Visibility ─────────────────────────────────────────────────────────────

// A user is hidden from public surfaces only while an active ban applies.
// Permanent bans (banExpires null) and unexpired temp bans hide; already-
// expired temp bans fall through so the user reappears automatically.
export const notCurrentlyBanned = sql`(${user.banned} IS NOT TRUE OR (${user.banExpires} IS NOT NULL AND ${user.banExpires} < NOW()))`

// An event is "still running" (visible/upcoming) while its end date — or start
// date for single-day events — is today or later. A TBD event (null date) is
// treated as upcoming. `today` is an ISO YYYY-MM-DD string.
export function stillRunning(today: string) {
  return sql`(${events.eventDate} IS NULL OR COALESCE(${events.endDate}, ${events.eventDate}) >= ${today})`
}

// The complement: an event whose end (or start) is strictly before today.
// A null date yields NULL under comparison and is therefore excluded — a TBD
// event is never "past".
export function alreadyEnded(today: string) {
  return sql`COALESCE(${events.endDate}, ${events.eventDate}) < ${today}`
}

// The same rule as `alreadyEnded`, for a row already loaded into memory —
// callers that have the event in hand (a detail page, a checkout guard) must
// not re-derive "finished" by eye and drift from the SQL version.
export function hasEnded(
  event: { eventDate: string | null; endDate: string | null },
  today: string = new Date().toISOString().slice(0, 10)
): boolean {
  const lastDay = event.endDate ?? event.eventDate
  return lastDay !== null && lastDay < today
}

// ─── Order aggregates ────────────────────────────────────────────────────────

// Comma-joined tier names for an order, cheapest first (e.g. "General, VIP").
// Correlated to `orders.id`, so only valid in queries selecting from `orders`.
export const tierSummarySql = sql<string>`COALESCE((SELECT string_agg(${orderItems.tierName}, ', ' ORDER BY ${orderItems.unitPriceMinor}) FROM ${orderItems} WHERE ${orderItems.orderId} = ${orders.id}), '')`

// ─── Admin filter fragments ──────────────────────────────────────────────────

export const NOT_ADMIN = ne(user.role, 'admin')
export const NOT_DRAFT = ne(events.status, 'draft')
export const VENDOR_PENDING = and(
  eq(user.role, 'vendor'),
  eq(user.vendorApprovalStatus, 'pending')
)
export const EVENT_PENDING = eq(events.status, 'in-review')
// A live event with an organizer edit awaiting admin approval.
export const EVENT_EDIT_PENDING = sql`${events.pendingChanges} IS NOT NULL`
export const REPORT_OPEN = eq(reports.status, 'open')
// A registration form waiting for an admin to approve its questions.
export const FORM_PENDING = eq(forms.status, 'pending_review')
export const PAID = eq(orders.status, 'paid')
