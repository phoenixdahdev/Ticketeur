import { TRPCError } from '@trpc/server'
import { and, asc, desc, eq, inArray, lte, notExists, sql } from 'drizzle-orm'
import { z } from 'zod'

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

  // Settings only: status changes go through publish/close, and the slug
  // never changes (a shared link must keep working). A change of reviewMode
  // applies to new submissions; ones already submitted stay as they are.
  update: organizerProcedure
    .input(updateInput)
    .mutation(async ({ ctx, input }) => {
      const { form } = await requireOwnedForm(ctx, input.id)

      // Capacity can't drop below the spots already held. The guard sits in
      // the UPDATE itself, so a submission claiming a spot mid-edit can't
      // slip underneath it.
      const capacityGuard =
        input.capacity === null ? undefined : lte(forms.claimed, input.capacity)

      const updated = await ctx.db
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
        const [current] = await ctx.db
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

      return { id: form.id }
    }),

  // From draft, or from closed to reopen it. Unlike an event, a form needs
  // no admin review: it is only reachable while its event is live, and the
  // event itself was reviewed.
  publish: organizerProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { form, event } = await requireOwnedForm(ctx, input.id)
      if (form.status === 'published') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This form is already published.',
        })
      }
      assertEventAcceptsForms(event)
      if (form.closesAt && form.closesAt <= new Date()) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'The closing time has already passed. Move it later or clear it before publishing.',
        })
      }

      const [fieldCount] = await ctx.db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(formFields)
        .where(eq(formFields.formId, form.id))
      if ((fieldCount?.count ?? 0) === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Add at least one field before publishing.',
        })
      }

      // Conditional on the status, so two concurrent publishes make one
      // transition between them.
      const updated = await ctx.db
        .update(forms)
        .set({ status: 'published', updatedAt: new Date() })
        .where(
          and(eq(forms.id, form.id), inArray(forms.status, ['draft', 'closed']))
        )
        .returning({ id: forms.id })
      if (updated.length === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This form is already published.',
        })
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
