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
import { sendVoteCode } from '../../lib/vote-emails'
import {
  issueVoteCode,
  verifyVoteCode,
  VOTE_CODE_TTL_MINUTES,
  MAX_VERIFY_ATTEMPTS,
  type VerifyVoteCodeFailure,
} from '../../lib/vote-otp'
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
//
// ── Buying is open; SPENDING is verified ───────────────────────────────────
// Those two sentences used to apply to both halves, and that was a hole: a
// balance keyed on an address that nobody ever proved meant anyone who knew
// your email could spend the votes you paid for. `castPaid` now takes a
// one-time code for `voterEmail`, from the same `vote_otps` machinery free
// voting and nominating use (lib/vote-otp.ts).
//
// `buyVotes` is deliberately left open. A completed Flutterwave charge proves
// itself, and credits land on the address the payer typed whether or not they
// own it — putting a code in front of the payment would cost sales to protect
// nothing, because fulfilment credits an address, it does not spend from one.
//
// ── The window of trust, stated plainly ────────────────────────────────────
// `castPaid` VERIFIES the code and does NOT consume it. That is the one place
// this path departs from `castFree` and `nominate`, and it is deliberate:
//
//   A voter who bought 500 votes to split across eight entries would otherwise
//   need eight codes, and `issueVoteCode` allows six an hour with a minute
//   between them. The spend would be rate-limited to less than the purchase.
//
// So a code is a short-lived bearer credential for spending in ONE contest,
// and its window is the code's own lifetime — nothing new was invented to
// hold it:
//   - at most VOTE_CODE_TTL_MINUTES (10) from issue, enforced by
//     verifyVoteCode's `expires_at > now`;
//   - at most MAX_VERIFY_ATTEMPTS (5) presentations, because verifyVoteCode
//     charges an attempt for a CORRECT guess too. The sixth is 'locked', and
//     PAID_CODE_FAILURE_MESSAGES says so in words a voter who did nothing
//     wrong can act on.
// Both are decided by the database, in `vote_otps`, by a module this one only
// calls. The browser keeps the code in memory for the life of the dialog, so
// a voter splitting a balance verifies once rather than once per entry.
//
// What that costs, stated rather than buried:
//   - an intercepted code is worth up to five casts in ten minutes instead of
//     one. A single cast can already spend an entire balance, so what this
//     adds is the ability to SPLIT a stolen balance, not to steal it.
//   - the code survives the cast, so it still verifies a free vote or a
//     nomination. `vote_otps` has no purpose column and the schema is frozen;
//     nominations.ts documents the same sharing in the other direction. The
//     difference here is that a paid cast no longer burns a voter's free-vote
//     code.
//   - what it does NOT cost: nothing is ever authorised by an email alone.
//     Trusting a recently consumed `vote_otps` row as a "verified session"
//     was the obvious alternative and was rejected for exactly that reason —
//     for the length of such a window the hole above would be open again to
//     anyone who knows the address.

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

/**
 * The free path's table, with one sentence changed.
 *
 * `locked` is reached here by a voter who did nothing wrong: five casts on one
 * code exhaust the attempt budget, because a correct guess costs an attempt
 * too. Telling them "too many incorrect codes" would be a lie about their own
 * behaviour, so this table says what actually happened and what to do.
 */
const PAID_CODE_FAILURE_MESSAGES: Record<VerifyVoteCodeFailure, string> = {
  no_code: 'Request a code first, then enter it here.',
  expired: 'That code has expired. Request a new one to keep voting.',
  consumed: 'That code has already been used. Request a new one.',
  locked: `A code covers ${MAX_VERIFY_ATTEMPTS} casts. Request a new one to keep spending your votes.`,
  wrong: "That code isn't right. Check the email and try again.",
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

const requestCodeInput = z.object({
  contestId: z.string(),
  email: z.email('Enter a valid email'),
})

const castPaidInput = z.object({
  contestId: z.string(),
  entryId: z.string(),
  voterEmail: z.email('Enter a valid email'),
  quantity: z.number().int().min(1).max(MAX_VOTES_PER_CAST).default(1),
  // Digits only, and the length the issuer actually mints. Checked here so an
  // obviously malformed code never costs an attempt — the same guard
  // castFree's input carries.
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code'),
})

export const publicVoteCheckoutRouter = createTRPCRouter({
  /**
   * Send a one-time code to an address so it can SPEND the votes held against
   * it. The paid twin of `voteFree.requestCode`, and it has to be a separate
   * procedure rather than a shared one: that one refuses a contest with
   * `freeVotingEnabled` off, which is exactly the contest a paid voter is
   * most likely to be standing in front of.
   *
   * ── Why `paidVotingEnabled` is NOT checked here ──
   * `castPaid` does not check it either, and must not: an organizer who stops
   * selling votes has not taken away the ones people already bought, and
   * credits that cannot be spent are money owed back. A code request that was
   * stricter than the spend it authorises would strand a paid balance behind
   * a gate the spend itself does not have. The voting WINDOW is checked,
   * because a closed contest takes no votes at all, so a code for one would
   * be an email promising something that cannot happen.
   *
   * ── No account enumeration ──
   * Never reads the `user` table, exactly as the other two issuers do not: an
   * address with a Ticketeur account and one without get the identical
   * answer. It also never reads `vote_credits` — answering differently for an
   * address that holds a balance would turn this into the balance oracle that
   * `voteBalance.byEmail` is deliberately careful about.
   *
   * The code is never returned. It exists in memory here, in the email, and
   * as a scrypt digest in `vote_otps`.
   */
  requestCode: publicProcedure
    .input(requestCodeInput)
    .mutation(async ({ ctx, input }) => {
      const found = await loadPublicContest(
        ctx.db,
        eq(contests.id, input.contestId)
      )
      if (!found) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Contest not found' })
      }
      const { contest, event } = found

      const availability = votingAvailability(contest)
      if (!availability.open) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: VOTING_CLOSED_MESSAGES[availability.reason],
        })
      }

      const email = normalizeVoterEmail(input.email)
      const issued = await issueVoteCode(ctx.db, {
        contestId: contest.id,
        email,
      })
      if (!issued.issued) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message:
            issued.reason === 'cooldown'
              ? `We've just sent a code to that address. Check your inbox, including spam, or try again in ${issued.retryAfterSeconds} seconds.`
              : 'Too many codes have been requested for that address. Please try again later.',
        })
      }

      // Never throws: the code is already stored, so a mail failure must not
      // become a refusal the voter would "fix" by asking for another one.
      //
      // ── A known rough edge, named rather than hidden ──
      // This reuses the free-vote code email, and that template says "cast
      // your free vote" and "one vote per category, per day"
      // (packages/email/emails/vote-code.tsx). A paid voter gets a working
      // code with a sentence that does not describe what they are about to
      // do. Fixing it properly means what nominating did: a second task and
      // template (see sendNominationCode), which only takes effect on a
      // Trigger.dev deploy — and a task id that is not deployed yet would
      // mint codes that never reach anybody, which is far worse than wrong
      // wording. So this deliberately uses the task that is already live.
      await sendVoteCode({
        email,
        code: issued.code,
        contestTitle: contest.title,
        eventTitle: event.title,
        contestUrl: `${getBaseUrl()}/contests/${contest.slug}`,
        purpose: 'paid_vote',
      })

      return {
        sent: true,
        expiresAt: issued.expiresAt,
        expiresInMinutes: VOTE_CODE_TTL_MINUTES,
        // How many casts this one code is good for, so the dialog can say so
        // before the voter runs into it. The server's own constant, not a
        // number the UI guessed.
        castsPerCode: MAX_VERIFY_ATTEMPTS,
      }
    }),

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
   * contest, when the code does not prove `voterEmail`, and when the balance
   * will not cover it.
   *
   * The checks above the transaction are there to give the voter a reason.
   * The ones that MATTER are inside it, decided by the database in single
   * statements that cannot be raced:
   *   - spendVoteCredits' `spent + n <= purchased`;
   *   - castVotes' UPDATE on (id, contestId, categoryId, status='active').
   * Credits are spent BEFORE the vote is cast, and a refused cast throws, so
   * the rollback hands the credits straight back — a voter is never charged
   * credits for a vote that did not land.
   *
   * ── The order of the checks is not arbitrary ──
   * The ENTRY is read before the code is verified, so a page that went stale
   * while somebody was reading it costs them a refusal rather than one of
   * their five casts. The CODE is verified before the transaction, which is
   * where the balance is touched — so an unverified caller can never learn
   * from this procedure whether an address holds credits, and so
   * verifyVoteCode runs on `ctx.db` rather than a transaction handle, which
   * is the one rule lib/vote-otp.ts asks of a caller.
   *
   * ── consumeVoteCode is deliberately not called ──
   * See the window-of-trust note at the top of this file. In short: the code
   * is the credential for the whole spending session, the session is bounded
   * by the code's own expiry and attempt budget, and consuming it would make
   * a voter ask for a new code between every entry they split a balance
   * across.
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

      // The proof that whoever is spending this balance can read the mailbox
      // it hangs on. OUTSIDE the transaction below, deliberately: this spends
      // one of the code's attempts, and that spend has to commit even when
      // the cast that follows is refused. See verifyVoteCode.
      //
      // The code is bound to (contestId, email) by its own preimage AND by
      // the WHERE clause that claims it, so a code minted for another contest
      // — or for another address in this one — cannot authorise this spend.
      const verified = await verifyVoteCode(ctx.db, {
        contestId: contest.id,
        email: voterEmail,
        code: input.code,
      })
      if (!verified.ok) {
        throw new TRPCError({
          code:
            verified.reason === 'locked' ? 'TOO_MANY_REQUESTS' : 'UNAUTHORIZED',
          message: PAID_CODE_FAILURE_MESSAGES[verified.reason],
        })
      }

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
