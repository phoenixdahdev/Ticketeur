import { NextResponse } from 'next/server'
import { getBaseUrl } from '@ticketur/api/lib/base-url'
import { eq } from 'drizzle-orm'

import { db, orders } from '@ticketur/db'
import {
  isWebhookSignatureValid,
  verifyTransaction,
} from '@ticketur/api/lib/flutterwave'

import {
  fulfillOrder,
  notifyFulfilment,
  OrderNotFulfillableError,
} from '@ticketur/api/lib/orders'

export const dynamic = 'force-dynamic'

type ChargeCompletedEvent = {
  event?: string
  data?: {
    id?: number
    tx_ref?: string
    status?: string
  }
}

export async function POST(req: Request) {
  const signature = req.headers.get('verif-hash')
  if (!isWebhookSignatureValid(signature)) {
    // A spike here is either a secret mismatch between us and Flutterwave or
    // forged "charge.completed" payloads; neither was visible before.
    console.error('[webhook] flutterwave signature rejected', {
      reason: signature ? 'hash mismatch' : 'missing verif-hash header',
    })
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  let body: ChargeCompletedEvent
  try {
    body = (await req.json()) as ChargeCompletedEvent
  } catch {
    console.error('[webhook] flutterwave payload is not valid json')
    return NextResponse.json(
      { ok: false, error: 'invalid json' },
      { status: 400 }
    )
  }

  // We only act on completed charges. Other webhook event types (refunds,
  // disputes etc.) are acknowledged with 200 so Flutterwave doesn't retry.
  if (
    body.event !== 'charge.completed' ||
    !body.data?.id ||
    !body.data.tx_ref
  ) {
    return NextResponse.json({ ok: true, ignored: true })
  }

  const flwTransactionId = body.data.id
  const txRef = body.data.tx_ref

  // Always re-verify with FW's API before mutating state — webhook bodies
  // alone are not authoritative. This guards against spoofed payloads.
  const tx = await verifyTransaction(flwTransactionId)
  if (!tx || tx.status !== 'successful') {
    console.error('[webhook] flutterwave charge could not be verified', {
      flwTransactionId,
      txRef,
      verifiedStatus: tx?.status ?? null,
    })
    return NextResponse.json(
      { ok: false, reason: 'verify failed' },
      { status: 400 }
    )
  }
  if (tx.tx_ref !== txRef) {
    console.error('[webhook] flutterwave tx_ref mismatch', {
      flwTransactionId,
      bodyTxRef: txRef,
      verifiedTxRef: tx.tx_ref,
    })
    return NextResponse.json(
      { ok: false, reason: 'tx_ref mismatch' },
      { status: 400 }
    )
  }

  // Find the matching order by tx_ref (we set this when starting checkout).
  const [order] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.flwTxRef, tx.tx_ref))
    .limit(1)
  if (!order) {
    // A successful charge we cannot attach to an order: money taken with no
    // tickets to show for it. Needs manual reconciliation, so it must be seen.
    console.error('[webhook] no order matches a verified flutterwave charge', {
      flwTransactionId,
      txRef: tx.tx_ref,
      amount: tx.amount,
      currency: tx.currency,
    })
    return NextResponse.json(
      { ok: false, reason: 'no matching order' },
      { status: 404 }
    )
  }

  try {
    // fulfillOrder re-checks the verified charge (status, tx_ref, amount,
    // currency) against the locked order before it delivers anything, for
    // every order type, and then delivers by type: tickets for a ticket order,
    // the submission for a registration fee.
    const result = await fulfillOrder({ orderId: order.id, charge: tx })
    if (!result) {
      console.error('[webhook] verified charge maps to a missing order row', {
        orderId: order.id,
        flwTransactionId: String(tx.id),
        txRef: tx.tx_ref,
      })
      return NextResponse.json(
        { ok: false, reason: 'order missing' },
        { status: 404 }
      )
    }

    if (result.outcome === 'rejected') {
      // Underpaid or wrong-currency charge. fulfillOrder has logged expected
      // vs received and recorded the charge on the order (now 'failed'). It is
      // refused with a 4xx like the other rejections above, so it shows up in
      // request telemetry instead of passing as a 200. A Flutterwave retry
      // re-runs the same check and cannot change the outcome.
      return NextResponse.json(
        { ok: false, reason: 'charge does not pay for the order' },
        { status: 422 }
      )
    }

    // Emails (and a ticket order's PDF) only when this call did the
    // pending→paid transition. The /checkout/return page may have already
    // fulfilled the order if the customer beat the webhook back to our domain.
    await notifyFulfilment(result, getBaseUrl())

    return NextResponse.json({
      ok: true,
      alreadyFulfilled: !result.justFulfilled,
    })
  } catch (err) {
    if (err instanceof OrderNotFulfillableError) {
      // The charge pays for the order, but there is nothing this code can
      // deliver for it (a type with no fulfilment yet, or a registration fee
      // whose submission is gone). fulfillOrder logged it and wrote nothing,
      // so the order is left for a person. Refused with a 4xx like a rejected
      // charge: a retry meets the same refusal.
      return NextResponse.json(
        { ok: false, reason: 'order cannot be fulfilled' },
        { status: 422 }
      )
    }
    // Previously logged without any way to tell which order failed, so a
    // failed fulfillment could not be traced back to the payment.
    console.error('[webhook] flutterwave fulfillment failed', {
      orderId: order.id,
      flwTransactionId: String(tx.id),
      txRef: tx.tx_ref,
      error: err,
    })
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 }
    )
  }
}
