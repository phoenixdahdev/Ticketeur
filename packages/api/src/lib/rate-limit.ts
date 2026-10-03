import { env } from '@ticketur/env/core'

// A volume brake in front of the public API.
//
// Every `publicProcedure` is callable by a stranger with curl: pending orders,
// one-time codes, votes, nominations, form submissions, balance lookups. Some
// of those paths already guard the RESOURCE they touch — issueVoteCode's
// per-email cooldown, MAX_NOMINATIONS_PER_NOMINATOR_PER_CATEGORY — but none of
// them says anything about raw request volume, and a hand-rolled counter per
// endpoint does not scale to "every public procedure, including the one
// written next month". This is the layer above them: it counts CALLS, not
// votes or codes, and it is wired into the middleware chain in ../trpc.ts so a
// new public procedure is covered without its author remembering.
//
// ── Where the counter lives, and what that costs ──
// In this process's memory, and nowhere else. The honest reasoning:
//
//   Postgres   would be correct and durable, and is the only shared store this
//              deployment has. It needs a table; the schema is frozen. It also
//              puts a write on the hot path of every read, which is a strange
//              price to pay for protecting reads.
//   Redis/KV   is the right answer and is NOT PROVISIONED. No @upstash/redis,
//              no @vercel/kv, no connection string in packages/env — adding one
//              is an infrastructure decision, not a code change. See the note
//              at the bottom of this file for what it would buy.
//   memory     needs nothing, costs nothing, and is wrong in one specific way.
//
// The specific way it is wrong: on Vercel each serverless instance holds its
// own Map, so the effective ceiling is (limit x live instances), and every
// deploy or cold start hands the attacker a fresh budget. A caller who can
// spread requests across instances is not stopped by this. THIS IS NOT A WAF.
// What it does do is cap the damage one hot instance will absorb, which is
// what turns an unthinking flood — a loop in a script, a retry storm, someone
// pointing `ab` at /api/trpc — from an outage into a shrug. Against a
// distributed or instance-aware attacker, the answer is Vercel's firewall or a
// shared counter, and neither is in this repository today.

// ─── Policy ─────────────────────────────────────────────────────────────────

/**
 * Which budget a call is charged to. A tRPC `query` is a read; a `mutation` or
 * `subscription` is a write. Mapped from the procedure type in ../trpc.ts, so
 * nothing has to be annotated by hand.
 */
export type RateLimitKind = 'read' | 'write'

export type RateLimitPolicy = {
  /** Calls allowed per window, and the largest burst allowed at once. */
  limit: number
  /** How long the full `limit` takes to refill. */
  windowMs: number
}

export type RateLimitDecision =
  | { allowed: true; remaining: number }
  | {
      allowed: false
      retryAfterSeconds: number
      /**
       * True only for the first refusal of a run — the call where this key
       * went from passing to being held back. The middleware logs on that
       * edge and stays silent for the rest, so a flood produces one line
       * rather than one line per refused request. A rate limiter that makes
       * the log bill scale with the attack has not helped much.
       */
      firstRefusal: boolean
    }

const MINUTE_MS = 60_000

/**
 * Buckets kept at once. An attacker rotating source addresses would otherwise
 * grow the Map without bound, which turns a rate limiter into a memory
 * exhaustion vector — a worse bug than the one it was added to fix.
 *
 * 20,000 entries is a few megabytes of small objects. Past that the LEAST
 * RECENTLY USED bucket is dropped, which is the right end to drop from: a
 * caller actively being throttled is by definition the most recently used, so
 * the eviction policy keeps exactly the buckets that are doing work. Dropping
 * a bucket does hand that key a fresh budget, so someone willing to cycle
 * 20,000 keys can flush a victim's bucket out. Bounded memory is worth more.
 */
const MAX_TRACKED_KEYS = 20_000

/** `30` → `"30 seconds"`, `1` → `"1 second"`. For copy a person reads. */
function humanSeconds(seconds: number): string {
  return seconds === 1 ? '1 second' : `${seconds} seconds`
}

/** The refusal a caller sees. Says what happened and exactly what to do. */
export function rateLimitMessage(
  kind: RateLimitKind,
  retryAfterSeconds: number
): string {
  const wait = humanSeconds(retryAfterSeconds)
  return kind === 'read'
    ? `Too many requests from your network. Wait ${wait} and reload the page.`
    : `Too many requests from your network. Wait ${wait} and try again.`
}

/**
 * The `cause` carried by a TOO_MANY_REQUESTS error, so the wait survives the
 * trip from the middleware out to the two places that want it in a machine
 * -readable form: the `Retry-After` header, and the error shape the client
 * receives. A real Error subclass because TRPCError wraps a non-Error cause
 * in a class of its own and the field would not survive.
 */
const RATE_LIMITED_ERROR_NAME = 'RateLimitedError'

export class RateLimitedError extends Error {
  readonly retryAfterSeconds: number

  constructor(retryAfterSeconds: number) {
    super(`rate limited; retry after ${retryAfterSeconds}s`)
    this.name = RATE_LIMITED_ERROR_NAME
    this.retryAfterSeconds = retryAfterSeconds
  }
}

/**
 * The wait an error carries, or `null` if it is not a rate-limit refusal.
 *
 * Matches on the shape rather than `instanceof`, because the bundlers in this
 * repository can produce two copies of a module and an identity check would
 * then quietly stop recognising its own error.
 */
export function rateLimitedRetryAfter(error: unknown): number | null {
  const cause = (error as { cause?: unknown } | null | undefined)?.cause
  if (!cause || typeof cause !== 'object') return null
  const candidate = cause as { name?: unknown; retryAfterSeconds?: unknown }
  if (candidate.name !== RATE_LIMITED_ERROR_NAME) return null
  const seconds = candidate.retryAfterSeconds
  return typeof seconds === 'number' && Number.isFinite(seconds)
    ? seconds
    : null
}

// ─── The store ──────────────────────────────────────────────────────────────

type Bucket = {
  /** Fractional tokens left. Capacity is the policy's `limit`. */
  tokens: number
  /** When `tokens` was last brought up to date. */
  updatedAt: number
  /** Whether the last call on this key was refused. Drives `firstRefusal`. */
  refusing: boolean
}

export type RateLimitStore = {
  /**
   * Charge one call against `key`. Returns whether it is allowed, and if not,
   * the whole seconds until it would be.
   */
  take(key: string, policy: RateLimitPolicy, now: number): RateLimitDecision
  /** Buckets currently held. For tests and for reasoning about memory. */
  size(): number
  /** Drop every bucket. Tests only; nothing in production calls it. */
  reset(): void
}

/**
 * A token bucket per key, in a Map bounded by least-recent use.
 *
 * Token bucket rather than a fixed window because a fixed window lets a caller
 * spend the whole budget at 11:59:59 and the whole budget again at 12:00:00 —
 * twice the limit in a moment, which is precisely the burst the brake exists
 * to flatten. A bucket refills continuously, so the sustained rate is the
 * limit and the burst is never more than the capacity.
 *
 * A REFUSED call does not spend a token. If it did, a caller hammering the
 * endpoint would hold their own bucket permanently empty and never recover —
 * and behind carrier NAT they would hold everyone else's empty too.
 *
 * There is no timer. Buckets are refilled when they are next touched and
 * evicted by the size bound, so this module never keeps the event loop alive —
 * an interval in a serverless function is a way to be billed for nothing.
 */
export function createRateLimitStore(
  options: { maxKeys?: number } = {}
): RateLimitStore {
  const maxKeys = options.maxKeys ?? MAX_TRACKED_KEYS
  // Insertion order is iteration order for a Map, and re-setting an existing
  // key does NOT move it — so a touched key is deleted and re-set to move it
  // to the end. The front of the Map is then the least recently used.
  const buckets = new Map<string, Bucket>()

  function touch(key: string, bucket: Bucket): void {
    buckets.delete(key)
    buckets.set(key, bucket)
    while (buckets.size > maxKeys) {
      const oldest = buckets.keys().next()
      if (oldest.done) break
      buckets.delete(oldest.value)
    }
  }

  return {
    take(key, policy, now) {
      const refillPerMs = policy.limit / policy.windowMs
      const existing = buckets.get(key)

      // A key seen for the first time starts full, minus this call.
      if (!existing) {
        touch(key, {
          tokens: policy.limit - 1,
          updatedAt: now,
          refusing: false,
        })
        return { allowed: true, remaining: policy.limit - 1 }
      }

      // `now` can go backwards between calls (clock adjustment, or a test
      // feeding times out of order). Clamping the elapsed time at zero means
      // the worst a backwards clock can do is withhold a refill, never grant
      // one, and never push `tokens` above capacity.
      const elapsed = Math.max(0, now - existing.updatedAt)
      const tokens = Math.min(
        policy.limit,
        existing.tokens + elapsed * refillPerMs
      )

      if (tokens < 1) {
        // Not spent — see the note above. Report the wait to the next whole
        // token, at least one second so the answer is never "retry now".
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((1 - tokens) / refillPerMs / 1000)
        )
        const firstRefusal = !existing.refusing
        touch(key, { tokens, updatedAt: now, refusing: true })
        return { allowed: false, retryAfterSeconds, firstRefusal }
      }

      const remaining = tokens - 1
      touch(key, { tokens: remaining, updatedAt: now, refusing: false })
      return { allowed: true, remaining: Math.floor(remaining) }
    },
    size() {
      return buckets.size
    },
    reset() {
      buckets.clear()
    },
  }
}

/** The store the middleware uses. One per server instance, by construction. */
export const rateLimitStore = createRateLimitStore()

// ─── Who is calling ─────────────────────────────────────────────────────────

/**
 * The caller's address, as far as it can be trusted.
 *
 * Read in this order:
 *
 *   x-vercel-forwarded-for  Vercel's own record of the connecting peer.
 *                           `x-vercel-*` is reserved: the platform strips a
 *                           client-supplied copy before the function sees it,
 *                           so this one cannot be forged from outside.
 *   x-real-ip               Also set by the platform.
 *   x-forwarded-for         The LAST entry, never the first. A proxy APPENDS
 *                           the peer it accepted the connection from, so the
 *                           list reads `claimed, ..., actual` and the only
 *                           entry the edge wrote is the final one. Taking the
 *                           first — the common mistake — lets a caller pick
 *                           their own bucket by sending the header themselves.
 *                           Taking the last is right whether the edge appends
 *                           to a client-supplied header or replaces it, and
 *                           `Headers.get` already joins duplicate headers into
 *                           one comma list, so a doubled header collapses to
 *                           the same answer.
 *
 * `null` means no proxy set any of them, which in this deployment means the
 * request did not come through Vercel's edge: local `next dev`, or a direct
 * hit on an origin that should not be reachable. See `rateLimitKey` for what
 * is done with that.
 */
export function clientIpFromHeaders(headers: Headers): string | null {
  const vercel = headers.get('x-vercel-forwarded-for')?.trim()
  if (vercel) return lastForwardedEntry(vercel)

  const real = headers.get('x-real-ip')?.trim()
  if (real) return real

  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) return lastForwardedEntry(forwarded)

  return null
}

function lastForwardedEntry(value: string): string | null {
  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  return entries.length > 0 ? entries[entries.length - 1]! : null
}

/**
 * The bucket a call is charged to.
 *
 * A signed-in caller is keyed by their user id, not their address. That is
 * deliberate and it is the Nigerian-network case: carrier-grade NAT puts a
 * very large number of real phones behind one public address, so an
 * address-only key would have a busy contest throttling genuine voters in
 * groups. A session is also the identity that can actually be dealt with if it
 * misbehaves. An attacker can of course sign up to get their own bucket — that
 * trades anonymity for a budget no larger than the one they already had.
 *
 * Reads and writes are separate buckets for the same caller, so browsing
 * cannot exhaust the budget for casting a vote and vice versa.
 *
 * When there is no address and no session the call is charged to one shared
 * `unattributed` bucket. Failing OPEN there would make the brake removable by
 * anyone who could strip a header; failing into a single shared bucket
 * degrades to a global cap instead, which is the safe direction. In production
 * this bucket should never be touched, because Vercel always sets the header —
 * so traffic landing in it is a signal that something is in front of the app
 * that should not be.
 */
export function rateLimitKey(args: {
  kind: RateLimitKind
  headers: Headers
  userId: string | null
}): string {
  if (args.userId) return `${args.kind}:user:${args.userId}`
  const ip = clientIpFromHeaders(args.headers)
  if (ip) return `${args.kind}:ip:${ip}`
  return `${args.kind}:unattributed`
}

// ─── Configuration ──────────────────────────────────────────────────────────

export type RateLimitSettings = {
  enabled: boolean
  read: RateLimitPolicy
  write: RateLimitPolicy
}

/**
 * The live settings, from the environment (see packages/env/src/core.ts, which
 * parses and range-checks them at boot so a bad value fails the deploy instead
 * of resolving to NaN on the request path).
 *
 * ── Why these numbers ──
 * Reads, 300/minute. Every value between roughly 60 and 600 stops a
 * single-host flood just as completely — a script does thousands a second —
 * so the limit belongs at the top of the plausible-legitimate range rather
 * than the bottom. A page view costs one call per query in its batch, a
 * handful at most, so 300 is somewhere north of 75 page views a minute from
 * one address: comfortably above a person, and above a modest crowd sharing a
 * carrier NAT.
 *
 * Writes, 30/minute. The write set is checkout starts, form submissions,
 * one-time code requests, nominations, reviews, voucher checks and vote casts.
 * Each is a transaction, and several send an email or open a Flutterwave
 * session. One every two seconds, sustained, is far more than a person clicks
 * and far less than bulk abuse needs. The per-resource limits underneath —
 * the vote-code cooldown, the nomination cap — are untouched and still
 * decide what a given email or nominator may do; this only decides how fast
 * anyone may ask.
 */
export const rateLimitSettings: RateLimitSettings = {
  enabled: env.RATE_LIMIT_ENABLED,
  read: { limit: env.RATE_LIMIT_READS_PER_MINUTE, windowMs: MINUTE_MS },
  write: { limit: env.RATE_LIMIT_WRITES_PER_MINUTE, windowMs: MINUTE_MS },
}

// ─── What this does not do ──────────────────────────────────────────────────
//
// Not covered, and not pretended otherwise:
//
//   Page requests. This is a tRPC middleware. Next.js route handlers — the
//     Flutterwave webhook and the cron reconciliation endpoint among them —
//     and server-rendered pages never pass through it. For the webhook and the
//     cron that is the point and it is asserted in the tests; for pages it is
//     a gap, and the fix is Vercel's firewall or Next middleware, not this.
//   A distributed flood. Per-instance memory means a caller spread across
//     enough instances, or enough addresses, is not meaningfully slowed.
//   A deploy. Every instance starts empty, so a redeploy during an attack
//     returns the full budget.
//
// What would close those: a shared counter (Upstash/Vercel KV — an
// `INCR` with `EXPIRE`, or @upstash/ratelimit, keyed the same way as
// `rateLimitKey` above), plus Vercel's firewall in front of the page routes.
// Both are infrastructure this repository does not have provisioned today;
// adding the dependency without the service would be worse than this.
