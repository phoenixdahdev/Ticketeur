import { fetchRequestHandler } from '@trpc/server/adapters/fetch'

import type { Session } from '@ticketur/auth'

import {
  adminProcedure,
  createTRPCContext,
  createTRPCRouter,
  publicProcedure,
  rateLimitResponseMeta,
} from '../trpc'

// A router built from the REAL procedure builders, driven through the REAL
// fetch adapter the two apps use.
//
// The point of going through `fetchRequestHandler` rather than a direct caller
// is that the rate limiter's two externally visible effects — the HTTP status
// and the `Retry-After` header — only exist on that path. Testing the
// middleware in isolation would prove the throw and nothing about what a
// caller actually receives.

export const harnessRouter = createTRPCRouter({
  publicRead: publicProcedure.query(() => 'ok'),
  publicWrite: publicProcedure.mutation(() => 'ok'),
  adminRead: adminProcedure.query(() => 'ok'),
  adminWrite: adminProcedure.mutation(() => 'ok'),
})

/**
 * A session for the role under test. `Session` is better-auth's own shape and
 * only `user.id` and `user.role` are read by anything in trpc.ts, so the rest
 * is not worth reconstructing.
 */
export function sessionFor(role: 'admin' | 'attendee', id = `u_${role}`) {
  return {
    session: { id: `s_${id}`, userId: id },
    user: { id, role },
  } as unknown as Session
}

export type HarnessCall = {
  path: keyof typeof harnessRouter._def.procedures & string
  type: 'query' | 'mutation'
  /** Headers on the inbound request, i.e. what a real caller sent. */
  headers?: Record<string, string>
  session?: Session | null
  /** `false` drives the in-process caller instead of the network one. */
  overNetwork?: boolean
}

export type HarnessResult = {
  status: number
  retryAfter: string | null
  /** The tRPC error code, or null when the call succeeded. */
  code: string | null
  /** The status inside the error shape, which is what the client reads. */
  httpStatus: number | null
  message: string | null
  retryAfterSeconds: number | null
}

/** Make one call the way a browser or a `curl` would, and read the answer. */
export async function call(opts: HarnessCall): Promise<HarnessResult> {
  const url = `https://ticketeur.test/api/trpc/${opts.path}`
  const headers = new Headers(opts.headers ?? {})
  const req =
    opts.type === 'query'
      ? new Request(url, { method: 'GET', headers })
      : new Request(url, {
          method: 'POST',
          headers: (() => {
            const h = new Headers(headers)
            h.set('content-type', 'application/json')
            return h
          })(),
          body: '{}',
        })

  const session = opts.session ?? null
  const overNetwork = opts.overNetwork ?? true

  const res = await fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: harnessRouter,
    createContext: () =>
      createTRPCContext({
        session,
        headers: overNetwork ? req.headers : null,
      }),
    responseMeta: rateLimitResponseMeta,
  })

  // superjson is the configured transformer, so an error arrives wrapped:
  // `{ error: { json: <shape>, meta } }`. Unwrapped defensively so this does
  // not quietly read `undefined` — and report a pass — if the transformer
  // ever changes.
  type ErrorShape = {
    message?: string
    data?: { code?: string; httpStatus?: number; retryAfterSeconds?: number }
  }
  const body = (await res.json()) as {
    error?: ErrorShape & { json?: ErrorShape }
  }
  const error: ErrorShape | undefined = body.error?.json ?? body.error

  return {
    status: res.status,
    retryAfter: res.headers.get('retry-after'),
    code: error?.data?.code ?? null,
    httpStatus: error?.data?.httpStatus ?? null,
    message: error?.message ?? null,
    retryAfterSeconds: error?.data?.retryAfterSeconds ?? null,
  }
}

/** Make the same call `times` times and return the results in order. */
export async function callTimes(
  times: number,
  opts: HarnessCall
): Promise<HarnessResult[]> {
  const results: HarnessResult[] = []
  for (let i = 0; i < times; i++) results.push(await call(opts))
  return results
}

/** Headers as Vercel's edge would present a caller at `ip`. */
export function fromIp(ip: string): Record<string, string> {
  return { 'x-vercel-forwarded-for': ip }
}

export type StreamedRefusal = {
  code: string
  message: string
  retryAfterSeconds: number | null
}

export type StreamedBatchResult = {
  status: number
  retryAfter: string | null
  /** Every refusal in the stream, in the order it was written. */
  refusals: StreamedRefusal[]
  /** The raw JSONL body, for an assertion this helper does not cover. */
  body: string
}

/**
 * One batched, streamed call — what the two apps' own client sends.
 *
 * `httpBatchStreamLink` asks for `application/jsonl`, which makes tRPC write
 * the response headers before any procedure has run. This exists to pin what
 * a caller on that transport actually receives, including the fact that
 * `Retry-After` cannot be among those headers.
 *
 * The body is read by scanning the stream for error shapes rather than by
 * decoding tRPC's chunk framing: the framing is an internal detail that may
 * change, and what is being asserted here is only what reaches the caller.
 */
export async function callStreamedBatch(opts: {
  paths: string[]
  headers?: Record<string, string>
}): Promise<StreamedBatchResult> {
  const headers = new Headers(opts.headers ?? {})
  headers.set('trpc-accept', 'application/jsonl')
  const url = `https://ticketeur.test/api/trpc/${opts.paths.join(',')}?batch=1`
  const req = new Request(url, { method: 'GET', headers })

  const res = await fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: harnessRouter,
    createContext: () =>
      createTRPCContext({ session: null, headers: req.headers }),
    responseMeta: rateLimitResponseMeta,
  })

  const body = await res.text()
  const refusals: StreamedRefusal[] = []
  for (const line of body.split('\n')) {
    if (!line.trim()) continue
    try {
      collectRefusals(JSON.parse(line), refusals)
    } catch {
      // A partial line is not something this helper needs to understand.
    }
  }

  return {
    status: res.status,
    retryAfter: res.headers.get('retry-after'),
    refusals,
    body,
  }
}

/** Walk a decoded JSONL line and collect every error shape in it. */
function collectRefusals(value: unknown, into: StreamedRefusal[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectRefusals(item, into)
    return
  }
  if (!value || typeof value !== 'object') return

  const node = value as Record<string, unknown>
  const error = node['error']
  if (error && typeof error === 'object') {
    const shape = error as Record<string, unknown>
    const data = (shape['data'] ?? {}) as Record<string, unknown>
    if (
      typeof data['code'] === 'string' &&
      typeof shape['message'] === 'string'
    ) {
      into.push({
        code: data['code'],
        message: shape['message'],
        retryAfterSeconds:
          typeof data['retryAfterSeconds'] === 'number'
            ? data['retryAfterSeconds']
            : null,
      })
      return
    }
  }
  for (const child of Object.values(node)) collectRefusals(child, into)
}
