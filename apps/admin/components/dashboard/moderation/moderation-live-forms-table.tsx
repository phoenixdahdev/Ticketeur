'use client'

import Link from 'next/link'
import Image from 'next/image'

import type { RouterOutputs } from '@ticketur/api'

import { formatShortDate as formatDate } from '@/lib/date'

type LiveForm = RouterOutputs['admin']['moderation']['liveForms'][number]

const STATUS_LABEL: Record<LiveForm['status'], string> = {
  published: 'Taking applications',
  closed: 'Closed, page still public',
}

const STATUS_TONE: Record<LiveForm['status'], string> = {
  published:
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
  closed: 'bg-muted text-muted-foreground',
}

// Forms the public can reach. The queue next door is for forms waiting on a
// decision; this is for the ones already live, which is where a question that
// got past review, or a form that turns out to be fraudulent, has to be found
// before it can be taken down.
export function ModerationLiveFormsTable({
  rows,
  loading,
}: {
  rows: LiveForm[]
  loading: boolean
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="border-border/60 bg-background overflow-hidden rounded-2xl border">
        <div className="[scrollbar-width:none] overflow-x-auto [&::-webkit-scrollbar]:hidden">
          <table className="w-full min-w-[760px] table-auto">
            <thead className="bg-primary/5">
              <tr className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                <th className="px-5 py-4 text-left">Form</th>
                <th className="px-5 py-4 text-left">Event</th>
                <th className="px-5 py-4 text-left">Organizer</th>
                <th className="px-5 py-4 text-left">Applications</th>
                <th className="px-5 py-4 text-left">Approved</th>
                <th className="px-5 py-4 text-left">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-border/60 divide-y">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center">
                    <p className="text-muted-foreground text-sm">
                      Loading live forms…
                    </p>
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center">
                    <p className="text-muted-foreground text-sm">
                      No registration forms are public right now.
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
                        href={`/moderation/form/${row.id}`}
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
                              {row.fieldCount} question
                              {row.fieldCount === 1 ? '' : 's'}
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
                      {row.submissionCount.toLocaleString('en-NG')}
                    </td>
                    <td className="text-foreground px-5 py-4 whitespace-nowrap">
                      {formatDate(row.approvedAt)}
                    </td>
                    <td className="px-5 py-4">
                      <Link
                        href={`/moderation/form/${row.id}`}
                        className="border-border/60 text-foreground hover:bg-muted inline-flex items-center rounded-md border px-4 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors"
                      >
                        Open form
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
