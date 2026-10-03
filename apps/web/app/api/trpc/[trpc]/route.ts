import {
  appRouter,
  createTRPCContext,
  isRateLimitError,
  rateLimitResponseMeta,
} from '@ticketur/api'
import { fetchRequestHandler } from '@trpc/server/adapters/fetch'

import { auth } from '@/lib/auth'

const handler = async (req: Request) => {
  const session = await auth.api.getSession({ headers: req.headers })

  return fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    // The headers are what the rate-limit middleware identifies the caller
    // from; passing them is what marks this as a call that arrived over the
    // network rather than from a server render.
    createContext: () => createTRPCContext({ session, headers: req.headers }),
    responseMeta: rateLimitResponseMeta,
    onError({ error, path, type }) {
      // A throttled call is an expected outcome, not a fault, and logging one
      // line per refusal would make the log bill scale with whatever flood
      // triggered it. The limiter logs once when a caller starts being held
      // back; this stays quiet.
      if (isRateLimitError(error)) return
      // tRPC returns failures inside a normal HTTP 200 envelope, so Next's
      // onRequestError never sees them and procedure failures are invisible in
      // server logs. Record each one with the call path, its kind, the error
      // code, and the caller so a failing procedure can be located.
      console.error('[web] trpc procedure failed', {
        path: path ?? null,
        type,
        code: error.code,
        userId: session?.user?.id ?? null,
        error,
      })
    },
  })
}

export { handler as GET, handler as POST }
