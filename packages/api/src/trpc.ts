import { initTRPC, TRPCError } from '@trpc/server'
import superjson from 'superjson'

import type { Session } from '@ticketur/auth'
import { db } from '@ticketur/db'

import {
  RateLimitedError,
  rateLimitKey,
  rateLimitMessage,
  rateLimitSettings,
  rateLimitStore,
  rateLimitedRetryAfter,
  type RateLimitKind,
} from './lib/rate-limit'

export type Context = {
  session: Session | null
  db: typeof db
  /**
   * The inbound request's headers, when this call arrived over the network.
   *
   * `null` means it did NOT: a React Server Component prefetching through the
   * in-process caller, a script, a test. Those calls are exempt from rate
   * limiting, because there is no remote caller to attribute them to and the
   * only thing that can produce such a context is our own server code — an
   * attacker only ever reaches the router through /api/trpc, which always
   * passes real headers.
   *
   * Required rather than optional on purpose. A new transport that forgets to
   * pass headers would silently opt itself out of the brake; making every
   * call site state which kind of caller it is turns that into a type error.
   */
  headers: Headers | null
}

export async function createTRPCContext({
  session,
  headers,
}: {
  session: Session | null
  headers: Headers | null
}): Promise<Context> {
  return { session, db, headers }
}

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    // A throttled caller gets the wait in machine-readable form as well as in
    // the message. The `Retry-After` header only reaches the caller on the
    // non-streaming transports (see `rateLimitResponseMeta`), so for the
    // streaming batch link this is the only place the number survives.
    const retryAfterSeconds = rateLimitedRetryAfter(error)
    if (retryAfterSeconds === null) return shape
    return { ...shape, data: { ...shape.data, retryAfterSeconds } }
  },
})

export const createTRPCRouter = t.router
export const createCallerFactory = t.createCallerFactory

// ─── Rate limiting ──────────────────────────────────────────────────────────

/**
 * The volume brake on the public API. See lib/rate-limit.ts for where the
 * counter lives, how the key is chosen, and what this does not protect
 * against.
 *
 * It hangs off `publicProcedure` and only off `publicProcedure`, so:
 *   - every public procedure is covered, including ones not written yet;
 *   - `adminProcedure` is NOT covered, and cannot become covered by accident,
 *     because it is built from `t.procedure` and never from this one;
 *   - the Flutterwave webhook and the cron reconciliation endpoint are not
 *     covered either, and could not be: they are Next.js route handlers that
 *     never enter the tRPC middleware chain at all. Dropping a payment
 *     notification is the one failure that costs real money, and the
 *     protection against it is structural rather than a condition somebody
 *     has to keep correct.
 *
 * The read/write split comes from the procedure `type`, so a new procedure is
 * charged to the right budget without being annotated.
 */
const throttlePublicCalls = t.middleware(({ ctx, type, path, next }) => {
  if (!rateLimitSettings.enabled) return next()

  // No headers means an in-process caller — see Context.headers.
  if (!ctx.headers) return next()

  const kind: RateLimitKind = type === 'query' ? 'read' : 'write'
  const key = rateLimitKey({
    kind,
    headers: ctx.headers,
    userId: ctx.session?.user?.id ?? null,
  })

  const decision = rateLimitStore.take(key, rateLimitSettings[kind], Date.now())
  if (decision.allowed) return next()

  if (decision.firstRefusal) {
    // Once per run, not once per refused call — see RateLimitDecision.
    console.warn('[rate-limit] holding a caller back', {
      key,
      kind,
      path,
      retryAfterSeconds: decision.retryAfterSeconds,
      limitPerMinute: rateLimitSettings[kind].limit,
    })
  }

  throw new TRPCError({
    code: 'TOO_MANY_REQUESTS',
    message: rateLimitMessage(kind, decision.retryAfterSeconds),
    cause: new RateLimitedError(decision.retryAfterSeconds),
  })
})

/**
 * `Retry-After` for a response carrying a rate-limit refusal, for the
 * `responseMeta` hook of a fetch adapter.
 *
 * Returns `{}` when nothing in the response was throttled, so a handler can
 * spread it unconditionally.
 *
 * ── The honest caveat ──
 * tRPC calls `responseMeta` before the procedures run when the response is
 * streamed, because the headers have to go out first. The app's client uses
 * `httpBatchStreamLink`, so on that path `errors` is empty here and no header
 * is set; the refusal still arrives, per call, in the JSONL body with its
 * message and `data.retryAfterSeconds`. The header does get set for every
 * non-streaming request — which is what a plain `curl`, an unbatched client
 * or a crawler sends, and therefore what a flood tends to look like.
 */
export function rateLimitResponseMeta(opts: { errors: readonly unknown[] }): {
  headers?: Record<string, string>
} {
  let longest: number | null = null
  for (const error of opts.errors) {
    const seconds = rateLimitedRetryAfter(error)
    if (seconds !== null && (longest === null || seconds > longest)) {
      longest = seconds
    }
  }
  // A batch can hold several refusals; the header has to describe one wait, so
  // it describes the longest — the point at which the whole batch is safe to
  // repeat.
  return longest === null ? {} : { headers: { 'Retry-After': String(longest) } }
}

/** True for a refusal this middleware produced. Keeps a flood out of the error log. */
export function isRateLimitError(error: unknown): boolean {
  return rateLimitedRetryAfter(error) !== null
}

// ─── Procedures ─────────────────────────────────────────────────────────────

export const publicProcedure = t.procedure.use(throttlePublicCalls)

const requireSession = t.middleware(({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({ code: 'UNAUTHORIZED' })
  }
  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
    },
  })
})

export const protectedProcedure = t.procedure.use(requireSession)

const requireOrganizer = requireSession.unstable_pipe(({ ctx, next }) => {
  const role = ctx.session.user.role ?? 'attendee'
  if (role !== 'organizer' && role !== 'admin') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Organizer role required',
    })
  }
  return next({ ctx })
})

export const organizerProcedure = t.procedure.use(requireOrganizer)

const requireVendor = requireSession.unstable_pipe(({ ctx, next }) => {
  const role = ctx.session.user.role ?? 'attendee'
  if (role !== 'vendor' && role !== 'admin') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Vendor role required' })
  }
  return next({ ctx })
})

export const vendorProcedure = t.procedure.use(requireVendor)

const requireAdmin = requireSession.unstable_pipe(({ ctx, next }) => {
  const role = ctx.session.user.role ?? 'attendee'
  if (role !== 'admin') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin role required' })
  }
  return next({ ctx })
})

export const adminProcedure = t.procedure.use(requireAdmin)
