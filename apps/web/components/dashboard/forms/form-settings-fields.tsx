'use client'

import { HugeiconsIcon } from '@hugeicons/react'
import { Alert02Icon, LockPasswordIcon } from '@hugeicons/core-free-icons'

import { cn } from '@ticketur/ui/lib/utils'
import { Input } from '@ticketur/ui/components/input'
import { Textarea } from '@ticketur/ui/components/textarea'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@ticketur/ui/components/field'
import {
  NativeSelect,
  NativeSelectOption,
} from '@ticketur/ui/components/native-select'
import type { FormReviewMode, FormType } from '@ticketur/db'

import {
  FORM_TYPE_HINT,
  FORM_TYPE_LABEL,
  fromDateTimeInput,
  toDateTimeInput,
  type FormDetail,
} from '@/lib/org-forms'

// The settings every form has. `org.forms.create` and `org.forms.update` take
// exactly this set and replace it wholesale, so one editor serves both.
//
// Two of these are reviewed content and the rest are operational — the server
// decides, in recordContentChange, and the UI must say which is which before
// the organizer types. Title and description sit above the questions on the
// public page, so an admin reads them; dates, capacity, review mode and the
// type label do not change what the form asks.

export type SettingsValues = {
  type: FormType
  title: string
  description: string
  opensAt: string
  closesAt: string
  capacity: string
  reviewMode: FormReviewMode
}

export type SettingsErrors = Partial<Record<keyof SettingsValues, string>>

export const EMPTY_SETTINGS: SettingsValues = {
  type: 'other',
  title: '',
  description: '',
  opensAt: '',
  closesAt: '',
  capacity: '',
  reviewMode: 'manual',
}

export function settingsFromForm(form: FormDetail['form']): SettingsValues {
  return {
    type: form.type,
    title: form.title,
    description: form.description,
    opensAt: toDateTimeInput(form.opensAt),
    closesAt: toDateTimeInput(form.closesAt),
    capacity: form.capacity === null ? '' : String(form.capacity),
    reviewMode: form.reviewMode,
  }
}

// Which of these the admin reviews, so the editor can warn before saving.
export function wordingChanged(
  values: SettingsValues,
  form: FormDetail['form']
): boolean {
  return (
    values.title.trim() !== form.title ||
    values.description.trim() !== form.description
  )
}

export type SettingsInput = {
  type: FormType
  title: string
  description: string
  opensAt: Date | null
  closesAt: Date | null
  capacity: number | null
  reviewMode: FormReviewMode
}

// Mirrors the zod shape on org.forms.create / update, so the organizer sees
// the problem in place rather than as a toast from the server.
export function validateSettings(
  values: SettingsValues
): { ok: true; input: SettingsInput } | { ok: false; errors: SettingsErrors } {
  const errors: SettingsErrors = {}

  const title = values.title.trim()
  if (title.length === 0) errors.title = 'Give your form a name'
  else if (title.length > 200)
    errors.title = 'Keep the name under 200 characters'

  const description = values.description.trim()
  if (description.length > 5000) {
    errors.description = 'Keep the description under 5,000 characters'
  }

  const opensAt = fromDateTimeInput(values.opensAt)
  if (values.opensAt.trim() && !opensAt) {
    errors.opensAt = 'That is not a valid date and time'
  }
  const closesAt = fromDateTimeInput(values.closesAt)
  if (values.closesAt.trim() && !closesAt) {
    errors.closesAt = 'That is not a valid date and time'
  }
  if (opensAt && closesAt && closesAt <= opensAt) {
    errors.closesAt = 'Closing time must be after the opening time'
  }

  let capacity: number | null = null
  const rawCapacity = values.capacity.trim()
  if (rawCapacity !== '') {
    const parsed = Number(rawCapacity)
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1_000_000) {
      errors.capacity = 'Enter a whole number of spots between 1 and 1,000,000'
    } else {
      capacity = parsed
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return {
    ok: true,
    input: {
      type: values.type,
      title,
      description,
      opensAt,
      closesAt,
      capacity,
      reviewMode: values.reviewMode,
    },
  }
}

export function SettingsFields({
  values,
  onChange,
  errors,
  disabled = false,
  // A closed form's public page still shows its title and description, so the
  // API freezes them until it is submitted for review again.
  wordingLocked = false,
  idPrefix = 'form',
}: {
  values: SettingsValues
  onChange: (next: SettingsValues) => void
  errors: SettingsErrors
  disabled?: boolean
  wordingLocked?: boolean
  idPrefix?: string
}) {
  const set = <K extends keyof SettingsValues>(
    key: K,
    value: SettingsValues[K]
  ) => onChange({ ...values, [key]: value })

  const id = (name: string) => `${idPrefix}-${name}`

  return (
    <div className="flex flex-col gap-5">
      {wordingLocked ? (
        <p className="border-border/60 bg-muted/40 text-muted-foreground flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs leading-5">
          <HugeiconsIcon
            icon={LockPasswordIcon}
            className="mt-px size-4 shrink-0"
            strokeWidth={1.8}
          />
          <span>
            This form is closed but its page is still public, so its name and
            description are frozen. Submit it for review to change them.
          </span>
        </p>
      ) : null}

      <ReviewedMarkerLegend />

      <Field data-invalid={errors.title ? true : undefined}>
        <FieldLabel htmlFor={id('title')} className="text-sm font-semibold">
          Form name <ReviewedMarker />
        </FieldLabel>
        <Input
          id={id('title')}
          value={values.title}
          maxLength={200}
          disabled={disabled || wordingLocked}
          onChange={(e) => set('title', e.target.value)}
          placeholder="e.g. Miss Lagos 2026 — Contestant Registration"
          aria-invalid={Boolean(errors.title)}
        />
        <FieldDescription>
          Applicants read this at the top of the form.
        </FieldDescription>
        <FieldError
          errors={[errors.title ? { message: errors.title } : undefined]}
        />
      </Field>

      <Field data-invalid={errors.description ? true : undefined}>
        <FieldLabel
          htmlFor={id('description')}
          className="text-sm font-semibold"
        >
          Description <ReviewedMarker />
        </FieldLabel>
        <Textarea
          id={id('description')}
          rows={4}
          maxLength={5000}
          disabled={disabled || wordingLocked}
          value={values.description}
          onChange={(e) => set('description', e.target.value)}
          placeholder="Who should apply, what you are looking for, what happens next."
          aria-invalid={Boolean(errors.description)}
        />
        <FieldDescription>
          {values.description.trim().length.toLocaleString('en-NG')} / 5,000
          characters.
        </FieldDescription>
        <FieldError
          errors={[
            errors.description ? { message: errors.description } : undefined,
          ]}
        />
      </Field>

      <Field>
        <FieldLabel htmlFor={id('type')} className="text-sm font-semibold">
          What is this form for?
        </FieldLabel>
        <NativeSelect
          id={id('type')}
          className="w-full"
          value={values.type}
          disabled={disabled}
          onChange={(e) => set('type', e.target.value as FormType)}
        >
          {(['contestant', 'vendor', 'other'] as const).map((type) => (
            <NativeSelectOption key={type} value={type}>
              {FORM_TYPE_LABEL[type]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <FieldDescription>{FORM_TYPE_HINT[values.type]}</FieldDescription>
      </Field>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Field data-invalid={errors.opensAt ? true : undefined}>
          <FieldLabel htmlFor={id('opensAt')} className="text-sm font-semibold">
            Opens
          </FieldLabel>
          <Input
            id={id('opensAt')}
            type="datetime-local"
            value={values.opensAt}
            disabled={disabled}
            onChange={(e) => set('opensAt', e.target.value)}
            aria-invalid={Boolean(errors.opensAt)}
          />
          <FieldDescription>
            Leave empty to open as soon as an admin approves it.
          </FieldDescription>
          <FieldError
            errors={[errors.opensAt ? { message: errors.opensAt } : undefined]}
          />
        </Field>

        <Field data-invalid={errors.closesAt ? true : undefined}>
          <FieldLabel
            htmlFor={id('closesAt')}
            className="text-sm font-semibold"
          >
            Closes
          </FieldLabel>
          <Input
            id={id('closesAt')}
            type="datetime-local"
            value={values.closesAt}
            disabled={disabled}
            onChange={(e) => set('closesAt', e.target.value)}
            aria-invalid={Boolean(errors.closesAt)}
          />
          <FieldDescription>
            Leave empty to stay open until you close it, or the event ends.
          </FieldDescription>
          <FieldError
            errors={[
              errors.closesAt ? { message: errors.closesAt } : undefined,
            ]}
          />
        </Field>

        <Field data-invalid={errors.capacity ? true : undefined}>
          <FieldLabel
            htmlFor={id('capacity')}
            className="text-sm font-semibold"
          >
            Spots
          </FieldLabel>
          <Input
            id={id('capacity')}
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={values.capacity}
            disabled={disabled}
            onChange={(e) => set('capacity', e.target.value)}
            placeholder="Unlimited"
            aria-invalid={Boolean(errors.capacity)}
          />
          <FieldDescription>
            The most applications the form holds at once. Rejecting one frees
            its spot.
          </FieldDescription>
          <FieldError
            errors={[
              errors.capacity ? { message: errors.capacity } : undefined,
            ]}
          />
        </Field>

        <Field>
          <FieldLabel
            htmlFor={id('reviewMode')}
            className="text-sm font-semibold"
          >
            Who approves applicants?
          </FieldLabel>
          <NativeSelect
            id={id('reviewMode')}
            className="w-full"
            value={values.reviewMode}
            disabled={disabled}
            onChange={(e) =>
              set('reviewMode', e.target.value as FormReviewMode)
            }
          >
            <NativeSelectOption value="manual">
              I review each applicant
            </NativeSelectOption>
            <NativeSelectOption value="auto">
              Approve automatically
            </NativeSelectOption>
          </NativeSelect>
          <FieldDescription>
            {values.reviewMode === 'auto'
              ? 'Applications are approved as soon as they are complete — and paid for, when there is a fee.'
              : 'Applications wait for you on the Applications tab.'}
          </FieldDescription>
        </Field>
      </div>
    </div>
  )
}

// A quiet dot beside the two settings an admin reviews, explained once above.
export function ReviewedMarker({ className }: { className?: string }) {
  return (
    <span
      title="Reviewed by an admin — changing this on a live form sends it back for review"
      className={cn(
        'ml-1 inline-flex items-center gap-1 align-middle text-[10px] font-bold tracking-wider text-amber-600 uppercase dark:text-amber-400',
        className
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      Reviewed
    </span>
  )
}

export function ReviewedMarkerLegend() {
  return (
    <p className="text-muted-foreground flex items-start gap-2 text-xs leading-5">
      <HugeiconsIcon
        icon={Alert02Icon}
        className="mt-px size-3.5 shrink-0"
        strokeWidth={1.9}
      />
      <span>
        Settings marked <ReviewedMarker /> are part of what an admin approves.
        Changing one on a live form sends it back for review and stops
        applications. The rest — dates, spots, approval mode and the form type —
        can be changed at any time without interrupting anything.
      </span>
    </p>
  )
}
