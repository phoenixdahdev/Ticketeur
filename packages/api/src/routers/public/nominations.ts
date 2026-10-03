import { TRPCError } from '@trpc/server'
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'

import { contestCategories, contests, nominations } from '@ticketur/db'

import { createTRPCRouter, publicProcedure } from '../../trpc'
import { getBaseUrl } from '../../lib/base-url'
import { isUniqueViolation } from '../../lib/contests'
import { newId } from '../../lib/ids'
import { sendNominationCode } from '../../lib/nomination-emails'
import {
  MAX_EMAIL,
  MAX_NOMINATION_REASON,
  MAX_NOMINATIONS_PER_NOMINATOR_PER_CATEGORY,
  MAX_NOMINEE_NAME,
  MAX_PHONE,
  nominationAvailability,
  NOMINATION_NOMINATOR_INDEX,
  normalizeNomineeName,
  type NominationsClosedReason,
} from '../../lib/nominations'
import {
  consumeVoteCode,
  issueVoteCode,
  verifyVoteCode,
  VOTE_CODE_TTL_MINUTES,
  type VerifyVoteCodeFailure,
} from '../../lib/vote-otp'
import { normalizeVoterEmail } from '../../lib/votes'
import { loadPublicContest } from './contests'

// Nominating: the public phase in front of voting.
//
// Two steps, the same two free voting has, because the problem is the same
// one: this is an UNAUTHENTICATED write that stores free text somebody else
// has to read, and the address it is filed under decides whether the only
// duplicate rule in the schema works at all.
//   requestCode — mints a one-time code and emails it (lib/vote-otp.ts).
//   nominate    — takes the code and the name, and stores the nomination.
//
// ── Why a nominator proves their address ──
// `nominations_one_per_nominator_unique` is on
// (category_id, nominated_by_email, nominee_name). That index is the whole
// of the platform's protection against one person putting the same name
// forward over and over — and it keys on an address the nominator TYPES. If
// the address is never proved, the index is decorative: a flooder types a
// new fake address each time and the database happily takes every row.
// Proving the address is what gives the index teeth, and it is the same call
// the free-vote path made, for a weaker reason (one vote per day) than this
// one.
//
// What that buys, concretely, per (address, contest):
//   - a code costs an email to an address the sender controls;
//   - `issueVoteCode` allows one code a minute and six an hour;
//   - a code is single use, so six codes is six nominations an hour;
//   - the unique index refuses the same name twice in a category however
//     many codes they hold;
//   - MAX_NOMINATIONS_PER_NOMINATOR_PER_CATEGORY caps the different names
//     one address may put in one category at all.
// The ceiling on an attacker with one mailbox is therefore five names per
// category, and getting past it costs a fresh mailbox per five.
//
// ── The codes are shared with free voting, deliberately ──
// `vote_otps` is scoped per (contest, email) and carries no purpose column —
// the schema is frozen, and this is the honest consequence: a code minted
// here will verify a free vote, and a code minted there will verify a
// nomination. That is acceptable because both prove the identical fact, that
// this address is real and the person asking controls it; neither is an
// authorisation to do a particular thing. What it DOES cost is the shared
// budget: six codes an hour covers nominating AND free voting together, so a
// voter who nominates three times has three free votes' worth of codes left.
// Priced in rather than worked around, because working around it would mean
// weakening single use.
//
// ── Lock order ──
// vote_otps → nominations. Nothing else in the codebase locks `nominations`,
// and this path touches neither `entries` nor `vote_credits`, so it cannot
// deadlock against either voting path. Promotion (the organizer's side) runs
// contests → contest_categories → entries → nominations, which puts
// `nominations` last there too.

const CLOSED_MESSAGES: Record<NominationsClosedReason, string> = {
  no_phase: 'This contest does not take nominations.',
  not_published: 'This contest is not open for nominations.',
  not_open_yet: 'Nominations have not opened for this contest yet.',
  closed: 'Nominations have closed for this contest.',
}

const CODE_FAILURE_MESSAGES: Record<VerifyVoteCodeFailure, string> = {
  no_code: 'Request a code first, then enter it here.',
  expired: 'That code has expired. Request a new one.',
  consumed: 'That code has already been used. Request a new one.',
  locked: 'Too many incorrect codes. Request a new one to try again.',
  wrong: "That code isn't right. Check the email and try again.",
}

const ALREADY_NOMINATED_MESSAGE =
  "You've already nominated them in this category. One nomination each is all it takes — the organizer sees it."

const requestCodeInput = z.object({
  contestId: z.string(),
  email: z.email('Enter a valid email').max(MAX_EMAIL),
})

// Every free-text field is capped. This is an unauthenticated write whose
// contents land in an organizer's dashboard, so the sizes are the ones the
// ballot can actually carry (the name) or the ones a human will actually
// read (the reason) — not whatever fits in a `text` column.
const nominateInput = z.object({
  contestId: z.string(),
  categoryId: z.string(),
  nomineeName: z.string().trim().min(1).max(MAX_NOMINEE_NAME),
  // The nominee's own contact details, so the organizer can reach somebody
  // who has not heard they were nominated. Both optional: a nominator often
  // does not have them, and demanding them would turn a nomination into an
  // interrogation.
  nomineeEmail: z
    .union([z.email(), z.literal('')])
    .nullable()
    .default(null)
    .transform((value) => (value === '' ? null : value)),
  nomineePhone: z
    .string()
    .trim()
    .max(MAX_PHONE)
    .nullable()
    .default(null)
    .transform((value) => (value === '' ? null : value)),
  reason: z.string().trim().max(MAX_NOMINATION_REASON).default(''),
  // The nominator. The address the one-time code went to, and the one the
  // unique index files this under.
  email: z.email('Enter a valid email').max(MAX_EMAIL),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code'),
})

export const publicNominationsRouter = createTRPCRouter({
  /**
   * Send a one-time code to an address so it can nominate.
   *
   * ── No account enumeration ──
   * Never reads the `user` table, exactly as `voteFree.requestCode` does not:
   * an address with a Ticketeur account and one without get the identical
   * answer.
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

      // The window is checked here as well as on `nominate`, so nobody is
      // emailed a code for a phase that has not started or has finished.
      const availability = nominationAvailability(contest)
      if (!availability.open) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: CLOSED_MESSAGES[availability.reason],
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
      // become a refusal they would "fix" by asking for another one.
      await sendNominationCode({
        email,
        code: issued.code,
        contestTitle: contest.title,
        eventTitle: event.title,
        contestUrl: `${getBaseUrl()}/contests/${contest.slug}`,
      })

      return {
        sent: true,
        expiresAt: issued.expiresAt,
        expiresInMinutes: VOTE_CODE_TTL_MINUTES,
      }
    }),

  /**
   * Put a name forward.
   *
   * Refused when the contest is not one the public may see, when it has no
   * nomination phase at all, when the phase has not opened or has closed,
   * when the category is not in this contest, when the code is wrong,
   * expired, consumed or out of attempts, when this address has already put
   * five names into this category, and when this address has already
   * nominated this exact name here.
   *
   * ── Where each guarantee lives ──
   *   the contest is publicly visible → `loadPublicContest`, the SAME
   *     allow-list the public page and every vote path go through.
   *   the window → `nominationAvailability`, the one definition this and the
   *     public page both read.
   *   one nominator, one name, one category → the unique index
   *     `nominations_one_per_nominator_unique`. NOT a lookup before the
   *     insert: two clicks arriving together both pass a lookup, and the
   *     second still fails on the index. Caught and turned into a sentence.
   *   the address is real → `verifyVoteCode`, which is also what makes the
   *     index above worth having.
   *
   * ── The order of the checks is not arbitrary ──
   * The code is verified BEFORE the per-category count is read, for the
   * reason `castFree` verifies before checking the day: the other way round
   * would let anyone ask this procedure how many names a given address has
   * put forward, without proving anything.
   */
  nominate: publicProcedure
    .input(nominateInput)
    .mutation(async ({ ctx, input }) => {
      const found = await loadPublicContest(
        ctx.db,
        eq(contests.id, input.contestId)
      )
      if (!found) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Contest not found' })
      }
      const { contest } = found

      const availability = nominationAvailability(contest)
      if (!availability.open) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: CLOSED_MESSAGES[availability.reason],
        })
      }

      // Pinned to this contest, so a category id lifted from another
      // contest's page is refused rather than filed under the wrong contest.
      // Read before the code is verified, because a mistyped category should
      // not cost somebody their one-use code.
      const [category] = await ctx.db
        .select({ id: contestCategories.id, title: contestCategories.title })
        .from(contestCategories)
        .where(
          and(
            eq(contestCategories.id, input.categoryId),
            eq(contestCategories.contestId, contest.id)
          )
        )
        .limit(1)
      if (!category) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'That category is not in this contest.',
        })
      }

      const email = normalizeVoterEmail(input.email)
      const nomineeName = normalizeNomineeName(input.nomineeName)
      if (nomineeName === '') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Give the name of the person you are nominating.',
        })
      }

      // OUTSIDE the transaction below, deliberately: this spends one of the
      // code's attempts, and that spend has to commit even when the
      // nomination that follows is refused. See verifyVoteCode.
      const verified = await verifyVoteCode(ctx.db, {
        contestId: contest.id,
        email,
        code: input.code,
      })
      if (!verified.ok) {
        throw new TRPCError({
          code:
            verified.reason === 'locked' ? 'TOO_MANY_REQUESTS' : 'UNAUTHORIZED',
          message: CODE_FAILURE_MESSAGES[verified.reason],
        })
      }

      // How many DIFFERENT names this address has already put into this
      // category. Honest about its own race — see the constant's comment.
      const [existing] = await ctx.db
        .select({ total: sql<number>`count(*)::int` })
        .from(nominations)
        .where(
          and(
            eq(nominations.categoryId, category.id),
            eq(nominations.nominatedByEmail, email)
          )
        )
      if (
        (existing?.total ?? 0) >= MAX_NOMINATIONS_PER_NOMINATOR_PER_CATEGORY
      ) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: `You've already put ${MAX_NOMINATIONS_PER_NOMINATOR_PER_CATEGORY} names forward in ${category.title}. That is as many as one person can nominate in a category.`,
        })
      }

      const nominatedByUserId =
        ctx.session && normalizeVoterEmail(ctx.session.user.email) === email
          ? ctx.session.user.id
          : null

      const id = newId('nom')

      try {
        return await ctx.db.transaction(async (tx) => {
          // vote_otps first, then nominations — the lock order this module's
          // header sets out.
          const spent = await consumeVoteCode(tx, { otpId: verified.otpId })
          if (!spent) {
            // Another request holding the same code got there first, or it
            // expired in the moments since it verified.
            throw new TRPCError({
              code: 'UNAUTHORIZED',
              message: CODE_FAILURE_MESSAGES.consumed,
            })
          }

          await tx.insert(nominations).values({
            id,
            contestId: contest.id,
            categoryId: category.id,
            nomineeName,
            nomineeEmail: input.nomineeEmail,
            nomineePhone: input.nomineePhone,
            reason: input.reason,
            nominatedByEmail: email,
            nominatedByUserId,
            status: 'pending',
            // Set only when the organizer promotes it.
            entryId: null,
          })

          return {
            id,
            categoryId: category.id,
            categoryTitle: category.title,
            nomineeName,
            status: 'pending' as const,
          }
        })
      } catch (err) {
        // The index refusing the same nominator the same name in the same
        // category. A clean "you already did that", not a 500 — and the
        // rollback has handed their code back, so nothing was spent on it.
        if (isUniqueViolation(err, NOMINATION_NOMINATOR_INDEX)) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: ALREADY_NOMINATED_MESSAGE,
          })
        }
        throw err
      }
    }),
})

export type PublicNominationsRouter = typeof publicNominationsRouter
