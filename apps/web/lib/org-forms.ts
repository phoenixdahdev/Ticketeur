import { format } from 'date-fns'

import type { RouterOutputs } from '@ticketur/api'
import type {
  FormFieldType,
  FormStatus,
  FormType,
  SubmissionStatus,
} from '@ticketur/db'

// Shared vocabulary for the organizer's registration-form screens: how each
// status reads, what each field type is for, and the small conversions the
// builder needs (kobo ↔ naira, Date ↔ <input type="datetime-local">).
//
// The review lifecycle is the thing these screens exist to communicate, so
// the copy that explains it lives here once and is used everywhere a form
// appears. See packages/api/src/lib/form-review.ts for the rules it describes.

export type FormListRow = RouterOutputs['org']['forms']['list'][number]
export type FormDetail = NonNullable<RouterOutputs['org']['forms']['byId']>
export type FormField = FormDetail['fields'][number]
export type FormPriceOption = FormDetail['priceOptions'][number]
export type SubmissionRow =
  RouterOutputs['org']['forms']['submissions']['list']['rows'][number]
export type SubmissionDetailData = NonNullable<
  RouterOutputs['org']['forms']['submissions']['byId']
>
export type SubmissionAnswer = SubmissionDetailData['answers'][number]

// What every content mutation reports back: whether saving took a live form
// offline. `org.forms.update`, `fields.*` and `priceOptions.*` all return it.
export type ReviewEffect = { formStatus: FormStatus; sentToReview: boolean }

export const SUBMISSIONS_PAGE_SIZE = 20

// ─── Forms ──────────────────────────────────────────────────────────────────

export const FORM_STATUS_LABEL: Record<FormStatus, string> = {
  draft: 'Draft',
  pending_review: 'In review',
  published: 'Live',
  rejected: 'Rejected',
  closed: 'Closed',
  suspended: 'Taken down',
}

export const FORM_STATUS_TONE: Record<FormStatus, string> = {
  draft: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  pending_review:
    'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400',
  published:
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
  rejected: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400',
  closed: 'bg-muted text-muted-foreground',
  suspended:
    'bg-rose-600 text-white dark:bg-rose-500/80 dark:text-rose-50',
}

// One line saying what the status means for applicants right now.
export const FORM_STATUS_MEANING: Record<FormStatus, string> = {
  draft: 'Not visible to anyone. Submit it for review when it is ready.',
  pending_review:
    'Waiting for an admin to approve the questions. It is not taking applications.',
  published: 'Live — applicants can apply inside its opening window.',
  rejected:
    'Turned down by an admin. Fix what they asked for and submit it again.',
  closed: 'Not taking applications. Every submission is kept.',
  suspended:
    'An admin took this form off the platform. Its page is not public and it takes no applications.',
}

export const FORM_TYPE_LABEL: Record<FormType, string> = {
  contestant: 'Contestant',
  vendor: 'Vendor',
  other: 'Other',
}

export const FORM_TYPE_HINT: Record<FormType, string> = {
  contestant: 'Pageant contestants, competitors, performers.',
  vendor: 'Stalls and booths, usually with priced booth types.',
  other: 'Anything else — volunteers, press, general registration.',
}

export const REVIEW_MODE_LABEL: Record<'auto' | 'manual', string> = {
  auto: 'Approve automatically',
  manual: 'I review each applicant',
}

export const UNAVAILABLE_REASON_LABEL: Record<
  'not_open' | 'closed' | 'full',
  string
> = {
  not_open: 'Its opening time has not arrived yet',
  closed: 'Its closing time has passed, or the event is over',
  full: 'Every spot is taken',
}

// The public page a published form is served at. The slug is generated once
// at creation and never changes, so a link already shared keeps working.
export function publicFormPath(slug: string): string {
  return `/forms/${slug}`
}

// ─── Submissions ────────────────────────────────────────────────────────────

export const SUBMISSION_STATUS_LABEL: Record<SubmissionStatus, string> = {
  pending_payment: 'Awaiting payment',
  submitted: 'Needs review',
  approved: 'Approved',
  rejected: 'Rejected',
}

export const SUBMISSION_STATUS_TONE: Record<SubmissionStatus, string> = {
  pending_payment:
    'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  submitted: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400',
  approved:
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
  rejected: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400',
}

// ─── Fields ─────────────────────────────────────────────────────────────────

export const FIELD_TYPE_LABEL: Record<FormFieldType, string> = {
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
  file: 'PDF file',
  social_handle: 'Social handle',
}

export const FIELD_TYPE_HINT: Record<FormFieldType, string> = {
  short_text: 'One line of text — a name, a stage name, a city.',
  long_text: 'A paragraph — a bio, a pitch, why they should be picked.',
  email: 'An email address, checked for you.',
  phone: 'A phone number, 7–15 digits.',
  number: 'A number, with optional smallest and largest values.',
  date: 'A calendar date, such as a date of birth.',
  dropdown: 'A list of choices; the applicant picks exactly one.',
  checkbox: 'A single tick box — rules accepted, consent given.',
  image: 'One photo.',
  images: 'Up to five photos.',
  file: 'One PDF — a CV, a portfolio, a certificate.',
  social_handle: 'A handle like @name, or a link to a profile.',
}

// Grouped for the type picker so twelve types stay readable.
export const FIELD_TYPE_GROUPS: {
  label: string
  types: FormFieldType[]
}[] = [
  { label: 'Text', types: ['short_text', 'long_text'] },
  { label: 'Contact', types: ['email', 'phone', 'social_handle'] },
  { label: 'Structured', types: ['number', 'date', 'dropdown', 'checkbox'] },
  { label: 'Uploads', types: ['image', 'images', 'file'] },
]

export const FILE_TYPE_LABEL: Record<string, string> = {
  'image/jpeg': 'JPG',
  'image/png': 'PNG',
  'image/webp': 'WEBP',
  'image/avif': 'AVIF',
  'application/pdf': 'PDF',
}

export function fileTypeLabels(mimeTypes: readonly string[]): string {
  return mimeTypes.map((t) => FILE_TYPE_LABEL[t] ?? t).join(', ')
}

// ─── Money (minor units) ────────────────────────────────────────────────────

// Price options are stored in kobo. 0 is a real, free choice on an otherwise
// paid form, so it reads as "Free" rather than "₦0".
export function formatOptionPrice(priceMinor: number): string {
  return priceMinor === 0
    ? 'Free'
    : `₦${(priceMinor / 100).toLocaleString('en-NG', {
        maximumFractionDigits: 2,
      })}`
}

export function nairaToKobo(naira: string): number | null {
  const trimmed = naira.trim()
  if (trimmed === '') return null
  const amount = Number(trimmed)
  if (!Number.isFinite(amount) || amount < 0) return null
  return Math.round(amount * 100)
}

export function koboToNaira(priceMinor: number): string {
  return String(priceMinor / 100)
}

// ─── Dates ──────────────────────────────────────────────────────────────────

// <input type="datetime-local"> speaks local wall-clock time with no zone;
// the API takes real Dates (superjson carries them intact).
export function toDateTimeInput(value: Date | string | null): string {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

export function fromDateTimeInput(value: string): Date | null {
  if (!value.trim()) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

// Same shape as the admin's review screen, so an organizer and an admin
// quote the same timestamp back to each other. 12-hour with am/pm: "2:00" on
// its own is read as either two o'clock.
export function formatDateTime(value: Date | string | null): string {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return format(date, "d MMM yyyy 'at' h:mm a")
}

// "Open 3 Oct – 20 Oct", or what is known of it.
export function intakeWindowLabel(form: {
  opensAt: Date | string | null
  closesAt: Date | string | null
}): string {
  const opens = formatDateTime(form.opensAt)
  const closes = formatDateTime(form.closesAt)
  if (opens && closes) return `${opens} – ${closes}`
  if (opens) return `Opens ${opens}`
  if (closes) return `Closes ${closes}`
  return 'Open until you close it, or the event ends'
}

export function plural(n: number, word: string): string {
  return `${n.toLocaleString('en-NG')} ${word}${n === 1 ? '' : 's'}`
}

// ─── Events that can carry a form ───────────────────────────────────────────

// Mirrors assertEventAcceptsForms (packages/api/src/lib/forms.ts) and the
// hasEnded rule it uses, so the event picker only offers events the server
// will accept rather than letting the organizer discover it in an error.
export function eventAcceptsForms(event: {
  status: string
  eventDate: string | null
  endDate: string | null
}): boolean {
  if (event.status === 'archived' || event.status === 'suspended') return false
  const lastDay = event.endDate ?? event.eventDate
  const today = new Date().toISOString().slice(0, 10)
  return lastDay === null || lastDay >= today
}

// ─── CSV download ───────────────────────────────────────────────────────────

// `submissions.export` returns cells already guarded against spreadsheet
// formula injection; quoting and joining them is all that is left. The BOM
// makes Excel read the file as UTF-8, so ₦ and accented names survive.
export function downloadCsv(table: {
  filename: string
  headers: string[]
  rows: string[][]
}): void {
  const quote = (cell: string) => `"${cell.replace(/"/g, '""')}"`
  const body = [table.headers, ...table.rows]
    .map((row) => row.map(quote).join(','))
    .join('\r\n')
  const blob = new Blob([`﻿${body}\r\n`], {
    type: 'text/csv;charset=utf-8;',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = table.filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
