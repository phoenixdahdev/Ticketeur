import Link from 'next/link'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Alert02Icon,
  Clock01Icon,
  UserGroupIcon,
} from '@hugeicons/core-free-icons'
import type { IconSvgElement } from '@hugeicons/react'

import { Button } from '@ticketur/ui/components/button'

import { formatLongDate } from '@/lib/date'
import { FormEventHeader } from '@/components/sections/forms/form-event-header'
import type { UnavailableForm } from '@/components/sections/forms/types'

// Not open yet / closed / full.
//
// bySlug withholds the fields in these states, so there is nothing to fill in
// and nothing here pretends otherwise. Each reason gets its own words: "come
// back on the 14th", "this one has closed" and "every spot is taken" lead to
// three different next actions, and a single "unavailable" would strand
// everyone.
function describe(data: UnavailableForm): {
  icon: IconSvgElement
  eyebrow: string
  title: string
  body: string
} {
  const { form, event } = data
  switch (data.reason) {
    case 'not_open': {
      const opens = form.opensAt ? formatLongDate(form.opensAt) : null
      return {
        icon: Clock01Icon,
        eyebrow: 'Not open yet',
        title: opens ? `Applications open ${opens}` : 'Applications open soon',
        body: opens
          ? `${form.title} isn't taking applications yet. Come back on ${opens} — the questions appear here the moment it opens.`
          : `${form.title} isn't taking applications yet. The organizer hasn't set an opening date, so check back here or follow ${event.title} for the announcement.`,
      }
    }
    case 'closed': {
      const closed = form.closesAt ? formatLongDate(form.closesAt) : null
      return {
        icon: Alert02Icon,
        eyebrow: 'Closed',
        title: 'Applications have closed',
        body: closed
          ? `${form.title} stopped taking applications on ${closed}. If you already applied, your reference and the organizer's decision come by email.`
          : `${form.title} is no longer taking applications. If you already applied, your reference and the organizer's decision come by email.`,
      }
    }
    case 'full':
      return {
        icon: UserGroupIcon,
        eyebrow: 'Full',
        title: 'Every spot is taken',
        body: `${form.title} has filled up, so it isn't accepting any more applications. Spots sometimes reopen when an application is turned down — it's worth checking back.`,
      }
  }
}

export function FormUnavailable({ data }: { data: UnavailableForm }) {
  const { icon, eyebrow, title, body } = describe(data)

  return (
    <div className="flex flex-col gap-8">
      <FormEventHeader form={data.form} event={data.event} />

      <section className="border-border bg-card flex flex-col items-center gap-4 rounded-2xl border p-8 text-center md:p-10">
        <span className="bg-muted text-muted-foreground flex size-14 items-center justify-center rounded-full">
          <HugeiconsIcon icon={icon} className="size-7" strokeWidth={1.8} />
        </span>
        <p className="text-muted-foreground text-xs font-bold tracking-[0.2em] uppercase">
          {eyebrow}
        </p>
        <h2 className="font-heading text-foreground text-2xl font-bold tracking-tight">
          {title}
        </h2>
        <p className="text-muted-foreground max-w-prose text-sm leading-6">
          {body}
        </p>
        <div className="mt-2 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          <Button asChild size="xl">
            <Link href={`/events/${data.event.slug}`}>
              Back to {data.event.title}
            </Link>
          </Button>
          <Button asChild variant="outline" size="xl">
            <Link href="/events">Browse events</Link>
          </Button>
        </div>
      </section>
    </div>
  )
}

// A form that disappeared from under the applicant: its organizer edited it,
// which sends it back for admin review and stops intake at once. It is no
// longer a public form, so bySlug answers null — but we know it was there a
// moment ago, which makes "not found" the wrong thing to say.
export function FormWithdrawn({ slug }: { slug: string }) {
  return (
    <section className="border-border bg-card flex flex-col items-center gap-4 rounded-2xl border p-8 text-center md:p-10">
      <span className="bg-muted text-muted-foreground flex size-14 items-center justify-center rounded-full">
        <HugeiconsIcon
          icon={Alert02Icon}
          className="size-7"
          strokeWidth={1.8}
        />
      </span>
      <h2 className="font-heading text-foreground text-2xl font-bold tracking-tight">
        This form was just taken down
      </h2>
      <p className="text-muted-foreground max-w-prose text-sm leading-6">
        The organizer is editing it, so it has stopped taking applications while
        it is checked over. Your answers are still saved on this device — come
        back to this page once it reopens and they will be here.
      </p>
      <p className="text-muted-foreground font-mono text-xs">/forms/{slug}</p>
      <Button asChild size="xl" className="mt-2">
        <Link href="/events">Browse events</Link>
      </Button>
    </section>
  )
}
