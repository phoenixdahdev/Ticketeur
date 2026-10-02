'use client'

import { useQuery } from '@tanstack/react-query'

import { Skeleton } from '@ticketur/ui/components/skeleton'

import { useTRPC } from '@/lib/trpc'
import { FormApply } from '@/components/sections/forms/form-apply'
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
  const { data, isLoading, refetch } = useQuery(
    trpc.public.forms.bySlug.queryOptions({ slug })
  )

  if (isLoading) return <FormPageSkeleton />

  // The page only renders at all because the server found this form, so null
  // here means it stopped being public while someone was looking at it —
  // which is what an organizer's edit does, since it sends the form back for
  // review. Never a 404 at this point.
  if (!data) return <FormWithdrawn slug={slug} />

  if (data.state === 'unavailable') return <FormUnavailable data={data} />

  return (
    <div className="flex flex-col gap-8">
      <FormEventHeader form={data.form} event={data.event} />
      <FormApply data={data} slug={slug} onRefetch={() => void refetch()} />
    </div>
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
