import { eq } from 'drizzle-orm'

import { db, platformSettings, PLATFORM_SETTINGS_ROW_ID } from '@ticketur/db'
import type { Database } from '@ticketur/db'

import { clampFeeBps, DEFAULT_FEE_RATES, type FeeRates } from './fees'

// Reading the platform service-fee rates. Every fee calculation on the server
// goes through here; nothing else reads the settings row.
//
// ── No cache, on purpose ──
// This is one primary-key lookup of a three-integer row, once per checkout —
// next to the four or five queries checkout already runs, and the Flutterwave
// round trip after them, it does not register. Caching it would buy nothing
// measurable and cost the one property that matters: on serverless there is no
// single process to invalidate, so a cached rate would live on in every warm
// instance until its TTL expired, and an admin who had just corrected a typo
// would watch orders keep being charged the old rate with nothing to do about
// it but wait. A fee change takes effect on the very next checkout instead.
//
// ── Why a missing row is not an error ──
// Nothing seeds this table, and the admin screen may never have been opened.
// The absence of the row means "nobody has changed anything", which is exactly
// 500/500/500 — the same values the column defaults carry. So the platform
// charges today's 5% from the moment this ships, and `updateFees` inserts the
// row the first time someone saves.

// Either the pooled client or an open transaction. Both carry the same
// `select`, and `updateFees` reads the rates from inside its transaction so
// the "previous" values it records are the ones it actually replaced.
export type FeeRateReader = Pick<Database, 'select'>

export type StoredFeeRates = {
  rates: FeeRates
  // When the rates were last saved, and by whom. Both null while no admin has
  // ever saved: the platform is running on the defaults.
  updatedAt: Date | null
  updatedBy: string | null
}

/**
 * The stored rates, with who last changed them and when.
 *
 * Falls back to the 500 bp default for any rate that is missing or out of
 * range, so a caller can never be handed a rate it is unsafe to multiply money
 * by. `usingDefaults` is simply `updatedAt === null`.
 */
export async function getStoredFeeRates(
  database: FeeRateReader = db
): Promise<StoredFeeRates> {
  const [row] = await database
    .select({
      ticketFeeBps: platformSettings.ticketFeeBps,
      registrationFeeBps: platformSettings.registrationFeeBps,
      voteFeeBps: platformSettings.voteFeeBps,
      updatedBy: platformSettings.updatedBy,
      updatedAt: platformSettings.updatedAt,
    })
    .from(platformSettings)
    .where(eq(platformSettings.id, PLATFORM_SETTINGS_ROW_ID))
    .limit(1)

  if (!row) {
    return { rates: { ...DEFAULT_FEE_RATES }, updatedAt: null, updatedBy: null }
  }

  return {
    rates: {
      ticket: clampFeeBps(row.ticketFeeBps),
      registration: clampFeeBps(row.registrationFeeBps),
      vote: clampFeeBps(row.voteFeeBps),
    },
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  }
}

/**
 * The stored rates, read under a row lock.
 *
 * ONLY for `admin.settings.updateFees`, and only inside its transaction. Never
 * call this on a checkout path: it would serialise every order on this one row
 * and turn a config lookup into a platform-wide bottleneck.
 *
 * What the lock buys is an honest audit trail. Two admins saving at the same
 * instant would otherwise both read the old rates and both record them as the
 * values they replaced, so the log would claim a change that had already been
 * superseded. With the lock the second save waits, re-reads, and records what
 * the first one actually left behind.
 *
 * When the row does not exist yet there is nothing to lock, and that is
 * correct: both racing saves genuinely did replace the defaults, so both
 * record 500/500/500, and the upsert settles which one's values survive.
 */
export async function lockStoredFeeRates(
  database: FeeRateReader
): Promise<StoredFeeRates> {
  const [row] = await database
    .select({
      ticketFeeBps: platformSettings.ticketFeeBps,
      registrationFeeBps: platformSettings.registrationFeeBps,
      voteFeeBps: platformSettings.voteFeeBps,
      updatedBy: platformSettings.updatedBy,
      updatedAt: platformSettings.updatedAt,
    })
    .from(platformSettings)
    .where(eq(platformSettings.id, PLATFORM_SETTINGS_ROW_ID))
    .for('update')
    .limit(1)

  if (!row) {
    return { rates: { ...DEFAULT_FEE_RATES }, updatedAt: null, updatedBy: null }
  }
  return {
    rates: {
      ticket: clampFeeBps(row.ticketFeeBps),
      registration: clampFeeBps(row.registrationFeeBps),
      vote: clampFeeBps(row.voteFeeBps),
    },
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  }
}

/**
 * The three service-fee rates in basis points. The one call every fee
 * calculation on the server makes.
 */
export async function getFeeRates(database: FeeRateReader = db): Promise<FeeRates> {
  const stored = await getStoredFeeRates(database)
  return stored.rates
}

/** The rate charged on ticket checkout, in basis points. */
export async function getTicketFeeBps(database: FeeRateReader = db): Promise<number> {
  const rates = await getFeeRates(database)
  return rates.ticket
}

/** The rate charged on a registration-form fee, in basis points. */
export async function getRegistrationFeeBps(
  database: FeeRateReader = db
): Promise<number> {
  const rates = await getFeeRates(database)
  return rates.registration
}

/**
 * The rate paid contest voting will charge, in basis points. Stored and
 * readable so it is already configured and already audited on the day voting
 * ships; nothing charges it yet.
 */
export async function getVoteFeeBps(database: FeeRateReader = db): Promise<number> {
  const rates = await getFeeRates(database)
  return rates.vote
}
