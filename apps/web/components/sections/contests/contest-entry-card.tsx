'use client'

import { HugeiconsIcon } from '@hugeicons/react'
import {
  FavouriteIcon,
  Image01Icon,
  SealIcon,
} from '@hugeicons/core-free-icons'

import { cn } from '@ticketur/ui/lib/utils'
import { Button } from '@ticketur/ui/components/button'

import type { RankedEntry } from '@/components/sections/contests/types'

// Why an entry is on the ballot but cannot be voted for. `acceptsVotes` is
// what the UI gates on — the server computes it from the entry's status and
// castVotes enforces the same rule in SQL — and these words only explain a
// decision that has already been made for us.
const BLOCKED_LABEL: Record<string, string> = {
  withdrawn: 'Withdrawn',
  disqualified: 'Disqualified',
}

const BLOCKED_REASON: Record<string, string> = {
  withdrawn: 'This entry pulled out. Its votes stay on the record.',
  disqualified:
    'This entry was disqualified. Its votes stay on the record, but it can’t take new ones.',
}

export function ContestEntryCard({
  entry,
  votingOpen,
  canVoteFree,
  creditsRemaining,
  onVoteFree,
  onVotePaid,
}: {
  entry: RankedEntry
  votingOpen: boolean
  /** The contest offers free voting at all. */
  canVoteFree: boolean
  /** Bought votes this voter has left, or null when no email is known yet. */
  creditsRemaining: number | null
  onVoteFree: (entry: RankedEntry) => void
  onVotePaid: (entry: RankedEntry) => void
}) {
  // The one gate. Never recomputed from `entry.status` — the API already
  // decided, and two opinions on the same page is how a disqualified entry
  // ends up with a vote button.
  const votable = votingOpen && entry.acceptsVotes
  const blockedLabel = entry.acceptsVotes ? null : BLOCKED_LABEL[entry.status]

  return (
    <li
      className={cn(
        'border-border bg-card flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-start sm:gap-4',
        !entry.acceptsVotes && 'bg-muted/40'
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3.5">
        <Thumbnail
          url={entry.photoUrl}
          name={entry.displayName}
          dimmed={!entry.acceptsVotes}
        />

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {entry.rank !== null ? (
              <span
                className={cn(
                  'shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold tabular-nums',
                  entry.rank === 1
                    ? 'bg-primary/15 text-primary'
                    : 'bg-muted text-muted-foreground'
                )}
              >
                #{entry.rank}
              </span>
            ) : null}
            <h3 className="text-foreground min-w-0 text-sm font-semibold break-words">
              {entry.displayName}
            </h3>
            {blockedLabel ? (
              <span className="bg-muted text-muted-foreground inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold">
                <HugeiconsIcon
                  icon={SealIcon}
                  className="size-3"
                  strokeWidth={2}
                />
                {blockedLabel}
              </span>
            ) : null}
          </div>

          {entry.bio ? (
            <p className="text-muted-foreground text-sm leading-6 whitespace-pre-line">
              {entry.bio}
            </p>
          ) : null}

          <p className="text-foreground flex items-center gap-1.5 text-sm font-semibold tabular-nums">
            <HugeiconsIcon
              icon={FavouriteIcon}
              className="text-primary size-3.5 shrink-0"
              strokeWidth={2}
            />
            {entry.voteCount.toLocaleString('en-US')}{' '}
            <span className="text-muted-foreground font-normal">
              {entry.voteCount === 1 ? 'vote' : 'votes'}
            </span>
          </p>

          {blockedLabel ? (
            <p className="text-muted-foreground text-xs leading-5">
              {BLOCKED_REASON[entry.status]}
            </p>
          ) : null}
        </div>
      </div>

      {votable ? (
        <div className="flex shrink-0 flex-wrap gap-2 sm:flex-col sm:items-stretch">
          {canVoteFree ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onVoteFree(entry)}
            >
              Vote free
            </Button>
          ) : null}
          {creditsRemaining !== null && creditsRemaining > 0 ? (
            <Button type="button" size="sm" onClick={() => onVotePaid(entry)}>
              Use my votes
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

function Thumbnail({
  url,
  name,
  dimmed,
}: {
  url: string | null
  name: string
  dimmed: boolean
}) {
  if (!url) {
    return (
      <div className="bg-muted text-muted-foreground flex size-16 shrink-0 items-center justify-center rounded-xl">
        <HugeiconsIcon
          icon={Image01Icon}
          className="size-5"
          strokeWidth={1.8}
        />
      </div>
    )
  }
  return (
    // A plain <img>, as the organizer's own entry editor uses: entry photos go
    // to the blob store through the same helper a registration answer does,
    // but next/image would still need every possible host in
    // next.config.ts#images.remotePatterns, and a photo that fails to render
    // on a public ballot is worse than one that is not optimised.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={name}
      loading="lazy"
      className={cn(
        'bg-muted size-16 shrink-0 rounded-xl object-cover',
        dimmed && 'opacity-60 grayscale'
      )}
    />
  )
}
