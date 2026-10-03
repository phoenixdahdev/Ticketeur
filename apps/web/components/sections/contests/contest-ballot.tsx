'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { ChampionIcon, UserAdd01Icon } from '@hugeicons/core-free-icons'

import { cn } from '@ticketur/ui/lib/utils'
import { Button } from '@ticketur/ui/components/button'

import { useTRPC } from '@/lib/trpc'
import { useSession } from '@/lib/auth-client'
import { ContestEntryCard } from '@/components/sections/contests/contest-entry-card'
import { Notice } from '@/components/sections/contests/contest-notice'
import { NominateDialog } from '@/components/sections/contests/nominate-dialog'
import {
  groupEntries,
  type ContestSection,
  type PublicContest,
  type RankedEntry,
} from '@/components/sections/contests/types'
import { VoteBuyDialog } from '@/components/sections/contests/vote-buy-dialog'
import { VoteFreeDialog } from '@/components/sections/contests/vote-free-dialog'
import { VotePaidDialog } from '@/components/sections/contests/vote-paid-dialog'
import { VoteWallet } from '@/components/sections/contests/vote-wallet'
import {
  describePhase,
  nominationsNow,
  type VotingTone,
} from '@/components/sections/contests/voting-state'
import {
  clearVoterEmail,
  normalizeEmail,
  readVoterEmail,
  writeVoterEmail,
} from '@/components/sections/contests/voter-identity'

// The ballot: the voting window, the balance, and the entries with their
// live counts.
//
// Everything on screen comes from the one `bySlug` read the page already
// makes. Counts are NOT fetched from the leaderboard procedure as well —
// bySlug returns every field that one does (voteCount, sortOrder, the entry's
// status) for every entry, unlimited, so a second query would only add a
// second set of numbers that can disagree with the first halfway down the
// page. The ranking rule is the server's own, replicated exactly in
// `groupEntries`: desc(voteCount), asc(sortOrder), asc(id), ties sharing a
// rank.

const TONE_CLASS: Record<VotingTone, string> = {
  open: 'border-primary/30 bg-primary/5',
  waiting: 'border-amber-500/40 bg-amber-500/10',
  ended: 'border-border bg-muted/40',
}

export function ContestBallot({
  data,
  onRefetch,
}: {
  data: PublicContest
  /** Re-read bySlug: counts moved, or the server says we are stale. */
  onRefetch: () => void
}) {
  const trpc = useTRPC()
  const session = useSession()
  const { contest, categories, entries, bundles, serviceFeeBps, voting } = data

  const sections = useMemo(
    () => groupEntries(categories, entries),
    [categories, entries]
  )

  // The browser's clock decides what is on screen; the server's decides what
  // is allowed. See the note on `nominationsNow`. Computed once per render
  // from the contest fields `bySlug` already ships, so no extra round trip —
  // and re-derived on every refetch, which is how a window that closes while
  // somebody is reading eventually shows through.
  const nominations = nominationsNow(contest)
  const status = describePhase(contest, voting, nominations)

  // ── Who is voting ─────────────────────────────────────────────────────────
  // Read after mount: localStorage is browser-only, and reading it during
  // render would make the server and the first client render disagree.
  const [voterEmail, setVoterEmail] = useState<string | null>(null)
  useEffect(() => {
    setVoterEmail(readVoterEmail(contest.id))
  }, [contest.id])

  function identify(email: string) {
    const normalized = normalizeEmail(email)
    setVoterEmail(normalized)
    writeVoterEmail(contest.id, normalized)
  }

  function forget() {
    setVoterEmail(null)
    clearVoterEmail(contest.id)
  }

  // ── The balance ───────────────────────────────────────────────────────────
  // Only asked for once there is an address to ask about, and only when this
  // contest sells votes at all.
  const balanceQuery = useQuery(
    trpc.public.voteBalance.byEmail.queryOptions(
      { contestId: contest.id, voterEmail: voterEmail ?? '' },
      { enabled: voterEmail !== null && contest.paidVotingEnabled }
    )
  )

  // castPaid returns the balance it just wrote. Believed over the query until
  // the query catches up, because it is newer than anything cached.
  const [castRemaining, setCastRemaining] = useState<number | null>(null)
  useEffect(() => {
    setCastRemaining(null)
  }, [voterEmail])

  const remaining = castRemaining ?? balanceQuery.data?.remaining ?? null

  // ── Dialogs ───────────────────────────────────────────────────────────────
  const [nominateIn, setNominateIn] = useState<string | null>(null)
  const [nominateOpen, setNominateOpen] = useState(false)
  const [freeFor, setFreeFor] = useState<RankedEntry | null>(null)
  const [paidFor, setPaidFor] = useState<RankedEntry | null>(null)
  const [buyOpen, setBuyOpen] = useState(false)

  const categoryOf = (entry: RankedEntry | null): string | null => {
    if (!entry) return null
    return categories.find((c) => c.id === entry.categoryId)?.title ?? null
  }

  const sellsVotes =
    contest.paidVotingEnabled &&
    (bundles.length > 0 || contest.pricePerVoteMinor > 0)
  const offersFreeVoting = contest.freeVotingEnabled && voting.open

  function refetchAll() {
    onRefetch()
    if (voterEmail) void balanceQuery.refetch()
  }

  // Nominating needs somewhere to nominate INTO. A contest with no category
  // has nothing to put a name forward in, and the server refuses it anyway.
  const canNominate = nominations.open && categories.length > 0

  function openNominate(categoryId: string | null) {
    setNominateIn(categoryId)
    setNominateOpen(true)
  }

  return (
    <div className="flex flex-col gap-6">
      <section
        className={cn(
          'flex flex-col gap-1.5 rounded-2xl border p-5',
          TONE_CLASS[status.tone]
        )}
      >
        <p className="text-muted-foreground text-xs font-bold tracking-[0.2em] uppercase">
          {status.eyebrow}
        </p>
        <h2 className="font-heading text-foreground text-lg font-bold tracking-tight">
          {status.title}
        </h2>
        <p className="text-muted-foreground text-sm leading-6">{status.body}</p>

        {voting.open ? (
          <p className="text-muted-foreground mt-1 text-sm leading-6">
            {contest.freeVotingEnabled && sellsVotes
              ? 'Vote free once per category per day, or buy votes to vote as often as you like.'
              : contest.freeVotingEnabled
                ? 'Free voting only: one vote per category, per day, per email.'
                : sellsVotes
                  ? 'Voting is by bought votes only in this contest.'
                  : 'The organizer has not opened any way to vote yet.'}
          </p>
        ) : null}
      </section>

      {canNominate ? (
        <div className="border-primary/30 bg-card flex flex-col items-start gap-3 rounded-2xl border p-5">
          <h2 className="font-heading text-foreground text-base font-bold tracking-tight">
            Know someone who should be on this ballot?
          </h2>
          <p className="text-muted-foreground text-sm leading-6">
            Put their name forward. The organizer reads every nomination and
            decides who makes the ballot — nothing you write here is public, and
            nominating is not voting.
          </p>
          <Button
            type="button"
            size="xl"
            className="gap-1.5"
            onClick={() => openNominate(null)}
          >
            <HugeiconsIcon
              icon={UserAdd01Icon}
              className="size-4"
              strokeWidth={1.9}
            />
            Nominate someone
          </Button>
        </div>
      ) : null}

      {voting.open && contest.paidVotingEnabled ? (
        <VoteWallet
          voterEmail={voterEmail}
          remaining={remaining}
          loading={balanceQuery.isLoading}
          canBuy={sellsVotes}
          onIdentify={identify}
          onForget={forget}
          onBuy={() => setBuyOpen(true)}
        />
      ) : null}

      {sections.length === 0 || entries.length === 0 ? (
        <Notice tone="muted" icon={ChampionIcon}>
          {nominations.open
            ? 'Nobody is on the ballot yet — that is what the nomination phase is for. Names put forward now appear here once the organizer accepts them.'
            : 'The entries for this contest haven’t been published yet. Check back soon.'}
        </Notice>
      ) : (
        <div className="flex flex-col gap-8">
          {sections.map((section) => (
            <CategorySection
              key={section.id}
              section={section}
              votingOpen={voting.open}
              canVoteFree={offersFreeVoting}
              creditsRemaining={remaining}
              onVoteFree={setFreeFor}
              onVotePaid={setPaidFor}
              onNominate={
                canNominate && section.id !== '__ungrouped'
                  ? () => openNominate(section.id)
                  : null
              }
            />
          ))}
        </div>
      )}

      {voting.open && sellsVotes ? (
        <div className="border-border bg-card flex flex-col items-start gap-3 rounded-2xl border p-5">
          <h2 className="text-foreground text-sm font-semibold">
            Want to vote more than once?
          </h2>
          <p className="text-muted-foreground text-sm leading-6">
            Buy a pack of votes and spend them on whoever you like, as many
            times as you like, until voting closes.
          </p>
          <Button type="button" onClick={() => setBuyOpen(true)}>
            Buy votes
          </Button>
        </div>
      ) : null}

      <NominateDialog
        contestId={contest.id}
        categories={categories}
        defaultCategoryId={nominateIn}
        defaultEmail={voterEmail ?? session.data?.user?.email ?? ''}
        open={nominateOpen}
        onOpenChange={setNominateOpen}
        onNominated={onRefetch}
        onStale={onRefetch}
        onEmailUsed={identify}
      />

      <VoteFreeDialog
        contestId={contest.id}
        entry={freeFor}
        categoryTitle={categoryOf(freeFor)}
        defaultEmail={voterEmail ?? session.data?.user?.email ?? ''}
        open={freeFor !== null}
        onOpenChange={(open) => {
          if (!open) setFreeFor(null)
        }}
        onVoted={refetchAll}
        onStale={onRefetch}
        onEmailUsed={identify}
      />

      <VotePaidDialog
        contestId={contest.id}
        entry={paidFor}
        voterEmail={voterEmail ?? ''}
        creditsRemaining={remaining ?? 0}
        open={paidFor !== null}
        onOpenChange={(open) => {
          if (!open) setPaidFor(null)
        }}
        onCast={(left) => {
          setCastRemaining(left)
          refetchAll()
        }}
        onStale={refetchAll}
      />

      <VoteBuyDialog
        contest={contest}
        bundles={bundles}
        serviceFeeBps={serviceFeeBps}
        defaultEmail={voterEmail ?? session.data?.user?.email ?? ''}
        defaultName={session.data?.user?.name ?? ''}
        open={buyOpen}
        onOpenChange={setBuyOpen}
        onStale={onRefetch}
        onEmailUsed={identify}
      />
    </div>
  )
}

function CategorySection({
  section,
  votingOpen,
  canVoteFree,
  creditsRemaining,
  onVoteFree,
  onVotePaid,
  onNominate,
}: {
  section: ContestSection
  votingOpen: boolean
  canVoteFree: boolean
  creditsRemaining: number | null
  onVoteFree: (entry: RankedEntry) => void
  onVotePaid: (entry: RankedEntry) => void
  /** null while the contest is not taking nominations. */
  onNominate: (() => void) | null
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="font-heading text-foreground text-xl font-bold tracking-tight">
            {section.title}
          </h2>
          {section.description ? (
            <p className="text-muted-foreground text-sm leading-6">
              {section.description}
            </p>
          ) : null}
        </div>
        {onNominate ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="shrink-0 gap-1.5"
            onClick={onNominate}
          >
            <HugeiconsIcon
              icon={UserAdd01Icon}
              className="size-4"
              strokeWidth={1.9}
            />
            Nominate
          </Button>
        ) : null}
      </div>

      {section.entries.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {onNominate
            ? 'Nobody has been accepted onto this category yet.'
            : 'No entries in this category yet.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {section.entries.map((entry) => (
            <ContestEntryCard
              key={entry.id}
              entry={entry}
              votingOpen={votingOpen}
              canVoteFree={canVoteFree}
              creditsRemaining={creditsRemaining}
              onVoteFree={onVoteFree}
              onVotePaid={onVotePaid}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
