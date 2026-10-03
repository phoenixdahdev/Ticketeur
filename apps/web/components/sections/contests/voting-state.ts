import { formatLongDate } from '@/lib/date'
import type {
  ContestSummary,
  VotingAvailability,
} from '@/components/sections/contests/types'

// The words for every state this page can be in, in one place.
//
// `voting` is decided by the SERVER (`votingAvailability` in
// packages/api/src/lib/votes.ts) and travels on the bySlug read. It is not
// recomputed here: that function reads the database client, so it cannot be
// bundled for a browser, and a second copy of the rule in the UI is exactly
// the drift its comment warns about. A tab left open past the closing time
// therefore shows "open" until the next refetch — and the cast is refused by
// the server with its own words, which this page renders. The query polls
// while voting is open (see contest-page-content.tsx), so that window is
// seconds, not hours.

export type VotingTone = 'open' | 'waiting' | 'ended'

export type VotingDescription = {
  tone: VotingTone
  eyebrow: string
  title: string
  body: string
}

export function describeVoting(
  contest: ContestSummary,
  voting: VotingAvailability
): VotingDescription {
  if (voting.open) {
    const closes = contest.votingClosesAt
      ? formatLongDate(contest.votingClosesAt)
      : null
    return {
      tone: 'open',
      eyebrow: 'Voting is open',
      title: closes ? `Voting closes ${closes}` : 'Voting is open now',
      body: closes
        ? `Cast your votes before ${closes}. Vote counts below update as people vote.`
        : 'Cast your votes below. The organizer closes voting when the contest ends, and the counts update as people vote.',
    }
  }

  switch (voting.reason) {
    case 'not_open_yet': {
      const opens = contest.votingOpensAt
        ? formatLongDate(contest.votingOpensAt)
        : null
      return {
        tone: 'waiting',
        eyebrow: 'Not open yet',
        title: opens ? `Voting opens ${opens}` : 'Voting opens soon',
        body: opens
          ? `The entries are below so you can see who is standing. Voting opens ${opens} — come back then and the vote buttons appear here.`
          : 'The entries are below so you can see who is standing. The organizer has not announced an opening time yet.',
      }
    }
    case 'closed': {
      const closed = contest.votingClosesAt
        ? formatLongDate(contest.votingClosesAt)
        : null
      return {
        tone: 'ended',
        eyebrow: 'Voting closed',
        title: closed ? `Voting closed ${closed}` : 'Voting has closed',
        body: closed
          ? `No more votes can be cast. The final standings from ${closed} stay on this page.`
          : 'No more votes can be cast. The final standings stay on this page.',
      }
    }
    case 'not_published':
      // Unreachable through `loadPublicContest`, which only ever resolves a
      // 'published' or 'closed' contest. Handled anyway so a status added to
      // that allow-list later shows a sentence rather than a blank panel.
      return {
        tone: 'ended',
        eyebrow: 'Not open',
        title: 'This contest is not open for voting',
        body: 'The entries below are public, but no votes can be cast right now.',
      }
  }
}

// ─── Refusals ───────────────────────────────────────────────────────────────

/**
 * What a refused vote means for the voter, and how loudly to say it.
 *
 * Every `message` below is the SERVER'S own wording, rendered as written.
 * Those strings were already written for the voter (see the message tables in
 * vote-free.ts and vote-checkout.ts), so re-wording them here would only
 * create two versions of the same sentence that drift apart. What this adds
 * is the tone — the common case is not an error — and a second line where the
 * server could not reasonably say it.
 */
export type VoteRefusalKind =
  // Already voted free in this category today. The usual outcome, and not a
  // failure of anything.
  | 'daily_allowance'
  // The entry stopped taking votes (withdrawn or disqualified) while the page
  // was open.
  | 'entry_unavailable'
  // Voting is not open, or this contest does not offer this kind of voting.
  | 'unavailable'
  // Wrong, expired, used or locked one-time code.
  | 'code'
  // A code was asked for too recently, or too many times.
  | 'rate_limited'
  // Not enough bought votes left.
  | 'balance'
  // Anything else, including a genuine server fault.
  | 'other'

export type VoteRefusal = {
  kind: VoteRefusalKind
  tone: 'info' | 'warning' | 'error'
  message: string
  /** A second line this page adds, or null when the server said it all. */
  hint: string | null
  /** Whether what is on screen is now out of date and should be re-read. */
  refetch: boolean
}

/**
 * The free vote resets at midnight in the CONTEST'S OWN zone (`voteDay` in
 * lib/votes.ts), not the voter's and not the server's.
 *
 * `publicContestFields` does not ship `contests.timeZone`, so this page
 * cannot name the zone or count down to it, and says nothing it cannot
 * stand behind. "Tomorrow" in the contest's local time is the whole truth
 * available here, and it is the truth.
 */
export const DAILY_RESET_HINT =
  'Your free vote in each category comes back at midnight, in the contest’s own local time.'

const ALREADY_VOTED = 'already used your free vote'
const ENTRY_GONE = 'no longer taking votes'

export function classifyVoteRefusal(
  code: string | undefined,
  message: string
): VoteRefusal {
  // First, because an entry that was withdrawn mid-session comes back as
  // BAD_REQUEST from the pre-check and CONFLICT from inside the transaction,
  // and both mean the same thing to the voter: the page is stale.
  if (message.includes(ENTRY_GONE)) {
    return {
      kind: 'entry_unavailable',
      tone: 'warning',
      message,
      hint: 'Nothing was charged and no vote was used. Pick another entry.',
      refetch: true,
    }
  }

  if (code === 'CONFLICT' && message.includes(ALREADY_VOTED)) {
    return {
      kind: 'daily_allowance',
      tone: 'info',
      message,
      hint: DAILY_RESET_HINT,
      refetch: false,
    }
  }

  if (code === 'FORBIDDEN') {
    return {
      kind: 'balance',
      tone: 'warning',
      message,
      hint: null,
      refetch: false,
    }
  }

  if (code === 'TOO_MANY_REQUESTS') {
    return {
      kind: 'rate_limited',
      tone: 'warning',
      message,
      hint: null,
      refetch: false,
    }
  }

  if (code === 'UNAUTHORIZED') {
    return {
      kind: 'code',
      tone: 'warning',
      message,
      hint: null,
      refetch: false,
    }
  }

  // Voting closed, opened later than the page thought, or the organizer
  // switched a voting mode off. The page is out of date either way.
  if (code === 'BAD_REQUEST' || code === 'NOT_FOUND') {
    return {
      kind: 'unavailable',
      tone: 'warning',
      message,
      hint: null,
      refetch: true,
    }
  }

  return {
    kind: 'other',
    tone: 'error',
    message,
    hint: 'Nothing was charged. Please try again.',
    refetch: false,
  }
}
