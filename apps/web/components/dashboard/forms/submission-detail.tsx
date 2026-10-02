'use client'

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowLeft01Icon,
  CancelCircleIcon,
  CheckmarkCircle02Icon,
  File01Icon,
  LinkSquare02Icon,
  Mail01Icon,
} from '@hugeicons/core-free-icons'

import { cn } from '@ticketur/ui/lib/utils'
import { Button } from '@ticketur/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@ticketur/ui/components/dialog'
import { Textarea } from '@ticketur/ui/components/textarea'

import { useTRPC } from '@/lib/trpc'
import {
  FIELD_TYPE_LABEL,
  formatDateTime,
  formatOptionPrice,
  SUBMISSION_STATUS_LABEL,
  SUBMISSION_STATUS_TONE,
  type SubmissionAnswer,
} from '@/lib/org-forms'

export function SubmissionDetail({
  formId,
  submissionId,
}: {
  formId: string
  submissionId: string
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)

  const { data, isLoading } = useQuery(
    trpc.org.forms.submissions.byId.queryOptions({ id: submissionId })
  )

  function invalidate() {
    void queryClient.invalidateQueries({
      queryKey: trpc.org.forms.submissions.byId.queryKey({ id: submissionId }),
    })
    void queryClient.invalidateQueries({
      queryKey: trpc.org.forms.submissions.list.queryKey(),
    })
    void queryClient.invalidateQueries({
      queryKey: trpc.org.forms.byId.queryKey({ id: formId }),
    })
    void queryClient.invalidateQueries({
      queryKey: trpc.org.forms.list.queryKey(),
    })
  }

  const approve = useMutation(
    trpc.org.forms.submissions.approve.mutationOptions({
      onSuccess: (result) => {
        toast.success(
          result.changed ? 'Approved' : 'This application was already approved',
          {
            description: result.changed
              ? 'The applicant has been emailed.'
              : undefined,
          }
        )
        invalidate()
      },
      onError: (err) =>
        toast.error('Could not approve', { description: err.message }),
    })
  )

  const reject = useMutation(
    trpc.org.forms.submissions.reject.mutationOptions({
      onSuccess: (result) => {
        setRejecting(false)
        setReason('')
        const paid = data?.feePaidMinor ?? null
        toast.success(
          result.changed ? 'Rejected' : 'This application was already rejected',
          {
            description: !result.changed
              ? undefined
              : paid !== null
                ? `The applicant has been emailed your reason, and their ${formatOptionPrice(paid)} fee is queued to be refunded.`
                : 'The applicant has been emailed your reason.',
          }
        )
        invalidate()
      },
      onError: (err) =>
        toast.error('Could not reject', { description: err.message }),
    })
  )

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-muted-foreground text-sm">Loading application…</p>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="border-border/60 bg-background flex flex-col items-center gap-4 rounded-2xl border p-10 text-center">
        <p className="text-muted-foreground text-sm">
          This application no longer exists, or it is not one of yours.
        </p>
        <Button asChild variant="outline">
          <Link href={`/org/forms/${formId}/submissions`}>
            Back to applications
          </Link>
        </Button>
      </div>
    )
  }

  const { submission, priceOption, reviewer, answers, feePaidMinor } = data
  const awaitingPayment = submission.status === 'pending_payment'
  const busy = approve.isPending || reject.isPending
  // Non-null only when the fee actually cleared, so rejecting owes it back.
  const feePaid = feePaidMinor !== null ? formatOptionPrice(feePaidMinor) : null

  return (
    <div className="flex min-h-0 flex-1 [scrollbar-width:none] flex-col gap-6 overflow-y-auto md:gap-8 [&::-webkit-scrollbar]:hidden">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <Link
          href={`/org/forms/${formId}/submissions`}
          className="text-foreground hover:text-primary inline-flex items-center gap-1.5 text-sm font-medium transition-colors"
        >
          <HugeiconsIcon
            icon={ArrowLeft01Icon}
            className="size-4"
            strokeWidth={2}
          />
          Back to applications
        </Link>
      </div>

      <header className="flex shrink-0 flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-6">
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-heading text-foreground text-2xl font-bold tracking-tight md:text-[28px]">
              {submission.applicantName}
            </h1>
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium',
                SUBMISSION_STATUS_TONE[submission.status]
              )}
            >
              {SUBMISSION_STATUS_LABEL[submission.status]}
            </span>
          </div>
          <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <a
              href={`mailto:${submission.applicantEmail}`}
              className="hover:text-foreground inline-flex items-center gap-1.5 transition-colors"
            >
              <HugeiconsIcon
                icon={Mail01Icon}
                className="size-4"
                strokeWidth={1.8}
              />
              {submission.applicantEmail}
            </a>
            <span aria-hidden>·</span>
            <span>Reference {submission.reference}</span>
            <span aria-hidden>·</span>
            <span>Applied {formatDateTime(submission.createdAt)}</span>
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <Button
            type="button"
            disabled={
              busy || awaitingPayment || submission.status === 'approved'
            }
            onClick={() => approve.mutate({ id: submission.id })}
            className="gap-1.5"
            title={
              awaitingPayment
                ? 'This applicant has not paid the fee yet'
                : undefined
            }
          >
            <HugeiconsIcon
              icon={CheckmarkCircle02Icon}
              className="size-4"
              strokeWidth={2}
            />
            {approve.isPending ? 'Approving…' : 'Approve'}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={
              busy || awaitingPayment || submission.status === 'rejected'
            }
            onClick={() => {
              setReason('')
              setReasonError(null)
              setRejecting(true)
            }}
            className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive gap-1.5"
          >
            <HugeiconsIcon
              icon={CancelCircleIcon}
              className="size-4"
              strokeWidth={2}
            />
            Reject
          </Button>
        </div>
      </header>

      {awaitingPayment ? (
        <p className="shrink-0 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
          This application is holding a spot while its fee is paid. It can be
          approved or rejected once the payment lands — a paid application is
          completed for you automatically.
        </p>
      ) : null}

      {submission.status === 'rejected' && submission.reason ? (
        <div className="shrink-0 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-100">
          <p className="font-semibold">You rejected this application</p>
          <p className="mt-1 whitespace-pre-wrap">“{submission.reason}”</p>
          {feePaid ? (
            <p className="mt-2">
              Their {feePaid} fee is on Ticketeur&apos;s refunds list and will
              be paid back to them by hand.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="grid shrink-0 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <SummaryCard label="Option chosen">
          {priceOption
            ? `${priceOption.name} — ${formatOptionPrice(priceOption.priceMinor)}`
            : 'No paid option on this form'}
        </SummaryCard>
        <SummaryCard label="Reviewed">
          {submission.reviewedAt
            ? `${formatDateTime(submission.reviewedAt)}${reviewer ? ` by ${reviewer.name}` : ' automatically'}`
            : 'Not reviewed yet'}
        </SummaryCard>
        <SummaryCard label="Applicant account">
          {submission.applicantId
            ? 'Signed in when applying'
            : 'Applied without an account'}
        </SummaryCard>
      </div>

      <section className="border-border/60 bg-background flex shrink-0 flex-col gap-4 rounded-2xl border p-5 md:p-6">
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-foreground text-base font-bold tracking-tight md:text-lg">
            Answers
          </h2>
          <p className="text-muted-foreground text-sm">
            Every question on the form, in order. A question added after this
            application came in has no answer.
          </p>
        </div>

        {answers.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            This form has no questions.
          </p>
        ) : (
          <dl className="divide-border/60 flex flex-col divide-y">
            {answers.map((answer) => (
              <AnswerRow key={answer.fieldId} answer={answer} />
            ))}
          </dl>
        )}
      </section>

      <Dialog
        open={rejecting}
        onOpenChange={reject.isPending ? () => {} : setRejecting}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Reject {submission.applicantName}&apos;s application
            </DialogTitle>
            <DialogDescription>
              Your reason is emailed to the applicant, so write it for them.
              Their spot is released for someone else.
              {feePaid ? (
                <>
                  {' '}
                  They paid {feePaid} to apply, so rejecting them puts that
                  amount on Ticketeur&apos;s refunds list to be paid back by
                  hand. It is not refunded the moment you click — allow a few
                  working days for it to reach them.
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Textarea
              rows={4}
              maxLength={1000}
              autoFocus
              value={reason}
              disabled={reject.isPending}
              onChange={(e) => {
                setReason(e.target.value)
                if (reasonError) setReasonError(null)
              }}
              placeholder="e.g. The photos were too low-resolution for the programme — you are welcome to apply again with clearer ones."
              aria-invalid={Boolean(reasonError)}
              aria-label="Reason"
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-destructive text-xs font-medium">
                {reasonError ?? ''}
              </p>
              <p className="text-muted-foreground text-xs">
                {reason.trim().length} / 1,000
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={reject.isPending}
              onClick={() => setRejecting(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={reject.isPending}
              onClick={() => {
                const trimmed = reason.trim()
                if (trimmed.length === 0) {
                  setReasonError('Give the applicant a reason')
                  return
                }
                reject.mutate({ id: submission.id, reason: trimmed })
              }}
            >
              {reject.isPending ? 'Rejecting…' : 'Reject and email them'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SummaryCard({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="border-border/60 bg-background flex flex-col gap-1 rounded-2xl border p-4">
      <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
        {label}
      </p>
      <p className="text-foreground text-sm">{children}</p>
    </div>
  )
}

function AnswerRow({ answer }: { answer: SubmissionAnswer }) {
  return (
    <div className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0 sm:flex-row sm:gap-6">
      <dt className="flex min-w-0 shrink-0 flex-col gap-0.5 sm:w-64">
        <span className="text-foreground text-sm font-semibold">
          {answer.label}
        </span>
        <span className="text-muted-foreground text-xs">
          {FIELD_TYPE_LABEL[answer.type]}
        </span>
      </dt>
      <dd className="min-w-0 flex-1 text-sm">
        <AnswerValue answer={answer} />
      </dd>
    </div>
  )
}

function AnswerValue({ answer }: { answer: SubmissionAnswer }) {
  const { type, value } = answer

  if (value === null || value === undefined) {
    return <span className="text-muted-foreground italic">Not answered</span>
  }

  if (type === 'checkbox') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 font-medium',
          value === true
            ? 'text-emerald-600 dark:text-emerald-400'
            : 'text-muted-foreground'
        )}
      >
        <HugeiconsIcon
          icon={value === true ? CheckmarkCircle02Icon : CancelCircleIcon}
          className="size-4"
          strokeWidth={2}
        />
        {value === true ? 'Ticked' : 'Not ticked'}
      </span>
    )
  }

  if (type === 'images') {
    const urls = Array.isArray(value) ? value : []
    return (
      <div className="flex flex-wrap gap-3">
        {urls.map((url) => (
          <UploadedImage key={url} url={url} />
        ))}
      </div>
    )
  }

  if (type === 'image') {
    return typeof value === 'string' ? <UploadedImage url={value} /> : null
  }

  if (type === 'file') {
    return typeof value === 'string' ? (
      <a
        href={value}
        target="_blank"
        rel="noreferrer"
        className="border-border/60 text-foreground hover:bg-muted inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors"
      >
        <HugeiconsIcon
          icon={File01Icon}
          className="text-primary size-4"
          strokeWidth={1.8}
        />
        Open the PDF
        <HugeiconsIcon
          icon={LinkSquare02Icon}
          className="text-muted-foreground size-3.5"
          strokeWidth={1.8}
        />
      </a>
    ) : null
  }

  if (type === 'email') {
    return (
      <a
        href={`mailto:${String(value)}`}
        className="text-primary hover:underline"
      >
        {String(value)}
      </a>
    )
  }

  if (type === 'phone') {
    return (
      <a href={`tel:${String(value)}`} className="text-primary hover:underline">
        {String(value)}
      </a>
    )
  }

  if (type === 'social_handle') {
    const text = String(value)
    return text.startsWith('http') ? (
      <a
        href={text}
        target="_blank"
        rel="noreferrer"
        className="text-primary break-all hover:underline"
      >
        {text}
      </a>
    ) : (
      <span className="text-foreground">{text}</span>
    )
  }

  return (
    <span className="text-foreground whitespace-pre-wrap">{String(value)}</span>
  )
}

// Uploads live in the public blob store, which next.config allows next/image
// to serve. The full-size file opens in a new tab.
function UploadedImage({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="border-border/60 bg-muted focus-visible:ring-primary/40 relative block size-28 overflow-hidden rounded-xl border outline-none focus-visible:ring-2"
    >
      <Image
        src={url}
        alt="Uploaded by the applicant"
        fill
        sizes="112px"
        className="object-cover"
      />
    </a>
  )
}
