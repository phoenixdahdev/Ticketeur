import { TRPCError } from '@trpc/server'
import { and, asc, desc, eq, inArray, notExists, sql } from 'drizzle-orm'
import { z } from 'zod'

import type { Database, SubmissionAnswers } from '@ticketur/db'
import {
  contestCategories,
  entries,
  events,
  formFields,
  forms,
  submissions,
  votes,
} from '@ticketur/db'

import { createTRPCRouter, organizerProcedure } from '../../trpc'
import { newId } from '../../lib/ids'
import {
  callerOwnsEntry,
  managedEvents,
  ownedContest,
  requireOwnedCategory,
  requireOwnedContest,
  requireOwnedEntry,
} from '../../lib/contest-access'
import {
  assertContentEditable,
  lockContestForEdit,
  recordContentChange,
  unchangedReview,
  type LockedContest,
} from '../../lib/contest-review'
import { ENTRY_SUBMISSION_INDEX, isUniqueViolation } from '../../lib/contests'
import { IMAGE_MIME_TYPES, uploadUrlError } from '../../lib/form-fields'
import type { DbTransaction } from '../../lib/votes'

// The ballot. An entry is usually an approved registration promoted across
// from one of the event's forms; it can also be typed in by hand, for a
// contestant who never filled anything in.
//
// ── What is reviewed ──
// An entry's display name, photo and bio are the words and the face the
// public votes on, every one of them written or chosen by the organizer. So
// adding an entry or editing those three is reviewed content: on a live
// contest it goes back to the admin queue and voting stops until the new
// ballot is approved.
//
// Withdrawing, disqualifying or reinstating an entry is NOT. That is
// moderation: it takes a name off the ballot, or puts back one an admin has
// already seen. Making it reviewable would mean an organizer removing a
// cheat mid-contest took the whole contest — and everybody's paid credits —
// offline. Reordering is not reviewed either.
//
// ── What is kept ──
// An entry with votes against it is never deleted. `withdrawn` and
// `disqualified` exist precisely so a contestant can come off the ballot
// while the votes already cast for them stay on the record. The public page
// carries them on showing it, flagged, and `castVotes` refuses new votes for
// it in the same statement that would have counted one.

const entryShape = {
  displayName: z.string().trim().min(1).max(200),
  // Must be an upload on our own blob store. An entry photo is rendered on a
  // public page, so an arbitrary link would let an organizer point the
  // contest at anything at all; this is the check an applicant's own image
  // answer goes through (lib/form-fields.ts).
  photoUrl: z
    .string()
    .trim()
    .max(2048)
    .nullable()
    .default(null)
    .refine(
      (value) =>
        value === null ||
        value === '' ||
        uploadUrlError(value, IMAGE_MIME_TYPES) === null,
      { message: 'Upload the photo here rather than linking to it' }
    )
    .transform((value) => (value === '' ? null : value)),
  bio: z.string().trim().max(2000).default(''),
}

const entryStatusEnum = z.enum(['active', 'withdrawn', 'disqualified'])

/**
 * The photo an entry inherits from the application behind it: the first
 * answer to the form's first image question. Read the way the organizer's
 * submission list reads its thumbnails, so the face on the shortlist and the
 * face on the ballot are the same one.
 *
 * `null` when the form asks for no picture, or the applicant skipped it —
 * the organizer can add one afterwards.
 */
async function photoFromSubmission(
  db: Database,
  formId: string,
  answers: SubmissionAnswers
): Promise<string | null> {
  const [photoField] = await db
    .select({ id: formFields.id, type: formFields.type })
    .from(formFields)
    .where(
      and(
        eq(formFields.formId, formId),
        inArray(formFields.type, ['image', 'images'])
      )
    )
    .orderBy(asc(formFields.position), asc(formFields.id))
    .limit(1)
  if (!photoField) return null

  const value = answers[photoField.id]
  const url =
    photoField.type === 'images'
      ? Array.isArray(value) && typeof value[0] === 'string'
        ? value[0]
        : null
      : typeof value === 'string'
        ? value
        : null
  if (!url) return null
  // The answer was validated at submit time against that field's own
  // accepted types; re-check it here because this is the moment it becomes
  // contest content, and a field could have accepted something else.
  return uploadUrlError(url, IMAGE_MIME_TYPES) === null ? url : null
}

/**
 * Put one entry on the ballot, inside the transaction that holds the
 * contest's lock. Shared by `promote` and `add`, so a hand-typed entry and a
 * promoted one land identically — the only difference is whether there is a
 * submission behind it.
 */
async function insertEntry(
  tx: DbTransaction,
  locked: LockedContest,
  values: {
    id: string
    categoryId: string
    submissionId: string | null
    displayName: string
    photoUrl: string | null
    bio: string
  }
): Promise<void> {
  // The category is re-read under its own lock: it was resolved before the
  // transaction, and a concurrent delete would otherwise make the INSERT a
  // foreign-key 500 rather than a sentence.
  const [category] = await tx
    .select({ id: contestCategories.id })
    .from(contestCategories)
    .where(
      and(
        eq(contestCategories.id, values.categoryId),
        eq(contestCategories.contestId, locked.id)
      )
    )
    .for('update')
  if (!category) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'That category is no longer part of this contest.',
    })
  }

  const [last] = await tx
    .select({ lastSort: sql<number | null>`MAX(${entries.sortOrder})` })
    .from(entries)
    .where(eq(entries.categoryId, values.categoryId))

  await tx.insert(entries).values({
    id: values.id,
    contestId: locked.id,
    categoryId: values.categoryId,
    submissionId: values.submissionId,
    displayName: values.displayName,
    photoUrl: values.photoUrl,
    bio: values.bio,
    sortOrder: (last?.lastSort ?? -1) + 1,
  })
}

export const orgContestEntriesRouter = createTRPCRouter({
  // ─── Queries ──────────────────────────────────────────────────────────────

  // The approved applications on this contest's event, and which of them are
  // already on the ballot. Approved only: an application still being reviewed
  // or turned down is not a contestant.
  //
  // The owner is bound into this statement in its own right, not inherited
  // from the lookup above it.
  eligibleSubmissions: organizerProcedure
    .input(z.object({ contestId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { contest, event } = await requireOwnedContest(ctx, input.contestId)

      return ctx.db
        .select({
          id: submissions.id,
          reference: submissions.reference,
          applicantName: submissions.applicantName,
          applicantEmail: submissions.applicantEmail,
          createdAt: submissions.createdAt,
          formId: forms.id,
          formTitle: forms.title,
          formType: forms.type,
          // Non-null once promoted. The partial unique index below makes
          // this at most one row per submission, so the join cannot fan out.
          entryId: entries.id,
          entryStatus: entries.status,
        })
        .from(submissions)
        .innerJoin(forms, eq(forms.id, submissions.formId))
        .innerJoin(events, eq(events.id, forms.eventId))
        .leftJoin(
          entries,
          and(
            eq(entries.contestId, contest.id),
            eq(entries.submissionId, submissions.id)
          )
        )
        .where(
          and(
            eq(forms.eventId, event.id),
            eq(submissions.status, 'approved'),
            managedEvents(ctx)
          )
        )
        .orderBy(desc(submissions.createdAt), asc(submissions.id))
    }),

  // ─── Mutations ────────────────────────────────────────────────────────────

  // Promote an approved application onto the ballot. The display name and
  // photo default to what the applicant gave; the organizer can override
  // either, and write a bio the application did not ask for.
  promote: organizerProcedure
    .input(
      z.object({
        categoryId: z.string(),
        submissionId: z.string(),
        // Omitted = take it from the application.
        displayName: z.string().trim().min(1).max(200).optional(),
        bio: z.string().trim().max(2000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { category, event } = await requireOwnedCategory(
        ctx,
        input.categoryId
      )
      const ownership = ownedContest(ctx, category.contestId)

      // The application has to be an approved one, on a form belonging to
      // THIS contest's event, and the caller's. All four conditions are in
      // the one WHERE.
      const [found] = await ctx.db
        .select({
          id: submissions.id,
          status: submissions.status,
          applicantName: submissions.applicantName,
          answersJson: submissions.answersJson,
          formId: forms.id,
        })
        .from(submissions)
        .innerJoin(forms, eq(forms.id, submissions.formId))
        .innerJoin(events, eq(events.id, forms.eventId))
        .where(
          and(
            eq(submissions.id, input.submissionId),
            eq(forms.eventId, event.id),
            managedEvents(ctx)
          )
        )
        .limit(1)
      if (!found) throw new TRPCError({ code: 'NOT_FOUND' })
      if (found.status !== 'approved') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'Only an approved application can go on the ballot. Approve it first.',
        })
      }

      const photoUrl = await photoFromSubmission(
        ctx.db,
        found.formId,
        found.answersJson
      )
      const id = newId('entry')

      const review = await ctx.db.transaction(async (tx) => {
        const locked = await lockContestForEdit(tx, ownership)
        assertContentEditable(locked)

        try {
          await insertEntry(tx, locked, {
            id,
            categoryId: input.categoryId,
            submissionId: found.id,
            displayName: input.displayName ?? found.applicantName,
            photoUrl,
            bio: input.bio ?? '',
          })
        } catch (err) {
          // `entries_submission_unique` — one applicant, one entry per
          // contest. The index is the thing that decides it, not a lookup
          // before the insert: two clicks arriving together would both pass
          // a lookup and the second would still fail here. Turned into a
          // sentence rather than a 500.
          if (isUniqueViolation(err, ENTRY_SUBMISSION_INDEX)) {
            throw new TRPCError({
              code: 'CONFLICT',
              message:
                'This applicant is already on the ballot for this contest. Move their existing entry if it is in the wrong category.',
            })
          }
          throw err
        }

        return recordContentChange(tx, locked)
      })

      return { id, ...review }
    }),

  // An entry with no application behind it: a contestant invited directly, a
  // nominee the organizer accepted off-platform. `submissionId` stays NULL,
  // which is why the unique index above is partial.
  add: organizerProcedure
    .input(z.object({ categoryId: z.string(), ...entryShape }))
    .mutation(async ({ ctx, input }) => {
      const { category } = await requireOwnedCategory(ctx, input.categoryId)
      const ownership = ownedContest(ctx, category.contestId)
      const id = newId('entry')

      const review = await ctx.db.transaction(async (tx) => {
        const locked = await lockContestForEdit(tx, ownership)
        assertContentEditable(locked)
        await insertEntry(tx, locked, {
          id,
          categoryId: input.categoryId,
          submissionId: null,
          displayName: input.displayName,
          photoUrl: input.photoUrl,
          bio: input.bio,
        })
        return recordContentChange(tx, locked)
      })

      return { id, ...review }
    }),

  // Reviewed content: this is the name, face and words on the ballot.
  update: organizerProcedure
    .input(z.object({ id: z.string(), ...entryShape }))
    .mutation(async ({ ctx, input }) => {
      const { entry } = await requireOwnedEntry(ctx, input.id)
      const ownership = ownedContest(ctx, entry.contestId)

      const review = await ctx.db.transaction(async (tx) => {
        const locked = await lockContestForEdit(tx, ownership)

        const [current] = await tx
          .select({
            displayName: entries.displayName,
            photoUrl: entries.photoUrl,
            bio: entries.bio,
          })
          .from(entries)
          .where(
            and(eq(entries.id, input.id), eq(entries.contestId, locked.id))
          )
          .limit(1)
        if (!current) throw new TRPCError({ code: 'NOT_FOUND' })

        const changed =
          input.displayName !== current.displayName ||
          input.photoUrl !== current.photoUrl ||
          input.bio !== current.bio
        if (changed) assertContentEditable(locked)

        await tx
          .update(entries)
          .set({
            displayName: input.displayName,
            photoUrl: input.photoUrl,
            bio: input.bio,
            updatedAt: new Date(),
          })
          .where(and(eq(entries.id, input.id), callerOwnsEntry(ctx)))

        return changed
          ? recordContentChange(tx, locked)
          : unchangedReview(locked)
      })

      return { id: input.id, ...review }
    }),

  // Moderation, not content. Withdrawing or disqualifying takes the entry off
  // the ballot and leaves every vote it already has standing; `castVotes`
  // refuses new ones in the same statement that counts them, so a stale page
  // cannot slip one through. A live contest keeps running.
  setStatus: organizerProcedure
    .input(z.object({ id: z.string(), status: entryStatusEnum }))
    .mutation(async ({ ctx, input }) => {
      const updated = await ctx.db
        .update(entries)
        .set({ status: input.status, updatedAt: new Date() })
        .where(and(eq(entries.id, input.id), callerOwnsEntry(ctx)))
        .returning({ id: entries.id, voteCount: entries.voteCount })
      const row = updated[0]
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' })
      return { id: row.id, status: input.status, voteCount: row.voteCount }
    }),

  // Ordering only; never interrupts a live contest.
  setOrder: organizerProcedure
    .input(
      z.object({ id: z.string(), sortOrder: z.number().int().min(0).max(9999) })
    )
    .mutation(async ({ ctx, input }) => {
      const updated = await ctx.db
        .update(entries)
        .set({ sortOrder: input.sortOrder, updatedAt: new Date() })
        .where(and(eq(entries.id, input.id), callerOwnsEntry(ctx)))
        .returning({ id: entries.id })
      if (updated.length === 0) throw new TRPCError({ code: 'NOT_FOUND' })
      return { id: input.id }
    }),

  // Only an entry nobody has voted for. Votes are the record of what people
  // chose and, when paid, of what they spent; deleting the entry would
  // cascade them away. Withdraw or disqualify instead — that is what those
  // statuses are for.
  //
  // Both guards live in the DELETE's own WHERE:
  //   - `voteCount = 0`: `castVotes` bumps this counter in the statement that
  //     admits the vote, holding this row's lock, so a cast in flight either
  //     commits first (and the DELETE matches nothing) or waits and finds
  //     the entry gone.
  //   - no ledger row: the audit trail the counter is derived from, in case
  //     the two ever disagree.
  delete: organizerProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { entry } = await requireOwnedEntry(ctx, input.id)

      const deleted = await ctx.db
        .delete(entries)
        .where(
          and(
            eq(entries.id, input.id),
            callerOwnsEntry(ctx),
            eq(entries.voteCount, 0),
            notExists(
              ctx.db
                .select({ ok: sql`1` })
                .from(votes)
                .where(eq(votes.entryId, entries.id))
            )
          )
        )
        .returning({ id: entries.id })

      if (deleted.length === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `“${entry.displayName}” already has votes, so the entry stays. Withdraw it, or disqualify it, to take it off the ballot — the votes already cast remain on the record either way.`,
        })
      }
      return { id: input.id }
    }),
})

export type OrgContestEntriesRouter = typeof orgContestEntriesRouter
