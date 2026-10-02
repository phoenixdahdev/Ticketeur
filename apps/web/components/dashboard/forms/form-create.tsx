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
import { eventAcceptsForms } from '@/lib/org-forms'
import { Notice } from '@/components/dashboard/forms/review-notice'
import {
  EMPTY_SETTINGS,
  SettingsFields,
  validateSettings,
  type SettingsErrors,
  type SettingsValues,
} from '@/components/dashboard/forms/form-settings-fields'

// Step one of building a form: pick the event and write the settings. The
// questions are added next, on the builder, because a form can't be submitted
// for review without at least one of them.
export function FormCreateContent({ eventId }: { eventId: string | null }) {
  const trpc = useTRPC()
  const router = useRouter()
  const queryClient = useQueryClient()

  const [values, setValues] = useState<SettingsValues>(EMPTY_SETTINGS)
  const [selectedEvent, setSelectedEvent] = useState(eventId ?? '')
  const [errors, setErrors] = useState<SettingsErrors & { eventId?: string }>(
    {}
  )

  const eventsQuery = useQuery(
    trpc.org.events.list.queryOptions({ tab: 'all', pageSize: 100 })
  )

  // A form can only live on an event that is still the organizer's to run.
  const events = useMemo(
    () => (eventsQuery.data?.rows ?? []).filter(eventAcceptsForms),
    [eventsQuery.data]
  )

  const create = useMutation(
    trpc.org.forms.create.mutationOptions({
      onSuccess: ({ id }) => {
        toast.success('Form created', {
          description: 'Now add the questions applicants will answer.',
        })
        void queryClient.invalidateQueries({
          queryKey: trpc.org.forms.list.queryKey(),
        })
        router.push(`/org/forms/${id}`)
      },
      onError: (err) =>
        toast.error('Could not create the form', { description: err.message }),
    })
  )

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const result = validateSettings(values)
    const nextErrors: SettingsErrors & { eventId?: string } = result.ok
      ? {}
      : { ...result.errors }
    if (!selectedEvent) nextErrors.eventId = 'Choose the event this form is for'
    setErrors(nextErrors)
    if (!result.ok || !selectedEvent) return
    create.mutate({ eventId: selectedEvent, ...result.input })
  }

  const noEvents = !eventsQuery.isLoading && events.length === 0

  return (
    <div className="flex min-h-0 flex-1 [scrollbar-width:none] flex-col gap-6 overflow-y-auto md:gap-8 [&::-webkit-scrollbar]:hidden">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <Link
          href="/org/forms"
          className="text-foreground hover:text-primary inline-flex items-center gap-1.5 text-sm font-medium transition-colors"
        >
          <HugeiconsIcon
            icon={ArrowLeft01Icon}
            className="size-4"
            strokeWidth={2}
          />
          Back to forms
        </Link>
      </div>

      <header className="flex shrink-0 flex-col gap-1.5">
        <h1 className="font-heading text-foreground text-2xl font-bold tracking-tight md:text-[28px]">
          New Registration Form
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          Set it up here, write the questions next. Nothing is visible to
          applicants until you submit it and an admin approves the questions.
        </p>
      </header>

      {noEvents ? (
        <Notice tone="muted" title="You have no event that can take a form">
          <p>
            Forms live on an event that is still running. Create an event — or
            un-archive one — and come back.
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
          <FieldLabel htmlFor="form-event" className="text-sm font-semibold">
            Event
          </FieldLabel>
          <NativeSelect
            id="form-event"
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
            An event can carry several forms — a contestant form and a vendor
            form, say. This cannot be changed later.
          </FieldDescription>
          <FieldError
            errors={[errors.eventId ? { message: errors.eventId } : undefined]}
          />
        </Field>

        <SettingsFields
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
            {create.isPending ? 'Creating…' : 'Create and add questions'}
          </Button>
          <Button
            type="button"
            size="xl"
            variant="outline"
            asChild
            className="w-full sm:w-auto"
          >
            <Link href="/org/forms">Cancel</Link>
          </Button>
        </div>
      </form>
    </div>
  )
}
