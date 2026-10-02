import Image from 'next/image'
import { format } from 'date-fns'
import { HugeiconsIcon } from '@hugeicons/react'
import type { IconSvgElement } from '@hugeicons/react'
import {
  Alert02Icon,
  Calendar03Icon,
  CheckListIcon,
  Clock01Icon,
  CloudUploadIcon,
  Tag01Icon,
  UserGroupIcon,
} from '@hugeicons/core-free-icons'

import { cn } from '@ticketur/ui/lib/utils'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@ticketur/ui/components/avatar'
import { Checkbox } from '@ticketur/ui/components/checkbox'
import { Input } from '@ticketur/ui/components/input'
import { Textarea } from '@ticketur/ui/components/textarea'
import type { RouterOutputs } from '@ticketur/api'

import { ApproveRejectActions } from '@/components/dashboard/moderation/approve-reject-actions'
import { TakeDownFormAction } from '@/components/dashboard/moderation/take-down-form-action'
import {
  formatEventDateRange,
  formatShortDate as formatJoined,
  toDate,
} from '@/lib/date'

type ReviewForm = NonNullable<
  RouterOutputs['admin']['moderation']['formById']
>
type Field = ReviewForm['fields'][number]
type PriceOption = ReviewForm['priceOptions'][number]

const FORM_TYPE_LABEL: Record<ReviewForm['type'], string> = {
  contestant: 'Contestant form',
  vendor: 'Vendor form',
  other: 'Registration form',
}

const FIELD_TYPE_LABEL: Record<Field['type'], string> = {
  short_text: 'Short text',
  long_text: 'Long text',
  email: 'Email',
  phone: 'Phone',
  number: 'Number',
  date: 'Date',
  dropdown: 'Dropdown',
  checkbox: 'Checkbox',
  image: 'Image',
  images: 'Images',
  file: 'PDF',
  social_handle: 'Social handle',
}

const STATUS_LABEL: Record<ReviewForm['status'], string> = {
  draft: 'a draft',
  pending_review: 'waiting for review',
  published: 'live',
  rejected: 'rejected',
  closed: 'closed',
  suspended: 'taken down',
}

const EVENT_STATUS_LABEL: Record<ReviewForm['event']['status'], string> = {
  draft: 'Event is a draft',
  'in-review': 'Event awaiting approval',
  upcoming: 'Event is live',
  archived: 'Event archived',
  suspended: 'Event suspended',
}

const FILE_TYPE_LABEL: Record<string, string> = {
  'image/jpeg': 'JPG',
  'image/png': 'PNG',
  'image/webp': 'WEBP',
  'image/avif': 'AVIF',
  'application/pdf': 'PDF',
}

// Prices come back in minor units (kobo).
function formatNaira(minor: number) {
  return minor === 0 ? 'Free' : `₦${(minor / 100).toLocaleString('en-NG')}`
}

function formatDateTime(iso: string) {
  const date = toDate(iso)
  return date ? format(date, "MMM d, yyyy 'at' h:mm a") : iso
}

function windowLabel(form: ReviewForm) {
  const { opensAt, closesAt } = form
  if (opensAt && closesAt) {
    return `Open ${formatDateTime(opensAt)} – ${formatDateTime(closesAt)}`
  }
  if (opensAt) return `Opens ${formatDateTime(opensAt)}`
  if (closesAt) return `Closes ${formatDateTime(closesAt)}`
  return 'Open until closed or the event ends'
}

function reviewedLabel(form: ReviewForm) {
  if (!form.lastReview) return ''
  const by = form.lastReview.by ? ` by ${form.lastReview.by}` : ''
  return ` on ${formatJoined(form.lastReview.at)}${by}`
}

function getInitials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p.charAt(0).toUpperCase())
      .join('') || '?'
  )
}

// The limits a field enforces that an applicant is told about.
function rulesHint(field: Field): string | null {
  switch (field.type) {
    case 'short_text':
    case 'long_text':
      return field.maxLength
        ? `Up to ${field.maxLength.toLocaleString('en-NG')} characters`
        : null
    case 'number': {
      const { minValue: min, maxValue: max } = field
      if (min !== null && max !== null) return `Between ${min} and ${max}`
      if (min !== null) return `At least ${min}`
      if (max !== null) return `At most ${max}`
      return null
    }
    case 'checkbox':
      return field.required ? 'Must be ticked to submit' : null
    default:
      return null
  }
}

export function FormModDetail({
  form,
  changedWhileOpen,
}: {
  form: ReviewForm
  // A reload replaced the version the admin first opened.
  changedWhileOpen: boolean
}) {
  const questionCount = `${form.fields.length} question${form.fields.length === 1 ? '' : 's'}`

  return (
    <div className="flex flex-col gap-6 md:gap-8">
      <div className="border-border/60 bg-background relative aspect-[1360/360] w-full overflow-hidden rounded-2xl border">
        {form.event.bannerUrl ? (
          <Image
            src={form.event.bannerUrl}
            alt=""
            fill
            sizes="(max-width: 1024px) 100vw, 1360px"
            className="object-cover"
            priority
          />
        ) : (
          <div className="from-primary to-primary/70 size-full bg-gradient-to-br" />
        )}
      </div>

      {changedWhileOpen ? (
        <Notice
          tone="warning"
          title="This form changed while you were reviewing it"
        >
          You&apos;re now looking at the latest version. Read every question
          again before you approve it.
        </Notice>
      ) : null}

      <ReviewNotice form={form} />

      <section className="border-border/60 bg-background flex flex-col gap-2 rounded-2xl border p-5 md:p-6">
        <h3 className="text-foreground text-base font-semibold">Form Name</h3>
        <p className="text-foreground text-base">{form.title}</p>
      </section>

      <section className="border-border/60 bg-background flex flex-col gap-2 rounded-2xl border p-5 md:p-6">
        <h3 className="text-foreground text-base font-semibold">Description</h3>
        <p className="text-muted-foreground text-sm whitespace-pre-wrap md:text-base">
          {form.description || 'No description.'}
        </p>
      </section>

      <section className="border-border/60 bg-background flex flex-col gap-4 rounded-2xl border p-5 md:p-6">
        <h3 className="text-foreground text-base font-semibold">
          Form Details
        </h3>
        <div className="flex flex-wrap gap-3">
          <DetailPill
            icon={Tag01Icon}
            text={`${FORM_TYPE_LABEL[form.type]} · ${form.event.title}`}
          />
          <DetailPill
            icon={Calendar03Icon}
            text={`${formatEventDateRange(form.event.eventDate, form.event.endDate)} · ${EVENT_STATUS_LABEL[form.event.status]}`}
          />
          <DetailPill icon={Clock01Icon} text={windowLabel(form)} />
          <DetailPill
            icon={UserGroupIcon}
            text={
              form.capacity === null
                ? 'No capacity limit'
                : `${form.capacity.toLocaleString('en-NG')} spots`
            }
          />
          <DetailPill
            icon={CheckListIcon}
            text={
              form.reviewMode === 'auto'
                ? 'Applicants approved automatically'
                : 'Organizer reviews each applicant'
            }
          />
        </div>
        <p className="text-muted-foreground text-xs">
          {form.submittedAt
            ? `Submitted for review ${formatDateTime(form.submittedAt)} · `
            : ''}
          {form.submissionCount} submission
          {form.submissionCount === 1 ? '' : 's'} so far
        </p>
      </section>

      <section className="border-border/60 bg-background flex flex-col gap-5 rounded-2xl border p-5 md:p-6">
        <div className="flex flex-col gap-1">
          <h3 className="text-foreground text-base font-semibold">
            What Applicants Are Asked
          </h3>
          <p className="text-muted-foreground text-sm">
            {questionCount} from the organizer, in order, exactly as the form
            asks them, plus the contact details every form collects.
          </p>
        </div>

        <ContactPreview />

        {form.fields.length === 0 ? (
          <p className="border-border/60 text-muted-foreground rounded-xl border border-dashed p-4 text-center text-sm">
            This form has no questions of its own.
          </p>
        ) : (
          form.fields.map((field, i) => (
            <FieldPreview key={field.id} field={field} number={i + 1} />
          ))
        )}

        {form.priceOptions.length > 0 ? (
          <PriceOptionsPreview options={form.priceOptions} />
        ) : null}
      </section>

      <section className="border-border/60 bg-background flex flex-col gap-3 rounded-2xl border p-5 md:p-6">
        <h3 className="text-foreground text-base font-semibold">
          Organizer Details
        </h3>
        <div className="flex items-start gap-4">
          <Avatar className="border-border/60 size-16 border">
            {form.organizer.image ? (
              <AvatarImage asChild src={form.organizer.image} alt="">
                <Image
                  src={form.organizer.image}
                  alt=""
                  width={64}
                  height={64}
                  className="object-cover"
                />
              </AvatarImage>
            ) : null}
            <AvatarFallback className="bg-primary/10 text-primary text-base font-semibold">
              {getInitials(form.organizer.name)}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-1 flex-col gap-1">
            <span className="text-foreground text-lg font-bold">
              {form.organizer.name}
            </span>
            <span className="text-muted-foreground text-sm">
              {form.organizer.email}
            </span>
            <div className="mt-2 flex items-center gap-3">
              <span
                className={cn(
                  'text-xs font-semibold',
                  form.organizer.status === 'active'
                    ? 'text-emerald-600'
                    : 'text-rose-600'
                )}
              >
                {form.organizer.status === 'active' ? 'Active' : 'Suspended'}
              </span>
              <span className="text-muted-foreground/40">•</span>
              <span className="text-foreground text-xs font-semibold">
                Date Joined
              </span>
              <span className="text-muted-foreground text-xs">
                {formatJoined(form.organizer.joinedAt)}
              </span>
            </div>
          </div>
        </div>
      </section>

      {form.status === 'pending_review' ? (
        <ApproveRejectActions
          kind="form"
          id={form.id}
          name={form.title}
          revision={form.revision}
          redirectTo="/moderation?tab=forms"
        />
      ) : null}

      {/* A form the public can reach: live, or closed with its page still up.
          Approval is behind it, so the only moderation left is pulling it. */}
      {form.status === 'published' || form.status === 'closed' ? (
        <TakeDownFormAction
          id={form.id}
          name={form.title}
          live={form.status === 'published'}
        />
      ) : null}
    </div>
  )
}

const NOTICE_TONE = {
  warning:
    'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200',
  danger:
    'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200',
  muted: 'border-border/60 bg-muted/40 text-foreground',
} as const

// Why this form is in front of the admin, when it isn't simply new.
function ReviewNotice({ form }: { form: ReviewForm }) {
  if (form.status === 'suspended') {
    return (
      <Notice tone="danger" title="This form was taken down">
        It takes no applications and its page is not public. Its organizer can
        only get it back by fixing it and submitting it for review
        {reviewedLabel(form) ? `. Taken down${reviewedLabel(form)}` : ''}.
        <span className="mt-2 block font-medium whitespace-pre-wrap">
          “{form.rejectionReason}”
        </span>
      </Notice>
    )
  }
  if (form.status !== 'pending_review') {
    return (
      <Notice tone="muted" title={`This form is ${STATUS_LABEL[form.status]}`}>
        It isn&apos;t waiting for review, so there is nothing to approve.
        {form.lastReview ? ` Last reviewed${reviewedLabel(form)}.` : ''}
      </Notice>
    )
  }
  if (form.history === 'resubmitted') {
    return (
      <Notice tone="danger" title="Resubmitted after a rejection">
        An earlier version was rejected{reviewedLabel(form)}. Check the reason
        has been dealt with:
        <span className="mt-2 block font-medium whitespace-pre-wrap">
          “{form.rejectionReason}”
        </span>
      </Notice>
    )
  }
  if (form.history === 'edited') {
    return (
      <Notice tone="warning" title="Changed after approval">
        This form was approved{reviewedLabel(form)}, then its organizer edited
        it, so it stopped taking submissions until you approve this version.
        {form.submissionCount > 0
          ? ` It already has ${form.submissionCount} submission${form.submissionCount === 1 ? '' : 's'}.`
          : ''}
      </Notice>
    )
  }
  return null
}

function Notice({
  tone,
  title,
  children,
}: {
  tone: keyof typeof NOTICE_TONE
  title: string
  children: React.ReactNode
}) {
  return (
    <section
      className={cn(
        'flex items-start gap-3 rounded-2xl border p-5 md:p-6',
        NOTICE_TONE[tone]
      )}
    >
      <HugeiconsIcon
        icon={Alert02Icon}
        className="mt-0.5 size-5 shrink-0"
        strokeWidth={1.8}
      />
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="text-sm">{children}</p>
      </div>
    </section>
  )
}

function QuestionCard({
  heading,
  typeLabel,
  children,
}: {
  heading: string
  typeLabel: string
  children: React.ReactNode
}) {
  return (
    <div className="border-border/60 flex flex-col gap-3 rounded-xl border p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
          {heading}
        </span>
        <span className="bg-muted text-foreground inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold uppercase">
          {typeLabel}
        </span>
      </div>
      {children}
    </div>
  )
}

function QuestionText({
  label,
  required,
  helpText,
}: {
  label: string
  required: boolean
  helpText?: string
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-foreground text-sm font-semibold whitespace-pre-wrap">
        {label}
        {required ? (
          <span className="text-rose-500"> *</span>
        ) : (
          <span className="text-muted-foreground font-normal"> (optional)</span>
        )}
      </p>
      {helpText ? (
        <p className="text-muted-foreground text-xs whitespace-pre-wrap">
          {helpText}
        </p>
      ) : null}
    </div>
  )
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground text-xs">{children}</p>
}

// Collected on every form, outside the organizer's own fields.
function ContactPreview() {
  return (
    <QuestionCard heading="Every form" typeLabel="Contact">
      <QuestionText label="Full name" required />
      <Input disabled placeholder="Full name" />
      <QuestionText label="Email address" required />
      <Input type="email" disabled placeholder="name@example.com" />
    </QuestionCard>
  )
}

function FieldPreview({ field, number }: { field: Field; number: number }) {
  const hint = rulesHint(field)
  const heading = `Question ${number}`
  const typeLabel = FIELD_TYPE_LABEL[field.type]

  // A checkbox's label is the statement being ticked, so it sits beside it.
  if (field.type === 'checkbox') {
    return (
      <QuestionCard heading={heading} typeLabel={typeLabel}>
        <div className="flex items-start gap-3">
          <Checkbox disabled className="mt-0.5" aria-label={field.label} />
          <QuestionText
            label={field.label}
            required={field.required}
            helpText={field.helpText}
          />
        </div>
        {hint ? <Hint>{hint}</Hint> : null}
      </QuestionCard>
    )
  }

  return (
    <QuestionCard heading={heading} typeLabel={typeLabel}>
      <QuestionText
        label={field.label}
        required={field.required}
        helpText={field.helpText}
      />
      <FieldControl field={field} />
      {hint ? <Hint>{hint}</Hint> : null}
    </QuestionCard>
  )
}

function FieldControl({ field }: { field: Field }) {
  switch (field.type) {
    case 'long_text':
      return <Textarea disabled rows={3} placeholder="Long answer" />
    case 'email':
      return <Input type="email" disabled placeholder="name@example.com" />
    case 'phone':
      return <Input type="tel" disabled placeholder="0803 000 0000" />
    case 'number':
      return <Input type="number" disabled placeholder="0" />
    case 'date':
      return <Input type="date" disabled />
    case 'social_handle':
      return <Input disabled placeholder="@handle or profile link" />
    case 'dropdown':
      return <ChoiceList options={field.options ?? []} />
    case 'image':
    case 'images':
    case 'file':
      return <UploadPreview field={field} />
    case 'checkbox':
      return null
    case 'short_text':
    default:
      return <Input disabled placeholder="Short answer" />
  }
}

// Every choice, not a closed dropdown: the admin has to read them all.
function ChoiceList({ options }: { options: string[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Hint>
        Applicants choose one of {options.length} option
        {options.length === 1 ? '' : 's'}:
      </Hint>
      <ul className="border-input divide-border/60 flex flex-col divide-y rounded-[8px] border">
        {options.map((option) => (
          <li
            key={option}
            className="text-foreground px-4 py-2.5 text-sm whitespace-pre-wrap"
          >
            {option}
          </li>
        ))}
      </ul>
    </div>
  )
}

function UploadPreview({ field }: { field: Field }) {
  const max = field.maxFiles ?? 1
  const what =
    field.type === 'images'
      ? `Upload up to ${max} image${max === 1 ? '' : 's'}`
      : field.type === 'image'
        ? 'Upload an image'
        : 'Upload a PDF'
  const types = (field.acceptedFileTypes ?? [])
    .map((t) => FILE_TYPE_LABEL[t] ?? t)
    .join(', ')

  return (
    <div className="border-input text-muted-foreground flex flex-col items-center justify-center gap-1.5 rounded-[8px] border border-dashed px-4 py-6 text-center text-sm">
      <HugeiconsIcon
        icon={CloudUploadIcon}
        className="size-6"
        strokeWidth={1.8}
      />
      <span className="text-foreground font-medium">{what}</span>
      {types ? <span className="text-xs">{types}</span> : null}
    </div>
  )
}

function PriceOptionsPreview({ options }: { options: PriceOption[] }) {
  return (
    <QuestionCard heading="Every applicant" typeLabel="Payment">
      <QuestionText
        label="Choose an option"
        required
        helpText="Applicants pick one. A priced option is paid for when they submit."
      />
      <ul className="flex flex-col gap-2">
        {options.map((option) => (
          <li
            key={option.id}
            className="border-input flex flex-wrap items-center justify-between gap-2 rounded-[8px] border px-4 py-3 text-sm"
          >
            <span className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="border-input size-4 shrink-0 rounded-full border"
              />
              <span className="text-foreground font-medium">{option.name}</span>
            </span>
            <span className="flex items-center gap-3">
              <span className="text-muted-foreground text-xs">
                {option.quantityLimit === null
                  ? 'No limit'
                  : `${option.quantityLimit.toLocaleString('en-NG')} spots`}
              </span>
              <span className="text-foreground font-semibold">
                {formatNaira(option.priceMinor)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </QuestionCard>
  )
}

function DetailPill({ icon, text }: { icon: IconSvgElement; text: string }) {
  return (
    <span className="border-primary/30 bg-primary/5 text-foreground inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm">
      <HugeiconsIcon
        icon={icon}
        className="text-primary size-4"
        strokeWidth={1.8}
      />
      {text}
    </span>
  )
}
