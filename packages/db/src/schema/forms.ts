import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  index,
  boolean,
  doublePrecision,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

import { user } from './auth'
import { events, orders } from './events'

// ─── Registration Forms ────────────────────────────────────────────────────

// A form an organizer attaches to one of their events so people can apply to
// take part: pageant contestants, vendors, anything else. One event can carry
// several (a contestant form and a vendor form, say). The organizer builds the
// fields, applicants submit, and the organizer approves or rejects each one.
//
// 'draft' is invisible to the public. 'published' accepts submissions inside
// the opensAt/closesAt window while spots remain. 'closed' stops intake but
// keeps every submission; publishing again reopens it.
export type FormStatus = 'draft' | 'published' | 'closed'

// What the form is for. It labels the form (dashboard filters, copy); no
// server rule branches on it.
export type FormType = 'contestant' | 'vendor' | 'other'

// 'auto' approves a submission as soon as it is complete (straight away when
// free, once paid when there is a fee); 'manual' parks it at 'submitted' for
// the organizer to review.
export type FormReviewMode = 'auto' | 'manual'

// The inverse `events.forms` relation is deliberately absent: eventsRelations
// lives in events.ts, which can't import this file without a cycle (the same
// reason vouchers has no back-reference there).
export const forms = pgTable(
  'forms',
  {
    id: text('id').primaryKey(),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, {
        onDelete: 'cascade',
        onUpdate: 'cascade',
      }),
    type: text('type').$type<FormType>().notNull().default('other'),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    // URL slug for the public form page. Unique platform-wide; generated
    // server-side from the event slug + form title at creation and never
    // regenerated, so a link the organizer has already shared survives a
    // rename. See generateUniqueFormSlug in packages/api/src/lib/forms.ts.
    slug: text('slug').notNull().unique(),
    // Intake window. NULL opensAt = open as soon as it is published; NULL
    // closesAt = open until the organizer closes it or the event ends.
    opensAt: timestamp('opens_at'),
    closesAt: timestamp('closes_at'),
    // Most submissions the form holds at once. NULL = unlimited.
    capacity: integer('capacity'),
    // Spots currently held against `capacity`: every submission except a
    // rejected one (rejecting releases its spot). A counter rather than a
    // COUNT(*) so intake can claim a spot with one conditional UPDATE
    // (`claimed + 1 <= capacity`), the oversell guard ticket tiers use on
    // `sold`: the row lock serialises concurrent claims, and a zero-row
    // result means the form just filled. Kept even when capacity is NULL, so
    // a capacity added later is checked against the real number. Written only
    // by claimFormSpot / releaseFormSpot in packages/api/src/lib/forms.ts.
    claimed: integer('claimed').notNull().default(0),
    reviewMode: text('review_mode')
      .$type<FormReviewMode>()
      .notNull()
      .default('manual'),
    status: text('status').$type<FormStatus>().notNull().default('draft'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [index('forms_event_idx').on(t.eventId)]
)

export const formsRelations = relations(forms, ({ one, many }) => ({
  event: one(events, {
    fields: [forms.eventId],
    references: [events.id],
  }),
  fields: many(formFields),
  priceOptions: many(formPriceOptions),
  submissions: many(submissions),
}))

// ─── Form Fields ───────────────────────────────────────────────────────────

// The value each type stores in submissions.answersJson:
//   short_text, long_text, email, phone, social_handle, dropdown → string
//   number → number     date → 'YYYY-MM-DD'     checkbox → boolean
//   image, file → one upload URL      images → an array of 1–5 upload URLs
// Files go to object storage first; only their URLs reach the database.
export type FormFieldType =
  | 'short_text'
  | 'long_text'
  | 'email'
  | 'phone'
  | 'number'
  | 'date'
  | 'dropdown'
  | 'checkbox'
  | 'image'
  | 'images'
  | 'file'
  | 'social_handle'

export const formFields = pgTable(
  'form_fields',
  {
    id: text('id').primaryKey(),
    formId: text('form_id')
      .notNull()
      .references(() => forms.id, {
        onDelete: 'cascade',
        onUpdate: 'cascade',
      }),
    label: text('label').notNull(),
    // Guidance shown under the label ("A full-length photo, no filters").
    helpText: text('help_text').notNull().default(''),
    type: text('type').$type<FormFieldType>().notNull(),
    required: boolean('required').notNull().default(false),
    // Dropdown choices in display order; an answer must match one exactly.
    // NULL for every other type.
    optionsJson: jsonb('options_json').$type<string[]>(),
    // Display order. reorderFields rewrites every position in one statement,
    // so gaps are harmless. Deliberately not unique per form: Postgres checks
    // a non-deferrable unique constraint row by row, so permuting positions
    // in a single UPDATE would collide with itself mid-statement.
    position: integer('position').notNull().default(0),
    // Validation config. Each column applies only to the types listed and is
    // NULL for the rest; NULL on an applicable type means the built-in
    // default, which also caps what an organizer may configure (see
    // FIELD_SPECS in packages/api/src/lib/form-fields.ts).
    //   maxLength          short_text, long_text — characters
    //   minValue/maxValue  number — inclusive bounds
    //   acceptedFileTypes  image, images — MIME types (file is PDF only)
    //   maxFiles           images — 1 to 5
    maxLength: integer('max_length'),
    minValue: doublePrecision('min_value'),
    maxValue: doublePrecision('max_value'),
    acceptedFileTypes: jsonb('accepted_file_types').$type<string[]>(),
    maxFiles: integer('max_files'),
  },
  (t) => [index('form_fields_form_idx').on(t.formId, t.position)]
)

export const formFieldsRelations = relations(formFields, ({ one }) => ({
  form: one(forms, {
    fields: [formFields.formId],
    references: [forms.id],
  }),
}))

// ─── Form Price Options ────────────────────────────────────────────────────

// Priced choices an applicant picks exactly one of: vendor booth types
// (Food / Fashion / Art), a pageant entry fee. A form with no rows here is
// free; a form with any requires a choice.
export const formPriceOptions = pgTable(
  'form_price_options',
  {
    id: text('id').primaryKey(),
    formId: text('form_id')
      .notNull()
      .references(() => forms.id, {
        onDelete: 'cascade',
        onUpdate: 'cascade',
      }),
    name: text('name').notNull(),
    // Minor units (kobo). 0 is allowed: a free choice on an otherwise paid
    // form takes the free path.
    priceMinor: integer('price_minor').notNull(),
    // Most submissions this option holds at once. NULL = no per-option limit
    // (the form's own capacity still applies).
    quantityLimit: integer('quantity_limit'),
    // Same accounting and guard as forms.claimed, against quantityLimit.
    claimed: integer('claimed').notNull().default(0),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [index('form_price_options_form_idx').on(t.formId)]
)

export const formPriceOptionsRelations = relations(
  formPriceOptions,
  ({ one, many }) => ({
    form: one(forms, {
      fields: [formPriceOptions.formId],
      references: [forms.id],
    }),
    submissions: many(submissions),
  })
)

// ─── Submissions ───────────────────────────────────────────────────────────

// pending_payment — the chosen option carries a fee that hasn't been paid;
//                   the submission holds its spot meanwhile.
// submitted       — complete and awaiting review (manual forms).
// approved        — accepted, by the organizer or automatically (auto forms).
// rejected        — declined with a reason; its spot is released.
export type SubmissionStatus =
  'pending_payment' | 'submitted' | 'approved' | 'rejected'

// Validated answers keyed by form_fields.id, which survives label edits.
// Unanswered optional fields are absent. FormFieldType lists what each type
// stores.
export type SubmissionAnswerValue = string | number | boolean | string[]
export type SubmissionAnswers = Record<string, SubmissionAnswerValue>

export const submissions = pgTable(
  'submissions',
  {
    id: text('id').primaryKey(),
    formId: text('form_id')
      .notNull()
      .references(() => forms.id, {
        onDelete: 'cascade',
        onUpdate: 'cascade',
      }),
    // The option chosen; NULL on a free form. ON DELETE is left at NO ACTION
    // so an option a submission references can't be deleted on its own (the
    // API refuses first, with a friendly message; this is the backstop).
    // Deleting the whole form or event still works: the cascade deletes these
    // submissions in the same statement, and Postgres runs the NO ACTION
    // check only after that statement's cascades have finished.
    priceOptionId: text('price_option_id').references(
      () => formPriceOptions.id,
      { onUpdate: 'cascade' }
    ),
    // The order paying this submission's fee, set by the paid path. NULL for
    // a free submission.
    orderId: text('order_id').references(() => orders.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    // The signed-in applicant, when there was one. Forms are public, so most
    // submissions are anonymous and this stays NULL.
    applicantId: text('applicant_id').references(() => user.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    // Contact details every form collects, outside the organizer's own
    // fields: an organizer's form may have no email field at all, yet the
    // confirmation email (carrying `reference`) needs an address, and so does
    // the payment provider on the paid path.
    applicantName: text('applicant_name').notNull(),
    applicantEmail: text('applicant_email').notNull(),
    status: text('status')
      .$type<SubmissionStatus>()
      .notNull()
      .default('submitted'),
    answersJson: jsonb('answers_json')
      .$type<SubmissionAnswers>()
      .notNull()
      .default({}),
    // Who decided, and when. NULL until reviewed; an auto-approved
    // submission has reviewedAt but no reviewer.
    reviewerId: text('reviewer_id').references(() => user.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    reviewedAt: timestamp('reviewed_at'),
    // Why it was rejected, written for the applicant. NULL unless rejected.
    reason: text('reason'),
    // Short code (e.g. "K7QM-3XPD") for the confirmation email and support
    // queries: what an applicant quotes, unlike the opaque id. Unique
    // platform-wide so it resolves on its own. See generateSubmissionReference
    // in packages/api/src/lib/forms.ts.
    reference: text('reference').notNull().unique(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    // The organizer's list filters by form, then by status.
    index('submissions_form_status_idx').on(t.formId, t.status),
    // The paid path resolves a submission from its order on payment.
    index('submissions_order_idx').on(t.orderId),
    index('submissions_price_option_idx').on(t.priceOptionId),
  ]
)

export const submissionsRelations = relations(submissions, ({ one }) => ({
  form: one(forms, {
    fields: [submissions.formId],
    references: [forms.id],
  }),
  priceOption: one(formPriceOptions, {
    fields: [submissions.priceOptionId],
    references: [formPriceOptions.id],
  }),
  order: one(orders, {
    fields: [submissions.orderId],
    references: [orders.id],
  }),
  applicant: one(user, {
    fields: [submissions.applicantId],
    references: [user.id],
    relationName: 'submissions_applicant',
  }),
  reviewer: one(user, {
    fields: [submissions.reviewerId],
    references: [user.id],
    relationName: 'submissions_reviewer',
  }),
}))
