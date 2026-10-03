import { and, asc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'

import { contests, events } from '@ticketur/db'

import { createTRPCRouter, publicProcedure } from '../../trpc'
import { votingAvailability } from '../../lib/votes'
import { loadPublicContest } from './contests'

// Finding a contest without being sent the link.
//
// ── Why this exists ──
// A published contest was reachable only by someone who already had
// /contests/{slug}: nothing on the platform listed one. `bySlug` resolves a
// contest you can already name, and `public.events.bySlug` says nothing about
// contests, so an event page could not offer the voting its own organizer had
// opened. This is the one read that closes that, and it returns nothing a
// voter could not see by opening the contest page itself.
//
// ── One definition of "public", not two ──
// The gate is `loadPublicContest`, called per contest, exactly as `bySlug`
// and `buyVotes` call it. It takes a `SQL` match and returns at most one row,
// so this reads the candidate ids first and then puts each through the real
// gate — rather than copying its conditions into a list query, which is the
// drift its own comment warns about. A status added to that allow-list later,
// or a new rule about banned organizers, applies here for free.
//
// The candidate query is cheap (`contests_event_idx`), and the loop is capped:
// an event with more contests than this has bigger problems than a truncated
// list.
const MAX_CONTESTS_PER_EVENT = 10

export const publicContestDiscoveryRouter = createTRPCRouter({
  /**
   * The contests on an event that the public may see, oldest first.
   *
   * An empty list for an event with none, an event that isn't public, or an
   * event that does not exist — all the same answer, because none of them
   * should tell a stranger which of the three it was.
   */
  forEvent: publicProcedure
    .input(z.object({ eventSlug: z.string() }))
    .query(async ({ ctx, input }) => {
      // Narrowing only. Everything that decides visibility is in the gate
      // below; this just avoids putting every contest on the platform
      // through it.
      const candidates = await ctx.db
        .select({ id: contests.id })
        .from(contests)
        .innerJoin(events, eq(events.id, contests.eventId))
        .where(
          and(
            eq(events.slug, input.eventSlug),
            inArray(contests.status, ['published', 'closed'])
          )
        )
        .orderBy(asc(contests.createdAt), asc(contests.id))
        .limit(MAX_CONTESTS_PER_EVENT)

      const visible = []
      for (const candidate of candidates) {
        const found = await loadPublicContest(
          ctx.db,
          eq(contests.id, candidate.id)
        )
        if (!found) continue
        const { contest } = found
        visible.push({
          slug: contest.slug,
          title: contest.title,
          description: contest.description,
          status: contest.status,
          votingOpensAt: contest.votingOpensAt,
          votingClosesAt: contest.votingClosesAt,
          // The same read-time rule the contest page shows, so a card saying
          // "voting is open" and the page it links to cannot disagree.
          voting: votingAvailability(contest),
        })
      }
      return visible
    }),
})

export type PublicContestDiscoveryRouter = typeof publicContestDiscoveryRouter
