'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { z } from 'zod'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Delete02Icon,
  PlusSignIcon,
} from '@hugeicons/core-free-icons'

import { cn } from '@ticketur/ui/lib/utils'
import { Button } from '@ticketur/ui/components/button'
import { Checkbox } from '@ticketur/ui/components/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@ticketur/ui/components/dialog'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@ticketur/ui/components/field'
import { Input } from '@ticketur/ui/components/input'
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from '@ticketur/ui/components/native-select'
import { Textarea } from '@ticketur/ui/components/textarea'
import {
  checkFieldDefinition,
  fieldDefinitionShape,
  FIELD_SPECS,
  MAX_DROPDOWN_OPTIONS,
} from '@ticketur/api/lib/form-fields'
import type { FormFieldType } from '@ticketur/db'

import {
  FIELD_TYPE_GROUPS,
  FIELD_TYPE_HINT,
  FIELD_TYPE_LABEL,
  FILE_TYPE_LABEL,
  type FormField,
} from '@/lib/org-forms'
import { LiveEditWarning } from '@/components/dashboard/forms/review-notice'

// Add or edit one question. The rules are not restated here: the dialog
// validates with the very schema the server uses
// (packages/api/src/lib/form-fields.ts), so what it accepts and what it
// refuses can't drift from what org.forms.fields.add/update will do.
const fieldSchema = z
  .object(fieldDefinitionShape)
  .superRefine(checkFieldDefinition)

type FieldDraft = {
  label: string
  helpText: string
  type: FormFieldType
  required: boolean
  options: string[]
  maxLength: string
  minValue: string
  maxValue: string
  // null = not restricted, which is what NULL means in the database: every
  // type the field's spec allows. An empty array is the organizer having
  // unticked everything, which is an error rather than a silent "all" — so
  // the two are kept apart.
  acceptedFileTypes: string[] | null
  maxFiles: string
}

const EMPTY_DRAFT: FieldDraft = {
  label: '',
  helpText: '',
  type: 'short_text',
  required: false,
  options: [''],
  maxLength: '',
  minValue: '',
  maxValue: '',
  acceptedFileTypes: null,
  maxFiles: '',
}

function draftFromField(field: FormField): FieldDraft {
  return {
    label: field.label,
    helpText: field.helpText,
    type: field.type,
    required: field.required,
    options: field.optionsJson?.length ? [...field.optionsJson] : [''],
    maxLength: field.maxLength === null ? '' : String(field.maxLength),
    minValue: field.minValue === null ? '' : String(field.minValue),
    maxValue: field.maxValue === null ? '' : String(field.maxValue),
    acceptedFileTypes: field.acceptedFileTypes,
    maxFiles: field.maxFiles === null ? '' : String(field.maxFiles),
  }
}

function numberOrNull(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

export type FieldDefinitionInput = z.output<typeof fieldSchema>

function toDefinition(draft: FieldDraft): Record<string, unknown> {
  const spec = FIELD_SPECS[draft.type]
  const configurable = spec.kind === 'upload' && spec.typesConfigurable
  const allTypes =
    spec.kind === 'upload' ? (spec.mimeTypes as readonly string[]) : []
  // Config left over from a type the organizer switched away from is dropped,
  // exactly as toFieldColumns does on the server.
  const chosen =
    configurable && draft.acceptedFileTypes !== null
      ? draft.acceptedFileTypes.filter((t) => allTypes.includes(t))
      : null
  return {
    label: draft.label,
    helpText: draft.helpText,
    type: draft.type,
    required: draft.required,
    options:
      draft.type === 'dropdown'
        ? draft.options.map((o) => o.trim()).filter((o) => o !== '')
        : null,
    maxLength: numberOrNull(draft.maxLength),
    minValue: numberOrNull(draft.minValue),
    maxValue: numberOrNull(draft.maxValue),
    // All of them is what the default already means, so it is sent as NULL —
    // otherwise re-saving an untouched field would read as a content change
    // and take a live form offline for nothing. An empty list is sent as it
    // is, so the shared schema can refuse it.
    acceptedFileTypes:
      chosen === null || chosen.length === allTypes.length ? null : chosen,
    maxFiles: numberOrNull(draft.maxFiles),
  }
}

type DraftErrors = Partial<Record<keyof FieldDraft, string>>

export function FieldDialog({
  open,
  onOpenChange,
  field,
  isLive,
  pending,
  hasSubmissions,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  // null = adding a new question.
  field: FormField | null
  // The form is published, so saving will take it offline for review.
  isLive: boolean
  pending: boolean
  hasSubmissions: boolean
  onSave: (definition: FieldDefinitionInput) => void
}) {
  const [draft, setDraft] = useState<FieldDraft>(EMPTY_DRAFT)
  const [errors, setErrors] = useState<DraftErrors>({})
  const [confirming, setConfirming] = useState(false)

  // Load the draft when the dialog opens on a question, and only then. The
  // `field` object is new on every refetch of the form, so keying this on the
  // object itself would throw away whatever the organizer had typed the
  // moment a background refetch landed.
  const latest = useRef(field)
  latest.current = field
  const fieldId = field?.id ?? null
  useEffect(() => {
    if (!open) return
    const editing = latest.current
    setDraft(editing ? draftFromField(editing) : EMPTY_DRAFT)
    setErrors({})
    setConfirming(false)
  }, [open, fieldId])

  const set = <K extends keyof FieldDraft>(key: K, value: FieldDraft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }))

  function validate(): FieldDefinitionInput | null {
    const parsed = fieldSchema.safeParse(toDefinition(draft))
    if (parsed.success) {
      setErrors({})
      return parsed.data
    }
    const next: DraftErrors = {}
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? 'label') as keyof FieldDraft
      next[key] ??= issue.message
    }
    setErrors(next)
    return null
  }

  function onPrimary() {
    const definition = validate()
    if (!definition) return
    // A live form goes offline the moment this saves, so the organizer reads
    // what that means and confirms it here rather than finding out after.
    if (isLive && !confirming) {
      setConfirming(true)
      return
    }
    onSave(definition)
  }

  const typeLocked = Boolean(field) && hasSubmissions

  return (
    <Dialog open={open} onOpenChange={pending ? () => {} : onOpenChange}>
      <DialogContent className="max-h-[90svh] gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="border-border/60 border-b px-5 py-4 md:px-6">
          <DialogTitle>
            {field ? 'Edit question' : 'Add a question'}
          </DialogTitle>
          <DialogDescription>
            {field
              ? 'Answers already given keep the value they were saved with.'
              : 'It is added at the end; reorder the list afterwards.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[62svh] flex-col gap-5 overflow-y-auto px-5 py-5 md:px-6">
          {isLive ? <LiveEditWarning what="a question" /> : null}

          <Field>
            <FieldLabel htmlFor="fld-type" className="text-sm font-semibold">
              Answer type
            </FieldLabel>
            <NativeSelect
              id="fld-type"
              className="w-full"
              value={draft.type}
              disabled={pending || typeLocked}
              onChange={(e) => set('type', e.target.value as FormFieldType)}
            >
              {FIELD_TYPE_GROUPS.map((group) => (
                <NativeSelectOptGroup key={group.label} label={group.label}>
                  {group.types.map((type) => (
                    <NativeSelectOption key={type} value={type}>
                      {FIELD_TYPE_LABEL[type]}
                    </NativeSelectOption>
                  ))}
                </NativeSelectOptGroup>
              ))}
            </NativeSelect>
            <FieldDescription>
              {typeLocked
                ? 'Applicants have answered this form, so the answer type is fixed. Add a new question instead.'
                : FIELD_TYPE_HINT[draft.type]}
            </FieldDescription>
          </Field>

          <Field data-invalid={errors.label ? true : undefined}>
            <FieldLabel htmlFor="fld-label" className="text-sm font-semibold">
              {draft.type === 'checkbox' ? 'Statement to tick' : 'Question'}
            </FieldLabel>
            <Input
              id="fld-label"
              value={draft.label}
              maxLength={200}
              disabled={pending}
              onChange={(e) => set('label', e.target.value)}
              placeholder={
                draft.type === 'checkbox'
                  ? 'I have read and accept the rules'
                  : 'e.g. What is your stage name?'
              }
              aria-invalid={Boolean(errors.label)}
            />
            <FieldError
              errors={[errors.label ? { message: errors.label } : undefined]}
            />
          </Field>

          <Field data-invalid={errors.helpText ? true : undefined}>
            <FieldLabel htmlFor="fld-help" className="text-sm font-semibold">
              Help text{' '}
              <span className="text-muted-foreground">(optional)</span>
            </FieldLabel>
            <Textarea
              id="fld-help"
              rows={2}
              maxLength={1000}
              disabled={pending}
              value={draft.helpText}
              onChange={(e) => set('helpText', e.target.value)}
              placeholder="A full-length photo, no filters."
              aria-invalid={Boolean(errors.helpText)}
            />
            <FieldDescription>Shown under the question.</FieldDescription>
            <FieldError
              errors={[
                errors.helpText ? { message: errors.helpText } : undefined,
              ]}
            />
          </Field>

          <label className="border-border/60 flex cursor-pointer items-start gap-3 rounded-xl border p-3">
            <Checkbox
              checked={draft.required}
              disabled={pending}
              onCheckedChange={(checked) => set('required', checked === true)}
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-foreground text-sm font-semibold">
                {draft.type === 'checkbox'
                  ? 'Must be ticked to apply'
                  : 'Required'}
              </span>
              <span className="text-muted-foreground text-xs">
                {draft.type === 'checkbox'
                  ? 'Use this for rules and consent an applicant has to agree to.'
                  : 'An applicant cannot submit without answering this.'}
              </span>
            </span>
          </label>

          <TypeConfig
            draft={draft}
            set={set}
            errors={errors}
            disabled={pending}
          />
        </div>

        <div className="border-border/60 bg-muted/30 flex flex-col gap-3 border-t px-5 py-4 md:px-6">
          {confirming ? (
            <p className="text-sm leading-6 font-medium text-amber-700 dark:text-amber-300">
              Saving now takes your form offline and sends it back to the admin
              review queue. It stops accepting applications until that version
              is approved. Save anyway?
            </p>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() =>
                confirming ? setConfirming(false) : onOpenChange(false)
              }
            >
              {confirming ? 'Go back' : 'Cancel'}
            </Button>
            <Button type="button" disabled={pending} onClick={onPrimary}>
              {pending
                ? 'Saving…'
                : confirming
                  ? 'Yes, save and send for review'
                  : isLive
                    ? 'Save and send for review'
                    : field
                      ? 'Save question'
                      : 'Add question'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Per-type configuration ─────────────────────────────────────────────────

function TypeConfig({
  draft,
  set,
  errors,
  disabled,
}: {
  draft: FieldDraft
  set: <K extends keyof FieldDraft>(key: K, value: FieldDraft[K]) => void
  errors: DraftErrors
  disabled: boolean
}) {
  const spec = FIELD_SPECS[draft.type]

  if (spec.kind === 'text') {
    if (!spec.lengthConfigurable) {
      return (
        <ConfigNote>
          {draft.type === 'email'
            ? 'Checked for you — an applicant has to enter a real email address.'
            : draft.type === 'phone'
              ? 'Checked for you — 7 to 15 digits, so 0803… and +234… both work.'
              : 'Checked for you — a handle such as @yourname, or a link to a profile.'}
        </ConfigNote>
      )
    }
    return (
      <Field data-invalid={errors.maxLength ? true : undefined}>
        <FieldLabel htmlFor="fld-maxlen" className="text-sm font-semibold">
          Character limit{' '}
          <span className="text-muted-foreground">(optional)</span>
        </FieldLabel>
        <Input
          id="fld-maxlen"
          type="number"
          inputMode="numeric"
          min={1}
          max={spec.maxLength}
          step={1}
          disabled={disabled}
          value={draft.maxLength}
          onChange={(e) => set('maxLength', e.target.value)}
          placeholder={String(spec.maxLength)}
          aria-invalid={Boolean(errors.maxLength)}
        />
        <FieldDescription>
          Up to {spec.maxLength.toLocaleString('en-NG')} characters. Leave empty
          for the full allowance.
        </FieldDescription>
        <FieldError
          errors={[
            errors.maxLength ? { message: errors.maxLength } : undefined,
          ]}
        />
      </Field>
    )
  }

  if (draft.type === 'number') {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field data-invalid={errors.minValue ? true : undefined}>
          <FieldLabel htmlFor="fld-min" className="text-sm font-semibold">
            Smallest allowed
          </FieldLabel>
          <Input
            id="fld-min"
            type="number"
            disabled={disabled}
            value={draft.minValue}
            onChange={(e) => set('minValue', e.target.value)}
            placeholder="No limit"
            aria-invalid={Boolean(errors.minValue)}
          />
          <FieldError
            errors={[
              errors.minValue ? { message: errors.minValue } : undefined,
            ]}
          />
        </Field>
        <Field data-invalid={errors.maxValue ? true : undefined}>
          <FieldLabel htmlFor="fld-max" className="text-sm font-semibold">
            Largest allowed
          </FieldLabel>
          <Input
            id="fld-max"
            type="number"
            disabled={disabled}
            value={draft.maxValue}
            onChange={(e) => set('maxValue', e.target.value)}
            placeholder="No limit"
            aria-invalid={Boolean(errors.maxValue)}
          />
          <FieldError
            errors={[
              errors.maxValue ? { message: errors.maxValue } : undefined,
            ]}
          />
        </Field>
      </div>
    )
  }

  if (draft.type === 'dropdown') {
    return (
      <OptionsEditor
        options={draft.options}
        onChange={(options) => set('options', options)}
        error={errors.options}
        disabled={disabled}
      />
    )
  }

  if (spec.kind === 'upload') {
    // NULL means "every type this field can take", so the boxes start all
    // ticked; unticking the last one leaves an empty list, which the shared
    // schema refuses rather than quietly reading as "all" again.
    const selected: string[] =
      draft.acceptedFileTypes ??
      (spec.kind === 'upload' ? [...spec.mimeTypes] : [])
    return (
      <div className="flex flex-col gap-4">
        {spec.typesConfigurable ? (
          <Field data-invalid={errors.acceptedFileTypes ? true : undefined}>
            <FieldLabel className="text-sm font-semibold">
              File types you accept
            </FieldLabel>
            <div className="flex flex-wrap gap-2">
              {spec.mimeTypes.map((mime) => {
                const checked = selected.includes(mime)
                return (
                  <label
                    key={mime}
                    className={cn(
                      'border-border/60 flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm',
                      checked ? 'bg-primary/5 border-primary/40' : ''
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      disabled={disabled}
                      onCheckedChange={(next) => {
                        set(
                          'acceptedFileTypes',
                          next === true
                            ? [...new Set([...selected, mime])]
                            : selected.filter((t) => t !== mime)
                        )
                      }}
                    />
                    {FILE_TYPE_LABEL[mime] ?? mime}
                  </label>
                )
              })}
            </div>
            <FieldDescription>
              Leave them all ticked to accept any of these.
            </FieldDescription>
            <FieldError
              errors={[
                errors.acceptedFileTypes
                  ? { message: errors.acceptedFileTypes }
                  : undefined,
              ]}
            />
          </Field>
        ) : (
          <ConfigNote>Applicants upload one PDF.</ConfigNote>
        )}

        {draft.type === 'images' ? (
          <Field data-invalid={errors.maxFiles ? true : undefined}>
            <FieldLabel
              htmlFor="fld-maxfiles"
              className="text-sm font-semibold"
            >
              How many images
            </FieldLabel>
            <Input
              id="fld-maxfiles"
              type="number"
              inputMode="numeric"
              min={1}
              max={FIELD_SPECS.images.maxFiles}
              step={1}
              disabled={disabled}
              value={draft.maxFiles}
              onChange={(e) => set('maxFiles', e.target.value)}
              placeholder={String(FIELD_SPECS.images.maxFiles)}
              aria-invalid={Boolean(errors.maxFiles)}
            />
            <FieldDescription>
              1 to {FIELD_SPECS.images.maxFiles}. Leave empty for{' '}
              {FIELD_SPECS.images.maxFiles}.
            </FieldDescription>
            <FieldError
              errors={[
                errors.maxFiles ? { message: errors.maxFiles } : undefined,
              ]}
            />
          </Field>
        ) : null}
      </div>
    )
  }

  if (draft.type === 'date') {
    return <ConfigNote>Applicants pick a calendar date.</ConfigNote>
  }

  return null
}

function ConfigNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="border-border/60 bg-muted/40 text-muted-foreground rounded-xl border px-3 py-2.5 text-xs leading-5">
      {children}
    </p>
  )
}

// Dropdown choices, in the order applicants will see them. Moving a choice
// uses buttons rather than a drag handle so it works from the keyboard.
function OptionsEditor({
  options,
  onChange,
  error,
  disabled,
}: {
  options: string[]
  onChange: (options: string[]) => void
  error?: string
  disabled: boolean
}) {
  const filled = useMemo(
    () => options.filter((o) => o.trim() !== '').length,
    [options]
  )

  function move(from: number, to: number) {
    if (to < 0 || to >= options.length) return
    const next = [...options]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved!)
    onChange(next)
  }

  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel className="text-sm font-semibold">Choices</FieldLabel>
      <ul className="flex flex-col gap-2">
        {options.map((option, index) => (
          <li key={index} className="flex items-center gap-2">
            <Input
              value={option}
              maxLength={200}
              disabled={disabled}
              aria-label={`Choice ${index + 1}`}
              onChange={(e) => {
                const next = [...options]
                next[index] = e.target.value
                onChange(next)
              }}
              placeholder={`Choice ${index + 1}`}
            />
            <div className="flex shrink-0 items-center gap-1">
              <MiniButton
                label={`Move choice ${index + 1} up`}
                icon={ArrowUp01Icon}
                disabled={disabled || index === 0}
                onClick={() => move(index, index - 1)}
              />
              <MiniButton
                label={`Move choice ${index + 1} down`}
                icon={ArrowDown01Icon}
                disabled={disabled || index === options.length - 1}
                onClick={() => move(index, index + 1)}
              />
              <MiniButton
                label={`Remove choice ${index + 1}`}
                icon={Delete02Icon}
                tone="danger"
                disabled={disabled || options.length <= 1}
                onClick={() => onChange(options.filter((_, i) => i !== index))}
              />
            </div>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between gap-3">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || options.length >= MAX_DROPDOWN_OPTIONS}
          onClick={() => onChange([...options, ''])}
          className="gap-1.5"
        >
          <HugeiconsIcon
            icon={PlusSignIcon}
            className="size-4"
            strokeWidth={2}
          />
          Add choice
        </Button>
        <FieldDescription className="m-0">
          {filled} of up to {MAX_DROPDOWN_OPTIONS}
        </FieldDescription>
      </div>
      <FieldError errors={[error ? { message: error } : undefined]} />
    </Field>
  )
}

function MiniButton({
  label,
  icon,
  onClick,
  disabled,
  tone = 'default',
}: {
  label: string
  icon: Parameters<typeof HugeiconsIcon>[0]['icon']
  onClick: () => void
  disabled?: boolean
  tone?: 'default' | 'danger'
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'border-border/60 focus-visible:ring-primary/40 inline-flex size-9 items-center justify-center rounded-md border transition-colors outline-none focus-visible:ring-2',
        'disabled:cursor-not-allowed disabled:opacity-30',
        tone === 'danger'
          ? 'text-destructive hover:bg-destructive/10'
          : 'text-foreground hover:bg-muted'
      )}
    >
      <HugeiconsIcon icon={icon} className="size-4" strokeWidth={1.8} />
    </button>
  )
}
