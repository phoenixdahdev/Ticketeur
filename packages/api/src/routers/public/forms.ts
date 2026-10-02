import { TRPCError } from '@trpc/server'
import { and, asc, eq, inArray, type SQL } from 'drizzle-orm'
import { z } from 'zod'

import type { Database, SubmissionStatus } from '@ticketur/db'
import { events, formFields, formPriceOptions, forms, user } from '@ticketur/db'

import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from '../../trpc'
import { getBaseUrl } from '../../lib/base-url'
import { createPayment } from '../../lib/flutterwave'
import { notCurrentlyBanned } from '../../lib/predicates'
import {
  blockFor,
  findActiveSubmission,
  makeWayForApplication,
  type ApplicationBlock,
} from '../../lib/form-applicants'
import { sendSubmissionConfirmation } from '../../lib/form-emails'
import {
  describeAnswerErrors,
  effectiveRules,
  validateAnswers,
} from '../../lib/form-fields'
import {
  createRegistrationOrder,
  releaseUnpaidSubmission,
} from '../../lib/form-payments'
import {
  claimFormSpot,
  completedStatus,
  formAvailability,
  FormSpotError,
  insertSubmission,
  optionRemaining,
  type FormUnavailableReason,
} from '../../lib/forms'
import { PAYMENT_CURRENCY, toFlutterwaveAmount } from '../../lib/payment-amount'
import { getFeeRates } from '../../lib/platform-settings'

// A form holds at most 100 fields; this only turns away an oversized payload
// before any work is done.
const MAX_ANSWER_KEYS = 200

// The applicant's name and email are not part of the input: they come from
// the signed-in account (see submit).
const submitInput = z.object({
  formId: z.string(),
  // Required when the form has price options; must be absent when it has
  // none.
  priceOptionId: z.string().nullable().default(null),
  // Field id → answer. Checked field by field against the stored
  // definitions below; never trusted as sent.
  answers: z
    .record(z.string(), z.unknown())
    .refine(
      (a) => Object.keys(a).length <= MAX_ANSWER_KEYS,
      'Too many answers'
    ),
})

const UNAVAILABLE_MESSAGES: Record<FormUnavailableReason, string> = {
  not_open: 'This form is not open for submissions yet.',
  closed: 'This form is no longer accepting submissions.',
  full: 'This form is full.',
}

function spotFailureMessage(err: FormSpotError): string {
  switch (err.failure) {
    case 'full':
      return 'This form just filled up, so it is no longer accepting submissions.'
    case 'option_full':
      return `${err.optionName ?? 'That option'} just filled up. Please choose another option.`
    case 'option_gone':
      return 'That option is no longer available. Please choose another.'
    case 'unavailable':
    default:
      return UNAVAILABLE_MESSAGES.closed
  }
}

// One active submission per applicant per form (lib/form-applicants.ts).
function applicationBlocked(block: ApplicationBlock): TRPCError {
  return new TRPCError({
    code: 'CONFLICT',
    message:
      block.kind === 'payment_open'
        ? 'You started an application for this form a moment ago and its payment is still open. Finish paying in the payment window, or try again in a minute to start a new application.'
        : `You've already applied to this form (reference ${block.reference}).`,
  })
}

// A form is public only while published or closed, and only while its event
// is: approved and live (status 'upcoming', which also shuts out an
// admin-suspended event) and run by an organizer who isn't banned. These are
// the public event page's rules; a form can't be more visible than its event.
//
// An allow-list on purpose. Forms gain review states (awaiting admin approval,
// rejected) — and a form rejected for asking applicants for sensitive data
// must not stay reachable. A deny-list (`status <> 'draft'`) would publish
// every new status by default; this one hides it until it's added here.
async function loadPublicForm(db: Database, match: SQL) {
  const [row] = await db
    .select({
      form: forms,
      event: {
        id: events.id,
        slug: events.slug,
        title: events.title,
        eventDate: events.eventDate,
        endDate: events.endDate,
        eventTime: events.eventTime,
        location: events.location,
        bannerUrl: events.bannerUrl,
      },
    })
    .from(forms)
    .innerJoin(events, eq(events.id, forms.eventId))
    .innerJoin(user, eq(user.id, events.organizerId))
    .where(
      and(
        match,
        inArray(forms.status, ['published', 'closed']),
        eq(events.status, 'upcoming'),
        notCurrentlyBanned
      )
    )
    .limit(1)
  return row ?? null
}

function loadPriceOptions(db: Database, formId: string) {
  return db
    .select()
    .from(formPriceOptions)
    .where(eq(formPriceOptions.formId, formId))
    .orderBy(asc(formPriceOptions.sortOrder), asc(formPriceOptions.id))
}

export const publicFormsRouter = createTRPCRouter({
  // null — no such form, still a draft, or its event isn't public.
  // { state: 'unavailable', reason } — published, but not taking submissions
  //   (not open yet / closed / full). Only the summary is returned: the
  //   fields and options are withheld, so there is nothing to fill in.
  // { state: 'open', … } — the form to render, with each field's effective
  //   rules and each option's remaining spots.
  bySlug: publicProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ ctx, input }) => {
      const found = await loadPublicForm(ctx.db, eq(forms.slug, input.slug))
      if (!found) return null
      const { form, event } = found

      const options = await loadPriceOptions(ctx.db, form.id)
      const availability = formAvailability(form, event, options)
      const summary = {
        form: {
          id: form.id,
          slug: form.slug,
          type: form.type,
          title: form.title,
          description: form.description,
          opensAt: form.opensAt,
          closesAt: form.closesAt,
        },
        event,
      }
      if (!availability.open) {
        return {
          state: 'unavailable' as const,
          reason: availability.reason,
          ...summary,
        }
      }

      const fields = await ctx.db
        .select()
        .from(formFields)
        .where(eq(formFields.formId, form.id))
        .orderBy(asc(formFields.position), asc(formFields.id))

      // The registration service-fee rate travels with the prices it applies
      // to. The applicant's page already makes this query — it cannot render
      // without it — so the rate is there on the first paint, with no second
      // round trip and no window in which a price is on screen without the fee
      // that goes with it. It is for DISPLAY only: submit re-reads the rate
      // and that figure is what gets charged.
      const feeRates = await getFeeRates(ctx.db)

      return {
        state: 'open' as const,
        ...summary,
        // Basis points (500 = 5%). Apply it with calculateFeeMinor from
        // @ticketur/api/lib/fees, the same function the server charges with.
        serviceFeeBps: feeRates.registration,
        // 'auto' lets the page promise an instant confirmation; 'manual'
        // means the applicant waits for the organizer's review.
        reviewMode: form.reviewMode,
        // Null when the form has no capacity.
        spotsLeft:
          form.capacity === null
            ? null
            : Math.max(0, form.capacity - form.claimed),
        fields: fields.map((field) => ({
          id: field.id,
          label: field.label,
          helpText: field.helpText,
          type: field.type,
          required: field.required,
          ...effectiveRules(field),
        })),
        // Minor units. An empty list means the form is free.
        priceOptions: options.map((option) => {
          const remaining = optionRemaining(option)
          return {
            id: option.id,
            name: option.name,
            priceMinor: option.priceMinor,
            remaining,
            soldOut: remaining === 0,
          }
        }),
      }
    }),

  // Signed-in only: viewing a form (bySlug) needs no account, applying does.
  //
  // Validates every answer against the stored field definitions, takes a
  // spot under the capacity guard and records the submission, all in one
  // transaction. Free: lands as 'submitted', or 'approved' on an auto-review
  // form, and the confirmation email goes out. A fee: lands as
  // 'pending_payment', holding its spot, with a registration_fee order for
  // the option's price; the response carries the Flutterwave link, and
  // fulfilment completes the submission (and sends the confirmation) once a
  // verified charge pays for it.
  //
  // One active submission per applicant per form (lib/form-applicants.ts).
  submit: protectedProcedure
    .input(submitInput)
    .mutation(async ({ ctx, input }) => {
      const now = new Date()
      // The verified identity, stored on the submission as a snapshot. Sign-in
      // requires a verified email (packages/auth), so the confirmation and
      // the payment receipt go to an address the applicant has proved.
      const applicant = {
        id: ctx.session.user.id,
        name: ctx.session.user.name,
        email: ctx.session.user.email,
      }

      const found = await loadPublicForm(ctx.db, eq(forms.id, input.formId))
      if (!found) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Form not found' })
      }
      const { form, event } = found

      // A friendly early answer; claimFormSpot below re-checks status,
      // window and capacity atomically.
      const options = await loadPriceOptions(ctx.db, form.id)
      const availability = formAvailability(form, event, options, now)
      if (!availability.open) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: UNAVAILABLE_MESSAGES[availability.reason],
        })
      }

      // A form with options requires exactly one of its own; a form without
      // them takes none.
      let option: (typeof options)[number] | null = null
      if (options.length > 0) {
        option = options.find((o) => o.id === input.priceOptionId) ?? null
        if (!option) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: input.priceOptionId
              ? 'That option is not available on this form.'
              : 'Choose an option.',
          })
        }
        if (optionRemaining(option) === 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `${option.name} is fully booked. Please choose another option.`,
          })
        }
      } else if (input.priceOptionId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This form has no options to choose from.',
        })
      }

      // The chosen option's price in minor units, before the platform's
      // registration service fee. 0 on a free form or a free option.
      const priceMinor = option?.priceMinor ?? 0
      const status: Exclude<SubmissionStatus, 'rejected'> =
        priceMinor > 0 ? 'pending_payment' : completedStatus(form.reviewMode)

      // Read once, here, outside the transaction, and used for both the order
      // row and the Flutterwave request, so the two cannot be computed from
      // different rates. Whatever rate the applicant's page was showing is
      // irrelevant: submitInput carries no money, so a stale rate in an open
      // tab can make the preview wrong but never the charge.
      const feeBps = (await getFeeRates(ctx.db)).registration

      const created = await ctx.db.transaction(async (tx) => {
        // Before the spot claim, which locks the form row: this locks the
        // applicant's existing submissions on the form, and every path takes
        // submission rows before the form row. Refuses a second application,
        // or makes way by releasing a stale unpaid one.
        const block = await makeWayForApplication(tx, {
          formId: form.id,
          applicantId: applicant.id,
        })
        if (block) throw applicationBlocked(block)

        try {
          await claimFormSpot(tx, {
            formId: form.id,
            priceOptionId: option?.id ?? null,
            openAt: now,
          })
        } catch (err) {
          if (err instanceof FormSpotError) {
            throw new TRPCError({
              code: 'CONFLICT',
              message: spotFailureMessage(err),
            })
          }
          throw err
        }

        // The race check. The claim holds the form row lock, which every
        // submit to this form takes, so a concurrent submit from the same
        // applicant has either committed (and shows up here) or is queued
        // behind us (and will see this one). The rollback hands our spot back.
        const raced = await findActiveSubmission(tx, {
          formId: form.id,
          applicantId: applicant.id,
        })
        if (raced) throw applicationBlocked(blockFor(raced))

        // Read only now: the claim holds the form row lock, and every field
        // edit takes that lock first, so these are exactly the definitions
        // in force when the submission commits. A validation failure throws,
        // and the rollback hands the spot back.
        const fields = await tx
          .select()
          .from(formFields)
          .where(eq(formFields.formId, form.id))
          .orderBy(asc(formFields.position), asc(formFields.id))
        const checked = validateAnswers(fields, input.answers)
        if (!checked.ok) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: describeAnswerErrors(checked.errors),
          })
        }

        const inserted = await insertSubmission(tx, {
          formId: form.id,
          priceOptionId: option?.id ?? null,
          applicantId: applicant.id,
          applicantName: applicant.name,
          applicantEmail: applicant.email,
          status,
          answersJson: checked.answers,
          // An auto-approved submission was decided on arrival, by no one.
          reviewedAt: status === 'approved' ? now : null,
        })

        // The paid path: the order is created here so it commits or rolls
        // back with the submission and its spot.
        const payment =
          status === 'pending_payment'
            ? await createRegistrationOrder(tx, {
                submissionId: inserted.id,
                eventId: event.id,
                amountMinor: priceMinor,
                feeBps,
                applicant,
              })
            : null

        return { ...inserted, payment }
      })

      const { payment } = created
      let paymentUrl: string | null = null
      if (payment) {
        // After commit, as checkout.start does: hand off to Flutterwave.
        const baseUrl = getBaseUrl()
        try {
          const { link } = await createPayment({
            txRef: payment.txRef,
            // The ORDER's total — the option's price plus the service fee —
            // not the bare price. Whole naira, through the helper fulfilment
            // verifies the charge against, so what we ask for and what we
            // accept can't drift. fulfilOrder checks a charge against
            // orders.totalMinor, so asking for anything less here would make
            // every paid registration land as underpaid.
            amount: toFlutterwaveAmount(payment.totalMinor),
            currency: PAYMENT_CURRENCY,
            redirectUrl: `${baseUrl}/checkout/return`,
            customer: { email: applicant.email, name: applicant.name },
            meta: {
              orderId: payment.orderId,
              submissionId: created.id,
              formId: form.id,
              eventId: event.id,
            },
            customizations: {
              title: event.title,
              description: option ? `${form.title}: ${option.name}` : form.title,
            },
          })
          paymentUrl = link
        } catch (err) {
          // No link reached the applicant, so nothing can be paid on this
          // order. Give the spot back now rather than holding it until the
          // order ages out, which also lets them apply again straight away.
          console.error('[forms] could not start the registration payment', {
            submissionId: created.id,
            orderId: payment.orderId,
            error: err,
          })
          try {
            await ctx.db.transaction((tx) =>
              releaseUnpaidSubmission(
                tx,
                { orderId: payment.orderId },
                'not_started'
              )
            )
          } catch (releaseErr) {
            // The spot stays held until the reconciliation job expires it.
            console.error('[forms] could not release an unstarted payment', {
              submissionId: created.id,
              orderId: payment.orderId,
              error: releaseErr,
            })
          }
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message:
              "We couldn't start the payment, so your application wasn't submitted. Please try again.",
          })
        }
      } else {
        // Complete already, so it is confirmed now. A paid submission is
        // confirmed by fulfilment once its fee clears, not here.
        await sendSubmissionConfirmation(created.id, { baseUrl: getBaseUrl() })
      }

      return {
        submissionId: created.id,
        reference: created.reference,
        status,
        // True while the chosen option's fee is unpaid.
        requiresPayment: status === 'pending_payment',
        // The option's price, in minor units; 0 when free.
        amountMinor: priceMinor,
        // The platform service fee charged on it, and the total the applicant
        // pays. Both 0 on a free application. These come from the order row,
        // so they are the amounts actually charged, not a second calculation.
        feeMinor: payment?.feeMinor ?? 0,
        totalMinor: payment?.totalMinor ?? priceMinor,
        // The Flutterwave checkout link when there is a fee; null otherwise.
        paymentUrl,
      }
    }),
})

export type PublicFormsRouter = typeof publicFormsRouter
