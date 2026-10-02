import {
  pgTable,
  text,
  integer,
  timestamp,
  boolean,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'

import { user } from './auth'
import { events } from './events'

// ─── Vouchers (organizer-created discount codes) ────────────────────────────

// A voucher discounts checkout, and has two possible owners:
//
//   organizerId set  — the organizer's own code, valid only on their events.
//   organizerId NULL — a platform code created by an admin, valid on any
//                      event (or on one specific event via `eventId`).
//
// `eventId` is nullable independently: NULL means "every event this voucher's
// owner can discount"; a set eventId narrows it to that one event.
//
// Uniqueness is per owner and case-insensitive. Two indexes are needed because
// Postgres treats every NULL as distinct, so a single index on
// (organizerId, lower(code)) would not stop two platform codes sharing a name:
// one index covers organizer-owned rows, a partial index covers platform rows.
export type VoucherDiscountType = 'percent' | 'fixed'

export const vouchers = pgTable(
  'vouchers',
  {
    id: text('id').primaryKey(),
    // NULL = platform voucher, owned by the admin team rather than an organizer.
    organizerId: text('organizer_id').references(() => user.id, {
      onDelete: 'cascade',
      onUpdate: 'cascade',
    }),
    // NULL = applies to all of this organizer's events.
    eventId: text('event_id').references(() => events.id, {
      onDelete: 'cascade',
      onUpdate: 'cascade',
    }),
    code: text('code').notNull(),
    discountType: text('discount_type').$type<VoucherDiscountType>().notNull(),
    // percent → basis points (2000 = 20%), the same convention the platform
    // service-fee rates use (platform_settings). fixed → minor units (kobo).
    discountValue: integer('discount_value').notNull(),
    // NULL = unlimited redemptions.
    maxRedemptions: integer('max_redemptions'),
    redeemedCount: integer('redeemed_count').notNull().default(0),
    validFrom: timestamp('valid_from'),
    validUntil: timestamp('valid_until'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('vouchers_organizer_code_unique').on(
      t.organizerId,
      sql`lower(${t.code})`
    ),
    // Platform codes (organizerId NULL) are unique among themselves. The index
    // above cannot enforce this: NULL != NULL in a unique index.
    uniqueIndex('vouchers_platform_code_unique')
      .on(sql`lower(${t.code})`)
      .where(sql`${t.organizerId} is null`),
    index('vouchers_organizer_idx').on(t.organizerId),
    index('vouchers_event_idx').on(t.eventId),
  ]
)

export const vouchersRelations = relations(vouchers, ({ one }) => ({
  organizer: one(user, {
    fields: [vouchers.organizerId],
    references: [user.id],
  }),
  event: one(events, {
    fields: [vouchers.eventId],
    references: [events.id],
  }),
}))
