// What we ask Flutterwave to charge for an order, and the check that a
// gateway-verified charge actually paid it. Checkout uses the conversion when
// it creates the payment; fulfilment uses the check when it confirms one.
// Keeping both here is what stops the two from drifting apart.
//
// Totals are stored in minor units (kobo) and the service fee is rounded to
// the nearest kobo (see fees.ts), so a total such as 105050 (₦1,050.50) is
// common. Flutterwave is sent whole naira, so that order is charged ₦1,051.
// Verification therefore compares against what we asked Flutterwave to
// charge, never against totalMinor itself: `amount * 100 === totalMinor`
// would reject every correctly paid order whose fee left a kobo fraction.
//
// Pure (no imports), so client code can use it too.

// The only currency checkout charges in.
export const PAYMENT_CURRENCY = 'NGN'

/**
 * Whole naira to ask Flutterwave to charge for an order total in kobo. Rounds
 * to the nearest naira, so the charge is within 50 kobo of totalMinor.
 */
export function toFlutterwaveAmount(totalMinor: number): number {
  return Math.round(totalMinor / 100)
}

export type PaidAmountCheck =
  | {
      ok: true
      // Whole naira we asked Flutterwave to charge.
      requestedAmount: number
      // Kobo paid beyond requestedAmount; 0 for an exact payment.
      overpaidMinor: number
    }
  | {
      ok: false
      reason: 'currency_mismatch' | 'underpaid' | 'invalid_amount'
      requestedAmount: number
    }

/**
 * Whether a charge's verified `amount` and `currency` pay for an order whose
 * total is `totalMinor`.
 *
 * The currency must be NGN and the amount at least what we asked Flutterwave
 * to charge. At least, not exactly: Flutterwave's verification guide says to
 * "verify if the amount paid is greater or equal to the amount you expect. If
 * the amount was greater, you can give the customer value and refund the
 * rest." The caller fulfils an overpayment and reports `overpaidMinor` so the
 * excess can be refunded. An underpayment, a wrong currency or an unreadable
 * amount is rejected.
 *
 * Compares in kobo, so float noise in a decimal amount cannot flip the result.
 */
export function checkPaidAmount({
  totalMinor,
  amount,
  currency,
}: {
  totalMinor: number
  amount: unknown
  currency: unknown
}): PaidAmountCheck {
  const requestedAmount = toFlutterwaveAmount(totalMinor)

  if (
    typeof currency !== 'string' ||
    currency.toUpperCase() !== PAYMENT_CURRENCY
  ) {
    return { ok: false, reason: 'currency_mismatch', requestedAmount }
  }

  // Flutterwave sends a JSON number; a numeric string is tolerated rather
  // than turned into a false rejection of a real payment.
  const paid =
    typeof amount === 'number'
      ? amount
      : typeof amount === 'string' && amount.trim() !== ''
        ? Number(amount)
        : Number.NaN
  if (!Number.isFinite(paid)) {
    return { ok: false, reason: 'invalid_amount', requestedAmount }
  }

  const paidMinor = Math.round(paid * 100)
  const requestedMinor = requestedAmount * 100
  if (paidMinor < requestedMinor) {
    return { ok: false, reason: 'underpaid', requestedAmount }
  }
  return {
    ok: true,
    requestedAmount,
    overpaidMinor: paidMinor - requestedMinor,
  }
}
