import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  index,
  boolean,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

import { user } from './auth'

// ─── Events ────────────────────────────────────────────────────────────────

// 'suspended' is an admin moderation state: the event keeps its data but is
// hidden from every public surface (those all filter status = 'upcoming').
// Admin suspend/unsuspend toggles between 'upcoming' and 'suspended'.
export type EventStatus =
  'draft' | 'in-review' | 'upcoming' | 'archived' | 'suspended'

// A proposed edit to a live event, awaiting admin approval. Mirrors the
// updateEvent input minus the id — the whole payload including the tiers to
// reconcile. Stored on the event so the live columns stay untouched (and the
// public page keeps showing the current version) until an admin approves.
export type EventPendingChanges = {
  title: string
  description: string
  date: string
  endDate?: string | null
  time: string
  location: string
  bannerUrl?: string | null
  features: string[]
  tiers: { id?: string; name: string; quantity: number; priceMinor: number }[]
}

export const events = pgTable(
  'events',
  {
    id: text('id').primaryKey(),
    organizerId: text('organizer_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    title: text('title').notNull(),
    // URL slug for the public event page (/events/[slug]). Unique platform-wide;
    // generated from the title at creation time. See packages/api/src/lib/slug.ts.
    slug: text('slug').notNull().unique(),
    description: text('description').notNull().default(''),
    // ISO date string (YYYY-MM-DD) — separate from time so the form can edit each independently.
    // NULL means the date is "TBD" (event postponed without a new date yet). The app
    // treats a null date as an upcoming/visible event; formatters render it as "TBD".
    eventDate: text('event_date'),
    // Multi-day events: ISO date for the last day. NULL means single-day,
    // in which case the event runs only on `eventDate`.
    endDate: text('end_date'),
    eventTime: text('event_time').notNull(),
    location: text('location').notNull(),
    bannerUrl: text('banner_url'),
    features: jsonb('features').$type<string[]>().notNull().default([]),
    status: text('status').$type<EventStatus>().notNull().default('draft'),
    // Pending edit to a live (upcoming) event, awaiting admin approval. NULL
    // when nothing is pending. The columns above stay untouched until approval.
    pendingChanges: jsonb('pending_changes').$type<EventPendingChanges>(),
    pendingSubmittedAt: timestamp('pending_submitted_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('events_organizer_idx').on(t.organizerId),
    index('events_status_idx').on(t.status),
  ]
)

export const eventsRelations = relations(events, ({ many, one }) => ({
  organizer: one(user, {
    fields: [events.organizerId],
    references: [user.id],
  }),
  tiers: many(ticketTiers),
  vendors: many(eventVendors),
  externalInvites: many(externalVendorInvites),
  orders: many(orders),
  activity: many(activityLog),
}))

// ─── Ticket Tiers ──────────────────────────────────────────────────────────

export const ticketTiers = pgTable(
  'ticket_tiers',
  {
    id: text('id').primaryKey(),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, {
        onDelete: 'cascade',
        onUpdate: 'cascade',
      }),
    name: text('name').notNull(),
    quantity: integer('quantity').notNull(),
    // Stored in minor units (e.g., kobo / cents) to avoid float drift
    priceMinor: integer('price_minor').notNull(),
    sold: integer('sold').notNull().default(0),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [index('ticket_tiers_event_idx').on(t.eventId)]
)

export const ticketTiersRelations = relations(ticketTiers, ({ one, many }) => ({
  event: one(events, {
    fields: [ticketTiers.eventId],
    references: [events.id],
  }),
  orders: many(orders),
}))

// ─── Event Vendors (registered vendors assigned/invited) ──────────────────

export type EventVendorStatus = 'invited' | 'accepted' | 'declined'

export const eventVendors = pgTable(
  'event_vendors',
  {
    id: text('id').primaryKey(),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, {
        onDelete: 'cascade',
        onUpdate: 'cascade',
      }),
    vendorId: text('vendor_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    status: text('status')
      .$type<EventVendorStatus>()
      .notNull()
      .default('invited'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('event_vendors_event_idx').on(t.eventId),
    index('event_vendors_vendor_idx').on(t.vendorId),
  ]
)

export const eventVendorsRelations = relations(eventVendors, ({ one }) => ({
  event: one(events, {
    fields: [eventVendors.eventId],
    references: [events.id],
  }),
  vendor: one(user, {
    fields: [eventVendors.vendorId],
    references: [user.id],
  }),
}))

// ─── External Vendor Invites (not registered on platform) ─────────────────

export type ExternalVendorInviteStatus = 'invited' | 'accepted' | 'declined'

export const externalVendorInvites = pgTable(
  'external_vendor_invites',
  {
    id: text('id').primaryKey(),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, {
        onDelete: 'cascade',
        onUpdate: 'cascade',
      }),
    businessName: text('business_name').notNull(),
    contactName: text('contact_name').notNull(),
    email: text('email').notNull(),
    phone: text('phone').notNull(),
    status: text('status')
      .$type<ExternalVendorInviteStatus>()
      .notNull()
      .default('invited'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [index('external_vendor_invites_event_idx').on(t.eventId)]
)

export const externalVendorInvitesRelations = relations(
  externalVendorInvites,
  ({ one }) => ({
    event: one(events, {
      fields: [externalVendorInvites.eventId],
      references: [events.id],
    }),
  })
)

// ─── Orders ───────────────────────────────────────────────────────────────

export type OrderStatus =
  'pending' | 'paid' | 'refunded' | 'cancelled' | 'failed'

// What an order pays for. 'ticket' orders carry their lines in order_items;
// the others point at the row they pay for through orders.referenceId.
export type OrderType =
  'ticket' | 'registration_fee' | 'vendor_fee' | 'vote_purchase'

export const orders = pgTable(
  'orders',
  {
    id: text('id').primaryKey(),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, {
        onDelete: 'cascade',
        onUpdate: 'cascade',
      }),
    // Every order placed before this column existed was a ticket order, so
    // 'ticket' is the default and the migration backfills them to it.
    type: text('type').$type<OrderType>().notNull().default('ticket'),
    // Points to the row `type` says the order pays for: a form submission for
    // 'registration_fee', a contest entry for 'vote_purchase'. NULL for
    // 'ticket' orders, whose lines live in order_items.
    // Not declared as a real FK because it's polymorphic.
    referenceId: text('reference_id'),
    // Legacy single-tier pointer. Nullable since a multi-tier order carries
    // its lines in `order_items` instead; kept (and backfilled) so existing
    // single-tier orders still resolve a tier. New orders leave this null.
    tierId: text('tier_id').references(() => ticketTiers.id, {
      onDelete: 'cascade',
      onUpdate: 'cascade',
    }),
    buyerId: text('buyer_id').references(() => user.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    // Guest checkout — captured even when buyerId is set so we have a record
    // of what was entered at purchase time.
    buyerEmail: text('buyer_email').notNull().default(''),
    buyerName: text('buyer_name').notNull().default(''),
    buyerPhone: text('buyer_phone').notNull().default(''),
    quantity: integer('quantity').notNull(),
    // subtotalMinor = priceMinor × quantity (tickets only)
    // feeMinor      = platform service fee applied at checkout
    // totalMinor    = subtotalMinor + feeMinor (this is what the buyer pays)
    subtotalMinor: integer('subtotal_minor').notNull().default(0),
    // Voucher discount applied to the subtotal (minor units). 0 when none.
    discountMinor: integer('discount_minor').notNull().default(0),
    feeMinor: integer('fee_minor').notNull().default(0),
    totalMinor: integer('total_minor').notNull(),
    // Soft pointer to vouchers.id (no FK: vouchers references events, so a real
    // FK here would form an import cycle — same pattern as reports.subjectId).
    // The applied amount is captured in discountMinor regardless.
    voucherId: text('voucher_id'),
    // Group ("For Multiple") orders: the per-attendee recipients captured at
    // checkout. NULL for a "For Myself" order. Needed because paid orders mint
    // their tickets later (at webhook fulfillment), so the attendee list has to
    // survive between checkout and payment. Post-fulfillment the source of
    // truth is each ticket's recipient columns.
    attendees:
      jsonb('attendees').$type<
        { name: string; email: string; tierId: string }[]
      >(),
    status: text('status').$type<OrderStatus>().notNull().default('pending'),
    // Flutterwave correlation — tx_ref is what we send, transaction_id is
    // what FW returns once the customer pays. On a 'failed' order a
    // transaction_id is the charge fulfilment rejected (underpaid or wrong
    // currency) and still needs a refund; see fulfillOrder.
    flwTxRef: text('flw_tx_ref'),
    flwTransactionId: text('flw_transaction_id'),
    ticketsPdfUrl: text('tickets_pdf_url'),
    paidAt: timestamp('paid_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('orders_event_idx').on(t.eventId),
    index('orders_buyer_idx').on(t.buyerId),
    index('orders_flw_tx_ref_idx').on(t.flwTxRef),
    index('orders_buyer_email_idx').on(t.buyerEmail),
    index('orders_reference_idx').on(t.type, t.referenceId),
  ]
)

export const ordersRelations = relations(orders, ({ one, many }) => ({
  event: one(events, {
    fields: [orders.eventId],
    references: [events.id],
  }),
  tier: one(ticketTiers, {
    fields: [orders.tierId],
    references: [ticketTiers.id],
  }),
  buyer: one(user, {
    fields: [orders.buyerId],
    references: [user.id],
  }),
  items: many(orderItems),
  tickets: many(tickets),
}))

// ─── Order Items (one line per tier within an order) ──────────────────────

// An order can span multiple tiers (e.g. 2× VIP + 1× General). Each line
// snapshots the tier name and unit price at purchase time so receipts stay
// correct even if the tier is later renamed or repriced.
export const orderItems = pgTable(
  'order_items',
  {
    id: text('id').primaryKey(),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id, {
        onDelete: 'cascade',
        onUpdate: 'cascade',
      }),
    tierId: text('tier_id')
      .notNull()
      .references(() => ticketTiers.id, {
        onDelete: 'cascade',
        onUpdate: 'cascade',
      }),
    tierName: text('tier_name').notNull(),
    // Snapshot of the tier's priceMinor at purchase time (minor units).
    unitPriceMinor: integer('unit_price_minor').notNull(),
    quantity: integer('quantity').notNull(),
  },
  (t) => [
    index('order_items_order_idx').on(t.orderId),
    index('order_items_tier_idx').on(t.tierId),
  ]
)

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, {
    fields: [orderItems.orderId],
    references: [orders.id],
  }),
  tier: one(ticketTiers, {
    fields: [orderItems.tierId],
    references: [ticketTiers.id],
  }),
}))

// ─── Tickets ──────────────────────────────────────────────────────────────

export const tickets = pgTable(
  'tickets',
  {
    id: text('id').primaryKey(),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id, {
        onDelete: 'cascade',
        onUpdate: 'cascade',
      }),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, {
        onDelete: 'cascade',
        onUpdate: 'cascade',
      }),
    tierId: text('tier_id')
      .notNull()
      .references(() => ticketTiers.id, {
        onDelete: 'cascade',
        onUpdate: 'cascade',
      }),
    // Opaque token used for QR + check-in. Distinct from the row id so we
    // can rotate it (e.g. on reissue) without breaking foreign keys.
    code: text('code').notNull().unique(),
    // Recipient of this specific ticket. For a "For Myself" order these mirror
    // the buyer; for a "For Multiple" (group) order each ticket carries its own
    // attendee, and the confirmation email goes to recipientEmail.
    recipientName: text('recipient_name'),
    recipientEmail: text('recipient_email'),
    checkedIn: boolean('checked_in').notNull().default(false),
    checkedInAt: timestamp('checked_in_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('tickets_order_idx').on(t.orderId),
    index('tickets_event_idx').on(t.eventId),
    index('tickets_code_idx').on(t.code),
  ]
)

export const ticketsRelations = relations(tickets, ({ one }) => ({
  order: one(orders, {
    fields: [tickets.orderId],
    references: [orders.id],
  }),
  event: one(events, {
    fields: [tickets.eventId],
    references: [events.id],
  }),
  tier: one(ticketTiers, {
    fields: [tickets.tierId],
    references: [ticketTiers.id],
  }),
}))

// ─── Activity Log ─────────────────────────────────────────────────────────

export type ActivityType =
  | 'event.created'
  | 'event.updated'
  | 'event.archived'
  | 'event.published'
  | 'event.deleted'
  | 'event.edit_submitted'
  | 'event.edit_approved'
  | 'event.edit_rejected'
  | 'order.placed'

export const activityLog = pgTable(
  'activity_log',
  {
    id: text('id').primaryKey(),
    organizerId: text('organizer_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    eventId: text('event_id').references(() => events.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    type: text('type').$type<ActivityType>().notNull(),
    payload: jsonb('payload')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('activity_log_organizer_idx').on(t.organizerId),
    index('activity_log_created_idx').on(t.createdAt),
  ]
)

export const activityLogRelations = relations(activityLog, ({ one }) => ({
  organizer: one(user, {
    fields: [activityLog.organizerId],
    references: [user.id],
  }),
  event: one(events, {
    fields: [activityLog.eventId],
    references: [events.id],
  }),
}))

// ─── Reports / Moderation Flags ───────────────────────────────────────────

export type ReportSubjectType = 'vendor' | 'organizer' | 'attendee' | 'event'
export type ReportStatus = 'open' | 'dismissed' | 'actioned'

export const reports = pgTable(
  'reports',
  {
    id: text('id').primaryKey(),
    subjectType: text('subject_type').$type<ReportSubjectType>().notNull(),
    // Points to user.id for {vendor, organizer, attendee} or events.id for event.
    // Not declared as a real FK because it's polymorphic.
    subjectId: text('subject_id').notNull(),
    reason: text('reason').notNull(),
    detail: text('detail').notNull().default(''),
    reportedBy: text('reported_by').references(() => user.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    status: text('status').$type<ReportStatus>().notNull().default('open'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at'),
  },
  (t) => [
    index('reports_status_idx').on(t.status),
    index('reports_subject_idx').on(t.subjectType, t.subjectId),
  ]
)

export const reportsRelations = relations(reports, ({ one }) => ({
  reporter: one(user, {
    fields: [reports.reportedBy],
    references: [user.id],
  }),
}))
