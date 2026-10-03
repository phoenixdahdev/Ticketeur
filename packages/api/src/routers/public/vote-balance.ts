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
// ── What it discloses, and why that is not new ──
// The identity a vote balance hangs on is the lower-cased email and nothing
// more: `castPaid` takes `{ contestId, entryId, voterEmail, quantity }` with
// no session and no code, so anyone who knows an address can already SPEND
// that address's credits. A read that only says how many are left is strictly
// less than what the mutation beside it already allows, and it is the same
// figure `castPaid` hands back. It is deliberately the whole surface: no name,
// no order, no purchase history, nothing that is not a count.
//
// Through `loadPublicContest`, so a draft, rejected or suspended contest
// cannot be probed for whether an address has credits in it — the one gate,
// not a second definition of "public".
export const publicVoteBalanceRouter = createTRPCRouter({
  // null — no such contest, or it isn't public. Otherwise the balance, which
  // is all zeroes for an address that has never bought anything (there is no
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
        purchased,
        spent,
        // Clamped, so a row that somehow went negative shows "nothing left"
        // rather than a negative number of votes on a public page.
        remaining: Math.max(0, purchased - spent),
      }
    }),
})

export type PublicVoteBalanceRouter = typeof publicVoteBalanceRouter
