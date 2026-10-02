import { TRPCError } from '@trpc/server'
import { and, asc, eq, inArray, type SQL } from 'drizzle-orm'
import { z } from 'zod'

import type { Database, SubmissionStatus } from '@ticketur/db'
import { events, formFields, formPriceOptions, forms, user } from '@ticketur/db'

import { createTRPCRouter, publicProcedure } from '../../trpc'
import { notCurrentlyBanned } from '../../lib/predicates'
import {
  describeAnswerErrors,
  effectiveRules,
  validateAnswers,
} from '../../lib/form-fields'
import {
  claimFormSpot,
  completedStatus,
  formAvailability,
  FormSpotError,
  insertSubmission,
  optionRemaining,
  type FormUnavailableReason,
} from '../../lib/forms'

// A form holds at most 100 fields; this only turns away an oversized payload
// before any work is done.
const MAX_ANSWER_KEYS = 200

const submitInput = z.object({
  formId: z.string(),
  // Collected on every form, whatever fields the organizer added: the
  // confirmation email (with the reference) goes to this address.
  applicantName: z.string().trim().min(1, 'Name required').max(120),
  applicantEmail: z.email('Enter a valid email').max(254),
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

      return {
        state: 'open' as const,
        ...summary,
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

  // Validates every answer against the stored field definitions, takes a
  // spot under the capacity guard and records the submission, all in one
  // transaction. Free: lands as 'submitted', or 'approved' on an auto-review
  // form. A fee: lands as 'pending_payment', holding its spot, for the paid
  // path to take over (see the seams below).
  submit: publicProcedure
    .input(submitInput)
    .mutation(async ({ ctx, input }) => {
      const now = new Date()

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

      const feeMinor = option?.priceMinor ?? 0
      const status: Exclude<SubmissionStatus, 'rejected'> =
        feeMinor > 0 ? 'pending_payment' : completedStatus(form.reviewMode)

      const created = await ctx.db.transaction(async (tx) => {
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
          applicantId: ctx.session?.user.id ?? null,
          applicantName: input.applicantName,
          applicantEmail: input.applicantEmail,
          status,
          answersJson: checked.answers,
          // An auto-approved submission was decided on arrival, by no one.
          reviewedAt: status === 'approved' ? now : null,
        })

        // ── PAID PATH SEAM (inside the transaction) ────────────────────────
        // When status === 'pending_payment', create the order for `feeMinor`
        // here so it commits or rolls back with the submission and its spot,
        // and set submissions.orderId to it. On payment, the fulfilment step
        // moves the submission to completedStatus(form.reviewMode), and sets
        // reviewedAt when that is 'approved'. If the payment fails or is
        // abandoned, it must call releaseFormSpot, or the spot stays held.
        // Nothing here charges anyone yet: a paid submission is recorded as
        // pending_payment with no order.

        return inserted
      })

      // ── PAID PATH SEAM (after commit) ──────────────────────────────────────
      // When status === 'pending_payment', create the payment link here, as
      // checkout.start does after its own transaction, and return it as
      // `paymentUrl`.

      // NOTIFY SEAM: send the confirmation email carrying `reference` to
      // input.applicantEmail for a 'submitted' or 'approved' submission. No
      // email task exists for forms yet; add one in packages/jobs.

      return {
        submissionId: created.id,
        reference: created.reference,
        status,
        // True while the chosen option's fee is unpaid.
        requiresPayment: status === 'pending_payment',
        // What the chosen option costs, in minor units; 0 on a free form.
        amountMinor: feeMinor,
        // Filled in by the paid path; always null until then.
        paymentUrl: null as string | null,
      }
    }),
})

export type PublicFormsRouter = typeof publicFormsRouter
