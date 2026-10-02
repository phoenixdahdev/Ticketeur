// Admin read + resolve for money the platform is holding that it may owe
// back to a customer. Read-only over what fulfilment recorded, plus one
// mutation: an admin saying "I refunded this in Flutterwave".
//
// Nothing here ever refunds anything. Flutterwave refunds are issued by hand
// in their dashboard; `resolve` only records that a person did it.

import { z } from 'zod'
import { and, count, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'

import {
  events,
  orders,
  paymentDiscrepancies,
  user,
  type PaymentDiscrepancyKind,
} from '@ticketur/db'

import { adminProcedure, createTRPCRouter } from '../../trpc'
import { DISCREPANCY_OPEN } from '../../lib/predicates'

const KINDS = [
  'overpayment',
  'rejected_charge',
  'duplicate_charge',
  'undelivered',
] as const satisfies readonly PaymentDiscrepancyKind[]

const STATUSES = ['open', 'resolved'] as const

const listSchema = z.object({
  kind: z.enum(['all', ...KINDS]).default('all'),
  status: z.enum(['all', ...STATUSES]).default('open'),
  q: z.string().default(''),
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().max(100).default(10),
})

// Only NGN rows can be summed into one naira figure. A charge in another
// currency (a 'currency_mismatch' rejection) or one whose amount Flutterwave
// did not give us a readable number for is counted separately so the total
// never silently understates what is owed.
const OWED_IN_NAIRA = and(
  eq(paymentDiscrepancies.paidCurrency, 'NGN'),
  sql`${paymentDiscrepancies.owedMinor} IS NOT NULL`
)

export const adminPaymentDiscrepanciesRouter = createTRPCRouter({
  // Headline figures: how many are waiting, and how much naira they add up
  // to. Used by the page's cards and by the sidebar badge.
  stats: adminProcedure.query(async ({ ctx }) => {
    const [openRow] = await ctx.db
      .select({
        open: count(paymentDiscrepancies.id),
        owedMinor: sql<number>`coalesce(sum(case when ${OWED_IN_NAIRA} then ${paymentDiscrepancies.owedMinor} else 0 end), 0)`,
        unknownAmount: sql<number>`coalesce(sum(case when ${OWED_IN_NAIRA} then 0 else 1 end), 0)`,
      })
      .from(paymentDiscrepancies)
      .where(DISCREPANCY_OPEN)

    const kindRows = await ctx.db
      .select({
        kind: paymentDiscrepancies.kind,
        value: count(paymentDiscrepancies.id),
      })
      .from(paymentDiscrepancies)
      .where(DISCREPANCY_OPEN)
      .groupBy(paymentDiscrepancies.kind)

    const byKind = Object.fromEntries(
      KINDS.map((k) => [k, 0])
    ) as Record<PaymentDiscrepancyKind, number>
    for (const r of kindRows) {
      if (r.kind in byKind) byKind[r.kind] = Number(r.value)
    }

    return {
      open: Number(openRow?.open ?? 0),
      // Kobo. Open rows only, NGN only.
      openOwedMinor: Number(openRow?.owedMinor ?? 0),
      // Open rows the naira total above could NOT include.
      openUnknownAmount: Number(openRow?.unknownAmount ?? 0),
      byKind,
    }
  }),

  list: adminProcedure.input(listSchema).query(async ({ ctx, input }) => {
    const { kind, status, q, page, pageSize } = input

    const filters = []
    if (kind !== 'all') filters.push(eq(paymentDiscrepancies.kind, kind))
    if (status !== 'all') filters.push(eq(paymentDiscrepancies.status, status))
    if (q.trim().length > 0) {
      const needle = `%${q.trim()}%`
      filters.push(
        or(
          ilike(paymentDiscrepancies.buyerName, needle),
          ilike(paymentDiscrepancies.buyerEmail, needle),
          ilike(paymentDiscrepancies.flwTxRef, needle),
          ilike(paymentDiscrepancies.flwTransactionId, needle),
          ilike(paymentDiscrepancies.orderId, needle)
        )!
      )
    }
    const where = filters.length > 0 ? and(...filters) : undefined

    const [rows, totalRow] = await Promise.all([
      ctx.db
        .select({
          id: paymentDiscrepancies.id,
          kind: paymentDiscrepancies.kind,
          status: paymentDiscrepancies.status,
          orderId: paymentDiscrepancies.orderId,
          buyerName: paymentDiscrepancies.buyerName,
          buyerEmail: paymentDiscrepancies.buyerEmail,
          flwTransactionId: paymentDiscrepancies.flwTransactionId,
          expectedMinor: paymentDiscrepancies.expectedMinor,
          paidMinor: paymentDiscrepancies.paidMinor,
          paidCurrency: paymentDiscrepancies.paidCurrency,
          owedMinor: paymentDiscrepancies.owedMinor,
          detectedAt: paymentDiscrepancies.detectedAt,
          eventTitle: events.title,
        })
        .from(paymentDiscrepancies)
        // Left join: the record outlives the event (soft pointer), so a
        // deleted event must not make the money disappear from this list.
        .leftJoin(events, eq(events.id, paymentDiscrepancies.eventId))
        .where(where)
        .orderBy(desc(paymentDiscrepancies.detectedAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      ctx.db
        .select({ value: count(paymentDiscrepancies.id) })
        .from(paymentDiscrepancies)
        .where(where),
    ])

    return {
      rows: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        status: r.status,
        orderId: r.orderId,
        customerName: r.buyerName || 'Guest',
        customerEmail: r.buyerEmail,
        eventName: r.eventTitle ?? null,
        flwTransactionId: r.flwTransactionId,
        expectedMinor: r.expectedMinor,
        paidMinor: r.paidMinor,
        paidCurrency: r.paidCurrency,
        owedMinor: r.owedMinor,
        detectedAt: r.detectedAt.toISOString(),
      })),
      total: Number(totalRow[0]?.value ?? 0),
    }
  }),

  byId: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({
          d: paymentDiscrepancies,
          orderStatus: orders.status,
          orderTotalMinor: orders.totalMinor,
          orderCreatedAt: orders.createdAt,
          orderPaidAt: orders.paidAt,
          orderFlwTransactionId: orders.flwTransactionId,
          eventTitle: events.title,
          resolverName: user.name,
          resolverEmail: user.email,
        })
        .from(paymentDiscrepancies)
        // All left joins: this record is deliberately not tied to the rows it
        // points at (see the schema), and it has to read correctly with any
        // of them gone.
        .leftJoin(orders, eq(orders.id, paymentDiscrepancies.orderId))
        .leftJoin(events, eq(events.id, paymentDiscrepancies.eventId))
        .leftJoin(user, eq(user.id, paymentDiscrepancies.resolvedBy))
        .where(eq(paymentDiscrepancies.id, input.id))
        .limit(1)

      if (!row) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Discrepancy not found',
        })
      }

      const d = row.d
      return {
        id: d.id,
        kind: d.kind,
        status: d.status,
        reason: d.reason,
        detail: d.detail,
        detectedAt: d.detectedAt.toISOString(),

        customer: {
          name: d.buyerName || 'Guest',
          email: d.buyerEmail,
        },

        // What an admin types into Flutterwave.
        gateway: {
          transactionId: d.flwTransactionId,
          txRef: d.flwTxRef,
          // The id the order currently carries. Differs from
          // transactionId when a later charge replaced it — which is exactly
          // why this record keeps its own copy.
          orderTransactionId: row.orderFlwTransactionId ?? null,
        },

        money: {
          // Kobo. What checkout asked Flutterwave to charge.
          expectedMinor: d.expectedMinor,
          // Minor units of paidCurrency. Null when Flutterwave's amount was
          // not a readable number.
          paidMinor: d.paidMinor,
          paidCurrency: d.paidCurrency,
          owedMinor: d.owedMinor,
          // Kobo. The order's own total, which can differ from
          // expectedMinor by up to 50 kobo: Flutterwave is charged whole
          // naira. Null when the order is gone.
          orderTotalMinor: row.orderTotalMinor ?? null,
        },

        order: {
          id: d.orderId,
          type: d.orderType,
          // Null when the order row no longer exists.
          status: row.orderStatus ?? null,
          createdAt: row.orderCreatedAt?.toISOString() ?? null,
          paidAt: row.orderPaidAt?.toISOString() ?? null,
          eventId: d.eventId,
          eventName: row.eventTitle ?? null,
        },

        resolution:
          d.status === 'resolved'
            ? {
                at: d.resolvedAt?.toISOString() ?? null,
                byName: row.resolverName ?? null,
                byEmail: row.resolverEmail ?? null,
                note: d.resolutionNote,
              }
            : null,
      }
    }),

  /**
   * Record that a human refunded this charge in Flutterwave.
   *
   * Explicit and manual by design: nothing in this codebase infers a
   * resolution, and nothing here calls Flutterwave. The note is required —
   * the next admin to read the row needs to know what was actually done, and
   * the Flutterwave refund reference belongs in it.
   *
   * Conditional on `status = 'open'`, so two admins clicking at once produce
   * one resolution and the second is told it was already handled, instead of
   * quietly overwriting who did it.
   */
  resolve: adminProcedure
    .input(
      z.object({
        id: z.string().min(1),
        note: z.string().trim().min(1).max(1000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const updated = await ctx.db
        .update(paymentDiscrepancies)
        .set({
          status: 'resolved',
          resolvedAt: new Date(),
          resolvedBy: ctx.session.user.id,
          resolutionNote: input.note,
        })
        .where(
          and(eq(paymentDiscrepancies.id, input.id), DISCREPANCY_OPEN)
        )
        .returning({ id: paymentDiscrepancies.id })

      if (updated.length === 0) {
        const [exists] = await ctx.db
          .select({ status: paymentDiscrepancies.status })
          .from(paymentDiscrepancies)
          .where(eq(paymentDiscrepancies.id, input.id))
          .limit(1)
        throw new TRPCError({
          code: exists ? 'CONFLICT' : 'NOT_FOUND',
          message: exists
            ? 'This was already marked resolved by someone else.'
            : 'Discrepancy not found',
        })
      }

      return { ok: true as const }
    }),
})
