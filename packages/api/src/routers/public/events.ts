import { and, asc, desc, eq, ilike, inArray, ne, sql } from 'drizzle-orm'
import { z } from 'zod'

import { events, eventVendors, ticketTiers, user } from '@ticketur/db'

import { createTRPCRouter, publicProcedure } from '../../trpc'
import {
  alreadyEnded,
  hasEnded,
  notCurrentlyBanned,
  stillRunning,
} from '../../lib/predicates'

const listInput = z.object({
  q: z.string().default(''),
  category: z.string().default('all'),
  // 'upcoming' — still running (or TBD); 'past' — already finished. Past is a
  // showcase of what the platform has actually hosted, so it is ordered
  // most-recent-first and carries an attendee count instead of a price.
  tab: z.enum(['upcoming', 'past']).default('upcoming'),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(50).default(12),
})

export const publicEventsRouter = createTRPCRouter({
  list: publicProcedure.input(listInput).query(async ({ ctx, input }) => {
    const today = new Date().toISOString().slice(0, 10)

    const isPast = input.tab === 'past'
    // A concluded event keeps status 'upcoming' — it is the date that makes it
    // past, so nothing has to sweep the table to retire events.
    //
    // The past tab also surfaces 'archived' events: archiving is the organizer
    // clearing their own active list, not a request to erase an event that
    // already happened publicly. 'suspended' is deliberately NOT included —
    // that is an admin moderation state and must stay hidden everywhere.
    const filters = [
      isPast
        ? inArray(events.status, ['upcoming', 'archived'])
        : eq(events.status, 'upcoming'),
      isPast ? alreadyEnded(today) : stillRunning(today),
    ]
    if (input.q.trim().length > 0) {
      filters.push(ilike(events.title, `%${input.q.trim()}%`))
    }
    // Note: events table has no category column yet; reserved for future use.
    void input.category

    const minPriceExpr =
      sql<number>`COALESCE(MIN(${ticketTiers.priceMinor}), 0)::int`.as(
        'minPrice'
      )
    // Tickets sold across the event's tiers — the "we hosted this and people
    // came" number shown on past events.
    const attendeeCountExpr =
      sql<number>`COALESCE(SUM(${ticketTiers.sold}), 0)::int`.as(
        'attendeeCount'
      )

    const rows = await ctx.db
      .select({
        id: events.id,
        slug: events.slug,
        title: events.title,
        eventDate: events.eventDate,
        endDate: events.endDate,
        eventTime: events.eventTime,
        location: events.location,
        bannerUrl: events.bannerUrl,
        minPrice: minPriceExpr,
        attendeeCount: attendeeCountExpr,
      })
      .from(events)
      .innerJoin(user, eq(user.id, events.organizerId))
      .leftJoin(ticketTiers, eq(ticketTiers.eventId, events.id))
      .where(and(...filters, notCurrentlyBanned))
      .groupBy(events.id)
      // Upcoming: soonest first. Past: most recently finished first — ordered
      // by the same date that decides whether it is past at all, so a multi-day
      // event does not sort by a start date it outlived.
      .orderBy(
        isPast
          ? desc(sql`COALESCE(${events.endDate}, ${events.eventDate})`)
          : asc(events.eventDate)
      )
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize)

    const totalCountRows = await ctx.db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(events)
      .innerJoin(user, eq(user.id, events.organizerId))
      .where(and(...filters, notCurrentlyBanned))

    return {
      rows,
      total: totalCountRows[0]?.count ?? 0,
      page: input.page,
      pageSize: input.pageSize,
    }
  }),

  featured: publicProcedure.query(async ({ ctx }) => {
    const today = new Date().toISOString().slice(0, 10)

    const minPriceExpr =
      sql<number>`COALESCE(MIN(${ticketTiers.priceMinor}), 0)::int`.as(
        'minPrice'
      )

    const rows = await ctx.db
      .select({
        id: events.id,
        slug: events.slug,
        title: events.title,
        eventDate: events.eventDate,
        endDate: events.endDate,
        eventTime: events.eventTime,
        location: events.location,
        bannerUrl: events.bannerUrl,
        minPrice: minPriceExpr,
      })
      .from(events)
      .innerJoin(user, eq(user.id, events.organizerId))
      .leftJoin(ticketTiers, eq(ticketTiers.eventId, events.id))
      .where(
        and(
          eq(events.status, 'upcoming'),
          stillRunning(today),
          notCurrentlyBanned
        )
      )
      .groupBy(events.id)
      .orderBy(desc(events.createdAt))
      .limit(3)

    return rows
  }),

  // Other upcoming events to surface on the detail page. Excludes the
  // current event; future iteration could match on category / location.
  similar: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const today = new Date().toISOString().slice(0, 10)
      const minPriceExpr =
        sql<number>`COALESCE(MIN(${ticketTiers.priceMinor}), 0)::int`.as(
          'minPrice'
        )

      const rows = await ctx.db
        .select({
          id: events.id,
          slug: events.slug,
          title: events.title,
          eventDate: events.eventDate,
          endDate: events.endDate,
          location: events.location,
          bannerUrl: events.bannerUrl,
          minPrice: minPriceExpr,
        })
        .from(events)
        .innerJoin(user, eq(user.id, events.organizerId))
        .leftJoin(ticketTiers, eq(ticketTiers.eventId, events.id))
        .where(
          and(
            ne(events.id, input.id),
            eq(events.status, 'upcoming'),
            stillRunning(today),
            notCurrentlyBanned
          )
        )
        .groupBy(events.id)
        .orderBy(asc(events.eventDate))
        .limit(3)

      return rows
    }),

  bySlug: publicProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ ctx, input }) => {
      const found = await ctx.db
        .select({ event: events })
        .from(events)
        .innerJoin(user, eq(user.id, events.organizerId))
        .where(
          and(
            eq(events.slug, input.slug),
            // 'archived' is allowed through so a past event listed in the
            // past tab still resolves; the date check below drops an archived
            // event that hasn't happened yet (the organizer withdrew it).
            // 'suspended' never resolves — admin moderation.
            inArray(events.status, ['upcoming', 'archived']),
            notCurrentlyBanned
          )
        )
        .limit(1)
      const event = found[0]?.event
      if (!event) return null

      const tiers = await ctx.db
        .select()
        .from(ticketTiers)
        .where(eq(ticketTiers.eventId, event.id))
        .orderBy(asc(ticketTiers.priceMinor), asc(ticketTiers.sortOrder))

      const vendors = await ctx.db
        .select({
          id: eventVendors.id,
          status: eventVendors.status,
          vendorId: user.id,
          businessName: user.businessName,
          businessCategory: user.businessCategory,
          businessDescription: user.businessDescription,
          tagline: user.vendorTagline,
          image: user.image,
        })
        .from(eventVendors)
        .innerJoin(user, eq(user.id, eventVendors.vendorId))
        .where(and(eq(eventVendors.eventId, event.id), notCurrentlyBanned))

      const minPrice = tiers.reduce(
        (min, t) => (min === null || t.priceMinor < min ? t.priceMinor : min),
        null as number | null
      )

      // A finished event stays reachable (its page is the public record of it)
      // but must not sell tickets. checkout.start rejects it server-side too;
      // this flag is what lets the UI say so instead of failing on submit.
      // A TBD event (null date) is never treated as ended.
      const ended = hasEnded(event)

      // An archived event is public only as a record of something that already
      // happened. Archived and still upcoming means the organizer pulled it.
      if (event.status === 'archived' && !ended) return null

      return {
        event,
        tiers,
        vendors,
        minPriceMinor: minPrice ?? 0,
        hasEnded: ended,
      }
    }),
})

export type PublicEventsRouter = typeof publicEventsRouter
