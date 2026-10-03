import type { RouterOutputs } from '@ticketur/api'
import type { ContestStatus, EntryStatus } from '@ticketur/db'

import { formatDateTime } from '@/lib/org-forms'

// Shared vocabulary for the organizer's contest screens: how each status
// reads, what the review lifecycle means for voting, and the few conversions
// the editor needs.
//
// The money and date helpers live in ./org-forms and are re-exported here
// rather than copied: kobo is kobo, and two definitions of "naira to kobo"
// on the same dashboard is how a price ends up a hundred times wrong.
export {
  fromDateTimeInput,
  formatDateTime,
  koboToNaira,
  nairaToKobo,
  plural,
  toDateTimeInput,
} from '@/lib/org-forms'

export type ContestListRow = RouterOutputs['org']['contests']['list'][number]
export type ContestDetail = NonNullable<
  RouterOutputs['org']['contests']['byId']
>
export type ContestCategory = ContestDetail['categories'][number]
export type ContestEntry = ContestDetail['entries'][number]
export type VoteBundle = ContestDetail['bundles'][number]
export type EligibleSubmission =
  RouterOutputs['org']['contests']['entries']['eligibleSubmissions'][number]

/**
 * What every content mutation reports back: whether saving stopped the
 * voting. `org.contests.update`, `categories.*`, `entries.*` and `bundles.*`
 * all return it.
 */
export type ReviewEffect = {
  contestStatus: ContestStatus
  sentToReview: boolean
}

// ─── Statuses ───────────────────────────────────────────────────────────────

export const CONTEST_STATUS_LABEL: Record<ContestStatus, string> = {
  draft: 'Draft',
  pending_review: 'In review',
  published: 'Live',
  rejected: 'Rejected',
  closed: 'Closed',
  suspended: 'Taken down',
}

export const CONTEST_STATUS_TONE: Record<ContestStatus, string> = {
  draft: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  pending_review:
    'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400',
  published:
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
  rejected: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400',
  closed: 'bg-muted text-muted-foreground',
  suspended: 'bg-rose-600 text-white dark:bg-rose-500/80 dark:text-rose-50',
}

// One line saying what the status means for voters right now.
export const CONTEST_STATUS_MEANING: Record<ContestStatus, string> = {
  draft: 'Not visible to anyone. Submit it for review when it is ready.',
  pending_review:
    'Waiting for an admin to approve the ballot and the prices. No votes can be cast.',
  published: 'Live — people can vote inside the voting window.',
  rejected:
    'Turned down by an admin. Fix what they asked for and submit it again.',
  closed: 'Voting has ended. The page and the results stay public.',
  suspended:
    'An admin took this contest off the platform. Its page is not public and no votes can be cast.',
}

// Ranked so sorting by status walks the lifecycle, not the alphabet.
export const CONTEST_STATUS_ORDER: Record<ContestStatus, number> = {
  suspended: 0,
  rejected: 1,
  pending_review: 2,
  draft: 3,
  published: 4,
  closed: 5,
}

export const VOTING_CLOSED_LABEL: Record<
  'not_published' | 'not_open_yet' | 'closed',
  string
> = {
  not_published: 'It is not approved, so nobody can vote',
  not_open_yet: 'Voting has not opened yet',
  closed: 'Voting has closed',
}

// ─── Entries ────────────────────────────────────────────────────────────────

export const ENTRY_STATUS_LABEL: Record<EntryStatus, string> = {
  active: 'On the ballot',
  withdrawn: 'Withdrawn',
  disqualified: 'Disqualified',
}

export const ENTRY_STATUS_TONE: Record<EntryStatus, string> = {
  active:
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
  withdrawn: 'bg-muted text-muted-foreground',
  disqualified:
    'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400',
}

export const ENTRY_STATUS_MEANING: Record<EntryStatus, string> = {
  active: 'People can vote for this entry.',
  withdrawn:
    'The contestant pulled out. Off the ballot; the votes already cast still stand.',
  disqualified:
    'Removed by you. Off the ballot; the votes already cast still stand.',
}

// ─── Money (minor units) ────────────────────────────────────────────────────

// Everything on a contest is stored in kobo. 0 per vote means "bundles only",
// which is a real setting rather than a free vote, so it does not read as
// "Free" the way a form's price option does.
export function formatKobo(minor: number): string {
  return `₦${(minor / 100).toLocaleString('en-NG', {
    maximumFractionDigits: 2,
  })}`
}

export function formatPerVote(contest: {
  paidVotingEnabled: boolean
  pricePerVoteMinor: number
}): string {
  if (!contest.paidVotingEnabled) return 'Paid voting is off'
  return contest.pricePerVoteMinor === 0
    ? 'Bundles only'
    : `${formatKobo(contest.pricePerVoteMinor)} per vote`
}

/** The fee a voter pays on top, in kobo. Basis points: 500 = 5%. */
export function serviceFeeMinor(priceMinor: number, feeBps: number): number {
  return Math.round((priceMinor * feeBps) / 10_000)
}

// ─── Dates & windows ────────────────────────────────────────────────────────

export function votingWindowLabel(contest: {
  votingOpensAt: Date | string | null
  votingClosesAt: Date | string | null
}): string {
  const opens = formatDateTime(contest.votingOpensAt)
  const closes = formatDateTime(contest.votingClosesAt)
  if (opens && closes) return `${opens} – ${closes}`
  if (opens) return `Voting opens ${opens}`
  if (closes) return `Voting closes ${closes}`
  return 'Open from approval until you close it'
}

export function nominationWindowLabel(contest: {
  nominationsOpenAt: Date | string | null
  nominationsCloseAt: Date | string | null
}): string {
  const opens = formatDateTime(contest.nominationsOpenAt)
  const closes = formatDateTime(contest.nominationsCloseAt)
  if (opens && closes) return `${opens} – ${closes}`
  if (opens) return `Nominations open ${opens}`
  if (closes) return `Nominations close ${closes}`
  return 'No nomination phase'
}

/**
 * The zones offered in the picker. The server accepts any zone this runtime
 * resolves (`isValidTimeZone`); this is a short list of the ones a Nigerian
 * platform's organizers actually use, with Lagos first because it is the
 * default and the answer for almost everybody.
 */
export const TIME_ZONE_CHOICES = [
  'Africa/Lagos',
  'Africa/Accra',
  'Africa/Abidjan',
  'Africa/Johannesburg',
  'Africa/Nairobi',
  'Europe/London',
  'America/New_York',
  'UTC',
] as const

/** The zone the organizer's own browser is in, when we can offer it. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Lagos'
  } catch {
    return 'Africa/Lagos'
  }
}

// ─── Public page ────────────────────────────────────────────────────────────

// The slug is generated once at creation and never changes, so a link already
// shared keeps working. Matches the path the vote emails link to
// (packages/api/src/lib/vote-emails.ts).
export function publicContestPath(slug: string): string {
  return `/contests/${slug}`
}

// ─── Events that can carry a contest ────────────────────────────────────────

// Mirrors assertEventAcceptsContests (packages/api/src/lib/contests.ts), so
// the event picker only offers events the server will accept.
export function eventAcceptsContests(event: {
  status: string
  eventDate: string | null
  endDate: string | null
}): boolean {
  if (event.status === 'archived' || event.status === 'suspended') return false
  const lastDay = event.endDate ?? event.eventDate
  const today = new Date().toISOString().slice(0, 10)
  return lastDay === null || lastDay >= today
}
