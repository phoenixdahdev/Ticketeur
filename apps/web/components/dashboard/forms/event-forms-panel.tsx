'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { PlusSignIcon, UserGroupIcon } from '@hugeicons/core-free-icons'

import { Button } from '@ticketur/ui/components/button'

import { useTRPC } from '@/lib/trpc'
import { FORM_TYPE_LABEL, intakeWindowLabel, plural } from '@/lib/org-forms'
import { FormStatusBadge } from '@/components/dashboard/forms/review-notice'

// The registration forms attached to one event, on that event's own page —
// the other way organizers reach them, besides the sidebar.
export function EventFormsPanel({ eventId }: { eventId: string }) {
  const trpc = useTRPC()
  const { data, isLoading } = useQuery(
    trpc.org.forms.list.queryOptions({ eventId })
  )
  const forms = data ?? []

  return (
    <div className="flex flex-col gap-3">
      {isLoading ? (
        <p className="text-muted-foreground text-sm">Loading forms…</p>
      ) : forms.length === 0 ? (
        <div className="border-border/60 flex flex-col items-start gap-3 rounded-2xl border border-dashed p-6">
          <p className="text-muted-foreground text-sm">
            No registration forms on this event yet. Add one to take contestant
            or vendor sign-ups — an admin approves the questions before it goes
            live.
          </p>
          <Button asChild variant="outline" className="gap-1.5">
            <Link href={`/org/forms/new?eventId=${eventId}`}>
              <HugeiconsIcon
                icon={PlusSignIcon}
                className="size-4"
                strokeWidth={2}
              />
              New form
            </Link>
          </Button>
        </div>
      ) : (
        <>
          <ul className="border-border/60 bg-background divide-border/60 flex flex-col divide-y overflow-hidden rounded-2xl border">
            {forms.map((form) => (
              <li
                key={form.id}
                className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:gap-5"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/org/forms/${form.id}`}
                      className="text-foreground hover:text-primary text-sm font-semibold transition-colors"
                    >
                      {form.title}
                    </Link>
                    <FormStatusBadge status={form.status} />
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {FORM_TYPE_LABEL[form.type]} · {intakeWindowLabel(form)}
                  </p>
                  {form.status === 'rejected' && form.rejectionReason ? (
                    <p className="line-clamp-2 text-xs text-rose-600 dark:text-rose-400">
                      {form.rejectionReason}
                    </p>
                  ) : null}
                </div>

                <Link
                  href={`/org/forms/${form.id}/submissions`}
                  className="text-primary hover:text-primary/80 inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold transition-colors"
                >
                  <HugeiconsIcon
                    icon={UserGroupIcon}
                    className="size-4"
                    strokeWidth={1.8}
                  />
                  {plural(form.total, 'application')}
                  {form.submitted > 0 ? ` · ${form.submitted} to review` : ''}
                </Link>
              </li>
            ))}
          </ul>
          <div>
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link href={`/org/forms/new?eventId=${eventId}`}>
                <HugeiconsIcon
                  icon={PlusSignIcon}
                  className="size-4"
                  strokeWidth={2}
                />
                New form
              </Link>
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
