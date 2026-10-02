import { and, eq, inArray, ne, sql } from 'drizzle-orm'

import type { SubmissionStatus } from '@ticketur/db'
import { submissions } from '@ticketur/db'

import {
  releaseUnpaidSubmission,
  SPOT_HOLDING_STATUSES,
} from './form-payments'
import type { DbTransaction } from './forms'

// ONE ACTIVE SUBMISSION PER APPLICANT PER FORM.
//
// A product default, not something the data model needs. Submitting requires
// a signed-in account, so every submission names its applicant, and an
// applicant may hold at most one active submission per form: one that holds
// a spot (pending_payment, submitted or approved). A rejected one doesn't
// count, so someone turned down can apply again.
//
// Enforced by public.forms.submit and by the organizer's approve when it
// re-approves a rejected submission. Each checks after claimFormSpot, while
// holding the form row lock that every submit for the form must take, so it
// is race-safe: of two concurrent submits from one applicant, the second
// waits for the first to commit, then sees its submission and is refused.
//
// To relax the rule, drop the makeWayForApplication and findActiveSubmission
// calls from public.forms.submit and the findActiveSubmission check from
// org.forms.submissions.approve. Nothing else depends on it.
//
// An unpaid application doesn't lock its applicant out. Applying again
// replaces it once it is UNPAID_REPLACE_AFTER_SECONDS old: its spot is
// released and its order left pending, so if it is paid after all,
// fulfilment reinstates it (see creditRegistrationFee). A younger one blocks,
// which is what turns away a double submit that isn't quite concurrent.

export const UNPAID_REPLACE_AFTER_SECONDS = 60

export type ActiveSubmission = {
  id: string
  reference: string
  status: SubmissionStatus
}

// Why an applicant can't apply right now.
export type ApplicationBlock =
  | { kind: 'applied'; reference: string }
  | { kind: 'payment_open'; reference: string }

export function blockFor(submission: ActiveSubmission): ApplicationBlock {
  return {
    kind: submission.status === 'pending_payment' ? 'payment_open' : 'applied',
    reference: submission.reference,
  }
}

// Intake's first step, before claimFormSpot. Locks the applicant's active
// submissions on the form (submission rows before the form row, the order
// every path takes), then:
//   - a submitted or approved one blocks: they have applied;
//   - an unpaid one younger than the grace period blocks: its payment is
//     still open;
//   - an older unpaid one is released (cause 'replaced') to make way.
// Returns the block, or null when the applicant may go ahead.
export async function makeWayForApplication(
  tx: DbTransaction,
  args: { formId: string; applicantId: string }
): Promise<ApplicationBlock | null> {
  const existing = await tx
    .select({
      id: submissions.id,
      reference: submissions.reference,
      status: submissions.status,
      // On the database clock, which stamped created_at.
      fresh: sql<boolean>`${submissions.createdAt} > now() - ${sql.raw(
        `interval '${UNPAID_REPLACE_AFTER_SECONDS} seconds'`
      )}`,
    })
    .from(submissions)
    .where(
      and(
        eq(submissions.formId, args.formId),
        eq(submissions.applicantId, args.applicantId),
        inArray(submissions.status, SPOT_HOLDING_STATUSES)
      )
    )
    .for('update')

  const complete = existing.find((s) => s.status !== 'pending_payment')
  if (complete) return blockFor(complete)
  const open = existing.find((s) => s.fresh)
  if (open) return blockFor(open)

  for (const stale of existing) {
    await releaseUnpaidSubmission(tx, { submissionId: stale.id }, 'replaced')
  }
  return null
}

// The applicant's active submission on the form, other than `exceptId`.
// Callers hold the form row lock (claimFormSpot) when they ask, which is what
// makes the answer final for the rest of their transaction.
export async function findActiveSubmission(
  tx: DbTransaction,
  args: { formId: string; applicantId: string; exceptId?: string }
): Promise<ActiveSubmission | null> {
  const [row] = await tx
    .select({
      id: submissions.id,
      reference: submissions.reference,
      status: submissions.status,
    })
    .from(submissions)
    .where(
      and(
        eq(submissions.formId, args.formId),
        eq(submissions.applicantId, args.applicantId),
        inArray(submissions.status, SPOT_HOLDING_STATUSES),
        args.exceptId ? ne(submissions.id, args.exceptId) : undefined
      )
    )
    .limit(1)
  return row ?? null
}
