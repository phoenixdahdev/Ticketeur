'use client'

import Link from 'next/link'
import Image from 'next/image'

import type { RouterOutputs } from '@ticketur/api'

import { formatShortDate as formatDate } from '@/lib/date'

type PendingForm = RouterOutputs['admin']['moderation']['pendingForms'][number]

const HISTORY_LABEL: Record<PendingForm['history'], string | null> = {
  new: null,
  resubmitted: 'Resubmitted',
  edited: 'Changed after approval',
}

// A form is approved only after reading every question it asks, so each row
// links to the review screen rather than approving inline.
export function ModerationFormsTable({
  rows,
  loading,
}: {
  rows: PendingForm[]
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
                <th className="px-5 py-4 text-left">Submitted</th>
                <th className="px-5 py-4 text-left">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-border/60 divide-y">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center">
                    <p className="text-muted-foreground text-sm">
                      Loading pending forms…
                    </p>
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center">
                    <p className="text-muted-foreground text-sm">
                      No registration forms waiting for review.
                    </p>
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const history = HISTORY_LABEL[row.history]
                  return (
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
                            <span className="text-muted-foreground flex items-center gap-2 text-xs">
                              {row.fieldCount} question
                              {row.fieldCount === 1 ? '' : 's'}
                              {history ? (
                                <span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-[10px] font-semibold">
                                  {history}
                                </span>
                              ) : null}
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
                        {formatDate(row.submittedAt)}
                      </td>
                      <td className="px-5 py-4">
                        <Link
                          href={`/moderation/form/${row.id}`}
                          className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center rounded-md px-4 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors"
                        >
                          Review form
                        </Link>
                      </td>
                    </tr>
                  )
                })
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
