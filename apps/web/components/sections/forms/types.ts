import type { RouterOutputs } from '@ticketur/api'
import type { AnswerField } from '@ticketur/api/lib/form-fields'

// public.forms.bySlug answers in one of three shapes, and every one of them
// has to be rendered: null (no such form, or its event isn't public), a
// summary with the reason it isn't taking submissions, or the form itself.
export type FormBySlug = RouterOutputs['public']['forms']['bySlug']
export type OpenForm = Extract<NonNullable<FormBySlug>, { state: 'open' }>
export type UnavailableForm = Extract<
  NonNullable<FormBySlug>,
  { state: 'unavailable' }
>

export type PublicField = OpenForm['fields'][number]
export type PriceOption = OpenForm['priceOptions'][number]
export type FormEventSummary = OpenForm['event']
export type FormSummary = OpenForm['form']

// What the applicant has typed so far, keyed by field id exactly as submit
// wants it. Values stay raw (a number field holds the string being typed)
// until validateAnswers normalises them.
export type AnswerDraft = Record<string, unknown>

// validateAnswers reads a dropdown's choices from `optionsJson`; the wire
// shape calls them `options` (effectiveRules renames them). Same data.
export function toAnswerField(field: PublicField): AnswerField {
  return {
    id: field.id,
    label: field.label,
    required: field.required,
    type: field.type,
    optionsJson: field.options,
    maxLength: field.maxLength,
    minValue: field.minValue,
    maxValue: field.maxValue,
    acceptedFileTypes: field.acceptedFileTypes,
    maxFiles: field.maxFiles,
  }
}

export function isUploadField(field: PublicField): boolean {
  return (
    field.type === 'image' || field.type === 'images' || field.type === 'file'
  )
}
