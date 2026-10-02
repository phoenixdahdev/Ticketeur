// Single source of truth for the platform service-fee MATHS. Both the checkout
// mutation (server) and the checkout summary (client) import these so the
// number shown to the buyer is exactly what gets charged.
//
// All money values are in MINOR units (kobo). 100 kobo = ₦1.
// All rates are in BASIS POINTS (1 bp = 0.01%). 500 bp = 5%.
//
// ── Where the rate comes from ──
// The rate used to be the constant SERVICE_FEE_BPS = 500 right here. It is now
// three admin-configurable rates stored in the `platform_settings` row (see
// packages/db/src/schema/platform-settings.ts). A database value cannot be
// imported by a client bundle, so this file deliberately keeps NO imports and
// NO rate of its own beyond the default: it is pure arithmetic that takes the
// rate as an argument.
//
//   server — reads the rate with `getFeeRates` (./platform-settings.ts) and
//            passes it in. That figure is what gets stored on the order and
//            charged.
//   client — receives the rate alongside the thing being priced (it rides on
//            `public.events.bySlug` and `public.forms.bySlug`, the queries the
//            page already makes) and passes it in, for display only.
//
// `feeBps` is a REQUIRED argument on purpose. There is no default parameter to
// fall back on, so a call site that forgets to thread the rate through is a
// type error rather than a silent charge at 5%.

/** The rate every kind of fee starts at, and the rate in force until an admin
 * saves something else: 500 bp = 5%. */
export const DEFAULT_SERVICE_FEE_BPS = 500

/** 0% — a fee can be switched off entirely. */
export const MIN_SERVICE_FEE_BPS = 0
/** 100%. A typo must not be able to set 500%. */
export const MAX_SERVICE_FEE_BPS = 10_000

/** The three kinds of revenue the platform takes a service fee on. */
export type FeeKind = 'ticket' | 'registration' | 'vote'

/** Every rate, in basis points, keyed by what it applies to. */
export type FeeRates = Record<FeeKind, number>

/** What the platform charges before an admin has ever changed anything. */
export const DEFAULT_FEE_RATES: FeeRates = {
  ticket: DEFAULT_SERVICE_FEE_BPS,
  registration: DEFAULT_SERVICE_FEE_BPS,
  vote: DEFAULT_SERVICE_FEE_BPS,
}

/**
 * A rate forced into the allowed range: a whole number of basis points between
 * 0 and 10000. Anything unreadable falls back to the 5% default rather than to
 * zero, so a corrupt value under-charges nobody and over-charges nobody.
 *
 * Identity for every valid rate, 500 included, so this cannot change what a
 * correctly configured platform charges.
 */
export function clampFeeBps(feeBps: number): number {
  if (!Number.isFinite(feeBps)) return DEFAULT_SERVICE_FEE_BPS
  return Math.min(
    MAX_SERVICE_FEE_BPS,
    Math.max(MIN_SERVICE_FEE_BPS, Math.round(feeBps))
  )
}

/** Whether a value is a rate this platform will accept and store. */
export function isValidFeeBps(feeBps: number): boolean {
  return (
    Number.isInteger(feeBps) &&
    feeBps >= MIN_SERVICE_FEE_BPS &&
    feeBps <= MAX_SERVICE_FEE_BPS
  )
}

/**
 * Free tickets pass through without a fee. Otherwise we apply
 * `feeBps / 10000` of the subtotal, rounded to the nearest minor unit. Every
 * consumer reads through this function so the fee shown to the buyer is
 * identical to what gets charged.
 *
 * Integer maths, so there is no float drift on rounding. At the 500 bp default
 * this is exactly the expression the hardcoded version computed:
 * `Math.round((subtotalMinor * 500) / 10_000)`.
 */
export function calculateFeeMinor(
  subtotalMinor: number,
  feeBps: number
): number {
  if (subtotalMinor <= 0) return 0
  return Math.round((subtotalMinor * clampFeeBps(feeBps)) / 10_000)
}

export function calculateTotalMinor(
  subtotalMinor: number,
  feeBps: number
): number {
  return subtotalMinor + calculateFeeMinor(subtotalMinor, feeBps)
}

/**
 * A rate as a percentage string for people: 500 → "5%", 525 → "5.25%",
 * 0 → "0%". Trailing zeros are dropped, because "5%" reads as a decision and
 * "5.00%" reads as a rounding artefact.
 */
export function formatFeeBps(feeBps: number): string {
  const percent = clampFeeBps(feeBps) / 100
  return `${Number(percent.toFixed(2))}%`
}

/**
 * A percentage an admin typed, as basis points. 5 → 500, 5.25 → 525.
 * Returns null when the text is not a percentage this platform will store, so
 * the caller can say so rather than saving a guess.
 */
export function feeBpsFromPercent(percent: string): number | null {
  const trimmed = percent.trim()
  if (trimmed === '') return null
  const value = Number(trimmed)
  if (!Number.isFinite(value)) return null
  // A percentage carries at most two decimals: 1 bp is 0.01%, and there is no
  // finer rate to express.
  const bps = Math.round(value * 100)
  return isValidFeeBps(bps) ? bps : null
}
