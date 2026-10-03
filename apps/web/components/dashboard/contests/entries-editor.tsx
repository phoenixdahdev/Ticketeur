'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  CancelCircleIcon,
  Delete02Icon,
  Image01Icon,
  PlusSignIcon,
  UserGroupIcon,
} from '@hugeicons/core-free-icons'

import { IMAGE_MIME_TYPES } from '@ticketur/api/lib/form-fields'
import { cn } from '@ticketur/ui/lib/utils'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@ticketur/ui/components/alert-dialog'
import { Button } from '@ticketur/ui/components/button'
import { Input } from '@ticketur/ui/components/input'
import { Label } from '@ticketur/ui/components/label'
import {
  NativeSelect,
  NativeSelectOption,
} from '@ticketur/ui/components/native-select'
import { Textarea } from '@ticketur/ui/components/textarea'
import type { EntryStatus } from '@ticketur/db'

import { useTRPC } from '@/lib/trpc'
import {
  ENTRY_STATUS_LABEL,
  ENTRY_STATUS_MEANING,
  ENTRY_STATUS_TONE,
  formatDateTime,
  plural,
  type ContestCategory,
  type ContestEntry,
} from '@/lib/org-contests'
import {
  acceptAttribute,
  uploadAnswerFile,
  uploadErrorMessage,
} from '@/components/sections/forms/form-upload'
import {
  LiveEditWarning,
  type ReviewReport,
} from '@/components/dashboard/contests/review-notice'

// The ballot. Two ways on to it: promote an approved registration from one of
// the event's forms, or type a contestant in by hand.
//
// The three things the public reads — the name, the photo, the bio — are
// reviewed content. Whether an entry is on the ballot RIGHT NOW is not:
// withdrawing or disqualifying is moderation, it leaves every vote already
// cast standing, and it never interrupts a live contest. That distinction is
// the whole reason an entry with votes cannot be deleted.

export function EntriesEditor({
  contestId,
  categories,
  entries,
  isLive,
  contentLocked,
  report,
  onChanged,
}: {
  contestId: string
  categories: ContestCategory[]
  entries: ContestEntry[]
  isLive: boolean
  contentLocked: boolean
  report: ReviewReport
  onChanged: () => void
}) {
  const [addingTo, setAddingTo] = useState<string | null>(null)
  const [promotingTo, setPromotingTo] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<ContestEntry | null>(null)

  const trpc = useTRPC()
  const remove = useMutation(
    trpc.org.contests.entries.delete.mutationOptions({
      onSuccess: () => {
        setDeleting(null)
        toast.success('Entry removed.')
        onChanged()
      },
      onError: (err) =>
        toast.error('Could not remove the entry', { description: err.message }),
    })
  )

  if (categories.length === 0) {
    return (
      <section className="border-border/60 bg-background flex shrink-0 flex-col gap-2 rounded-2xl border p-5 md:p-6">
        <h2 className="font-heading text-foreground text-base font-bold tracking-tight md:text-lg">
          The ballot
        </h2>
        <p className="text-muted-foreground text-sm">
          Add a category first. Every entry lives in one.
        </p>
      </section>
    )
  }

  return (
    <section className="border-border/60 bg-background flex shrink-0 flex-col gap-5 rounded-2xl border p-5 md:p-6">
      <div className="flex flex-col gap-1">
        <h2 className="font-heading text-foreground text-base font-bold tracking-tight md:text-lg">
          The ballot
        </h2>
        <p className="text-muted-foreground text-sm">
          Who people are voting for. Promote an approved application, or add
          someone by hand.
        </p>
      </div>

      {isLive && entries.length > 0 ? (
        <LiveEditWarning what="an entry's name, photo or bio, or adding one" />
      ) : null}

      {categories.map((category) => {
        const inCategory = entries.filter((e) => e.categoryId === category.id)
        return (
          <div key={category.id} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-dashed pb-2">
              <h3 className="text-foreground text-sm font-semibold">
                {category.title}
                <span className="text-muted-foreground ml-2 text-xs font-normal">
                  {inCategory.length === 1
                    ? '1 entry'
                    : `${inCategory.length} entries`}
                </span>
              </h3>
              {!contentLocked ? (
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => {
                      setPromotingTo(
                        promotingTo === category.id ? null : category.id
                      )
                      setAddingTo(null)
                    }}
                  >
                    <HugeiconsIcon
                      icon={UserGroupIcon}
                      className="size-4"
                      strokeWidth={1.8}
                    />
                    From applications
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => {
                      setAddingTo(addingTo === category.id ? null : category.id)
                      setPromotingTo(null)
                    }}
                  >
                    <HugeiconsIcon
                      icon={PlusSignIcon}
                      className="size-4"
                      strokeWidth={2}
                    />
                    By hand
                  </Button>
                </div>
              ) : null}
            </div>

            {promotingTo === category.id ? (
              <PromotePanel
                contestId={contestId}
                categoryId={category.id}
                isLive={isLive}
                report={report}
                onChanged={onChanged}
                onClose={() => setPromotingTo(null)}
              />
            ) : null}

            {addingTo === category.id ? (
              <NewEntryForm
                categoryId={category.id}
                isLive={isLive}
                report={report}
                onChanged={onChanged}
                onClose={() => setAddingTo(null)}
              />
            ) : null}

            {inCategory.length === 0 ? (
              <p className="text-muted-foreground text-xs">
                Nobody in this category yet.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {inCategory.map((entry) => (
                  <EntryRow
                    key={entry.id}
                    entry={entry}
                    isLive={isLive}
                    contentLocked={contentLocked}
                    report={report}
                    onChanged={onChanged}
                    onDelete={() => setDeleting(entry)}
                  />
                ))}
              </ul>
            )}
          </div>
        )
      })}

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove “{deleting?.displayName}”?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This is for an entry added by mistake. An entry anybody has voted
              for stays — withdraw or disqualify it instead, which takes it off
              the ballot and leaves every vote already cast on the record.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>
              Keep it
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => {
                if (deleting) remove.mutate({ id: deleting.id })
              }}
            >
              {remove.isPending ? 'Removing…' : 'Remove entry'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

// ─── Promoting an application ───────────────────────────────────────────────

function PromotePanel({
  contestId,
  categoryId,
  isLive,
  report,
  onChanged,
  onClose,
}: {
  contestId: string
  categoryId: string
  isLive: boolean
  report: ReviewReport
  onChanged: () => void
  onClose: () => void
}) {
  const trpc = useTRPC()
  const [q, setQ] = useState('')

  const query = useQuery(
    trpc.org.contests.entries.eligibleSubmissions.queryOptions({ contestId })
  )

  const promote = useMutation(
    trpc.org.contests.entries.promote.mutationOptions({
      onSuccess: (result) => {
        report(result, 'Added to the ballot.')
        void query.refetch()
        onChanged()
      },
      onError: (err) =>
        toast.error('Could not add them to the ballot', {
          description: err.message,
        }),
    })
  )

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const all = query.data ?? []
    if (needle === '') return all
    return all.filter(
      (row) =>
        row.applicantName.toLowerCase().includes(needle) ||
        row.applicantEmail.toLowerCase().includes(needle) ||
        row.reference.toLowerCase().includes(needle)
    )
  }, [q, query.data])

  return (
    <div className="border-primary/30 bg-primary/5 flex flex-col gap-3 rounded-xl border border-dashed p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-foreground text-sm font-semibold">
          Approved applications on this event
        </p>
        <Button type="button" size="sm" variant="outline" onClick={onClose}>
          Done
        </Button>
      </div>

      <Input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by name, email or reference"
        aria-label="Search approved applications"
        className="h-9"
      />

      {query.isLoading ? (
        <p className="text-muted-foreground text-xs">Loading applications…</p>
      ) : (query.data ?? []).length === 0 ? (
        <p className="text-muted-foreground text-xs leading-5">
          No approved applications on this event yet. Approve some on a{' '}
          <Link href="/org/forms" className="font-semibold underline">
            registration form
          </Link>
          , or add contestants by hand.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          Nothing matches “{q.trim()}”.
        </p>
      ) : (
        <ul className="divide-border/60 border-border/60 bg-background max-h-80 divide-y overflow-y-auto rounded-lg border">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center gap-3 px-3 py-2.5"
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-foreground truncate text-sm font-medium">
                  {row.applicantName}
                </span>
                <span className="text-muted-foreground truncate text-xs">
                  {row.applicantEmail} · {row.formTitle} · {row.reference} ·{' '}
                  {formatDateTime(row.createdAt)}
                </span>
              </div>
              {row.entryId ? (
                <span className="text-muted-foreground shrink-0 text-xs font-medium">
                  Already on the ballot
                </span>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  disabled={promote.isPending}
                  onClick={() =>
                    promote.mutate({ categoryId, submissionId: row.id })
                  }
                >
                  {isLive ? 'Add and send for review' : 'Add'}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="text-muted-foreground text-xs leading-5">
        Their name and their first photo come across from the application; you
        can change either afterwards. The same applicant cannot be added twice.
      </p>
    </div>
  )
}

// ─── One entry ──────────────────────────────────────────────────────────────

type EntryDraft = { displayName: string; photoUrl: string | null; bio: string }

function validateEntry(
  draft: EntryDraft
): { ok: true; input: EntryDraft } | { ok: false; error: string } {
  const displayName = draft.displayName.trim()
  if (displayName.length === 0) {
    return { ok: false, error: 'Give this entry a name' }
  }
  if (displayName.length > 200) {
    return { ok: false, error: 'Keep the name under 200 characters' }
  }
  const bio = draft.bio.trim()
  if (bio.length > 2000) {
    return { ok: false, error: 'Keep the bio under 2,000 characters' }
  }
  return { ok: true, input: { displayName, photoUrl: draft.photoUrl, bio } }
}

function EntryRow({
  entry,
  isLive,
  contentLocked,
  report,
  onChanged,
  onDelete,
}: {
  entry: ContestEntry
  isLive: boolean
  contentLocked: boolean
  report: ReviewReport
  onChanged: () => void
  onDelete: () => void
}) {
  const trpc = useTRPC()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<EntryDraft>(() => ({
    displayName: entry.displayName,
    photoUrl: entry.photoUrl,
    bio: entry.bio,
  }))
  const [error, setError] = useState<string | null>(null)

  const update = useMutation(
    trpc.org.contests.entries.update.mutationOptions({
      onSuccess: (result) => {
        report(result, `“${draft.displayName.trim()}” saved.`)
        onChanged()
      },
      onError: (err) =>
        toast.error('Could not save the entry', { description: err.message }),
    })
  )

  const setStatus = useMutation(
    trpc.org.contests.entries.setStatus.mutationOptions({
      onSuccess: ({ status }) => {
        toast.success(
          status === 'active'
            ? 'Back on the ballot.'
            : status === 'withdrawn'
              ? 'Withdrawn. Their votes are still on the record.'
              : 'Disqualified. Their votes are still on the record.'
        )
        onChanged()
      },
      onError: (err) =>
        toast.error('Could not change that', { description: err.message }),
    })
  )

  const dirty =
    draft.displayName !== entry.displayName ||
    draft.photoUrl !== entry.photoUrl ||
    draft.bio !== entry.bio

  function save() {
    const result = validateEntry(draft)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError(null)
    update.mutate({ id: entry.id, ...result.input })
  }

  return (
    <li className="border-border/60 flex flex-col gap-3 rounded-xl border p-3">
      <div className="flex items-center gap-3">
        <Thumbnail url={entry.photoUrl} name={entry.displayName} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-foreground truncate text-sm font-semibold">
              {entry.displayName}
            </span>
            <span
              title={ENTRY_STATUS_MEANING[entry.status]}
              className={cn(
                'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
                ENTRY_STATUS_TONE[entry.status]
              )}
            >
              {ENTRY_STATUS_LABEL[entry.status]}
            </span>
          </div>
          <span className="text-muted-foreground text-xs">
            {plural(entry.voteCount, 'vote')}
            {entry.submissionId ? ' · from an application' : ' · added by hand'}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <NativeSelect
            aria-label={`Ballot status for ${entry.displayName}`}
            className="h-8 w-40 text-xs"
            value={entry.status}
            disabled={setStatus.isPending}
            onChange={(e) =>
              setStatus.mutate({
                id: entry.id,
                status: e.target.value as EntryStatus,
              })
            }
          >
            {(['active', 'withdrawn', 'disqualified'] as const).map((s) => (
              <NativeSelectOption key={s} value={s}>
                {ENTRY_STATUS_LABEL[s]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-primary hover:text-primary/80 text-xs font-semibold transition-colors"
          >
            {open ? 'Close' : 'Edit'}
          </button>
        </div>
      </div>

      {open ? (
        <div className="flex flex-col gap-3 border-t border-dashed pt-3">
          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor={`entry-name-${entry.id}`}
              className="text-xs font-semibold"
            >
              Name on the ballot
            </Label>
            <Input
              id={`entry-name-${entry.id}`}
              value={draft.displayName}
              maxLength={200}
              disabled={update.isPending || contentLocked}
              onChange={(e) =>
                setDraft({ ...draft, displayName: e.target.value })
              }
            />
          </div>

          <PhotoField
            id={`entry-photo-${entry.id}`}
            url={draft.photoUrl}
            disabled={update.isPending || contentLocked}
            onChange={(url) => setDraft({ ...draft, photoUrl: url })}
          />

          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor={`entry-bio-${entry.id}`}
              className="text-xs font-semibold"
            >
              Bio
            </Label>
            <Textarea
              id={`entry-bio-${entry.id}`}
              rows={3}
              maxLength={2000}
              value={draft.bio}
              disabled={update.isPending || contentLocked}
              onChange={(e) => setDraft({ ...draft, bio: e.target.value })}
              placeholder="A line or two the public reads beside their photo."
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={onDelete}
              disabled={entry.voteCount > 0 || contentLocked}
              title={
                entry.voteCount > 0
                  ? 'People have voted for this entry, so it stays. Withdraw or disqualify it instead.'
                  : 'Remove this entry'
              }
              className="text-destructive hover:text-destructive/80 inline-flex items-center gap-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            >
              <HugeiconsIcon
                icon={Delete02Icon}
                className="size-3.5"
                strokeWidth={1.8}
              />
              Remove entry
            </button>

            {dirty ? (
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={update.isPending}
                  onClick={() => {
                    setDraft({
                      displayName: entry.displayName,
                      photoUrl: entry.photoUrl,
                      bio: entry.bio,
                    })
                    setError(null)
                  }}
                >
                  Reset
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={update.isPending}
                  onClick={save}
                >
                  {update.isPending
                    ? 'Saving…'
                    : isLive
                      ? 'Save and send for review'
                      : 'Save'}
                </Button>
              </div>
            ) : null}
          </div>

          {error ? (
            <p className="text-destructive text-xs font-medium">{error}</p>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

function NewEntryForm({
  categoryId,
  isLive,
  report,
  onChanged,
  onClose,
}: {
  categoryId: string
  isLive: boolean
  report: ReviewReport
  onChanged: () => void
  onClose: () => void
}) {
  const trpc = useTRPC()
  const [draft, setDraft] = useState<EntryDraft>({
    displayName: '',
    photoUrl: null,
    bio: '',
  })
  const [error, setError] = useState<string | null>(null)

  const add = useMutation(
    trpc.org.contests.entries.add.mutationOptions({
      onSuccess: (result) => {
        report(result, 'Added to the ballot.')
        setDraft({ displayName: '', photoUrl: null, bio: '' })
        onChanged()
      },
      onError: (err) =>
        toast.error('Could not add the entry', { description: err.message }),
    })
  )

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const result = validateEntry(draft)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError(null)
    add.mutate({ categoryId, ...result.input })
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      className="border-primary/30 bg-primary/5 flex flex-col gap-3 rounded-xl border border-dashed p-4"
    >
      <div className="flex flex-col gap-1.5">
        <Label
          htmlFor={`entry-new-name-${categoryId}`}
          className="text-xs font-semibold"
        >
          Name on the ballot
        </Label>
        <Input
          id={`entry-new-name-${categoryId}`}
          value={draft.displayName}
          maxLength={200}
          disabled={add.isPending}
          autoFocus
          onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
          placeholder="e.g. Ada Obi"
        />
      </div>

      <PhotoField
        id={`entry-new-photo-${categoryId}`}
        url={draft.photoUrl}
        disabled={add.isPending}
        onChange={(url) => setDraft({ ...draft, photoUrl: url })}
      />

      <div className="flex flex-col gap-1.5">
        <Label
          htmlFor={`entry-new-bio-${categoryId}`}
          className="text-xs font-semibold"
        >
          Bio
        </Label>
        <Textarea
          id={`entry-new-bio-${categoryId}`}
          rows={3}
          maxLength={2000}
          value={draft.bio}
          disabled={add.isPending}
          onChange={(e) => setDraft({ ...draft, bio: e.target.value })}
          placeholder="Optional."
        />
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={add.isPending}
          onClick={onClose}
        >
          Done
        </Button>
        <Button type="submit" size="sm" disabled={add.isPending}>
          {add.isPending
            ? 'Adding…'
            : isLive
              ? 'Add and send for review'
              : 'Add entry'}
        </Button>
      </div>

      {error ? (
        <p className="text-destructive text-xs font-medium">{error}</p>
      ) : null}
    </form>
  )
}

// ─── Photo ──────────────────────────────────────────────────────────────────

function Thumbnail({ url, name }: { url: string | null; name: string }) {
  if (!url) {
    return (
      <div className="bg-muted text-muted-foreground flex size-11 shrink-0 items-center justify-center rounded-lg">
        <HugeiconsIcon
          icon={Image01Icon}
          className="size-4"
          strokeWidth={1.8}
        />
      </div>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={name}
      className="bg-muted size-11 shrink-0 rounded-lg object-cover"
    />
  )
}

/**
 * An entry's photo. It goes to the same blob store a registration answer
 * does, through the same helper, so the stored URL passes the very check the
 * server runs on it (`uploadUrlError` in packages/api/src/lib/form-fields.ts)
 * — an organizer cannot point a public contest page at an arbitrary link.
 */
function PhotoField({
  id,
  url,
  disabled,
  onChange,
}: {
  id: string
  url: string | null
  disabled: boolean
  onChange: (url: string | null) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, startUpload] = useTransition()

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    startUpload(async () => {
      try {
        const uploaded = await uploadAnswerFile({
          file,
          accepted: IMAGE_MIME_TYPES,
        })
        onChange(uploaded)
      } catch (err) {
        toast.error('Could not upload that photo', {
          description: uploadErrorMessage(err),
        })
      } finally {
        if (fileRef.current) fileRef.current.value = ''
      }
    })
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs font-semibold">
        Photo
      </Label>
      <div className="flex items-center gap-3">
        <Thumbnail url={url} name="" />
        <input
          id={id}
          ref={fileRef}
          type="file"
          accept={acceptAttribute(IMAGE_MIME_TYPES)}
          className="sr-only"
          disabled={disabled || uploading}
          onChange={pick}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={disabled || uploading}
          onClick={() => fileRef.current?.click()}
        >
          <HugeiconsIcon
            icon={Image01Icon}
            className="size-4"
            strokeWidth={1.8}
          />
          {uploading ? 'Uploading…' : url ? 'Replace' : 'Upload a photo'}
        </Button>
        {url ? (
          <button
            type="button"
            disabled={disabled || uploading}
            onClick={() => onChange(null)}
            className="text-muted-foreground hover:text-destructive inline-flex items-center gap-1 text-xs font-semibold transition-colors"
          >
            <HugeiconsIcon
              icon={CancelCircleIcon}
              className="size-3.5"
              strokeWidth={1.8}
            />
            Remove
          </button>
        ) : null}
      </div>
    </div>
  )
}
