import { createHash, timingSafeEqual } from 'node:crypto'

import { NextResponse } from 'next/server'
import { getBaseUrl } from '@ticketur/api/lib/base-url'
import { reconcilePendingOrders } from '@ticketur/api/lib/reconcile-orders'
import { env } from '@ticketur/env/core'

export const dynamic = 'force-dynamic'

// The run stops starting new orders after RUN_BUDGET_MS. The rest of
// maxDuration covers the order in flight: two Flutterwave calls with their own
// timeouts, the fulfilment transaction, and the PDF and email.
export const maxDuration = 60
const RUN_BUDGET_MS = 30_000

// A shorter CRON_SECRET is treated as unset rather than trusted.
const MIN_SECRET_LENGTH = 32

function bearerMatches(header: string | null, secret: string): boolean {
  if (!header) return false
  // Hashing both sides gives timingSafeEqual the equal lengths it needs.
  const digest = (value: string) => createHash('sha256').update(value).digest()
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`))
}

// Settles pending orders the Flutterwave webhook and the /checkout/return page
// missed (see packages/api/src/lib/reconcile-orders.ts). Called every 15
// minutes by the `reconcile-pending-orders` Trigger.dev task with
// `Authorization: Bearer $CRON_SECRET`. The work runs here, not in the
// Trigger.dev worker, because it needs @ticketur/api's fulfilment code and the
// Flutterwave, Blob and base-URL configuration this app already has; that task
// explains why the worker can't import it.
export async function POST(req: Request) {
  const secret = env.CRON_SECRET
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    // Fail closed. Without a usable secret no caller can be authenticated, and
    // the scheduler should show failing runs until one is set.
    console.error('[reconcile] CRON_SECRET is missing or too short', {
      configured: Boolean(secret),
    })
    return NextResponse.json(
      { ok: false, error: 'not configured' },
      { status: 503 }
    )
  }

  const authorization = req.headers.get('authorization')
  if (!bearerMatches(authorization, secret)) {
    // A spike here is either a secret mismatch between Vercel and Trigger.dev
    // or someone probing the endpoint.
    console.error('[reconcile] request rejected', {
      reason: authorization ? 'bearer mismatch' : 'missing authorization',
    })
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  try {
    const summary = await reconcilePendingOrders({
      baseUrl: getBaseUrl(),
      budgetMs: RUN_BUDGET_MS,
    })
    return NextResponse.json({ ok: true, summary })
  } catch (err) {
    console.error('[reconcile] run failed', { error: err })
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 }
    )
  }
}
