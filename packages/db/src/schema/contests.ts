import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'

import { user } from './auth'
import { events } from './events'

// ─── Contests & Voting ─────────────────────────────────────────────────────

// A contest an organizer attaches to one of their events: a pageant, an awards
// category set, anything the public votes on. Categories hold entries, and an
// entry is usually an approved registration promoted across from a form.
//
// A contest takes money from the public, so it is moderated exactly as forms
// and events are — the statuses below are the same words with the same
// meanings, deliberately, so one mental model covers all three.
//
// 'draft'          — being built; invisible to the public.
// 'pending_review' — submitted, waiting for an admin.
// 'published'      — approved: voting runs inside the opens/closes window.
// 'rejected'       — turned down (rejectionReason says why); edit, resubmit.
// 'closed'         — voting has ended. The page and the results stay public.
// 'suspended'      — taken down by an admin. Voting stops at once and the
//                    public page goes with it. As with forms, the only way
//                    back is a fix plus a fresh approval, so approvedRevision
//                    is cleared.
export type ContestStatus =
  'draft' | 'pending_review' | 'published' | 'rejected' | 'closed' | 'suspended'

export const contests = pgTable(
  'contests',
  {
    id: text('id').primaryKey(),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, {
        onDelete: 'cascade',
        onUpdate: 'cascade',
      }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    // Public URL slug, unique platform-wide and never regenerated, so a link
    // the organizer already shared survives a rename. Same rule as forms.slug.
    slug: text('slug').notNull().unique(),

    // ── When voting runs ──
    // NULL opensAt = open as soon as it is published; NULL closesAt = open
    // until the organizer closes it. Both are checked at vote time, not swept
    // by a job — the same read-time rule that decides whether an event is past.
    votingOpensAt: timestamp('voting_opens_at'),
    votingClosesAt: timestamp('voting_closes_at'),
    // The optional nomination phase in front of voting (the Eco Creative Award
    // shape). NULL on both = no nomination phase; entries are added directly.
    nominationsOpenAt: timestamp('nominations_open_at'),
    nominationsCloseAt: timestamp('nominations_close_at'),

    // ── How voting is paid for ──
    // Both may run at once: a verified email gets one free vote per category
    // per day, and anyone can buy more on top.
    freeVotingEnabled: boolean('free_voting_enabled').notNull().default(true),
    paidVotingEnabled: boolean('paid_voting_enabled').notNull().default(true),
    // Minor units (kobo) for a single loose vote, when the voter does not want
    // a bundle. 0 with paid voting on means bundles only.
    pricePerVoteMinor: integer('price_per_vote_minor').notNull().default(0),

    status: text('status').$type<ContestStatus>().notNull().default('draft'),

    // ── Admin review ──
    // Identical machinery to forms (packages/api/src/lib/form-review.ts):
    // counts changes to what an admin actually reviewed, so an edit landing
    // mid-review cannot be approved unseen.
    contentRevision: integer('content_revision').notNull().default(0),
    approvedRevision: integer('approved_revision'),
    reviewRequestedAt: timestamp('review_requested_at'),
    reviewerId: text('reviewer_id').references(() => user.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    reviewedAt: timestamp('reviewed_at'),
    rejectionReason: text('rejection_reason'),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('contests_event_idx').on(t.eventId),
    // The admin review queue filters on status.
    index('contests_status_idx').on(t.status),
    check(
      'contests_price_per_vote_non_negative',
      sql`${t.pricePerVoteMinor} >= 0`
    ),
  ]
)

export const contestsRelations = relations(contests, ({ one, many }) => ({
  event: one(events, {
    fields: [contests.eventId],
    references: [events.id],
  }),
  reviewer: one(user, {
    fields: [contests.reviewerId],
    references: [user.id],
    relationName: 'contests_reviewer',
  }),
  categories: many(contestCategories),
  bundles: many(voteBundles),
}))

// ─── Categories ────────────────────────────────────────────────────────────

// One thing being voted on ("Face of Haiku", "Eco Creative Award"). A contest
// always has at least one; the free-vote allowance is per category, so this is
// also the unit a free voter gets one daily vote in.
export const contestCategories = pgTable(
  'contest_categories',
  {
    id: text('id').primaryKey(),
    contestId: text('contest_id')
      .notNull()
      .references(() => contests.id, {
        onDelete: 'cascade',
        onUpdate: 'cascade',
      }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [index('contest_categories_contest_idx').on(t.contestId)]
)

export const contestCategoriesRelations = relations(
  contestCategories,
  ({ one, many }) => ({
    contest: one(contests, {
      fields: [contestCategories.contestId],
      references: [contests.id],
    }),
    entries: many(entries),
  })
)

// ─── Entries ───────────────────────────────────────────────────────────────

// 'withdrawn'    — the contestant pulled out; keeps their votes on record but
//                  takes them off the ballot.
// 'disqualified' — removed by the organizer. Same visibility effect; a
//                  different word because it means something different to the
//                  people who voted.
export type EntryStatus = 'active' | 'withdrawn' | 'disqualified'

export const entries = pgTable(
  'entries',
  {
    id: text('id').primaryKey(),
    // Denormalised alongside categoryId: every leaderboard, credit check and
    // vote guard is scoped to a contest, and carrying it here saves a join on
    // the hottest read on the platform.
    contestId: text('contest_id')
      .notNull()
      .references(() => contests.id, {
        onDelete: 'cascade',
        onUpdate: 'cascade',
      }),
    categoryId: text('category_id')
      .notNull()
      .references(() => contestCategories.id, {
        onDelete: 'cascade',
        onUpdate: 'cascade',
      }),
    // The approved registration this entry was promoted from. A SOFT pointer
    // with no foreign key, the pattern reports.subjectId and
    // payment_discrepancies use: a live contest with votes cast against it
    // must not be broken by anything happening to the submission behind it.
    // NULL when the organizer added the entry by hand.
    submissionId: text('submission_id'),
    displayName: text('display_name').notNull(),
    photoUrl: text('photo_url'),
    bio: text('bio').notNull().default(''),
    status: text('status').$type<EntryStatus>().notNull().default('active'),
    // Running total, kept by the same conditional-UPDATE idiom ticket tiers
    // use on `sold`, so concurrent votes cannot lose a count to a lost update.
    // The `votes` ledger below is the audit trail this is derived from, and
    // the two are written in one transaction.
    voteCount: integer('vote_count').notNull().default(0),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('entries_category_idx').on(t.categoryId),
    index('entries_contest_idx').on(t.contestId),
    // The public leaderboard: highest first, within a category.
    index('entries_leaderboard_idx').on(t.categoryId, t.voteCount),
    // One applicant cannot be promoted into the same contest twice. Partial,
    // because a hand-added entry has no submission behind it.
    uniqueIndex('entries_submission_unique')
      .on(t.contestId, t.submissionId)
      .where(sql`${t.submissionId} is not null`),
    check('entries_vote_count_non_negative', sql`${t.voteCount} >= 0`),
  ]
)

export const entriesRelations = relations(entries, ({ one, many }) => ({
  contest: one(contests, {
    fields: [entries.contestId],
    references: [contests.id],
  }),
  category: one(contestCategories, {
    fields: [entries.categoryId],
    references: [contestCategories.id],
  }),
  votes: many(votes),
}))

// ─── Vote bundles ──────────────────────────────────────────────────────────

// A pack of votes sold at a price ("20 votes — ₦1,000"). Buying grants a
// BALANCE (vote_credits) rather than voting for anyone: the voter spends it
// across the contest afterwards. Same shape as form_price_options.
export const voteBundles = pgTable(
  'vote_bundles',
  {
    id: text('id').primaryKey(),
    contestId: text('contest_id')
      .notNull()
      .references(() => contests.id, {
        onDelete: 'cascade',
        onUpdate: 'cascade',
      }),
    label: text('label').notNull(),
    // How many votes the pack grants.
    votes: integer('votes').notNull(),
    // Minor units (kobo), before the platform service fee. The fee is added on
    // top at checkout and shown to the voter as its own line — the voter bears
    // it, as ticket buyers and applicants do (packages/api/src/lib/fees.ts).
    priceMinor: integer('price_minor').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    // Retired bundles stay for the orders that reference them.
    active: boolean('active').notNull().default(true),
  },
  (t) => [
    index('vote_bundles_contest_idx').on(t.contestId),
    check('vote_bundles_votes_positive', sql`${t.votes} > 0`),
    check('vote_bundles_price_non_negative', sql`${t.priceMinor} >= 0`),
  ]
)

export const voteBundlesRelations = relations(voteBundles, ({ one }) => ({
  contest: one(contests, {
    fields: [voteBundles.contestId],
    references: [contests.id],
  }),
}))

// ─── Vote credits ──────────────────────────────────────────────────────────

// What a buyer has bought and what they have spent, one row per (contest,
// voter). Credits are spendable anywhere in the contest, so the balance is
// held here and not per category.
//
// Spending is a conditional UPDATE — `SET spent = spent + n WHERE spent + n <=
// purchased` — the oversell guard ticket tiers use. A zero-row result means
// "not enough credits", decided by the database with no read-then-write window
// for two concurrent votes to slip through.
export const voteCredits = pgTable(
  'vote_credits',
  {
    id: text('id').primaryKey(),
    contestId: text('contest_id')
      .notNull()
      .references(() => contests.id, {
        onDelete: 'cascade',
        onUpdate: 'cascade',
      }),
    // Lower-cased email: the identity a vote hangs on whether or not the voter
    // has an account. Paid voting does not require one.
    voterEmail: text('voter_email').notNull(),
    voterUserId: text('voter_user_id').references(() => user.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    purchased: integer('purchased').notNull().default(0),
    spent: integer('spent').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    // One balance per voter per contest; also the key fulfilment upserts on.
    uniqueIndex('vote_credits_owner_unique').on(t.contestId, t.voterEmail),
    check('vote_credits_purchased_non_negative', sql`${t.purchased} >= 0`),
    check('vote_credits_spent_non_negative', sql`${t.spent} >= 0`),
    // Nothing may spend credits it never bought, whatever the application does.
    check('vote_credits_not_overspent', sql`${t.spent} <= ${t.purchased}`),
  ]
)

export const voteCreditsRelations = relations(voteCredits, ({ one }) => ({
  contest: one(contests, {
    fields: [voteCredits.contestId],
    references: [contests.id],
  }),
  voter: one(user, {
    fields: [voteCredits.voterUserId],
    references: [user.id],
  }),
}))

// ─── Votes ─────────────────────────────────────────────────────────────────

export type VoteKind = 'free' | 'paid'

// The ledger every vote lands in, and the audit trail entries.voteCount is
// derived from. Both are written in one transaction.
export const votes = pgTable(
  'votes',
  {
    id: text('id').primaryKey(),
    contestId: text('contest_id')
      .notNull()
      .references(() => contests.id, {
        onDelete: 'cascade',
        onUpdate: 'cascade',
      }),
    categoryId: text('category_id')
      .notNull()
      .references(() => contestCategories.id, {
        onDelete: 'cascade',
        onUpdate: 'cascade',
      }),
    entryId: text('entry_id')
      .notNull()
      .references(() => entries.id, {
        onDelete: 'cascade',
        onUpdate: 'cascade',
      }),
    kind: text('kind').$type<VoteKind>().notNull(),
    voterEmail: text('voter_email').notNull(),
    voterUserId: text('voter_user_id').references(() => user.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    // Paid votes can be allocated several at a time; a free vote is always 1.
    quantity: integer('quantity').notNull().default(1),
    // Reserved, and in practice ALWAYS NULL. Credits pool: a voter's balance
    // may be the sum of several purchases, so no single order funds a given
    // cast and naming one would be a fiction. The money's audit trail is
    // `orders` plus `vote_credits.purchased`; this ledger records allocation,
    // not payment. Kept for a future non-pooled path rather than dropped.
    orderId: text('order_id'),
    // 'YYYY-MM-DD', the day this vote counts against — the bucket the free
    // allowance resets on. Written for every vote so the index below is total.
    votedOn: text('voted_on').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('votes_entry_idx').on(t.entryId),
    index('votes_contest_idx').on(t.contestId),
    index('votes_voter_idx').on(t.voterEmail, t.contestId),
    // THE free-vote rule: one per email, per category, per day. Partial, so
    // paid votes are unconstrained. Enforced here rather than by a check in
    // the resolver, so two simultaneous free votes cannot both pass a lookup
    // and both insert — the second fails on the index.
    uniqueIndex('votes_free_daily_unique')
      .on(t.categoryId, t.voterEmail, t.votedOn)
      .where(sql`${t.kind} = 'free'`),
    check('votes_quantity_positive', sql`${t.quantity} > 0`),
  ]
)

export const votesRelations = relations(votes, ({ one }) => ({
  contest: one(contests, {
    fields: [votes.contestId],
    references: [contests.id],
  }),
  category: one(contestCategories, {
    fields: [votes.categoryId],
    references: [contestCategories.id],
  }),
  entry: one(entries, {
    fields: [votes.entryId],
    references: [entries.id],
  }),
}))

// ─── Nominations ───────────────────────────────────────────────────────────

export type NominationStatus = 'pending' | 'approved' | 'rejected'

// The optional phase in front of voting: the public puts names forward, the
// organizer promotes the ones they accept into entries.
export const nominations = pgTable(
  'nominations',
  {
    id: text('id').primaryKey(),
    contestId: text('contest_id')
      .notNull()
      .references(() => contests.id, {
        onDelete: 'cascade',
        onUpdate: 'cascade',
      }),
    categoryId: text('category_id')
      .notNull()
      .references(() => contestCategories.id, {
        onDelete: 'cascade',
        onUpdate: 'cascade',
      }),
    nomineeName: text('nominee_name').notNull(),
    nomineeEmail: text('nominee_email'),
    nomineePhone: text('nominee_phone'),
    // Why this person deserves it, in the nominator's words.
    reason: text('reason').notNull().default(''),
    nominatedByEmail: text('nominated_by_email').notNull(),
    nominatedByUserId: text('nominated_by_user_id').references(() => user.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    status: text('status')
      .$type<NominationStatus>()
      .notNull()
      .default('pending'),
    // The entry this became, once promoted. A soft pointer, like
    // entries.submissionId.
    entryId: text('entry_id'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('nominations_contest_idx').on(t.contestId, t.status),
    index('nominations_category_idx').on(t.categoryId),
    // One person cannot nominate the same name twice in a category.
    uniqueIndex('nominations_one_per_nominator_unique').on(
      t.categoryId,
      t.nominatedByEmail,
      t.nomineeName
    ),
  ]
)

export const nominationsRelations = relations(nominations, ({ one }) => ({
  contest: one(contests, {
    fields: [nominations.contestId],
    references: [contests.id],
  }),
  category: one(contestCategories, {
    fields: [nominations.categoryId],
    references: [contestCategories.id],
  }),
}))

// ─── Free-vote email verification ──────────────────────────────────────────

// A free vote has to prove the email behind it. better-auth's emailOTP plugin
// verifies emails that belong to an ACCOUNT, which a casual voter does not
// have — so free voting carries its own one-time codes here.
//
// Only a hash of the code is stored: a leaked database row must not let anyone
// cast votes as somebody else.
export const voteOtps = pgTable(
  'vote_otps',
  {
    id: text('id').primaryKey(),
    contestId: text('contest_id')
      .notNull()
      .references(() => contests.id, {
        onDelete: 'cascade',
        onUpdate: 'cascade',
      }),
    email: text('email').notNull(),
    codeHash: text('code_hash').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    // Wrong guesses so far. The verify path refuses past a small limit, so a
    // six-digit code cannot be brute-forced.
    attempts: integer('attempts').notNull().default(0),
    consumedAt: timestamp('consumed_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('vote_otps_lookup_idx').on(t.email, t.contestId),
    // Sweeping expired codes.
    index('vote_otps_expires_idx').on(t.expiresAt),
    check('vote_otps_attempts_non_negative', sql`${t.attempts} >= 0`),
  ]
)

export const voteOtpsRelations = relations(voteOtps, ({ one }) => ({
  contest: one(contests, {
    fields: [voteOtps.contestId],
    references: [contests.id],
  }),
}))
