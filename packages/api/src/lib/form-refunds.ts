// Money owed back when an organizer rejects an application whose fee was paid.
//
// The platform does not keep it. Rejecting releases the applicant's spot and
// leaves them holding nothing, so the whole fee they paid becomes a refund
// obligation on the Refunds Owed screen (payment_discrepancies), for an admin
// to issue by hand in Flutterwave. Nothing here refunds anything, and nothing
// here calls Flutterwave — the same rule the rest of that table lives by.
//
// This is the only writer of payment_discrepancies outside fulfilment, and it
// keeps fulfilment's two rules:
//
//   1. Recording must never block the decision it describes. An organizer's
//      rejection stands even if this write fails: every function here swallows
//      its own failure, logging everything the row would have held — exactly
//      what the code did before the table existed.
//   2. One charge produces one record, kept by the unique index on
//      (order_id, flw_transaction_id, kind) with ON CONFLICT DO NOTHING.
//      See the idempotency note on recordRejectionRefund.

import { and, eq } from 'drizzle-orm'

import {
  orders,
  paymentDiscrepancies,
  type OrderStatus,
  type PaymentDiscrepancyKind,
} from '@ticketur/db'

import { recordDiscrepancy } from './payment-discrepancies'
import { PAYMENT_CURRENCY, toFlutterwaveAmount } from './payment-amount'
import type { DbTransaction } from './forms'

// The one kind this file writes. Named apart from fulfilment's kinds on
// purpose: see the comment on PaymentDiscrepancyKind in packages/db.
const KIND: PaymentDiscrepancyKind = 'registration_rejected'

// Machine-readable cause, stored in `reason`. The admin screen labels it.
const REASON = 'application_rejected'

// A paid registration fee: everything a refund record needs about the money,
// copied off the order rather than referenced, the same as discrepancyFacts in
// orders.ts. The record has to read correctly with the order gone.
export type PaidRegistrationFee = {
  orderId: string
  eventId: string
  buyerEmail: string
  buyerName: string
  flwTxRef: string | null
  flwTransactionId: string | null
  // Minor units (kobo). The option's price plus the platform's registration
  // service fee: what the applicant was charged.
  totalMinor: number
}

/**
 * The paid registration-fee order behind a submission, or null when there is
 * nothing to owe back: a free application (no order), or one whose fee never
 * cleared. `orders.status === 'paid'` is the whole test — it is set only by
 * fulfillOrder, only after a verified charge passed its amount and currency
 * check, so it means the money really arrived.
 *
 * A plain read, deliberately NOT `FOR UPDATE`. The lock order on these rows is
 * order → submission → form → price option (see form-payments.ts) and the
 * caller already holds the submission row lock, so taking the order lock here
 * would invert it and could deadlock against fulfilment. It does not need to:
 * fulfilment sets the order to 'paid' and moves the submission out of
 * 'pending_payment' in ONE transaction, and the organizer's reject refuses a
 * 'pending_payment' submission. So by the time a submission is rejectable at
 * all, its order has committed as paid and this read cannot see a stale value.
 */
export async function loadPaidRegistrationFee(
  tx: DbTransaction,
  orderId: string | null
): Promise<PaidRegistrationFee | null> {
  if (!orderId) return null
  const [order] = await tx
    .select({
      id: orders.id,
      type: orders.type,
      status: orders.status,
      eventId: orders.eventId,
      buyerEmail: orders.buyerEmail,
      buyerName: orders.buyerName,
      flwTxRef: orders.flwTxRef,
      flwTransactionId: orders.flwTransactionId,
      totalMinor: orders.totalMinor,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1)
  if (!order) return null
  if (order.type !== 'registration_fee') return null
  if (order.status !== ('paid' satisfies OrderStatus)) return null
  return {
    orderId: order.id,
    eventId: order.eventId,
    buyerEmail: order.buyerEmail,
    buyerName: order.buyerName,
    flwTxRef: order.flwTxRef,
    flwTransactionId: order.flwTransactionId,
    totalMinor: order.totalMinor,
  }
}

/**
 * Write down that a rejected application's fee is owed back.
 *
 * Runs inside the rejection's own transaction, so the obligation commits with
 * the rejection it describes and no crash can land one without the other —
 * but through recordDiscrepancy, which puts the insert in a SAVEPOINT and
 * never throws. A failure here rolls back only itself; the rejection stands.
 *
 * IDEMPOTENT ACROSS REJECT/APPROVE CYCLES. The row's identity is
 * (order_id, flw_transaction_id, kind), the table's unique index, and every
 * part of it is fixed for the life of the application:
 *   - order_id            — one order per submission, set once at intake.
 *   - flw_transaction_id  — the charge that paid it. fulfillOrder writes it on
 *                           the pending→paid transition and never rewrites it
 *                           for an order that is already paid, so it is frozen
 *                           from the moment the fee cleared.
 *   - kind                — the constant above.
 * So rejecting the same application twice presents the same tuple twice, and
 * the second insert is a no-op. Rejecting, re-approving and rejecting again
 * cannot stack obligations either: the re-approval removes the open row
 * (clearRejectionRefund) and the next rejection inserts it afresh — one open
 * obligation at most, at every point in the cycle. And if the refund was
 * already ISSUED, the resolved row is still there and still owns the tuple, so
 * the later rejection records nothing: the money has already gone back, and
 * the index says so without anyone having to remember.
 *
 * Never throws.
 */
export async function recordRejectionRefund(
  tx: DbTransaction,
  args: {
    fee: PaidRegistrationFee
    submission: { id: string; reference: string }
    formTitle: string
  }
): Promise<void> {
  const { fee, submission } = args
  // What checkout asked Flutterwave to charge, in kobo. The same figure
  // fulfilment assessed the charge against (whole naira — see
  // payment-amount.ts), so it is what was actually taken; any excess over it
  // has its own 'overpayment' record and is not owed twice here.
  const chargedMinor = toFlutterwaveAmount(fee.totalMinor) * 100
  await recordDiscrepancy(tx, {
    kind: KIND,
    orderId: fee.orderId,
    orderType: 'registration_fee',
    eventId: fee.eventId,
    buyerEmail: fee.buyerEmail,
    buyerName: fee.buyerName,
    flwTxRef: fee.flwTxRef,
    // Non-null in practice: a registration fee reaches 'paid' only through
    // fulfillOrder, which always stores the charge's id. The fallback keeps the
    // unique index — and so the idempotency above — working on a row that
    // somehow lost it, rather than failing the insert on a NOT NULL column.
    flwTransactionId: fee.flwTransactionId ?? '',
    expectedMinor: chargedMinor,
    paidMinor: chargedMinor,
    // Fulfilment accepts NGN and nothing else, so a paid order was paid in it.
    paidCurrency: PAYMENT_CURRENCY,
    // The applicant holds nothing now, so the whole fee is owed back.
    owedMinor: chargedMinor,
    reason: REASON,
    detail: `The organizer rejected application ${submission.reference} on “${args.formTitle}”. The fee was paid in full and the spot has been released, so the whole charge is owed back.`,
  })
}

// What re-approving found of an earlier rejection's refund obligation.
export type RefundClearance =
  // Nothing was ever recorded against this order — the usual case.
  | { state: 'none' }
  // An obligation was open and has been withdrawn: nothing was refunded, and
  // the applicant is back in, so nothing is owed.
  | { state: 'cleared' }
  // An admin has already refunded this fee. The row is left exactly as it is.
  | { state: 'refunded'; resolvedAt: Date | null; note: string }
  // The lookup itself failed. Nothing is known and nothing was changed; the
  // caller must not treat this as either of the above.
  | { state: 'unknown' }

/**
 * Withdraw the refund obligation an earlier rejection recorded, because the
 * organizer has re-approved the application.
 *
 * Deletes rather than resolves. 'resolved' means "a person refunded this in
 * Flutterwave" — the table says nothing in this codebase may set it on its own
 * — and no money has moved here. What has happened is that the obligation
 * never became real: the applicant holds the thing they paid for again, so
 * there is nothing to owe and nothing for an admin to work through. Leaving
 * the row open would put an active, paid application on the Refunds Owed
 * screen, and the next admin to clear that screen would pay out against it.
 *
 * Only an OPEN row is deleted. A resolved one is the record that a refund was
 * actually issued and must survive: deleting it would destroy the evidence of
 * real money leaving. It is reported back as 'refunded' instead, and the
 * caller decides — see org/form-submissions.ts `approve`, which refuses the
 * re-approval, since approving an application whose fee has gone back is the
 * same hole as approving one that was never paid.
 *
 * Runs in a SAVEPOINT, like every other write to this table, and never throws:
 * a failure here is reported as 'unknown' so a review is never blocked by the
 * bookkeeping behind it.
 */
export async function clearRejectionRefund(
  tx: DbTransaction,
  orderId: string | null
): Promise<RefundClearance> {
  if (!orderId) return { state: 'none' }
  const mine = and(
    eq(paymentDiscrepancies.orderId, orderId),
    eq(paymentDiscrepancies.kind, KIND)
  )
  try {
    return await tx.transaction(async (sp) => {
      const [resolved] = await sp
        .select({
          id: paymentDiscrepancies.id,
          resolvedAt: paymentDiscrepancies.resolvedAt,
          note: paymentDiscrepancies.resolutionNote,
        })
        .from(paymentDiscrepancies)
        .where(and(mine, eq(paymentDiscrepancies.status, 'resolved')))
        .limit(1)
      if (resolved) {
        console.error(
          '[forms] re-approving an application whose fee was refunded',
          { orderId, discrepancyId: resolved.id }
        )
        return {
          state: 'refunded' as const,
          resolvedAt: resolved.resolvedAt,
          note: resolved.note,
        }
      }

      const removed = await sp
        .delete(paymentDiscrepancies)
        .where(and(mine, eq(paymentDiscrepancies.status, 'open')))
        .returning({
          id: paymentDiscrepancies.id,
          owedMinor: paymentDiscrepancies.owedMinor,
        })
      if (removed.length === 0) return { state: 'none' as const }
      // Worth a line in telemetry: it is money that was on the Refunds Owed
      // screen a moment ago and is not any more.
      console.info('[forms] refund obligation withdrawn on re-approval', {
        orderId,
        withdrew: removed.map((r) => ({ id: r.id, owedMinor: r.owedMinor })),
      })
      return { state: 'cleared' as const }
    })
  } catch (err) {
    console.error('[forms] could not clear a refund obligation', {
      orderId,
      error: err,
    })
    return { state: 'unknown' }
  }
}
