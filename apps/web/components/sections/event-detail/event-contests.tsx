'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowRight01Icon, ChampionIcon } from '@hugeicons/core-free-icons'

import { cn } from '@ticketur/ui/lib/utils'

import { useTRPC } from '@/lib/trpc'
import { formatLongDate } from '@/lib/date'

// The way a human finds a contest.
//
// Until this, a published contest was reachable only by somebody who already
// had /contests/{slug} — out of an email, or out of a forward. An event page
// that says nothing about the award its own organizer is running is the
// reason a contest can be live and empty.
//
// Renders nothing when the event has no public contest, which is most of
// them: an absent section is better than an empty one.
export function EventContests({ slug }: { slug: string }) {
  const trpc = useTRPC()
  const { data } = useQuery(
    trpc.public.contestDiscovery.forEvent.queryOptions({ eventSlug: slug })
  )

  if (!data || data.length === 0) return null

  return (
    <section
      aria-label="Contests at this event"
      className="w-full px-5 pt-6 md:px-10 md:pt-8"
    >
      <ul className="mx-auto flex max-w-[1440px] flex-col gap-3">
        {data.map((contest) => {
          const status = describe(contest)
          return (
            <li key={contest.slug}>
              <Link
                href={`/contests/${contest.slug}`}
                className="border-border bg-card hover:border-primary/60 flex items-center gap-4 rounded-2xl border p-5 transition-colors"
              >
                <span className="bg-primary/10 text-primary flex size-11 shrink-0 items-center justify-center rounded-xl">
                  <HugeiconsIcon
                    icon={ChampionIcon}
                    className="size-5"
                    strokeWidth={1.8}
                  />
                </span>

                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-foreground text-sm font-semibold">
                      {contest.title}
                    </span>
                    <span
                      className={cn(
                        'rounded px-1.5 py-0.5 text-[11px] font-bold tracking-wider uppercase',
                        status.open
                          ? 'bg-primary/10 text-primary'
                          : 'bg-muted text-muted-foreground'
                      )}
                    >
                      {status.label}
                    </span>
                  </span>
                  <span className="text-muted-foreground text-sm">
                    {status.detail}
                  </span>
                </span>

                <HugeiconsIcon
                  icon={ArrowRight01Icon}
                  className="text-muted-foreground size-5 shrink-0"
                  strokeWidth={1.8}
                />
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

type DiscoveredContest = {
  voting: { open: true } | { open: false; reason: string }
  votingOpensAt: Date | null
  votingClosesAt: Date | null
}

// The same three states the contest page itself shows, in one line. `voting`
// is decided by the server, so this card and the page behind it cannot
// disagree about whether votes are being taken.
function describe(contest: DiscoveredContest): {
  open: boolean
  label: string
  detail: string
} {
  if (contest.voting.open) {
    return {
      open: true,
      label: 'Voting open',
      detail: contest.votingClosesAt
        ? `Vote now — closes ${formatLongDate(contest.votingClosesAt)}`
        : 'Vote now, and see the standings',
    }
  }
  if (contest.voting.reason === 'not_open_yet') {
    return {
      open: false,
      label: 'Opens soon',
      detail: contest.votingOpensAt
        ? `See the entries — voting opens ${formatLongDate(contest.votingOpensAt)}`
        : 'See the entries before voting opens',
    }
  }
  return {
    open: false,
    label: 'Voting closed',
    detail: 'See the final standings',
  }
}
