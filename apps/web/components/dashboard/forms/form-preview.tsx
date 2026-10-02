'use client'

import { HugeiconsIcon } from '@hugeicons/react'
import { CloudUploadIcon } from '@hugeicons/core-free-icons'

import { Checkbox } from '@ticketur/ui/components/checkbox'
import { Input } from '@ticketur/ui/components/input'
import { Textarea } from '@ticketur/ui/components/textarea'
import { calculateFeeMinor } from '@ticketur/api/lib/fees'
import { effectiveRules } from '@ticketur/api/lib/form-fields'

import { formatNaira } from '@/lib/event-display'
import {
  FIELD_TYPE_LABEL,
  fileTypeLabels,
  formatOptionPrice,
  intakeWindowLabel,
  plural,
  type FormDetail,
  type FormField,
  type FormPriceOption,
} from '@/lib/org-forms'

// What the applicant sees, and — because the admin reviews the questions
// exactly as they are asked — what the admin sees too. Nothing here is
// interactive: it is a mirror, not a form.
export function FormPreview({ data }: { data: FormDetail }) {
  const { form, fields, priceOptions, serviceFeeBps } = data
  // A paid option costs the applicant more than the organizer typed: the
  // platform service fee is added on top, as it is on a ticket. The preview
  // has to say so, or an organizer sets a ₦5,000 booth fee and finds out from
  // an applicant that it is really ₦5,250.
  const anyPriced = priceOptions.some((option) => option.priceMinor > 0)

  return (
    <section className="flex shrink-0 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-heading text-foreground text-base font-bold tracking-tight md:text-lg">
          Preview
        </h2>
        <p className="text-muted-foreground text-sm">
          Exactly what applicants are shown — and what the admin reads when they
          review your questions. Read it through before you submit.
        </p>
      </div>

      <div className="border-border/60 bg-muted/30 flex flex-col gap-5 rounded-2xl border p-5 md:p-7">
        <header className="flex flex-col gap-2">
          <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
            {data.event.title}
          </p>
          <h3 className="font-heading text-foreground text-xl font-bold tracking-tight md:text-2xl">
            {form.title || 'Untitled form'}
          </h3>
          {form.description ? (
            <p className="text-muted-foreground text-sm leading-6 whitespace-pre-wrap">
              {form.description}
            </p>
          ) : (
            <p className="text-muted-foreground/70 text-sm italic">
              No description yet.
            </p>
          )}
          <p className="text-muted-foreground text-xs">
            {intakeWindowLabel(form)}
            {form.capacity !== null
              ? ` · ${Math.max(0, form.capacity - form.claimed).toLocaleString('en-NG')} of ${form.capacity.toLocaleString('en-NG')} spots left`
              : ''}
          </p>
        </header>

        <QuestionCard heading="Every form asks this" typeLabel="Contact">
          <QuestionText label="Full name" required />
          <Input disabled placeholder="Full name" />
          <QuestionText label="Email address" required />
          <Input type="email" disabled placeholder="name@example.com" />
          <Hint>
            Collected on every form so you can reach the applicant, whatever
            else you ask.
          </Hint>
        </QuestionCard>

        {fields.length === 0 ? (
          <p className="border-border/60 text-muted-foreground rounded-xl border border-dashed bg-transparent p-6 text-center text-sm">
            No questions yet — add one and it appears here.
          </p>
        ) : (
          fields.map((field, index) => (
            <FieldPreview key={field.id} field={field} number={index + 1} />
          ))
        )}

        {priceOptions.length > 0 ? (
          <PriceOptionsPreview
            options={priceOptions}
            serviceFeeBps={serviceFeeBps}
          />
        ) : null}

        <p className="text-muted-foreground border-border/60 border-t pt-4 text-xs">
          {priceOptions.length === 0
            ? 'This form is free to apply to.'
            : anyPriced
              ? 'An applicant picks one option and pays for it, when it has a fee, as part of submitting. The total is what they are charged: your price plus the platform service fee, which Ticketeur keeps. You receive your price.'
              : 'An applicant picks one option as part of submitting. Every option is free, so there is nothing to pay.'}
        </p>
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
    <div className="border-border/60 bg-background flex flex-col gap-3 rounded-xl border p-4">
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

// The limits a field enforces that an applicant is told about up front.
function rulesHint(field: FormField): string | null {
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
      return field.required ? 'Must be ticked to apply' : null
    default:
      return null
  }
}

function FieldPreview({ field, number }: { field: FormField; number: number }) {
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

function FieldControl({ field }: { field: FormField }) {
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
      return <ChoiceList options={field.optionsJson ?? []} />
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

// Every choice is listed rather than hidden behind a closed dropdown: the
// point of the preview is to read what is actually being asked.
function ChoiceList({ options }: { options: string[] }) {
  if (options.length === 0) {
    return (
      <p className="border-input text-muted-foreground rounded-[8px] border border-dashed px-4 py-3 text-xs">
        No choices yet — this question cannot be submitted for review.
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-1.5">
      <Hint>Applicants choose one of {plural(options.length, 'option')}:</Hint>
      <ul className="border-input divide-border/60 flex flex-col divide-y rounded-[8px] border">
        {options.map((option, index) => (
          <li
            key={`${option}-${index}`}
            className="text-foreground px-4 py-2.5 text-sm whitespace-pre-wrap"
          >
            {option}
          </li>
        ))}
      </ul>
    </div>
  )
}

function UploadPreview({ field }: { field: FormField }) {
  const rules = effectiveRules(field)
  const max = rules.maxFiles ?? 1
  const what =
    field.type === 'images'
      ? `Upload up to ${plural(max, 'image')}`
      : field.type === 'image'
        ? 'Upload an image'
        : 'Upload a PDF'

  return (
    <div className="border-input text-muted-foreground flex flex-col items-center justify-center gap-1.5 rounded-[8px] border border-dashed px-4 py-6 text-center text-sm">
      <HugeiconsIcon
        icon={CloudUploadIcon}
        className="size-6"
        strokeWidth={1.8}
      />
      <span className="text-foreground font-medium">{what}</span>
      <span className="text-xs">
        {fileTypeLabels(rules.acceptedFileTypes ?? [])}
      </span>
    </div>
  )
}

// What the applicant is charged for each option: the organizer's price, the
// platform service fee on top, and the total — the same three lines, from the
// same calculateFeeMinor, that the applicant sees on the real form
// (components/sections/forms/form-apply.tsx). The rate rides in on
// org.forms.byId, the query the builder already makes, so it is never
// hardcoded here.
function PriceOptionsPreview({
  options,
  serviceFeeBps,
}: {
  options: FormPriceOption[]
  serviceFeeBps: number
}) {
  return (
    <QuestionCard heading="Every applicant" typeLabel="Payment">
      <QuestionText
        label="Choose an option"
        required
        helpText="Applicants pick one. A priced option is paid for when they submit."
      />
      <ul className="flex flex-col gap-2">
        {options.map((option) => {
          const left =
            option.quantityLimit === null
              ? null
              : Math.max(0, option.quantityLimit - option.claimed)
          const feeMinor = calculateFeeMinor(option.priceMinor, serviceFeeBps)
          const payableMinor = option.priceMinor + feeMinor
          return (
            <li
              key={option.id}
              className="border-input flex flex-col gap-2 rounded-[8px] border px-4 py-3 text-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="border-input size-4 shrink-0 rounded-full border"
                  />
                  <span className="text-foreground font-medium">
                    {option.name}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="text-muted-foreground text-xs">
                    {left === null
                      ? 'No limit'
                      : left === 0
                        ? 'Full'
                        : `${left.toLocaleString('en-NG')} left`}
                  </span>
                  <span className="text-foreground font-semibold">
                    {formatOptionPrice(option.priceMinor)}
                  </span>
                </span>
              </div>
              {feeMinor > 0 ? (
                <div className="border-border/60 flex flex-col gap-1 border-t pt-2 text-xs">
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="text-muted-foreground">Service fee</span>
                    <span className="text-muted-foreground font-medium">
                      {formatNaira(feeMinor)}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="text-foreground font-semibold">
                      Applicant pays
                    </span>
                    <span className="text-foreground font-semibold">
                      {formatNaira(payableMinor)}
                    </span>
                  </div>
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
    </QuestionCard>
  )
}
