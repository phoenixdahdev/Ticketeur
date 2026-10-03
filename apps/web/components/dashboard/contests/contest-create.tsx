'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowLeft01Icon } from '@hugeicons/core-free-icons'

import { Button } from '@ticketur/ui/components/button'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@ticketur/ui/components/field'
import {
  NativeSelect,
  NativeSelectOption,
} from '@ticketur/ui/components/native-select'

import { useTRPC } from '@/lib/trpc'
import { eventAcceptsContests } from '@/lib/org-contests'
import { Notice } from '@/components/dashboard/forms/review-notice'
import {
  ContestSettingsFields,
  emptyContestSettings,
  validateContestSettings,
  type ContestSettingsErrors,
  type ContestSettingsValues,
} from '@/components/dashboard/contests/contest-settings-fields'

// Step one of building a contest: pick the event and write the settings. The
// categories and the ballot come next, on the editor, because a contest
// cannot be submitted for review until there is at least one category to
// vote in.
export function ContestCreateContent({ eventId }: { eventId: string | null }) {
  const trpc = useTRPC()
  const router = useRouter()
  const queryClient = useQueryClient()

  const [values, setValues] =
    useState<ContestSettingsValues>(emptyContestSettings)
  const [selectedEvent, setSelectedEvent] = useState(eventId ?? '')
  const [errors, setErrors] = useState<
    ContestSettingsErrors & { eventId?: string }
  >({})

  const eventsQuery = useQuery(
    trpc.org.events.list.queryOptions({ tab: 'all', pageSize: 100 })
  )

  // A contest can only live on an event that is still the organizer's to run.
  const events = useMemo(
    () => (eventsQuery.data?.rows ?? []).filter(eventAcceptsContests),
    [eventsQuery.data]
  )

  const create = useMutation(
    trpc.org.contests.create.mutationOptions({
      onSuccess: ({ id }) => {
        toast.success('Contest created', {
          description: 'Now add the categories people will vote in.',
        })
        void queryClient.invalidateQueries({
          queryKey: trpc.org.contests.list.queryKey(),
        })
        router.push(`/org/contests/${id}`)
      },
      onError: (err) =>
        toast.error('Could not create the contest', {
          description: err.message,
        }),
    })
  )

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const result = validateContestSettings(values)
    const nextErrors: ContestSettingsErrors & { eventId?: string } = result.ok
      ? {}
      : { ...result.errors }
    if (!selectedEvent) {
      nextErrors.eventId = 'Choose the event this contest belongs to'
    }
    setErrors(nextErrors)
    if (!result.ok || !selectedEvent) return
    create.mutate({ eventId: selectedEvent, ...result.input })
  }

  const noEvents = !eventsQuery.isLoading && events.length === 0

  return (
    <div className="flex min-h-0 flex-1 [scrollbar-width:none] flex-col gap-6 overflow-y-auto md:gap-8 [&::-webkit-scrollbar]:hidden">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <Link
          href="/org/contests"
          className="text-foreground hover:text-primary inline-flex items-center gap-1.5 text-sm font-medium transition-colors"
        >
          <HugeiconsIcon
            icon={ArrowLeft01Icon}
            className="size-4"
            strokeWidth={2}
          />
          Back to contests
        </Link>
      </div>

      <header className="flex shrink-0 flex-col gap-1.5">
        <h1 className="font-heading text-foreground text-2xl font-bold tracking-tight md:text-[28px]">
          New Contest
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          Set it up here, build the ballot next. Nothing is visible to voters
          until you submit it and an admin approves it.
        </p>
      </header>

      {noEvents ? (
        <Notice tone="muted" title="You have no event that can carry a contest">
          <p>
            Contests live on an event that is still running. Create an event —
            or un-archive one — and come back.
          </p>
          <p className="mt-2">
            <Link href="/org/create-event" className="font-semibold">
              Create an event
            </Link>
          </p>
        </Notice>
      ) : null}

      <form
        onSubmit={onSubmit}
        noValidate
        className="border-border/60 bg-background flex shrink-0 flex-col gap-5 rounded-2xl border p-5 md:p-6"
      >
        <Field data-invalid={errors.eventId ? true : undefined}>
          <FieldLabel htmlFor="contest-event" className="text-sm font-semibold">
            Event
          </FieldLabel>
          <NativeSelect
            id="contest-event"
            className="w-full"
            value={selectedEvent}
            disabled={create.isPending || eventsQuery.isLoading || noEvents}
            onChange={(e) => setSelectedEvent(e.target.value)}
            aria-invalid={Boolean(errors.eventId)}
          >
            <NativeSelectOption value="">
              {eventsQuery.isLoading ? 'Loading events…' : 'Choose an event'}
            </NativeSelectOption>
            {events.map((event) => (
              <NativeSelectOption key={event.id} value={event.id}>
                {event.title}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <FieldDescription>
            An event can carry several contests. This cannot be changed later.
          </FieldDescription>
          <FieldError
            errors={[errors.eventId ? { message: errors.eventId } : undefined]}
          />
        </Field>

        <ContestSettingsFields
          values={values}
          onChange={setValues}
          errors={errors}
          disabled={create.isPending || noEvents}
        />

        <div className="flex flex-col gap-3 pt-2 sm:flex-row">
          <Button
            type="submit"
            size="xl"
            disabled={create.isPending || noEvents}
            className="w-full sm:w-auto"
          >
            {create.isPending ? 'Creating…' : 'Create and build the ballot'}
          </Button>
          <Button
            type="button"
            size="xl"
            variant="outline"
            asChild
            className="w-full sm:w-auto"
          >
            <Link href="/org/contests">Cancel</Link>
          </Button>
        </div>
      </form>
    </div>
  )
}
