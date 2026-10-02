import type { RouterOutputs } from '@ticketur/api'
import type { SubmissionStatus } from '@ticketur/db'

// The applicant's vocabulary for their own applications.
//
// Deliberately NOT the organizer's, in lib/org-forms.ts. The same four
// statuses read differently depending on which side of the decision you are
// on: 'submitted' is work in the organizer's queue ("Needs review") and a wait
// for the applicant ("Being reviewed"), and 'rejected' is an action the
// organizer took and an outcome the applicant received. Sharing one map would
// make one of the two screens speak in the other's voice.

export type ApplicationRow = RouterOutputs['account']['submissions']['list'][number]
export type ApplicationDetail = NonNullable<
  RouterOutputs['account']['submissions']['byId']
>

export const APPLICATION_STATUS_LABEL: Record<SubmissionStatus, string> = {
  pending_payment: 'Payment unfinished',
  submitted: 'Being reviewed',
  approved: 'Accepted',
  rejected: 'Not accepted',
}

export const APPLICATION_STATUS_TONE: Record<SubmissionStatus, string> = {
  pending_payment:
    'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  submitted: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400',
  approved:
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
  rejected: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400',
}

// One line telling the applicant what is happening and whether anything is
// theirs to do. A rejection's own reason is shown separately and says more
// than this can, so this stays short there.
export const APPLICATION_STATUS_MEANING: Record<SubmissionStatus, string> = {
  pending_payment:
    'Your spot is being held while the fee is paid. It is not an application yet — finish the payment to send it.',
  submitted:
    'The organizer is reviewing it. We will email you as soon as they decide; there is nothing for you to do.',
  approved: 'You are in. Nothing else is needed from you.',
  rejected: 'The organizer did not take this application forward.',
}

export function applicationPath(id: string): string {
  return `/account/applications/${id}`
}

// Minor units (kobo) as naira. 0 is a real, free choice on an otherwise paid
// form, so it reads as "Free" rather than "₦0" — the same rule the form page
// and the organizer's screens use.
export function formatFee(minor: number): string {
  return minor === 0
    ? 'Free'
    : `₦${(minor / 100).toLocaleString('en-NG', {
        maximumFractionDigits: 2,
      })}`
}
