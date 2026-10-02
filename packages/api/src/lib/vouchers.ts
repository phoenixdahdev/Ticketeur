import { and, eq, isNull, or, sql } from 'drizzle-orm'

import type { Database, VoucherDiscountType } from '@ticketur/db'
import { events, vouchers } from '@ticketur/db'

// Why a voucher didn't apply — surfaced to the buyer so the "Apply" UI can
// show a precise message instead of a generic failure.
export type VoucherInvalidReason =
  'not_found' | 'inactive' | 'not_started' | 'expired' | 'maxed'

export type VoucherValidation =
  | {
      ok: true
      voucher: typeof vouchers.$inferSelect
      discountMinor: number
    }
  | { ok: false; reason: VoucherInvalidReason }

/**
 * The discount a voucher yields on a given subtotal, in minor units.
 * `percent` stores basis points (2000 = 20%), the same unit the platform
 * service-fee rates use (lib/fees.ts);
 * `fixed` stores minor units directly. Never exceeds the subtotal and never
 * goes negative.
 */
export function computeDiscountMinor(
  discountType: VoucherDiscountType,
  discountValue: number,
  subtotalMinor: number
): number {
  if (subtotalMinor <= 0) return 0
  const raw =
    discountType === 'percent'
      ? Math.round((subtotalMinor * discountValue) / 10_000)
      : discountValue
  return Math.max(0, Math.min(raw, subtotalMinor))
}

/**
 * Resolve a voucher code for a checkout on `eventId` and compute its discount.
 *
 * Two owners can supply a code: the event's own organizer, or the platform
 * (an admin-created voucher, `organizerId` NULL, valid on any event). Either
 * may additionally be scoped to a single event or left open to all.
 *
 * Each owner can hold at most one row per code — the (organizerId, lower(code))
 * index enforces that per organizer, and the partial index on lower(code) WHERE
 * organizerId IS NULL does the same for the platform. So a code matches at most
 * two rows here: the organizer's and the platform's. The organizer's wins, and
 * a platform-wide promo can therefore never quietly override what an organizer
 * set up for their own event. (The secondary sort on eventId is defensive; with
 * one row per owner per code it is never the deciding factor.)
 *
 * Validity — active, window, redemption cap — is checked on the winner only. A
 * spent organizer code does not silently fall through to a platform code, which
 * would surprise the buyer and the organizer alike.
 */
export async function validateVoucher(
  db: Database,
  args: { eventId: string; code: string; subtotalMinor: number; now?: Date }
): Promise<VoucherValidation> {
  const code = args.code.trim()
  if (!code) return { ok: false, reason: 'not_found' }

  const [event] = await db
    .select({ organizerId: events.organizerId })
    .from(events)
    .where(eq(events.id, args.eventId))
    .limit(1)
  if (!event) return { ok: false, reason: 'not_found' }

  const [voucher] = await db
    .select()
    .from(vouchers)
    .where(
      and(
        // The event's organizer, or the platform (organizerId NULL).
        or(
          eq(vouchers.organizerId, event.organizerId),
          isNull(vouchers.organizerId)
        ),
        sql`lower(${vouchers.code}) = lower(${code})`,
        or(isNull(vouchers.eventId), eq(vouchers.eventId, args.eventId))
      )
    )
    // Owner first (organizer's own before platform), then scope (this event
    // before all-events). Booleans sort false < true, so IS NULL ascending
    // puts the more specific row first.
    .orderBy(
      sql`(${vouchers.organizerId} IS NULL) ASC`,
      sql`(${vouchers.eventId} IS NULL) ASC`
    )
    .limit(1)
  if (!voucher) return { ok: false, reason: 'not_found' }
  if (!voucher.active) return { ok: false, reason: 'inactive' }

  const now = args.now ?? new Date()
  if (voucher.validFrom && now < voucher.validFrom) {
    return { ok: false, reason: 'not_started' }
  }
  if (voucher.validUntil && now > voucher.validUntil) {
    return { ok: false, reason: 'expired' }
  }
  if (
    voucher.maxRedemptions != null &&
    voucher.redeemedCount >= voucher.maxRedemptions
  ) {
    return { ok: false, reason: 'maxed' }
  }

  return {
    ok: true,
    voucher,
    discountMinor: computeDiscountMinor(
      voucher.discountType,
      voucher.discountValue,
      args.subtotalMinor
    ),
  }
}
