// Writing down money the platform is holding that it may owe back.
//
// Every entry point is one of fulfillOrder's branches (orders.ts). The two
// rules that shape this file:
//
//   1. Recording must never block or fail fulfilment. A customer who paid
//      still gets what they paid for even if this write fails. So neither
//      function here ever throws: a failure is logged with everything the
//      row would have held, which is exactly what the code did before this
//      table existed, so the worst case is no worse than the old behaviour.
//
//   2. One payment produces one record. Two mechanisms, because neither
//      alone is enough:
//        - fulfillOrder holds `SELECT … FOR UPDATE` on the order row, so two
//          concurrent fulfilments of one order are serialised and only one of
//          them takes the pending→paid branch at all.
//        - That lock says nothing about repeats over time. The FW webhook
//          retries, the /checkout/return page and the 15-minute
//          reconciliation job all re-present the same charge, and the
//          already-paid and delivery-failed branches are reached on every
//          single one. So every insert is ON CONFLICT DO NOTHING against the
//          unique index on (order_id, flw_transaction_id, kind).
//      The unique index is the real guarantee; the row lock only means the
//      common case never even races.

import { randomUUID } from 'node:crypto'

import {
  db,
  paymentDiscrepancies,
  type OrderType,
  type PaymentDiscrepancyKind,
} from '@ticketur/db'

// The tx handle drizzle hands to `db.transaction(async (tx) => …)`.
type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

export type DiscrepancyInput = {
  kind: PaymentDiscrepancyKind
  orderId: string
  orderType: OrderType
  eventId: string | null
  buyerEmail: string
  buyerName: string
  flwTxRef: string | null
  flwTransactionId: string
  // Minor units (kobo). What the order asked Flutterwave to charge.
  expectedMinor: number
  // Minor units of `paidCurrency`. Null when Flutterwave's amount could not
  // be read as a number.
  paidMinor: number | null
  paidCurrency: string
  // Minor units of `paidCurrency`. The excess for an overpayment, the whole
  // charge otherwise. Null when `paidMinor` is null.
  owedMinor: number | null
  reason: string
  detail: string
}

function toRow(input: DiscrepancyInput) {
  return {
    id: `pdx_${randomUUID()}`,
    kind: input.kind,
    orderId: input.orderId,
    orderType: input.orderType,
    eventId: input.eventId,
    buyerEmail: input.buyerEmail,
    buyerName: input.buyerName,
    flwTxRef: input.flwTxRef,
    flwTransactionId: input.flwTransactionId,
    expectedMinor: input.expectedMinor,
    paidMinor: input.paidMinor,
    paidCurrency: input.paidCurrency,
    owedMinor: input.owedMinor,
    reason: input.reason,
    detail: input.detail,
  }
}

// Logged at the same level and with the same shape fulfillOrder used before
// this table existed, so a write that fails still leaves the full picture in
// telemetry rather than silently losing the money.
function logFailure(input: DiscrepancyInput, err: unknown) {
  console.error('[discrepancy] could not record money owed to a customer', {
    ...input,
    error: err,
  })
}

/**
 * Record a discrepancy inside fulfilment's own transaction, so it commits
 * with the fulfilment it describes and cannot be lost to a crash in between.
 *
 * The insert runs in a SAVEPOINT (drizzle's nested `tx.transaction`, which is
 * `SAVEPOINT`/`ROLLBACK TO` on postgres.js). That is what keeps rule 1 true
 * inside a transaction: in Postgres a failed statement poisons the whole
 * transaction — every later statement fails with 25P02 — so a bare try/catch
 * around the insert would still take fulfilment down with it. Rolling back to
 * the savepoint leaves the outer transaction clean and committable.
 *
 * Never throws.
 */
export async function recordDiscrepancy(
  tx: DbTransaction,
  input: DiscrepancyInput
): Promise<void> {
  try {
    await tx.transaction(async (sp) => {
      await sp
        .insert(paymentDiscrepancies)
        .values(toRow(input))
        .onConflictDoNothing()
    })
  } catch (err) {
    logFailure(input, err)
  }
}

/**
 * Record a discrepancy in a transaction of its own.
 *
 * For the one case that cannot share fulfilment's transaction: the charge
 * paid for the order but delivering it threw, so that transaction rolled back
 * and anything written inside it is gone. Called after the rollback, from
 * fulfillOrder's catch, before the error is re-thrown to the caller.
 *
 * Never throws — the caller is already on its way to re-throwing the real
 * error, and this must not replace it.
 */
export async function recordDiscrepancyStandalone(
  input: DiscrepancyInput
): Promise<void> {
  try {
    await db
      .insert(paymentDiscrepancies)
      .values(toRow(input))
      .onConflictDoNothing()
  } catch (err) {
    logFailure(input, err)
  }
}

/**
 * A Flutterwave charge amount as minor units, or null when it cannot be read
 * as a number. Mirrors checkPaidAmount's parse — a numeric string is
 * tolerated rather than turned into a false reading — so what is recorded is
 * what was assessed.
 */
export function chargeAmountMinor(amount: unknown): number | null {
  const paid =
    typeof amount === 'number'
      ? amount
      : typeof amount === 'string' && amount.trim() !== ''
        ? Number(amount)
        : Number.NaN
  return Number.isFinite(paid) ? Math.round(paid * 100) : null
}
