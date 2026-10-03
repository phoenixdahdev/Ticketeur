'use client'

import Link from 'next/link'
import Image from 'next/image'

import type { RouterOutputs } from '@ticketur/api'

import { formatShortDate as formatDate } from '@/lib/date'

type LiveContest = RouterOutputs['admin']['moderation']['liveContests'][number]

const STATUS_LABEL: Record<LiveContest['status'], string> = {
  published: 'Taking votes',
  closed: 'Closed, results still public',
}

const STATUS_TONE: Record<LiveContest['status'], string> = {
  published:
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
  closed: 'bg-muted text-muted-foreground',
}

// Contests the public can reach. The queue next door is for contests waiting
// on a decision; this is for the ones already live, which is where a rigged
// ballot, an entry nobody consented to, or a fraudulent contest has to be
// found before it can be taken down.
export function ModerationLiveContestsTable({
  rows,
  loading,
}: {
  rows: LiveContest[]
  loading: boolean
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="border-border/60 bg-background overflow-hidden rounded-2xl border">
        <div className="[scrollbar-width:none] overflow-x-auto [&::-webkit-scrollbar]:hidden">
          <table className="w-full min-w-[820px] table-auto">
            <thead className="bg-primary/5">
              <tr className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                <th className="px-5 py-4 text-left">Contest</th>
                <th className="px-5 py-4 text-left">Event</th>
                <th className="px-5 py-4 text-left">Organizer</th>
                <th className="px-5 py-4 text-left">Votes</th>
                <th className="px-5 py-4 text-left">Unspent credits</th>
                <th className="px-5 py-4 text-left">Approved</th>
                <th className="px-5 py-4 text-left">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-border/60 divide-y">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center">
                    <p className="text-muted-foreground text-sm">
                      Loading live contests…
                    </p>
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center">
                    <p className="text-muted-foreground text-sm">
                      No contests are public right now.
                    </p>
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr
                    key={row.id}
                    className="hover:bg-muted/40 text-sm transition-colors"
                  >
                    <td className="px-5 py-4">
                      <Link
                        href={`/moderation/contest/${row.id}`}
                        className="flex items-center gap-3"
                      >
                        {row.thumbnailUrl ? (
                          <Image
                            src={row.thumbnailUrl}
                            alt=""
                            width={40}
                            height={40}
                            className="size-10 shrink-0 rounded-full object-cover"
                          />
                        ) : (
                          <div className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
                            {row.title.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <span className="flex flex-col gap-1">
                          <span className="text-foreground hover:text-primary font-semibold transition-colors">
                            {row.title}
                          </span>
                          <span className="flex items-center gap-2">
                            <span className="text-muted-foreground text-xs">
                              {row.categoryCount}{' '}
                              {row.categoryCount === 1
                                ? 'category'
                                : 'categories'}
                              {' · '}
                              {row.entryCount}{' '}
                              {row.entryCount === 1 ? 'entry' : 'entries'}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_TONE[row.status]}`}
                            >
                              {STATUS_LABEL[row.status]}
                            </span>
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="text-foreground px-5 py-4">
                      {row.eventTitle}
                    </td>
                    <td className="text-foreground px-5 py-4 whitespace-nowrap">
                      {row.organizerName}
                    </td>
                    <td className="text-foreground px-5 py-4 whitespace-nowrap">
                      {row.voteCount.toLocaleString('en-NG')}
                    </td>
                    {/* Votes people have paid for and not yet cast — what a
                        takedown strands, so it is on screen before the
                        decision rather than inside it. */}
                    <td className="px-5 py-4 whitespace-nowrap">
                      <span
                        className={
                          row.unspentCredits > 0
                            ? 'font-semibold text-amber-700 dark:text-amber-400'
                            : 'text-muted-foreground'
                        }
                      >
                        {row.unspentCredits.toLocaleString('en-NG')}
                      </span>
                    </td>
                    <td className="text-foreground px-5 py-4 whitespace-nowrap">
                      {formatDate(row.approvedAt)}
                    </td>
                    <td className="px-5 py-4">
                      <Link
                        href={`/moderation/contest/${row.id}`}
                        className="border-border/60 text-foreground hover:bg-muted inline-flex items-center rounded-md border px-4 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors"
                      >
                        Open contest
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-muted-foreground text-xs sm:text-sm">
        Showing {rows.length} of {rows.length}
      </p>
    </div>
  )
}
