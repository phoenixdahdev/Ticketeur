import {
  pgTable,
  text,
  timestamp,
  integer,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

import { user } from './auth'
import type { OrderType } from './events'

// ─── Payment Discrepancies ────────────────────────────────────────────────
//
// Money the platform is holding that it may owe back to a customer. Every
// row here is a Flutterwave charge that took money against one of our orders
// and left something unsettled; each one is a refund a person has to issue by
// hand in the Flutterwave dashboard, and then record here.
//
// Written from fulfillOrder (packages/api/src/lib/orders.ts), which is the
// single path every payment goes through — the FW webhook, the
// /checkout/return page and the 15-minute reconciliation job all call it.
// Before this table existed each of these was a console.error and nothing
// else: logs expire, so the money became unfindable.
//
// And from one place outside fulfilment: the organizer rejecting a
// registration whose fee was paid (packages/api/src/lib/form-refunds.ts). That
// money arrived cleanly and was earned at the time; what makes it owed back is
// a decision taken later, which is why it cannot be detected at payment time.

export type PaymentDiscrepancyKind =
  // The charge paid more than the order asked for. Flutterwave's guidance is
  // to give value and refund the rest, so the order IS fulfilled and only the
  // excess is owed. `owedMinor` is the excess, not the whole charge.
  | 'overpayment'
  // The charge carried this order's tx_ref but did not pay for it (underpaid,
  // wrong currency, unreadable amount). Nothing was delivered and the order is
  // marked 'failed', so the whole charge is owed back.
  | 'rejected_charge'
  // A second successful charge arrived for an order already paid by a
  // different transaction: the buyer paid twice for one thing. The whole
  // second charge is owed back.
  | 'duplicate_charge'
  // The charge did pay for the order, but fulfilment could not deliver it and
  // rolled back — a tier that sold out between payment and minting, an order
  // type with no fulfilment yet, a registration fee whose submission is gone.
  // The buyer is charged and holds nothing, so the whole charge is owed back.
  | 'undelivered'
  // A registration fee that was paid and delivered, and then taken away: the
  // organizer rejected the application. The applicant paid to be considered
  // and holds nothing, so the whole fee is owed back. The only kind written
  // outside fulfilment — see packages/api/src/lib/form-refunds.ts, which the
  // organizer's reject calls. Deliberately its own kind rather than
  // 'undelivered': nothing failed and nothing rolled back, and an admin acting
  // on 'undelivered' advice ("unless the order is delivered by hand instead")
  // would be re-approving an application the organizer turned down.
  | 'registration_rejected'
  // The charge bought votes for a contest that had stopped accepting them by
  // the time it cleared — closed or suspended between the payment link and
  // the webhook. The credits exist but can never be spent, so the whole
  // charge is owed back. Deliberately not 'undelivered': fulfilment did not
  // fail and nothing rolled back, and an admin following that row's advice
  // ("unless the order is delivered by hand instead") would be looking for a
  // delivery that cannot happen.
  | 'votes_unusable'

// Resolution is an explicit human action. Nothing in this codebase moves a row
// to 'resolved' on its own — refunds happen by hand in Flutterwave and an
// admin records that they did it.
export type PaymentDiscrepancyStatus = 'open' | 'resolved'

export const paymentDiscrepancies = pgTable(
  'payment_discrepancies',
  {
    id: text('id').primaryKey(),
    kind: text('kind').$type<PaymentDiscrepancyKind>().notNull(),

    // Soft pointers, deliberately not foreign keys. A record of money owed to
    // a customer has to outlive the rows it describes: deleting an event
    // cascades to its orders (see admin/events.ts `remove` and
    // routers/events.ts `delete`), and that must not quietly delete the
    // evidence that someone is owed a refund. Same reasoning as
    // reports.subjectId and orders.voucherId, which are soft pointers too.
    // Everything an admin needs to issue the refund is denormalised below, so
    // a row still reads correctly with its order gone.
    orderId: text('order_id').notNull(),
    orderType: text('order_type').$type<OrderType>().notNull(),
    eventId: text('event_id'),

    // Who is owed. Copied at detection time: the order's buyer columns are
    // what checkout captured, and this record must not depend on them.
    buyerEmail: text('buyer_email').notNull().default(''),
    buyerName: text('buyer_name').notNull().default(''),

    // What an admin types into Flutterwave to find and refund the charge.
    // flwTransactionId is copied here rather than read off the order because
    // orders.flw_transaction_id is OVERWRITTEN: an order that goes
    // failed → paid replaces the rejected charge's id with the good one, and
    // the rejected charge's money would otherwise become untraceable.
    flwTxRef: text('flw_tx_ref'),
    flwTransactionId: text('flw_transaction_id').notNull(),

    // All money in minor units (kobo for NGN).
    // What the order asked Flutterwave to charge, always NGN.
    expectedMinor: integer('expected_minor').notNull(),
    // What the charge actually took, in `paidCurrency`'s minor units. NULL
    // only when Flutterwave's amount could not be read as a number
    // ('invalid_amount') — the admin then reads it off the dashboard.
    paidMinor: integer('paid_minor'),
    // The charge's currency as Flutterwave reported it. Normally 'NGN'; a
    // 'currency_mismatch' rejection is exactly the case where it is not.
    paidCurrency: text('paid_currency').notNull().default('NGN'),
    // What is owed back, in `paidCurrency`'s minor units: the excess for an
    // overpayment, the whole charge for every other kind. NULL when the
    // amount could not be read.
    owedMinor: integer('owed_minor'),

    // Machine-readable cause, e.g. a ChargeRejection reason ('underpaid',
    // 'currency_mismatch', 'invalid_amount') or why delivery failed.
    reason: text('reason').notNull().default(''),
    // One human-readable line for the admin, built where the problem was
    // detected.
    detail: text('detail').notNull().default(''),

    status: text('status')
      .$type<PaymentDiscrepancyStatus>()
      .notNull()
      .default('open'),
    detectedAt: timestamp('detected_at').notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at'),
    resolvedBy: text('resolved_by').references(() => user.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    // What the admin did, in their words — the Flutterwave refund reference
    // belongs here.
    resolutionNote: text('resolution_note').notNull().default(''),
  },
  (t) => [
    // One payment produces one record. fulfillOrder's `SELECT … FOR UPDATE`
    // serialises concurrent fulfilments of one order, but it cannot stop
    // repeats *over time*: the webhook retries, the return page and the
    // 15-minute reconciliation job all re-present the same charge, and the
    // already-paid and delivery-failed paths are reached on every one of
    // them. This index is what makes the write idempotent — every insert is
    // ON CONFLICT DO NOTHING against it.
    uniqueIndex('payment_discrepancies_charge_idx').on(
      t.orderId,
      t.flwTransactionId,
      t.kind
    ),
    index('payment_discrepancies_status_idx').on(t.status, t.detectedAt),
    index('payment_discrepancies_order_idx').on(t.orderId),
    index('payment_discrepancies_buyer_email_idx').on(t.buyerEmail),
  ]
)

export const paymentDiscrepanciesRelations = relations(
  paymentDiscrepancies,
  ({ one }) => ({
    resolver: one(user, {
      fields: [paymentDiscrepancies.resolvedBy],
      references: [user.id],
    }),
  })
)
