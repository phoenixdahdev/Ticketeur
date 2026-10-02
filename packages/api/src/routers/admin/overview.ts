import { count, desc, eq, sql } from 'drizzle-orm'

import { events, forms, orders, reports, user } from '@ticketur/db'

import { adminProcedure, createTRPCRouter } from '../../trpc'
import {
  NOT_ADMIN,
  NOT_DRAFT,
  VENDOR_PENDING,
  EVENT_PENDING,
  FORM_PENDING,
  REPORT_OPEN,
} from '../../lib/predicates'


export const adminOverviewRouter = createTRPCRouter({
  // One round-trip for the four cards on the overview page.
  stats: adminProcedure.query(async ({ ctx }) => {
    const [userRow] = await ctx.db
      .select({ value: count(user.id) })
      .from(user)
      .where(NOT_ADMIN)

    const [eventRow] = await ctx.db
      .select({ value: count(events.id) })
      .from(events)
      .where(NOT_DRAFT)

    const [revenueRow] = await ctx.db
      .select({
        value: sql<number>`coalesce(sum(${orders.totalMinor}), 0)`,
      })
      .from(orders)
      .where(eq(orders.status, 'paid'))

    const [pendingVendorRow] = await ctx.db
      .select({ value: count(user.id) })
      .from(user)
      .where(VENDOR_PENDING)
    const [pendingEventRow] = await ctx.db
      .select({ value: count(events.id) })
      .from(events)
      .where(EVENT_PENDING)
    const [reportRow] = await ctx.db
      .select({ value: count(reports.id) })
      .from(reports)
      .where(REPORT_OPEN)
    const [pendingFormRow] = await ctx.db
      .select({ value: count(forms.id) })
      .from(forms)
      .where(FORM_PENDING)

    const pending =
      Number(pendingVendorRow?.value ?? 0) +
      Number(pendingEventRow?.value ?? 0) +
      Number(reportRow?.value ?? 0) +
      Number(pendingFormRow?.value ?? 0)

    return {
      totalUsers: Number(userRow?.value ?? 0),
      totalEvents: Number(eventRow?.value ?? 0),
      totalRevenueMinor: Number(revenueRow?.value ?? 0),
      pendingApprovals: pending,
    }
  }),

  // Merged feed for the "Recent Activity" card. Combines latest user
  // signups, latest vendor registrations, and latest event creations.
  recentActivity: adminProcedure.query(async ({ ctx }) => {
    const [userRows, vendorRows, eventRows] = await Promise.all([
      ctx.db
        .select({
          id: user.id,
          name: user.name,
          image: user.image,
          createdAt: user.createdAt,
        })
        .from(user)
        .where(NOT_ADMIN)
        .orderBy(desc(user.createdAt))
        .limit(10),
      ctx.db
        .select({
          id: user.id,
          name: user.name,
          businessName: user.businessName,
          image: user.image,
          createdAt: user.createdAt,
        })
        .from(user)
        .where(eq(user.role, 'vendor'))
        .orderBy(desc(user.createdAt))
        .limit(10),
      ctx.db
        .select({
          id: events.id,
          title: events.title,
          organizerName: user.name,
          organizerOrgName: user.orgName,
          organizerImage: user.image,
          createdAt: events.createdAt,
        })
        .from(events)
        .innerJoin(user, eq(events.organizerId, user.id))
        .where(NOT_DRAFT)
        .orderBy(desc(events.createdAt))
        .limit(10),
    ])

    type Item = {
      id: string
      kind: 'user-joined' | 'vendor-registered' | 'event-listed'
      message: string
      highlight?: string
      avatarUrl: string | null
      timestamp: string
    }

    const merged: Item[] = [
      ...userRows.map((u): Item => ({
        id: `u-${u.id}`,
        kind: 'user-joined',
        message: `${u.name} joined the platform`,
        avatarUrl: u.image ?? null,
        timestamp: u.createdAt.toISOString(),
      })),
      ...vendorRows.map((v): Item => ({
        id: `v-${v.id}`,
        kind: 'vendor-registered',
        message: `${v.businessName ?? v.name} registered as a Vendor`,
        highlight: 'Vendor',
        avatarUrl: v.image ?? null,
        timestamp: v.createdAt.toISOString(),
      })),
      ...eventRows.map((e): Item => ({
        id: `e-${e.id}`,
        kind: 'event-listed',
        message: `${e.organizerOrgName ?? e.organizerName} listed an event`,
        avatarUrl: e.organizerImage ?? null,
        timestamp: e.createdAt.toISOString(),
      })),
    ]

    merged.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    return merged.slice(0, 5)
  }),
})
