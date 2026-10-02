import { and, desc, eq, sql } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import type { Database } from '@ticketur/db'
import { events, vouchers } from '@ticketur/db'

import { createTRPCRouter, organizerProcedure } from '../../trpc'
import { newId } from '../../lib/ids'
import { sendVoucherCode, voucherSendInput } from '../../lib/voucher-send'

const discountTypeEnum = z.enum(['percent', 'fixed'])

// `discountValue` is expressed in the organizer's terms: whole percent (1–100)
// for percent vouchers, minor units for fixed. It's stored as basis points for
// percent (the same unit as the platform service-fee rates, lib/fees.ts) so
// the discount math stays integer-only.
const baseFields = {
  code: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[A-Za-z0-9_-]+$/, 'Use letters, numbers, - and _ only'),
  // null = applies to all of the organizer's events ("All events").
  eventId: z.string().nullable().default(null),
  discountType: discountTypeEnum,
  discountValue: z.number().int().positive(),
  maxRedemptions: z.number().int().positive().nullable().default(null),
  validFrom: z.date().nullable().default(null),
  validUntil: z.date().nullable().default(null),
}

function refineFields(
  v: {
    discountType: 'percent' | 'fixed'
    discountValue: number
    validFrom: Date | null
    validUntil: Date | null
  },
  ctx: z.RefinementCtx
) {
  if (v.discountType === 'percent' && v.discountValue > 100) {
    ctx.addIssue({
      code: 'custom',
      path: ['discountValue'],
      message: 'Percent discount must be between 1 and 100',
    })
  }
  if (v.validFrom && v.validUntil && v.validUntil < v.validFrom) {
    ctx.addIssue({
      code: 'custom',
      path: ['validUntil'],
      message: 'End date must be on or after the start date',
    })
  }
}

const createInput = z.object(baseFields).superRefine(refineFields)
const updateInput = z
  .object({ id: z.string(), ...baseFields })
  .superRefine(refineFields)

// percent → basis points; fixed → minor units as given.
function toStoredValue(type: 'percent' | 'fixed', value: number) {
  return type === 'percent' ? value * 100 : value
}

// Guard: the event, if scoped, must belong to the calling organizer.
async function assertEventOwned(
  db: Database,
  organizerId: string,
  eventId: string
) {
  const [ev] = await db
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.organizerId, organizerId)))
    .limit(1)
  if (!ev) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'That event does not belong to you.',
    })
  }
}

export const orgVouchersRouter = createTRPCRouter({
  // Events the organizer can scope a voucher to; the form adds an "All events"
  // option (eventId null) on top of these.
  eventOptions: organizerProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({ id: events.id, title: events.title })
      .from(events)
      .where(eq(events.organizerId, ctx.session.user.id))
      .orderBy(desc(events.createdAt))
  }),

  list: organizerProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({
        id: vouchers.id,
        code: vouchers.code,
        eventId: vouchers.eventId,
        // null → "All events"
        eventTitle: events.title,
        discountType: vouchers.discountType,
        discountValue: vouchers.discountValue,
        maxRedemptions: vouchers.maxRedemptions,
        redeemedCount: vouchers.redeemedCount,
        validFrom: vouchers.validFrom,
        validUntil: vouchers.validUntil,
        active: vouchers.active,
        createdAt: vouchers.createdAt,
      })
      .from(vouchers)
      .leftJoin(events, eq(events.id, vouchers.eventId))
      .where(eq(vouchers.organizerId, ctx.session.user.id))
      .orderBy(desc(vouchers.createdAt))
  }),

  create: organizerProcedure
    .input(createInput)
    .mutation(async ({ ctx, input }) => {
      const organizerId = ctx.session.user.id
      if (input.eventId) {
        await assertEventOwned(ctx.db, organizerId, input.eventId)
      }

      // Friendly duplicate check; the unique index is the race backstop.
      const [dup] = await ctx.db
        .select({ id: vouchers.id })
        .from(vouchers)
        .where(
          and(
            eq(vouchers.organizerId, organizerId),
            sql`lower(${vouchers.code}) = lower(${input.code})`
          )
        )
        .limit(1)
      if (dup) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `You already have a voucher with the code ${input.code}.`,
        })
      }

      const id = newId('vch')
      await ctx.db.insert(vouchers).values({
        id,
        organizerId,
        eventId: input.eventId ?? null,
        code: input.code,
        discountType: input.discountType,
        discountValue: toStoredValue(input.discountType, input.discountValue),
        maxRedemptions: input.maxRedemptions ?? null,
        validFrom: input.validFrom ?? null,
        validUntil: input.validUntil ?? null,
      })
      return { id }
    }),

  update: organizerProcedure
    .input(updateInput)
    .mutation(async ({ ctx, input }) => {
      const organizerId = ctx.session.user.id
      const [existing] = await ctx.db
        .select({ id: vouchers.id })
        .from(vouchers)
        .where(
          and(eq(vouchers.id, input.id), eq(vouchers.organizerId, organizerId))
        )
        .limit(1)
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND' })
      if (input.eventId) {
        await assertEventOwned(ctx.db, organizerId, input.eventId)
      }

      await ctx.db
        .update(vouchers)
        .set({
          code: input.code,
          eventId: input.eventId ?? null,
          discountType: input.discountType,
          discountValue: toStoredValue(input.discountType, input.discountValue),
          maxRedemptions: input.maxRedemptions ?? null,
          validFrom: input.validFrom ?? null,
          validUntil: input.validUntil ?? null,
          updatedAt: new Date(),
        })
        .where(eq(vouchers.id, input.id))
      return { id: input.id }
    }),

  // Email one of the organizer's own codes to a list of addresses, or to
  // everyone holding a ticket for one of their events.
  send: organizerProcedure
    .input(voucherSendInput)
    .mutation(async ({ ctx, input }) => {
      return sendVoucherCode(ctx.db, {
        input,
        ownerId: ctx.session.user.id,
      })
    }),

  setActive: organizerProcedure
    .input(z.object({ id: z.string(), active: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db
        .update(vouchers)
        .set({ active: input.active, updatedAt: new Date() })
        .where(
          and(
            eq(vouchers.id, input.id),
            eq(vouchers.organizerId, ctx.session.user.id)
          )
        )
        .returning({ id: vouchers.id })
      if (result.length === 0) throw new TRPCError({ code: 'NOT_FOUND' })
      return { ok: true as const }
    }),
})

export type OrgVouchersRouter = typeof orgVouchersRouter
