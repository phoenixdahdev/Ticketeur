'use client'

import { HugeiconsIcon } from '@hugeicons/react'
import { Alert02Icon } from '@hugeicons/core-free-icons'

import { cn } from '@ticketur/ui/lib/utils'
import { Input } from '@ticketur/ui/components/input'
import { Textarea } from '@ticketur/ui/components/textarea'
import { Checkbox } from '@ticketur/ui/components/checkbox'
import {
  NativeSelect,
  NativeSelectOption,
} from '@ticketur/ui/components/native-select'

import { FormUploadField } from '@/components/sections/forms/form-upload-field'
import {
  isUploadField,
  type PublicField,
} from '@/components/sections/forms/types'

// One question. Every one of the twelve field types renders through here, with
// the limits the organizer set (length, range, choices, accepted file types)
// applied to the control itself — so the keyboard, the picker and the step
// buttons agree with what the server will accept.

function textValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return ''
}

export function FormFieldInput({
  field,
  value,
  onChange,
  error,
  signedIn,
  onRequestSignin,
  onBusyChange,
  disabled,
}: {
  field: PublicField
  value: unknown
  onChange: (next: unknown) => void
  error: string | null
  signedIn: boolean
  onRequestSignin: () => void
  onBusyChange: (busy: boolean) => void
  disabled?: boolean
}) {
  const controlId = `field-${field.id}`
  const helpId = field.helpText ? `${controlId}-help` : undefined
  const errorId = error ? `${controlId}-error` : undefined
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined
  const invalid = error !== null

  const common = {
    id: controlId,
    'aria-describedby': describedBy,
    'aria-invalid': invalid,
    disabled,
  } as const

  // A checkbox reads label-first everywhere else in the app, and the tick box
  // belongs beside the sentence it agrees to.
  if (field.type === 'checkbox') {
    return (
      <div
        className="flex scroll-mt-28 flex-col gap-2"
        id={`anchor-${field.id}`}
      >
        <div className="flex items-start gap-3">
          <Checkbox
            {...common}
            checked={value === true}
            onCheckedChange={(checked) => onChange(checked === true)}
            className="mt-0.5"
          />
          <label
            htmlFor={controlId}
            className="text-foreground cursor-pointer text-sm leading-6 font-medium"
          >
            {field.label}
            {field.required ? (
              <span className="text-destructive ml-1" aria-hidden>
                *
              </span>
            ) : null}
            {field.helpText ? (
              <span
                id={helpId}
                className="text-muted-foreground block text-sm font-normal"
              >
                {field.helpText}
              </span>
            ) : null}
          </label>
        </div>
        <FieldErrorText id={errorId} message={error} />
      </div>
    )
  }

  return (
    <div className="flex scroll-mt-28 flex-col gap-2" id={`anchor-${field.id}`}>
      <label
        htmlFor={controlId}
        className="text-foreground text-sm font-semibold"
      >
        {field.label}
        {field.required ? (
          <span className="text-destructive ml-1" aria-hidden>
            *
          </span>
        ) : (
          <span className="text-muted-foreground ml-2 text-xs font-normal">
            Optional
          </span>
        )}
      </label>

      {field.helpText ? (
        <p
          id={helpId}
          className="text-muted-foreground -mt-1 text-sm leading-5"
        >
          {field.helpText}
        </p>
      ) : null}

      {renderControl()}

      <FieldErrorText id={errorId} message={error} />
    </div>
  )

  function renderControl() {
    if (isUploadField(field)) {
      return (
        <FormUploadField
          field={field}
          value={value}
          onChange={onChange}
          invalid={invalid}
          describedBy={describedBy}
          signedIn={signedIn}
          onRequestSignin={onRequestSignin}
          onBusyChange={onBusyChange}
          disabled={disabled}
        />
      )
    }

    switch (field.type) {
      case 'long_text': {
        const text = textValue(value)
        return (
          <div className="flex flex-col gap-1">
            <Textarea
              {...common}
              rows={5}
              maxLength={field.maxLength ?? undefined}
              value={text}
              onChange={(e) => onChange(e.target.value)}
              className="min-h-28"
            />
            {field.maxLength ? (
              <span
                className={cn(
                  'self-end text-xs',
                  text.length > field.maxLength * 0.9
                    ? 'text-destructive'
                    : 'text-muted-foreground'
                )}
              >
                {text.length} / {field.maxLength}
              </span>
            ) : null}
          </div>
        )
      }

      case 'dropdown':
        return (
          <NativeSelect
            className="w-full"
            {...common}
            value={textValue(value)}
            onChange={(e) => onChange(e.target.value)}
          >
            <NativeSelectOption value="">Choose one…</NativeSelectOption>
            {(field.options ?? []).map((option) => (
              <NativeSelectOption key={option} value={option}>
                {option}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )

      case 'number':
        return (
          <Input
            {...common}
            type="number"
            inputMode="decimal"
            min={field.minValue ?? undefined}
            max={field.maxValue ?? undefined}
            placeholder={rangeHint(field)}
            value={textValue(value)}
            onChange={(e) => onChange(e.target.value)}
          />
        )

      case 'date':
        return (
          <Input
            {...common}
            type="date"
            value={textValue(value)}
            onChange={(e) => onChange(e.target.value)}
          />
        )

      case 'email':
        return (
          <Input
            {...common}
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="you@example.com"
            maxLength={field.maxLength ?? undefined}
            value={textValue(value)}
            onChange={(e) => onChange(e.target.value)}
          />
        )

      case 'phone':
        return (
          <Input
            {...common}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="0803 000 0000"
            maxLength={field.maxLength ?? undefined}
            value={textValue(value)}
            onChange={(e) => onChange(e.target.value)}
          />
        )

      case 'social_handle':
        return (
          <Input
            {...common}
            type="text"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="@yourname or a link to your profile"
            maxLength={field.maxLength ?? undefined}
            value={textValue(value)}
            onChange={(e) => onChange(e.target.value)}
          />
        )

      default:
        return (
          <Input
            {...common}
            type="text"
            maxLength={field.maxLength ?? undefined}
            value={textValue(value)}
            onChange={(e) => onChange(e.target.value)}
          />
        )
    }
  }
}

function rangeHint(field: PublicField): string | undefined {
  const { minValue: min, maxValue: max } = field
  if (min !== null && max !== null) return `${min} – ${max}`
  if (min !== null) return `${min} or more`
  if (max !== null) return `${max} or less`
  return undefined
}

function FieldErrorText({
  id,
  message,
}: {
  id: string | undefined
  message: string | null
}) {
  if (!message) return null
  return (
    <p
      id={id}
      role="alert"
      className="text-destructive flex items-start gap-1.5 text-sm leading-5"
    >
      <HugeiconsIcon
        icon={Alert02Icon}
        className="mt-0.5 size-3.5 shrink-0"
        strokeWidth={2}
      />
      {message}
    </p>
  )
}
