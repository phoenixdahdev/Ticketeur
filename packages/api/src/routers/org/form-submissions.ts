import { TRPCError } from '@trpc/server'
import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm'
import { z } from 'zod'

import {
  formFields,
  formPriceOptions,
  orders,
  submissions,
  user,
} from '@ticketur/db'

import { createTRPCRouter, organizerProcedure } from '../../trpc'
import { getBaseUrl } from '../../lib/base-url'
import {
  findSubmission,
  managesEvent,
  requireOwnedForm,
  requireOwnedSubmission,
} from '../../lib/form-access'
import { findActiveSubmission } from '../../lib/form-applicants'
import {
  sendSubmissionApproved,
  sendSubmissionRejected,
} from '../../lib/form-emails'
import { buildSubmissionExport } from '../../lib/form-fields'
import { feeOutstanding } from '../../lib/form-payments'
import {
  clearRejectionRefund,
  loadPaidRegistrationFee,
  recordRejectionRefund,
} from '../../lib/form-refunds'
import { claimFormSpot, FormSpotError, releaseFormSpot } from '../../lib/forms'

const statusFilter = z.enum([
  'all',
  'pending_payment',
  'submitted',
  'approved',
  'rejected',
])

// Modelled on events.ts's listInput; `status` plays the part of its `tab`.
// `q` matches the applicant's name or email, or the reference.
const listInput = z.object({
  formId: z.string(),
  status: statusFilter.default('all'),
  q: z.string().default(''),
  sort: z.enum(['date', 'name', 'status']).default('date'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
})

const rejectInput = z.object({
  id: z.string(),
  // Written for the applicant.
  reason: z.string().trim().min(1, 'Give a reason').max(1000),
})

const exportInput = z.object({
  formId: z.string(),
  status: statusFilter.default('all'),
})

function statusFilters(formId: string, status: z.infer<typeof statusFilter>) {
  const filters = [eq(submissions.formId, formId)]
  if (status !== 'all') filters.push(eq(submissions.status, status))
  return filters
}

export const orgFormSubmissionsRouter = createTRPCRouter({
  // ─── Queries ──────────────────────────────────────────────────────────────

  list: organizerProcedure.input(listInput).query(async ({ ctx, input }) => {
    const { form } = await requireOwnedForm(ctx, input.formId)

    const filters = statusFilters(form.id, input.status)
    const q = input.q.trim()
    if (q.length > 0) {
      const needle = `%${q}%`
      filters.push(
        or(
          ilike(submissions.applicantName, needle),
          ilike(submissions.applicantEmail, needle),
          ilike(submissions.reference, needle)
        )!
      )
    }

    const direction = input.dir === 'asc' ? asc : desc
    const orderBy = (() => {
      switch (input.sort) {
        case 'name':
          return direction(submissions.applicantName)
        case 'status':
          return direction(submissions.status)
        case 'date':
        default:
          return direction(submissions.createdAt)
      }
    })()

    // The form's first photo, as a thumbnail per row: a contestant shortlist
    // is reviewed by face. Read straight out of the jsonb, so the list never
    // ships whole answer sets.
    const [photoField] = await ctx.db
      .select({ id: formFields.id, type: formFields.type })
      .from(formFields)
      .where(
        and(
          eq(formFields.formId, form.id),
          inArray(formFields.type, ['image', 'images'])
        )
      )
      .orderBy(asc(formFields.position), asc(formFields.id))
      .limit(1)
    const answers = submissions.answersJson
    const thumbnailUrl = !photoField
      ? sql<string | null>`NULL`
      : photoField.type === 'images'
        ? sql<string | null>`${answers} -> ${photoField.id}::text ->> 0`
        : sql<string | null>`${answers} ->> ${photoField.id}::text`

    const rows = await ctx.db
      .select({
        id: submissions.id,
        reference: submissions.reference,
        status: submissions.status,
        applicantName: submissions.applicantName,
        applicantEmail: submissions.applicantEmail,
        priceOptionId: submissions.priceOptionId,
        priceOptionName: formPriceOptions.name,
        thumbnailUrl,
        createdAt: submissions.createdAt,
        reviewedAt: submissions.reviewedAt,
      })
      .from(submissions)
      .leftJoin(
        formPriceOptions,
        eq(formPriceOptions.id, submissions.priceOptionId)
      )
      .where(and(...filters))
      // The id tiebreak keeps pages stable when sort values repeat.
      .orderBy(orderBy, asc(submissions.id))
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize)

    const totalRows = await ctx.db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(submissions)
      .where(and(...filters))

    return {
      rows,
      total: totalRows[0]?.count ?? 0,
      page: input.page,
      pageSize: input.pageSize,
    }
  }),

  // One submission with every answer, labelled, in form order. Null when
  // missing or not the caller's, as events.byId does.
  byId: organizerProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const found = await findSubmission(ctx.db, input.id)
      if (!found || !managesEvent(ctx, found.organizerId)) return null
      const { submission, form } = found

      const [fields, priceOptionRows, reviewerRows, orderRows] =
        await Promise.all([
        ctx.db
          .select({
            id: formFields.id,
            label: formFields.label,
            type: formFields.type,
          })
          .from(formFields)
          .where(eq(formFields.formId, form.id))
          .orderBy(asc(formFields.position), asc(formFields.id)),
        submission.priceOptionId
          ? ctx.db
              .select({
                id: formPriceOptions.id,
                name: formPriceOptions.name,
                priceMinor: formPriceOptions.priceMinor,
              })
              .from(formPriceOptions)
              .where(eq(formPriceOptions.id, submission.priceOptionId))
              .limit(1)
          : Promise.resolve([]),
        submission.reviewerId
          ? ctx.db
              .select({ id: user.id, name: user.name })
              .from(user)
              .where(eq(user.id, submission.reviewerId))
              .limit(1)
          : Promise.resolve([]),
        // Whether the fee is actually with us, which is what decides whether
        // rejecting owes a refund. An orderId on its own does not say: it is
        // set the moment the application is created, long before anything is
        // paid.
        submission.orderId
          ? ctx.db
              .select({
                status: orders.status,
                totalMinor: orders.totalMinor,
                paidAt: orders.paidAt,
              })
              .from(orders)
              .where(eq(orders.id, submission.orderId))
              .limit(1)
          : Promise.resolve([]),
      ])

      const order = orderRows[0]

      return {
        submission: {
          id: submission.id,
          reference: submission.reference,
          status: submission.status,
          applicantName: submission.applicantName,
          applicantEmail: submission.applicantEmail,
          applicantId: submission.applicantId,
          orderId: submission.orderId,
          reason: submission.reason,
          reviewedAt: submission.reviewedAt,
          createdAt: submission.createdAt,
          updatedAt: submission.updatedAt,
        },
        form,
        priceOption: priceOptionRows[0] ?? null,
        // Null until reviewed, and for an auto-approved submission.
        reviewer: reviewerRows[0] ?? null,
        // The fee the applicant has actually paid, in minor units — null on a
        // free application and on one whose payment never cleared. Non-null
        // means rejecting owes this much back, which is what the reject
        // dialog tells the organizer.
        feePaidMinor:
          order && order.status === 'paid' ? order.totalMinor : null,
        feePaidAt: order?.paidAt ?? null,
        // null = unanswered (an optional field, or one added after this
        // submission came in). Upload answers are object-storage URLs.
        answers: fields.map((field) => ({
          fieldId: field.id,
          label: field.label,
          type: field.type,
          value: submission.answersJson[field.id] ?? null,
        })),
      }
    }),

  // CSV-ready: a header row and string rows, already guarded against
  // spreadsheet formula injection; the UI quotes, joins and downloads.
  // Includes uploaded-file URLs. Oldest first, the order people applied in.
  export: organizerProcedure
    .input(exportInput)
    .query(async ({ ctx, input }) => {
      const { form } = await requireOwnedForm(ctx, input.formId)

      const [fields, optionCount, rows] = await Promise.all([
        ctx.db
          .select({ id: formFields.id, label: formFields.label })
          .from(formFields)
          .where(eq(formFields.formId, form.id))
          .orderBy(asc(formFields.position), asc(formFields.id)),
        ctx.db
          .select({ count: sql<number>`COUNT(*)::int` })
          .from(formPriceOptions)
          .where(eq(formPriceOptions.formId, form.id)),
        ctx.db
          .select({
            reference: submissions.reference,
            status: submissions.status,
            createdAt: submissions.createdAt,
            applicantName: submissions.applicantName,
            applicantEmail: submissions.applicantEmail,
            priceOptionName: formPriceOptions.name,
            priceMinor: formPriceOptions.priceMinor,
            reviewedAt: submissions.reviewedAt,
            reason: submissions.reason,
            answers: submissions.answersJson,
          })
          .from(submissions)
          .leftJoin(
            formPriceOptions,
            eq(formPriceOptions.id, submissions.priceOptionId)
          )
          .where(and(...statusFilters(form.id, input.status)))
          .orderBy(asc(submissions.createdAt), asc(submissions.id)),
      ])

      const table = buildSubmissionExport({
        fields,
        hasPriceOptions: (optionCount[0]?.count ?? 0) > 0,
        submissions: rows,
      })
      const today = new Date().toISOString().slice(0, 10)
      return { filename: `${form.slug}-submissions-${today}.csv`, ...table }
    }),

  // ─── Review ───────────────────────────────────────────────────────────────

  // submitted → approved, or rejected → approved (which takes a spot back,
  // under the same capacity guard as intake). Approving an approved
  // submission is a no-op reported as `changed: false`. The applicant is
  // emailed when it changes.
  //
  // Re-approving a paid application that was rejected also withdraws the
  // refund obligation the rejection recorded — unless an admin has already
  // paid it back, which refuses the approval (lib/form-refunds.ts says why).
  approve: organizerProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { submission } = await requireOwnedSubmission(ctx, input.id)
      const reviewerId = ctx.session.user.id

      const changed = await ctx.db.transaction(async (tx) => {
        // Row lock: two reviewers acting at once go one after the other,
        // each against the status the other left.
        const [current] = await tx
          .select({
            status: submissions.status,
            formId: submissions.formId,
            priceOptionId: submissions.priceOptionId,
            orderId: submissions.orderId,
            applicantId: submissions.applicantId,
          })
          .from(submissions)
          .where(eq(submissions.id, submission.id))
          .for('update')
          .limit(1)
        if (!current) throw new TRPCError({ code: 'NOT_FOUND' })
        if (current.status === 'approved') return false
        if (current.status === 'pending_payment') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'This submission is still awaiting payment.',
          })
        }

        if (current.status === 'rejected') {
          // Rejected because its fee was never paid (lib/form-payments.ts
          // releases those): approving would waive the fee. If it is paid
          // late, fulfilment completes it without anyone approving.
          if (await feeOutstanding(tx, current.orderId)) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message:
                "This applicant never paid the fee, so their application can't be approved. They can apply again.",
            })
          }

          // Rejecting gave the spot back, so approving must take one again.
          // No `openAt`: an organizer may approve after the form has closed.
          try {
            await claimFormSpot(tx, {
              formId: current.formId,
              priceOptionId: current.priceOptionId,
            })
          } catch (err) {
            if (err instanceof FormSpotError) {
              throw new TRPCError({
                code: 'CONFLICT',
                message:
                  err.failure === 'option_full'
                    ? `"${err.optionName}" is full. Raise its limit or reject another submission first.`
                    : 'This form is full. Raise its capacity or reject another submission first.',
              })
            }
            throw err
          }

          // One active submission per applicant (lib/form-applicants.ts):
          // someone rejected may have applied again since. Checked holding
          // the form row lock the claim just took, as intake does.
          if (current.applicantId) {
            const other = await findActiveSubmission(tx, {
              formId: current.formId,
              applicantId: current.applicantId,
              exceptId: submission.id,
            })
            if (other) {
              throw new TRPCError({
                code: 'CONFLICT',
                message: `This applicant has another application on this form (${other.reference}). Reject that one before approving this one.`,
              })
            }
          }

          // The rejection may have put this fee on the Refunds Owed screen.
          // Taking the application back takes the obligation back with it —
          // nothing is owed to someone who holds what they paid for.
          const refund = await clearRejectionRefund(tx, current.orderId)
          if (refund.state === 'refunded') {
            // The money has already gone back to them. Approving now would
            // hand out a spot that nobody is paying for — the same hole
            // feeOutstanding closes above, arrived at from the other side.
            throw new TRPCError({
              code: 'CONFLICT',
              message:
                "This application's fee has already been refunded, so it can't be approved. Ask the applicant to apply and pay again.",
            })
          }
          // 'unknown' means the bookkeeping read failed, not that anything is
          // wrong with the application. clearRejectionRefund has logged it;
          // the approval goes ahead rather than being blocked by it.
        }

        const now = new Date()
        await tx
          .update(submissions)
          .set({
            status: 'approved',
            reviewerId,
            reviewedAt: now,
            reason: null,
            updatedAt: now,
          })
          .where(eq(submissions.id, submission.id))
        return true
      })

      // Outside the transaction, once the approval has committed.
      if (changed) {
        await sendSubmissionApproved(submission.id, { baseUrl: getBaseUrl() })
      }

      return { id: submission.id, status: 'approved' as const, changed }
    }),

  // submitted or approved → rejected, with a reason for the applicant. The
  // submission's spot is released for someone else. Rejecting a rejected
  // submission is a no-op reported as `changed: false`. The applicant is
  // emailed the reason when it changes.
  //
  // When the fee was PAID, the money goes back: the rejection records a
  // refund obligation on the Refunds Owed screen for an admin to issue by hand
  // (lib/form-refunds.ts). Nothing refunds automatically, and that write can
  // never fail the rejection — the organizer's decision stands either way.
  reject: organizerProcedure
    .input(rejectInput)
    .mutation(async ({ ctx, input }) => {
      const { submission, form } = await requireOwnedSubmission(ctx, input.id)
      const reviewerId = ctx.session.user.id

      const changed = await ctx.db.transaction(async (tx) => {
        const [current] = await tx
          .select({
            status: submissions.status,
            formId: submissions.formId,
            priceOptionId: submissions.priceOptionId,
            orderId: submissions.orderId,
            reference: submissions.reference,
          })
          .from(submissions)
          .where(eq(submissions.id, submission.id))
          .for('update')
          .limit(1)
        if (!current) throw new TRPCError({ code: 'NOT_FOUND' })
        if (current.status === 'rejected') return false
        if (current.status === 'pending_payment') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'This submission is still awaiting payment.',
          })
        }

        await releaseFormSpot(tx, {
          formId: current.formId,
          priceOptionId: current.priceOptionId,
        })
        const now = new Date()
        await tx
          .update(submissions)
          .set({
            status: 'rejected',
            reason: input.reason,
            reviewerId,
            reviewedAt: now,
            updatedAt: now,
          })
          .where(eq(submissions.id, submission.id))

        // The paid path. Only a fee that actually cleared is owed back: a
        // free application has no order, and an unpaid one is refused above
        // (and released by lib/form-payments.ts, not here). Written inside
        // this transaction so the obligation commits with the rejection that
        // created it — but through a SAVEPOINT that never throws, so if it
        // fails the rejection still commits. Last, so it holds no lock any
        // longer than it must.
        const fee = await loadPaidRegistrationFee(tx, current.orderId)
        if (fee) {
          await recordRejectionRefund(tx, {
            fee,
            submission: { id: submission.id, reference: current.reference },
            formTitle: form.title,
          })
        }
        return true
      })

      // Outside the transaction, once the rejection has committed.
      if (changed) await sendSubmissionRejected(submission.id)

      return { id: submission.id, status: 'rejected' as const, changed }
    }),
})

export type OrgFormSubmissionsRouter = typeof orgFormSubmissionsRouter
