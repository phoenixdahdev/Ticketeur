import { TRPCError } from '@trpc/server'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'

import { events, orders, orderItems, ticketTiers, user, vouchers } from '@ticketur/db'

import { createTRPCRouter, publicProcedure } from '../../trpc'
import { newId } from '../../lib/ids'
import { getBaseUrl } from '../../lib/base-url'
import { createPayment } from '../../lib/flutterwave'
import {
  mintOrderTickets,
  notifyOrderFulfilled,
  TicketStockError,
  type MintTicket,
} from '../../lib/orders'
import { calculateFeeMinor } from '../../lib/fees'
import { getTicketFeeBps } from '../../lib/platform-settings'
import { PAYMENT_CURRENCY, toFlutterwaveAmount } from '../../lib/payment-amount'
import { hasEnded } from '../../lib/predicates'
import { validateVoucher } from '../../lib/vouchers'

const MAX_TICKETS_PER_ORDER = 50

const attendeeInput = z.object({
  name: z.string().trim().min(1, 'Attendee name required'),
  email: z.email('Enter a valid attendee email'),
  tierId: z.string(),
})

// A cart is one or more tier lines. Two modes:
//   self  — buyer picks quantities per tier; every ticket is theirs.
//   group — buyer names each attendee (name + email + tier); each ticket is
//           minted to and emailed to that attendee ("multi-email distribution").
const startInput = z
  .object({
    eventId: z.string(),
    mode: z.enum(['self', 'group']).default('self'),
    items: z
      .array(
        z.object({
          tierId: z.string(),
          quantity: z.number().int().min(1).max(MAX_TICKETS_PER_ORDER),
        })
      )
      .max(20, 'Too many tiers in one order')
      .optional(),
    attendees: z.array(attendeeInput).max(MAX_TICKETS_PER_ORDER).optional(),
    buyerName: z.string().trim().min(1, 'Name required'),
    buyerEmail: z.email('Enter a valid email'),
    buyerPhone: z.string().trim().min(7, 'Phone required'),
    voucherCode: z.string().trim().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.mode === 'self' && !(v.items && v.items.length > 0)) {
      ctx.addIssue({
        code: 'custom',
        path: ['items'],
        message: 'Select at least one ticket',
      })
    }
    if (v.mode === 'group' && !(v.attendees && v.attendees.length > 0)) {
      ctx.addIssue({
        code: 'custom',
        path: ['attendees'],
        message: 'Add at least one attendee',
      })
    }
  })

export const publicCheckoutRouter = createTRPCRouter({
  start: publicProcedure.input(startInput).mutation(async ({ ctx, input }) => {
    const baseUrl = getBaseUrl()

    // Per-tier quantity, derived from items (self) or attendee counts (group).
    const mergedQty = new Map<string, number>()
    if (input.mode === 'group') {
      for (const a of input.attendees ?? []) {
        mergedQty.set(a.tierId, (mergedQty.get(a.tierId) ?? 0) + 1)
      }
    } else {
      for (const item of input.items ?? []) {
        mergedQty.set(
          item.tierId,
          (mergedQty.get(item.tierId) ?? 0) + item.quantity
        )
      }
    }
    const totalQuantity = [...mergedQty.values()].reduce((a, b) => a + b, 0)
    if (totalQuantity < 1) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Select at least one ticket',
      })
    }
    if (totalQuantity > MAX_TICKETS_PER_ORDER) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `You can buy at most ${MAX_TICKETS_PER_ORDER} tickets per order.`,
      })
    }

    // ── Validate event + tiers and price the cart (reads only) ──────────────
    const [event] = await ctx.db
      .select({
        id: events.id,
        title: events.title,
        eventDate: events.eventDate,
        endDate: events.endDate,
        eventTime: events.eventTime,
        location: events.location,
        status: events.status,
      })
      .from(events)
      .where(eq(events.id, input.eventId))
      .limit(1)
    if (!event) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Event not found' })
    }
    if (event.status !== 'upcoming') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Event is not on sale' })
    }
    // A finished event keeps status 'upcoming' — nothing sweeps the table to
    // retire events, so the status check above does not cover it. Without this,
    // a stale page or a direct API call can still buy tickets for an event that
    // ended months ago.
    if (hasEnded(event)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'This event has already ended.',
      })
    }

    const tierIds = [...mergedQty.keys()]
    const tierRows = await ctx.db
      .select({
        id: ticketTiers.id,
        name: ticketTiers.name,
        quantity: ticketTiers.quantity,
        sold: ticketTiers.sold,
        priceMinor: ticketTiers.priceMinor,
      })
      .from(ticketTiers)
      .where(
        and(eq(ticketTiers.eventId, event.id), inArray(ticketTiers.id, tierIds))
      )
    const tierById = new Map(tierRows.map((t) => [t.id, t]))

    // Stock pre-check for friendly per-tier messages. The conditional UPDATE at
    // mint time is the real oversell guard.
    const lines = tierIds.map((tierId) => {
      const tier = tierById.get(tierId)
      if (!tier) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'One of the selected tiers is unavailable',
        })
      }
      const quantity = mergedQty.get(tierId)!
      const remaining = tier.quantity - tier.sold
      if (remaining < quantity) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            remaining <= 0
              ? `${tier.name} is sold out — sorry!`
              : `Only ${remaining} ${tier.name} ticket${remaining === 1 ? '' : 's'} left.`,
        })
      }
      return { tier, quantity, lineSubtotal: tier.priceMinor * quantity }
    })

    const subtotalMinor = lines.reduce((s, l) => s + l.lineSubtotal, 0)

    // ── Voucher (optional) ──────────────────────────────────────────────────
    let discountMinor = 0
    let voucherId: string | null = null
    if (input.voucherCode) {
      const result = await validateVoucher(ctx.db, {
        eventId: event.id,
        code: input.voucherCode,
        subtotalMinor,
      })
      if (!result.ok) {
        const message =
          result.reason === 'expired'
            ? 'That voucher has expired.'
            : result.reason === 'maxed'
              ? 'That voucher has reached its redemption limit.'
              : result.reason === 'not_started'
                ? 'That voucher is not active yet.'
                : 'That voucher code is not valid for this event.'
        throw new TRPCError({ code: 'BAD_REQUEST', message })
      }
      discountMinor = result.discountMinor
      voucherId = result.voucher.id
    }

    const discountedSubtotal = Math.max(0, subtotalMinor - discountMinor)
    // The rate is read here, from the database, every time. Whatever the
    // buyer's page was showing is irrelevant: the client never sends a fee or
    // a total (look at startInput — there is no money in it), so a stale rate
    // in a long-open tab can only make the preview wrong, never the charge.
    // This figure is the one stored on the order and the one Flutterwave is
    // asked for.
    const feeMinor = calculateFeeMinor(
      discountedSubtotal,
      await getTicketFeeBps(ctx.db)
    )
    const totalMinor = discountedSubtotal + feeMinor
    const isFree = totalMinor === 0

    const orderId = newId('ord')
    const txRef = `tckt_${orderId}_${Date.now()}`

    // Recipients for each ticket: the buyer (self) or each attendee (group).
    const buildMintTickets = (): MintTicket[] =>
      input.mode === 'group'
        ? (input.attendees ?? []).map((a) => ({
            tierId: a.tierId,
            tierName: tierById.get(a.tierId)?.name,
            recipientName: a.name,
            recipientEmail: a.email,
          }))
        : lines.flatMap((l) =>
            Array.from({ length: l.quantity }, () => ({
              tierId: l.tier.id,
              tierName: l.tier.name,
              recipientName: input.buyerName,
              recipientEmail: input.buyerEmail,
            }))
          )

    // ── Persist order (+ mint immediately when free) ────────────────────────
    await ctx.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, input.buyerEmail))
        .limit(1)

      await tx.insert(orders).values({
        id: orderId,
        type: 'ticket',
        eventId: event.id,
        tierId: null,
        buyerId: existing?.id ?? null,
        buyerEmail: input.buyerEmail,
        buyerName: input.buyerName,
        buyerPhone: input.buyerPhone,
        quantity: totalQuantity,
        subtotalMinor,
        discountMinor,
        feeMinor,
        totalMinor,
        voucherId,
        // Persist attendees so a paid group order can mint to them at webhook
        // fulfillment (tickets aren't minted until payment for paid orders).
        attendees:
          input.mode === 'group' ? (input.attendees ?? []) : null,
        status: isFree ? 'paid' : 'pending',
        flwTxRef: isFree ? null : txRef,
        paidAt: isFree ? new Date() : null,
      })

      await tx.insert(orderItems).values(
        lines.map((l) => ({
          id: newId('oi'),
          orderId,
          tierId: l.tier.id,
          tierName: l.tier.name,
          unitPriceMinor: l.tier.priceMinor,
          quantity: l.quantity,
        }))
      )

      if (isFree) {
        try {
          await mintOrderTickets(tx, {
            orderId,
            eventId: event.id,
            tickets: buildMintTickets(),
          })
        } catch (err) {
          if (err instanceof TicketStockError) {
            throw new TRPCError({
              code: 'CONFLICT',
              message: `${err.tierName ?? 'A ticket tier'} just sold out — please try again.`,
            })
          }
          throw err
        }
        if (voucherId) {
          await tx
            .update(vouchers)
            .set({ redeemedCount: sql`${vouchers.redeemedCount} + 1` })
            .where(eq(vouchers.id, voucherId))
        }
      }
    })

    if (isFree) {
      // Free path — fulfilled in-line. Reuse the shared notifier so self orders
      // get one combined email and group orders get per-attendee delivery.
      await notifyOrderFulfilled({ orderId, baseUrl })
      return { orderId, txRef: null, paymentUrl: null, free: true }
    }

    // Paid path — hand off to Flutterwave. Amount in whole naira, converted by
    // the same helper fulfilment verifies the charge against, so what we ask
    // for and what we accept cannot drift apart.
    const summaryLabel = lines
      .map((l) => `${l.quantity}× ${l.tier.name}`)
      .join(', ')
    const { link } = await createPayment({
      txRef,
      amount: toFlutterwaveAmount(totalMinor),
      currency: PAYMENT_CURRENCY,
      redirectUrl: `${baseUrl}/checkout/return`,
      customer: {
        email: input.buyerEmail,
        name: input.buyerName,
        phonenumber: input.buyerPhone,
      },
      meta: { orderId, eventId: input.eventId },
      customizations: {
        title: event.title,
        description: `${totalQuantity} ticket${totalQuantity === 1 ? '' : 's'} — ${summaryLabel}`,
      },
    })

    return { orderId, txRef, paymentUrl: link, free: false }
  }),
})

export type PublicCheckoutRouter = typeof publicCheckoutRouter
