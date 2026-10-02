'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowRight01Icon,
  Calendar03Icon,
  File01Icon,
  Location01Icon,
} from '@hugeicons/core-free-icons'

import { cn } from '@ticketur/ui/lib/utils'
import { Button } from '@ticketur/ui/components/button'

import { useTRPC } from '@/lib/trpc'
import { formatEventDate } from '@/lib/event-display'
import {
  APPLICATION_STATUS_LABEL,
  APPLICATION_STATUS_TONE,
  applicationPath,
  formatFee,
  type ApplicationRow,
} from '@/lib/account-applications'

const PLACEHOLDER = '/hero-bg.png'

// Everything the signed-in account has applied to, newest first. The reason
// this screen exists: the confirmation email used to be the only copy of an
// applicant's reference and the only way to learn what happened to them.
export function MyApplicationsContent() {
  const trpc = useTRPC()
  const { data, isLoading } = useQuery(
    trpc.account.submissions.list.queryOptions()
  )

  const applications = data ?? []
  // Unfinished payments first: they are the only rows with something for the
  // applicant to do, and the spot behind them is not held forever.
  const unpaid = applications.filter((a) => a.status === 'pending_payment')
  const rest = applications.filter((a) => a.status !== 'pending_payment')

  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-5 py-8 md:gap-8 md:px-10 md:py-12">
      <header className="flex flex-col gap-1.5">
        <h1 className="font-heading text-foreground text-2xl font-bold tracking-tight md:text-[32px]">
          My applications
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          Every form you&apos;ve applied to on Ticketeur, and where each one
          stands.
        </p>
      </header>

      {isLoading ? (
        <div className="flex flex-col gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-muted h-36 animate-pulse rounded-2xl" />
          ))}
        </div>
      ) : applications.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {unpaid.length > 0 ? (
            <Group title="Waiting on your payment">
              <div className="flex flex-col gap-4">
                {unpaid.map((application) => (
                  <ApplicationCard
                    key={application.id}
                    application={application}
                  />
                ))}
              </div>
            </Group>
          ) : null}
          {rest.length > 0 ? (
            <Group title={unpaid.length > 0 ? 'Everything else' : 'Sent'}>
              <div className="flex flex-col gap-4">
                {rest.map((application) => (
                  <ApplicationCard
                    key={application.id}
                    application={application}
                  />
                ))}
              </div>
            </Group>
          ) : null}
        </>
      )}
    </section>
  )
}

function Group({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-heading text-foreground text-lg font-bold tracking-tight md:text-xl">
        {title}
      </h2>
      {children}
    </section>
  )
}

function ApplicationCard({ application }: { application: ApplicationRow }) {
  const { event, form, option, payment } = application
  // What they actually paid, which is the option's price plus the platform's
  // service fee — not the sticker price on the form.
  const paid = payment && payment.status === 'paid' ? payment.totalMinor : null

  return (
    <Link
      href={applicationPath(application.id)}
      className={cn(
        'group border-border bg-card hover:border-primary/40 focus-visible:ring-primary/40 flex flex-col overflow-hidden rounded-2xl border shadow-sm transition-all outline-none hover:shadow-md focus-visible:ring-2 sm:flex-row',
        application.status === 'rejected' && 'opacity-80'
      )}
    >
      <div className="bg-muted relative h-36 shrink-0 sm:h-auto sm:w-44">
        <Image
          src={event.bannerUrl ?? PLACEHOLDER}
          alt=""
          fill
          sizes="(min-width: 640px) 176px, 100vw"
          className="object-cover transition-transform duration-500 group-hover:scale-[1.04]"
          unoptimized={Boolean(event.bannerUrl?.startsWith('data:'))}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-3 p-4 md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <span
              className={cn(
                'inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-wider uppercase',
                APPLICATION_STATUS_TONE[application.status]
              )}
            >
              {APPLICATION_STATUS_LABEL[application.status]}
            </span>
            <h3 className="font-heading text-foreground text-base font-bold tracking-tight md:text-lg">
              {form.title}
            </h3>
            <p className="text-muted-foreground truncate text-xs md:text-sm">
              {event.title}
              {option ? ` · ${option.name}` : ''}
            </p>
          </div>
          <span className="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase">
            {application.reference}
          </span>
        </div>

        <ul className="text-muted-foreground flex flex-wrap gap-x-5 gap-y-1.5 text-xs sm:text-sm">
          <Meta
            icon={Calendar03Icon}
            value={formatEventDate(event.eventDate, event.endDate)}
          />
          <Meta icon={Location01Icon} value={event.location} />
        </ul>

        <div className="border-border/60 flex flex-wrap items-center justify-between gap-3 border-t pt-3">
          <span className="text-muted-foreground text-xs">
            {paid !== null
              ? `Paid ${formatFee(paid)}`
              : application.canResumePayment && payment
                ? `${formatFee(payment.totalMinor)} to pay`
                : 'Free application'}
            {` · Applied ${new Date(application.createdAt).toLocaleDateString(
              'en-US',
              { month: 'short', day: '2-digit', year: 'numeric' }
            )}`}
          </span>
          <span className="text-primary inline-flex items-center gap-1 text-sm font-semibold transition-colors">
            {application.canResumePayment ? 'Finish paying' : 'View'}
            <HugeiconsIcon
              icon={ArrowRight01Icon}
              className="size-4 transition-transform group-hover:translate-x-0.5"
              strokeWidth={2}
            />
          </span>
        </div>
      </div>
    </Link>
  )
}

function Meta({
  icon,
  value,
}: {
  icon: Parameters<typeof HugeiconsIcon>[0]['icon']
  value: string
}) {
  return (
    <li className="inline-flex items-center gap-1.5">
      <HugeiconsIcon icon={icon} className="size-3.5" strokeWidth={1.8} />
      {value}
    </li>
  )
}

function EmptyState() {
  return (
    <div className="border-border bg-muted/30 flex min-h-72 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed p-10 text-center">
      <span className="bg-primary/10 text-primary flex size-14 items-center justify-center rounded-full">
        <HugeiconsIcon
          icon={File01Icon}
          className="size-6"
          strokeWidth={1.6}
        />
      </span>
      <h2 className="font-heading text-foreground text-lg font-bold tracking-tight">
        No applications yet
      </h2>
      <p className="text-muted-foreground max-w-md text-sm leading-6">
        Some events take applications — to be a contestant, to run a stall, to
        volunteer. When you apply to one, it shows up here with its reference
        and what the organizer decided.
      </p>
      <Button asChild size="xl" className="mt-2">
        <Link href="/events">Browse events</Link>
      </Button>
    </div>
  )
}
