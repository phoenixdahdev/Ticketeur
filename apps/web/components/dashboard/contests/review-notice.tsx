'use client'

import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Alert02Icon,
  ArrowTurnBackwardIcon,
  CheckmarkCircle02Icon,
} from '@hugeicons/core-free-icons'

import { cn } from '@ticketur/ui/lib/utils'
import { Button } from '@ticketur/ui/components/button'
import type { ContestStatus } from '@ticketur/db'

import {
  CONTEST_STATUS_LABEL,
  CONTEST_STATUS_MEANING,
  CONTEST_STATUS_TONE,
  formatDateTime,
  plural,
  VOTING_CLOSED_LABEL,
  type ContestDetail,
  type ReviewEffect,
} from '@/lib/org-contests'
// `Notice` is purely presentational and already says exactly this on the
// forms screens. One definition, so an organizer who runs both sees the same
// box in the same colours meaning the same thing.
import { Notice } from '@/components/dashboard/forms/review-notice'

// Everything that tells an organizer where their contest stands with the
// admin, and — the part that matters most — that editing the ballot or the
// prices of a live contest stops the voting until an admin approves it again.
//
// The boundary is the server's (packages/api/src/lib/contest-review.ts): the
// contest's name and description, each category's wording, each entry's name,
// photo and bio, and every price are reviewed content; the voting window, the
// time zone, the order of things, withdrawing an entry and retiring a bundle
// are not. This file is where that distinction is put into words.

export function ContestStatusBadge({
  status,
  className,
}: {
  status: ContestStatus
  className?: string
}) {
  return (
    <span
      title={CONTEST_STATUS_MEANING[status]}
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap',
        CONTEST_STATUS_TONE[status],
        className
      )}
    >
      {CONTEST_STATUS_LABEL[status]}
    </span>
  )
}

// ─── Before the fact ────────────────────────────────────────────────────────

// Shown inside every editor that changes reviewed content, but only while the
// contest is live, so the organizer reads the consequence before they type.
export function LiveEditWarning({
  what,
  className,
}: {
  // The thing about to change, e.g. "an entry's name" or "a bundle's price".
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
          Your contest is live. Changing {what} stops the voting.
        </span>{' '}
        It goes back into the admin review queue and takes no votes — free or
        paid — until the new version is approved. Votes already cast are kept,
        and so is every credit people have bought.
      </p>
    </div>
  )
}

// ─── After the fact ─────────────────────────────────────────────────────────

export type ReviewReport = (effect: ReviewEffect, done: string) => void

// Every content mutation returns { contestStatus, sentToReview }. Feed the
// result through `report` and the organizer is told, loudly, when their edit
// stopped the voting — and the banner stays after the toast has gone.
export function useReReviewReporter() {
  const [wentOffline, setWentOffline] = useState(false)

  const report = useCallback<ReviewReport>((effect, done) => {
    if (effect.sentToReview) {
      setWentOffline(true)
      toast.warning('Your contest has stopped taking votes', {
        description: `${done} That is part of what an admin approved, so the contest went back into the review queue and takes no votes until it is approved again.`,
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
      title="Your edit stopped the voting"
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
        It is back in the admin review queue and is taking <strong>no</strong>{' '}
        votes. As soon as an admin approves this version it goes live again, in
        the same place, at the same link. Every vote already cast stands, and
        anyone who bought credits still has them.
      </p>
    </Notice>
  )
}

// ─── The whole state, in one block ──────────────────────────────────────────

export function ReviewStateNotice({
  data,
  submitBlocked,
  submitBlockedReason,
  submitting,
  withdrawing,
  onSubmit,
  onWithdraw,
}: {
  data: ContestDetail
  submitBlocked: boolean
  submitBlockedReason: string | null
  submitting: boolean
  withdrawing: boolean
  onSubmit: () => void
  onWithdraw: () => void
}) {
  const { contest, availability, counts } = data

  const submitButton = (label: string) => (
    <Button
      type="button"
      size="sm"
      disabled={submitting || submitBlocked}
      onClick={onSubmit}
      className="gap-1.5"
      title={submitBlockedReason ?? undefined}
    >
      <HugeiconsIcon
        icon={CheckmarkCircle02Icon}
        className="size-4"
        strokeWidth={2}
      />
      {submitting ? 'Sending…' : label}
    </Button>
  )

  switch (contest.status) {
    case 'draft':
      return (
        <Notice
          tone="muted"
          title="This contest is a draft — nobody can see it yet"
          action={submitButton('Submit for review')}
        >
          <p>
            An admin reads the ballot and the prices before a contest can take
            votes, because every name, photo and price on it is yours to choose.
            Submit it when it reads the way you want.
            {submitBlockedReason ? ` ${submitBlockedReason}` : ''}
          </p>
        </Notice>
      )

    case 'pending_review':
      return (
        <Notice
          tone="info"
          title="Waiting for an admin to approve your ballot"
          action={
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={withdrawing}
              onClick={onWithdraw}
              className="gap-1.5"
            >
              <HugeiconsIcon
                icon={ArrowTurnBackwardIcon}
                className="size-4"
                strokeWidth={2}
              />
              {withdrawing ? 'Withdrawing…' : 'Withdraw from review'}
            </Button>
          }
        >
          <p>
            It is taking <strong>no</strong> votes in the meantime.
            {contest.reviewRequestedAt
              ? ` Sent ${formatDateTime(contest.reviewRequestedAt)}.`
              : ''}
            {counts.voteCount > 0
              ? ` The ${plural(counts.voteCount, 'vote')} already cast ${counts.voteCount === 1 ? 'is' : 'are'} untouched.`
              : ''}
          </p>
          <p className="mt-2">
            Not ready after all? Withdraw it and it goes back to a draft for you
            to keep working on. If an admin gets to it first you will be told,
            and nothing is lost either way.
          </p>
          {contest.rejectionReason ? (
            <p className="mt-2">
              An earlier version was turned down for this reason, so check you
              have dealt with it:{' '}
              <span className="font-medium">“{contest.rejectionReason}”</span>
            </p>
          ) : null}
        </Notice>
      )

    case 'published':
      return availability && !availability.open ? (
        <Notice tone="warning" title="Approved, but not taking votes right now">
          <p>
            {VOTING_CLOSED_LABEL[availability.reason]}. The ballot is approved,
            so this is only about the window — change it in Settings and voting
            resumes immediately.
          </p>
          <p className="mt-2">
            Changing the <strong>name</strong>, the <strong>description</strong>
            , a <strong>category</strong>, an <strong>entry</strong> or a{' '}
            <strong>price</strong> is different: that takes the contest back to
            review and keeps it offline until an admin approves it again.
          </p>
        </Notice>
      ) : (
        <Notice tone="success" title="Live — people can vote now">
          <p>
            Changing the <strong>name</strong>, the <strong>description</strong>
            , a <strong>category</strong>, an <strong>entry</strong> or a{' '}
            <strong>price</strong> stops the voting at once and sends this back
            to the admin review queue, where it waits, taking no votes, until it
            is approved again.
          </p>
          <p className="mt-2">
            The voting window, the time zone, the order things appear in,
            withdrawing or disqualifying an entry, and retiring a bundle from
            sale can all be changed without interrupting anything.
          </p>
        </Notice>
      )

    case 'rejected':
      return (
        <Notice
          tone="danger"
          title="An admin turned this contest down"
          action={submitButton('Submit again')}
        >
          <p className="font-medium whitespace-pre-wrap">
            “{contest.rejectionReason ?? 'No reason was given.'}”
          </p>
          <p className="mt-2">
            Deal with that, then submit it again. It is not visible to anyone
            and takes no votes until an admin approves it.
            {contest.reviewedAt
              ? ` Decided ${formatDateTime(contest.reviewedAt)}.`
              : ''}
          </p>
        </Notice>
      )

    case 'suspended':
      return (
        <Notice
          tone="danger"
          title="An admin took this contest off the platform"
          action={submitButton('Submit for review')}
        >
          <p className="font-medium whitespace-pre-wrap">
            “{contest.rejectionReason ?? 'No reason was given.'}”
          </p>
          <p className="mt-2">
            Voting stopped straight away and the page is no longer public. Every
            vote already cast is kept, and anyone who bought credits still has
            them.
            {contest.reviewedAt
              ? ` Taken down ${formatDateTime(contest.reviewedAt)}.`
              : ''}
          </p>
          <p className="mt-2">
            Deal with that, then submit it for review. It can only go back
            online once an admin approves it again.
          </p>
        </Notice>
      )

    case 'closed':
      return (
        <Notice
          tone="muted"
          title="Closed — voting has ended"
          action={submitButton('Submit for review to restart voting')}
        >
          <p>
            Every vote is kept and the results page is still public, so the
            name, the description, the categories and the entries are frozen —
            that page is showing all of it.
          </p>
          <p className="mt-2">
            Restarting voting goes through the admin review queue, which means
            the results page is dark while they look. The window and the order
            of things can still be changed.
          </p>
        </Notice>
      )
  }
}
