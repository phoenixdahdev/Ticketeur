'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'

import { Button } from '@ticketur/ui/components/button'

import { useTRPC } from '@/lib/trpc'
import { BackButton } from '@/components/dashboard/users/back-button'
import { FormModDetail } from '@/components/dashboard/moderation/form-mod-detail'

export function FormModDetailContent({ id }: { id: string }) {
  const trpc = useTRPC()
  const { data, isLoading, isError } = useQuery(
    trpc.admin.moderation.formById.queryOptions(
      { id },
      {
        // Approving approves the revision on screen, so the questions must
        // not change under the admin while they read: no background
        // refetching, and no cached copy from an earlier visit. The form
        // reloads only after a decision fails (it changed, or someone else
        // decided), and the notice below then says so.
        staleTime: Infinity,
        gcTime: 0,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      }
    )
  )

  // The revision first shown, to tell the admin when a reload replaced it.
  const [firstRevision, setFirstRevision] = useState<number | null>(null)
  if (data && firstRevision === null) setFirstRevision(data.revision)

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <div className="bg-muted h-9 w-32 animate-pulse rounded-md" />
        <div className="bg-muted aspect-[1360/360] w-full animate-pulse rounded-2xl" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-muted h-24 animate-pulse rounded-2xl" />
        ))}
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="border-border/60 bg-background flex flex-col items-center gap-4 rounded-2xl border p-10 text-center">
        <p className="text-muted-foreground text-sm">
          {isError
            ? 'This form could not be loaded.'
            : 'This form no longer exists — its organizer may have deleted it.'}
        </p>
        <Button asChild variant="outline">
          <Link href="/moderation?tab=forms">Back to pending forms</Link>
        </Button>
      </div>
    )
  }

  return (
    <>
      <BackButton label="Back" />
      <FormModDetail
        form={data}
        changedWhileOpen={
          firstRevision !== null && data.revision !== firstRevision
        }
      />
    </>
  )
}
