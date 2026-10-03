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
import { sendSubmissionConfirmation } from './form-emails'
import {
  creditRegistrationFee,
  releaseUnpaidSubmission,
  type RegistrationCredit,
  type RegistrationCreditFailure,
} from './form-payments'
import {
  checkPaidAmount,
  PAYMENT_CURRENCY,
  toFlutterwaveAmount,
} from './payment-amount'
import {
  chargeAmountMinor,
  recordDiscrepancy,
  recordDiscrepancyStandalone,
  type DiscrepancyInput,
} from './payment-discrepancies'
import { generateAndStoreTicketsPdf, ticketUrl } from './tickets-pdf'
import { sendVotePurchaseReceipt } from './vote-emails'
import {
  creditVotePurchase,
  type VoteCreditFailure,
  type VotePurchaseCredit,
} from './votes'

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

// A verified charge pays for the order, but fulfillOrder can't deliver what
// the order is for: a type with no fulfilment yet (vendor_fee), a
// registration fee whose submission can't be found, or a vote purchase whose
// contest can't be found.
// Thrown out of fulfillOrder's transaction, so nothing is written and the
// order stays as it was for a person to settle. Every caller already treats
// a throw that way: the webhook refuses the call, the return page shows the
// processing screen, and the reconciliation job counts an error.
export class OrderNotFulfillableError extends Error {
  constructor(
    public readonly orderId: string,
    public readonly orderType: string,
    public readonly reason:
      'unsupported_type' | RegistrationCreditFailure | VoteCreditFailure
  ) {
    super(`Order ${orderId} (${orderType}) cannot be fulfilled: ${reason}`)
    this.name = 'OrderNotFulfillableError'
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

// What a fulfilment delivered, by order type.
export type FulfilmentCredit =
  | { kind: 'tickets' }
  | ({ kind: 'registration' } & RegistrationCredit)
  | ({ kind: 'votes' } & VotePurchaseCredit)

export type FulfillOrderResult =
  | {
      outcome: 'fulfilled'
      order: OrderRow
      justFulfilled: true
      credit: FulfilmentCredit
    }
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

// The identifying half of a payment_discrepancies row: who paid, against
// which order, with which Flutterwave charge, and for how much. Each branch
// below adds only `kind`, `owedMinor`, `reason` and `detail`.
//
// Everything here is copied, not referenced. orders.flw_transaction_id in
// particular is overwritten when an order goes failed → paid, so a rejected
// charge's id survives only on its own record.
function discrepancyFacts(
  order: OrderRow,
  charge: VerifiedCharge
): Omit<DiscrepancyInput, 'kind' | 'owedMinor' | 'reason' | 'detail'> {
  return {
    orderId: order.id,
    orderType: order.type,
    eventId: order.eventId,
    buyerEmail: order.buyerEmail,
    buyerName: order.buyerName,
    flwTxRef: order.flwTxRef,
    flwTransactionId: String(charge.id),
    // What checkout asked Flutterwave to charge (whole naira, in kobo) —
    // the figure the charge was actually assessed against, not totalMinor.
    expectedMinor: toFlutterwaveAmount(order.totalMinor) * 100,
    paidMinor: chargeAmountMinor(charge.amount),
    paidCurrency:
      typeof charge.currency === 'string' ? charge.currency.toUpperCase() : '',
  }
}

// Idempotent: if the order is already paid it's a no-op.
//
// Every path that marks an order paid comes through here — the FW webhook,
// the /checkout/return page and the reconciliation job — and each must hand
// over the gateway's verified charge. The charge is checked under the row
// lock, against the locked row, before anything is delivered: it must be
// successful, carry this order's tx_ref, be in NGN and cover what checkout
// asked Flutterwave to charge (see payment-amount.ts). A charge that fails
// the check fulfils nothing.
//
// What is delivered depends on the order's type, read from the same locked
// row, and is decided only after the check (deliverOrder): a 'ticket' order
// bumps tier.sold and mints its tickets, a 'registration_fee' order completes
// its submission, a 'vote_purchase' order grants its buyer vote credits for
// the contest. 'vendor_fee' has no fulfilment yet and is refused with
// OrderNotFulfillableError, never minted as tickets. The check runs for every
// type because it comes first, and no per-type step is exported or called
// from anywhere else.
//
// Returns `justFulfilled: true` only when this call did the pending→paid
// transition. Side-effect callers (email, PDF) should gate on that flag so
// the work runs exactly once even when the FW webhook + return page both
// race in to fulfill; notifyFulfilment does.
export async function fulfillOrder({
  orderId,
  charge,
}: {
  orderId: string
  charge: VerifiedCharge
}): Promise<FulfillOrderResult | null> {
  // Hand-off from runFulfilment, which fills `order` in once the charge has
  // been checked and found to pay for this order. Plain JS state, so it
  // survives the transaction rolling back — and a rollback after that point
  // is precisely the known hole: the tier sold out between payment and
  // minting (or the order couldn't be delivered at all), so the buyer is
  // charged, holds nothing, and the order is left as it was. This catch is
  // the only place left that can write that down, because everything inside
  // the transaction is gone.
  const assessed: { order: OrderRow | null } = { order: null }

  try {
    return await runFulfilment(orderId, charge, assessed)
  } catch (err) {
    const order = assessed.order
    if (order) {
      // Own transaction (the fulfilment one is rolled back), idempotent on
      // (order, charge, kind) — the reconciliation job re-presents this same
      // charge every 15 minutes for 48 hours and must not pile up records.
      // Never throws, so the caller still sees the real error below: the
      // webhook refuses with a 4xx, the return page shows "processing", the
      // reconciliation job counts an error. Unchanged, all of them.
      await recordDiscrepancyStandalone({
        ...discrepancyFacts(order, charge),
        kind: 'undelivered',
        owedMinor: chargeAmountMinor(charge.amount),
        reason:
          err instanceof OrderNotFulfillableError
            ? err.reason
            : 'fulfilment_failed',
        detail: err instanceof Error ? err.message.slice(0, 500) : '',
      })
    }
    throw err
  }
}

// fulfillOrder's transaction. Split out only so fulfillOrder can wrap it: the
// locking, the charge assessment and the delivery below are unchanged.
async function runFulfilment(
  orderId: string,
  charge: VerifiedCharge,
  assessed: { order: OrderRow | null }
): Promise<FulfillOrderResult | null> {
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
        // Only when the charge carries this order's own tx_ref: one that
        // doesn't says nothing about this order's payment, exactly as in
        // assessCharge. The whole second charge is owed back — the order was
        // already paid in full by another one.
        //
        // This branch is reached on *every* repeat of that charge (webhook
        // retries, the return page, every reconciliation run), so the row
        // lock gives no protection here at all; the unique index on
        // (order, charge, kind) is what makes it one record.
        if (order.flwTxRef && charge.tx_ref === order.flwTxRef) {
          await recordDiscrepancy(tx, {
            ...discrepancyFacts(order, charge),
            kind: 'duplicate_charge',
            owedMinor: chargeAmountMinor(charge.amount),
            reason: 'already_paid',
            detail: `Order was already paid by transaction ${order.flwTransactionId}.`,
          })
        }
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
      // A registration fee this charge didn't cover: the submission's spot is
      // released in the same transaction that fails the order. Idempotent, so
      // a repeat of this rejection releases nothing more; and a later charge
      // that does cover the fee still completes the submission.
      if (
        chargeIsForThisOrder &&
        current.status === 'failed' &&
        order.type === 'registration_fee'
      ) {
        await releaseUnpaidSubmission(
          tx,
          { orderId: order.id },
          'payment_rejected'
        )
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
      // `status = 'failed' AND flw_transaction_id IS NOT NULL` finds these by
      // query, but only until the buyer pays properly: fulfilling from
      // 'failed' overwrites flw_transaction_id with the good charge's id and
      // the rejected one — money we are still holding — disappears from the
      // row entirely. It also carries no amounts, no detected-at and nowhere
      // to say the refund was made, so an admin would re-work it forever.
      // Hence its own record, the same as an overpayment's.
      if (chargeIsForThisOrder) {
        await recordDiscrepancy(tx, {
          ...discrepancyFacts(order, charge),
          kind: 'rejected_charge',
          // Nothing was delivered, so the whole charge is owed back.
          owedMinor: chargeAmountMinor(charge.amount),
          reason: rejection.reason,
          detail: '',
        })
      }
      return {
        outcome: 'rejected',
        order: current,
        justFulfilled: false,
        rejection,
      }
    }

    // Only a charge that pays for this order gets here, whatever its type:
    // the type decides what is delivered, never whether the charge is checked.
    //
    // Recorded before anything is delivered, because this is the last point
    // at which we know the money is good: from here on a throw rolls the
    // whole transaction back, and fulfillOrder's catch reads this to write
    // the charge down as paid-but-undelivered.
    assessed.order = order
    const credit = await deliverOrder(tx, order, flwTransactionId)

    const paidAt = new Date()
    await tx
      .update(orders)
      .set({ status: 'paid', paidAt, flwTransactionId })
      .where(eq(orders.id, order.id))

    // Paid from 'failed' after an earlier charge was rejected: that charge's
    // id has just been overwritten above, and it still needs refunding.
    // That earlier charge already has its own 'rejected_charge' record from
    // the branch above, written when it was rejected — which is the reason
    // that record exists, since its id is gone from the row as of this line.
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
      // Only the excess is owed: the buyer keeps what they bought. Written in
      // this transaction, so it commits with the fulfilment it describes and
      // no crash can land one without the other — but inside a SAVEPOINT, so
      // a failure here rolls back only itself and the buyer is still served
      // (see recordDiscrepancy). Reached only on the pending→paid transition,
      // which the row lock lets exactly one caller take.
      await recordDiscrepancy(tx, {
        ...discrepancyFacts(order, charge),
        kind: 'overpayment',
        owedMinor: assessment.overpaidMinor,
        reason: 'overpaid',
        detail: '',
      })
    }

    return {
      outcome: 'fulfilled',
      order: { ...order, status: 'paid' as const, paidAt, flwTransactionId },
      justFulfilled: true,
      credit,
    }
  })
}

// Deliver what a paid order is for. Called only by fulfillOrder, inside its
// transaction, holding the order row lock, after the charge has passed
// assessCharge; deliberately not exported, so nothing can deliver without
// that check. Throws to refuse: the transaction rolls back and the order is
// left untouched.
async function deliverOrder(
  tx: DbTransaction,
  order: OrderRow,
  flwTransactionId: string
): Promise<FulfilmentCredit> {
  const refuse = (reason: OrderNotFulfillableError['reason']) => {
    // Money reached us for this order and nothing was delivered for it, so it
    // has to be seen: the order needs a person to settle or refund it.
    console.error('[orders] paid order cannot be fulfilled', {
      orderId: order.id,
      orderType: order.type,
      referenceId: order.referenceId,
      flwTransactionId,
      reason,
    })
    return new OrderNotFulfillableError(order.id, order.type, reason)
  }

  switch (order.type) {
    case 'ticket':
      await mintTicketsForOrder(tx, order)
      return { kind: 'tickets' }

    case 'registration_fee': {
      const result = await creditRegistrationFee(tx, order)
      if (!result.ok) throw refuse(result.reason)
      return { kind: 'registration', ...result.credit }
    }

    case 'vote_purchase': {
      // Grants the buyer a vote-credit BALANCE for the contest named in
      // `referenceId`; `quantity` is the number of votes, snapshotted at
      // checkout. Safe to reach twice: the pending→paid transition this
      // transaction performs is the once-only token, and grantVoteCredits
      // re-checks it under the same row lock (see lib/votes.ts).
      const result = await creditVotePurchase(tx, order)
      if (!result.ok) throw refuse(result.reason)

      if (result.credit.unusable) {
        // The contest stopped accepting votes between the payment link and
        // this charge clearing. The credits are real and can never be spent,
        // so the whole charge is owed back. Recorded here, inside the same
        // transaction as the credit, through recordDiscrepancy's SAVEPOINT —
        // which never throws, so a failure to book the obligation can never
        // roll back a payment we have already accepted.
        await recordDiscrepancy(tx, {
          kind: 'votes_unusable',
          orderId: order.id,
          orderType: 'vote_purchase',
          eventId: order.eventId,
          buyerEmail: order.buyerEmail,
          buyerName: order.buyerName,
          flwTxRef: order.flwTxRef,
          flwTransactionId,
          expectedMinor: order.totalMinor,
          // The charge cleared its amount check, so it paid at least this.
          // Any excess above it already has its own 'overpayment' row and is
          // not owed twice.
          paidMinor: order.totalMinor,
          paidCurrency: PAYMENT_CURRENCY,
          owedMinor: order.totalMinor,
          reason: 'voting_closed',
          detail: `${result.credit.votesGranted} vote${result.credit.votesGranted === 1 ? '' : 's'} bought for “${result.credit.contestTitle}”, which had stopped accepting votes by the time the payment cleared. The credits cannot be spent, so the whole charge is owed back.`,
        })
      }

      return { kind: 'votes', ...result.credit }
    }

    // Not built yet. This must never fall through to minting tickets that
    // were never bought: refused, and left for a person, until it has its
    // own case here.
    case 'vendor_fee':
      throw refuse('unsupported_type')

    default: {
      // The column is plain text, so it can hold a type this code doesn't
      // know. Refused the same way. (Also a compile-time check that every
      // OrderType has a case above.)
      const unhandled: never = order.type
      void unhandled
      throw refuse('unsupported_type')
    }
  }
}

// A ticket order's fulfilment, unchanged from before order types existed:
// bump tier.sold and mint one ticket per seat, then count the voucher.
async function mintTicketsForOrder(
  tx: DbTransaction,
  order: OrderRow
): Promise<void> {
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
      throw new Error('Stock no longer available for one of the selected tiers')
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
}

/**
 * The side effects of a fulfilment, for every order type: the ticket PDF and
 * email for a ticket order, the confirmation email for a registration fee,
 * nothing (yet) for a vote purchase.
 * The FW webhook, the /checkout/return page and the reconciliation job each
 * call this with fulfillOrder's result. It does nothing unless that call did
 * the pending→paid transition (`justFulfilled`), so when they race, the
 * notification still goes out exactly once.
 */
export async function notifyFulfilment(
  result: FulfillOrderResult,
  baseUrl: string
): Promise<void> {
  if (!result.justFulfilled) return
  const { credit } = result
  switch (credit.kind) {
    case 'tickets':
      await notifyOrderFulfilled({ orderId: result.order.id, baseUrl })
      return
    case 'registration':
      // Only when this payment completed the submission: a payment recorded
      // against one already decided changes nothing to tell the applicant.
      if (credit.completed) {
        await sendSubmissionConfirmation(credit.submissionId, { baseUrl })
      }
      return
    case 'votes':
      // The receipt. It also carries the bad news when the contest stopped
      // accepting votes before the charge cleared: the credits exist, cannot
      // be spent, and the money is owed back (deliverOrder has already put
      // that on the Refunds Owed screen).
      await sendVotePurchaseReceipt(result.order.id, {
        baseUrl,
        votesGranted: credit.votesGranted,
        votesRemaining: credit.purchased - credit.spent,
        unusable: credit.unusable,
      })
      return
  }
}

/**
 * Generate the PDF(s) + dispatch confirmation email(s) for a paid ticket
 * order. Reached through notifyFulfilment (the FW webhook, the
 * /checkout/return page and the reconciliation job), guarded by
 * `justFulfilled` from `fulfillOrder` so it runs exactly once, and directly
 * by free checkout.
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
  if (head.order.type !== 'ticket') {
    // Only ticket orders have tickets to send; notifyFulfilment routes the
    // other types to their own notification.
    console.error('[orders] ticket notifier called for a non-ticket order', {
      orderId,
      orderType: head.order.type,
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
      ({
        name,
        email,
        firstCode: t.code,
        tiers: new Map(),
        count: 0,
      } as Recipient)
    const tierName = t.tierName ?? 'General'
    r.tiers.set(tierName, (r.tiers.get(tierName) ?? 0) + 1)
    r.count += 1
    recipients.set(email, r)
  }

  const isGroup = recipients.size > 1 || (head.order.attendees?.length ?? 0) > 0
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
