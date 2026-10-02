import { and, desc, eq, gte, lt, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { z } from 'zod'

import {
  events,
  eventVendors,
  user,
  vendorProfileViews,
  vendorReviews,
} from '@ticketur/db'

import { createTRPCRouter, vendorProcedure } from '../../trpc'
import { alreadyEnded, stillRunning } from '../../lib/predicates'

// ─── Reporting window ────────────────────────────────────────────────────────

const PERIOD_DAYS = { '7d': 7, '30d': 30, '90d': 90 } as const
type Period = keyof typeof PERIOD_DAYS
const DAY_MS = 86_400_000

const rangeInput = z.object({
  period: z.enum(['7d', '30d', '90d']).default('7d'),
  // Optional custom end anchor (YYYY-MM-DD); the window is the N days ending
  // on that date. Null/absent means the window ends now.
  date: z.string().nullable().optional(),
})

// Resolves a selection into the current window [start, end) and the equal-
// length previous window [prevStart, prevEnd) used for period-over-period
// deltas.
function resolveWindow(period: Period, date?: string | null) {
  const days = PERIOD_DAYS[period]
  const parsed = date ? new Date(`${date}T23:59:59`) : null
  const endMs =
    parsed && !Number.isNaN(parsed.getTime()) ? parsed.getTime() : Date.now()
  return {
    days,
    start: new Date(endMs - days * DAY_MS),
    end: new Date(endMs),
    prevStart: new Date(endMs - 2 * days * DAY_MS),
    prevEnd: new Date(endMs - days * DAY_MS),
  }
}

function deltaPct(curr: number, prev: number) {
  if (prev === 0) return curr === 0 ? 0 : 100
  return Math.round(((curr - prev) / prev) * 100)
}

function isoDay(ms: number) {
  return new Date(ms).toISOString().slice(0, 10)
}

// Ordered day buckets spanning the window, labelled by weekday for a week or
// by month/day for longer ranges (matches the Business Activity chart).
function dayBuckets(start: Date, days: number) {
  const startDayMs = Date.UTC(
    start.getUTCFullYear(),
    start.getUTCMonth(),
    start.getUTCDate()
  )
  return Array.from({ length: days }, (_, i) => {
    const ms = startDayMs + i * DAY_MS
    const d = new Date(ms)
    return {
      key: isoDay(ms),
      label:
        days <= 7
          ? d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
          : d.toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              timeZone: 'UTC',
            }),
    }
  })
}

// The last `count` calendar months, oldest first (for Booking Trends).
function monthBuckets(count: number) {
  const now = new Date()
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (count - 1 - i), 1))
    return {
      key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }),
      startMs: d.getTime(),
    }
  })
}

const RATING_VALUES = [1, 2, 3, 4, 5] as const

export const vendorAnalyticsRouter = createTRPCRouter({
  // Overall tab: KPI cards (+ deltas), the Business Activity chart, and the
  // Recent Activity feed.
  overview: vendorProcedure.input(rangeInput).query(async ({ ctx, input }) => {
    const vendorId = ctx.session.user.id
    const w = resolveWindow(input.period, input.date)
    const today = new Date().toISOString().slice(0, 10)

    const [
      viewAgg,
      evAgg,
      ratingAgg,
      viewsByDay,
      evByDay,
      recentInvites,
      recentReviews,
      recentCompleted,
    ] = await Promise.all([
      ctx.db
        .select({
          curr: sql<number>`count(*) filter (where ${vendorProfileViews.createdAt} >= ${w.start} and ${vendorProfileViews.createdAt} < ${w.end})::int`,
          prev: sql<number>`count(*) filter (where ${vendorProfileViews.createdAt} >= ${w.prevStart} and ${vendorProfileViews.createdAt} < ${w.prevEnd})::int`,
        })
        .from(vendorProfileViews)
        .where(
          and(
            eq(vendorProfileViews.vendorId, vendorId),
            gte(vendorProfileViews.createdAt, w.prevStart)
          )
        ),

      ctx.db
        .select({
          invCurr: sql<number>`count(*) filter (where ${eventVendors.createdAt} >= ${w.start} and ${eventVendors.createdAt} < ${w.end})::int`,
          invPrev: sql<number>`count(*) filter (where ${eventVendors.createdAt} >= ${w.prevStart} and ${eventVendors.createdAt} < ${w.prevEnd})::int`,
          confCurr: sql<number>`count(*) filter (where ${eventVendors.status} = 'accepted' and ${eventVendors.createdAt} >= ${w.start} and ${eventVendors.createdAt} < ${w.end})::int`,
          confPrev: sql<number>`count(*) filter (where ${eventVendors.status} = 'accepted' and ${eventVendors.createdAt} >= ${w.prevStart} and ${eventVendors.createdAt} < ${w.prevEnd})::int`,
        })
        .from(eventVendors)
        .where(
          and(
            eq(eventVendors.vendorId, vendorId),
            gte(eventVendors.createdAt, w.prevStart)
          )
        ),

      ctx.db
        .select({
          avgAll: sql<number>`coalesce(round(avg(${vendorReviews.rating})::numeric, 1), 0)::float`,
          avgCurr: sql<number>`coalesce(avg(${vendorReviews.rating}) filter (where ${vendorReviews.createdAt} >= ${w.start} and ${vendorReviews.createdAt} < ${w.end}), 0)::float`,
          avgPrev: sql<number>`coalesce(avg(${vendorReviews.rating}) filter (where ${vendorReviews.createdAt} >= ${w.prevStart} and ${vendorReviews.createdAt} < ${w.prevEnd}), 0)::float`,
        })
        .from(vendorReviews)
        .where(eq(vendorReviews.vendorId, vendorId)),

      ctx.db
        .select({
          day: sql<string>`to_char(date_trunc('day', ${vendorProfileViews.createdAt}), 'YYYY-MM-DD')`,
          count: sql<number>`count(*)::int`,
        })
        .from(vendorProfileViews)
        .where(
          and(
            eq(vendorProfileViews.vendorId, vendorId),
            gte(vendorProfileViews.createdAt, w.start),
            lt(vendorProfileViews.createdAt, w.end)
          )
        )
        .groupBy(sql`date_trunc('day', ${vendorProfileViews.createdAt})`),

      ctx.db
        .select({
          day: sql<string>`to_char(date_trunc('day', ${eventVendors.createdAt}), 'YYYY-MM-DD')`,
          invitations: sql<number>`count(*)::int`,
          bookings: sql<number>`count(*) filter (where ${eventVendors.status} = 'accepted')::int`,
        })
        .from(eventVendors)
        .where(
          and(
            eq(eventVendors.vendorId, vendorId),
            gte(eventVendors.createdAt, w.start),
            lt(eventVendors.createdAt, w.end)
          )
        )
        .groupBy(sql`date_trunc('day', ${eventVendors.createdAt})`),

      ctx.db
        .select({ title: events.title, at: eventVendors.createdAt })
        .from(eventVendors)
        .innerJoin(events, eq(events.id, eventVendors.eventId))
        .where(eq(eventVendors.vendorId, vendorId))
        .orderBy(desc(eventVendors.createdAt))
        .limit(5),

      ctx.db
        .select({
          rating: vendorReviews.rating,
          name: sql<string>`coalesce(${user.name}, ${vendorReviews.guestName}, 'Someone')`,
          at: vendorReviews.createdAt,
        })
        .from(vendorReviews)
        .leftJoin(user, eq(user.id, vendorReviews.reviewerId))
        .where(eq(vendorReviews.vendorId, vendorId))
        .orderBy(desc(vendorReviews.createdAt))
        .limit(5),

      ctx.db
        .select({ title: events.title, at: events.eventDate })
        .from(eventVendors)
        .innerJoin(events, eq(events.id, eventVendors.eventId))
        .where(
          and(
            eq(eventVendors.vendorId, vendorId),
            eq(eventVendors.status, 'accepted'),
            alreadyEnded(today)
          )
        )
        .orderBy(desc(events.eventDate))
        .limit(5),
    ])

    const views = viewAgg[0] ?? { curr: 0, prev: 0 }
    const ev = evAgg[0] ?? { invCurr: 0, invPrev: 0, confCurr: 0, confPrev: 0 }
    const rating = ratingAgg[0] ?? { avgAll: 0, avgCurr: 0, avgPrev: 0 }

    const viewMap = new Map(viewsByDay.map((r) => [r.day, r.count]))
    const evMap = new Map(evByDay.map((r) => [r.day, r]))
    const activity = dayBuckets(w.start, w.days).map((b) => ({
      key: b.key,
      label: b.label,
      profileViews: viewMap.get(b.key) ?? 0,
      invitations: evMap.get(b.key)?.invitations ?? 0,
      bookings: evMap.get(b.key)?.bookings ?? 0,
    }))

    const recentActivity = [
      ...recentInvites.map((r) => ({
        type: 'invitation' as const,
        message: `Received an invitation for ${r.title}.`,
        at: r.at,
      })),
      ...recentReviews.map((r) => ({
        type: 'review' as const,
        message: `New ${r.rating}-star review from ${r.name}.`,
        at: r.at,
      })),
      ...recentCompleted
        .filter((r) => r.at)
        .map((r) => ({
          type: 'completed' as const,
          message: `Completed ${r.title}.`,
          at: new Date(`${r.at}T00:00:00`),
        })),
    ]
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, 6)

    return {
      kpis: {
        profileViews: {
          value: views.curr,
          delta: deltaPct(views.curr, views.prev),
        },
        invitations: {
          value: ev.invCurr,
          delta: deltaPct(ev.invCurr, ev.invPrev),
        },
        confirmedBookings: {
          value: ev.confCurr,
          delta: deltaPct(ev.confCurr, ev.confPrev),
        },
        averageRating: {
          value: rating.avgAll,
          // Compare windowed averages (scaled to whole numbers) so the delta is
          // a meaningful percentage rather than a raw rating difference.
          delta: deltaPct(
            Math.round(rating.avgCurr * 10),
            Math.round(rating.avgPrev * 10)
          ),
        },
      },
      activity,
      recentActivity,
    }
  }),

  // Booking Insights tab: the trend line + the conversion funnel.
  bookings: vendorProcedure.input(rangeInput).query(async ({ ctx, input }) => {
    const vendorId = ctx.session.user.id
    const w = resolveWindow(input.period, input.date)
    const today = new Date().toISOString().slice(0, 10)
    const months = monthBuckets(6)
    const trendStart = new Date(months[0]!.startMs)

    const [pvRows, funnelRows, trendRows, viewTrendRows] = await Promise.all([
      ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(vendorProfileViews)
        .where(
          and(
            eq(vendorProfileViews.vendorId, vendorId),
            gte(vendorProfileViews.createdAt, w.start),
            lt(vendorProfileViews.createdAt, w.end)
          )
        ),

      ctx.db
        .select({
          invitations: sql<number>`count(*) filter (where ${eventVendors.createdAt} >= ${w.start} and ${eventVendors.createdAt} < ${w.end})::int`,
          confirmed: sql<number>`count(*) filter (where ${eventVendors.status} = 'accepted' and ${eventVendors.createdAt} >= ${w.start} and ${eventVendors.createdAt} < ${w.end})::int`,
          completed: sql<number>`count(*) filter (where ${eventVendors.status} = 'accepted' and ${eventVendors.createdAt} >= ${w.start} and ${eventVendors.createdAt} < ${w.end} and ${alreadyEnded(today)})::int`,
        })
        .from(eventVendors)
        .innerJoin(events, eq(events.id, eventVendors.eventId))
        .where(eq(eventVendors.vendorId, vendorId)),

      ctx.db
        .select({
          month: sql<string>`to_char(date_trunc('month', ${eventVendors.createdAt}), 'YYYY-MM')`,
          value: sql<number>`count(*)::int`,
        })
        .from(eventVendors)
        .where(
          and(
            eq(eventVendors.vendorId, vendorId),
            gte(eventVendors.createdAt, trendStart)
          )
        )
        .groupBy(sql`date_trunc('month', ${eventVendors.createdAt})`),

      ctx.db
        .select({
          month: sql<string>`to_char(date_trunc('month', ${vendorProfileViews.createdAt}), 'YYYY-MM')`,
          value: sql<number>`count(*)::int`,
        })
        .from(vendorProfileViews)
        .where(
          and(
            eq(vendorProfileViews.vendorId, vendorId),
            gte(vendorProfileViews.createdAt, trendStart)
          )
        )
        .groupBy(sql`date_trunc('month', ${vendorProfileViews.createdAt})`),
    ])

    const trendMap = new Map(trendRows.map((r) => [r.month, r.value]))
    const trends = months.map((m) => ({
      label: m.label,
      value: trendMap.get(m.key) ?? 0,
    }))
    const viewTrendMap = new Map(viewTrendRows.map((r) => [r.month, r.value]))
    const viewTrends = months.map((m) => ({
      label: m.label,
      value: viewTrendMap.get(m.key) ?? 0,
    }))

    const f = funnelRows[0] ?? { invitations: 0, confirmed: 0, completed: 0 }
    return {
      trends,
      viewTrends,
      funnel: {
        profileViews: pvRows[0]?.count ?? 0,
        invitations: f.invitations,
        confirmed: f.confirmed,
        completed: f.completed,
      },
    }
  }),

  // Booking Insights tab: the Recent Bookings table (its own procedure so the
  // status filter + pagination don't refetch the charts). Not windowed by the
  // period — it lists the vendor's bookings regardless of range.
  recentBookings: vendorProcedure
    .input(
      z.object({
        status: z
          .enum(['all', 'upcoming', 'completed', 'cancelled'])
          .default('all'),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(50).default(6),
      })
    )
    .query(async ({ ctx, input }) => {
      const vendorId = ctx.session.user.id
      const today = new Date().toISOString().slice(0, 10)
      const ended = alreadyEnded(today)

      // Derived, display-facing status collapsed to the three the table shows.
      const statusExpr = sql<string>`case
        when ${eventVendors.status} = 'declined' then 'cancelled'
        when ${ended} then 'completed'
        else 'upcoming' end`

      let statusCond: SQL | undefined
      if (input.status === 'cancelled') {
        statusCond = eq(eventVendors.status, 'declined')
      } else if (input.status === 'completed') {
        statusCond = sql`${eventVendors.status} <> 'declined' and ${ended}`
      } else if (input.status === 'upcoming') {
        statusCond = sql`${eventVendors.status} <> 'declined' and ${stillRunning(today)}`
      }

      const base = eq(eventVendors.vendorId, vendorId)
      const where = statusCond ? and(base, statusCond) : base

      const organizer = alias(user, 'organizer')
      const [rows, totalRows] = await Promise.all([
        ctx.db
          .select({
            id: eventVendors.id,
            eventId: events.id,
            eventTitle: events.title,
            bannerUrl: events.bannerUrl,
            organizer: sql<string>`coalesce(${organizer.businessName}, ${organizer.name}, 'Organizer')`,
            eventDate: events.eventDate,
            bookingDate: eventVendors.createdAt,
            status: statusExpr,
          })
          .from(eventVendors)
          .innerJoin(events, eq(events.id, eventVendors.eventId))
          .leftJoin(organizer, eq(organizer.id, events.organizerId))
          .where(where)
          .orderBy(desc(eventVendors.createdAt))
          .limit(input.pageSize)
          .offset((input.page - 1) * input.pageSize),

        ctx.db
          .select({ count: sql<number>`count(*)::int` })
          .from(eventVendors)
          .innerJoin(events, eq(events.id, eventVendors.eventId))
          .where(where),
      ])

      return {
        rows,
        total: totalRows[0]?.count ?? 0,
        page: input.page,
        pageSize: input.pageSize,
      }
    }),

  // Ratings & Reviews tab: the summary card + a page of reviews.
  ratings: vendorProcedure
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(50).default(6),
      })
    )
    .query(async ({ ctx, input }) => {
      const vendorId = ctx.session.user.id

      const [distRows, reviewRows, totalRows] = await Promise.all([
        ctx.db
          .select({
            rating: vendorReviews.rating,
            count: sql<number>`count(*)::int`,
          })
          .from(vendorReviews)
          .where(eq(vendorReviews.vendorId, vendorId))
          .groupBy(vendorReviews.rating),

        ctx.db
          .select({
            id: vendorReviews.id,
            rating: vendorReviews.rating,
            comment: vendorReviews.comment,
            createdAt: vendorReviews.createdAt,
            reviewerName: sql<string>`coalesce(${user.name}, ${vendorReviews.guestName}, 'Guest')`,
            reviewerRole: sql<string>`coalesce(${user.role}, 'guest')`,
          })
          .from(vendorReviews)
          .leftJoin(user, eq(user.id, vendorReviews.reviewerId))
          .where(eq(vendorReviews.vendorId, vendorId))
          .orderBy(desc(vendorReviews.createdAt))
          .limit(input.pageSize)
          .offset((input.page - 1) * input.pageSize),

        ctx.db
          .select({ count: sql<number>`count(*)::int` })
          .from(vendorReviews)
          .where(eq(vendorReviews.vendorId, vendorId)),
      ])

      const distribution = Object.fromEntries(
        RATING_VALUES.map((v) => [
          v,
          distRows.find((r) => r.rating === v)?.count ?? 0,
        ])
      ) as Record<(typeof RATING_VALUES)[number], number>

      const total = distRows.reduce((sum, r) => sum + r.count, 0)
      const average =
        total === 0
          ? 0
          : RATING_VALUES.reduce((sum, v) => sum + v * distribution[v], 0) /
            total

      return {
        summary: { average, total, distribution },
        reviews: {
          rows: reviewRows,
          total: totalRows[0]?.count ?? 0,
          page: input.page,
          pageSize: input.pageSize,
        },
      }
    }),
})

export type VendorAnalyticsRouter = typeof vendorAnalyticsRouter
