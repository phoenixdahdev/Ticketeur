import type { RouterOutputs } from '@ticketur/api'

export type DiscrepancyKind =
  RouterOutputs['admin']['paymentDiscrepancies']['list']['rows'][number]['kind']

export const DISCREPANCY_KINDS = [
  'overpayment',
  'rejected_charge',
  'duplicate_charge',
  'undelivered',
  'registration_rejected',
] as const satisfies readonly DiscrepancyKind[]

export const KIND_LABEL: Record<DiscrepancyKind, string> = {
  overpayment: 'Overpaid',
  rejected_charge: 'Paid, not covered',
  duplicate_charge: 'Paid twice',
  undelivered: 'Paid, not delivered',
  registration_rejected: 'Application rejected',
}

// One line stating what the customer is holding right now. An admin reading
// this is about to move real money, so it never hedges.
export const KIND_SUMMARY: Record<DiscrepancyKind, string> = {
  overpayment:
    'The customer paid more than the order asked for. The order was fulfilled, so they have what they bought — only the excess is owed back.',
  rejected_charge:
    'The charge reached Flutterwave against this order but did not cover it. Nothing was delivered and the order is marked failed, so the whole charge is owed back.',
  duplicate_charge:
    'This order had already been paid by a different charge. This one bought nothing, so the whole charge is owed back.',
  undelivered:
    'The charge paid for this order, but it could not be delivered and the fulfilment was rolled back. The customer holds nothing, so the whole charge is owed back — unless the order is delivered by hand instead.',
  registration_rejected:
    'The applicant paid this registration fee in full, and the organizer then rejected their application and released the spot. They paid to take part and are not taking part, so the whole fee is owed back. Refund it in Flutterwave and record it here.',
}

// Whether the customer received what they paid for. Drives the red/amber
// treatment: an overpayment is an accounting correction, the rest are people
// holding nothing.
export const KIND_SEVERITY: Record<DiscrepancyKind, 'warning' | 'danger'> = {
  overpayment: 'warning',
  rejected_charge: 'danger',
  duplicate_charge: 'danger',
  undelivered: 'danger',
  registration_rejected: 'danger',
}

// Why the charge was recorded, as stored in `reason`.
export const REASON_LABEL: Record<string, string> = {
  overpaid: 'Paid above the amount requested',
  underpaid: 'Paid less than the amount requested',
  currency_mismatch: 'Charged in the wrong currency',
  invalid_amount: 'Flutterwave sent an amount we could not read',
  already_paid: 'The order was already paid by another charge',
  unsupported_type: 'This kind of order has no fulfilment yet',
  submission_missing: 'The application this fee pays for no longer exists',
  fulfilment_failed: 'Fulfilment failed after the payment was accepted',
  application_rejected:
    'The organizer rejected the application this fee paid for',
}

export function reasonLabel(reason: string): string {
  return REASON_LABEL[reason] ?? reason.replace(/_/g, ' ')
}

/**
 * Money for display. Everything is stored in minor units; NGN renders as ₦
 * and anything else keeps its ISO code so a foreign charge can never be read
 * as naira.
 *
 * `null` means Flutterwave did not give us an amount we could read — shown as
 * such rather than as zero, because zero would be a lie about money.
 */
export function formatMoney(
  minor: number | null | undefined,
  currency = 'NGN'
): string {
  if (minor === null || minor === undefined) return 'Not readable'
  const major = (minor / 100).toLocaleString('en-NG', {
    minimumFractionDigits: minor % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })
  return currency === 'NGN' ? `₦${major}` : `${major} ${currency}`
}
