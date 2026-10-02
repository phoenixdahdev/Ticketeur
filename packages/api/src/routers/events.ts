import { TRPCError } from '@trpc/server'
import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm'
import { tasks } from '@trigger.dev/sdk'
import { z } from 'zod'

import {
  events,
  eventVendors,
  externalVendorInvites,
  orders,
  ticketTiers,
  tickets,
  user,
} from '@ticketur/db'

import { createTRPCRouter, organizerProcedure } from '../trpc'
import { newId } from '../lib/ids'
import { generateUniqueEventSlug } from '../lib/slug'
import { logActivity } from '../lib/activity'
import { getBaseUrl } from '../lib/base-url'
import { applyEventEdit, assertEventEditAllowed } from '../lib/events'

// ─── Creating an event: the status it starts in ────────────────────────────
//
// An event on the public site is one an admin approved. Every moderation
// control hangs off that: the public listings filter `status = 'upcoming'`,
// and a registration form can never be more visible than its event (see
// public/forms.ts). So the status a new event is stored with is decided here,
// by the server, from the caller's role — it is not whatever the client sent.
//
// What a client may ask for. 'archived' is not a state you create something
// in, and there is no 'suspended' here either: that is an admin verdict on an
// existing event, never an opening position.
const createStatusEnum = z.enum(['draft', 'in-review', 'upcoming'])

// The status actually stored. An allow-list: anything this doesn't name
// explicitly lands in the review queue, so a value added to EventStatus later
// cannot go live by default.
//
//   'draft'    — saved privately, visible to nobody, for anyone. A draft is
//                the organizer's own workspace; `events.publish` moves it on
//                to 'in-review', never straight to live.
//   'upcoming' — live on the public site. Admins only, mirroring the bypass
//                `events.update` already grants them ("they are the
//                moderators"). Narrow on purpose: `create` always sets
//                organizerId to the caller, so this lets an admin publish
//                their own event and nobody else's — unlike registration
//                forms, where managesEvent would let an admin push another
//                organizer's content live unseen, which is why form-review.ts
//                refuses an admin bypass there. And it grants no new power:
//                an admin can already put any event live in one call with
//                admin.moderation.approveEvent.
//   anything else, from anyone — 'in-review', the admin queue.
function resolveCreateStatus(
  role: string | null | undefined,
  requested: z.infer<typeof createStatusEnum>
): 'draft' | 'in-review' | 'upcoming' {
  if (requested === 'draft') return 'draft'
  if (requested === 'upcoming' && role === 'admin') return 'upcoming'
  return 'in-review'
}

const ticketTierInput = z.object({
  name: z.string().trim().min(1),
  quantity: z.number().int().min(1),
  // priceMinor: amount in minor units (e.g., kobo)
  priceMinor: z.number().int().min(0),
})

// On edit, existing tiers carry their `id` so we can reconcile against
// already-sold counts; new tiers added in the form come through without one.
const updateTicketTierInput = ticketTierInput.extend({
  id: z.string().optional(),
})

const createEventInput = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().min(10),
  date: z.string().min(1),
  // ISO end date (YYYY-MM-DD) for multi-day events. Null/missing means
  // single-day; the event runs only on `date`.
  endDate: z.string().nullable().optional(),
  time: z.string().min(1),
  location: z.string().trim().min(1),
  bannerUrl: z.string().nullable().optional(),
  features: z.array(z.string().trim()).default([]),
  tiers: z.array(ticketTierInput).min(1),
  assignedVendorIds: z.array(z.string()).default([]),
  externalInvites: z
    .array(
      z.object({
        businessName: z.string().trim().min(1),
        contactName: z.string().trim().min(1),
        email: z.email(),
        phone: z.string().trim().min(1),
      })
    )
    .default([]),
  // A request, not an instruction: resolveCreateStatus decides what is
  // stored. An organizer asking to go live is answered with the review queue.
  status: createStatusEnum.default('in-review'),
})

// Editing never changes an event's status directly (publishing is a separate
// action) or its vendor roster, so this is the create shape minus those,
// plus the event id and tier ids.
const updateEventInput = z
  .object({
    id: z.string(),
    title: z.string().trim().min(1),
    description: z.string().trim().min(10),
    date: z.string().min(1),
    endDate: z.string().nullable().optional(),
    time: z.string().min(1),
    location: z.string().trim().min(1),
    bannerUrl: z.string().nullable().optional(),
    features: z.array(z.string().trim()).default([]),
    tiers: z.array(updateTicketTierInput).min(1),
  })
  .refine((v) => !v.endDate || v.endDate >= v.date, {
    path: ['endDate'],
    message: 'End date must be on or after the start date',
  })

const guestsInput = z.object({
  eventId: z.string(),
  q: z.string().default(''),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
})

const setCheckedInInput = z.object({
  code: z.string().min(1),
  checkedIn: z.boolean(),
  // When passed, the ticket must belong to this event — guards a scanner
  // page scoped to one event against a valid code from a different event
  // the same organizer also runs.
  eventId: z.string().optional(),
})

const listInput = z.object({
  tab: z
    .enum(['all', 'upcoming', 'in-review', 'draft', 'archived'])
    .default('all'),
  q: z.string().default(''),
  sort: z.enum(['name', 'date', 'location', 'status', 'sales']).default('date'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(10),
})

export const eventsRouter = createTRPCRouter({
  // ─── Mutations ────────────────────────────────────────────────────────────

  create: organizerProcedure
    .input(createEventInput)
    .mutation(async ({ ctx, input }) => {
      const eventId = newId('evt')
      // Slug is derived from the title server-side (never client-supplied),
      // with -2/-3 suffixes appended on collision.
      const slug = await generateUniqueEventSlug(ctx.db, input.title)
      // Likewise the status: see resolveCreateStatus above. An organizer
      // cannot put an event on the public site, whatever they send.
      const status = resolveCreateStatus(ctx.session.user.role, input.status)

      await ctx.db.transaction(async (tx) => {
        await tx.insert(events).values({
          id: eventId,
          organizerId: ctx.session.user.id,
          title: input.title,
          slug,
          description: input.description,
          eventDate: input.date,
          endDate:
            input.endDate && input.endDate !== input.date
              ? input.endDate
              : null,
          eventTime: input.time,
          location: input.location,
          bannerUrl: input.bannerUrl ?? null,
          features: input.features,
          status,
        })

        if (input.tiers.length > 0) {
          await tx.insert(ticketTiers).values(
            input.tiers.map((tier, idx) => ({
              id: newId('tier'),
              eventId,
              name: tier.name,
              quantity: tier.quantity,
              priceMinor: tier.priceMinor,
              sortOrder: idx,
            }))
          )
        }

        if (input.assignedVendorIds.length > 0) {
          // Filter to vendors that actually exist + have vendor role
          const validVendors = await tx
            .select({ id: user.id })
            .from(user)
            .where(
              and(
                inArray(user.id, input.assignedVendorIds),
                eq(user.role, 'vendor')
              )
            )

          if (validVendors.length > 0) {
            await tx.insert(eventVendors).values(
              validVendors.map((v) => ({
                id: newId('evnd'),
                eventId,
                vendorId: v.id,
                status: 'invited' as const,
              }))
            )
          }
        }

        if (input.externalInvites.length > 0) {
          // For each external invite: ensure a vendor user account exists
          // (creating a pending one if needed), then link via eventVendors.
          // We still record the original invite payload (incl. phone) in
          // externalVendorInvites so the organizer can see who they invited.
          await tx.insert(externalVendorInvites).values(
            input.externalInvites.map((inv) => ({
              id: newId('einv'),
              eventId,
              businessName: inv.businessName,
              contactName: inv.contactName,
              email: inv.email,
              phone: inv.phone,
            }))
          )

          for (const inv of input.externalInvites) {
            const existing = await tx
              .select({
                id: user.id,
                role: user.role,
                vendorApprovalStatus: user.vendorApprovalStatus,
              })
              .from(user)
              .where(eq(user.email, inv.email))
              .limit(1)

            let vendorId: string

            if (existing[0]) {
              vendorId = existing[0].id
              // Promote existing accounts to vendor (still pending) if they
              // weren't a vendor yet. Don't downgrade approved vendors.
              if (existing[0].role !== 'vendor') {
                await tx
                  .update(user)
                  .set({
                    role: 'vendor',
                    vendorApprovalStatus: 'pending',
                    businessName: inv.businessName,
                  })
                  .where(eq(user.id, vendorId))
              }
            } else {
              // Stub vendor account; they'll set a password via the
              // forgot-password / sign-up flow we send in the invite email.
              vendorId = newId('usr')
              const now = new Date()
              await tx.insert(user).values({
                id: vendorId,
                name: inv.contactName,
                email: inv.email,
                emailVerified: false,
                role: 'vendor',
                vendorApprovalStatus: 'pending',
                businessName: inv.businessName,
                createdAt: now,
                updatedAt: now,
              })
            }

            // Link to this event (idempotent: skip if already linked).
            const alreadyLinked = await tx
              .select({ id: eventVendors.id })
              .from(eventVendors)
              .where(
                and(
                  eq(eventVendors.eventId, eventId),
                  eq(eventVendors.vendorId, vendorId)
                )
              )
              .limit(1)

            if (!alreadyLinked[0]) {
              await tx.insert(eventVendors).values({
                id: newId('evnd'),
                eventId,
                vendorId,
                status: 'invited',
              })
            }
          }
        }
      })

      // Fire invite emails outside the transaction. Failures here must not
      // roll back the event creation — the organizer can resend invites later.
      if (input.externalInvites.length > 0) {
        const baseUrl = getBaseUrl()

        for (const inv of input.externalInvites) {
          const signupUrl = `${baseUrl}/signup?role=vendor&invite=vendor&email=${encodeURIComponent(inv.email)}`
          void tasks.trigger('send-vendor-invite', {
            email: inv.email,
            businessName: inv.businessName,
            contactName: inv.contactName,
            organizerName: ctx.session.user.name,
            eventTitle: input.title,
            signupUrl,
          })
        }
      }

      await logActivity(ctx, {
        organizerId: ctx.session.user.id,
        type: 'event.created',
        eventId,
        payload: { title: input.title },
      })

      // The status it actually got, not the one that was asked for, so the
      // caller tells the organizer the truth ("sent for review", not "live").
      return { id: eventId, status }
    }),

  update: organizerProcedure
    .input(updateEventInput)
    .mutation(async ({ ctx, input }) => {
      const found = await ctx.db
        .select({
          id: events.id,
          organizerId: events.organizerId,
          status: events.status,
        })
        .from(events)
        .where(eq(events.id, input.id))
        .limit(1)
      const ev = found[0]
      if (!ev) throw new TRPCError({ code: 'NOT_FOUND' })
      if (
        ev.organizerId !== ctx.session.user.id &&
        ctx.session.user.role !== 'admin'
      ) {
        throw new TRPCError({ code: 'FORBIDDEN' })
      }
      // Archived/suspended events are frozen — no edits once they leave the
      // organizer's control.
      if (ev.status === 'archived' || ev.status === 'suspended') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This event can no longer be edited.',
        })
      }

      const payload = {
        title: input.title,
        description: input.description,
        date: input.date,
        endDate: input.endDate ?? null,
        time: input.time,
        location: input.location,
        bannerUrl: input.bannerUrl ?? null,
        features: input.features,
        tiers: input.tiers,
      }

      // A live event that an organizer edits doesn't change on the public site
      // right away: the edit is queued for admin approval and the current
      // version keeps showing until approved. Admins editing directly bypass
      // the queue (they are the moderators), and draft/in-review events aren't
      // public so they apply immediately regardless.
      const needsApproval =
        ev.status === 'upcoming' && ctx.session.user.role !== 'admin'

      if (needsApproval) {
        await assertEventEditAllowed(ev.id, payload)
        await ctx.db
          .update(events)
          .set({ pendingChanges: payload, pendingSubmittedAt: new Date() })
          .where(eq(events.id, ev.id))
        await logActivity(ctx, {
          organizerId: ev.organizerId,
          type: 'event.edit_submitted',
          eventId: ev.id,
          payload: { title: payload.title },
        })
        return { id: ev.id, pending: true as const }
      }

      await ctx.db.transaction((tx) => applyEventEdit(tx, ev.id, payload))
      await logActivity(ctx, {
        organizerId: ev.organizerId,
        type: 'event.updated',
        eventId: ev.id,
        payload: { title: payload.title },
      })
      return { id: ev.id, pending: false as const }
    }),

  publish: organizerProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const found = await ctx.db
        .select({
          id: events.id,
          organizerId: events.organizerId,
          title: events.title,
          status: events.status,
        })
        .from(events)
        .where(eq(events.id, input.id))
        .limit(1)
      const ev = found[0]
      if (!ev) throw new TRPCError({ code: 'NOT_FOUND' })
      if (
        ev.organizerId !== ctx.session.user.id &&
        ctx.session.user.role !== 'admin'
      ) {
        throw new TRPCError({ code: 'FORBIDDEN' })
      }
      if (ev.status !== 'draft') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Only draft events can be published.',
        })
      }

      // An event needs at least one ticket tier before it can go live.
      const [tierCount] = await ctx.db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(ticketTiers)
        .where(eq(ticketTiers.eventId, ev.id))
      if ((tierCount?.count ?? 0) === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Add at least one ticket tier before publishing.',
        })
      }

      // Publishing submits the event into the admin review queue, mirroring
      // the "submit for review" path used when creating an event.
      await ctx.db
        .update(events)
        .set({ status: 'in-review', updatedAt: new Date() })
        .where(eq(events.id, ev.id))

      await logActivity(ctx, {
        organizerId: ev.organizerId,
        type: 'event.published',
        eventId: ev.id,
        payload: { title: ev.title },
      })

      return { id: ev.id, status: 'in-review' as const }
    }),

  archive: organizerProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const found = await ctx.db
        .select({
          id: events.id,
          organizerId: events.organizerId,
          title: events.title,
          status: events.status,
        })
        .from(events)
        .where(eq(events.id, input.id))
        .limit(1)
      const ev = found[0]
      if (!ev) throw new TRPCError({ code: 'NOT_FOUND' })
      if (
        ev.organizerId !== ctx.session.user.id &&
        ctx.session.user.role !== 'admin'
      ) {
        throw new TRPCError({ code: 'FORBIDDEN' })
      }

      // Archiving is the organizer clearing their own active list. It must not
      // double as a way out of moderation: an admin-suspended event that
      // archived itself would reappear publicly once its date passed, because
      // the past tab lists 'archived' (public/events.ts). The dashboard only
      // offers Archive on a live event; this is that same rule, enforced.
      if (ev.status !== 'upcoming') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            ev.status === 'suspended'
              ? 'This event has been suspended by Ticketeur and cannot be archived. Please contact support.'
              : 'Only a live event can be archived.',
        })
      }

      await ctx.db
        .update(events)
        .set({ status: 'archived', updatedAt: new Date() })
        .where(eq(events.id, input.id))

      await logActivity(ctx, {
        organizerId: ev.organizerId,
        type: 'event.archived',
        eventId: ev.id,
        payload: { title: ev.title },
      })

      return { id: ev.id }
    }),

  delete: organizerProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const found = await ctx.db
        .select({
          id: events.id,
          organizerId: events.organizerId,
          title: events.title,
          status: events.status,
        })
        .from(events)
        .where(eq(events.id, input.id))
        .limit(1)
      const ev = found[0]
      if (!ev) throw new TRPCError({ code: 'NOT_FOUND' })
      if (
        ev.organizerId !== ctx.session.user.id &&
        ctx.session.user.role !== 'admin'
      ) {
        throw new TRPCError({ code: 'FORBIDDEN' })
      }

      // Deleting an event cascades: orders, order_items, tickets, ticket_tiers,
      // forms, form_fields, form_price_options, submissions, vouchers and
      // vendor links all go with it — every one of those FKs is ON DELETE
      // cascade. So it is guarded twice.
      //
      // 1. Only from the two states the dashboard offers Delete in. Without
      //    this, a suspended event could be erased outright rather than
      //    answered for.
      if (ev.status !== 'draft' && ev.status !== 'archived') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            ev.status === 'suspended'
              ? 'This event has been suspended by Ticketeur and cannot be deleted. Please contact support.'
              : 'Archive this event before deleting it.',
        })
      }

      // 2. Never destroy the record of money that changed hands. A draft can't
      //    have sales, so this only bites on an archived event that sold —
      //    precisely the case where the cascade would take paid orders and the
      //    tickets their buyers are holding with it.
      const [paidOrders] = await ctx.db
        .select({ n: sql<number>`COUNT(*)::int` })
        .from(orders)
        .where(and(eq(orders.eventId, input.id), eq(orders.status, 'paid')))
      const [issuedTickets] = await ctx.db
        .select({ n: sql<number>`COUNT(*)::int` })
        .from(tickets)
        .where(eq(tickets.eventId, input.id))
      if ((paidOrders?.n ?? 0) > 0 || (issuedTickets?.n ?? 0) > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'This event has sold tickets, so it cannot be deleted — the orders and the tickets people are holding are financial records. It stays archived instead.',
        })
      }

      await ctx.db.delete(events).where(eq(events.id, input.id))

      await logActivity(ctx, {
        organizerId: ev.organizerId,
        type: 'event.deleted',
        eventId: null,
        payload: { title: ev.title, eventId: ev.id },
      })

      return { id: ev.id }
    }),

  // ─── Queries ──────────────────────────────────────────────────────────────

  list: organizerProcedure.input(listInput).query(async ({ ctx, input }) => {
    const organizerId = ctx.session.user.id

    const filters = [eq(events.organizerId, organizerId)]
    if (input.tab !== 'all') filters.push(eq(events.status, input.tab))
    if (input.q.trim().length > 0) {
      filters.push(ilike(events.title, `%${input.q.trim()}%`))
    }

    // Aggregate sold/total per event
    const soldExpr = sql<number>`COALESCE(SUM(${ticketTiers.sold}), 0)::int`.as(
      'sold'
    )
    const totalExpr =
      sql<number>`COALESCE(SUM(${ticketTiers.quantity}), 0)::int`.as('total')

    const orderBy = (() => {
      const dir = input.dir === 'asc' ? sql`ASC` : sql`DESC`
      switch (input.sort) {
        case 'name':
          return sql`${events.title} ${dir}`
        case 'location':
          return sql`${events.location} ${dir}`
        case 'status':
          return sql`${events.status} ${dir}`
        case 'sales':
          return sql`${soldExpr} ${dir}`
        case 'date':
        default:
          return sql`${events.eventDate} ${dir}`
      }
    })()

    const rows = await ctx.db
      .select({
        id: events.id,
        title: events.title,
        eventDate: events.eventDate,
        endDate: events.endDate,
        location: events.location,
        status: events.status,
        sold: soldExpr,
        total: totalExpr,
      })
      .from(events)
      .leftJoin(ticketTiers, eq(ticketTiers.eventId, events.id))
      .where(and(...filters))
      .groupBy(events.id)
      .orderBy(orderBy)
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize)

    const totalCountRows = await ctx.db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(events)
      .where(and(...filters))

    return {
      rows,
      total: totalCountRows[0]?.count ?? 0,
      page: input.page,
      pageSize: input.pageSize,
    }
  }),

  byId: organizerProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const found = await ctx.db
        .select()
        .from(events)
        .where(eq(events.id, input.id))
        .limit(1)
      const ev = found[0]
      if (!ev) return null
      if (
        ev.organizerId !== ctx.session.user.id &&
        ctx.session.user.role !== 'admin'
      ) {
        return null
      }

      const tiers = await ctx.db
        .select()
        .from(ticketTiers)
        .where(eq(ticketTiers.eventId, ev.id))
        .orderBy(asc(ticketTiers.priceMinor), asc(ticketTiers.sortOrder))

      const vendors = await ctx.db
        .select({
          id: eventVendors.id,
          status: eventVendors.status,
          vendor: {
            id: user.id,
            businessName: user.businessName,
            businessCategory: user.businessCategory,
            businessDescription: user.businessDescription,
            image: user.image,
          },
        })
        .from(eventVendors)
        .innerJoin(user, eq(user.id, eventVendors.vendorId))
        .where(eq(eventVendors.eventId, ev.id))

      const externalInvites = await ctx.db
        .select()
        .from(externalVendorInvites)
        .where(eq(externalVendorInvites.eventId, ev.id))

      const totals = await ctx.db
        .select({
          sold: sql<number>`COALESCE(SUM(${ticketTiers.sold}), 0)::int`,
          total: sql<number>`COALESCE(SUM(${ticketTiers.quantity}), 0)::int`,
          revenueMinor: sql<number>`COALESCE(SUM(${ticketTiers.sold} * ${ticketTiers.priceMinor}), 0)::int`,
        })
        .from(ticketTiers)
        .where(eq(ticketTiers.eventId, ev.id))

      const totalsRow = totals[0] ?? { sold: 0, total: 0, revenueMinor: 0 }

      const ordersTotal = await ctx.db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(orders)
        .where(
          and(
            eq(orders.eventId, ev.id),
            eq(orders.status, 'paid'),
            // Ticket orders only, to match the ticket sales above: a
            // registration fee is an order too, but not a ticket sale.
            eq(orders.type, 'ticket')
          )
        )

      return {
        event: ev,
        tiers,
        vendors,
        externalInvites,
        sold: totalsRow.sold,
        total: totalsRow.total,
        revenueMinor: totalsRow.revenueMinor,
        ordersCount: ordersTotal[0]?.count ?? 0,
      }
    }),

  // One row per ticket (not per order) — a group order's attendees each get
  // their own row, since a guest list names people, not purchases.
  guests: organizerProcedure
    .input(guestsInput)
    .query(async ({ ctx, input }) => {
      const found = await ctx.db
        .select({ id: events.id, organizerId: events.organizerId })
        .from(events)
        .where(eq(events.id, input.eventId))
        .limit(1)
      const ev = found[0]
      if (!ev) throw new TRPCError({ code: 'NOT_FOUND' })
      if (
        ev.organizerId !== ctx.session.user.id &&
        ctx.session.user.role !== 'admin'
      ) {
        throw new TRPCError({ code: 'FORBIDDEN' })
      }

      const filters = [eq(tickets.eventId, input.eventId)]
      const q = input.q.trim()
      if (q.length > 0) {
        const needle = `%${q}%`
        filters.push(
          or(
            ilike(tickets.recipientName, needle),
            ilike(tickets.recipientEmail, needle),
            ilike(tickets.code, needle),
            ilike(orders.buyerName, needle),
            ilike(orders.buyerEmail, needle)
          )!
        )
      }

      const rows = await ctx.db
        .select({
          id: tickets.id,
          code: tickets.code,
          recipientName: tickets.recipientName,
          recipientEmail: tickets.recipientEmail,
          buyerName: orders.buyerName,
          buyerEmail: orders.buyerEmail,
          tierName: ticketTiers.name,
          checkedIn: tickets.checkedIn,
          checkedInAt: tickets.checkedInAt,
          purchasedAt: orders.paidAt,
        })
        .from(tickets)
        .innerJoin(orders, eq(orders.id, tickets.orderId))
        .leftJoin(ticketTiers, eq(ticketTiers.id, tickets.tierId))
        .where(and(...filters))
        .orderBy(asc(tickets.createdAt))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize)

      const totalRows = await ctx.db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(tickets)
        .innerJoin(orders, eq(orders.id, tickets.orderId))
        .where(and(...filters))

      return {
        rows: rows.map((r) => ({
          id: r.id,
          code: r.code,
          name: r.recipientName || r.buyerName || 'Guest',
          email: r.recipientEmail || r.buyerEmail || '',
          tierName: r.tierName ?? 'General',
          checkedIn: r.checkedIn,
          checkedInAt: r.checkedInAt,
          purchasedAt: r.purchasedAt,
        })),
        total: totalRows[0]?.count ?? 0,
        page: input.page,
        pageSize: input.pageSize,
      }
    }),

  // Toggles a ticket's check-in state by its QR/gate code — the code is
  // globally unique, so it alone resolves the event (and thus the organizer
  // check) without the caller needing to already know which event it's for.
  setCheckedIn: organizerProcedure
    .input(setCheckedInInput)
    .mutation(async ({ ctx, input }) => {
      const found = await ctx.db
        .select({
          id: tickets.id,
          eventId: tickets.eventId,
          checkedIn: tickets.checkedIn,
          organizerId: events.organizerId,
          recipientName: tickets.recipientName,
          buyerName: orders.buyerName,
          tierName: ticketTiers.name,
        })
        .from(tickets)
        .innerJoin(events, eq(events.id, tickets.eventId))
        .innerJoin(orders, eq(orders.id, tickets.orderId))
        .leftJoin(ticketTiers, eq(ticketTiers.id, tickets.tierId))
        .where(eq(tickets.code, input.code))
        .limit(1)
      const ticket = found[0]
      if (!ticket) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Ticket not found' })
      }
      if (
        ticket.organizerId !== ctx.session.user.id &&
        ctx.session.user.role !== 'admin'
      ) {
        throw new TRPCError({ code: 'FORBIDDEN' })
      }
      if (input.eventId && ticket.eventId !== input.eventId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This ticket is for a different event',
        })
      }

      const name = ticket.recipientName || ticket.buyerName || 'Guest'
      const tierName = ticket.tierName ?? 'General'

      // Already in the requested state (e.g. a double-tap, or the same QR
      // scanned twice) — no-op, but tell the caller nothing changed so a
      // scanner can distinguish a fresh check-in from a repeat scan.
      if (ticket.checkedIn === input.checkedIn) {
        return {
          id: ticket.id,
          checkedIn: ticket.checkedIn,
          changed: false,
          name,
          tierName,
        }
      }

      const checkedInAt = input.checkedIn ? new Date() : null
      await ctx.db
        .update(tickets)
        .set({ checkedIn: input.checkedIn, checkedInAt })
        .where(eq(tickets.id, ticket.id))

      return {
        id: ticket.id,
        checkedIn: input.checkedIn,
        checkedInAt,
        changed: true,
        name,
        tierName,
      }
    }),
})

export type EventsRouter = typeof eventsRouter
