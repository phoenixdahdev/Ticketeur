import { tasks } from '@trigger.dev/sdk'
import { eq } from 'drizzle-orm'

import { db, events, forms, orders, submissions } from '@ticketur/db'

import { formatEventDateRange } from './dates'
import { toFlutterwaveAmount } from './payment-amount'

// The three emails a registration-form applicant gets, queued on Trigger.dev
// (packages/jobs/src/tasks/send-submission-*.ts):
//   confirmation — once the submission is complete: on submit when it's free,
//                  once the fee is paid otherwise. Carries the reference.
//   approved     — when the organizer approves it.
//   rejected     — when the organizer rejects it, with their reason.
//
// Each loads what it needs by submission id and re-checks the status it is
// about, so a reviewer flipping a decision straight back doesn't send the
// stale email. None of them throws: the change they report has already
// committed, so a failed enqueue is logged for a resend by hand rather than
// failing the submit or the review that caused it.

async function loadForEmail(submissionId: string) {
  const [row] = await db
    .select({
      status: submissions.status,
      reference: submissions.reference,
      applicantName: submissions.applicantName,
      applicantEmail: submissions.applicantEmail,
      reason: submissions.reason,
      formTitle: forms.title,
      eventTitle: events.title,
      eventSlug: events.slug,
      eventDate: events.eventDate,
      endDate: events.endDate,
      eventLocation: events.location,
      orderStatus: orders.status,
      orderTotalMinor: orders.totalMinor,
    })
    .from(submissions)
    .innerJoin(forms, eq(forms.id, submissions.formId))
    .innerJoin(events, eq(events.id, forms.eventId))
    .leftJoin(orders, eq(orders.id, submissions.orderId))
    .where(eq(submissions.id, submissionId))
    .limit(1)
  return row ?? null
}

type EmailRow = NonNullable<Awaited<ReturnType<typeof loadForEmail>>>

function applicantFields(row: EmailRow) {
  return {
    email: row.applicantEmail,
    applicantName: row.applicantName.trim() || 'there',
    formTitle: row.formTitle,
    eventTitle: row.eventTitle,
    reference: row.reference,
  }
}

function eventFields(row: EmailRow, baseUrl: string) {
  return {
    eventDate: formatEventDateRange(row.eventDate, row.endDate),
    eventLocation: row.eventLocation,
    eventUrl: `${baseUrl}/events/${row.eventSlug}`,
  }
}

// What Flutterwave was asked to charge, in whole naira: the figure on the
// applicant's bank statement.
function formatAmountPaid(totalMinor: number): string {
  return `₦${toFlutterwaveAmount(totalMinor).toLocaleString('en-US')}`
}

async function load(
  submissionId: string,
  email: string,
  expected: readonly string[]
): Promise<EmailRow | null> {
  const row = await loadForEmail(submissionId)
  if (!row) {
    console.error(`[forms] ${email} email: submission not found`, {
      submissionId,
    })
    return null
  }
  if (!expected.includes(row.status)) {
    // Changed again since the caller committed; whatever changed it sends
    // its own email.
    console.error(`[forms] ${email} email skipped: status moved on`, {
      submissionId,
      status: row.status,
    })
    return null
  }
  return row
}

export async function sendSubmissionConfirmation(
  submissionId: string,
  { baseUrl }: { baseUrl: string }
): Promise<void> {
  try {
    const row = await load(submissionId, 'confirmation', [
      'submitted',
      'approved',
    ])
    if (!row) return
    await tasks.trigger('send-submission-confirmation', {
      ...applicantFields(row),
      ...eventFields(row, baseUrl),
      status: row.status,
      amountPaid:
        row.orderStatus === 'paid' && row.orderTotalMinor
          ? formatAmountPaid(row.orderTotalMinor)
          : null,
    })
  } catch (err) {
    console.error('[forms] could not queue the confirmation email', {
      submissionId,
      error: err,
    })
  }
}

export async function sendSubmissionApproved(
  submissionId: string,
  { baseUrl }: { baseUrl: string }
): Promise<void> {
  try {
    const row = await load(submissionId, 'approval', ['approved'])
    if (!row) return
    await tasks.trigger('send-submission-approved', {
      ...applicantFields(row),
      ...eventFields(row, baseUrl),
    })
  } catch (err) {
    console.error('[forms] could not queue the approval email', {
      submissionId,
      error: err,
    })
  }
}

export async function sendSubmissionRejected(
  submissionId: string
): Promise<void> {
  try {
    const row = await load(submissionId, 'rejection', ['rejected'])
    if (!row) return
    // A paid fee on a rejected application is money we are holding for a
    // place that wasn't given. The rejection also records it on the Refunds
    // Owed screen (lib/form-refunds.ts); this is the same fact told to the
    // person who is owed it, by the same rule — the order reaching 'paid'.
    const refundOwedMinor =
      row.orderStatus === 'paid' ? (row.orderTotalMinor ?? 0) : 0
    await tasks.trigger('send-submission-rejected', {
      ...applicantFields(row),
      reason: row.reason ?? '',
      refundOwedMinor,
    })
  } catch (err) {
    console.error('[forms] could not queue the rejection email', {
      submissionId,
      error: err,
    })
  }
}
