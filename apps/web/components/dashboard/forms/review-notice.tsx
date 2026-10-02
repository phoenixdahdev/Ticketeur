'use client'

import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Alert02Icon,
  CheckmarkCircle02Icon,
  InformationCircleIcon,
  PlayIcon,
} from '@hugeicons/core-free-icons'

import { cn } from '@ticketur/ui/lib/utils'
import { Button } from '@ticketur/ui/components/button'
import type { FormStatus } from '@ticketur/db'

import {
  formatDateTime,
  FORM_STATUS_LABEL,
  FORM_STATUS_MEANING,
  FORM_STATUS_TONE,
  plural,
  UNAVAILABLE_REASON_LABEL,
  type FormDetail,
  type ReviewEffect,
} from '@/lib/org-forms'

// Everything that tells an organizer where their form stands with the admin
// review, and — the part that matters most — that editing a live form takes
// it offline until an admin approves the new version.
//
// The boundary is the server's (packages/api/src/lib/form-review.ts): the
// questions, the title, the description and the price options are reviewed
// content; the dates, capacity, review mode, form type and the order of the
// questions are not. This file is where that distinction is put into words.

const NOTICE_TONE = {
  info: 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-100',
  warning:
    'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100',
  danger:
    'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-100',
  success:
    'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-100',
  muted: 'border-border/60 bg-muted/40 text-foreground',
} as const

export type NoticeTone = keyof typeof NOTICE_TONE

const NOTICE_ICON = {
  info: InformationCircleIcon,
  warning: Alert02Icon,
  danger: Alert02Icon,
  success: CheckmarkCircle02Icon,
  muted: InformationCircleIcon,
} as const

export function Notice({
  tone,
  title,
  action,
  children,
  className,
}: {
  tone: NoticeTone
  title: string
  action?: React.ReactNode
  children?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-start gap-3 rounded-2xl border p-4 md:p-5',
        NOTICE_TONE[tone],
        className
      )}
    >
      <HugeiconsIcon
        icon={NOTICE_ICON[tone]}
        className="mt-0.5 size-5 shrink-0"
        strokeWidth={1.8}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className="text-sm font-semibold md:text-base">{title}</p>
        {children ? (
          <div className="text-sm leading-6 [&_a]:underline">{children}</div>
        ) : null}
        {action ? <div className="mt-1 flex gap-2">{action}</div> : null}
      </div>
    </div>
  )
}

export function FormStatusBadge({
  status,
  className,
}: {
  status: FormStatus
  className?: string
}) {
  return (
    <span
      title={FORM_STATUS_MEANING[status]}
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap',
        FORM_STATUS_TONE[status],
        className
      )}
    >
      {FORM_STATUS_LABEL[status]}
    </span>
  )
}

// ─── Before the fact ────────────────────────────────────────────────────────

// Shown inside every editor that changes reviewed content, but only while the
// form is live, so the organizer reads the consequence before they type.
export function LiveEditWarning({
  what,
  className,
}: {
  // The thing about to change, e.g. "this question" or "a price option".
  what: string
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100',
        className
      )}
    >
      <HugeiconsIcon
        icon={Alert02Icon}
        className="mt-px size-4 shrink-0"
        strokeWidth={1.9}
      />
      <p>
        <span className="font-semibold">
          Your form is live. Changing {what} takes it offline.
        </span>{' '}
        It goes back into the admin review queue and stops accepting
        applications until the new version is approved.
      </p>
    </div>
  )
}

// ─── After the fact ─────────────────────────────────────────────────────────

// Every content mutation returns { formStatus, sentToReview }. Feed the result
// through `report` and the organizer is told, loudly, when their edit took the
// form offline — and the banner stays on screen after the toast has gone.
export function useReReviewReporter() {
  const [wentOffline, setWentOffline] = useState(false)

  const report = useCallback((effect: ReviewEffect, done: string) => {
    if (effect.sentToReview) {
      setWentOffline(true)
      toast.warning('Your form has stopped accepting applications', {
        description: `${done} That is part of what an admin approved, so the form went back into the review queue and is offline until it is approved again.`,
        duration: 15000,
      })
      return
    }
    toast.success(done)
  }, [])

  const dismiss = useCallback(() => setWentOffline(false), [])

  return { wentOffline, dismiss, report }
}

export function WentOfflineNotice({ onDismiss }: { onDismiss: () => void }) {
  return (
    <Notice
      tone="warning"
      title="Your edit took this form offline"
      action={
        <button
          type="button"
          onClick={onDismiss}
          className="text-xs font-semibold underline underline-offset-2"
        >
          Got it
        </button>
      }
    >
      <p>
        It is back in the admin review queue and is <strong>not</strong>{' '}
        accepting applications. As soon as an admin approves this version it
        goes live again, in the same place, at the same link. Submissions you
        already have are untouched.
      </p>
    </Notice>
  )
}

// ─── The whole state, in one block ──────────────────────────────────────────

// Where the form stands with the admin, what that means for applicants right
// now, and the one action that moves it on.
export function ReviewStateNotice({
  data,
  submitBlocked,
  submitting,
  reopening,
  onSubmit,
  onReopen,
}: {
  data: FormDetail
  submitBlocked: boolean
  submitting: boolean
  reopening: boolean
  onSubmit: () => void
  onReopen: () => void
}) {
  const { form, availability, canReopen, counts } = data

  const submitButton = (label: string) => (
    <Button
      type="button"
      size="sm"
      disabled={submitting || submitBlocked}
      onClick={onSubmit}
      className="gap-1.5"
      title={submitBlocked ? 'Add at least one question first' : undefined}
    >
      <HugeiconsIcon
        icon={CheckmarkCircle02Icon}
        className="size-4"
        strokeWidth={2}
      />
      {submitting ? 'Sending…' : label}
    </Button>
  )

  switch (form.status) {
    case 'draft':
      return (
        <Notice
          tone="muted"
          title="This form is a draft — nobody can see it yet"
          action={submitButton('Submit for review')}
        >
          <p>
            An admin reads every question before a form can take applications,
            because the questions are yours to write. Submit it when the preview
            reads the way you want.
            {submitBlocked ? ' Add at least one question first.' : ''}
          </p>
        </Notice>
      )

    case 'pending_review':
      return (
        <Notice
          tone="info"
          title="Waiting for an admin to approve your questions"
        >
          <p>
            It is <strong>not</strong> accepting applications in the meantime.
            {form.reviewRequestedAt
              ? ` Sent ${formatDateTime(form.reviewRequestedAt)}.`
              : ''}
            {counts.total > 0
              ? ` The ${plural(counts.total, 'application')} you already have ${counts.total === 1 ? 'is' : 'are'} untouched — you can still review ${counts.total === 1 ? 'it' : 'them'}.`
              : ''}
          </p>
          {form.rejectionReason ? (
            <p className="mt-2">
              An earlier version was turned down for this reason, so check you
              have dealt with it:{' '}
              <span className="font-medium">“{form.rejectionReason}”</span>
            </p>
          ) : null}
        </Notice>
      )

    case 'published':
      return availability && !availability.open ? (
        <Notice
          tone="warning"
          title="Approved, but not accepting applications right now"
        >
          <p>
            {UNAVAILABLE_REASON_LABEL[availability.reason]}. The questions are
            approved, so this is only about the window and the spots — fix
            either in Settings and applications resume immediately.
          </p>
          <p className="mt-2">
            Changing a <strong>question</strong>, the <strong>name</strong>, the{' '}
            <strong>description</strong> or a <strong>paid option</strong> is
            different: that takes the form back to review and keeps it offline
            until an admin approves it again.
          </p>
        </Notice>
      ) : (
        <Notice tone="success" title="Live — applicants can apply now">
          <p>
            Changing a <strong>question</strong>, the <strong>name</strong>, the{' '}
            <strong>description</strong> or a <strong>paid option</strong> takes
            this form offline at once and sends it back to the admin review
            queue, where it waits, not accepting applications, until it is
            approved again.
          </p>
          <p className="mt-2">
            Dates, spots, who approves applicants, the form type and the order
            of the questions can all be changed without interrupting anything.
          </p>
        </Notice>
      )

    case 'rejected':
      return (
        <Notice
          tone="danger"
          title="An admin turned this form down"
          action={submitButton('Submit again')}
        >
          <p className="font-medium whitespace-pre-wrap">
            “{form.rejectionReason ?? 'No reason was given.'}”
          </p>
          <p className="mt-2">
            Deal with that, then submit it again. It is not visible to anyone
            and takes no applications until an admin approves it.
            {form.reviewedAt
              ? ` Decided ${formatDateTime(form.reviewedAt)}.`
              : ''}
          </p>
        </Notice>
      )

    case 'suspended':
      return (
        <Notice
          tone="danger"
          title="An admin took this form off the platform"
          action={submitButton('Submit for review')}
        >
          <p className="font-medium whitespace-pre-wrap">
            “{form.rejectionReason ?? 'No reason was given.'}”
          </p>
          <p className="mt-2">
            It stopped accepting applications straight away and its page is no
            longer public. Everything already submitted is kept, and anyone who
            had already paid is still credited — you can still review them.
            {form.reviewedAt
              ? ` Taken down ${formatDateTime(form.reviewedAt)}.`
              : ''}
          </p>
          <p className="mt-2">
            Deal with that, then submit it for review. It can only go back
            online once an admin approves it again — there is no reopening a
            form that was taken down.
          </p>
        </Notice>
      )

    case 'closed':
      return (
        <Notice
          tone="muted"
          title="Closed — not accepting applications"
          action={
            canReopen ? (
              <Button
                type="button"
                size="sm"
                disabled={reopening}
                onClick={onReopen}
                className="gap-1.5"
              >
                <HugeiconsIcon
                  icon={PlayIcon}
                  className="size-4"
                  strokeWidth={2}
                />
                {reopening ? 'Reopening…' : 'Reopen now'}
              </Button>
            ) : (
              submitButton('Submit for review to reopen')
            )
          }
        >
          <p>
            Every application is kept and its page is still public, so its name
            and description are frozen.
          </p>
          <p className="mt-2">
            {canReopen
              ? 'Its questions are still the version an admin approved, so reopening puts it straight back live — no second review.'
              : 'Its questions have changed since they were approved, so reopening goes through the admin review queue.'}
          </p>
        </Notice>
      )
  }
}
