import { randomInt } from 'node:crypto'

import { TRPCError } from '@trpc/server'
import { and, eq, gt, isNull, lte, or, sql } from 'drizzle-orm'

import type {
  Database,
  EventStatus,
  FormReviewMode,
  FormStatus,
  SubmissionStatus,
} from '@ticketur/db'
import { formPriceOptions, forms, submissions } from '@ticketur/db'

import { newId } from './ids'
import { hasEnded } from './predicates'
import { slugify } from './slug'

// Registration-form lifecycle shared by the organizer and public routers:
// whether a form is taking submissions, claiming and releasing capacity, the
// status a finished submission lands in, references and slugs.

// The tx handle drizzle hands to `db.transaction(async (tx) => …)`.
export type DbTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0]

export const MAX_PRICE_OPTIONS_PER_FORM = 20

// ─── Availability ───────────────────────────────────────────────────────────

export type FormUnavailableReason = 'not_open' | 'closed' | 'full'

export type FormAvailability =
  { open: true } | { open: false; reason: FormUnavailableReason }

type SpotCounter = { quantityLimit: number | null; claimed: number }

// Spots an option has left; null when it has no limit.
export function optionRemaining(option: SpotCounter): number | null {
  return option.quantityLimit === null
    ? null
    : Math.max(0, option.quantityLimit - option.claimed)
}

// Whether a form takes submissions right now. One definition for the public
// page, the submit pre-check and the organizer's view, so they can't drift.
// claimFormSpot re-checks status, window and capacity atomically; this is the
// read-side answer that lets the UI say why a form is unavailable.
export function formAvailability(
  form: {
    status: FormStatus
    opensAt: Date | null
    closesAt: Date | null
    capacity: number | null
    claimed: number
  },
  event: { eventDate: string | null; endDate: string | null },
  priceOptions: readonly SpotCounter[],
  now: Date = new Date()
): FormAvailability {
  if (form.status !== 'published') return { open: false, reason: 'closed' }
  // Whatever the form's own window says, it stops taking submissions once
  // its event is over, by the same rule that stops ticket sales.
  if (hasEnded(event, now.toISOString().slice(0, 10))) {
    return { open: false, reason: 'closed' }
  }
  if (form.closesAt && now >= form.closesAt) {
    return { open: false, reason: 'closed' }
  }
  if (form.opensAt && now < form.opensAt) {
    return { open: false, reason: 'not_open' }
  }
  if (form.capacity !== null && form.claimed >= form.capacity) {
    return { open: false, reason: 'full' }
  }
  // A form whose every price option is taken is as full as one at capacity.
  if (
    priceOptions.length > 0 &&
    priceOptions.every((option) => optionRemaining(option) === 0)
  ) {
    return { open: false, reason: 'full' }
  }
  return { open: true }
}

// A form can only be created or opened on an event that is still running and
// still the organizer's to run: not archived, not suspended by an admin, not
// already over.
export function assertEventAcceptsForms(event: {
  status: EventStatus
  eventDate: string | null
  endDate: string | null
}): void {
  if (event.status === 'archived' || event.status === 'suspended') {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'This event is no longer active.',
    })
  }
  if (hasEnded(event)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'This event has already ended.',
    })
  }
}

// ─── Spots (capacity) ───────────────────────────────────────────────────────

export type FormSpotFailure =
  | 'unavailable' // the form stopped taking submissions (closed, window)
  | 'full' // the form is at capacity
  | 'option_full' // the chosen price option is at its quantity limit
  | 'option_gone' // the chosen price option no longer exists

// Thrown by claimFormSpot when no spot could be taken, so each caller can
// answer in its own way (intake tells the applicant; re-approval tells the
// organizer).
export class FormSpotError extends Error {
  constructor(
    public readonly failure: FormSpotFailure,
    public readonly optionName?: string
  ) {
    super(`No spot available on this form (${failure})`)
    this.name = 'FormSpotError'
  }
}

// Take one spot on a form, and on the chosen price option if any — the only
// way forms.claimed / form_price_options.claimed go up. Each is a conditional
// UPDATE (`claimed + 1 <= limit`), the guard mintOrderTickets uses on ticket
// tiers: the row lock queues concurrent claims, Postgres re-evaluates the
// WHERE against the row as the previous claim left it, and a zero-row result
// means the limit was just reached. The form row is always locked before the
// option row, here and in releaseFormSpot, so claims can't deadlock.
//
// Pass `openAt` for intake: the same UPDATE then also requires the form to be
// published and inside its window at that instant, so a submission racing a
// close (or the closing time) can't slip in after it. A reviewer re-approving
// a rejected submission omits it; only the limits apply to them.
//
// Must run inside the caller's transaction: if anything after it fails, the
// rollback hands the spot back.
export async function claimFormSpot(
  tx: DbTransaction,
  args: { formId: string; priceOptionId: string | null; openAt?: Date }
): Promise<void> {
  const formConditions = [
    eq(forms.id, args.formId),
    sql`(${forms.capacity} IS NULL OR ${forms.claimed} + 1 <= ${forms.capacity})`,
  ]
  if (args.openAt) {
    formConditions.push(
      eq(forms.status, 'published'),
      or(isNull(forms.opensAt), lte(forms.opensAt, args.openAt))!,
      or(isNull(forms.closesAt), gt(forms.closesAt, args.openAt))!
    )
  }

  const claimedForm = await tx
    .update(forms)
    .set({ claimed: sql`${forms.claimed} + 1` })
    .where(and(...formConditions))
    .returning({ id: forms.id })

  if (claimedForm.length === 0) {
    // Only to word the error: the UPDATE above already decided.
    const [current] = await tx
      .select({ capacity: forms.capacity, claimed: forms.claimed })
      .from(forms)
      .where(eq(forms.id, args.formId))
      .limit(1)
    const atCapacity =
      current !== undefined &&
      current.capacity !== null &&
      current.claimed >= current.capacity
    throw new FormSpotError(atCapacity ? 'full' : 'unavailable')
  }

  if (!args.priceOptionId) return

  const claimedOption = await tx
    .update(formPriceOptions)
    .set({ claimed: sql`${formPriceOptions.claimed} + 1` })
    .where(
      and(
        eq(formPriceOptions.id, args.priceOptionId),
        eq(formPriceOptions.formId, args.formId),
        sql`(${formPriceOptions.quantityLimit} IS NULL OR ${formPriceOptions.claimed} + 1 <= ${formPriceOptions.quantityLimit})`
      )
    )
    .returning({ id: formPriceOptions.id })

  if (claimedOption.length === 0) {
    const [option] = await tx
      .select({ name: formPriceOptions.name })
      .from(formPriceOptions)
      .where(
        and(
          eq(formPriceOptions.id, args.priceOptionId),
          eq(formPriceOptions.formId, args.formId)
        )
      )
      .limit(1)
    throw new FormSpotError(
      option ? 'option_full' : 'option_gone',
      option?.name
    )
  }
}

// Give a spot back: a submission was rejected (or, on the paid path, its
// payment was abandoned). Same lock order as claimFormSpot. GREATEST keeps a
// counter that has somehow drifted from going negative.
export async function releaseFormSpot(
  tx: DbTransaction,
  args: { formId: string; priceOptionId: string | null }
): Promise<void> {
  await tx
    .update(forms)
    .set({ claimed: sql`GREATEST(${forms.claimed} - 1, 0)` })
    .where(eq(forms.id, args.formId))
  if (args.priceOptionId) {
    await tx
      .update(formPriceOptions)
      .set({ claimed: sql`GREATEST(${formPriceOptions.claimed} - 1, 0)` })
      .where(eq(formPriceOptions.id, args.priceOptionId))
  }
}

// Take the form row's lock for the rest of the transaction. Field and price
// option edits take it first: intake's spot claim locks the same row before
// it reads the fields to validate against, so a submission is always checked
// against a field set no edit is halfway through changing.
export async function lockForm(tx: DbTransaction, formId: string) {
  const [row] = await tx
    .select({ id: forms.id })
    .from(forms)
    .where(eq(forms.id, formId))
    .for('update')
  if (!row) throw new TRPCError({ code: 'NOT_FOUND' })
}

// ─── Submissions ────────────────────────────────────────────────────────────

// The status a complete submission lands in: a free one on arrival, a paid
// one once its payment confirms (the paid path should call this too).
export function completedStatus(
  reviewMode: FormReviewMode
): Extract<SubmissionStatus, 'submitted' | 'approved'> {
  return reviewMode === 'auto' ? 'approved' : 'submitted'
}

// No 0/O or 1/I/L: a reference gets read out over the phone and typed back.
const REFERENCE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

// Eight characters as XXXX-XXXX, e.g. "K7QM-3XPD": 31^8 ≈ 8.5 × 10^11 codes.
export function generateSubmissionReference(): string {
  let code = ''
  for (let i = 0; i < 8; i += 1) {
    code += REFERENCE_ALPHABET.charAt(randomInt(REFERENCE_ALPHABET.length))
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`
}

type NewSubmission = Omit<typeof submissions.$inferInsert, 'id' | 'reference'>

// Insert a submission under a fresh reference. A clash is vanishingly rare,
// but an applicant who has just filled in a long form must not get a 500 for
// it, so a clash is retried with a new code. ON CONFLICT DO NOTHING leaves
// the transaction usable after a clash, where a unique violation would abort
// it (and with it the spot already claimed).
export async function insertSubmission(
  tx: DbTransaction,
  values: NewSubmission
): Promise<{ id: string; reference: string }> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = newId('sub')
    const reference = generateSubmissionReference()
    const inserted = await tx
      .insert(submissions)
      .values({ ...values, id, reference })
      .onConflictDoNothing({ target: submissions.reference })
      .returning({ id: submissions.id })
    if (inserted.length > 0) return { id, reference }
  }
  throw new Error('Could not allocate a unique submission reference')
}

// ─── Slugs ──────────────────────────────────────────────────────────────────

// The public form slug: the event's slug plus the form title (e.g.
// "miss-lagos-2026-contestant-registration"), so a shared link reads well and
// forms on different events rarely collide. -2, -3, … on collision; creation
// is rare, and the unique constraint on forms.slug backstops a race.
export async function generateUniqueFormSlug(
  db: Database,
  eventSlug: string,
  title: string
): Promise<string> {
  const base = slugify(`${eventSlug.slice(0, 40)} ${title}`)
  let candidate = base
  for (let n = 2; n < 1000; n++) {
    const existing = await db
      .select({ id: forms.id })
      .from(forms)
      .where(eq(forms.slug, candidate))
      .limit(1)
    if (existing.length === 0) return candidate
    candidate = `${base}-${n}`
  }
  // Pathological fallback, effectively unreachable.
  return `${base}-${Date.now()}`
}
