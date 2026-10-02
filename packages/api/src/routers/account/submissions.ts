import { TRPCError } from '@trpc/server'
import { and, asc, desc, eq } from 'drizzle-orm'
import { z } from 'zod'

import type { Database } from '@ticketur/db'
import {
  events,
  formFields,
  formPriceOptions,
  forms,
  orders,
  submissions,
} from '@ticketur/db'

import { createTRPCRouter, protectedProcedure } from '../../trpc'
import { getBaseUrl } from '../../lib/base-url'
import { createPayment } from '../../lib/flutterwave'
import { PAYMENT_CURRENCY, toFlutterwaveAmount } from '../../lib/payment-amount'

// The applicant's own side of the registration forms module: the applications
// they have sent, where each one stands, and the way back to a payment they
// started and did not finish.
//
// ─── Who may see a submission ──────────────────────────────────────────────
//
// ONLY the account that made it. A submission carries personal data — whatever
// the organizer's questions asked for, which is routinely a date of birth, a
// phone number and photographs — so it is shown here to its applicant and
// nowhere else. The organizer who owns the form, and admins, see it through
// org/form-submissions.ts, guarded by lib/form-access.ts.
//
// Two rules make that true, and they are why every read here goes through
// `ownSubmissions`:
//
//   1. `submissions.applicant_id = <the session's user id>` is part of the
//      WHERE of EVERY statement that reads a submission here — never a check
//      made on the row after fetching it, which is the shape that rots when
//      someone later adds an early return. The id comes from ctx.session, which
//      protectedProcedure guarantees; nothing in any input can influence it.
//   2. Nothing is ever resolved by `reference`. The short code (K7QM-3XPD) is
//      printed in emails, quoted in WhatsApp messages and read out over the
//      phone: it is an identifier, not a secret, and it is the organizer's and
//      the support desk's handle on an application. A lookup by reference alone
//      would hand anyone who has seen one somebody else's answers.
//
// An applicant who is not the owner therefore gets exactly what someone asking
// for an application that does not exist gets: null from the queries, NOT_FOUND
// from the mutation. Nothing tells "not yours" apart from "not there", so this
// cannot be used to probe whether an id exists.
//
// Submissions with a NULL applicant_id are invisible here, which is right:
// applying has required a signed-in account since the module shipped
// (public.forms.submit is a protectedProcedure), so a row without one belongs
// to nobody this router could show it to.

/**
 * One application with its form, event, chosen option and order.
 *
 * `applicantId` is a required argument and the predicate it builds is ANDed
 * into the single `where` this query ever gets — drizzle's `.where()`
 * OVERWRITES rather than accumulates, so the owner filter is composed here,
 * once, and the callers pass the rest in. There is no way to call this without
 * an owner and no later call that can drop one.
 *
 * Deliberately not filtered by form or event status, unlike the public form
 * page: an application has to stay readable to the person who made it once the
 * form closes, goes back to admin review or is taken down. It is their record
 * of something they did and, on the paid path, of money they handed over.
 */
function ownSubmissions(
  db: Database,
  applicantId: string,
  submissionId?: string
) {
  return db
    .select({
      id: submissions.id,
      reference: submissions.reference,
      status: submissions.status,
      reason: submissions.reason,
      answersJson: submissions.answersJson,
      createdAt: submissions.createdAt,
      reviewedAt: submissions.reviewedAt,
      priceOptionName: formPriceOptions.name,
      priceOptionPriceMinor: formPriceOptions.priceMinor,
      orderId: orders.id,
      orderStatus: orders.status,
      orderTxRef: orders.flwTxRef,
      orderSubtotalMinor: orders.subtotalMinor,
      orderFeeMinor: orders.feeMinor,
      orderTotalMinor: orders.totalMinor,
      orderPaidAt: orders.paidAt,
      formId: forms.id,
      formTitle: forms.title,
      formSlug: forms.slug,
      formType: forms.type,
      eventId: events.id,
      eventSlug: events.slug,
      eventTitle: events.title,
      eventDate: events.eventDate,
      eventEndDate: events.endDate,
      eventTime: events.eventTime,
      eventLocation: events.location,
      eventBannerUrl: events.bannerUrl,
    })
    .from(submissions)
    .innerJoin(forms, eq(forms.id, submissions.formId))
    .innerJoin(events, eq(events.id, forms.eventId))
    .leftJoin(
      formPriceOptions,
      eq(formPriceOptions.id, submissions.priceOptionId)
    )
    .leftJoin(orders, eq(orders.id, submissions.orderId))
    .where(
      and(
        eq(submissions.applicantId, applicantId),
        submissionId ? eq(submissions.id, submissionId) : undefined
      )
    )
    .orderBy(desc(submissions.createdAt), desc(submissions.id))
}

type Row = Awaited<ReturnType<typeof ownSubmissions>>[number]

// Everything a view needs about an application except the answers, which only
// the detail view gets.
function shape(row: Row) {
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    // Why it was turned down, written by the organizer for the applicant.
    // Null unless rejected.
    reason: row.reason,
    createdAt: row.createdAt,
    reviewedAt: row.reviewedAt,
    form: {
      id: row.formId,
      title: row.formTitle,
      slug: row.formSlug,
      type: row.formType,
    },
    event: {
      id: row.eventId,
      slug: row.eventSlug,
      title: row.eventTitle,
      eventDate: row.eventDate,
      endDate: row.eventEndDate,
      eventTime: row.eventTime,
      location: row.eventLocation,
      bannerUrl: row.eventBannerUrl,
    },
    // The option they picked, with its price in minor units. Null on a free
    // form; `priceMinor: 0` for a free option of an otherwise paid one.
    option:
      row.priceOptionName === null
        ? null
        : {
            name: row.priceOptionName,
            priceMinor: row.priceOptionPriceMinor ?? 0,
          },
    // What they were charged, in minor units: the option's price, the
    // platform's registration service fee on it, and the total. Null on a free
    // application, which has no order. `status` is the order's, so 'paid' is
    // the only value that means the money arrived.
    // The `?? …` fallbacks are the LEFT JOIN's doing, not real cases: every
    // column but paid_at is NOT NULL, so once orderId is non-null the order
    // row is there and so are its amounts.
    payment:
      row.orderId === null
        ? null
        : {
            status: row.orderStatus ?? 'pending',
            subtotalMinor: row.orderSubtotalMinor ?? 0,
            feeMinor: row.orderFeeMinor ?? 0,
            totalMinor: row.orderTotalMinor ?? 0,
            paidAt: row.orderPaidAt,
          },
    // There is a payment to go back and finish: the application is holding its
    // spot for a fee that has not cleared. See `resumePayment`.
    canResumePayment:
      row.status === 'pending_payment' &&
      row.orderId !== null &&
      row.orderStatus !== 'paid',
  }
}

export const accountSubmissionsRouter = createTRPCRouter({
  // Every application the signed-in account has sent, newest first.
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ownSubmissions(ctx.db, ctx.session.user.id)
    // No answers: the list is a set of cards, and a row of it has no business
    // carrying a CV and five photographs.
    return rows.map(shape)
  }),

  // One application with the answers as they were submitted. Null when there
  // is no such application OR it belongs to someone else — indistinguishable
  // on purpose.
  byId: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const [row] = await ownSubmissions(ctx.db, ctx.session.user.id, input.id)
      if (!row) return null

      const fields = await ctx.db
        .select({
          id: formFields.id,
          label: formFields.label,
          type: formFields.type,
        })
        .from(formFields)
        .where(eq(formFields.formId, row.formId))
        .orderBy(asc(formFields.position), asc(formFields.id))

      return {
        ...shape(row),
        // Every question on the form, in order, against what they answered.
        // null = not answered: an optional question they skipped, or one the
        // organizer added after they applied. Upload answers are the stored
        // file URLs, exactly as the organizer sees them.
        answers: fields.map((field) => ({
          fieldId: field.id,
          label: field.label,
          type: field.type,
          value: row.answersJson[field.id] ?? null,
        })),
      }
    }),

  /**
   * Open the payment for an application that is still waiting on its fee.
   *
   * NOT a second payment flow. It re-opens the one that already exists: the
   * SAME order, the SAME `tx_ref` and the SAME amount, read off the order row
   * rather than recomputed. Nothing is inserted, no fee rate is read, and the
   * submission is not touched — the link just goes back to Flutterwave for the
   * checkout the applicant abandoned.
   *
   * That is what makes it safe. Everything downstream already handles it:
   *   - fulfillOrder verifies a charge against this order's `flw_tx_ref` and
   *     `total_minor`, so a charge made through this link is checked exactly
   *     as the first attempt would have been and completes the submission
   *     through the same creditRegistrationFee path.
   *   - /checkout/return takes `tx_ref`, finds this order and renders the
   *     registration screen. No new return handling is needed.
   *   - Several attempts on one tx_ref are already an expected state: a buyer
   *     can retry inside a Flutterwave checkout, and reconcile-orders.ts
   *     explicitly looks at every attempt on a tx_ref before deciding
   *     anything.
   * The order's money is a snapshot written at intake, so a later change to the
   * platform's registration fee rate cannot alter what this link asks for.
   *
   * Nothing about the form is re-checked — not its status, its window or its
   * capacity — for the reason creditRegistrationFee gives: the spot is already
   * held, and a form closing or filling up while someone is on the payment page
   * does not undo a payment. The hold is not indefinite: a fee still unpaid 48
   * hours on is released by the reconciliation job, which leaves the
   * application 'rejected', and this refuses that.
   */
  resumePayment: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ownSubmissions(ctx.db, ctx.session.user.id, input.id)
      // Not theirs, or not there. Same answer for both.
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' })

      if (row.status !== 'pending_payment') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            row.status === 'rejected'
              ? 'This application is closed, so its fee can no longer be paid. You can apply again.'
              : 'This application is already complete — there is nothing left to pay.',
        })
      }
      if (row.orderStatus === 'paid') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            "This fee is already paid — we're confirming it. Your application completes on its own and we'll email you.",
        })
      }
      if (!row.orderId || !row.orderTxRef) {
        // A pending_payment application always has an order with a tx_ref:
        // createRegistrationOrder writes both inside intake's transaction. So
        // this is a broken row, not a state worth explaining to the applicant.
        console.error('[forms] cannot resume a payment with no open order', {
          submissionId: row.id,
          orderId: row.orderId,
        })
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            "We couldn't find the payment for this application. Please apply again.",
        })
      }

      const totalMinor = row.orderTotalMinor ?? 0
      const { link } = await createPayment({
        txRef: row.orderTxRef,
        // The order's total, through the same converter fulfilment verifies
        // the charge against, so what we ask for and what we accept cannot
        // drift apart. Asking for anything less would make the charge land as
        // underpaid.
        amount: toFlutterwaveAmount(totalMinor),
        currency: PAYMENT_CURRENCY,
        redirectUrl: `${getBaseUrl()}/checkout/return`,
        customer: {
          email: ctx.session.user.email,
          name: ctx.session.user.name,
        },
        meta: {
          orderId: row.orderId,
          submissionId: row.id,
          formId: row.formId,
          eventId: row.eventId,
        },
        customizations: {
          title: row.eventTitle,
          description: row.priceOptionName
            ? `${row.formTitle}: ${row.priceOptionName}`
            : row.formTitle,
        },
      })

      return { paymentUrl: link, totalMinor }
    }),
})

export type AccountSubmissionsRouter = typeof accountSubmissionsRouter
