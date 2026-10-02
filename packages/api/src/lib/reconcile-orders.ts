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
//
// Covers the order types fulfillOrder can fulfil: 'ticket' and
// 'registration_fee'. 'vendor_fee' and 'vote_purchase' join once they have
// fulfilment of their own. A registration fee that ends unpaid (every attempt
// failed, or still unpaid when it leaves the window) also gives back the spot
// its submission holds; see expireUnpaidRegistrations.

import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm'

import { db, orders, submissions } from '@ticketur/db'

import {
  listTransactionsByReference,
  verifyTransaction,
  verifyTransactionByReference,
  type FlutterwaveTransaction,
} from './flutterwave'
import { releaseUnpaidSubmission } from './form-payments'
import { fulfillOrder, notifyFulfilment } from './orders'

// At most this many orders per run, newest first.
const BATCH_SIZE = 50
// At most this many expired registration fees per run, oldest first.
const EXPIRE_BATCH_SIZE = 20
// Each Flutterwave request gives up after this long.
const GATEWAY_TIMEOUT_MS = 8_000
// How far back the job looks. Also how long an unpaid registration fee holds
// its spot: one still unpaid past this is released.
const WINDOW = sql.raw(`interval '48 hours'`)

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
  // Registration fees still unpaid past the window (after one last look at
  // Flutterwave): their submissions' spots were released.
  expired: number
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
    orderType: result.order.type,
    txRef: order.flwTxRef,
    flwTransactionId: String(charge.id),
  })
  try {
    // Tickets for a ticket order, the confirmation for a registration fee.
    await notifyFulfilment(result, baseUrl)
  } catch (err) {
    // The order is paid now, so no later run comes back to it. The email has
    // to be resent by hand.
    console.error('[reconcile] fulfilled order but could not notify', {
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
    // A registration fee's spot goes back in the same transaction, so the
    // order can't end up failed with its spot still held. A charge that
    // succeeds later still fulfils it from 'failed', and takes a spot again.
    const failed = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(orders)
        .set({ status: 'failed' })
        .where(and(eq(orders.id, order.id), eq(orders.status, 'pending')))
        .returning({ id: orders.id, type: orders.type })
      if (row?.type === 'registration_fee') {
        await releaseUnpaidSubmission(
          tx,
          { orderId: row.id },
          'payment_failed'
        )
      }
      return row !== undefined
    })
    return failed ? 'marked_failed' : 'settled_elsewhere'
  }
  return 'still_pending'
}

// reconcileOrder, with a throw turned into an 'error' outcome (except a
// refused secret key, which stops the run).
async function reconcileSafely(
  order: Candidate,
  baseUrl: string
): Promise<Outcome> {
  try {
    return await reconcileOrder(order, baseUrl)
  } catch (err) {
    if (err instanceof GatewayAuthError) throw err
    // e.g. a tier that sold out after payment, or an order fulfillOrder
    // can't deliver (OrderNotFulfillableError): fulfillOrder throws, and the
    // order stays pending (retried each run until it ages out of the window)
    // for a person to refund or fulfil by hand.
    console.error('[reconcile] could not settle order', {
      orderId: order.id,
      txRef: order.flwTxRef,
      error: err,
    })
    return 'error'
  }
}

// A registration fee still unpaid when its order leaves the window would
// hold its submission's spot forever: nothing looks at it again. Each one
// gets a last look at Flutterwave, which settles it if it was paid after all
// (or fails it if every attempt failed, releasing the spot that way). One
// still pending after that is released here, cause 'expired'. The order
// itself stays pending, so a payment that lands even later still reaches the
// webhook and completes the submission again.
//
// Picks up only submissions still holding the spot, so each order is
// released once and then drops out of this query.
async function expireUnpaidRegistrations(
  baseUrl: string,
  deadline: number,
  summary: ReconcileSummary
): Promise<void> {
  const rows = await db
    .select({
      id: orders.id,
      flwTxRef: orders.flwTxRef,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .innerJoin(
      submissions,
      and(
        // Linked both ways, as createRegistrationOrder leaves them.
        eq(submissions.id, orders.referenceId),
        eq(submissions.orderId, orders.id),
        eq(submissions.status, 'pending_payment')
      )
    )
    .where(
      and(
        eq(orders.type, 'registration_fee'),
        eq(orders.status, 'pending'),
        isNotNull(orders.flwTxRef),
        sql`${orders.createdAt} < now() - ${WINDOW}`
      )
    )
    .orderBy(asc(orders.createdAt))
    .limit(EXPIRE_BATCH_SIZE)

  for (const [index, row] of rows.entries()) {
    if (Date.now() >= deadline) {
      summary.deferred += rows.length - index
      return
    }
    if (!row.flwTxRef) continue // excluded by the query; narrows the type
    const order = {
      id: row.id,
      flwTxRef: row.flwTxRef,
      createdAt: row.createdAt,
    }

    const outcome = await reconcileSafely(order, baseUrl)
    if (outcome !== 'still_pending') {
      summary[SUMMARY_FIELD[outcome]] += 1
      continue
    }
    try {
      const released = await db.transaction((tx) =>
        releaseUnpaidSubmission(tx, { orderId: order.id }, 'expired')
      )
      // Nothing released: it was paid or released while we looked.
      if (released.length > 0) summary.expired += 1
      else summary.settledElsewhere += 1
    } catch (err) {
      console.error('[reconcile] could not release an expired registration', {
        orderId: order.id,
        error: err,
      })
      summary.errors += 1
    }
  }
}

/**
 * Re-checks pending orders against Flutterwave and settles each one: fulfils
 * it when a successful charge pays for it, fails it when every attempt
 * failed, and otherwise leaves it pending. Then releases the spots of
 * registration fees still unpaid past the window (expireUnpaidRegistrations).
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
        // The types fulfillOrder can fulfil. vendor_fee and vote_purchase
        // need fulfilment of their own before this job may settle them.
        inArray(orders.type, ['ticket', 'registration_fee']),
        isNotNull(orders.flwTxRef),
        // Measured on the database clock, which stamped created_at.
        sql`${orders.createdAt} <= now() - interval '10 minutes'`,
        sql`${orders.createdAt} >= now() - ${WINDOW}`
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
    expired: 0,
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

    const outcome = await reconcileSafely(order, baseUrl)
    summary[SUMMARY_FIELD[outcome]] += 1
  }

  if (Date.now() < deadline) {
    await expireUnpaidRegistrations(baseUrl, deadline, summary)
  }

  return summary
}
