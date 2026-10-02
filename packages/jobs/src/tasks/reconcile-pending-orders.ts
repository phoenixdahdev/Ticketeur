import { AbortTaskRunError, logger, schedules } from '@trigger.dev/sdk'
import { env } from '@ticketur/env/core'

const ENDPOINT = '/api/cron/reconcile-orders'

type ReconcileResponse = {
  ok?: boolean
  summary?: Record<string, number>
  error?: string
}

// The worker's first scheduled task. Every 15 minutes it has the web app
// settle the pending orders that neither the Flutterwave webhook nor the
// /checkout/return page settled. Paid ones are fulfilled, with the same
// amount verification as those paths, and ones whose every attempt failed
// are marked failed.
//
// The work runs in the web app (packages/api/src/lib/reconcile-orders.ts,
// behind POST /api/cron/reconcile-orders); this task only fires it. It can't
// run here: it settles orders through fulfillOrder in @ticketur/api, which
// depends on @ticketur/auth, which depends on this package, so importing it
// closes a dependency cycle that turbo refuses to run. Running in the web app
// also keeps it on the code path and configuration the webhook already uses
// (Flutterwave and Vercel Blob keys, PDF rendering, the public base URL).
// None of that is provisioned for this worker.
//
// Needs, in the Trigger.dev environment: NEXT_PUBLIC_APP_URL (the web app's
// canonical public URL) and CRON_SECRET (the same value the web app has).
export const reconcilePendingOrdersTask = schedules.task({
  id: 'reconcile-pending-orders',
  // Production only, so a `trigger dev` session never settles orders through
  // whatever app URL its local env points at.
  cron: { pattern: '*/15 * * * *', environments: ['PRODUCTION'] },
  // One run at a time. Overlap would be safe, since settling is idempotent,
  // but would only duplicate gateway calls.
  concurrency: { total: 1 },
  maxDuration: 120,
  run: async (payload) => {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL
    const secret = env.CRON_SECRET
    if (!appUrl || !secret) {
      // Configuration, not a transient fault: a retry can't fix it.
      throw new AbortTaskRunError(
        'reconcile-pending-orders needs NEXT_PUBLIC_APP_URL and CRON_SECRET'
      )
    }

    const res = await fetch(new URL(ENDPOINT, appUrl), {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
      // A redirect (apex to www, say) would drop the Authorization header and
      // come back as a puzzling 401, so report it as the misconfiguration it is.
      redirect: 'manual',
      // Longer than the route's maxDuration (60s), so a platform timeout comes
      // back as a response instead of aborting here.
      signal: AbortSignal.timeout(90_000),
    })
    if (res.status >= 300 && res.status < 400) {
      throw new AbortTaskRunError(
        `NEXT_PUBLIC_APP_URL redirects to ${res.headers.get('location')}; ` +
          'set it to the URL the web app serves from'
      )
    }
    if (res.status === 401 || res.status === 503) {
      throw new AbortTaskRunError(
        `the web app refused the call (HTTP ${res.status}). CRON_SECRET must ` +
          'be set to the same value, at least 32 characters, in both places'
      )
    }

    const body = (await res
      .json()
      .catch(() => null)) as ReconcileResponse | null
    if (!res.ok || !body?.summary) {
      // Retried with backoff: the web app or Flutterwave may be briefly down.
      throw new Error(
        `reconcile-orders failed (HTTP ${res.status}): ` +
          (body?.error ?? 'no summary in the response')
      )
    }

    logger.info('reconciled pending orders', {
      scheduledAt: payload.timestamp.toISOString(),
      ...body.summary,
    })
    return body.summary
  },
})
