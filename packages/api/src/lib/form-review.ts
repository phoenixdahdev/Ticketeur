import { TRPCError } from '@trpc/server'
import { eq, sql } from 'drizzle-orm'

import type { FormStatus } from '@ticketur/db'
import { forms } from '@ticketur/db'

import type { FieldColumns } from './form-fields'
import type { DbTransaction } from './forms'

// Admin review of registration forms. Organizers write their own questions,
// so a form could ask applicants for bank details, PINs or ID numbers; it
// takes submissions only while an admin has approved exactly what it asks.
//
// Reaching 'published': only an admin approving the revision they were shown
// (admin.moderation.approveForm), or an organizer reopening a closed form
// whose content is still that approved revision (org.forms.reopen). Nothing
// else writes 'published'.
//
// Staying honest: a change to reviewed content on a published form sends it
// back to 'pending_review' in the transaction that makes the change, holding
// the form row lock that intake's spot claim also takes. Intake admits a
// submission only while that row says 'published' (claimFormSpot), so the
// edit and the end of intake commit together: no submission is ever taken
// against edited content under the old approval.
//
// The boundary — what an admin reviews, so what sends a live form back:
//   - adding, editing or deleting a field: label, type, required, dropdown
//     choices, help text, validation config
//   - the form's title or description
//   - adding or deleting a price option, or changing one's name or price
// What doesn't (operational, or unable to introduce a question):
//   - reordering fields
//   - opening and closing times, capacity, review mode, the form's type label
//   - a price option's quantity limit (that is capacity)
// An edit that leaves every reviewed value as it was is no change at all.
//
// A closed form keeps its public page, which shows the title and description
// (not the fields), and it can't go back to review without reopening. So its
// wording is frozen (org.forms.update refuses), while its fields and options
// can change but only reopen through review (org.forms.reopen checks the
// revision).
//
// No admin bypass. events.update applies an admin's edit to a live event at
// once; forms deliberately don't mirror that. managesEvent lets an admin edit
// any organizer's form through the organizer API, which never shows anyone
// the form as an applicant sees it, so a bypass would put content live with
// no review on record. Instead every live form's content is a revision an
// admin approved from the review screen, and an admin who edits a form
// approves it there like anyone else's.

// What a content edit needs to know of its form, read under the row lock.
export type LockedForm = {
  id: string
  status: FormStatus
  title: string
  description: string
}

// Take the form row's lock for the rest of the transaction and read it. It is
// the lock lockForm in ./forms takes and intake's spot claim waits on. Every
// edit to reviewed content starts here, so the status it acts on can't change
// before it commits.
export async function lockFormForEdit(
  tx: DbTransaction,
  formId: string
): Promise<LockedForm> {
  const [row] = await tx
    .select({
      id: forms.id,
      status: forms.status,
      title: forms.title,
      description: forms.description,
    })
    .from(forms)
    .where(eq(forms.id, formId))
    .for('update')
  if (!row) throw new TRPCError({ code: 'NOT_FOUND' })
  return row
}

// What an edit did to its form's review state. Returned to the organizer so
// the builder can say the form went back to review (and stopped intake).
export type ReviewEffect = { formStatus: FormStatus; sentToReview: boolean }

export function unchangedReview(form: LockedForm): ReviewEffect {
  return { formStatus: form.status, sentToReview: false }
}

// Record a change to reviewed content, inside the transaction that made it
// and after lockFormForEdit. The revision moves on, so an approval of the one
// before fails, and a published form goes back to review.
export async function recordContentChange(
  tx: DbTransaction,
  form: LockedForm
): Promise<ReviewEffect> {
  const sendBack = form.status === 'published'
  const now = new Date()
  await tx
    .update(forms)
    .set({
      contentRevision: sql`${forms.contentRevision} + 1`,
      ...(sendBack
        ? { status: 'pending_review' as const, reviewRequestedAt: now }
        : {}),
      updatedAt: now,
    })
    .where(eq(forms.id, form.id))
  return {
    formStatus: sendBack ? 'pending_review' : form.status,
    sentToReview: sendBack,
  }
}

// Whether two field definitions ask the same question the same way: every
// reviewed column agrees. Position isn't one of them.
export function sameFieldContent(a: FieldColumns, b: FieldColumns): boolean {
  return (
    a.label === b.label &&
    a.helpText === b.helpText &&
    a.type === b.type &&
    a.required === b.required &&
    sameList(a.optionsJson, b.optionsJson) &&
    a.maxLength === b.maxLength &&
    a.minValue === b.minValue &&
    a.maxValue === b.maxValue &&
    sameList(a.acceptedFileTypes, b.acceptedFileTypes) &&
    a.maxFiles === b.maxFiles
  )
}

function sameList(
  a: readonly string[] | null,
  b: readonly string[] | null
): boolean {
  if (a === null || b === null) return a === b
  return a.length === b.length && a.every((value, i) => value === b[i])
}

// Where a form awaiting review came from, for the admin's queue: never
// reviewed, resubmitted after a rejection (rejectionReason survives until an
// approval), or approved once and changed since.
export type ReviewHistory = 'new' | 'resubmitted' | 'edited'

export function reviewHistory(form: {
  approvedRevision: number | null
  rejectionReason: string | null
}): ReviewHistory {
  if (form.rejectionReason !== null) return 'resubmitted'
  if (form.approvedRevision !== null) return 'edited'
  return 'new'
}
