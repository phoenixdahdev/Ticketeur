import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

import { contests, voteCredits } from '@ticketur/db'

import { createTRPCRouter, publicProcedure } from '../../trpc'
import { normalizeVoterEmail } from '../../lib/votes'
import { loadPublicContest } from './contests'

// How many bought votes a voter has left to spend.
//
// ── Why this exists ──
// `buyVotes` grants a BALANCE and `castPaid` spends from it, and `castPaid`
// reports what is left AFTERWARDS. Nothing reads the balance BEFORE a cast, so
// a voter arriving on /contests/{slug} from the Flutterwave return page — the
// page that says "You have N votes to cast" — had no way to be shown what they
// are holding. This is the read that closes that, and it does nothing else:
// no mutation, no money, no new column.
//
// ── Why this is still public, now that castPaid is not ──
// This procedure used to lean on the hole: "anyone who knows an address can
// already SPEND that address's credits, so a read of the count discloses
// strictly less". `castPaid` now demands a one-time code, so that argument is
// gone and this one has to stand on its own feet. It does, for three reasons:
//
//   1. It cannot be turned into a spend. The only thing it emits is a number,
//      and the mutation beside it no longer accepts anything this returns.
//   2. Gating it would put the verification in front of the INFORMATION
//      rather than in front of the spend — a voter back from Flutterwave
//      could not be told what they had just paid for until they fetched a
//      code for a page that is only going to say "37". Codes are rationed six
//      an hour and a read must not eat one.
//   3. The caller must already know the address. There is no listing here, no
//      search, no "who holds credits in this contest".
//
// ── What was narrowed ──
// The response is now the REMAINING count alone. `purchased` and `spent` were
// a lifetime spend figure for an address in a contest — "this campaign has
// bought 4,000 votes" is the one genuinely sensitive thing a count can carry,
// nobody rendered it, and a public read should not offer what nothing asked
// for.
//
// The disclosure that remains, named rather than buried: someone who knows
// both a contest and an address learns how many unspent votes that address is
// holding, and therefore that it bought some. That is an unauthenticated
// privacy leak of a purchase fact, and the price of showing a guest voter
// their own balance without an account. It is the whole surface: no name, no
// order, no history, nothing that is not a count.
//
// Through `loadPublicContest`, so a draft, rejected or suspended contest
// cannot be probed for whether an address has credits in it — the one gate,
// not a second definition of "public".
export const publicVoteBalanceRouter = createTRPCRouter({
  // null — no such contest, or it isn't public. Otherwise the balance, which
  // is zero for an address that has never bought anything (there is no
  // vote_credits row until a purchase is fulfilled, and "never bought" and
  // "bought and spent it all" are the same answer to the voter: nothing left).
  byEmail: publicProcedure
    .input(
      z.object({
        contestId: z.string(),
        voterEmail: z.email('Enter a valid email'),
      })
    )
    .query(async ({ ctx, input }) => {
      const found = await loadPublicContest(
        ctx.db,
        eq(contests.id, input.contestId)
      )
      if (!found) return null

      // The SAME normalisation the grant and the spend use. The unique index
      // is on the raw column, so looking up anything else would report an
      // empty balance for credits the voter really holds.
      const voterEmail = normalizeVoterEmail(input.voterEmail)

      const [row] = await ctx.db
        .select({
          purchased: voteCredits.purchased,
          spent: voteCredits.spent,
        })
        .from(voteCredits)
        .where(
          and(
            eq(voteCredits.contestId, found.contest.id),
            eq(voteCredits.voterEmail, voterEmail)
          )
        )
        .limit(1)

      const purchased = row?.purchased ?? 0
      const spent = row?.spent ?? 0
      return {
        // Clamped, so a row that somehow went negative shows "nothing left"
        // rather than a negative number of votes on a public page. The two
        // figures it is derived from stay on the server — see the note above.
        remaining: Math.max(0, purchased - spent),
      }
    }),
})

export type PublicVoteBalanceRouter = typeof publicVoteBalanceRouter
