import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { tasks } from '@trigger.dev/sdk'
import { addDays } from 'date-fns'

import {
  contestCategories,
  contests,
  entries,
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
  voteBundles,
  voteCredits,
  type ContestStatus,
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
  sendContestApproved,
  sendContestRejected,
  sendContestTakenDown,
} from '../../lib/contest-emails'
import {
  NOT_ADMIN,
  VENDOR_PENDING,
  EVENT_PENDING,
  EVENT_EDIT_PENDING,
  FORM_PENDING,
  FORM_PUBLIC,
  CONTEST_PENDING,
  CONTEST_PUBLIC,
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

// The two statuses a form is publicly reachable in (the allow-list in
// public/forms.ts): taking submissions, or closed but still showing its page.
// Those are what there is to take down.
const TAKE_DOWN_FROM: FormStatus[] = ['published', 'closed']

function notTakeDownable(status: FormStatus): TRPCError {
  return new TRPCError({
    code: 'BAD_REQUEST',
    message:
      status === 'suspended'
        ? 'This form has already been taken down.'
        : 'This form is not public, so there is nothing to take down.',
  })
}

function formChangedError(): TRPCError {
  return new TRPCError({
    code: 'CONFLICT',
    message:
      'The organizer changed this form after you opened it. Review the latest version before approving.',
  })
}

// ─── Contest review helpers ───────────────────────────────────────────────
//
// The same five helpers as the form block above, for the same five jobs. A
// contest is moderated by identical machinery and for an identical reason
// (packages/api/src/lib/contest-review.ts): the organizer writes the ballot,
// writes the wording and sets what a vote costs, and the public pays for it.
//
// THIS FILE IS WHERE 'published' AND 'suspended' ARE WRITTEN. Nothing on the
// organizer side can write either — `ORGANIZER_WRITABLE` in contest-review.ts
// is a const tuple and a type, so an organizer-side resolver that tries does
// not compile. These three mutations are the whole of the other half.

// Links for the contest review emails: the public contest page, by the
// contest's platform-unique slug — the same shape lib/vote-emails.ts already
// builds — and the organizer's editor for the contest itself.
function contestLinks(contest: { slug: string; id: string }) {
  return {
    publicUrl: `${PUBLIC_BASE}/contests/${contest.slug}`,
    manageUrl: `${PUBLIC_BASE}/org/contests/${contest.id}`,
  }
}

// A contest with what approving, rejecting or pulling it needs: its state,
// and who to email. Null when there is no such contest.
async function findContestForReview(db: Database, contestId: string) {
  const [row] = await db
    .select({
      contest: {
        id: contests.id,
        eventId: contests.eventId,
        slug: contests.slug,
        title: contests.title,
        status: contests.status,
        contentRevision: contests.contentRevision,
        paidVotingEnabled: contests.paidVotingEnabled,
        pricePerVoteMinor: contests.pricePerVoteMinor,
      },
      eventTitle: events.title,
      organizer: {
        name: user.name,
        orgName: user.orgName,
        email: user.email,
      },
    })
    .from(contests)
    .innerJoin(events, eq(events.id, contests.eventId))
    .innerJoin(user, eq(user.id, events.organizerId))
    .where(eq(contests.id, contestId))
    .limit(1)
  return row ?? null
}

function contestNotAwaitingReview(): TRPCError {
  return new TRPCError({
    code: 'BAD_REQUEST',
    message: 'This contest is no longer waiting for review.',
  })
}

function assertContestAwaitingReview(status: ContestStatus): void {
  if (status !== 'pending_review') throw contestNotAwaitingReview()
}

// The two statuses a contest is publicly reachable in — the allow-list
// `loadPublicContest` enforces (routers/public/contests.ts): taking votes, or
// closed with its results page still up. Those are what there is to take
// down.
const CONTEST_TAKE_DOWN_FROM: ContestStatus[] = ['published', 'closed']

function contestNotTakeDownable(status: ContestStatus): TRPCError {
  return new TRPCError({
    code: 'BAD_REQUEST',
    message:
      status === 'suspended'
        ? 'This contest has already been taken down.'
        : 'This contest is not public, so there is nothing to take down.',
  })
}

function contestChangedError(): TRPCError {
  return new TRPCError({
    code: 'CONFLICT',
    message:
      'The organizer changed this contest after you opened it. Review the latest version before approving.',
  })
}

// What an approval must re-check that the revision guard cannot.
//
// Every edit to REVIEWED content moves `contentRevision` on, so the guard in
// approveContest already catches it. Deletion and retirement deliberately do
// NOT move it (contest-review.ts explains why: people have bought credits,
// and taking a contest offline because an entry was removed would strand a
// balance they paid for). That leaves exactly two holes an organizer can open
// while their contest waits, without the revision moving — and both of them
// would publish a contest nobody can actually vote in:
//
//   1. deleting the last category: there is then nothing to vote in. This is
//      the direct analogue of approveForm re-counting fields.
//   2. deleting or retiring the last active bundle while paid voting is on
//      with no per-vote price: `buyVotes` then turns every purchase away, so
//      the contest sells nothing.
//
// Both are the preconditions `org.contests.submit` checked at submit time
// (assertReadyToSubmit); this re-checks the two that can lapse since.
async function assertContestApprovable(
  db: Database,
  contest: {
    id: string
    paidVotingEnabled: boolean
    pricePerVoteMinor: number
  }
): Promise<void> {
  const [categories] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(contestCategories)
    .where(eq(contestCategories.contestId, contest.id))
  if ((categories?.count ?? 0) === 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message:
        'This contest has no categories, so there is nothing to vote in. Reject it so the organizer can add one.',
    })
  }

  if (contest.paidVotingEnabled && contest.pricePerVoteMinor === 0) {
    const [bundles] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(voteBundles)
      .where(
        and(eq(voteBundles.contestId, contest.id), eq(voteBundles.active, true))
      )
    if ((bundles?.count ?? 0) === 0) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message:
          'Paid voting is on but there is nothing to buy — no price per vote and no bundle on sale. Reject it so the organizer can fix that.',
      })
    }
  }
}

// Allocations, not ledger rows: one paid cast can carry several votes. The
// same correlated-subquery shape org/contests.ts uses, for its reason — three
// joins onto one contest would multiply the rows and every count would be
// wrong.
const contestVoteCount = sql<number>`(SELECT COALESCE(SUM(${entries.voteCount}), 0) FROM ${entries} WHERE ${entries.contestId} = ${contests.id})::int`
const contestEntryCount = sql<number>`(SELECT COUNT(*) FROM ${entries} WHERE ${entries.contestId} = ${contests.id})::int`
const contestCategoryCount = sql<number>`(SELECT COUNT(*) FROM ${contestCategories} WHERE ${contestCategories.contestId} = ${contests.id})::int`
// Votes people have PAID for and not yet spent. The figure that makes a
// takedown consequential, so the admin sees it before deciding.
const contestUnspentCredits = sql<number>`(SELECT COALESCE(SUM(${voteCredits.purchased} - ${voteCredits.spent}), 0) FROM ${voteCredits} WHERE ${voteCredits.contestId} = ${contests.id})::int`

// A contest waiting for review always has `reviewRequestedAt` — submit and
// recordContentChange both stamp it — but a row that predates either would
// sort unpredictably, so the queue falls back to the same value it displays.
const contestQueuedAt = sql`COALESCE(${contests.reviewRequestedAt}, ${contests.updatedAt})`

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
    const [contestRow] = await ctx.db
      .select({ value: count(contests.id) })
      .from(contests)
      .where(CONTEST_PENDING)

    return {
      vendors: Number(vendorRow?.value ?? 0),
      events: Number(eventRow?.value ?? 0),
      flagged: Number(reportRow?.value ?? 0),
      eventEdits: Number(editRow?.value ?? 0),
      forms: Number(formRow?.value ?? 0),
      contests: Number(contestRow?.value ?? 0),
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
  // form approvals, contest approvals and open reports. Used by the overview
  // page, so a pending contest is visible without opening /moderation.
  queue: adminProcedure.query(async ({ ctx }) => {
    const [vendorRows, eventRows, reportRows, formRows, contestRows] =
      await Promise.all([
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
        // Oldest first, unlike the four above: `org.contests.submit` promises
        // the organizer that resubmitting "goes to the back of the queue", and
        // that is only true of a queue read front-to-back. The five picked here
        // are therefore the five that have waited longest, and the merge below
        // still puts them in the list by age.
        ctx.db
          .select({
            id: contests.id,
            title: contests.title,
            approvedRevision: contests.approvedRevision,
            requestedAt: contests.reviewRequestedAt,
            updatedAt: contests.updatedAt,
            bannerUrl: events.bannerUrl,
          })
          .from(contests)
          .innerJoin(events, eq(events.id, contests.eventId))
          .where(CONTEST_PENDING)
          .orderBy(asc(contestQueuedAt))
          .limit(5),
      ])

    type Item = {
      // Neither a 'form' nor a 'contest' can be approved from the queue:
      // their content has to be read first, on the review page (href).
      kind: 'vendor' | 'event' | 'report' | 'form' | 'contest'
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
      ...contestRows.map((c): Item => ({
        kind: 'contest',
        href: `/moderation/contest/${c.id}`,
        id: c.id,
        title: c.title,
        reasonLabel: 'Request:',
        // A contest approved before is back because its organizer edited it.
        reasonValue:
          c.approvedRevision === null
            ? 'Contest Approval'
            : 'Contest Re-review',
        imageUrl: c.bannerUrl ?? null,
        timestamp: (c.requestedAt ?? c.updatedAt).toISOString(),
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

  // Every form the public can reach right now. The queue above only shows
  // forms waiting for a decision, so without this an admin has nowhere to find
  // an approved form that has since turned out to be a problem — and so
  // nowhere to reach takeDownForm from. Busiest first: a form with
  // submissions is the one a takedown matters most for.
  liveForms: adminProcedure.query(async ({ ctx }) => {
    const submissionCount = sql<number>`(SELECT COUNT(*)::int FROM ${submissions} WHERE ${submissions.formId} = ${forms.id})`

    const rows = await ctx.db
      .select({
        id: forms.id,
        title: forms.title,
        type: forms.type,
        status: forms.status,
        approvedAt: forms.reviewedAt,
        updatedAt: forms.updatedAt,
        eventTitle: events.title,
        bannerUrl: events.bannerUrl,
        organizerName: user.name,
        organizerOrgName: user.orgName,
        fieldCount: sql<number>`(SELECT COUNT(*)::int FROM ${formFields} WHERE ${formFields.formId} = ${forms.id})`,
        submissionCount,
      })
      .from(forms)
      .innerJoin(events, eq(events.id, forms.eventId))
      .innerJoin(user, eq(user.id, events.organizerId))
      .where(FORM_PUBLIC)
      .orderBy(desc(submissionCount), desc(forms.updatedAt))

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      type: r.type,
      // 'published' takes submissions; 'closed' has stopped but its page is
      // still public, which is its own reason to be able to pull it.
      status: r.status as 'published' | 'closed',
      eventTitle: r.eventTitle,
      thumbnailUrl: r.bannerUrl ?? '',
      organizerName: r.organizerOrgName ?? r.organizerName,
      fieldCount: r.fieldCount,
      submissionCount: r.submissionCount,
      approvedAt: (r.approvedAt ?? r.updatedAt).toISOString(),
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

  // Pulls a public form down: intake stops at once and its page goes with it.
  // The remedy when something got past review — a question asking for bank
  // details, a form that turns out to be fraudulent — or when a closed form's
  // still-public wording has to go.
  //
  // Why 'suspended' and not 'closed': a closed form keeps a public page and
  // its organizer reopens it in one click, without a second review, while its
  // content is still the approved revision (org.forms.reopen). A takedown that
  // left the form reopenable would be worthless. 'suspended' is reachable only
  // from here, org.forms.reopen refuses anything that isn't 'closed', and the
  // approval this clears is the one reopen checks — three separate reasons the
  // organizer cannot undo it. Everything they CAN do is fix the form and
  // submit it, which puts it back in this queue for an admin to approve.
  //
  // Submissions are untouched, and so is fulfilment: someone whose payment
  // confirms after the takedown is still credited, because the paid path
  // deliberately does not consult the form's status.
  takeDownForm: adminProcedure
    .input(
      z.object({
        id: z.string().min(1),
        reason: z
          .string()
          .trim()
          .min(1, 'Say why this form is being taken down')
          .max(2000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const target = await findFormForReview(ctx.db, input.id)
      if (!target) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Form not found' })
      }
      if (!TAKE_DOWN_FROM.includes(target.form.status)) {
        throw notTakeDownable(target.form.status)
      }

      // The status check sits in the UPDATE, so a takedown that races the
      // organizer closing the form, or an edit sending it back to review,
      // resolves to one outcome: whichever commits first holds the row, and
      // the other re-reads the row as it now is. Losing means the form is
      // already off the public site, which is the safe side.
      const now = new Date()
      const updated = await ctx.db
        .update(forms)
        .set({
          status: 'suspended',
          // Nothing about a form an admin pulled down is approved content any
          // more. Belt and braces: even if some later path moved a suspended
          // form to 'closed', reopen's `approvedRevision = contentRevision`
          // check would still refuse it.
          approvedRevision: null,
          reviewerId: ctx.session.user.id,
          reviewedAt: now,
          rejectionReason: input.reason,
          updatedAt: now,
        })
        .where(
          and(
            eq(forms.id, target.form.id),
            inArray(forms.status, TAKE_DOWN_FROM)
          )
        )
        .returning({ id: forms.id })
      if (updated.length === 0) {
        const [current] = await ctx.db
          .select({ status: forms.status })
          .from(forms)
          .where(eq(forms.id, target.form.id))
          .limit(1)
        if (!current) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Form not found' })
        }
        throw notTakeDownable(current.status)
      }

      void tasks.trigger('send-form-taken-down', {
        email: target.organizer.email,
        organizerName: target.organizer.orgName ?? target.organizer.name,
        formTitle: target.form.title,
        eventTitle: target.eventTitle,
        reason: input.reason,
        manageUrl: formLinks(target.form).manageUrl,
      })

      return { ok: true as const }
    }),

  // ─── Contest approvals ────────────────────────────────────────────────────
  // Organizers write their own ballot, their own wording and their own
  // prices, so a contest takes votes only once an admin has approved exactly
  // what is on it. An edit to a live contest's reviewed content sends it back
  // here (see lib/contest-review.ts).
  //
  // These four mutations are the ONLY writers of 'published' and 'suspended'
  // anywhere in the API. Without them a contest reaches 'pending_review' and
  // stops: `approvedRevision` is never written and the public loader never
  // resolves it.

  pendingContests: adminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: contests.id,
        title: contests.title,
        approvedRevision: contests.approvedRevision,
        rejectionReason: contests.rejectionReason,
        requestedAt: contests.reviewRequestedAt,
        updatedAt: contests.updatedAt,
        eventTitle: events.title,
        bannerUrl: events.bannerUrl,
        organizerName: user.name,
        organizerOrgName: user.orgName,
        categoryCount: contestCategoryCount,
        entryCount: contestEntryCount,
      })
      .from(contests)
      .innerJoin(events, eq(events.id, contests.eventId))
      .innerJoin(user, eq(user.id, events.organizerId))
      .where(CONTEST_PENDING)
      // Oldest first. `org.contests.submit` tells the organizer that
      // resubmitting puts them at the back of the queue, and that is only
      // true if the queue is worked front-to-back. It is the one place this
      // deliberately differs from `pendingForms`, which is newest-first.
      .orderBy(asc(contestQueuedAt))

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      eventTitle: r.eventTitle,
      thumbnailUrl: r.bannerUrl ?? '',
      organizerName: r.organizerOrgName ?? r.organizerName,
      categoryCount: r.categoryCount,
      entryCount: r.entryCount,
      history: reviewHistory(r),
      submittedAt: (r.requestedAt ?? r.updatedAt).toISOString(),
    }))
  }),

  // Every contest the public can reach right now. The queue above only shows
  // contests waiting for a decision, so without this an admin has nowhere to
  // find an approved contest that has since turned out to be a problem — and
  // so nowhere to reach takeDownContest from. Busiest first: a contest people
  // have voted in, and paid to vote in, is the one a takedown matters most
  // for.
  liveContests: adminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: contests.id,
        title: contests.title,
        status: contests.status,
        approvedAt: contests.reviewedAt,
        updatedAt: contests.updatedAt,
        eventTitle: events.title,
        bannerUrl: events.bannerUrl,
        organizerName: user.name,
        organizerOrgName: user.orgName,
        categoryCount: contestCategoryCount,
        entryCount: contestEntryCount,
        voteCount: contestVoteCount,
        unspentCredits: contestUnspentCredits,
      })
      .from(contests)
      .innerJoin(events, eq(events.id, contests.eventId))
      .innerJoin(user, eq(user.id, events.organizerId))
      .where(CONTEST_PUBLIC)
      .orderBy(desc(contestVoteCount), desc(contests.updatedAt))

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      // 'published' takes votes; 'closed' has stopped but its results page is
      // still public, which is its own reason to be able to pull it.
      status: r.status as 'published' | 'closed',
      eventTitle: r.eventTitle,
      thumbnailUrl: r.bannerUrl ?? '',
      organizerName: r.organizerOrgName ?? r.organizerName,
      categoryCount: r.categoryCount,
      entryCount: r.entryCount,
      voteCount: r.voteCount,
      // Votes bought and not yet cast: what a takedown strands.
      unspentCredits: r.unspentCredits,
      approvedAt: (r.approvedAt ?? r.updatedAt).toISOString(),
    }))
  }),

  // The contest as a voter would meet it, for the admin to judge the ballot:
  // its wording, every category with every entry in it, every bundle on sale
  // with its price, and how voting is paid for. `revision` names exactly this
  // content; approveContest takes it back and refuses if the contest has
  // changed since. One REPEATABLE READ snapshot, so the revision and the
  // ballot cannot come from different moments. Null when there is no such
  // contest.
  contestById: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(({ ctx, input }) =>
      ctx.db.transaction(
        async (tx) => {
          const [row] = await tx
            .select({
              contest: contests,
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
            .from(contests)
            .innerJoin(events, eq(events.id, contests.eventId))
            .innerJoin(user, eq(user.id, events.organizerId))
            .where(eq(contests.id, input.id))
            .limit(1)
          if (!row) return null
          const { contest, event, organizer } = row

          const categoryRows = await tx
            .select()
            .from(contestCategories)
            .where(eq(contestCategories.contestId, contest.id))
            .orderBy(
              asc(contestCategories.sortOrder),
              asc(contestCategories.id)
            )
          const entryRows = await tx
            .select()
            .from(entries)
            .where(eq(entries.contestId, contest.id))
            .orderBy(asc(entries.sortOrder), asc(entries.id))
          // Retired bundles are shown too, marked: they are not on sale, but
          // they back orders already placed, so an admin judging what people
          // were charged has to be able to see them.
          const bundleRows = await tx
            .select()
            .from(voteBundles)
            .where(eq(voteBundles.contestId, contest.id))
            .orderBy(asc(voteBundles.sortOrder), asc(voteBundles.priceMinor))
          const [credits] = await tx
            .select({
              unspent: sql<number>`COALESCE(SUM(${voteCredits.purchased} - ${voteCredits.spent}), 0)::int`,
            })
            .from(voteCredits)
            .where(eq(voteCredits.contestId, contest.id))
          const [reviewer] = contest.reviewerId
            ? await tx
                .select({ name: user.name })
                .from(user)
                .where(eq(user.id, contest.reviewerId))
                .limit(1)
            : []

          const voteCount = entryRows.reduce((n, e) => n + e.voteCount, 0)

          return {
            id: contest.id,
            title: contest.title,
            description: contest.description,
            slug: contest.slug,
            status: contest.status,
            timeZone: contest.timeZone,
            votingOpensAt: contest.votingOpensAt
              ? contest.votingOpensAt.toISOString()
              : null,
            votingClosesAt: contest.votingClosesAt
              ? contest.votingClosesAt.toISOString()
              : null,
            nominationsOpenAt: contest.nominationsOpenAt
              ? contest.nominationsOpenAt.toISOString()
              : null,
            nominationsCloseAt: contest.nominationsCloseAt
              ? contest.nominationsCloseAt.toISOString()
              : null,
            // How the public pays to take part — reviewed content, exactly as
            // a form's price options are.
            freeVotingEnabled: contest.freeVotingEnabled,
            paidVotingEnabled: contest.paidVotingEnabled,
            pricePerVoteMinor: contest.pricePerVoteMinor,
            revision: contest.contentRevision,
            history: reviewHistory(contest),
            submittedAt: contest.reviewRequestedAt
              ? contest.reviewRequestedAt.toISOString()
              : null,
            // The latest decision; with history 'resubmitted' it was a
            // rejection, and rejectionReason says why.
            lastReview: contest.reviewedAt
              ? {
                  at: contest.reviewedAt.toISOString(),
                  by: reviewer?.name ?? null,
                }
              : null,
            rejectionReason: contest.rejectionReason,
            voteCount,
            unspentCredits: credits?.unspent ?? 0,
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
            // The ballot, nested the way it is voted on: a category, then
            // everyone standing in it.
            categories: categoryRows.map((category) => ({
              id: category.id,
              title: category.title,
              description: category.description,
              entries: entryRows
                .filter((entry) => entry.categoryId === category.id)
                .map((entry) => ({
                  id: entry.id,
                  displayName: entry.displayName,
                  photoUrl: entry.photoUrl,
                  bio: entry.bio,
                  status: entry.status,
                  voteCount: entry.voteCount,
                  // A hand-added entry has no submission behind it; one
                  // promoted from a form does.
                  promoted: entry.submissionId !== null,
                })),
            })),
            bundles: bundleRows.map((bundle) => ({
              id: bundle.id,
              label: bundle.label,
              votes: bundle.votes,
              priceMinor: bundle.priceMinor,
              active: bundle.active,
            })),
          }
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' }
      )
    ),

  // Puts the contest live. `revision` is the one contestById showed the
  // admin, and the UPDATE matches only while the contest is still waiting for
  // review at that revision. The status check alone isn't enough: an
  // organizer can keep editing a contest while it waits, which leaves it
  // 'pending_review' but changes the ballot or the price, so the admin would
  // approve content they never saw. Every content edit moves the revision on
  // under the contest row lock before it commits (contest-review.
  // recordContentChange), so whichever of the two commits first, the other
  // sees it: an edit that wins makes this match nothing (CONFLICT; the admin
  // reloads and reviews again), and an approval that wins is followed by the
  // edit sending the contest straight back to review.
  //
  // This, and nothing else, writes `approvedRevision`.
  approveContest: adminProcedure
    .input(
      z.object({
        id: z.string().min(1),
        revision: z.number().int().min(0),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const target = await findContestForReview(ctx.db, input.id)
      if (!target) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Contest not found' })
      }
      assertContestAwaitingReview(target.contest.status)
      if (target.contest.contentRevision !== input.revision) {
        throw contestChangedError()
      }
      await assertContestApprovable(ctx.db, target.contest)

      const now = new Date()
      const updated = await ctx.db
        .update(contests)
        .set({
          status: 'published',
          // The revision the admin was SHOWN, not whatever is current: if
          // those two could differ the UPDATE below would not have matched.
          approvedRevision: input.revision,
          reviewerId: ctx.session.user.id,
          reviewedAt: now,
          rejectionReason: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(contests.id, target.contest.id),
            CONTEST_PENDING,
            eq(contests.contentRevision, input.revision)
          )
        )
        .returning({ id: contests.id })
      if (updated.length === 0) {
        // Something committed between the checks above and the UPDATE.
        const [current] = await ctx.db
          .select({ status: contests.status })
          .from(contests)
          .where(eq(contests.id, target.contest.id))
          .limit(1)
        if (!current) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Contest not found',
          })
        }
        assertContestAwaitingReview(current.status)
        throw contestChangedError()
      }

      await sendContestApproved({
        email: target.organizer.email,
        organizerName: target.organizer.orgName ?? target.organizer.name,
        contestTitle: target.contest.title,
        eventTitle: target.eventTitle,
        ...contestLinks(target.contest),
      })

      return { ok: true as const }
    }),

  // Sends the contest back to its organizer with the reason, shown on the
  // contest and in the email; they fix it and resubmit. The status check is
  // enough here: rejecting content newer than the admin saw keeps the contest
  // offline, which is the safe side.
  rejectContest: adminProcedure
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
      const target = await findContestForReview(ctx.db, input.id)
      if (!target) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Contest not found' })
      }
      assertContestAwaitingReview(target.contest.status)

      const now = new Date()
      const updated = await ctx.db
        .update(contests)
        .set({
          status: 'rejected',
          reviewerId: ctx.session.user.id,
          reviewedAt: now,
          rejectionReason: input.reason,
          updatedAt: now,
        })
        .where(and(eq(contests.id, target.contest.id), CONTEST_PENDING))
        .returning({ id: contests.id })
      if (updated.length === 0) throw contestNotAwaitingReview()

      await sendContestRejected({
        email: target.organizer.email,
        organizerName: target.organizer.orgName ?? target.organizer.name,
        contestTitle: target.contest.title,
        eventTitle: target.eventTitle,
        reason: input.reason,
        manageUrl: contestLinks(target.contest).manageUrl,
      })

      return { ok: true as const }
    }),

  // Pulls a public contest down: voting stops at once and its page goes with
  // it. The remedy when something got past review — a rigged ballot, an entry
  // nobody consented to, a contest that turns out to be fraudulent — or when
  // a closed contest's still-public results have to go.
  //
  // Why 'suspended' and not 'closed': a closed contest keeps a public results
  // page and its organizer can resubmit it to restart voting. 'suspended' is
  // reachable only from here; the organizer's one route back is submit, which
  // ends at an admin approving it again (contest-review.SUBMITTABLE), so the
  // takedown holds.
  //
  // `approvedRevision` is CLEARED. Nothing about a contest an admin pulled
  // down is approved content any more, and leaving it set would let anything
  // that reads `approvedAsIs` — today, or a path added later — treat a
  // suspended contest as still carrying an admin's approval.
  //
  // Votes and credits are untouched. A vote is somebody's choice and a credit
  // is somebody's money; the takedown is about what is on the page.
  takeDownContest: adminProcedure
    .input(
      z.object({
        id: z.string().min(1),
        reason: z
          .string()
          .trim()
          .min(1, 'Say why this contest is being taken down')
          .max(2000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const target = await findContestForReview(ctx.db, input.id)
      if (!target) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Contest not found' })
      }
      if (!CONTEST_TAKE_DOWN_FROM.includes(target.contest.status)) {
        throw contestNotTakeDownable(target.contest.status)
      }

      // The status check sits in the UPDATE, so a takedown that races the
      // organizer closing the contest, or an edit sending it back to review,
      // resolves to one outcome: whichever commits first holds the row, and
      // the other re-reads the row as it now is. Losing means the contest is
      // already off the public site, which is the safe side.
      const now = new Date()
      const updated = await ctx.db
        .update(contests)
        .set({
          status: 'suspended',
          approvedRevision: null,
          reviewerId: ctx.session.user.id,
          reviewedAt: now,
          rejectionReason: input.reason,
          updatedAt: now,
        })
        .where(
          and(
            eq(contests.id, target.contest.id),
            inArray(contests.status, CONTEST_TAKE_DOWN_FROM)
          )
        )
        .returning({ id: contests.id })
      if (updated.length === 0) {
        const [current] = await ctx.db
          .select({ status: contests.status })
          .from(contests)
          .where(eq(contests.id, target.contest.id))
          .limit(1)
        if (!current) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Contest not found',
          })
        }
        throw contestNotTakeDownable(current.status)
      }

      await sendContestTakenDown({
        email: target.organizer.email,
        organizerName: target.organizer.orgName ?? target.organizer.name,
        contestTitle: target.contest.title,
        eventTitle: target.eventTitle,
        reason: input.reason,
        manageUrl: contestLinks(target.contest).manageUrl,
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
