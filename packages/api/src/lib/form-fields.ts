import { z } from 'zod'

import type {
  FormFieldType,
  SubmissionAnswers,
  SubmissionAnswerValue,
  SubmissionStatus,
} from '@ticketur/db'

// Registration-form fields: what each type accepts, the rules an organizer's
// field definition must meet, server-side validation of an applicant's
// answers, and the CSV formatting of those answers.
//
// Pure — no database or env access — so the form builder and the public form
// page can import (@ticketur/api/lib/form-fields) the very rules the server
// enforces instead of re-deriving them.

// ─── Field types ────────────────────────────────────────────────────────────

export const IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
] as const
export const PDF_MIME_TYPES = ['application/pdf'] as const

type FieldSpec =
  | { kind: 'text'; maxLength: number; lengthConfigurable: boolean }
  | { kind: 'number' }
  | { kind: 'date' }
  | { kind: 'dropdown' }
  | { kind: 'checkbox' }
  | {
      kind: 'upload'
      multiple: boolean
      maxFiles: number
      mimeTypes: readonly string[]
      typesConfigurable: boolean
    }

// Per-type behaviour. A spec's maxLength / maxFiles is both the default and
// the ceiling an organizer may configure. A checkbox is a single tick box;
// "required" on it means it must be ticked (consent, rules acknowledged).
export const FIELD_SPECS = {
  short_text: { kind: 'text', maxLength: 500, lengthConfigurable: true },
  long_text: { kind: 'text', maxLength: 10_000, lengthConfigurable: true },
  email: { kind: 'text', maxLength: 254, lengthConfigurable: false },
  phone: { kind: 'text', maxLength: 32, lengthConfigurable: false },
  // A handle ("@name") or a profile link.
  social_handle: { kind: 'text', maxLength: 200, lengthConfigurable: false },
  number: { kind: 'number' },
  date: { kind: 'date' },
  dropdown: { kind: 'dropdown' },
  checkbox: { kind: 'checkbox' },
  image: {
    kind: 'upload',
    multiple: false,
    maxFiles: 1,
    mimeTypes: IMAGE_MIME_TYPES,
    typesConfigurable: true,
  },
  images: {
    kind: 'upload',
    multiple: true,
    maxFiles: 5,
    mimeTypes: IMAGE_MIME_TYPES,
    typesConfigurable: true,
  },
  file: {
    kind: 'upload',
    multiple: false,
    maxFiles: 1,
    mimeTypes: PDF_MIME_TYPES,
    typesConfigurable: false,
  },
} as const satisfies Record<FormFieldType, FieldSpec>

// Derived from FIELD_SPECS, so a type can't be accepted without a spec.
export const FORM_FIELD_TYPES = Object.keys(FIELD_SPECS) as [
  FormFieldType,
  ...FormFieldType[],
]

export const MAX_FIELDS_PER_FORM = 100
export const MAX_DROPDOWN_OPTIONS = 100

// ─── Field definitions (organizer input) ────────────────────────────────────

// What an organizer sends for a field; add and update both take the whole
// definition. Config that doesn't apply to the chosen type is accepted and
// dropped by toFieldColumns, so a builder can switch a field's type without
// clearing stale settings first.
export const fieldDefinitionShape = {
  label: z.string().trim().min(1, 'Label required').max(200),
  helpText: z.string().trim().max(1000).default(''),
  type: z.enum(FORM_FIELD_TYPES),
  required: z.boolean().default(false),
  // Dropdown choices, in display order.
  options: z
    .array(z.string().trim().min(1).max(200))
    .max(MAX_DROPDOWN_OPTIONS)
    .nullable()
    .default(null),
  maxLength: z.number().int().min(1).nullable().default(null),
  minValue: z.number().nullable().default(null),
  maxValue: z.number().nullable().default(null),
  acceptedFileTypes: z.array(z.string()).max(10).nullable().default(null),
  maxFiles: z.number().int().min(1).nullable().default(null),
}

const fieldDefinition = z.object(fieldDefinitionShape)
export type FieldDefinition = z.infer<typeof fieldDefinition>

// Cross-field rules for a definition, as a zod superRefine.
export function checkFieldDefinition(
  v: FieldDefinition,
  ctx: z.RefinementCtx
): void {
  const spec: FieldSpec = FIELD_SPECS[v.type]

  if (v.type === 'dropdown') {
    const options = v.options ?? []
    if (options.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'Add at least one choice',
      })
    }
    const seen = new Set<string>()
    for (const option of options) {
      const key = option.toLowerCase()
      if (seen.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['options'],
          message: `"${option}" is listed more than once`,
        })
        break
      }
      seen.add(key)
    }
  }

  if (
    spec.kind === 'text' &&
    spec.lengthConfigurable &&
    v.maxLength !== null &&
    v.maxLength > spec.maxLength
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['maxLength'],
      message: `Can be at most ${spec.maxLength} characters`,
    })
  }

  if (
    v.type === 'number' &&
    v.minValue !== null &&
    v.maxValue !== null &&
    v.minValue > v.maxValue
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['maxValue'],
      message: 'Maximum must not be below the minimum',
    })
  }

  if (
    spec.kind === 'upload' &&
    spec.typesConfigurable &&
    v.acceptedFileTypes !== null
  ) {
    if (v.acceptedFileTypes.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['acceptedFileTypes'],
        message: 'Accept at least one file type',
      })
    }
    const unsupported = v.acceptedFileTypes.find(
      (t) => !spec.mimeTypes.includes(t)
    )
    if (unsupported) {
      ctx.addIssue({
        code: 'custom',
        path: ['acceptedFileTypes'],
        message: `Unsupported file type: ${unsupported}`,
      })
    }
  }

  if (
    v.type === 'images' &&
    v.maxFiles !== null &&
    v.maxFiles > FIELD_SPECS.images.maxFiles
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['maxFiles'],
      message: `At most ${FIELD_SPECS.images.maxFiles} images`,
    })
  }
}

// The form_fields columns a definition maps to, with config that doesn't
// apply to the type cleared to NULL.
export type FieldColumns = {
  label: string
  helpText: string
  type: FormFieldType
  required: boolean
  optionsJson: string[] | null
  maxLength: number | null
  minValue: number | null
  maxValue: number | null
  acceptedFileTypes: string[] | null
  maxFiles: number | null
}

export function toFieldColumns(v: FieldDefinition): FieldColumns {
  const spec: FieldSpec = FIELD_SPECS[v.type]
  return {
    label: v.label,
    helpText: v.helpText,
    type: v.type,
    required: v.required,
    optionsJson: v.type === 'dropdown' ? (v.options ?? []) : null,
    maxLength:
      spec.kind === 'text' && spec.lengthConfigurable ? v.maxLength : null,
    minValue: v.type === 'number' ? v.minValue : null,
    maxValue: v.type === 'number' ? v.maxValue : null,
    acceptedFileTypes:
      spec.kind === 'upload' && spec.typesConfigurable && v.acceptedFileTypes
        ? [...new Set(v.acceptedFileTypes)]
        : null,
    maxFiles: v.type === 'images' ? v.maxFiles : null,
  }
}

// ─── Effective rules ────────────────────────────────────────────────────────

export type FieldRules = Pick<
  FieldColumns,
  | 'type'
  | 'optionsJson'
  | 'maxLength'
  | 'minValue'
  | 'maxValue'
  | 'acceptedFileTypes'
  | 'maxFiles'
>

function acceptedTypes(
  spec: Extract<FieldSpec, { kind: 'upload' }>,
  configured: string[] | null
): string[] {
  const chosen =
    spec.typesConfigurable && configured
      ? configured.filter((t) => spec.mimeTypes.includes(t))
      : []
  return chosen.length > 0 ? chosen : [...spec.mimeTypes]
}

// The limits a field actually enforces, built-in defaults filled in. The
// public form receives these, so the UI never has to know the defaults.
export function effectiveRules(field: FieldRules) {
  const spec: FieldSpec = FIELD_SPECS[field.type]
  return {
    options: field.type === 'dropdown' ? (field.optionsJson ?? []) : null,
    maxLength:
      spec.kind === 'text'
        ? Math.min(field.maxLength ?? spec.maxLength, spec.maxLength)
        : null,
    minValue: field.type === 'number' ? field.minValue : null,
    maxValue: field.type === 'number' ? field.maxValue : null,
    acceptedFileTypes:
      spec.kind === 'upload'
        ? acceptedTypes(spec, field.acceptedFileTypes)
        : null,
    maxFiles:
      spec.kind === 'upload'
        ? Math.min(field.maxFiles ?? spec.maxFiles, spec.maxFiles)
        : null,
  }
}

// ─── Upload URLs ────────────────────────────────────────────────────────────

// Uploads go to the public Vercel Blob store before the form is submitted,
// and an answer carries the resulting URL. Anything else (another site, a
// non-https link, a file type the field doesn't take) is refused, so an
// applicant can't plant an arbitrary link in the organizer's review screen or
// export. The extension check mirrors the content-type policy enforced at
// upload time; it is a consistency check, not a substitute for it.
export const UPLOAD_HOST_SUFFIX = '.public.blob.vercel-storage.com'

const MIME_BY_EXTENSION = new Map<string, string>([
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['png', 'image/png'],
  ['webp', 'image/webp'],
  ['avif', 'image/avif'],
  ['pdf', 'application/pdf'],
])

const LABEL_BY_MIME = new Map<string, string>([
  ['image/jpeg', 'JPG'],
  ['image/png', 'PNG'],
  ['image/webp', 'WEBP'],
  ['image/avif', 'AVIF'],
  ['application/pdf', 'PDF'],
])

// An error message, or null when the URL is an acceptable upload.
export function uploadUrlError(
  value: string,
  accepted: readonly string[]
): string | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return 'Upload the file again'
  }
  if (
    value.length > 2048 ||
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    !url.hostname.endsWith(UPLOAD_HOST_SUFFIX)
  ) {
    return 'Upload the file here rather than linking to it'
  }
  const extension = url.pathname.split('.').pop()?.toLowerCase() ?? ''
  const mime = MIME_BY_EXTENSION.get(extension)
  if (!mime || !accepted.includes(mime)) {
    const labels = accepted.map((t) => LABEL_BY_MIME.get(t) ?? t).join(', ')
    return `That file type isn't accepted here (use ${labels})`
  }
  return null
}

// ─── Answer validation ──────────────────────────────────────────────────────

export type AnswerField = FieldRules & {
  id: string
  label: string
  required: boolean
}

export type AnswerError = { fieldId: string; label: string; message: string }

export type AnswerValidation =
  | { ok: true; answers: SubmissionAnswers }
  | { ok: false; errors: AnswerError[] }

type AnswerCheck =
  { value: SubmissionAnswerValue | undefined } | { error: string }

const emailSchema = z.email()
const NUMERIC = /^-?\d+(\.\d+)?$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const PHONE = /^\+?[\d\s().-]+$/
const HANDLE = /^@?[\w.-]{1,100}$/

function isBlank(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim() === '') ||
    (Array.isArray(value) && value.length === 0)
  )
}

function isIsoDate(text: string): boolean {
  if (!ISO_DATE.test(text)) return false
  const date = new Date(`${text}T00:00:00Z`)
  // Round-trips only for a real calendar date (rejects 2026-02-30).
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text
  )
}

function isPhone(text: string): boolean {
  // 7–15 digits: local Nigerian numbers (0803…) through full E.164.
  const digits = text.replace(/\D/g, '').length
  return PHONE.test(text) && digits >= 7 && digits <= 15
}

function isProfileLink(text: string): boolean {
  try {
    const url = new URL(text)
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      url.hostname.includes('.')
    )
  } catch {
    return false
  }
}

function textFormatError(type: FormFieldType, text: string): string | null {
  switch (type) {
    case 'email':
      return emailSchema.safeParse(text).success
        ? null
        : 'Enter a valid email address'
    case 'phone':
      return isPhone(text) ? null : 'Enter a valid phone number'
    case 'social_handle':
      return HANDLE.test(text) || isProfileLink(text)
        ? null
        : 'Enter a handle such as @yourname, or a link to your profile'
    default:
      return null
  }
}

function checkAnswer(field: AnswerField, value: unknown): AnswerCheck {
  const spec: FieldSpec = FIELD_SPECS[field.type]

  // A checkbox is always answered: unticked is a real answer.
  if (spec.kind === 'checkbox') {
    if (value !== undefined && value !== null && typeof value !== 'boolean') {
      return { error: 'Tick or untick this box' }
    }
    const ticked = value === true
    if (field.required && !ticked) return { error: 'This box must be ticked' }
    return { value: ticked }
  }

  if (isBlank(value)) {
    return field.required
      ? { error: 'This field is required' }
      : { value: undefined }
  }

  switch (spec.kind) {
    case 'text': {
      if (typeof value !== 'string') return { error: 'Enter text' }
      const text = value.trim()
      const max = Math.min(field.maxLength ?? spec.maxLength, spec.maxLength)
      if (text.length > max) {
        return { error: `Keep it to ${max} characters or fewer` }
      }
      const formatError = textFormatError(field.type, text)
      return formatError ? { error: formatError } : { value: text }
    }

    case 'number': {
      const n =
        typeof value === 'number'
          ? value
          : typeof value === 'string' && NUMERIC.test(value.trim())
            ? Number(value.trim())
            : Number.NaN
      if (!Number.isFinite(n)) return { error: 'Enter a number' }
      if (field.minValue !== null && n < field.minValue) {
        return { error: `Must be at least ${field.minValue}` }
      }
      if (field.maxValue !== null && n > field.maxValue) {
        return { error: `Must be at most ${field.maxValue}` }
      }
      return { value: n }
    }

    case 'date': {
      const text = typeof value === 'string' ? value.trim() : ''
      return isIsoDate(text) ? { value: text } : { error: 'Enter a valid date' }
    }

    case 'dropdown': {
      const choice = typeof value === 'string' ? value.trim() : null
      return choice !== null && (field.optionsJson ?? []).includes(choice)
        ? { value: choice }
        : { error: 'Choose one of the options' }
    }

    case 'upload': {
      const accepted = acceptedTypes(spec, field.acceptedFileTypes)

      if (!spec.multiple) {
        if (typeof value !== 'string') return { error: 'Upload a file' }
        const url = value.trim()
        const error = uploadUrlError(url, accepted)
        return error ? { error } : { value: url }
      }

      const items: unknown[] = Array.isArray(value) ? value : []
      if (
        items.length === 0 ||
        !items.every((item): item is string => typeof item === 'string')
      ) {
        return { error: 'Upload your images' }
      }
      const max = Math.min(field.maxFiles ?? spec.maxFiles, spec.maxFiles)
      if (items.length > max) {
        return { error: `Upload at most ${max} image${max === 1 ? '' : 's'}` }
      }
      const urls = items.map((item) => item.trim())
      if (new Set(urls).size !== urls.length) {
        return { error: 'The same image is uploaded more than once' }
      }
      for (const url of urls) {
        const error = uploadUrlError(url, accepted)
        if (error) return { error }
      }
      return { value: urls }
    }
  }
}

// Check an applicant's raw answers against the form's field definitions.
// Answers are keyed by field id; keys that match no field are dropped, and
// unanswered optional fields are left out of the result. Every field is
// checked so a form can show all its errors at once.
export function validateAnswers(
  fields: readonly AnswerField[],
  raw: Record<string, unknown>
): AnswerValidation {
  const answers: SubmissionAnswers = {}
  const errors: AnswerError[] = []
  for (const field of fields) {
    const value = Object.hasOwn(raw, field.id) ? raw[field.id] : undefined
    const result = checkAnswer(field, value)
    if ('error' in result) {
      errors.push({
        fieldId: field.id,
        label: field.label,
        message: result.error,
      })
    } else if (result.value !== undefined) {
      answers[field.id] = result.value
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, answers }
}

// One readable line for an error response, e.g. "Height: Must be at most
// 250 (and 2 more)".
export function describeAnswerErrors(errors: readonly AnswerError[]): string {
  const [first, ...rest] = errors
  if (!first) return 'Check your answers and try again.'
  const more = rest.length > 0 ? ` (and ${rest.length} more)` : ''
  return `${first.label}: ${first.message}${more}`
}

// ─── CSV export ─────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<SubmissionStatus, string> = {
  pending_payment: 'Pending payment',
  submitted: 'Submitted',
  approved: 'Approved',
  rejected: 'Rejected',
}

// Spreadsheet apps run a cell that starts with = + - @ (or a tab / carriage
// return) as a formula, which is how CSV injection works. Applicant text ends
// up in the organizer's spreadsheet, so such a cell gets a leading apostrophe,
// which spreadsheets hide and read as "this is text". Plain numbers and phone
// numbers (+234…) are left alone: with no letters they can't call a function.
export function csvSafe(cell: string): string {
  return /^[=+\-@\t\r]/.test(cell) && !/^[+-]?[\d\s().-]*$/.test(cell)
    ? `'${cell}`
    : cell
}

function answerCell(value: SubmissionAnswerValue | undefined): string {
  if (value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.join(', ')
  return String(value)
}

export type ExportSubmission = {
  reference: string
  status: SubmissionStatus
  createdAt: Date
  applicantName: string
  applicantEmail: string
  priceOptionName: string | null
  priceMinor: number | null
  reviewedAt: Date | null
  reason: string | null
  answers: SubmissionAnswers
}

// Header row plus one row per submission, every cell a CSV-safe string; the
// caller only has to quote and join them. One column per field in form order
// (duplicate labels get a " (2)" suffix); upload answers are their URLs.
export function buildSubmissionExport(args: {
  fields: readonly { id: string; label: string }[]
  hasPriceOptions: boolean
  submissions: readonly ExportSubmission[]
}): { headers: string[]; rows: string[][] } {
  const leading = ['Reference', 'Status', 'Submitted at', 'Name', 'Email']
  // The option's current price; what was actually charged is on the order.
  const pricing = args.hasPriceOptions ? ['Option', 'Option price (NGN)'] : []
  const trailing = ['Reviewed at', 'Rejection reason']

  const used = new Map<string, number>()
  for (const header of [...leading, ...pricing, ...trailing]) {
    used.set(header, 1)
  }
  const fieldHeaders = args.fields.map((field) => {
    const n = (used.get(field.label) ?? 0) + 1
    used.set(field.label, n)
    return n === 1 ? field.label : `${field.label} (${n})`
  })

  const headers = [...leading, ...pricing, ...fieldHeaders, ...trailing]
  const rows = args.submissions.map((s) => [
    s.reference,
    STATUS_LABELS[s.status],
    s.createdAt.toISOString(),
    s.applicantName,
    s.applicantEmail,
    ...(args.hasPriceOptions
      ? [
          s.priceOptionName ?? '',
          s.priceMinor === null ? '' : (s.priceMinor / 100).toFixed(2),
        ]
      : []),
    ...args.fields.map((field) => answerCell(s.answers[field.id])),
    s.reviewedAt ? s.reviewedAt.toISOString() : '',
    s.reason ?? '',
  ])

  return {
    headers: headers.map(csvSafe),
    rows: rows.map((row) => row.map(csvSafe)),
  }
}
