import {
  randomBytes,
  randomInt,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto'
import { promisify } from 'node:util'

import { and, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm'

import type { Database } from '@ticketur/db'
import { voteOtps } from '@ticketur/db'

import { newId } from './ids'
import { normalizeVoterEmail, type DbTransaction } from './votes'

// One-time codes that prove the email behind a FREE vote.
//
// better-auth's emailOTP plugin verifies emails that belong to an ACCOUNT, and
// a casual voter does not have one — so free voting carries its own codes in
// `vote_otps`. Nothing here ever reads the `user` table: requesting a code
// must not reveal whether that address has a Ticketeur account, and the surest
// way to guarantee that is for this module never to be able to find out.
//
// ── Where each guarantee lives ──
//   the code is not recoverable from the database → only a scrypt digest is
//     stored, with a per-row salt. See hashVoteCode.
//   a code cannot be brute-forced → an attempt is CLAIMED from the row by a
//     conditional UPDATE before the comparison happens, so the database, not
//     this process, decides whether a guess is allowed. See verifyVoteCode.
//   a code is used once → consumeVoteCode's conditional UPDATE on
//     `consumed_at is null`, run inside the caller's vote transaction.
//   a stranger's inbox is not a toy → issueVoteCode's cooldown and ceiling.
//
// ── The one rule a caller must not break ──
// verifyVoteCode must run OUTSIDE the vote transaction and consumeVoteCode
// INSIDE it. The attempt counter is the anti-brute-force budget and has to
// survive a refused vote; the consumption has to roll back with one, so a
// voter whose cast was turned down still holds a usable code.

// ─── Tuning ─────────────────────────────────────────────────────────────────

/** Digits in a code. Six is what every other OTP on the platform uses. */
export const VOTE_CODE_LENGTH = 6

/** How long a code lives. Short, because it is only ever typed straight away. */
export const VOTE_CODE_TTL_MS = 10 * 60 * 1000

/** The same figure in minutes, for the email that carries the code. */
export const VOTE_CODE_TTL_MINUTES = VOTE_CODE_TTL_MS / 60_000

/**
 * Guesses a single code is worth. A guess COSTS one whether it is right or
 * wrong, so this is the total number of times a code may be presented.
 *
 * Six digits is 10^6 codes; five guesses is a 1-in-200,000 chance per code,
 * and an attacker cannot buy more guesses by asking for more codes — a wrong
 * guess strikes every live code for that (email, contest) at once.
 */
export const MAX_VERIFY_ATTEMPTS = 5

/** The smallest gap between two code requests for one (email, contest). */
export const REQUEST_COOLDOWN_MS = 60 * 1000

/** The window the request ceiling is counted over. */
export const REQUEST_WINDOW_MS = 60 * 60 * 1000

/**
 * Codes one (email, contest) may be sent per window. Deliberately low: this is
 * what stops someone using the vote page to bomb a stranger's inbox.
 *
 * It is also, in practice, how many categories a voter can free-vote in within
 * an hour, because a code is single-use. See the note in vote-free.ts.
 */
export const MAX_REQUESTS_PER_WINDOW = 6

/**
 * Live codes a single verify will test a guess against. Bounds the scrypt work
 * one request can cause; MAX_REQUESTS_PER_WINDOW already keeps the real number
 * at or below this.
 */
const MAX_VERIFY_CANDIDATES = MAX_REQUESTS_PER_WINDOW

// ─── Hashing ────────────────────────────────────────────────────────────────

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number }
) => Promise<Buffer>

// scrypt parameters. 128 * N * r = 16 MiB of memory per call, and measured at
// ~35ms of CPU on a developer laptop — nothing against the two database round
// trips either side of it. For someone holding a stolen row that puts the 10^6
// candidate codes at roughly 10 CPU-hours single-threaded: not unbreakable,
// and not meant to be. It only has to outlast the ten minutes before the code
// expires, and it does so by two orders of magnitude.
const SCRYPT_N = 16_384
const SCRYPT_R = 8
const SCRYPT_P = 1
const SCRYPT_KEY_BYTES = 32
const SCRYPT_SALT_BYTES = 16
// Stored format: scheme$N$r$p$salt$hash, both parts base64url. Versioned by
// the scheme tag so the parameters can be raised later without invalidating
// rows written under the old ones — a digest this function cannot parse is
// refused rather than thrown on.
const SCRYPT_SCHEME = 'scrypt'

/**
 * The string that is hashed. Binding the contest and the email in means a
 * digest is only ever meaningful for the row it was written on: lifting one
 * into another contest's row, or another voter's, cannot make it verify.
 */
function codePreimage(args: {
  contestId: string
  email: string
  code: string
}): string {
  return `${args.contestId}\u0000${args.email}\u0000${args.code}`
}

/**
 * A six-digit code, from the CSPRNG. `randomInt` is rejection-sampled by Node,
 * so every value in the range is equally likely — `randomBytes() % 1e6` would
 * not be, and the bias is exactly the kind of thing nobody notices.
 */
export function generateVoteCode(): string {
  const max = 10 ** VOTE_CODE_LENGTH
  return String(randomInt(0, max)).padStart(VOTE_CODE_LENGTH, '0')
}

/** What goes in `vote_otps.code_hash`. Never the code itself. */
export async function hashVoteCode(args: {
  contestId: string
  email: string
  code: string
}): Promise<string> {
  const salt = randomBytes(SCRYPT_SALT_BYTES)
  const derived = await scrypt(codePreimage(args), salt, SCRYPT_KEY_BYTES, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  })
  return [
    SCRYPT_SCHEME,
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$')
}

/**
 * Whether `code` is the one `stored` was written from. Constant-time in the
 * digest, so a timing difference cannot leak how much of a guess was right.
 * A malformed or unknown-scheme digest is a `false`, never a throw: one bad
 * row must not take the verify path down for everybody.
 */
export async function voteCodeMatches(
  stored: string,
  args: { contestId: string; email: string; code: string }
): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6) return false
  const [scheme, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ]
  if (scheme !== SCRYPT_SCHEME) return false

  const N = Number(nRaw)
  const r = Number(rRaw)
  const p = Number(pRaw)
  // Parameters come out of the database, so they are checked before being
  // handed to scrypt: a row carrying an absurd N would otherwise be a way to
  // make one verify allocate gigabytes.
  if (
    !Number.isSafeInteger(N) ||
    !Number.isSafeInteger(r) ||
    !Number.isSafeInteger(p) ||
    N < 1024 ||
    N > SCRYPT_N ||
    r < 1 ||
    r > 16 ||
    p < 1 ||
    p > 4
  ) {
    return false
  }

  let expected: Buffer
  try {
    expected = Buffer.from(hashRaw, 'base64url')
    if (expected.length === 0) return false
    const salt = Buffer.from(saltRaw, 'base64url')
    if (salt.length === 0) return false
    const actual = await scrypt(codePreimage(args), salt, expected.length, {
      N,
      r,
      p,
    })
    return timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

// ─── Issuing ────────────────────────────────────────────────────────────────

export type IssueVoteCodeRefusal = 'cooldown' | 'too_many'

export type IssueVoteCodeResult =
  | {
      issued: true
      // The PLAINTEXT code, which exists only here and in the email. It is
      // never stored and never returned to the browser.
      code: string
      expiresAt: Date
    }
  | {
      issued: false
      reason: IssueVoteCodeRefusal
      // Whole seconds the caller should wait. Always at least 1.
      retryAfterSeconds: number
    }

function secondsUntil(target: number, now: number): number {
  return Math.max(1, Math.ceil((target - now) / 1000))
}

/**
 * Mint a code for (contest, email) and store its digest.
 *
 * Refuses on two counters, both scoped to that pair:
 *   cooldown  — a code was already sent in the last REQUEST_COOLDOWN_MS.
 *   too_many  — MAX_REQUESTS_PER_WINDOW codes already went out this window.
 * Together they stop the vote page being used as a mailer, and stop an
 * attacker minting enough codes to make guessing worthwhile.
 *
 * ── The honest limit ──
 * This is a read followed by an insert, not one statement, so a burst of
 * genuinely simultaneous requests can overshoot the ceiling by the size of the
 * burst. There is no column to hang a race-free counter on and the schema is
 * frozen, and the overshoot is bounded and costs the attacker nothing but
 * emails to an address they already named. Every rule that decides whether a
 * VOTE counts is race-free; this one is a courtesy to an inbox.
 *
 * Previous live codes are deliberately NOT invalidated. A voter who asks again
 * because the first email was slow can still use whichever one arrives, and
 * the guess budget does not grow by holding several: verifyVoteCode charges an
 * attempt against every live code at once.
 */
export async function issueVoteCode(
  db: Database,
  args: { contestId: string; email: string; now?: Date }
): Promise<IssueVoteCodeResult> {
  const now = args.now ?? new Date()
  const email = normalizeVoterEmail(args.email)
  const windowStart = new Date(now.getTime() - REQUEST_WINDOW_MS)

  const recent = await db
    .select({ createdAt: voteOtps.createdAt })
    .from(voteOtps)
    .where(
      and(
        eq(voteOtps.email, email),
        eq(voteOtps.contestId, args.contestId),
        gt(voteOtps.createdAt, windowStart)
      )
    )
    .orderBy(desc(voteOtps.createdAt))
    .limit(MAX_REQUESTS_PER_WINDOW)

  if (recent.length >= MAX_REQUESTS_PER_WINDOW) {
    // The window frees up when its OLDEST request falls out of it.
    const oldest = recent[recent.length - 1]!.createdAt.getTime()
    return {
      issued: false,
      reason: 'too_many',
      retryAfterSeconds: secondsUntil(
        oldest + REQUEST_WINDOW_MS,
        now.getTime()
      ),
    }
  }

  const newest = recent[0]
  if (newest) {
    const readyAt = newest.createdAt.getTime() + REQUEST_COOLDOWN_MS
    if (readyAt > now.getTime()) {
      return {
        issued: false,
        reason: 'cooldown',
        retryAfterSeconds: secondsUntil(readyAt, now.getTime()),
      }
    }
  }

  const code = generateVoteCode()
  const expiresAt = new Date(now.getTime() + VOTE_CODE_TTL_MS)
  await db.insert(voteOtps).values({
    id: newId('votp'),
    contestId: args.contestId,
    email,
    codeHash: await hashVoteCode({ contestId: args.contestId, email, code }),
    expiresAt,
    attempts: 0,
    consumedAt: null,
    createdAt: now,
  })

  return { issued: true, code, expiresAt }
}

// ─── Verifying ──────────────────────────────────────────────────────────────

export type VerifyVoteCodeFailure =
  // Nothing was ever sent to this address for this contest.
  | 'no_code'
  // There was one, and it has run out of time.
  | 'expired'
  // There was one, and it has already been spent on a vote.
  | 'consumed'
  // The guesses are gone. Asking for a fresh code is the only way on.
  | 'locked'
  // A live code exists and this is not it.
  | 'wrong'

export type VerifyVoteCodeResult =
  { ok: true; otpId: string } | { ok: false; reason: VerifyVoteCodeFailure }

/**
 * Check a code, spending one of its attempts to do so.
 *
 * ── Why the counter moves FIRST ──
 * The UPDATE below claims an attempt from every live code for this
 * (email, contest) and returns the digests it claimed from. The database
 * decides whether a guess is affordable, in one statement, before this process
 * compares anything — so a thousand concurrent guesses serialize on those rows
 * and only MAX_VERIFY_ATTEMPTS of them ever reach a comparison. Reading
 * `attempts`, comparing, and then writing it back would let every one of those
 * thousand read the same low count and all go through: a six-digit code would
 * fall in seconds.
 *
 * A correct guess also costs an attempt. That is fine — a correct guess is
 * about to consume the code anyway.
 *
 * MUST be called on `db`, never on a transaction handle. The whole point of
 * the counter is that it survives; inside the vote transaction a refused vote
 * would roll the attempt back and hand the budget straight back to a guesser.
 */
export async function verifyVoteCode(
  db: Database,
  args: { contestId: string; email: string; code: string; now?: Date }
): Promise<VerifyVoteCodeResult> {
  const now = args.now ?? new Date()
  const email = normalizeVoterEmail(args.email)
  const code = args.code.trim()

  const claimed = await db
    .update(voteOtps)
    .set({ attempts: sql`${voteOtps.attempts} + 1` })
    .where(
      and(
        eq(voteOtps.email, email),
        eq(voteOtps.contestId, args.contestId),
        isNull(voteOtps.consumedAt),
        gt(voteOtps.expiresAt, now),
        lt(voteOtps.attempts, MAX_VERIFY_ATTEMPTS)
      )
    )
    .returning({ id: voteOtps.id, codeHash: voteOtps.codeHash })

  if (claimed.length > 0) {
    // Every live code is tested, so a voter holding two codes can use either.
    // Bounded by MAX_VERIFY_CANDIDATES so the scrypt work one request can
    // trigger is capped whatever else went wrong.
    for (const row of claimed.slice(0, MAX_VERIFY_CANDIDATES)) {
      if (await voteCodeMatches(row.codeHash, { ...args, email, code })) {
        return { ok: true, otpId: row.id }
      }
    }
    return { ok: false, reason: 'wrong' }
  }

  // Nothing was claimable. Work out which flavour of "no" this is, purely so
  // the voter can be told something useful — only reached on the failure path,
  // and only after a guess was already spent, so it reveals nothing a guesser
  // did not already pay for.
  return {
    ok: false,
    reason: await classifyNoLiveCode(db, args.contestId, email, now),
  }
}

async function classifyNoLiveCode(
  db: Database,
  contestId: string,
  email: string,
  now: Date
): Promise<VerifyVoteCodeFailure> {
  const [latest] = await db
    .select({
      expiresAt: voteOtps.expiresAt,
      consumedAt: voteOtps.consumedAt,
      attempts: voteOtps.attempts,
    })
    .from(voteOtps)
    .where(and(eq(voteOtps.email, email), eq(voteOtps.contestId, contestId)))
    .orderBy(desc(voteOtps.createdAt))
    .limit(1)

  if (!latest) return 'no_code'
  if (latest.consumedAt !== null) return 'consumed'
  if (latest.expiresAt <= now) return 'expired'
  if (latest.attempts >= MAX_VERIFY_ATTEMPTS) return 'locked'
  // The newest row is live but the UPDATE claimed nothing: it was consumed or
  // expired between the two statements. 'consumed' is the useful answer.
  return 'consumed'
}

// ─── Consuming ──────────────────────────────────────────────────────────────

/**
 * Spend the code, so it can never verify again.
 *
 * Takes a TRANSACTION handle on purpose, and must be called inside the one the
 * vote lands in:
 *   - a vote that is refused rolls this back, so the voter keeps a code they
 *     were never allowed to spend;
 *   - two requests holding the same code cannot both spend it, because the
 *     `consumed_at is null` in the WHERE clause is re-evaluated against the
 *     winner's committed row and the loser matches nothing.
 *
 * `false` means somebody else got there first — or the code expired in the
 * moments since it verified. Either way the caller must refuse the vote.
 */
export async function consumeVoteCode(
  tx: DbTransaction,
  args: { otpId: string; now?: Date }
): Promise<boolean> {
  const now = args.now ?? new Date()
  const spent = await tx
    .update(voteOtps)
    .set({ consumedAt: now })
    .where(
      and(
        eq(voteOtps.id, args.otpId),
        isNull(voteOtps.consumedAt),
        gt(voteOtps.expiresAt, now)
      )
    )
    .returning({ id: voteOtps.id })
  return spent.length > 0
}
