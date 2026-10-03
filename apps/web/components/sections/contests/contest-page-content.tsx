'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { Alert02Icon, WifiDisconnected01Icon } from '@hugeicons/core-free-icons'

import { Button } from '@ticketur/ui/components/button'
import { Skeleton } from '@ticketur/ui/components/skeleton'

import { useTRPC } from '@/lib/trpc'
import { ContestBallot } from '@/components/sections/contests/contest-ballot'
import { ContestHeader } from '@/components/sections/contests/contest-header'
import { totalVotes } from '@/components/sections/contests/types'

// The public contest page.
//
// `bySlug` answers in two shapes — null, or the whole ballot — and the page
// has to render both, plus the two the query itself can be in (loading, and
// a read that failed). A dropped connection is kept separate from a contest
// that went away: this page is read on phone data, and telling someone the
// contest was taken down when the train went into a tunnel is a lie they act
// on.
//
// The input below must match the server prefetch in
// app/(app)/contests/[slug]/page.tsx exactly, or the query key differs and
// the prefetch is quietly wasted.

// How often the counts are re-read while voting is open. A leaderboard that
// never moves is not live; one that moves every second is a load test. React
// Query does not poll a backgrounded tab by default, so a phone in a pocket
// costs nothing.
const LIVE_REFRESH_MS = 20_000

export function ContestPageContent({ slug }: { slug: string }) {
  const trpc = useTRPC()
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    ...trpc.public.contests.bySlug.queryOptions({ slug }),
    refetchInterval: (query) =>
      query.state.data?.voting.open ? LIVE_REFRESH_MS : false,
  })

  if (isLoading) return <ContestPageSkeleton />

  if (isError) {
    return (
      <ContestLoadFailed onRetry={() => void refetch()} retrying={isFetching} />
    )
  }

  // The page only rendered because the server resolved this contest, so null
  // here means it stopped being public while somebody was looking at it — an
  // admin suspension, or the organizer's event being pulled. Never a 404 at
  // this point.
  if (!data) return <ContestGone slug={slug} />

  return (
    <div className="flex flex-col gap-8">
      <ContestHeader
        contest={data.contest}
        event={data.event}
        entryCount={data.entries.length}
        votesCast={totalVotes(data.entries)}
      />
      <ContestBallot data={data} onRefetch={() => void refetch()} />
    </div>
  )
}

function ContestLoadFailed({
  onRetry,
  retrying,
}: {
  onRetry: () => void
  retrying: boolean
}) {
  return (
    <section className="border-border bg-card flex flex-col items-center gap-4 rounded-2xl border p-8 text-center md:p-10">
      <span className="bg-muted text-muted-foreground flex size-14 items-center justify-center rounded-full">
        <HugeiconsIcon
          icon={WifiDisconnected01Icon}
          className="size-7"
          strokeWidth={1.8}
        />
      </span>
      <h2 className="font-heading text-foreground text-2xl font-bold tracking-tight">
        We couldn&apos;t load this contest
      </h2>
      <p className="text-muted-foreground max-w-prose text-sm leading-6">
        Check your connection and try again. No votes were affected.
      </p>
      <Button type="button" size="xl" onClick={onRetry} disabled={retrying}>
        {retrying ? 'Trying…' : 'Try again'}
      </Button>
    </section>
  )
}

// A contest that disappeared from under the voter: suspended by an admin, or
// its event pulled. It is no longer public, so bySlug answers null — but we
// know it was there a moment ago, which makes "not found" the wrong thing to
// say.
function ContestGone({ slug }: { slug: string }) {
  return (
    <section className="border-border bg-card flex flex-col items-center gap-4 rounded-2xl border p-8 text-center md:p-10">
      <span className="bg-muted text-muted-foreground flex size-14 items-center justify-center rounded-full">
        <HugeiconsIcon
          icon={Alert02Icon}
          className="size-7"
          strokeWidth={1.8}
        />
      </span>
      <h2 className="font-heading text-foreground text-2xl font-bold tracking-tight">
        This contest was just taken down
      </h2>
      <p className="text-muted-foreground max-w-prose text-sm leading-6">
        It has stopped taking votes while it is checked over. Votes already cast
        are kept. If you bought votes and they are now unusable, you are owed
        your money back — contact support.
      </p>
      <p className="text-muted-foreground font-mono text-xs">
        /contests/{slug}
      </p>
      <Button asChild size="xl" className="mt-2">
        <Link href="/events">Browse events</Link>
      </Button>
    </section>
  )
}

export function ContestPageSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      <div className="border-border overflow-hidden rounded-2xl border">
        <Skeleton className="aspect-[16/7] w-full rounded-none sm:aspect-[16/5]" />
        <div className="flex flex-col gap-3 p-5 md:p-6">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-7 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>
      <Skeleton className="h-28 w-full rounded-2xl" />
      <div className="flex flex-col gap-4">
        <Skeleton className="h-6 w-48" />
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24 w-full rounded-2xl" />
        ))}
      </div>
    </div>
  )
}
