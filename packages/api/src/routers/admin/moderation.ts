import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { and, asc, count, desc, eq, sql } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { tasks } from '@trigger.dev/sdk'
import { addDays } from 'date-fns'

import {
  events,
  eventVendors,
  formFields,
  formPriceOptions,
  forms,
  reports,
  session,
  submissions,
  ticketTiers,
  user,
  type Database,
  type FormStatus,
  type ReportSubjectType,
} from '@ticketur/db'

import { adminProcedure, createTRPCRouter } from '../../trpc'
import { formatEventDateRange } from '../../lib/dates'
import { applyEventEdit } from '../../lib/events'
import { logActivity } from '../../lib/activity'
import { effectiveRules } from '../../lib/form-fields'
import { reviewHistory } from '../../lib/form-review'
import {
  NOT_ADMIN,
  VENDOR_PENDING,
  EVENT_PENDING,
  EVENT_EDIT_PENDING,
  FORM_PENDING,
  REPORT_OPEN,
} from '../../lib/predicates'

// The public web URL as seen from the admin app (a separate deploy), used
// to build organizer-facing links in emails. Not the admin app's own origin.
const PUBLIC_BASE = 'https://www.useticketeur.com'

// ─── Registration form review helpers ─────────────────────────────────────

// Links for the form review emails: the public form page, by the form's
// platform-unique slug, and the organizer's page for the form's event.
function formLinks(form: { slug: string; eventId: string }) {
  return {
    publicUrl: `${PUBLIC_BASE}/forms/${form.slug}`,
    manageUrl: `${PUBLIC_BASE}/org/events/${form.eventId}`,
  }
}

// A form with what approving or rejecting it needs: its state, and who to
// email. Null when there is no such form.
async function findFormForReview(db: Database, formId: string) {
  const [row] = await db
    .select({
      form: {
        id: forms.id,
        eventId: forms.eventId,
        slug: forms.slug,
        title: forms.title,
        status: forms.status,
        contentRevision: forms.contentRevision,
      },
      eventTitle: events.title,
      organizer: {
        name: user.name,
        orgName: user.orgName,
        email: user.email,
      },
    })
    .from(forms)
    .innerJoin(events, eq(events.id, forms.eventId))
    .innerJoin(user, eq(user.id, events.organizerId))
    .where(eq(forms.id, formId))
    .limit(1)
  return row ?? null
}

function notAwaitingReview(): TRPCError {
  return new TRPCError({
    code: 'BAD_REQUEST',
    message: 'This form is no longer waiting for review.',
  })
}

function assertAwaitingReview(status: FormStatus): void {
  if (status !== 'pending_review') throw notAwaitingReview()
}

function formChangedError(): TRPCError {
  return new TRPCError({
    code: 'CONFLICT',
    message:
      'The organizer changed this form after you opened it. Review the latest version before approving.',
  })
}

export const adminModerationRouter = createTRPCRouter({
  stats: adminProcedure.query(async ({ ctx }) => {
    const [vendorRow] = await ctx.db
      .select({ value: count(user.id) })
      .from(user)
      .where(VENDOR_PENDING)
    const [eventRow] = await ctx.db
      .select({ value: count(events.id) })
      .from(events)
      .where(EVENT_PENDING)
    const [reportRow] = await ctx.db
      .select({ value: count(reports.id) })
      .from(reports)
      .where(REPORT_OPEN)
    const [editRow] = await ctx.db
      .select({ value: count(events.id) })
      .from(events)
      .where(EVENT_EDIT_PENDING)
    const [formRow] = await ctx.db
      .select({ value: count(forms.id) })
      .from(forms)
      .where(FORM_PENDING)

    return {
      vendors: Number(vendorRow?.value ?? 0),
      events: Number(eventRow?.value ?? 0),
      flagged: Number(reportRow?.value ?? 0),
      eventEdits: Number(editRow?.value ?? 0),
      forms: Number(formRow?.value ?? 0),
    }
  }),

  pendingVendors: adminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        businessName: user.businessName,
        category: user.businessCategory,
        image: user.image,
        instagramUrl: user.vendorInstagramUrl,
        websiteUrl: user.vendorWebsiteUrl,
        registeredAt: user.createdAt,
      })
      .from(user)
      .where(VENDOR_PENDING)
      .orderBy(desc(user.createdAt))

    return rows.map((r) => ({
      id: r.id,
      name: r.businessName ?? r.name,
      contactName: r.name,
      email: r.email,
      category: r.category ?? '',
      logoUrl: r.image ?? null,
      instagramUrl: r.instagramUrl ?? null,
      websiteUrl: r.websiteUrl ?? null,
      registeredAt: r.registeredAt.toISOString(),
    }))
  }),

  pendingEvents: adminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: events.id,
        title: events.title,
        bannerUrl: events.bannerUrl,
        registeredAt: events.createdAt,
        organizerId: user.id,
        organizerName: user.name,
        organizerOrgName: user.orgName,
      })
      .from(events)
      .innerJoin(user, eq(events.organizerId, user.id))
      .where(EVENT_PENDING)
      .orderBy(desc(events.createdAt))

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      // Events don't carry a category column today.
      category: '',
      thumbnailUrl: r.bannerUrl ?? '',
      organizerName: r.organizerOrgName ?? r.organizerName,
      registeredAt: r.registeredAt.toISOString(),
    }))
  }),

  // Top 5 pending items mixed across vendor approvals, event approvals,
  // form approvals and open reports. Used by the overview page.
  queue: adminProcedure.query(async ({ ctx }) => {
    const [vendorRows, eventRows, reportRows, formRows] = await Promise.all([
      ctx.db
        .select({
          id: user.id,
          name: user.name,
          businessName: user.businessName,
          image: user.image,
          createdAt: user.createdAt,
        })
        .from(user)
        .where(VENDOR_PENDING)
        .orderBy(desc(user.createdAt))
        .limit(5),
      ctx.db
        .select({
          id: events.id,
          title: events.title,
          bannerUrl: events.bannerUrl,
          createdAt: events.createdAt,
        })
        .from(events)
        .where(EVENT_PENDING)
        .orderBy(desc(events.createdAt))
        .limit(5),
      ctx.db
        .select()
        .from(reports)
        .where(REPORT_OPEN)
        .orderBy(desc(reports.createdAt))
        .limit(5),
      ctx.db
        .select({
          id: forms.id,
          title: forms.title,
          approvedRevision: forms.approvedRevision,
          requestedAt: forms.reviewRequestedAt,
          updatedAt: forms.updatedAt,
          bannerUrl: events.bannerUrl,
        })
        .from(forms)
        .innerJoin(events, eq(events.id, forms.eventId))
        .where(FORM_PENDING)
        .orderBy(desc(forms.reviewRequestedAt))
        .limit(5),
    ])

    type Item = {
      // A 'form' can't be approved from the queue: its questions have to be
      // read first, on its review page (href).
      kind: 'vendor' | 'event' | 'report' | 'form'
      // Routing target for the row's view button.
      href: string
      // ID of the underlying record (used for approve/reject mutations).
      id: string
      title: string
      reasonLabel: string
      reasonValue: string
      imageUrl: string | null
      timestamp: string
    }

    const items: Item[] = [
      ...vendorRows.map((v): Item => ({
        kind: 'vendor',
        href: `/moderation/vendor/${v.id}`,
        id: v.id,
        title: v.businessName ?? v.name,
        reasonLabel: 'Request:',
        reasonValue: 'Vendor Approval',
        imageUrl: v.image ?? null,
        timestamp: v.createdAt.toISOString(),
      })),
      ...eventRows.map((e): Item => ({
        kind: 'event',
        href: `/moderation/event/${e.id}`,
        id: e.id,
        title: e.title,
        reasonLabel: 'Request:',
        reasonValue: 'Event Approval',
        imageUrl: e.bannerUrl ?? null,
        timestamp: e.createdAt.toISOString(),
      })),
      ...reportRows.map((r): Item => ({
        kind: 'report',
        href: '/moderation?tab=flagged',
        id: r.id,
        title: r.reason,
        reasonLabel: 'Flagged for:',
        reasonValue: r.detail || r.reason,
        imageUrl: null,
        timestamp: r.createdAt.toISOString(),
      })),
      ...formRows.map((f): Item => ({
        kind: 'form',
        href: `/moderation/form/${f.id}`,
        id: f.id,
        title: f.title,
        reasonLabel: 'Request:',
        // A form approved before is back because its organizer edited it.
        reasonValue:
          f.approvedRevision === null ? 'Form Approval' : 'Form Re-review',
        imageUrl: f.bannerUrl ?? null,
        timestamp: (f.requestedAt ?? f.updatedAt).toISOString(),
      })),
    ]

    items.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    return items.slice(0, 5)
  }),

  flaggedActivities: adminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select()
      .from(reports)
      .where(REPORT_OPEN)
      .orderBy(desc(reports.createdAt))

    return rows.map((r) => ({
      id: r.id,
      subjectType: r.subjectType as ReportSubjectType,
      subjectId: r.subjectId,
      reason: r.reason,
      detail: r.detail,
      date: r.createdAt.toISOString(),
    }))
  }),

  vendorById: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(user)
        .where(and(eq(user.id, input.id), eq(user.role, 'vendor')))
        .limit(1)

      if (!row) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Vendor not found',
        })
      }

      return {
        id: row.id,
        name: row.businessName ?? row.name,
        contactName: row.name,
        email: row.email,
        category: row.businessCategory ?? '',
        logoUrl: row.image ?? null,
        instagramUrl: row.vendorInstagramUrl ?? null,
        websiteUrl: row.vendorWebsiteUrl ?? null,
        description: row.businessDescription ?? '',
        showcase: (row.vendorShowcaseImages ?? []) as string[],
        registeredAt: row.createdAt.toISOString(),
        approvalStatus: (row.vendorApprovalStatus ?? null) as
          'pending' | 'approved' | 'rejected' | null,
      }
    }),

  eventById: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const [ev] = await ctx.db
        .select()
        .from(events)
        .where(eq(events.id, input.id))
        .limit(1)

      if (!ev) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Event not found',
        })
      }

      const [organizer] = await ctx.db
        .select({
          id: user.id,
          name: user.name,
          orgName: user.orgName,
          email: user.email,
          image: user.image,
          createdAt: user.createdAt,
          banned: user.banned,
        })
        .from(user)
        .where(eq(user.id, ev.organizerId))
        .limit(1)

      const tierRows = await ctx.db
        .select()
        .from(ticketTiers)
        .where(eq(ticketTiers.eventId, ev.id))
        .orderBy(asc(ticketTiers.priceMinor), asc(ticketTiers.sortOrder))

      const vendorRows = await ctx.db
        .select({
          id: eventVendors.id,
          vendorId: user.id,
          name: user.name,
          businessName: user.businessName,
          category: user.businessCategory,
          description: user.businessDescription,
          image: user.image,
        })
        .from(eventVendors)
        .innerJoin(user, eq(eventVendors.vendorId, user.id))
        .where(eq(eventVendors.eventId, ev.id))

      return {
        id: ev.id,
        title: ev.title,
        description: ev.description,
        bannerUrl: ev.bannerUrl ?? '',
        eventDate: ev.eventDate,
        endDate: ev.endDate,
        eventTime: ev.eventTime,
        location: ev.location,
        features: (ev.features ?? []) as string[],
        status: ev.status,
        registeredAt: ev.createdAt.toISOString(),
        organizer: organizer
          ? {
              id: organizer.id,
              name: organizer.orgName ?? organizer.name,
              email: organizer.email,
              image: organizer.image ?? null,
              joinedAt: organizer.createdAt.toISOString(),
              status: (organizer.banned ? 'suspended' : 'active') as
                'active' | 'suspended',
            }
          : null,
        tiers: tierRows.map((t) => ({
          id: t.id,
          name: t.name,
          detail: `Tier ${t.sortOrder + 1} · ${t.quantity} total`,
          sold: t.sold,
          total: t.quantity,
          price: t.priceMinor,
          status: (t.sold >= t.quantity ? 'sold-out' : 'active') as
            'sold-out' | 'active' | 'early',
        })),
        vendors: vendorRows.map((v) => ({
          id: v.id,
          name: v.businessName ?? v.name,
          category: v.category ?? '',
          imageUrl: v.image ?? '',
          description: v.description ?? '',
        })),
      }
    }),

  approveVendor: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [target] = await ctx.db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          businessName: user.businessName,
        })
        .from(user)
        .where(and(eq(user.id, input.id), eq(user.role, 'vendor'), NOT_ADMIN))
        .limit(1)

      if (!target) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Vendor not found' })
      }

      await ctx.db
        .update(user)
        .set({
          vendorApprovalStatus: 'approved',
          updatedAt: new Date(),
        })
        .where(eq(user.id, target.id))

      void tasks.trigger('send-vendor-approved', {
        email: target.email,
        vendorName: target.name,
        businessName: target.businessName ?? target.name,
        profileUrl: `${PUBLIC_BASE}/vendors/${target.id}`,
      })

      return { ok: true as const }
    }),

  rejectVendor: adminProcedure
    .input(
      z.object({
        id: z.string().min(1),
        reason: z.string().default(''),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [target] = await ctx.db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          businessName: user.businessName,
        })
        .from(user)
        .where(and(eq(user.id, input.id), eq(user.role, 'vendor'), NOT_ADMIN))
        .limit(1)

      if (!target) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Vendor not found' })
      }

      await ctx.db
        .update(user)
        .set({
          vendorApprovalStatus: 'rejected',
          updatedAt: new Date(),
        })
        .where(eq(user.id, target.id))

      void tasks.trigger('send-vendor-rejected', {
        email: target.email,
        vendorName: target.name,
        businessName: target.businessName ?? target.name,
        reason: input.reason,
      })

      return { ok: true as const }
    }),

  approveEvent: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [ev] = await ctx.db
        .select({
          id: events.id,
          slug: events.slug,
          title: events.title,
          eventDate: events.eventDate,
          endDate: events.endDate,
          location: events.location,
          organizerId: events.organizerId,
        })
        .from(events)
        .where(eq(events.id, input.id))
        .limit(1)

      if (!ev) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Event not found' })
      }

      const [organizer] = await ctx.db
        .select({
          name: user.name,
          orgName: user.orgName,
          email: user.email,
        })
        .from(user)
        .where(eq(user.id, ev.organizerId))
        .limit(1)

      await ctx.db
        .update(events)
        .set({ status: 'upcoming', updatedAt: new Date() })
        .where(eq(events.id, ev.id))

      if (organizer) {
        void tasks.trigger('send-event-approved', {
          email: organizer.email,
          organizerName: organizer.orgName ?? organizer.name,
          eventTitle: ev.title,
          eventDate: formatEventDateRange(ev.eventDate, ev.endDate),
          eventLocation: ev.location,
          publicUrl: `${PUBLIC_BASE}/events/${ev.slug}`,
          manageUrl: `${PUBLIC_BASE}/org/events/${ev.id}`,
        })
      }

      return { ok: true as const }
    }),

  rejectEvent: adminProcedure
    .input(
      z.object({
        id: z.string().min(1),
        reason: z.string().default(''),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [ev] = await ctx.db
        .select({
          id: events.id,
          title: events.title,
          organizerId: events.organizerId,
        })
        .from(events)
        .where(eq(events.id, input.id))
        .limit(1)

      if (!ev) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Event not found' })
      }

      const [organizer] = await ctx.db
        .select({
          name: user.name,
          orgName: user.orgName,
          email: user.email,
        })
        .from(user)
        .where(eq(user.id, ev.organizerId))
        .limit(1)

      // Move back to draft so the organizer can edit + resubmit.
      await ctx.db
        .update(events)
        .set({ status: 'draft', updatedAt: new Date() })
        .where(eq(events.id, ev.id))

      if (organizer) {
        void tasks.trigger('send-event-rejected', {
          email: organizer.email,
          organizerName: organizer.orgName ?? organizer.name,
          eventTitle: ev.title,
          reason: input.reason,
        })
      }

      return { ok: true as const }
    }),

  // ─── Live-event edit approvals ────────────────────────────────────────────
  // Edits to a live (upcoming) event are queued as `pendingChanges` rather than
  // applied straight away, so the public page keeps showing the current version
  // until an admin approves.

  pendingEventEdits: adminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: events.id,
        title: events.title,
        bannerUrl: events.bannerUrl,
        submittedAt: events.pendingSubmittedAt,
        organizerName: user.name,
        organizerOrgName: user.orgName,
      })
      .from(events)
      .innerJoin(user, eq(events.organizerId, user.id))
      .where(EVENT_EDIT_PENDING)
      .orderBy(desc(events.pendingSubmittedAt))

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      thumbnailUrl: r.bannerUrl ?? '',
      organizerName: r.organizerOrgName ?? r.organizerName,
      submittedAt: r.submittedAt ? r.submittedAt.toISOString() : null,
    }))
  }),

  // Current live values + the proposed edit, so the admin can review the diff.
  eventEditById: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const [ev] = await ctx.db
        .select()
        .from(events)
        .where(eq(events.id, input.id))
        .limit(1)
      if (!ev || !ev.pendingChanges) return null

      const tiers = await ctx.db
        .select({
          id: ticketTiers.id,
          name: ticketTiers.name,
          quantity: ticketTiers.quantity,
          priceMinor: ticketTiers.priceMinor,
          sold: ticketTiers.sold,
        })
        .from(ticketTiers)
        .where(eq(ticketTiers.eventId, ev.id))
        .orderBy(asc(ticketTiers.priceMinor), asc(ticketTiers.sortOrder))

      const [organizer] = await ctx.db
        .select({ name: user.name, orgName: user.orgName })
        .from(user)
        .where(eq(user.id, ev.organizerId))
        .limit(1)

      return {
        eventId: ev.id,
        slug: ev.slug,
        organizerName: organizer?.orgName ?? organizer?.name ?? '',
        submittedAt: ev.pendingSubmittedAt
          ? ev.pendingSubmittedAt.toISOString()
          : null,
        current: {
          title: ev.title,
          description: ev.description,
          date: ev.eventDate,
          endDate: ev.endDate,
          time: ev.eventTime,
          location: ev.location,
          bannerUrl: ev.bannerUrl,
          features: ev.features,
          tiers,
        },
        proposed: ev.pendingChanges,
      }
    }),

  approveEventEdit: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [ev] = await ctx.db
        .select({
          id: events.id,
          slug: events.slug,
          organizerId: events.organizerId,
          pendingChanges: events.pendingChanges,
        })
        .from(events)
        .where(eq(events.id, input.id))
        .limit(1)
      if (!ev) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Event not found' })
      }
      if (!ev.pendingChanges) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This event has no pending changes.',
        })
      }
      const payload = ev.pendingChanges

      // applyEventEdit re-validates sold counts under a row lock; if a tier the
      // edit shrinks has sold more in the meantime it throws BAD_REQUEST and the
      // transaction rolls back, leaving the edit pending for the organizer to fix.
      await ctx.db.transaction(async (tx) => {
        await applyEventEdit(tx, ev.id, payload)
        await tx
          .update(events)
          .set({ pendingChanges: null, pendingSubmittedAt: null })
          .where(eq(events.id, ev.id))
      })

      const [organizer] = await ctx.db
        .select({ name: user.name, orgName: user.orgName, email: user.email })
        .from(user)
        .where(eq(user.id, ev.organizerId))
        .limit(1)
      if (organizer) {
        void tasks.trigger('send-event-edit-approved', {
          email: organizer.email,
          organizerName: organizer.orgName ?? organizer.name,
          eventTitle: payload.title,
          publicUrl: `${PUBLIC_BASE}/events/${ev.slug}`,
          manageUrl: `${PUBLIC_BASE}/org/events/${ev.id}`,
        })
      }
      await logActivity(ctx, {
        organizerId: ev.organizerId,
        type: 'event.edit_approved',
        eventId: ev.id,
        payload: { title: payload.title },
      })
      return { ok: true as const }
    }),

  rejectEventEdit: adminProcedure
    .input(z.object({ id: z.string().min(1), reason: z.string().default('') }))
    .mutation(async ({ ctx, input }) => {
      const [ev] = await ctx.db
        .select({
          id: events.id,
          title: events.title,
          organizerId: events.organizerId,
          pendingChanges: events.pendingChanges,
        })
        .from(events)
        .where(eq(events.id, input.id))
        .limit(1)
      if (!ev) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Event not found' })
      }
      if (!ev.pendingChanges) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This event has no pending changes.',
        })
      }

      // Discard the proposed edit; the live event is untouched.
      await ctx.db
        .update(events)
        .set({ pendingChanges: null, pendingSubmittedAt: null })
        .where(eq(events.id, ev.id))

      const [organizer] = await ctx.db
        .select({ name: user.name, orgName: user.orgName, email: user.email })
        .from(user)
        .where(eq(user.id, ev.organizerId))
        .limit(1)
      if (organizer) {
        void tasks.trigger('send-event-edit-rejected', {
          email: organizer.email,
          organizerName: organizer.orgName ?? organizer.name,
          eventTitle: ev.title,
          reason: input.reason,
        })
      }
      await logActivity(ctx, {
        organizerId: ev.organizerId,
        type: 'event.edit_rejected',
        eventId: ev.id,
        payload: { title: ev.title },
      })
      return { ok: true as const }
    }),

  // ─── Registration form approvals ──────────────────────────────────────────
  // Organizers write their own form questions, so a form takes submissions
  // only once an admin has approved exactly what it asks. An edit to a live
  // form's questions sends it back here (see lib/form-review.ts).

  pendingForms: adminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: forms.id,
        title: forms.title,
        type: forms.type,
        approvedRevision: forms.approvedRevision,
        rejectionReason: forms.rejectionReason,
        requestedAt: forms.reviewRequestedAt,
        updatedAt: forms.updatedAt,
        eventTitle: events.title,
        bannerUrl: events.bannerUrl,
        organizerName: user.name,
        organizerOrgName: user.orgName,
        fieldCount: sql<number>`(SELECT COUNT(*)::int FROM ${formFields} WHERE ${formFields.formId} = ${forms.id})`,
      })
      .from(forms)
      .innerJoin(events, eq(events.id, forms.eventId))
      .innerJoin(user, eq(user.id, events.organizerId))
      .where(FORM_PENDING)
      .orderBy(desc(forms.reviewRequestedAt))

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      type: r.type,
      eventTitle: r.eventTitle,
      thumbnailUrl: r.bannerUrl ?? '',
      organizerName: r.organizerOrgName ?? r.organizerName,
      fieldCount: r.fieldCount,
      history: reviewHistory(r),
      submittedAt: (r.requestedAt ?? r.updatedAt).toISOString(),
    }))
  }),

  // The form as an applicant would meet it, for the admin to judge the
  // questions: its wording, every field in order with the rules it enforces,
  // and every price option. `revision` names exactly this content; approveForm
  // takes it back and refuses if the form has changed since. One REPEATABLE
  // READ snapshot, so the revision and the questions can't come from
  // different moments. Null when there is no such form.
  formById: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(({ ctx, input }) =>
      ctx.db.transaction(
        async (tx) => {
          const [row] = await tx
            .select({
              form: forms,
              event: {
                id: events.id,
                title: events.title,
                slug: events.slug,
                status: events.status,
                eventDate: events.eventDate,
                endDate: events.endDate,
                location: events.location,
                bannerUrl: events.bannerUrl,
              },
              organizer: {
                id: user.id,
                name: user.name,
                orgName: user.orgName,
                email: user.email,
                image: user.image,
                createdAt: user.createdAt,
                banned: user.banned,
              },
            })
            .from(forms)
            .innerJoin(events, eq(events.id, forms.eventId))
            .innerJoin(user, eq(user.id, events.organizerId))
            .where(eq(forms.id, input.id))
            .limit(1)
          if (!row) return null
          const { form, event, organizer } = row

          const fieldRows = await tx
            .select()
            .from(formFields)
            .where(eq(formFields.formId, form.id))
            .orderBy(asc(formFields.position), asc(formFields.id))
          const optionRows = await tx
            .select()
            .from(formPriceOptions)
            .where(eq(formPriceOptions.formId, form.id))
            .orderBy(asc(formPriceOptions.sortOrder), asc(formPriceOptions.id))
          const [counts] = await tx
            .select({ total: sql<number>`COUNT(*)::int` })
            .from(submissions)
            .where(eq(submissions.formId, form.id))
          const [reviewer] = form.reviewerId
            ? await tx
                .select({ name: user.name })
                .from(user)
                .where(eq(user.id, form.reviewerId))
                .limit(1)
            : []

          return {
            id: form.id,
            title: form.title,
            description: form.description,
            type: form.type,
            status: form.status,
            reviewMode: form.reviewMode,
            opensAt: form.opensAt ? form.opensAt.toISOString() : null,
            closesAt: form.closesAt ? form.closesAt.toISOString() : null,
            capacity: form.capacity,
            revision: form.contentRevision,
            history: reviewHistory(form),
            submittedAt: form.reviewRequestedAt
              ? form.reviewRequestedAt.toISOString()
              : null,
            // The latest decision; with history 'resubmitted' it was a
            // rejection, and rejectionReason says why.
            lastReview: form.reviewedAt
              ? {
                  at: form.reviewedAt.toISOString(),
                  by: reviewer?.name ?? null,
                }
              : null,
            rejectionReason: form.rejectionReason,
            submissionCount: counts?.total ?? 0,
            event: {
              id: event.id,
              title: event.title,
              slug: event.slug,
              status: event.status,
              eventDate: event.eventDate,
              endDate: event.endDate,
              location: event.location,
              bannerUrl: event.bannerUrl ?? '',
            },
            organizer: {
              id: organizer.id,
              name: organizer.orgName ?? organizer.name,
              email: organizer.email,
              image: organizer.image ?? null,
              joinedAt: organizer.createdAt.toISOString(),
              status: (organizer.banned ? 'suspended' : 'active') as
                'active' | 'suspended',
            },
            // What the public form page is given for each field: the
            // organizer's wording plus the limits it actually enforces.
            fields: fieldRows.map((field) => ({
              id: field.id,
              label: field.label,
              helpText: field.helpText,
              type: field.type,
              required: field.required,
              ...effectiveRules(field),
            })),
            priceOptions: optionRows.map((option) => ({
              id: option.id,
              name: option.name,
              priceMinor: option.priceMinor,
              quantityLimit: option.quantityLimit,
            })),
          }
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' }
      )
    ),

  // Puts the form live. `revision` is the one formById showed the admin, and
  // the UPDATE matches only while the form is still waiting for review at
  // that revision. The status check alone isn't enough: an organizer can keep
  // editing a form while it waits, which leaves it 'pending_review' but
  // changes what it asks, so the admin would approve questions they never
  // saw. Every content edit moves the revision on under the form row lock
  // before it commits, so whichever of the two commits first, the other sees
  // it: an edit that wins makes this match nothing (CONFLICT; the admin
  // reloads and reviews again), and an approval that wins is followed by the
  // edit sending the form straight back to review.
  approveForm: adminProcedure
    .input(
      z.object({
        id: z.string().min(1),
        revision: z.number().int().min(0),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const target = await findFormForReview(ctx.db, input.id)
      if (!target) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Form not found' })
      }
      assertAwaitingReview(target.form.status)
      if (target.form.contentRevision !== input.revision) {
        throw formChangedError()
      }

      // Submitting needs a field, but the organizer can delete fields while
      // the form waits.
      const [fieldCount] = await ctx.db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(formFields)
        .where(eq(formFields.formId, target.form.id))
      if ((fieldCount?.count ?? 0) === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'This form has no questions. Reject it so the organizer can add some.',
        })
      }

      const now = new Date()
      const updated = await ctx.db
        .update(forms)
        .set({
          status: 'published',
          approvedRevision: input.revision,
          reviewerId: ctx.session.user.id,
          reviewedAt: now,
          rejectionReason: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(forms.id, target.form.id),
            FORM_PENDING,
            eq(forms.contentRevision, input.revision)
          )
        )
        .returning({ id: forms.id })
      if (updated.length === 0) {
        // Something committed between the checks above and the UPDATE.
        const [current] = await ctx.db
          .select({ status: forms.status })
          .from(forms)
          .where(eq(forms.id, target.form.id))
          .limit(1)
        if (!current) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Form not found' })
        }
        assertAwaitingReview(current.status)
        throw formChangedError()
      }

      void tasks.trigger('send-form-approved', {
        email: target.organizer.email,
        organizerName: target.organizer.orgName ?? target.organizer.name,
        formTitle: target.form.title,
        eventTitle: target.eventTitle,
        ...formLinks(target.form),
      })

      return { ok: true as const }
    }),

  // Sends the form back to its organizer with the reason, shown on the form
  // and in the email; they edit it and resubmit. The status check is enough
  // here: rejecting content newer than the admin saw keeps the form offline,
  // which is the safe side.
  rejectForm: adminProcedure
    .input(
      z.object({
        id: z.string().min(1),
        reason: z
          .string()
          .trim()
          .min(1, 'Give the organizer a reason')
          .max(2000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const target = await findFormForReview(ctx.db, input.id)
      if (!target) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Form not found' })
      }
      assertAwaitingReview(target.form.status)

      const now = new Date()
      const updated = await ctx.db
        .update(forms)
        .set({
          status: 'rejected',
          reviewerId: ctx.session.user.id,
          reviewedAt: now,
          rejectionReason: input.reason,
          updatedAt: now,
        })
        .where(and(eq(forms.id, target.form.id), FORM_PENDING))
        .returning({ id: forms.id })
      if (updated.length === 0) throw notAwaitingReview()

      void tasks.trigger('send-form-rejected', {
        email: target.organizer.email,
        organizerName: target.organizer.orgName ?? target.organizer.name,
        formTitle: target.form.title,
        eventTitle: target.eventTitle,
        reason: input.reason,
        manageUrl: formLinks(target.form).manageUrl,
      })

      return { ok: true as const }
    }),

  dismissFlag: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [r] = await ctx.db
        .select({ id: reports.id })
        .from(reports)
        .where(eq(reports.id, input.id))
        .limit(1)
      if (!r) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Report not found' })
      }
      await ctx.db
        .update(reports)
        .set({ status: 'dismissed', resolvedAt: new Date() })
        .where(eq(reports.id, input.id))

      return { ok: true as const }
    }),

  // Suspends the subject of an open report and marks the report actioned.
  // Reuses send-account-suspended so the user gets the same template the
  // /users page sends.
  suspendFromFlag: adminProcedure
    .input(
      z.object({
        id: z.string().min(1),
        reason: z.string().default(''),
        days: z.number().int().min(1).max(365).default(30),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [r] = await ctx.db
        .select()
        .from(reports)
        .where(and(eq(reports.id, input.id), REPORT_OPEN))
        .limit(1)
      if (!r) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Report not found' })
      }

      // Only user-typed subjects can be suspended through this flow; for
      // event reports the admin should approve/reject the event instead.
      if (r.subjectType === 'event') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Suspend the organizer or use event approval instead.',
        })
      }

      const [target] = await ctx.db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        })
        .from(user)
        .where(and(eq(user.id, r.subjectId), NOT_ADMIN))
        .limit(1)

      if (!target) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Reported user not found',
        })
      }

      const expiresAt = addDays(new Date(), input.days)

      await ctx.db
        .update(user)
        .set({
          banned: true,
          banReason: input.reason || r.reason,
          banExpires: expiresAt,
          updatedAt: new Date(),
        })
        .where(eq(user.id, target.id))

      await ctx.db.delete(session).where(eq(session.userId, target.id))

      await ctx.db
        .update(reports)
        .set({ status: 'actioned', resolvedAt: new Date() })
        .where(eq(reports.id, input.id))

      void tasks.trigger('send-account-suspended', {
        email: target.email,
        name: target.name,
        reason: input.reason || r.reason,
        // Pre-formatted for the worker (it doesn't import date-fns).
        expiresAt: expiresAt.toISOString().slice(0, 10),
      })

      return { ok: true as const }
    }),
})

// Silences "imported but unused" when randomUUID is not yet wired.
void randomUUID
