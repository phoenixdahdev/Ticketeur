import { calculateFeeMinor } from '@ticketur/api/lib/fees'

// What a vote purchase costs, computed the way the server computes it.
//
// ── Why this is its own module ──
// `public.voteCheckout.buyVotes` decides the money. This file exists so the
// page can show the voter that same number BEFORE they are sent to
// Flutterwave, and so the arithmetic is in one testable place rather than
// inlined in a component. Every line below mirrors a line of buyVotes:
//
//   bundle  subtotal = bundle.priceMinor,                  votes = bundle.votes
//   loose   subtotal = contest.pricePerVoteMinor * votes,  votes = votes
//           fee      = calculateFeeMinor(subtotal, feeBps)   ← the same fn
//           total    = subtotal + fee
//
// All MINOR units (kobo), integer arithmetic only, no float multiplication.
// `feeBps` is the rate `public.contests.bySlug` ships beside the bundles it
// applies to — a REQUIRED argument, as in lib/fees.ts, so a caller cannot
// forget to thread it through and quietly preview a 5% fee.
//
// DISPLAY ONLY. buyVotes re-reads the rate server-side and THAT figure is
// stored on the order and charged, so a tab left open across a rate change
// can show a stale fee but can never pay one. The buy dialog also compares
// what it displayed against the totals buyVotes returns, and refuses to
// navigate if they differ — see vote-buy-dialog.tsx.

/** What the voter picked. Exactly one of the two, as buyVotes requires. */
export type VotePurchaseChoice =
  | { kind: 'bundle'; bundleId: string; votes: number; priceMinor: number }
  | { kind: 'loose'; votes: number; pricePerVoteMinor: number }

export type VotePriceBreakdown = {
  /** Votes this purchase buys. */
  votes: number
  /** The bundle's price, or the per-vote price times how many. */
  subtotalMinor: number
  /** The platform service fee the VOTER bears, on its own line. */
  feeMinor: number
  /** What Flutterwave will be asked for. */
  totalMinor: number
}

/**
 * The most loose votes buyVotes will price in one order
 * (`MAX_LOOSE_VOTES_PER_ORDER`). Mirrored here so the stepper cannot offer a
 * quantity the server is going to refuse.
 */
export const MAX_LOOSE_VOTES_PER_ORDER = 10_000

/**
 * The most votes `castPaid` will spend in one cast (`MAX_VOTES_PER_CAST`).
 * A voter with more credits simply casts again.
 */
export const MAX_VOTES_PER_CAST = 1_000

/**
 * The biggest order total buyVotes will accept (`MAX_ORDER_TOTAL_MINOR`),
 * kept well short of the int4 ceiling on `orders.total_minor`.
 */
export const MAX_ORDER_TOTAL_MINOR = 2_000_000_000

export function priceVotePurchase(
  choice: VotePurchaseChoice,
  feeBps: number
): VotePriceBreakdown {
  const subtotalMinor =
    choice.kind === 'bundle'
      ? choice.priceMinor
      : choice.pricePerVoteMinor * choice.votes
  const feeMinor = calculateFeeMinor(subtotalMinor, feeBps)
  return {
    votes: choice.votes,
    subtotalMinor,
    feeMinor,
    totalMinor: subtotalMinor + feeMinor,
  }
}

/**
 * Why buyVotes would refuse this purchase, in the voter's words — or null
 * when it would go through. The server decides; this only moves the
 * conversation earlier, so every string here matches a refusal in buyVotes.
 */
export function votePurchaseProblem(price: VotePriceBreakdown): string | null {
  if (price.votes <= 0) return 'Choose how many votes to buy.'
  if (price.subtotalMinor <= 0) return 'These votes are not for sale.'
  if (price.totalMinor > MAX_ORDER_TOTAL_MINOR) {
    return 'That is more votes than can be bought in one payment.'
  }
  return null
}
