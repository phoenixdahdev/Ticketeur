'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { ChampionIcon, PlusSignIcon } from '@hugeicons/core-free-icons'

import { Button } from '@ticketur/ui/components/button'

import { useTRPC } from '@/lib/trpc'
import { formatPerVote, plural, votingWindowLabel } from '@/lib/org-contests'
import { ContestStatusBadge } from '@/components/dashboard/contests/review-notice'

// The contests attached to one event, on that event's own page — the other
// way organizers reach them, besides the sidebar.
export function EventContestsPanel({ eventId }: { eventId: string }) {
  const trpc = useTRPC()
  const { data, isLoading } = useQuery(
    trpc.org.contests.list.queryOptions({ eventId })
  )
  const contests = data ?? []

  return (
    <div className="flex flex-col gap-3">
      {isLoading ? (
        <p className="text-muted-foreground text-sm">Loading contests…</p>
      ) : contests.length === 0 ? (
        <div className="border-border/60 flex flex-col items-start gap-3 rounded-2xl border border-dashed p-6">
          <p className="text-muted-foreground text-sm">
            No contests on this event yet. Add one to run a pageant, an award or
            any public vote — an admin approves the ballot and the prices before
            voting starts.
          </p>
          <Button asChild variant="outline" className="gap-1.5">
            <Link href={`/org/contests/new?eventId=${eventId}`}>
              <HugeiconsIcon
                icon={PlusSignIcon}
                className="size-4"
                strokeWidth={2}
              />
              New contest
            </Link>
          </Button>
        </div>
      ) : (
        <>
          <ul className="border-border/60 bg-background divide-border/60 flex flex-col divide-y overflow-hidden rounded-2xl border">
            {contests.map((contest) => (
              <li
                key={contest.id}
                className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:gap-5"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/org/contests/${contest.id}`}
                      className="text-foreground hover:text-primary text-sm font-semibold transition-colors"
                    >
                      {contest.title}
                    </Link>
                    <ContestStatusBadge status={contest.status} />
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {votingWindowLabel(contest)} · {formatPerVote(contest)}
                  </p>
                  {(contest.status === 'rejected' ||
                    contest.status === 'suspended') &&
                  contest.rejectionReason ? (
                    <p className="line-clamp-2 text-xs text-rose-600 dark:text-rose-400">
                      {contest.rejectionReason}
                    </p>
                  ) : null}
                </div>

                <Link
                  href={`/org/contests/${contest.id}`}
                  className="text-primary hover:text-primary/80 inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold transition-colors"
                >
                  <HugeiconsIcon
                    icon={ChampionIcon}
                    className="size-4"
                    strokeWidth={1.8}
                  />
                  {plural(contest.voteCount, 'vote')}
                  {contest.entryCount > 0
                    ? ` · ${contest.entryCount === 1 ? '1 entry' : `${contest.entryCount} entries`}`
                    : ''}
                </Link>
              </li>
            ))}
          </ul>
          <div>
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link href={`/org/contests/new?eventId=${eventId}`}>
                <HugeiconsIcon
                  icon={PlusSignIcon}
                  className="size-4"
                  strokeWidth={2}
                />
                New contest
              </Link>
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
