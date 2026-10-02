import { randomUUID } from 'node:crypto'

import { and, asc, eq, sql } from 'drizzle-orm'
import { tasks } from '@trigger.dev/sdk'

import {
  db,
  events,
  orderItems,
  orders,
  ticketTiers,
  tickets,
  vouchers,
} from '@ticketur/db'

import { formatEventDateRange } from './dates'
import type { FlutterwaveTransaction } from './flutterwave'
import {
  checkPaidAmount,
  PAYMENT_CURRENCY,
  toFlutterwaveAmount,
} from './payment-amount'
import { generateAndStoreTicketsPdf, ticketUrl } from './tickets-pdf'

// Re-exported so callers get the whole order/fulfillment surface from one
// module (the PDF helpers live in tickets-pdf for import-cycle reasons).
export { generateAndStoreTicketsPdf, ticketUrl }

// The tier ran out of stock between checkout and minting. Thrown by
// mintOrderTickets so each caller can react in its own way (checkout surfaces
// a CONFLICT to the buyer; fulfillment marks the order failed).
export class TicketStockError extends Error {
  constructor(public readonly tierName?: string) {
    super('Ticket stock no longer available')
    this.name = 'TicketStockError'
  }
}

// The tx handle drizzle hands to `db.transaction(async (tx) => …)`.
type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

// One ticket to mint, already resolved to its recipient. For "For Myself"
// orders every entry carries the buyer; for "For Multiple" each carries its
// own attendee.
export type MintTicket = {
  tierId: string
  // Only used for the friendly sold-out message.
  tierName?: string
  recipientName: string | null
  recipientEmail: string | null
}

// The one guarded ticket-minting path, shared by the free checkout flow and
// paid fulfillment. Takes a flat list — one entry per ticket — groups it by
// tier to bump tier.sold with a conditional update (`sold + n <= quantity`) so
// two concurrent claims can't oversell (a zero-row result means the tier just
// sold out), then mints one ticket row per entry carrying its recipient. Must
// run inside a transaction so the sold-bump and the ticket rows commit together
// with the caller's other writes.
export async function mintOrderTickets(
  tx: DbTransaction,
  args: {
    orderId: string
    eventId: string
    tickets: MintTicket[]
  }
): Promise<void> {
  if (args.tickets.length === 0) return

  // Count per tier for the oversell guard.
  const byTier = new Map<string, { count: number; tierName?: string }>()
  for (const t of args.tickets) {
    const entry = byTier.get(t.tierId) ?? { count: 0, tierName: t.tierName }
    entry.count += 1
    byTier.set(t.tierId, entry)
  }

  for (const [tierId, { count, tierName }] of byTier) {
    const updated = await tx
      .update(ticketTiers)
      .set({ sold: sql`${ticketTiers.sold} + ${count}` })
      .where(
        and(
          eq(ticketTiers.id, tierId),
          sql`${ticketTiers.sold} + ${count} <= ${ticketTiers.quantity}`
        )
      )
      .returning({ id: ticketTiers.id })
    if (updated.length === 0) {
      throw new TicketStockError(tierName)
    }
  }

  await tx.insert(tickets).values(
    args.tickets.map((t) => ({
      id: `tkt_${randomUUID()}`,
      orderId: args.orderId,
      eventId: args.eventId,
      tierId: t.tierId,
      code: randomUUID().replace(/-/g, ''),
      recipientName: t.recipientName,
      recipientEmail: t.recipientEmail,
    }))
  )
}

export type OrderWithDetails = NonNullable<
  Awaited<ReturnType<typeof loadOrderById>>
>

export async function loadOrderById(orderId: string) {
  const rows = await db
    .select({
      order: orders,
      event: events,
    })
    .from(orders)
    .innerJoin(events, eq(events.id, orders.eventId))
    .where(eq(orders.id, orderId))
    .limit(1)
  return rows[0] ?? null
}

// Line items for an order — one row per tier, cheapest first for stable
// display. Each line snapshots the tier name + unit price at purchase time.
export async function loadOrderItems(orderId: string) {
  return db
    .select({
      id: orderItems.id,
      tierId: orderItems.tierId,
      tierName: orderItems.tierName,
      unitPriceMinor: orderItems.unitPriceMinor,
      quantity: orderItems.quantity,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId))
    .orderBy(asc(orderItems.unitPriceMinor))
}

export type OrderItemRow = Awaited<ReturnType<typeof loadOrderItems>>[number]

// Tickets for an order, each carrying its own tier name (an order can span
// several tiers, so a single tier lookup per order is no longer correct).
export async function loadTicketsForOrder(orderId: string) {
  return db
    .select({
      id: tickets.id,
      orderId: tickets.orderId,
      eventId: tickets.eventId,
      tierId: tickets.tierId,
      tierName: ticketTiers.name,
      code: tickets.code,
      recipientName: tickets.recipientName,
      recipientEmail: tickets.recipientEmail,
      checkedIn: tickets.checkedIn,
      checkedInAt: tickets.checkedInAt,
      createdAt: tickets.createdAt,
    })
    .from(tickets)
    .leftJoin(ticketTiers, eq(ticketTiers.id, tickets.tierId))
    .where(eq(tickets.orderId, orderId))
    .orderBy(tickets.createdAt)
}

// The gateway's own record of a charge, as Flutterwave's verify endpoints
// return it. fulfillOrder takes this rather than a bare transaction id, so no
// caller can mark an order paid without handing over what was actually paid.
export type VerifiedCharge = Pick<
  FlutterwaveTransaction,
  'id' | 'tx_ref' | 'status' | 'amount' | 'currency' | 'charged_amount'
>

export type ChargeRejection = {
  reason:
    | 'not_successful'
    | 'tx_ref_mismatch'
    | 'currency_mismatch'
    | 'underpaid'
    | 'invalid_amount'
  // What we asked Flutterwave to charge for this order.
  expected: { amount: number; currency: string; txRef: string | null }
  // What the verified charge says was paid.
  received: {
    amount: number
    currency: string
    txRef: string
    status: string
    chargedAmount: number | null
  }
}

type OrderRow = typeof orders.$inferSelect

export type FulfillOrderResult =
  | { outcome: 'fulfilled'; order: OrderRow; justFulfilled: true }
  | { outcome: 'already_paid'; order: OrderRow; justFulfilled: false }
  | {
      outcome: 'rejected'
      order: OrderRow
      justFulfilled: false
      rejection: ChargeRejection
    }

// Checks a verified charge against the order it claims to pay for.
function assessCharge(
  order: OrderRow,
  charge: VerifiedCharge
):
  | { ok: true; overpaidMinor: number }
  | { ok: false; rejection: ChargeRejection } {
  const expected = {
    amount: toFlutterwaveAmount(order.totalMinor),
    currency: PAYMENT_CURRENCY,
    txRef: order.flwTxRef,
  }
  const received = {
    amount: charge.amount,
    currency: charge.currency,
    txRef: charge.tx_ref,
    status: charge.status,
    chargedAmount: charge.charged_amount ?? null,
  }
  const reject = (reason: ChargeRejection['reason']) => ({
    ok: false as const,
    rejection: { reason, expected, received },
  })

  if (charge.status !== 'successful') return reject('not_successful')
  if (!order.flwTxRef || charge.tx_ref !== order.flwTxRef) {
    return reject('tx_ref_mismatch')
  }
  const paid = checkPaidAmount({
    totalMinor: order.totalMinor,
    amount: charge.amount,
    currency: charge.currency,
  })
  if (!paid.ok) return reject(paid.reason)
  return { ok: true, overpaidMinor: paid.overpaidMinor }
}

// Idempotent: if the order is already paid it's a no-op.
// Bumps tier.sold per line and mints tickets per line in the same call.
//
// Every path that marks an order paid comes through here — the FW webhook,
// the /checkout/return page and the reconciliation job — and each must hand
// over the gateway's verified charge. The charge is checked under the row
// lock, against the locked row, before anything is minted: it must be
// successful, carry this order's tx_ref, be in NGN and cover what checkout
// asked Flutterwave to charge (see payment-amount.ts). A charge that fails
// the check fulfils nothing.
//
// Returns `justFulfilled: true` only when this call did the pending→paid
// transition. Side-effect callers (email, PDF) should gate on that flag so
// the work runs exactly once even when the FW webhook + return page both
// race in to fulfill.
export async function fulfillOrder({
  orderId,
  charge,
}: {
  orderId: string
  charge: VerifiedCharge
}): Promise<FulfillOrderResult | null> {
  const flwTransactionId = String(charge.id)

  return db.transaction(async (tx): Promise<FulfillOrderResult | null> => {
    // Lock the order row for the rest of this transaction so two concurrent
    // fulfillers (the FW webhook and the /checkout/return page) can't both
    // read status='pending' and both mint tickets. At READ COMMITTED the loser
    // blocks here until the winner commits, then re-reads the row and sees
    // status='paid', so it takes the already-fulfilled no-op branch below.
    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .for('update')
      .limit(1)
    if (!order) return null

    if (order.status === 'paid') {
      // Already fulfilled — no-op (webhook + return page can both arrive).
      // A *different* successful charge means the buyer paid twice for one
      // order. Nothing refunds that automatically, so it has to be seen.
      if (
        charge.status === 'successful' &&
        order.flwTransactionId !== null &&
        order.flwTransactionId !== flwTransactionId
      ) {
        console.error('[orders] second successful charge for a paid order', {
          orderId: order.id,
          paidByTransactionId: order.flwTransactionId,
          flwTransactionId,
          txRef: charge.tx_ref,
          amount: charge.amount,
          currency: charge.currency,
        })
      }
      return { outcome: 'already_paid', order, justFulfilled: false }
    }

    const assessment = assessCharge(order, charge)
    if (!assessment.ok) {
      // A successful charge carrying this order's own tx_ref that doesn't pay
      // for it: money reached Flutterwave against this order, but not the
      // right money. That is an underpayment, or a charge someone started
      // with our public key and this tx_ref for an amount or currency of
      // their choosing.
      //
      // Such an order is marked 'failed' rather than left 'pending', with the
      // offending charge stored in flw_transaction_id:
      //   - 'pending' means "awaiting payment", and it is what the
      //     reconciliation job re-checks. A charge's amount never changes, so
      //     re-checking it every 15 minutes would only repeat this log until
      //     the order aged out: noise, not new information.
      //   - 'failed' takes the order out of every automated path, which is
      //     right, because it needs a person to refund the charge or settle
      //     the difference. Find these orders with `status = 'failed' AND
      //     flw_transaction_id IS NOT NULL` (no other path stores a
      //     transaction id on an unpaid order), then look the charge up in
      //     the Flutterwave dashboard.
      //   - It doesn't strand a buyer who then pays properly. This function
      //     only short-circuits on 'paid', so a later charge that passes the
      //     check still fulfils the order from 'failed'.
      //   - The buyer sees a "payment not confirmed" screen instead of a
      //     processing screen that never resolves.
      // A charge that isn't successful, or that carries another tx_ref, says
      // nothing about this order's payment, so the order is left as it is.
      const { rejection } = assessment
      const chargeIsForThisOrder =
        rejection.reason !== 'not_successful' &&
        rejection.reason !== 'tx_ref_mismatch'
      let current = order
      if (
        chargeIsForThisOrder &&
        order.flwTransactionId === null &&
        (order.status === 'pending' || order.status === 'failed')
      ) {
        await tx
          .update(orders)
          .set({ status: 'failed', flwTransactionId })
          .where(eq(orders.id, order.id))
        current = { ...order, status: 'failed', flwTransactionId }
      }
      // Logged here, not by each caller, so the webhook, the return page and
      // the reconciliation job all record the same detail.
      console.error('[orders] verified charge does not pay for the order', {
        orderId: order.id,
        orderStatus: current.status,
        flwTransactionId,
        reason: rejection.reason,
        expected: rejection.expected,
        received: rejection.received,
      })
      return {
        outcome: 'rejected',
        order: current,
        justFulfilled: false,
        rejection,
      }
    }

    const items = await tx
      .select({
        tierId: orderItems.tierId,
        tierName: orderItems.tierName,
        quantity: orderItems.quantity,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, order.id))

    // Resolve who each ticket belongs to. A group order carries its attendees
    // (captured at checkout); a "for myself" order mints to the buyer, expanding
    // each tier line by quantity.
    const tierNameById = new Map(items.map((i) => [i.tierId, i.tierName]))
    const mint: MintTicket[] =
      order.attendees && order.attendees.length > 0
        ? order.attendees.map((a) => ({
            tierId: a.tierId,
            tierName: tierNameById.get(a.tierId),
            recipientName: a.name,
            recipientEmail: a.email,
          }))
        : items.flatMap((i) =>
            Array.from({ length: i.quantity }, () => ({
              tierId: i.tierId,
              tierName: i.tierName,
              recipientName: order.buyerName || null,
              recipientEmail: order.buyerEmail || null,
            }))
          )

    try {
      await mintOrderTickets(tx, {
        orderId: order.id,
        eventId: order.eventId,
        tickets: mint,
      })
    } catch (err) {
      if (err instanceof TicketStockError) {
        // Stock disappeared between checkout and fulfillment. Mark failed.
        await tx
          .update(orders)
          .set({ status: 'failed' })
          .where(eq(orders.id, order.id))
        throw new Error(
          'Stock no longer available for one of the selected tiers'
        )
      }
      throw err
    }

    // Count the voucher redemption now that payment succeeded. Unconditional:
    // the cap is enforced at checkout (validateVoucher), and the buyer has
    // already paid the discounted amount, so we honour it even in the rare
    // race where the voucher maxed out between checkout and payment.
    if (order.voucherId) {
      await tx
        .update(vouchers)
        .set({ redeemedCount: sql`${vouchers.redeemedCount} + 1` })
        .where(eq(vouchers.id, order.voucherId))
    }

    const paidAt = new Date()
    await tx
      .update(orders)
      .set({ status: 'paid', paidAt, flwTransactionId })
      .where(eq(orders.id, order.id))

    // Paid from 'failed' after an earlier charge was rejected: that charge's
    // id has just been overwritten above, and it still needs refunding.
    if (
      order.flwTransactionId !== null &&
      order.flwTransactionId !== flwTransactionId
    ) {
      console.error('[orders] paid order had an earlier rejected charge', {
        orderId: order.id,
        flwTransactionId,
        rejectedTransactionId: order.flwTransactionId,
      })
    }
    // Fulfilled anyway, per Flutterwave's guidance to give value and refund
    // the rest (see checkPaidAmount). The refund is manual.
    if (assessment.overpaidMinor > 0) {
      console.error('[orders] charge exceeds the amount requested', {
        orderId: order.id,
        flwTransactionId,
        requestedAmount: toFlutterwaveAmount(order.totalMinor),
        paidAmount: charge.amount,
        overpaidMinor: assessment.overpaidMinor,
      })
    }

    return {
      outcome: 'fulfilled',
      order: { ...order, status: 'paid' as const, paidAt, flwTransactionId },
      justFulfilled: true,
    }
  })
}

/**
 * Generate the PDF(s) + dispatch confirmation email(s) for a paid order.
 * The FW webhook, the /checkout/return page and the reconciliation job call
 * this — guarded by `justFulfilled` from `fulfillOrder` so it runs exactly
 * once.
 *
 * "For Myself" orders send one email to the buyer with a combined PDF. "For
 * Multiple" orders send each attendee their own email + a PDF scoped to just
 * their tickets — the multi-email distribution the feature is named for.
 */
export async function notifyOrderFulfilled({
  orderId,
  baseUrl,
}: {
  orderId: string
  baseUrl: string
}) {
  const head = await loadOrderById(orderId)
  if (!head) {
    // Fulfillment reached the notifier but the order row is gone — the buyer
    // has paid and there is nothing to email tickets from.
    console.error('[orders] cannot notify a fulfilled order with no row', {
      orderId,
    })
    return
  }

  const ticketRows = await loadTicketsForOrder(orderId)
  if (ticketRows.length === 0) {
    // Order is paid but no tickets were minted. The buyer is charged and will
    // never receive tickets; previously this returned silently.
    console.error('[orders] paid order has no tickets to deliver', {
      orderId,
      eventId: head.order.eventId,
    })
    return
  }

  // Group tickets by recipient (email = identity). A "for myself" order
  // collapses to a single group: the buyer.
  type Recipient = {
    name: string
    email: string
    firstCode: string
    tiers: Map<string, number>
    count: number
  }
  const recipients = new Map<string, Recipient>()
  for (const t of ticketRows) {
    const email = t.recipientEmail || head.order.buyerEmail
    const name = t.recipientName || head.order.buyerName || 'there'
    const r =
      recipients.get(email) ??
      ({ name, email, firstCode: t.code, tiers: new Map(), count: 0 } as Recipient)
    const tierName = t.tierName ?? 'General'
    r.tiers.set(tierName, (r.tiers.get(tierName) ?? 0) + 1)
    r.count += 1
    recipients.set(email, r)
  }

  const isGroup =
    recipients.size > 1 || (head.order.attendees?.length ?? 0) > 0
  const eventDate = formatEventDateRange(
    head.event.eventDate,
    head.event.endDate
  )

  for (const r of recipients.values()) {
    let pdfUrl: string | null = null
    try {
      pdfUrl = await generateAndStoreTicketsPdf({
        orderId,
        baseUrl,
        // Self order → one combined PDF recorded on the order. Group order →
        // a PDF scoped to just this attendee's tickets.
        recipientEmail: isGroup ? r.email : undefined,
      })
    } catch (err) {
      // Which recipient's PDF failed was unrecoverable before; the buyer still
      // gets the email, so this is the only trace of a missing attachment.
      console.error('[orders] ticket PDF generation failed', {
        orderId,
        eventId: head.event.id,
        recipientCount: recipients.size,
        error: err,
      })
    }

    const items = [...r.tiers.entries()].map(([tierName, quantity]) => ({
      tierName,
      quantity,
    }))
    const summaryLabel = items
      .map((i) => `${i.quantity}× ${i.tierName}`)
      .join(', ')

    void tasks.trigger('send-ticket-confirmation', {
      email: r.email,
      firstName: r.name.split(' ')[0] ?? r.name,
      eventTitle: head.event.title,
      eventDate,
      eventTime: head.event.eventTime,
      eventLocation: head.event.location,
      ticketTier: summaryLabel || 'Ticket',
      items,
      quantity: r.count,
      // Self order links to the full order view; a group attendee links to
      // their own ticket (they shouldn't see the rest of the order).
      ticketsUrl: isGroup
        ? ticketUrl(baseUrl, r.firstCode)
        : `${baseUrl}/tickets/${head.order.id}`,
      pdfUrl: pdfUrl ?? undefined,
      pdfFilename: pdfUrl ? `${head.event.title}-tickets.pdf` : undefined,
    })
  }
}
