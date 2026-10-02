import Image from 'next/image'
import Link from 'next/link'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Calendar03Icon,
  Clock01Icon,
  Location01Icon,
} from '@hugeicons/core-free-icons'

import { formatEventDate } from '@/lib/event-display'
import type {
  FormEventSummary,
  FormSummary,
} from '@/components/sections/forms/types'

const FORM_TYPE_LABEL: Record<string, string> = {
  contestant: 'Contestant entry',
  vendor: 'Vendor application',
  other: 'Application',
}

// What the applicant is applying to, before what they have to fill in. Someone
// arriving from a WhatsApp forward has no other way to tell whose event this
// is or when it runs.
export function FormEventHeader({
  form,
  event,
}: {
  form: FormSummary
  event: FormEventSummary
}) {
  return (
    <header className="flex flex-col gap-5">
      <div className="border-border bg-card relative overflow-hidden rounded-2xl border">
        <div className="bg-muted relative aspect-[16/7] w-full sm:aspect-[16/5]">
          {event.bannerUrl ? (
            <Image
              src={event.bannerUrl}
              alt=""
              fill
              sizes="(max-width: 768px) 100vw, 720px"
              className="object-cover"
              unoptimized={event.bannerUrl.startsWith('data:')}
              priority
            />
          ) : (
            <div className="from-primary/30 to-background absolute inset-0 bg-linear-to-br" />
          )}
        </div>

        <div className="flex flex-col gap-3 p-5 md:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="bg-primary/10 text-primary rounded px-2 py-0.5 text-[11px] font-bold tracking-wider uppercase">
              {FORM_TYPE_LABEL[form.type] ?? FORM_TYPE_LABEL.other}
            </span>
            <Link
              href={`/events/${event.slug}`}
              className="text-muted-foreground hover:text-primary text-xs font-medium underline-offset-4 hover:underline"
            >
              View event
            </Link>
          </div>

          <div className="flex flex-col gap-1">
            <h1 className="font-heading text-foreground text-2xl font-bold tracking-tight md:text-3xl">
              {form.title}
            </h1>
            <p className="text-muted-foreground text-sm">
              for{' '}
              <span className="text-foreground font-medium">{event.title}</span>
            </p>
          </div>

          <dl className="text-muted-foreground flex flex-col gap-1.5 text-sm sm:flex-row sm:flex-wrap sm:gap-x-5">
            <div className="flex items-center gap-2">
              <HugeiconsIcon
                icon={Calendar03Icon}
                className="text-primary size-4 shrink-0"
                strokeWidth={1.8}
              />
              <dt className="sr-only">Event date</dt>
              <dd>{formatEventDate(event.eventDate, event.endDate)}</dd>
            </div>
            {event.eventTime ? (
              <div className="flex items-center gap-2">
                <HugeiconsIcon
                  icon={Clock01Icon}
                  className="text-primary size-4 shrink-0"
                  strokeWidth={1.8}
                />
                <dt className="sr-only">Start time</dt>
                <dd>{event.eventTime}</dd>
              </div>
            ) : null}
            <div className="flex items-center gap-2">
              <HugeiconsIcon
                icon={Location01Icon}
                className="text-primary size-4 shrink-0"
                strokeWidth={1.8}
              />
              <dt className="sr-only">Location</dt>
              <dd className="truncate">{event.location}</dd>
            </div>
          </dl>
        </div>
      </div>

      {form.description ? (
        <p className="text-muted-foreground text-sm leading-6 whitespace-pre-line md:text-base">
          {form.description}
        </p>
      ) : null}
    </header>
  )
}
