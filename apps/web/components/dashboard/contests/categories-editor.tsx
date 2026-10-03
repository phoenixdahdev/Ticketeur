'use client'

import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Delete02Icon,
  PlusSignIcon,
} from '@hugeicons/core-free-icons'

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
import { Textarea } from '@ticketur/ui/components/textarea'

import { useTRPC } from '@/lib/trpc'
import {
  plural,
  type ContestCategory,
  type ContestEntry,
} from '@/lib/org-contests'
import {
  LiveEditWarning,
  type ReviewReport,
} from '@/components/dashboard/contests/review-notice'

// MAX_CATEGORIES_PER_CONTEST in packages/api/src/lib/contests.ts, copied
// rather than imported: that module reaches for the database, which has no
// business in a client bundle.
const MAX_CATEGORIES = 50

// `plural` in @/lib/org-forms pluralises with an 's'; "category" and "entry"
// do not, and "2 categorys" on an organizer's screen is not acceptable.
function countOf(n: number, one: string, many: string): string {
  return `${n.toLocaleString('en-NG')} ${n === 1 ? one : many}`
}

// The things people vote in. A contest needs at least one before it can be
// submitted, and the free daily vote is allowed once per category — so a
// contest with four categories gives every verified email four free votes a
// day, one in each.
//
// The wording is reviewed content; the order is not. A category anybody has
// voted in cannot be deleted at all: those votes are the record of what
// people chose.
export function CategoriesEditor({
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
  const trpc = useTRPC()
  const [adding, setAdding] = useState(false)
  const [deleting, setDeleting] = useState<ContestCategory | null>(null)

  const add = useMutation(
    trpc.org.contests.categories.add.mutationOptions({
      onSuccess: (result) => {
        setAdding(false)
        report(result, 'Category added.')
        onChanged()
      },
      onError: (err) =>
        toast.error('Could not add the category', { description: err.message }),
    })
  )

  const remove = useMutation(
    trpc.org.contests.categories.delete.mutationOptions({
      onSuccess: () => {
        setDeleting(null)
        toast.success('Category removed.')
        onChanged()
      },
      onError: (err) =>
        toast.error('Could not remove the category', {
          description: err.message,
        }),
    })
  )

  const setOrder = useMutation(
    trpc.org.contests.categories.setOrder.mutationOptions({
      onSuccess: () => onChanged(),
      onError: (err) =>
        toast.error('Could not reorder', { description: err.message }),
    })
  )

  function move(index: number, delta: number) {
    const a = categories[index]
    const b = categories[index + delta]
    if (!a || !b) return
    // Swap the two sort values. Two calls rather than one list rewrite: the
    // server's setOrder is a single row, and a failed second call leaves a
    // duplicate order, which is only a tie broken by id.
    setOrder.mutate({ id: a.id, sortOrder: b.sortOrder })
    setOrder.mutate({ id: b.id, sortOrder: a.sortOrder })
  }

  const votesIn = (categoryId: string) =>
    entries
      .filter((entry) => entry.categoryId === categoryId)
      .reduce((sum, entry) => sum + entry.voteCount, 0)

  return (
    <section className="border-border/60 bg-background flex shrink-0 flex-col gap-4 rounded-2xl border p-5 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-foreground text-base font-bold tracking-tight md:text-lg">
            Categories
          </h2>
          <p className="text-muted-foreground text-sm">
            {categories.length === 0
              ? 'None yet. A category is the thing people vote in — "Face of Lagos", "Best Newcomer" — and you need at least one.'
              : `${countOf(categories.length, 'category', 'categories')}. A verified email gets one free vote in each, each day.`}
          </p>
        </div>
        {!adding && !contentLocked && categories.length < MAX_CATEGORIES ? (
          <Button
            type="button"
            variant="outline"
            className="gap-1.5"
            onClick={() => setAdding(true)}
          >
            <HugeiconsIcon
              icon={PlusSignIcon}
              className="size-4"
              strokeWidth={2}
            />
            Add category
          </Button>
        ) : null}
      </div>

      {isLive && (categories.length > 0 || adding) ? (
        <LiveEditWarning what="a category's name or description" />
      ) : null}

      {categories.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {categories.map((category, index) => (
            <CategoryRow
              key={category.id}
              category={category}
              entryCount={
                entries.filter((e) => e.categoryId === category.id).length
              }
              voteCount={votesIn(category.id)}
              isLive={isLive}
              contentLocked={contentLocked}
              canMoveUp={index > 0}
              canMoveDown={index < categories.length - 1}
              onMove={(delta) => move(index, delta)}
              report={report}
              onChanged={onChanged}
              onDelete={() => setDeleting(category)}
            />
          ))}
        </ul>
      ) : null}

      {adding ? (
        <NewCategoryRow
          pending={add.isPending}
          isLive={isLive}
          onCancel={() => setAdding(false)}
          onSubmit={(values) => add.mutate({ contestId, ...values })}
        />
      ) : null}

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove “{deleting?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Every entry in it goes too. A category anybody has already voted
              in cannot be removed at all — withdraw or disqualify the entries
              you want off the ballot instead, which keeps the votes already
              cast on the record.
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
              {remove.isPending ? 'Removing…' : 'Remove category'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

type CategoryDraft = { title: string; description: string }

function validateCategory(
  draft: CategoryDraft
): { ok: true; input: CategoryDraft } | { ok: false; error: string } {
  const title = draft.title.trim()
  if (title.length === 0)
    return { ok: false, error: 'Give the category a name' }
  if (title.length > 200) {
    return { ok: false, error: 'Keep the name under 200 characters' }
  }
  const description = draft.description.trim()
  if (description.length > 2000) {
    return { ok: false, error: 'Keep the description under 2,000 characters' }
  }
  return { ok: true, input: { title, description } }
}

function CategoryRow({
  category,
  entryCount,
  voteCount,
  isLive,
  contentLocked,
  canMoveUp,
  canMoveDown,
  onMove,
  report,
  onChanged,
  onDelete,
}: {
  category: ContestCategory
  entryCount: number
  voteCount: number
  isLive: boolean
  contentLocked: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  onMove: (delta: number) => void
  report: ReviewReport
  onChanged: () => void
  onDelete: () => void
}) {
  const trpc = useTRPC()
  const [draft, setDraft] = useState<CategoryDraft>(() => ({
    title: category.title,
    description: category.description,
  }))
  const [error, setError] = useState<string | null>(null)

  // Follow the server once a save lands. Keyed on the stored values rather
  // than the row object, which is new on every refetch.
  useEffect(() => {
    setDraft({ title: category.title, description: category.description })
  }, [category.title, category.description])

  const update = useMutation(
    trpc.org.contests.categories.update.mutationOptions({
      onSuccess: (result) => {
        report(result, `“${draft.title.trim()}” saved.`)
        onChanged()
      },
      onError: (err) =>
        toast.error('Could not save the category', {
          description: err.message,
        }),
    })
  )

  const dirty =
    draft.title !== category.title || draft.description !== category.description

  function save() {
    const result = validateCategory(draft)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError(null)
    update.mutate({ id: category.id, ...result.input })
  }

  return (
    <li className="border-border/60 flex flex-col gap-3 rounded-xl border p-4">
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor={`cat-title-${category.id}`}
              className="text-xs font-semibold"
            >
              Name
            </Label>
            <Input
              id={`cat-title-${category.id}`}
              value={draft.title}
              maxLength={200}
              disabled={update.isPending || contentLocked}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="Face of Lagos"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor={`cat-desc-${category.id}`}
              className="text-xs font-semibold"
            >
              Description
            </Label>
            <Textarea
              id={`cat-desc-${category.id}`}
              rows={2}
              maxLength={2000}
              value={draft.description}
              disabled={update.isPending || contentLocked}
              onChange={(e) =>
                setDraft({ ...draft, description: e.target.value })
              }
              placeholder="Optional — what this category is for."
            />
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-1">
          <OrderButton
            label={`Move ${category.title} up`}
            icon={ArrowUp01Icon}
            disabled={!canMoveUp}
            onClick={() => onMove(-1)}
          />
          <OrderButton
            label={`Move ${category.title} down`}
            icon={ArrowDown01Icon}
            disabled={!canMoveDown}
            onClick={() => onMove(1)}
          />
          <button
            type="button"
            aria-label={`Remove ${category.title}`}
            title={
              voteCount > 0
                ? 'People have voted in this category, so it stays'
                : `Remove ${category.title}`
            }
            onClick={onDelete}
            disabled={update.isPending || voteCount > 0}
            className="text-destructive hover:bg-destructive/10 focus-visible:ring-primary/40 inline-flex size-8 items-center justify-center rounded-md transition-colors outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <HugeiconsIcon
              icon={Delete02Icon}
              className="size-4"
              strokeWidth={1.8}
            />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-xs">
          {countOf(entryCount, 'entry', 'entries')} ·{' '}
          {plural(voteCount, 'vote')} cast
        </p>
        {dirty ? (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={update.isPending}
              onClick={() => {
                setDraft({
                  title: category.title,
                  description: category.description,
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
    </li>
  )
}

function NewCategoryRow({
  pending,
  isLive,
  onCancel,
  onSubmit,
}: {
  pending: boolean
  isLive: boolean
  onCancel: () => void
  onSubmit: (values: CategoryDraft) => void
}) {
  const [draft, setDraft] = useState<CategoryDraft>({
    title: '',
    description: '',
  })
  const [error, setError] = useState<string | null>(null)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const result = validateCategory(draft)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError(null)
    onSubmit(result.input)
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      className="border-primary/30 bg-primary/5 flex flex-col gap-3 rounded-xl border border-dashed p-4"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="cat-new-title" className="text-xs font-semibold">
          Name
        </Label>
        <Input
          id="cat-new-title"
          value={draft.title}
          maxLength={200}
          disabled={pending}
          autoFocus
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          placeholder="e.g. Face of Lagos"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="cat-new-desc" className="text-xs font-semibold">
          Description
        </Label>
        <Textarea
          id="cat-new-desc"
          rows={2}
          maxLength={2000}
          value={draft.description}
          disabled={pending}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          placeholder="Optional."
        />
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          {pending
            ? 'Adding…'
            : isLive
              ? 'Add and send for review'
              : 'Add category'}
        </Button>
      </div>

      {error ? (
        <p className="text-destructive text-xs font-medium">{error}</p>
      ) : null}
    </form>
  )
}

function OrderButton({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: string
  icon: Parameters<typeof HugeiconsIcon>[0]['icon']
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-primary/40 inline-flex size-8 items-center justify-center rounded-md transition-colors outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-30"
    >
      <HugeiconsIcon icon={icon} className="size-4" strokeWidth={1.8} />
    </button>
  )
}
