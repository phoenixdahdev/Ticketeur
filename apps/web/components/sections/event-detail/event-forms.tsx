'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'

import { useTRPC } from '@/lib/trpc'
import { formatLongDate } from '@/lib/date'

// The way a human finds a registration form.
//
// Until this, a published form was reachable only by somebody who already had
// /forms/{slug} — out of an email, a WhatsApp forward, a flyer. An event page
// that says nothing about the registration its own organizer has opened is
// the reason a form can be live and empty.
//
// Deliberately plain: a line of context, then the application's own name as
// the link. A visitor scanning the page should see what they can apply for
// and click it, without a card competing with the ticket panel beside it.
//
// Renders nothing when the event has no public form, which is most of them:
// an absent section reads better than an empty one.
export function EventForms({ slug }: { slug: string }) {
  const trpc = useTRPC()
  const { data } = useQuery(
    trpc.public.formDiscovery.forEvent.queryOptions({ eventSlug: slug })
  )

  if (!data || data.length === 0) return null

  return (
    <section
      aria-label="Register for this event"
      className="w-full px-5 pt-6 md:px-10 md:pt-8"
    >
      <div className="border-border bg-card mx-auto max-w-[1440px] rounded-2xl border p-5 md:p-6">
        <h2 className="font-heading text-foreground text-lg font-semibold tracking-tight">
          Take part in this event
        </h2>
        <p className="text-muted-foreground mt-1 text-sm leading-6">
          {data.length === 1
            ? 'The organizer is accepting applications. Open it to see what they are asking for.'
            : 'The organizer is accepting applications. Open one to see what they are asking for.'}
        </p>

        <ul className="mt-4 flex flex-col gap-2.5">
          {data.map((form) => {
            const note = statusNote(form)
            return (
              <li key={form.slug} className="text-sm leading-6">
                <Link
                  href={`/forms/${form.slug}`}
                  className="text-primary hover:text-primary/80 font-semibold underline underline-offset-4 transition-colors"
                >
                  {form.title}
                </Link>
                {note ? (
                  <span className="text-muted-foreground"> — {note}</span>
                ) : null}
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}

type DiscoveredForm = {
  open: boolean
  reason: string | null
  opensAt: Date | null
  closesAt: Date | null
}

// Only says something when there is something to say. An open form with no
// deadline is just its name — the link is the whole message.
//
// `open` is decided by the SERVER with the same rule the form page applies,
// so this line and the page behind it cannot disagree about whether somebody
// can still apply.
function statusNote(form: DiscoveredForm): string | null {
  if (form.open) {
    return form.closesAt ? `closes ${formatLongDate(form.closesAt)}` : null
  }
  if (form.reason === 'not_open_yet') {
    return form.opensAt
      ? `opens ${formatLongDate(form.opensAt)}`
      : 'not open yet'
  }
  if (form.reason === 'full') return 'every place has been taken'
  return 'closed'
}
