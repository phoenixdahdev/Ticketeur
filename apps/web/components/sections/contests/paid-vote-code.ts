'use client'

// The one-time code a voter is currently spending their bought votes with.
//
// ── Why this is held at all ──
// `castPaid` verifies a code on every spend and deliberately does not consume
// it, so one code covers a short spending session: ten minutes, and five
// casts (packages/api/src/routers/public/vote-checkout.ts says why, and
// `vote_otps` is what actually enforces both). Holding it between dialog
// opens is the whole of the smoothness that buys — a voter splitting a
// balance across six entries types six digits once, not six times.
//
// ── Why it is NOT in localStorage ──
// Unlike the remembered address next door in voter-identity.ts, this is a
// CREDENTIAL. Writing it to disk would turn a ten-minute code into something
// that outlives the tab, survives a shared machine, and sits in site data for
// anything else on this origin to read. It lives in React state and dies with
// the page, which is exactly as long as it should.

export type PaidVoteCode = {
  /** The address the code was sent to, already normalised. */
  email: string
  /** The six digits. Memory only — see above. */
  code: string
  /** When it stops being worth sending, as epoch milliseconds. */
  expiresAtMs: number
}

/**
 * `VOTE_CODE_TTL_MINUTES` from packages/api/src/lib/vote-otp.ts. Mirrored
 * rather than imported, as `MAX_VOTES_PER_CAST` is in lib/vote-pricing.ts,
 * because that module pulls in node:crypto and the database client and
 * cannot go into a browser bundle.
 *
 * Only used as a GUESS, for a code the voter pasted in rather than one this
 * page asked for, where the real `expiresAt` never reached us. A guess that
 * is too generous costs one refused round trip and the server's own words;
 * it cannot make a dead code work.
 */
export const ASSUMED_CODE_TTL_MINUTES = 10

/** Hold a code, from requestCode's `expiresAt` when we were told one. */
export function holdPaidCode(args: {
  email: string
  code: string
  expiresAt: Date | null
}): PaidVoteCode {
  return {
    email: args.email,
    code: args.code,
    expiresAtMs:
      args.expiresAt?.getTime() ??
      Date.now() + ASSUMED_CODE_TTL_MINUTES * 60_000,
  }
}

/**
 * Whether this held code is still worth sending.
 *
 * Advisory, like every clock-based check in this folder: the browser's clock
 * decides what the dialog OFFERS, and `verifyVoteCode` decides what is
 * allowed. A clock that is wrong in one direction costs a round trip and the
 * server's own refusal; one that is wrong in the other asks for a new code
 * slightly early. Neither can authorise anything.
 *
 * It is also scoped to the address: changing who you are voting as drops the
 * credential, because a code is only ever good for the (contest, email) it
 * was minted for and sending it under another address would just burn one of
 * its five presentations.
 */
export function paidCodeFor(
  held: PaidVoteCode | null,
  email: string,
  now: number = Date.now()
): PaidVoteCode | null {
  if (!held) return null
  if (held.email !== email) return null
  if (held.expiresAtMs <= now) return null
  return held
}
