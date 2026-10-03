import { TRPCError } from '@trpc/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

import { contests, entries, orders, voteBundles } from '@ticketur/db'

import { createTRPCRouter, publicProcedure } from '../../trpc'
import { getBaseUrl } from '../../lib/base-url'
import { calculateFeeMinor } from '../../lib/fees'
import { createPayment } from '../../lib/flutterwave'
import { newId } from '../../lib/ids'
import { PAYMENT_CURRENCY, toFlutterwaveAmount } from '../../lib/payment-amount'
import { getFeeRates } from '../../lib/platform-settings'
import {
  castVotes,
  normalizeVoterEmail,
  spendVoteCredits,
  voteDay,
  votingAvailability,
  type VotingClosedReason,
} from '../../lib/votes'
import { loadPublicContest } from './contests'

// Buying votes, and spending them.
//
// Two steps on purpose, because that is what the data model says: a purchase
// grants a BALANCE for the contest (vote_credits), and the voter decides where
// it goes afterwards. So `buyVotes` never names an entry and `castPaid` never
// takes money.
//
// Signing in is NOT required. Paid voting is for the public — the identity a
// balance hangs on is the lower-cased email, and that is all it needs.

// Enough that nobody is blocked, small enough that
// `pricePerVoteMinor * votes` cannot approach the int4 ceiling on any sane
// price.
const MAX_LOOSE_VOTES_PER_ORDER = 10_000
// One cast is one allocation; a voter with more credits simply casts again.
const MAX_VOTES_PER_CAST = 1_000
// `orders.subtotal_minor`/`total_minor` are int4 (max 2,147,483,647 kobo =
// ₦21.4m). Refuse well short of it rather than let Postgres raise mid-order.
const MAX_ORDER_TOTAL_MINOR = 2_000_000_000

const VOTING_CLOSED_MESSAGES: Record<VotingClosedReason, string> = {
  not_published: 'This contest is not open for voting.',
  not_open_yet: 'Voting has not opened for this contest yet.',
  closed: 'Voting has closed for this contest.',
}

const buyVotesInput = z
  .object({
    contestId: z.string(),
    // Exactly one of these. A bundle is the priced pack; `votes` buys loose
    // votes at the contest's own per-vote price.
    bundleId: z.string().nullable().default(null),
    votes: z
      .number()
      .int()
      .min(1)
      .max(MAX_LOOSE_VOTES_PER_ORDER)
      .nullable()
      .default(null),
    voterName: z.string().trim().min(1, 'Name required'),
    voterEmail: z.email('Enter a valid email'),
  })
  .superRefine((v, ctx) => {
    if ((v.bundleId !== null) === (v.votes !== null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['bundleId'],
        message: 'Choose a vote bundle, or a number of votes to buy.',
      })
    }
  })

const castPaidInput = z.object({
  contestId: z.string(),
  entryId: z.string(),
  voterEmail: z.email('Enter a valid email'),
  quantity: z.number().int().min(1).max(MAX_VOTES_PER_CAST).default(1),
})

export const publicVoteCheckoutRouter = createTRPCRouter({
  /**
   * Buy votes: creates a `vote_purchase` order and a Flutterwave link for it.
   *
   * ── The voter bears the service fee, and sees it ──
   * subtotal = the bundle's price (or the contest's per-vote price × how many
   * loose votes), fee = calculateFeeMinor(subtotal, rates.vote), total =
   * subtotal + fee. Exactly how a ticket buyer and a form applicant are
   * charged.
   *
   * The rate is read HERE, server-side, once, and used for both the order row
   * and the Flutterwave request, so the two cannot be computed from different
   * rates. Whatever rate the voter's page was showing is irrelevant: this
   * input carries no money, so a stale rate in an open tab can make the
   * preview wrong but never the charge. What is written to the order is a
   * SNAPSHOT — a later change to the vote rate cannot touch this order, its
   * receipt, or the amount its pending payment link is for.
   *
   * Nothing is granted here. fulfillOrder grants the credits once Flutterwave
   * confirms a charge that pays `totalMinor` (see lib/votes.ts).
   */
  buyVotes: publicProcedure
    .input(buyVotesInput)
    .mutation(async ({ ctx, input }) => {
      const found = await loadPublicContest(
        ctx.db,
        eq(contests.id, input.contestId)
      )
      if (!found) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Contest not found' })
      }
      const { contest, event } = found

      // A 'closed' contest still resolves above (its results stay public) and
      // must not sell votes; votingAvailability says so, and says why.
      const availability = votingAvailability(contest)
      if (!availability.open) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: VOTING_CLOSED_MESSAGES[availability.reason],
        })
      }
      if (!contest.paidVotingEnabled) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This contest does not sell votes.',
        })
      }

      // What is being bought, and for how much — in MINOR units throughout,
      // with integer arithmetic only.
      let votesBought: number
      let subtotalMinor: number
      let description: string

      if (input.bundleId !== null) {
        const [bundle] = await ctx.db
          .select({
            label: voteBundles.label,
            votes: voteBundles.votes,
            priceMinor: voteBundles.priceMinor,
          })
          .from(voteBundles)
          .where(
            and(
              eq(voteBundles.id, input.bundleId),
              // Pinned to THIS contest, so a bundle id from a cheaper contest
              // cannot be used to buy credits here.
              eq(voteBundles.contestId, contest.id),
              eq(voteBundles.active, true)
            )
          )
          .limit(1)
        if (!bundle) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'That vote bundle is not available.',
          })
        }
        votesBought = bundle.votes
        subtotalMinor = bundle.priceMinor
        description = `${contest.title}: ${bundle.label}`
      } else {
        // Narrowing for TypeScript; superRefine has already rejected the case
        // where neither was given.
        const loose = input.votes
        if (loose === null) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Choose a vote bundle, or a number of votes to buy.',
          })
        }
        if (contest.pricePerVoteMinor <= 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'This contest sells votes in bundles only.',
          })
        }
        votesBought = loose
        subtotalMinor = contest.pricePerVoteMinor * loose
        description = `${contest.title}: ${loose} vote${loose === 1 ? '' : 's'}`
      }

      if (subtotalMinor <= 0) {
        // A zero-priced bundle is not a paid purchase: there is nothing to
        // charge, and granting credits for free here would route around the
        // free-vote allowance and its email verification.
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'These votes are not for sale.',
        })
      }

      const feeBps = (await getFeeRates(ctx.db)).vote
      const feeMinor = calculateFeeMinor(subtotalMinor, feeBps)
      const totalMinor = subtotalMinor + feeMinor
      if (totalMinor > MAX_ORDER_TOTAL_MINOR) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'That is more votes than can be bought in one payment.',
        })
      }

      const voterEmail = normalizeVoterEmail(input.voterEmail)
      // The credits are keyed on the email, so the account is attached only
      // when the signed-in voter is buying for themselves. Buying for someone
      // else's email is allowed and lands in THEIR balance — attaching the
      // payer's account to it would make the balance look like the payer's.
      const voterUserId =
        ctx.session &&
        normalizeVoterEmail(ctx.session.user.email) === voterEmail
          ? ctx.session.user.id
          : null

      const orderId = newId('ord')
      const txRef = `vote_${orderId}_${Date.now()}`

      await ctx.db.insert(orders).values({
        id: orderId,
        type: 'vote_purchase',
        // The CONTEST the credits are for. Not an entry: buying grants a
        // balance, and the voter picks entries afterwards.
        referenceId: contest.id,
        eventId: event.id,
        tierId: null,
        buyerId: voterUserId,
        buyerEmail: voterEmail,
        buyerName: input.voterName,
        // The number of VOTES this order buys. Fulfilment reads it straight
        // off the order rather than re-reading the bundle, so editing or
        // retiring the bundle mid-payment cannot change what was bought.
        quantity: votesBought,
        subtotalMinor,
        discountMinor: 0,
        feeMinor,
        totalMinor,
        status: 'pending',
        flwTxRef: txRef,
      })

      let paymentUrl: string
      try {
        const { link } = await createPayment({
          txRef,
          // The ORDER's total — bundle price plus the service fee — through
          // the same helper fulfilment verifies the charge against, so what
          // we ask for and what we accept cannot drift. fulfillOrder checks a
          // charge against orders.totalMinor, so asking for anything less
          // here would make every vote purchase land as underpaid.
          amount: toFlutterwaveAmount(totalMinor),
          currency: PAYMENT_CURRENCY,
          redirectUrl: `${getBaseUrl()}/checkout/return`,
          customer: { email: voterEmail, name: input.voterName },
          meta: {
            orderId,
            contestId: contest.id,
            eventId: event.id,
            votes: votesBought,
          },
          customizations: { title: event.title, description },
        })
        paymentUrl = link
      } catch (err) {
        console.error('[votes] could not start the vote payment', {
          orderId,
          contestId: contest.id,
          error: err,
        })
        // No link reached the voter, so nothing can be paid on this order.
        // Fail it now rather than leave the reconciliation job chasing a
        // tx_ref Flutterwave never heard of. Conditional on 'pending', and
        // harmless if a link did somehow get created: fulfillOrder still
        // fulfils an order from 'failed' when a good charge turns up.
        try {
          await ctx.db
            .update(orders)
            .set({ status: 'failed' })
            .where(and(eq(orders.id, orderId), eq(orders.status, 'pending')))
        } catch (failErr) {
          console.error('[votes] could not fail an unstarted vote payment', {
            orderId,
            error: failErr,
          })
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: "We couldn't start the payment. Please try again.",
        })
      }

      return {
        orderId,
        // What was bought and what it costs. These come from the order row's
        // own figures, so they are the amounts actually charged.
        votes: votesBought,
        subtotalMinor,
        feeMinor,
        totalMinor,
        // Basis points, for the receipt line. The rate this order was priced
        // at, not whatever is configured when the receipt is read.
        serviceFeeBps: feeBps,
        paymentUrl,
      }
    }),

  /**
   * Spend credits on an entry.
   *
   * Refuses when the contest is not published, when voting is outside its
   * window, when the entry is not `active`, when the entry belongs to another
   * contest, and when the balance will not cover it.
   *
   * The checks above the transaction are there to give the voter a reason.
   * The ones that MATTER are inside it, decided by the database in single
   * statements that cannot be raced:
   *   - spendVoteCredits' `spent + n <= purchased`;
   *   - castVotes' UPDATE on (id, contestId, categoryId, status='active').
   * Credits are spent BEFORE the vote is cast, and a refused cast throws, so
   * the rollback hands the credits straight back — a voter is never charged
   * credits for a vote that did not land.
   */
  castPaid: publicProcedure
    .input(castPaidInput)
    .mutation(async ({ ctx, input }) => {
      const found = await loadPublicContest(
        ctx.db,
        eq(contests.id, input.contestId)
      )
      if (!found) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Contest not found' })
      }
      const { contest } = found

      const availability = votingAvailability(contest)
      if (!availability.open) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: VOTING_CLOSED_MESSAGES[availability.reason],
        })
      }

      // Read for the entry's CATEGORY, which the caller does not get to
      // choose — taking it from the input would let a vote be filed under a
      // category the entry is not in. Pinned to this contest so a cross-
      // contest entry id is refused with something the voter can act on;
      // castVotes re-checks all of it race-safely inside the transaction.
      const [entry] = await ctx.db
        .select({
          id: entries.id,
          categoryId: entries.categoryId,
          status: entries.status,
          displayName: entries.displayName,
        })
        .from(entries)
        .where(
          and(eq(entries.id, input.entryId), eq(entries.contestId, contest.id))
        )
        .limit(1)
      if (!entry) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'That entry is not in this contest.',
        })
      }
      if (entry.status !== 'active') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `${entry.displayName} is no longer taking votes.`,
        })
      }

      const voterEmail = normalizeVoterEmail(input.voterEmail)
      const voterUserId =
        ctx.session &&
        normalizeVoterEmail(ctx.session.user.email) === voterEmail
          ? ctx.session.user.id
          : null
      // The contest's own zone, not the server's: a Nigerian contest's free
      // vote resets at local midnight (see voteDay in lib/votes.ts).
      const votedOn = voteDay(contest.timeZone)

      return ctx.db.transaction(async (tx) => {
        const spend = await spendVoteCredits(tx, {
          contestId: contest.id,
          voterEmail,
          count: input.quantity,
        })
        if (!spend.ok) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message:
              'You do not have enough vote credits for this contest. Buy more to keep voting.',
          })
        }

        const cast = await castVotes(tx, {
          contestId: contest.id,
          categoryId: entry.categoryId,
          entryId: entry.id,
          kind: 'paid',
          voterEmail,
          voterUserId,
          quantity: input.quantity,
          // Credits pool across purchases, so no single order funded this
          // vote; the money trail is vote_credits plus the vote_purchase
          // orders carrying this contest in referenceId. See castVotes.
          orderId: null,
          votedOn,
        })
        if (!cast.ok) {
          // The entry was withdrawn or disqualified between the read above
          // and this statement. The throw rolls the spend back with it.
          throw new TRPCError({
            code: 'CONFLICT',
            message: `${entry.displayName} is no longer taking votes.`,
          })
        }

        return {
          voteId: cast.voteId,
          entryId: entry.id,
          categoryId: entry.categoryId,
          quantity: input.quantity,
          // The entry's running total, and what is left to spend.
          voteCount: cast.voteCount,
          creditsRemaining: spend.remaining,
        }
      })
    }),
})

export type PublicVoteCheckoutRouter = typeof publicVoteCheckoutRouter
