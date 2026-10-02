// Settles pending orders that Flutterwave has an answer for but that neither
// the webhook nor the /checkout/return page settled: a webhook that failed or
// never arrived, and a buyer who closed the tab before the redirect. Run
// every 15 minutes by the `reconcile-pending-orders` Trigger.dev task,
// through POST /api/cron/reconcile-orders.
//
// Safe to run alongside the webhook, the return page and another run of
// itself. Every charge is settled through fulfillOrder, so it gets the same
// row lock, the same amount and currency verification, and the same
// justFulfilled guard on the email. This job only ever fails an order with a
// conditional update on status = 'pending'.

import { and, desc, eq, isNotNull, sql } from 'drizzle-orm'

import { db, orders } from '@ticketur/db'

import {
  listTransactionsByReference,
  verifyTransaction,
  verifyTransactionByReference,
  type FlutterwaveTransaction,
} from './flutterwave'
import { fulfillOrder, notifyOrderFulfilled } from './orders'

// At most this many orders per run, newest first.
const BATCH_SIZE = 50
// Each Flutterwave request gives up after this long.
const GATEWAY_TIMEOUT_MS = 8_000

export type ReconcileSummary = {
  // Pending orders in the window this run picked up.
  candidates: number
  // Paid at Flutterwave but never fulfilled: fulfilled and notified now.
  fulfilled: number
  // Settled by the webhook or the return page while this run was checking.
  settledElsewhere: number
  // A successful charge that does not pay for the order. fulfillOrder has
  // logged it and marked the order failed.
  rejected: number
  // Every attempt on the order's tx_ref failed at Flutterwave.
  markedFailed: number
  // Nothing to act on yet: no charge attempted, one still in progress, or an
  // answer too incomplete to fail the order on.
  stillPending: number
  // Could not be checked or settled; tried again next run.
  errors: number
  // Not reached before the time budget ran out; picked up next run.
  deferred: number
}

type Outcome =
  | 'fulfilled'
  | 'settled_elsewhere'
  | 'rejected'
  | 'marked_failed'
  | 'still_pending'
  | 'error'

const SUMMARY_FIELD: Record<Outcome, keyof ReconcileSummary> = {
  fulfilled: 'fulfilled',
  settled_elsewhere: 'settledElsewhere',
  rejected: 'rejected',
  marked_failed: 'markedFailed',
  still_pending: 'stillPending',
  error: 'errors',
}

type Candidate = { id: string; flwTxRef: string; createdAt: Date }

// Flutterwave refused our secret key. Every lookup would fail the same way,
// so the run stops instead of reporting each order as an error.
export class GatewayAuthError extends Error {
  readonly httpStatus: number
  constructor(httpStatus: number) {
    super(`Flutterwave refused the secret key (HTTP ${httpStatus})`)
    this.name = 'GatewayAuthError'
    this.httpStatus = httpStatus
  }
}

// YYYY-MM-DD in UTC, `days` away from `date`.
function isoDay(date: Date, days: number): string {
  return new Date(date.getTime() + days * 86_400_000).toISOString().slice(0, 10)
}

const gatewaySignal = () => AbortSignal.timeout(GATEWAY_TIMEOUT_MS)

async function settle(
  order: Candidate,
  charge: FlutterwaveTransaction,
  baseUrl: string
): Promise<Outcome> {
  // Same entry point as the webhook and the return page: fulfillOrder checks
  // the charge's status, tx_ref, amount and currency under the order's lock.
  const result = await fulfillOrder({ orderId: order.id, charge })
  if (!result) {
    console.error('[reconcile] order disappeared while being settled', {
      orderId: order.id,
      flwTransactionId: String(charge.id),
    })
    return 'error'
  }
  if (result.outcome === 'rejected') return 'rejected'
  if (result.outcome === 'already_paid') return 'settled_elsewhere'

  // A paid charge that neither the webhook nor the return page fulfilled. The
  // buyer is now served, but one of those paths is failing, so log it.
  console.error('[reconcile] fulfilled a paid order the webhook missed', {
    orderId: order.id,
    txRef: order.flwTxRef,
    flwTransactionId: String(charge.id),
  })
  try {
    await notifyOrderFulfilled({ orderId: order.id, baseUrl })
  } catch (err) {
    // The order is paid now, so no later run comes back to it. The tickets
    // email has to be resent by hand.
    console.error('[reconcile] fulfilled order but could not send tickets', {
      orderId: order.id,
      error: err,
    })
  }
  return 'fulfilled'
}

async function reconcileOrder(
  order: Candidate,
  baseUrl: string
): Promise<Outcome> {
  const lookup = await verifyTransactionByReference(order.flwTxRef, {
    signal: gatewaySignal(),
  })
  if (lookup.kind === 'unauthorized') {
    throw new GatewayAuthError(lookup.httpStatus)
  }
  if (lookup.kind === 'unavailable') {
    console.error('[reconcile] Flutterwave lookup failed', {
      orderId: order.id,
      txRef: order.flwTxRef,
      reason: lookup.reason,
    })
    return 'error'
  }
  // Nothing was ever charged against this tx_ref: an abandoned checkout, or a
  // buyer still deciding. It stays pending and ages out of the window.
  if (lookup.kind === 'none') return 'still_pending'

  let outcome: Outcome | null = null
  if (lookup.transaction.status === 'successful') {
    outcome = await settle(order, lookup.transaction, baseUrl)
    // A rejected charge leaves the order fulfillable by another charge on the
    // same tx_ref, so fall through and look for one.
    if (outcome !== 'rejected') return outcome
  }

  // verify_by_reference returns one transaction, but a buyer can retry on the
  // same checkout, so another attempt on this tx_ref may have succeeded with
  // its webhook lost. That is exactly the case this job exists for, so look at
  // every attempt before deciding anything.
  const listed = await listTransactionsByReference(order.flwTxRef, {
    from: isoDay(order.createdAt, -1),
    to: isoDay(new Date(), 1),
    signal: gatewaySignal(),
  })
  if (listed.kind === 'unauthorized') {
    throw new GatewayAuthError(listed.httpStatus)
  }
  if (listed.kind === 'unavailable') {
    console.error('[reconcile] Flutterwave attempt listing failed', {
      orderId: order.id,
      txRef: order.flwTxRef,
      reason: listed.reason,
    })
    return outcome ?? 'error'
  }

  // The filter is applied again here in case the listing matches loosely.
  const attempts = listed.attempts.filter((a) => a.tx_ref === order.flwTxRef)
  for (const attempt of attempts) {
    if (attempt.status !== 'successful') continue
    if (String(attempt.id) === String(lookup.transaction.id)) continue // tried
    // Settle on the canonical record, from the endpoint the webhook uses.
    const charge = await verifyTransaction(attempt.id, {
      signal: gatewaySignal(),
    })
    if (!charge) {
      console.error('[reconcile] could not verify a successful attempt', {
        orderId: order.id,
        flwTransactionId: String(attempt.id),
      })
      return 'error'
    }
    outcome = await settle(order, charge, baseUrl)
    // A rejected charge leaves the order fulfillable by another one, so keep
    // trying the remaining successful attempts.
    if (outcome !== 'rejected') return outcome
  }
  if (outcome) return outcome

  // Fail the order only on a complete answer where every attempt failed. A
  // pending attempt, a paged listing or an empty one leaves it pending.
  const everyAttemptFailed =
    attempts.length > 0 && attempts.every((a) => a.status === 'failed')
  if (
    lookup.transaction.status === 'failed' &&
    everyAttemptFailed &&
    listed.complete
  ) {
    // No flw_transaction_id is stored: nothing was taken. That keeps these
    // apart from fulfillOrder's rejected charges, which do need a refund.
    const failed = await db
      .update(orders)
      .set({ status: 'failed' })
      .where(and(eq(orders.id, order.id), eq(orders.status, 'pending')))
      .returning({ id: orders.id })
    return failed.length > 0 ? 'marked_failed' : 'settled_elsewhere'
  }
  return 'still_pending'
}

/**
 * Re-checks pending orders against Flutterwave and settles each one: fulfils
 * it when a successful charge pays for it, fails it when every attempt
 * failed, and otherwise leaves it pending.
 *
 * Orders are picked up from 10 minutes old (younger ones are left to the
 * webhook and the return page while the buyer may still be paying) to 48
 * hours old. 48 hours covers a weekend-long webhook outage without the first
 * run sweeping every abandoned checkout in the table's history.
 *
 * Stops starting new orders once `budgetMs` has elapsed, so the caller's
 * platform timeout is unlikely to cut an order off mid-settlement.
 */
export async function reconcilePendingOrders({
  baseUrl,
  budgetMs,
}: {
  baseUrl: string
  budgetMs: number
}): Promise<ReconcileSummary> {
  const deadline = Date.now() + budgetMs

  const rows = await db
    .select({
      id: orders.id,
      flwTxRef: orders.flwTxRef,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .where(
      and(
        eq(orders.status, 'pending'),
        // fulfillOrder fulfils by minting tickets. Other order types need
        // their own fulfilment before this job may settle them.
        eq(orders.type, 'ticket'),
        isNotNull(orders.flwTxRef),
        // Measured on the database clock, which stamped created_at.
        sql`${orders.createdAt} <= now() - interval '10 minutes'`,
        sql`${orders.createdAt} >= now() - interval '48 hours'`
      )
    )
    .orderBy(desc(orders.createdAt))
    .limit(BATCH_SIZE)

  const summary: ReconcileSummary = {
    candidates: rows.length,
    fulfilled: 0,
    settledElsewhere: 0,
    rejected: 0,
    markedFailed: 0,
    stillPending: 0,
    errors: 0,
    deferred: 0,
  }

  for (const [index, row] of rows.entries()) {
    if (Date.now() >= deadline) {
      summary.deferred = rows.length - index
      break
    }
    if (!row.flwTxRef) continue // excluded by the query; narrows the type
    const order = {
      id: row.id,
      flwTxRef: row.flwTxRef,
      createdAt: row.createdAt,
    }

    let outcome: Outcome
    try {
      outcome = await reconcileOrder(order, baseUrl)
    } catch (err) {
      if (err instanceof GatewayAuthError) throw err
      // e.g. a tier that sold out after payment: fulfillOrder throws, and the
      // order stays pending (retried each run until it ages out of the
      // window) for a person to refund or fulfil by hand.
      console.error('[reconcile] could not settle order', {
        orderId: order.id,
        txRef: order.flwTxRef,
        error: err,
      })
      outcome = 'error'
    }
    summary[SUMMARY_FIELD[outcome]] += 1
  }

  return summary
}
