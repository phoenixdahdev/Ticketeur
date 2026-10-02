import {
  pgTable,
  text,
  integer,
  timestamp,
  index,
  check,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'

import { user } from './auth'

// ─── Platform settings (the service-fee rates) ──────────────────────────────

// The platform charges a service fee on three kinds of revenue, each with its
// own rate an admin can change:
//
//   ticket        — ticket checkout (public/checkout.ts)
//   registration  — registration-form fees: contestant entry, vendor booth
//                   (lib/form-payments.ts)
//   vote          — paid contest voting. Stored and readable; nothing charges
//                   it yet, so that the rate is already in place and already
//                   audited on the day voting ships.
//
// Rates are in BASIS POINTS (1 bp = 0.01%), so 500 = 5%, matching the voucher
// `percent` convention. Integer-only, because the fee is computed with integer
// maths against a kobo subtotal and must never acquire float drift.
//
// ── Why one row rather than a key/value table ──
// All three rates are read together on every priced path, and an admin saves
// them together. One row makes that a single primary-key lookup and a single
// atomic UPDATE: there is no instant at which checkout can observe the new
// ticket rate beside the old registration rate. A key/value table would need
// three rows, three reads, and a transaction to stay consistent, and would
// store integers as text. Typed columns also let the CHECK constraints below
// police the range in the database rather than only in Zod.
//
// ── Why there may be no row at all ──
// Nothing seeds this table. `getFeeRates` (api/lib/platform-settings.ts)
// returns 500/500/500 when the row is missing, which is the same number the
// column defaults carry, so the platform charges exactly today's 5% from the
// moment this ships and keeps doing so until an admin saves something else.
// The first save inserts the row.
export const PLATFORM_SETTINGS_ROW_ID = 'global'

export const platformSettings = pgTable(
  'platform_settings',
  {
    // Single-row table: the id is fixed by the CHECK below, so a second row
    // cannot be inserted even by mistake.
    id: text('id').primaryKey().default(PLATFORM_SETTINGS_ROW_ID),
    ticketFeeBps: integer('ticket_fee_bps').notNull().default(500),
    registrationFeeBps: integer('registration_fee_bps').notNull().default(500),
    voteFeeBps: integer('vote_fee_bps').notNull().default(500),
    // Who saved the rates last, and when. The full history is in
    // platform_fee_changes; these two are what the settings screen shows.
    updatedBy: text('updated_by').references(() => user.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    // One row, always this id, so a second settings row cannot exist.
    check('platform_settings_single_row', sql`${t.id} = 'global'`),
    // 0% to 100%. Also enforced by Zod on the admin mutation; duplicated here
    // so a stray write from anywhere — a script, a console, a later migration
    // — cannot leave a 500% rate in a column that checkout multiplies money
    // by.
    check(
      'platform_settings_ticket_fee_bps_range',
      sql`${t.ticketFeeBps} >= 0 and ${t.ticketFeeBps} <= 10000`
    ),
    check(
      'platform_settings_registration_fee_bps_range',
      sql`${t.registrationFeeBps} >= 0 and ${t.registrationFeeBps} <= 10000`
    ),
    check(
      'platform_settings_vote_fee_bps_range',
      sql`${t.voteFeeBps} >= 0 and ${t.voteFeeBps} <= 10000`
    ),
  ]
)

export const platformSettingsRelations = relations(
  platformSettings,
  ({ one }) => ({
    updatedByUser: one(user, {
      fields: [platformSettings.updatedBy],
      references: [user.id],
    }),
  })
)

// ─── Fee change audit ───────────────────────────────────────────────────────

// Append-only: one row per save that actually changed a rate. This is money,
// so "why is the fee different from last month" has to be answerable from the
// database alone, long after the fact.
//
// Each row carries both the previous and the new value of all three rates, so
// a single row answers the question without joining it to its neighbours or
// assuming anything about ordering. The actor's name and email are snapshotted
// beside the foreign key: `updatedBy` goes NULL if that admin's account is
// ever deleted, and an audit record that forgets who acted is not an audit
// record.
//
// Nothing reads this to decide a charge. `orders.feeMinor` is the per-order
// snapshot that does that, and it is written once at checkout and never
// recomputed, so a rate change here can never reach an order that already
// exists.
export const platformFeeChanges = pgTable(
  'platform_fee_changes',
  {
    id: text('id').primaryKey(),
    changedBy: text('changed_by').references(() => user.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    // Snapshots, so the record survives the account being deleted.
    changedByName: text('changed_by_name').notNull().default(''),
    changedByEmail: text('changed_by_email').notNull().default(''),
    previousTicketFeeBps: integer('previous_ticket_fee_bps').notNull(),
    previousRegistrationFeeBps: integer(
      'previous_registration_fee_bps'
    ).notNull(),
    previousVoteFeeBps: integer('previous_vote_fee_bps').notNull(),
    ticketFeeBps: integer('ticket_fee_bps').notNull(),
    registrationFeeBps: integer('registration_fee_bps').notNull(),
    voteFeeBps: integer('vote_fee_bps').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [index('platform_fee_changes_created_idx').on(t.createdAt)]
)

export const platformFeeChangesRelations = relations(
  platformFeeChanges,
  ({ one }) => ({
    changedByUser: one(user, {
      fields: [platformFeeChanges.changedBy],
      references: [user.id],
    }),
  })
)
