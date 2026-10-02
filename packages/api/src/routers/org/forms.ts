import { TRPCError } from '@trpc/server'
import { and, asc, desc, eq, inArray, lte, notExists, sql } from 'drizzle-orm'
import { z } from 'zod'

import type { Database, FormStatus } from '@ticketur/db'
import {
  events,
  formFields,
  formPriceOptions,
  forms,
  submissions,
} from '@ticketur/db'

import { createTRPCRouter, organizerProcedure } from '../../trpc'
import { newId } from '../../lib/ids'
import {
  findForm,
  managesEvent,
  requireOwnedEvent,
  requireOwnedForm,
} from '../../lib/form-access'
import {
  assertEventAcceptsForms,
  formAvailability,
  generateUniqueFormSlug,
} from '../../lib/forms'
import {
  lockFormForEdit,
  recordContentChange,
  unchangedReview,
} from '../../lib/form-review'

import { orgFormFieldsRouter } from './form-fields'
import { orgFormPriceOptionsRouter } from './form-price-options'
import { orgFormSubmissionsRouter } from './form-submissions'

const formTypeEnum = z.enum(['contestant', 'vendor', 'other'])
const reviewModeEnum = z.enum(['auto', 'manual'])

// Settings shared by create and update. Update replaces them wholesale, as
// events.update does, so a settings screen sends the full set every time.
const settingsShape = {
  type: formTypeEnum,
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).default(''),
  // NULL opensAt = open on publish; NULL closesAt = open until closed (or
  // until the event ends).
  opensAt: z.date().nullable().default(null),
  closesAt: z.date().nullable().default(null),
  // NULL = unlimited.
  capacity: z.number().int().min(1).max(1_000_000).nullable().default(null),
  reviewMode: reviewModeEnum.default('manual'),
}

function refineWindow(
  v: { opensAt: Date | null; closesAt: Date | null },
  ctx: z.RefinementCtx
) {
  if (v.opensAt && v.closesAt && v.closesAt <= v.opensAt) {
    ctx.addIssue({
      code: 'custom',
      path: ['closesAt'],
      message: 'Closing time must be after the opening time',
    })
  }
}

const createInput = z
  .object({ eventId: z.string(), ...settingsShape })
  .superRefine(refineWindow)

const updateInput = z
  .object({ id: z.string(), ...settingsShape })
  .superRefine(refineWindow)

// Submission counts by status. COUNT(submissions.id) rather than COUNT(*) so
// a form with no submissions (one all-NULL row of the LEFT JOIN) counts 0.
const countColumns = {
  total: sql<number>`COUNT(${submissions.id})::int`,
  pendingPayment: sql<number>`(COUNT(*) FILTER (WHERE ${submissions.status} = 'pending_payment'))::int`,
  submitted: sql<number>`(COUNT(*) FILTER (WHERE ${submissions.status} = 'submitted'))::int`,
  approved: sql<number>`(COUNT(*) FILTER (WHERE ${submissions.status} = 'approved'))::int`,
  rejected: sql<number>`(COUNT(*) FILTER (WHERE ${submissions.status} = 'rejected'))::int`,
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

// ─── Review ────────────────────────────────────────────────────────────────

// Where an organizer can send a form to the admin queue from: a draft, a
// rejected form once fixed, or a closed one being reopened with changes.
const SUBMITTABLE: FormStatus[] = ['draft', 'rejected', 'closed']

function assertSubmittable(status: FormStatus): void {
  if (status === 'pending_review') {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'This form is already waiting for review.',
    })
  }
  if (status === 'published') {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'This form is already live.',
    })
  }
}

// Whether a form's content is still exactly what an admin last approved.
function approvedAsIs(form: {
  contentRevision: number
  approvedRevision: number | null
}): boolean {
  return (
    form.approvedRevision !== null &&
    form.approvedRevision === form.contentRevision
  )
}

function changedSinceApproval(): TRPCError {
  return new TRPCError({
    code: 'BAD_REQUEST',
    message:
      'This form has changed since it was approved. Submit it for review to reopen it.',
  })
}

// The preconditions publishing always had, now checked on submit and reopen.
function assertClosingTimeAhead(closesAt: Date | null, action: string): void {
  if (closesAt && closesAt <= new Date()) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `The closing time has already passed. Move it later or clear it before ${action}.`,
    })
  }
}

async function assertHasFields(
  db: Database,
  formId: string,
  action: string
): Promise<void> {
  const [fieldCount] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(formFields)
    .where(eq(formFields.formId, formId))
  if ((fieldCount?.count ?? 0) === 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Add at least one field before ${action}.`,
    })
  }
}

export const orgFormsRouter = createTRPCRouter({
  // ─── Queries ──────────────────────────────────────────────────────────────

  // Forms on one event (its organizer or an admin), or on every event the
  // caller organizes. Newest first, with submission counts.
  list: organizerProcedure
    .input(z.object({ eventId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      if (input.eventId) await requireOwnedEvent(ctx, input.eventId)
      const scope = input.eventId
        ? eq(forms.eventId, input.eventId)
        : eq(events.organizerId, ctx.session.user.id)

      return ctx.db
        .select({
          id: forms.id,
          eventId: forms.eventId,
          eventTitle: events.title,
          type: forms.type,
          title: forms.title,
          slug: forms.slug,
          status: forms.status,
          opensAt: forms.opensAt,
          closesAt: forms.closesAt,
          capacity: forms.capacity,
          claimed: forms.claimed,
          reviewMode: forms.reviewMode,
          // Set while rejected (and kept through resubmission), so the list
          // can say why.
          rejectionReason: forms.rejectionReason,
          reviewRequestedAt: forms.reviewRequestedAt,
          reviewedAt: forms.reviewedAt,
          createdAt: forms.createdAt,
          updatedAt: forms.updatedAt,
          ...countColumns,
        })
        .from(forms)
        .innerJoin(events, eq(events.id, forms.eventId))
        .leftJoin(submissions, eq(submissions.formId, forms.id))
        .where(scope)
        .groupBy(forms.id, events.id)
        .orderBy(desc(forms.createdAt))
    }),

  // Everything the builder needs. Null when missing or not the caller's, as
  // events.byId does.
  byId: organizerProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const found = await findForm(ctx.db, input.id)
      if (!found || !managesEvent(ctx, found.event.organizerId)) return null
      const { form, event } = found

      const [fields, priceOptions, countRows] = await Promise.all([
        ctx.db
          .select()
          .from(formFields)
          .where(eq(formFields.formId, form.id))
          .orderBy(asc(formFields.position), asc(formFields.id)),
        ctx.db
          .select()
          .from(formPriceOptions)
          .where(eq(formPriceOptions.formId, form.id))
          .orderBy(asc(formPriceOptions.sortOrder), asc(formPriceOptions.id)),
        ctx.db
          .select(countColumns)
          .from(submissions)
          .where(eq(submissions.formId, form.id)),
      ])

      return {
        form,
        event: {
          id: event.id,
          slug: event.slug,
          title: event.title,
          status: event.status,
          eventDate: event.eventDate,
          endDate: event.endDate,
        },
        fields,
        priceOptions,
        counts: countRows[0] ?? {
          total: 0,
          pendingPayment: 0,
          submitted: 0,
          approved: 0,
          rejected: 0,
        },
        // Whether applicants can submit right now; null unless published.
        // Separately, the public page only serves a form while its event is
        // live (status 'upcoming'), which `event.status` shows.
        availability:
          form.status === 'published'
            ? formAvailability(form, event, priceOptions)
            : null,
        // Whether reopen will take this closed form straight back to
        // published; when false, a closed form reopens through submit.
        canReopen: form.status === 'closed' && approvedAsIs(form),
      }
    }),

  // ─── Mutations ────────────────────────────────────────────────────────────

  // Starts as a draft; fields and price options are added separately.
  create: organizerProcedure
    .input(createInput)
    .mutation(async ({ ctx, input }) => {
      const event = await requireOwnedEvent(ctx, input.eventId)
      assertEventAcceptsForms(event)

      const id = newId('form')
      // Derived server-side, never client-supplied, as event slugs are.
      const slug = await generateUniqueFormSlug(ctx.db, event.slug, input.title)

      await ctx.db.insert(forms).values({
        id,
        eventId: event.id,
        slug,
        type: input.type,
        title: input.title,
        description: input.description,
        opensAt: input.opensAt,
        closesAt: input.closesAt,
        capacity: input.capacity,
        reviewMode: input.reviewMode,
        status: 'draft',
      })

      return { id, slug }
    }),

  // Settings and wording only: status changes go through submit, reopen and
  // close, and the slug never changes (a shared link must keep working). A
  // change of reviewMode applies to new submissions; ones already submitted
  // stay as they are. The title and description are what applicants read
  // above the questions, so an admin reviews them: changing either on a live
  // form sends it back to review. The other settings are operational.
  update: organizerProcedure
    .input(updateInput)
    .mutation(async ({ ctx, input }) => {
      const { form } = await requireOwnedForm(ctx, input.id)

      // Capacity can't drop below the spots already held. The guard sits in
      // the UPDATE itself, so a submission claiming a spot mid-edit can't
      // slip underneath it.
      const capacityGuard =
        input.capacity === null ? undefined : lte(forms.claimed, input.capacity)

      const review = await ctx.db.transaction(async (tx) => {
        const locked = await lockFormForEdit(tx, form.id)
        const wordingChanged =
          input.title !== locked.title ||
          input.description !== locked.description

        // A closed form's page stays public, showing its title and
        // description, and closing doesn't send a form to review. So its
        // wording is frozen: changing it goes through submit, which hides the
        // form until an admin approves the new version.
        if (wordingChanged && locked.status === 'closed') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              "A closed form's page is still public, so its title and description can't change without a review. Submit it for review to change them.",
          })
        }

        const updated = await tx
          .update(forms)
          .set({
            type: input.type,
            title: input.title,
            description: input.description,
            opensAt: input.opensAt,
            closesAt: input.closesAt,
            capacity: input.capacity,
            reviewMode: input.reviewMode,
            updatedAt: new Date(),
          })
          .where(and(eq(forms.id, form.id), capacityGuard))
          .returning({ id: forms.id })

        if (updated.length === 0) {
          const [current] = await tx
            .select({ claimed: forms.claimed })
            .from(forms)
            .where(eq(forms.id, form.id))
            .limit(1)
          if (!current) throw new TRPCError({ code: 'NOT_FOUND' })
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `This form already holds ${plural(current.claimed, 'submission')}; capacity can't be lower than that.`,
          })
        }

        return wordingChanged
          ? recordContentChange(tx, locked)
          : unchangedReview(locked)
      })

      return { id: form.id, ...review }
    }),

  // Sends the form to the admin review queue: a draft, a rejected form once
  // fixed, or a closed form being reopened with changes. An organizer can't
  // publish. The questions are theirs to write, so a form goes live only when
  // an admin approves it (see lib/form-review.ts).
  submit: organizerProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { form, event } = await requireOwnedForm(ctx, input.id)
      assertSubmittable(form.status)
      assertEventAcceptsForms(event)
      assertClosingTimeAhead(form.closesAt, 'submitting it')
      await assertHasFields(ctx.db, form.id, 'submitting it')

      // Conditional on the status, so two concurrent submits make one
      // transition between them.
      const now = new Date()
      const updated = await ctx.db
        .update(forms)
        .set({
          status: 'pending_review',
          reviewRequestedAt: now,
          updatedAt: now,
        })
        .where(and(eq(forms.id, form.id), inArray(forms.status, SUBMITTABLE)))
        .returning({ id: forms.id })
      if (updated.length === 0) {
        const [current] = await ctx.db
          .select({ status: forms.status })
          .from(forms)
          .where(eq(forms.id, form.id))
          .limit(1)
        if (!current) throw new TRPCError({ code: 'NOT_FOUND' })
        assertSubmittable(current.status)
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This form changed while it was being submitted. Try again.',
        })
      }

      return { id: form.id, status: 'pending_review' as const }
    }),

  // Takes a closed form straight back to published, but only while its
  // content is still the revision an admin approved: reopening never puts an
  // unreviewed question live. A form edited since it closed reopens through
  // submit instead. (A form published before reviews existed has no approved
  // revision, so it goes through submit too.)
  reopen: organizerProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { form, event } = await requireOwnedForm(ctx, input.id)
      if (form.status !== 'closed') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Only a closed form can be reopened.',
        })
      }
      if (!approvedAsIs(form)) throw changedSinceApproval()
      assertEventAcceptsForms(event)
      assertClosingTimeAhead(form.closesAt, 'reopening it')
      await assertHasFields(ctx.db, form.id, 'reopening it')

      // The revision check sits in the UPDATE. Every content edit takes this
      // row's lock and moves contentRevision on before it commits, so an edit
      // racing the reopen either commits first (and this matches nothing) or
      // finds the form published and sends it back to review.
      const updated = await ctx.db
        .update(forms)
        .set({ status: 'published', updatedAt: new Date() })
        .where(
          and(
            eq(forms.id, form.id),
            eq(forms.status, 'closed'),
            eq(forms.approvedRevision, forms.contentRevision)
          )
        )
        .returning({ id: forms.id })
      if (updated.length === 0) {
        const [current] = await ctx.db
          .select({ status: forms.status })
          .from(forms)
          .where(eq(forms.id, form.id))
          .limit(1)
        if (!current) throw new TRPCError({ code: 'NOT_FOUND' })
        if (current.status !== 'closed') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Only a closed form can be reopened.',
          })
        }
        throw changedSinceApproval()
      }

      return { id: form.id, status: 'published' as const }
    }),

  // Stops intake and keeps every submission. Intake's spot claim requires
  // status 'published' on this same row, so once this commits no submission
  // can land, not even one already in flight.
  close: organizerProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { form } = await requireOwnedForm(ctx, input.id)
      const updated = await ctx.db
        .update(forms)
        .set({ status: 'closed', updatedAt: new Date() })
        .where(and(eq(forms.id, form.id), eq(forms.status, 'published')))
        .returning({ id: forms.id })
      if (updated.length === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Only a published form can be closed.',
        })
      }
      return { id: form.id, status: 'closed' as const }
    }),

  // Only a form with no submissions: those are applicants' records (and
  // possibly payments), so a form that has any can only be closed.
  // `claimed = 0` covers a submission still in flight: its spot claim locks
  // this row, and the DELETE re-checks the counter once that commits.
  delete: organizerProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { form } = await requireOwnedForm(ctx, input.id)
      const deleted = await ctx.db
        .delete(forms)
        .where(
          and(
            eq(forms.id, form.id),
            eq(forms.claimed, 0),
            notExists(
              ctx.db
                .select({ id: submissions.id })
                .from(submissions)
                .where(eq(submissions.formId, form.id))
            )
          )
        )
        .returning({ id: forms.id })
      if (deleted.length === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This form already has submissions. Close it instead.',
        })
      }
      return { id: form.id }
    }),

  fields: orgFormFieldsRouter,
  priceOptions: orgFormPriceOptionsRouter,
  submissions: orgFormSubmissionsRouter,
})

export type OrgFormsRouter = typeof orgFormsRouter
