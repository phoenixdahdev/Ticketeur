'use client'

import Image from 'next/image'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  CancelCircleIcon,
  CheckmarkCircle02Icon,
  File01Icon,
  LinkSquare02Icon,
} from '@hugeicons/core-free-icons'

import type { FormFieldType, SubmissionAnswerValue } from '@ticketur/db'
import { cn } from '@ticketur/ui/lib/utils'

import { FIELD_TYPE_LABEL } from '@/lib/org-forms'

// One submission's answers, question by question, in the form's own order.
//
// Shared by the organizer reviewing an application
// (components/dashboard/forms/submission-detail.tsx) and the applicant reading
// their own copy of it (components/sections/account/application-detail.tsx).
// The two are the same thing seen from either end — "what was actually sent" —
// and rendering an uploaded PDF or a ticked box differently depending on who
// is looking would be a way for them to disagree about what was submitted.

export type RenderedAnswer = {
  fieldId: string
  label: string
  type: FormFieldType
  // null = not answered: an optional question skipped, or one added to the
  // form after this submission came in.
  value: SubmissionAnswerValue | null
}

export function SubmissionAnswers({
  answers,
  emptyLabel = 'This form has no questions.',
}: {
  answers: readonly RenderedAnswer[]
  emptyLabel?: string
}) {
  if (answers.length === 0) {
    return <p className="text-muted-foreground text-sm">{emptyLabel}</p>
  }
  return (
    <dl className="divide-border/60 flex flex-col divide-y">
      {answers.map((answer) => (
        <AnswerRow key={answer.fieldId} answer={answer} />
      ))}
    </dl>
  )
}

function AnswerRow({ answer }: { answer: RenderedAnswer }) {
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

function AnswerValue({ answer }: { answer: RenderedAnswer }) {
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
        alt="Uploaded with the application"
        fill
        sizes="112px"
        className="object-cover"
      />
    </a>
  )
}
