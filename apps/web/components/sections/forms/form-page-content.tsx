'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { WifiDisconnected01Icon } from '@hugeicons/core-free-icons'

import { Button } from '@ticketur/ui/components/button'
import { Skeleton } from '@ticketur/ui/components/skeleton'

import { useTRPC } from '@/lib/trpc'
import {
  FormApply,
  type SubmittedApplication,
} from '@/components/sections/forms/form-apply'
import { FormSubmitted } from '@/components/sections/forms/form-submitted'
import { FormEventHeader } from '@/components/sections/forms/form-event-header'
import {
  FormUnavailable,
  FormWithdrawn,
} from '@/components/sections/forms/form-unavailable'

// The public form page.
//
// bySlug answers in three shapes and all three land here. The input below has
// to match the server prefetch in app/(app)/forms/[slug]/page.tsx exactly, or
// the query key differs and the prefetch is quietly wasted.
export function FormPageContent({ slug }: { slug: string }) {
  const trpc = useTRPC()
  const { data, isLoading, isError, isFetching, refetch } = useQuery(
    trpc.public.forms.bySlug.queryOptions({ slug })
  )
  const [submitted, setSubmitted] = useState<SubmittedApplication | null>(null)

  // Checked before anything else. An application that went through has a
  // reference the applicant has to keep, and no later read of the form — one
  // that now says 'full' because they took the last spot, a refetch on window
  // focus, a dropped connection — gets to replace it.
  if (submitted) {
    return (
      <FormSubmitted
        result={submitted.result}
        formTitle={submitted.formTitle}
        event={submitted.event}
        email={submitted.email}
      />
    )
  }

  if (isLoading) return <FormPageSkeleton />

  // A connection that dropped, not a form that went away. Worth separating:
  // this page is read on phone data, and telling someone their form was taken
  // down when the train went into a tunnel would be a lie they act on.
  if (isError) {
    return (
      <FormLoadFailed onRetry={() => void refetch()} retrying={isFetching} />
    )
  }

  // The page only renders at all because the server found this form, so null
  // here means it stopped being public while someone was looking at it —
  // which is what an organizer's edit does, since it sends the form back for
  // review. Never a 404 at this point.
  if (!data) return <FormWithdrawn slug={slug} />

  if (data.state === 'unavailable') return <FormUnavailable data={data} />

  return (
    <div className="flex flex-col gap-8">
      <FormEventHeader form={data.form} event={data.event} />
      <FormApply
        data={data}
        slug={slug}
        onRefetch={() => void refetch()}
        onSubmitted={setSubmitted}
      />
    </div>
  )
}

function FormLoadFailed({
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
        We couldn&apos;t load this form
      </h2>
      <p className="text-muted-foreground max-w-prose text-sm leading-6">
        Check your connection and try again. Anything you had already filled in
        is still saved on this device.
      </p>
      <Button type="button" size="xl" onClick={onRetry} disabled={retrying}>
        {retrying ? 'Trying…' : 'Try again'}
      </Button>
    </section>
  )
}

export function FormPageSkeleton() {
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
      <div className="flex flex-col gap-7">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex flex-col gap-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-10 w-full" />
          </div>
        ))}
      </div>
    </div>
  )
}
