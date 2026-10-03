'use client'

import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Mail01Icon,
  SmartPhone01Icon,
  UserAdd01Icon,
} from '@hugeicons/core-free-icons'

import type { NominationStatus } from '@ticketur/db'
import { cn } from '@ticketur/ui/lib/utils'
import { Button } from '@ticketur/ui/components/button'
import { Input } from '@ticketur/ui/components/input'
import { Label } from '@ticketur/ui/components/label'
import {
  NativeSelect,
  NativeSelectOption,
} from '@ticketur/ui/components/native-select'
import { Textarea } from '@ticketur/ui/components/textarea'

import { useTRPC } from '@/lib/trpc'
import {
  formatDateTime,
  NOMINATION_STATUS_LABEL,
  NOMINATION_STATUS_MEANING,
  NOMINATION_STATUS_TONE,
  nominationWindowLabel,
  type ContestCategory,
  type ContestNomination,
} from '@/lib/org-contests'
import {
  LiveEditWarning,
  type ReviewReport,
} from '@/components/dashboard/contests/review-notice'

// The names the public put forward, and what the organizer does with them.
//
// Three acts, and only the last one touches anything a visitor can see:
//   accept / turn down — a decision on this screen. Nobody is emailed, and a
//     live contest keeps taking votes throughout.
//   add to the ballot  — an ENTRY, on the public page, with a name written by
//     a member of the public. Reviewed content: on a live contest it stops
//     the voting until an admin has read the new ballot, exactly as adding
//     any other entry does. The button says so before it is pressed.
//
// The boundary is the server's (packages/api/src/routers/org/contest-
// nominations.ts); this file is where it is put into words.

type Filter = 'all' | NominationStatus

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'pending', label: 'Waiting on you' },
  { key: 'approved', label: 'Accepted' },
  { key: 'rejected', label: 'Turned down' },
  { key: 'all', label: 'Everything' },
]

export function NominationsPanel({
  contestId,
  contest,
  categories,
  isLive,
  contentLocked,
  report,
  onChanged,
}: {
  contestId: string
  contest: {
    nominationsOpenAt: Date | null
    nominationsCloseAt: Date | null
  }
  categories: ContestCategory[]
  isLive: boolean
  contentLocked: boolean
  report: ReviewReport
  /** The contest's own read is stale: an entry may have appeared. */
  onChanged: () => void
}) {
  const trpc = useTRPC()
  const [filter, setFilter] = useState<Filter>('pending')

  const hasPhase =
    contest.nominationsOpenAt !== null || contest.nominationsCloseAt !== null

  const query = useQuery(
    trpc.org.contests.nominations.list.queryOptions({
      contestId,
      status: filter,
    })
  )

  function refresh() {
    void query.refetch()
  }

  // A contest with no nomination window set never takes one, so there is
  // nothing to list and the panel says how to turn the phase on rather than
  // showing an empty table.
  if (!hasPhase) {
    return (
      <section className="border-border/60 bg-background flex shrink-0 flex-col gap-2 rounded-2xl border p-5 md:p-6">
        <h2 className="font-heading text-foreground text-base font-bold tracking-tight md:text-lg">
          Nominations
        </h2>
        <p className="text-muted-foreground text-sm leading-6">
          This contest has no nomination phase, so nobody can put a name
          forward. Set a nomination window in the settings above to let the
          public nominate; you then accept the ones you want and add them to the
          ballot. Leave it off and you build the ballot yourself.
        </p>
      </section>
    )
  }

  const counts = query.data?.counts
  const rows = query.data?.nominations ?? []

  return (
    <section className="border-border/60 bg-background flex shrink-0 flex-col gap-5 rounded-2xl border p-5 md:p-6">
      <div className="flex flex-col gap-1">
        <h2 className="font-heading text-foreground text-base font-bold tracking-tight md:text-lg">
          Nominations
        </h2>
        <p className="text-muted-foreground text-sm">
          Names the public put forward. {nominationWindowLabel(contest)}. Accept
          the ones you want, then add them to the ballot — only that last step
          makes a name public.
        </p>
      </div>

      {isLive ? <LiveEditWarning what="a nominee to the ballot" /> : null}

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((option) => {
          const badge =
            option.key === 'all' ? counts?.total : counts?.[option.key]
          return (
            <button
              key={option.key}
              type="button"
              onClick={() => setFilter(option.key)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
                filter === option.key
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border/60 text-muted-foreground hover:text-foreground'
              )}
            >
              {option.label}
              {typeof badge === 'number' ? (
                <span
                  className={cn(
                    'rounded-full px-1.5 text-[11px] font-bold',
                    filter === option.key
                      ? 'bg-primary-foreground/20'
                      : 'bg-muted'
                  )}
                >
                  {badge}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>

      {query.isLoading ? (
        <p className="text-muted-foreground text-xs">Loading nominations…</p>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground text-xs leading-5">
          {filter === 'pending'
            ? 'Nothing waiting on you. New nominations land here as they come in.'
            : 'Nothing here yet.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((nomination) => (
            <NominationRow
              key={nomination.id}
              nomination={nomination}
              categories={categories}
              isLive={isLive}
              contentLocked={contentLocked}
              report={report}
              onChanged={() => {
                refresh()
                onChanged()
              }}
              onDecided={refresh}
            />
          ))}
        </ul>
      )}

      {query.data?.truncated ? (
        <p className="text-muted-foreground text-xs">
          Only the first {rows.length} are shown. Work through them and the rest
          appear.
        </p>
      ) : null}
    </section>
  )
}

function NominationRow({
  nomination,
  categories,
  isLive,
  contentLocked,
  report,
  onChanged,
  onDecided,
}: {
  nomination: ContestNomination
  categories: ContestCategory[]
  isLive: boolean
  contentLocked: boolean
  report: ReviewReport
  /** A ballot entry appeared: the whole contest read is stale. */
  onChanged: () => void
  /** Only the nomination's own status moved. */
  onDecided: () => void
}) {
  const trpc = useTRPC()
  const [promoting, setPromoting] = useState(false)
  const [displayName, setDisplayName] = useState(nomination.nomineeName)
  const [bio, setBio] = useState('')

  const setStatus = useMutation(
    trpc.org.contests.nominations.setStatus.mutationOptions({
      onSuccess: ({ status }) => {
        toast.success(
          status === 'approved'
            ? 'Accepted. Add them to the ballot when you are ready.'
            : status === 'rejected'
              ? 'Turned down. Nobody is told.'
              : 'Back on the waiting list.'
        )
        onDecided()
      },
      onError: (err) =>
        toast.error('Could not change that', { description: err.message }),
    })
  )

  const promote = useMutation(
    trpc.org.contests.nominations.promote.mutationOptions({
      onSuccess: (result) => {
        setPromoting(false)
        report(result, `“${displayName.trim()}” is on the ballot.`)
        onChanged()
      },
      onError: (err) =>
        toast.error('Could not add them to the ballot', {
          description: err.message,
        }),
    })
  )

  const busy = setStatus.isPending || promote.isPending
  const onBallot = nomination.entryId !== null
  const categoryTitle =
    nomination.categoryTitle ??
    categories.find((c) => c.id === nomination.categoryId)?.title ??
    'a category that has since gone'

  return (
    <li className="border-border/60 flex flex-col gap-3 rounded-xl border p-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-foreground truncate text-sm font-semibold">
              {nomination.nomineeName}
            </span>
            <span
              title={NOMINATION_STATUS_MEANING[nomination.status]}
              className={cn(
                'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
                NOMINATION_STATUS_TONE[nomination.status]
              )}
            >
              {NOMINATION_STATUS_LABEL[nomination.status]}
            </span>
            {onBallot ? (
              <span className="bg-primary/10 text-primary inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium">
                On the ballot
              </span>
            ) : null}
          </div>

          <span className="text-muted-foreground text-xs">
            {categoryTitle} · nominated by {nomination.nominatedByEmail} ·{' '}
            {formatDateTime(nomination.createdAt)}
          </span>

          {nomination.nomineeEmail || nomination.nomineePhone ? (
            <span className="text-muted-foreground flex flex-wrap items-center gap-3 text-xs">
              {nomination.nomineeEmail ? (
                <span className="inline-flex items-center gap-1">
                  <HugeiconsIcon
                    icon={Mail01Icon}
                    className="size-3.5"
                    strokeWidth={1.8}
                  />
                  {nomination.nomineeEmail}
                </span>
              ) : null}
              {nomination.nomineePhone ? (
                <span className="inline-flex items-center gap-1">
                  <HugeiconsIcon
                    icon={SmartPhone01Icon}
                    className="size-3.5"
                    strokeWidth={1.8}
                  />
                  {nomination.nomineePhone}
                </span>
              ) : null}
            </span>
          ) : null}
        </div>

        {!onBallot ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {nomination.status !== 'approved' ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1.5"
                disabled={busy}
                onClick={() =>
                  setStatus.mutate({ id: nomination.id, status: 'approved' })
                }
              >
                <HugeiconsIcon
                  icon={CheckmarkCircle02Icon}
                  className="size-4"
                  strokeWidth={1.8}
                />
                Accept
              </Button>
            ) : null}
            {nomination.status !== 'rejected' ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1.5"
                disabled={busy}
                onClick={() =>
                  setStatus.mutate({ id: nomination.id, status: 'rejected' })
                }
              >
                <HugeiconsIcon
                  icon={Cancel01Icon}
                  className="size-4"
                  strokeWidth={1.8}
                />
                Turn down
              </Button>
            ) : null}
            {nomination.status === 'approved' && !contentLocked ? (
              <Button
                type="button"
                size="sm"
                className="gap-1.5"
                disabled={busy}
                onClick={() => setPromoting((v) => !v)}
              >
                <HugeiconsIcon
                  icon={UserAdd01Icon}
                  className="size-4"
                  strokeWidth={1.8}
                />
                {promoting ? 'Close' : 'Add to the ballot'}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {nomination.reason ? (
        <p className="text-muted-foreground border-l-2 pl-3 text-xs leading-5 whitespace-pre-wrap">
          {nomination.reason}
        </p>
      ) : null}

      {promoting && !onBallot ? (
        <form
          noValidate
          className="border-primary/30 bg-primary/5 flex flex-col gap-3 rounded-xl border border-dashed p-3"
          onSubmit={(e) => {
            e.preventDefault()
            promote.mutate({
              id: nomination.id,
              displayName: displayName.trim(),
              bio: bio.trim(),
            })
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor={`nom-name-${nomination.id}`}
              className="text-xs font-semibold"
            >
              Name on the ballot
            </Label>
            <Input
              id={`nom-name-${nomination.id}`}
              value={displayName}
              maxLength={200}
              disabled={promote.isPending}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor={`nom-bio-${nomination.id}`}
              className="text-xs font-semibold"
            >
              Bio
            </Label>
            <Textarea
              id={`nom-bio-${nomination.id}`}
              rows={3}
              maxLength={2000}
              value={bio}
              disabled={promote.isPending}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Optional, and in your words."
            />
            <p className="text-muted-foreground text-xs leading-5">
              The nominator&apos;s reason was written for you, not for the
              public, so it is not copied across. Paste any of it you want to
              publish — it goes on the ballot under your name, and an admin
              reads it.
            </p>
          </div>

          {nomination.categoryId ? (
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-semibold">Category</Label>
              <NativeSelect
                className="h-9 text-xs"
                value={nomination.categoryId}
                disabled
                aria-label="Category this nomination was made in"
              >
                {categories.map((category) => (
                  <NativeSelectOption key={category.id} value={category.id}>
                    {category.title}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <p className="text-muted-foreground text-xs leading-5">
                They go on the ballot in the category they were nominated in.
                Move the entry afterwards if it belongs somewhere else.
              </p>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={promote.isPending}
              onClick={() => setPromoting(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={promote.isPending || displayName.trim() === ''}
            >
              {promote.isPending
                ? 'Adding…'
                : isLive
                  ? 'Add and send for review'
                  : 'Add to the ballot'}
            </Button>
          </div>
        </form>
      ) : null}
    </li>
  )
}
