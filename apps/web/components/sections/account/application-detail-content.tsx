'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowLeft01Icon,
  Calendar03Icon,
  CheckmarkCircle02Icon,
  Copy01Icon,
  Location01Icon,
  Tick02Icon,
} from '@hugeicons/core-free-icons'

import { cn } from '@ticketur/ui/lib/utils'
import { Button } from '@ticketur/ui/components/button'

import { SubmissionAnswers } from '@/components/forms/submission-answers'
import { useTRPC } from '@/lib/trpc'
import { formatEventDate } from '@/lib/event-display'
import { formatDateTime } from '@/lib/org-forms'
import {
  APPLICATION_STATUS_LABEL,
  APPLICATION_STATUS_MEANING,
  APPLICATION_STATUS_TONE,
  formatFee,
  type ApplicationDetail,
} from '@/lib/account-applications'

// An applicant's own copy of one application: where it stands, what they sent,
// the reference to quote, why it was turned down if it was — and, while its
// fee is unpaid, the way back to the payment they walked away from.
export function ApplicationDetailContent({ id }: { id: string }) {
  const trpc = useTRPC()
  const { data, isLoading } = useQuery(
    trpc.account.submissions.byId.queryOptions({ id })
  )

  if (isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-3xl px-5 py-16">
        <p className="text-muted-foreground text-sm">Loading application…</p>
      </div>
    )
  }

  // null is "no such application of yours" — the API answers the same way for
  // an id that does not exist and one belonging to somebody else, so this
  // message must not imply either.
  if (!data) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-4 px-5 py-16 text-center">
        <h1 className="font-heading text-foreground text-2xl font-bold tracking-tight">
          We couldn&apos;t find that application
        </h1>
        <p className="text-muted-foreground max-w-md text-sm leading-6">
          It may have been removed along with its form, or it belongs to a
          different account. Check you are signed in as the person who applied.
        </p>
        <Button asChild variant="outline" size="xl">
          <Link href="/account/applications">Back to my applications</Link>
        </Button>
      </div>
    )
  }

  return <Detail application={data} />
}

function Detail({ application }: { application: ApplicationDetail }) {
  const { event, form, option, payment, answers } = application
  const [copied, setCopied] = useState(false)

  async function copyReference() {
    try {
      await navigator.clipboard.writeText(application.reference)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access can be refused; the code is on screen regardless.
    }
  }

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-5 py-8 md:gap-8 md:px-8 md:py-12">
      <Link
        href="/account/applications"
        className="text-foreground hover:text-primary inline-flex w-fit items-center gap-1.5 text-sm font-medium transition-colors"
      >
        <HugeiconsIcon
          icon={ArrowLeft01Icon}
          className="size-4"
          strokeWidth={2}
        />
        My applications
      </Link>

      <header className="flex flex-col gap-3">
        <span
          className={cn(
            'inline-flex w-fit items-center rounded-full px-2.5 py-1 text-xs font-semibold',
            APPLICATION_STATUS_TONE[application.status]
          )}
        >
          {APPLICATION_STATUS_LABEL[application.status]}
        </span>
        <h1 className="font-heading text-foreground text-2xl font-bold tracking-tight md:text-[32px]">
          {form.title}
        </h1>
        <p className="text-muted-foreground text-sm leading-6">
          {APPLICATION_STATUS_MEANING[application.status]}
        </p>
        <ul className="text-muted-foreground flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
          <li className="inline-flex items-center gap-1.5">
            <HugeiconsIcon
              icon={Calendar03Icon}
              className="size-4 shrink-0"
              strokeWidth={1.8}
            />
            {formatEventDate(event.eventDate, event.endDate)} ·{' '}
            {event.eventTime}
          </li>
          <li className="inline-flex items-center gap-1.5">
            <HugeiconsIcon
              icon={Location01Icon}
              className="size-4 shrink-0"
              strokeWidth={1.8}
            />
            {event.location}
          </li>
        </ul>
        <Link
          href={`/events/${event.slug}`}
          className="text-primary w-fit text-sm font-semibold hover:underline"
        >
          {event.title}
        </Link>
      </header>

      {application.status === 'rejected' && application.reason ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-100">
          <p className="font-semibold">What the organizer said</p>
          <p className="mt-1 whitespace-pre-wrap">“{application.reason}”</p>
          {payment && payment.status === 'paid' ? (
            <p className="mt-2">
              You paid {formatFee(payment.totalMinor)} for this application.
              Ticketeur refunds registration fees by hand, so it is on our
              refunds list — allow a few working days, and quote the reference
              below if you need to ask about it.
            </p>
          ) : null}
        </div>
      ) : null}

      {application.canResumePayment && payment ? (
        <ResumePayment id={application.id} totalMinor={payment.totalMinor} />
      ) : null}

      <div className="border-border bg-card flex flex-col gap-3 rounded-2xl border p-5 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <p className="text-muted-foreground text-xs font-bold tracking-[0.2em] uppercase">
              Your reference
            </p>
            <p className="font-heading text-foreground text-2xl font-bold tracking-[0.15em] select-all">
              {application.reference}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void copyReference()}
          >
            <HugeiconsIcon
              icon={copied ? Tick02Icon : Copy01Icon}
              strokeWidth={2}
            />
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <dl className="border-border/60 flex flex-col gap-2 border-t pt-3 text-sm">
          <Row label="Applied" value={formatDateTime(application.createdAt)} />
          {option ? <Row label="Option chosen" value={option.name} /> : null}
          {payment ? (
            <>
              {option ? (
                <Row label="Fee" value={formatFee(payment.subtotalMinor)} />
              ) : null}
              {payment.feeMinor > 0 ? (
                <Row label="Service fee" value={formatFee(payment.feeMinor)} />
              ) : null}
              <Row
                label={
                  payment.status === 'paid' ? 'Total paid' : 'Total to pay'
                }
                value={formatFee(payment.totalMinor)}
              />
              {payment.paidAt ? (
                <Row label="Paid on" value={formatDateTime(payment.paidAt)} />
              ) : null}
            </>
          ) : (
            <Row label="Fee" value="Free" />
          )}
          {application.reviewedAt ? (
            <Row
              label="Decided"
              value={formatDateTime(application.reviewedAt)}
            />
          ) : null}
        </dl>
      </div>

      <section className="border-border bg-card flex flex-col gap-4 rounded-2xl border p-5 md:p-6">
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-foreground text-base font-bold tracking-tight md:text-lg">
            What you sent
          </h2>
          <p className="text-muted-foreground text-sm">
            Your answers exactly as the organizer received them. They can&apos;t
            be changed once an application is in.
          </p>
        </div>
        <SubmissionAnswers
          answers={answers}
          emptyLabel="This form asked no questions."
        />
      </section>
    </section>
  )
}

// The way back into a payment the applicant walked away from. It re-opens the
// SAME Flutterwave checkout — same order, same amount — so this is the one
// button, not a second way to pay; see account/submissions.ts resumePayment.
function ResumePayment({ id, totalMinor }: { id: string; totalMinor: number }) {
  const trpc = useTRPC()
  const [leaving, setLeaving] = useState(false)

  const resume = useMutation(
    trpc.account.submissions.resumePayment.mutationOptions({
      onSuccess: ({ paymentUrl }) => {
        setLeaving(true)
        window.location.href = paymentUrl
      },
      onError: (err) =>
        toast.error("We couldn't open the payment", {
          description: err.message,
        }),
    })
  )

  const busy = resume.isPending || leaving

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900 md:flex-row md:items-center md:justify-between dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
      <div className="flex flex-col gap-1">
        <p className="font-semibold">
          Your {formatFee(totalMinor)} fee is unpaid
        </p>
        <p className="leading-6">
          Your spot is being held for you, but not indefinitely — finish the
          payment and your application goes to the organizer straight away.
        </p>
      </div>
      <Button
        type="button"
        size="lg"
        className="shrink-0"
        disabled={busy}
        onClick={() => resume.mutate({ id })}
      >
        <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} />
        {busy ? 'Opening payment…' : 'Pay now'}
      </Button>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-foreground font-semibold">{value}</dd>
    </div>
  )
}
