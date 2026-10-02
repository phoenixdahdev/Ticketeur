import { and, eq, inArray, ne, sql } from 'drizzle-orm'

import type { SubmissionStatus } from '@ticketur/db'
import {
  db,
  formPriceOptions,
  forms,
  orders,
  submissions,
} from '@ticketur/db'

import { completedStatus, releaseFormSpot, type DbTransaction } from './forms'
import { newId } from './ids'

// Registration fees: the order a paid submission creates, crediting it once a
// verified charge pays for it, and handing its spot back when the payment
// never comes.
//
// A submission whose chosen option has a price lands as 'pending_payment' and
// holds its capacity spot (forms.claimed, form_price_options.claimed) while
// it waits. One of two things then happens to that hold:
//   - paid: fulfillOrder (orders.ts) checks the charge's amount and currency,
//     then calls creditRegistrationFee, which completes the submission.
//   - not paid: releaseUnpaidSubmission marks it 'rejected', with a reason
//     saying why, and gives the spot back. Its callers: a charge that doesn't
//     cover the fee (fulfillOrder), every attempt failing or the order ageing
//     out (reconcile-orders.ts), the applicant applying again (form-
//     applicants.ts), and the payment link failing (public.forms.submit).
// A payment that lands after its spot was released still completes the
// submission and takes the spot back (see creditRegistrationFee): someone
// who has paid always gets what they paid for.
//
// Lock order, the same on every path through these rows, so none can
// deadlock another: the order row, then the submission row, then the form
// row, then the price option row (claimFormSpot and releaseFormSpot take
// those last two in that order).

// The statuses that hold a spot, i.e. count in forms.claimed: everything but
// 'rejected'.
export const SPOT_HOLDING_STATUSES = [
  'pending_payment',
  'submitted',
  'approved',
] as const satisfies readonly SubmissionStatus[]

// ─── Creating the order ─────────────────────────────────────────────────────

// The order for a paid submission. Runs inside public.forms.submit's
// transaction, so the order commits or rolls back with the submission and the
// spot it claimed.
//
// The applicant is charged the option's price exactly. Unlike a ticket order,
// no platform service fee (lib/fees.ts) is added: the codebase sets one only
// for tickets, and whether registration revenue carries one is an open
// question in the spec ("Platform fee on vote and registration revenue").
// Adding one later means feeMinor here and the amount the form page shows.
export async function createRegistrationOrder(
  tx: DbTransaction,
  args: {
    submissionId: string
    eventId: string
    amountMinor: number
    applicant: { id: string; name: string; email: string }
  }
): Promise<{ orderId: string; txRef: string }> {
  const orderId = newId('ord')
  const txRef = `reg_${orderId}_${Date.now()}`
  await tx.insert(orders).values({
    id: orderId,
    type: 'registration_fee',
    referenceId: args.submissionId,
    eventId: args.eventId,
    tierId: null,
    buyerId: args.applicant.id,
    buyerEmail: args.applicant.email,
    buyerName: args.applicant.name,
    quantity: 1,
    subtotalMinor: args.amountMinor,
    discountMinor: 0,
    feeMinor: 0,
    totalMinor: args.amountMinor,
    status: 'pending',
    flwTxRef: txRef,
  })
  await tx
    .update(submissions)
    .set({ orderId })
    .where(eq(submissions.id, args.submissionId))
  return { orderId, txRef }
}

// ─── Crediting the payment ──────────────────────────────────────────────────

export type RegistrationCredit = {
  submissionId: string
  // The submission's status once this payment is recorded.
  status: SubmissionStatus
  // This payment completed the submission (it is now submitted or approved),
  // so the confirmation email is due.
  completed: boolean
  // Its spot had been released while it was unpaid and was taken back for
  // it, past capacity if need be.
  reinstated: boolean
}

export type RegistrationCreditFailure =
  | 'no_reference' // the order names no submission
  | 'submission_missing' // the submission it names is gone
  | 'order_mismatch' // that submission is paid for by another order

// The registration-fee half of fulfillOrder. Only fulfillOrder calls this,
// inside its transaction, holding the order row lock, and only after the
// charge has passed its amount and currency check: this never looks at the
// charge, so it must never be reached any other way.
//
// Deliberately checks nothing about the form (status, window, capacity) or
// its event. Forms close, go back to review and fill up while an applicant is
// on the payment page; none of that undoes a payment.
export async function creditRegistrationFee(
  tx: DbTransaction,
  order: { id: string; referenceId: string | null }
): Promise<
  | { ok: true; credit: RegistrationCredit }
  | { ok: false; reason: RegistrationCreditFailure }
> {
  if (!order.referenceId) return { ok: false, reason: 'no_reference' }

  const [submission] = await tx
    .select({
      id: submissions.id,
      formId: submissions.formId,
      priceOptionId: submissions.priceOptionId,
      orderId: submissions.orderId,
      applicantId: submissions.applicantId,
      status: submissions.status,
      reviewerId: submissions.reviewerId,
    })
    .from(submissions)
    .where(eq(submissions.id, order.referenceId))
    .for('update')
    .limit(1)
  if (!submission) return { ok: false, reason: 'submission_missing' }
  if (submission.orderId !== order.id) {
    return { ok: false, reason: 'order_mismatch' }
  }

  const [form] = await tx
    .select({ reviewMode: forms.reviewMode })
    .from(forms)
    .where(eq(forms.id, submission.formId))
    .limit(1)
  // Unreachable while the foreign key cascades submissions with their form.
  if (!form) return { ok: false, reason: 'submission_missing' }

  const status = completedStatus(form.reviewMode)
  const now = new Date()
  const complete = {
    status,
    // An auto-approved submission was decided on payment, by no one.
    reviewedAt: status === 'approved' ? now : null,
    reviewerId: null,
    reason: null,
    updatedAt: now,
  }

  if (submission.status === 'pending_payment') {
    await tx
      .update(submissions)
      .set(complete)
      .where(eq(submissions.id, submission.id))
    return {
      ok: true,
      credit: {
        submissionId: submission.id,
        status,
        completed: true,
        reinstated: false,
      },
    }
  }

  // Released while unpaid (releaseUnpaidSubmission leaves no reviewer), and
  // paid after all: the charge was slow, the webhook late, or the applicant
  // paid on a link we had given up on. They get the submission and the spot
  // back, even past capacity.
  if (submission.status === 'rejected' && submission.reviewerId === null) {
    const overbooked = await retakeFormSpot(tx, submission)
    await tx
      .update(submissions)
      .set(complete)
      .where(eq(submissions.id, submission.id))
    // An applicant who applied again in the meantime now has two.
    const others = submission.applicantId
      ? await tx
          .select({ id: submissions.id })
          .from(submissions)
          .where(
            and(
              eq(submissions.formId, submission.formId),
              eq(submissions.applicantId, submission.applicantId),
              inArray(submissions.status, SPOT_HOLDING_STATUSES),
              ne(submissions.id, submission.id)
            )
          )
      : []
    console.error(
      '[forms] fee paid after the spot was released; submission reinstated',
      {
        orderId: order.id,
        submissionId: submission.id,
        status,
        overbooked,
        otherActiveSubmissionIds: others.map((o) => o.id),
      }
    )
    return {
      ok: true,
      credit: {
        submissionId: submission.id,
        status,
        completed: true,
        reinstated: true,
      },
    }
  }

  // Already submitted or approved without this payment, or rejected by the
  // organizer. The order is still marked paid, since the money arrived, but
  // the submission is left as it is: a payment doesn't overturn a review.
  // Unreachable through the API (an organizer can't approve an unpaid fee or
  // review a submission awaiting payment); a person should look.
  console.error('[forms] fee paid for a submission it cannot complete', {
    orderId: order.id,
    submissionId: submission.id,
    submissionStatus: submission.status,
    reviewerId: submission.reviewerId,
  })
  return {
    ok: true,
    credit: {
      submissionId: submission.id,
      status: submission.status,
      completed: false,
      reinstated: false,
    },
  }
}

// Take a spot back for a released submission that has now been paid for. No
// capacity guard, unlike claimFormSpot: the applicant has paid, so the spot
// is theirs even if the form or the option has filled since. Same lock order
// as claimFormSpot. Returns whether that went past a limit, for the log.
async function retakeFormSpot(
  tx: DbTransaction,
  submission: { formId: string; priceOptionId: string | null }
): Promise<boolean> {
  const [form] = await tx
    .update(forms)
    .set({ claimed: sql`${forms.claimed} + 1` })
    .where(eq(forms.id, submission.formId))
    .returning({ claimed: forms.claimed, capacity: forms.capacity })
  let overbooked =
    form !== undefined && form.capacity !== null && form.claimed > form.capacity

  if (submission.priceOptionId) {
    const [option] = await tx
      .update(formPriceOptions)
      .set({ claimed: sql`${formPriceOptions.claimed} + 1` })
      .where(eq(formPriceOptions.id, submission.priceOptionId))
      .returning({
        claimed: formPriceOptions.claimed,
        quantityLimit: formPriceOptions.quantityLimit,
      })
    if (
      option !== undefined &&
      option.quantityLimit !== null &&
      option.claimed > option.quantityLimit
    ) {
      overbooked = true
    }
  }
  return overbooked
}

// ─── Releasing an unpaid spot ───────────────────────────────────────────────

// Why a spot held for an unpaid fee was given back. Stored as the
// submission's reason, which the organizer sees on it and in the export.
export const UNPAID_RELEASE_REASONS = {
  payment_rejected: 'Fee not paid: the payment did not cover it.',
  payment_failed: 'Fee not paid: the payment failed.',
  expired: 'Fee not paid in time.',
  replaced: 'Fee not paid: replaced by a newer application.',
  not_started: 'Fee not paid: the payment could not be started.',
} as const

export type UnpaidReleaseCause = keyof typeof UNPAID_RELEASE_REASONS

// Give back the spot a pending_payment submission holds, because its fee
// isn't going to be paid. Returns the ids of the submissions released (none
// when there was nothing left to release).
//
// Idempotent, which is what lets several paths call it without coordinating.
// The guard is the conditional UPDATE: it only matches while the submission
// is still 'pending_payment', and it row-locks the submission. A concurrent
// caller blocks on that lock, re-checks the condition against the committed
// row once the first commits, matches nothing and releases nothing. So a
// hold is released at most once, and a submission that was paid for in the
// meantime (creditRegistrationFee moved it on) is left alone.
//
// Must run inside the caller's transaction, so the status change and the
// counter decrement commit together.
export async function releaseUnpaidSubmission(
  tx: DbTransaction,
  target: { orderId: string } | { submissionId: string },
  cause: UnpaidReleaseCause
): Promise<string[]> {
  const now = new Date()
  const released = await tx
    .update(submissions)
    .set({
      status: 'rejected',
      reason: UNPAID_RELEASE_REASONS[cause],
      // Decided by no one, like an auto-approval. A reinstatement relies on
      // this to tell a released submission from one an organizer rejected.
      reviewerId: null,
      reviewedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        'orderId' in target
          ? eq(submissions.orderId, target.orderId)
          : eq(submissions.id, target.submissionId),
        eq(submissions.status, 'pending_payment')
      )
    )
    .returning({
      id: submissions.id,
      formId: submissions.formId,
      priceOptionId: submissions.priceOptionId,
    })
  for (const submission of released) {
    await releaseFormSpot(tx, {
      formId: submission.formId,
      priceOptionId: submission.priceOptionId,
    })
  }
  return released.map((submission) => submission.id)
}

// ─── Reads ──────────────────────────────────────────────────────────────────

// Whether a submission's fee is still owed: it has an order and that order
// isn't paid. The organizer's approve refuses such a submission, so a fee is
// never waived by approving an application that was released unpaid.
export async function feeOutstanding(
  tx: DbTransaction,
  orderId: string | null
): Promise<boolean> {
  if (!orderId) return false
  const [order] = await tx
    .select({ status: orders.status })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1)
  return order !== undefined && order.status !== 'paid'
}

// What the /checkout/return page shows a registration-fee payer.
export async function loadRegistrationForOrder(order: {
  id: string
  referenceId: string | null
}) {
  if (!order.referenceId) return null
  const [row] = await db
    .select({
      reference: submissions.reference,
      status: submissions.status,
      applicantEmail: submissions.applicantEmail,
      formTitle: forms.title,
    })
    .from(submissions)
    .innerJoin(forms, eq(forms.id, submissions.formId))
    .where(
      and(
        eq(submissions.id, order.referenceId),
        eq(submissions.orderId, order.id)
      )
    )
    .limit(1)
  return row ?? null
}

export type RegistrationForOrder = NonNullable<
  Awaited<ReturnType<typeof loadRegistrationForOrder>>
>
