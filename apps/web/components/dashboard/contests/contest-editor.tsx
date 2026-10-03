'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowLeft01Icon,
  ChampionIcon,
  Copy01Icon,
  Delete02Icon,
  LinkSquare02Icon,
  PauseIcon,
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

import { useTRPC } from '@/lib/trpc'
import {
  formatPerVote,
  plural,
  publicContestPath,
  votingWindowLabel,
  type ContestDetail,
} from '@/lib/org-contests'
import { BundlesEditor } from '@/components/dashboard/contests/bundles-editor'
import { CategoriesEditor } from '@/components/dashboard/contests/categories-editor'
import { EntriesEditor } from '@/components/dashboard/contests/entries-editor'
import { NominationsPanel } from '@/components/dashboard/contests/nominations-panel'
import {
  ContestStatusBadge,
  ReviewStateNotice,
  useReReviewReporter,
  WentOfflineNotice,
} from '@/components/dashboard/contests/review-notice'
import { SettingsCard } from '@/components/dashboard/contests/settings-card'

// Everything an organizer does to one contest, in the order they do it:
// where it stands with the admin, the settings, the categories, the ballot,
// the prices.
export function ContestEditor({ id }: { id: string }) {
  const trpc = useTRPC()
  const router = useRouter()
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery(
    trpc.org.contests.byId.queryOptions({ id })
  )

  const { wentOffline, dismiss, report } = useReReviewReporter()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)

  function invalidate() {
    void queryClient.invalidateQueries({
      queryKey: trpc.org.contests.byId.queryKey({ id }),
    })
    void queryClient.invalidateQueries({
      queryKey: trpc.org.contests.list.queryKey(),
    })
  }

  const submit = useMutation(
    trpc.org.contests.submit.mutationOptions({
      onSuccess: () => {
        toast.success('Sent for review', {
          description:
            'An admin reads the ballot and the prices before a contest can take votes. You will see it here when they decide.',
          duration: 8000,
        })
        dismiss()
        invalidate()
      },
      onError: (err) =>
        toast.error('Could not submit for review', {
          description: err.message,
        }),
    })
  )

  const withdraw = useMutation(
    trpc.org.contests.withdraw.mutationOptions({
      onSuccess: () => {
        toast.success('Withdrawn from review', {
          description:
            'It is a draft again. Submit it when you are ready and it goes back into the queue.',
        })
        invalidate()
      },
      // The usual cause is an admin deciding first. Reload so the organizer
      // sees what the contest actually is now, beside the message saying so.
      onError: (err) => {
        toast.error('Could not withdraw it', { description: err.message })
        invalidate()
      },
    })
  )

  const close = useMutation(
    trpc.org.contests.close.mutationOptions({
      onSuccess: () => {
        setConfirmClose(false)
        toast.success('Voting closed', {
          description: 'Every vote is kept and the results stay public.',
        })
        invalidate()
      },
      onError: (err) =>
        toast.error('Could not close the contest', {
          description: err.message,
        }),
    })
  )

  const remove = useMutation(
    trpc.org.contests.delete.mutationOptions({
      onSuccess: () => {
        toast.success('Contest deleted')
        void queryClient.invalidateQueries({
          queryKey: trpc.org.contests.list.queryKey(),
        })
        router.push('/org/contests')
      },
      onError: (err) =>
        toast.error('Could not delete the contest', {
          description: err.message,
        }),
    })
  )

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-muted-foreground text-sm">Loading contest…</p>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="border-border/60 bg-background flex flex-col items-center gap-4 rounded-2xl border p-10 text-center">
        <p className="text-muted-foreground text-sm">
          This contest no longer exists, or it is not one of yours.
        </p>
        <Button asChild variant="outline">
          <Link href="/org/contests">Back to contests</Link>
        </Button>
      </div>
    )
  }

  const { contest, event, categories, entries, bundles, counts, availability } =
    data
  const isLive = contest.status === 'published'
  // A closed contest's results page is still public and shows the whole
  // ballot, so the API freezes everything on it. Say so, rather than letting
  // the organizer discover it in an error.
  const contentLocked = contest.status === 'closed'
  const canDelete = counts.voteCount === 0

  const blocked = submitBlockedReason(data)

  return (
    <div className="flex min-h-0 flex-1 [scrollbar-width:none] flex-col gap-6 overflow-y-auto md:gap-8 [&::-webkit-scrollbar]:hidden">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <Link
          href="/org/contests"
          className="text-foreground hover:text-primary inline-flex items-center gap-1.5 text-sm font-medium transition-colors"
        >
          <HugeiconsIcon
            icon={ArrowLeft01Icon}
            className="size-4"
            strokeWidth={2}
          />
          Back to contests
        </Link>

        {canDelete ? (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="text-destructive hover:text-destructive/80 inline-flex items-center gap-1.5 text-sm font-semibold transition-colors"
          >
            <HugeiconsIcon
              icon={Delete02Icon}
              className="size-4"
              strokeWidth={2}
            />
            Delete
          </button>
        ) : null}
      </div>

      <header className="flex shrink-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-heading text-foreground text-2xl font-bold tracking-tight md:text-[28px]">
            {contest.title}
          </h1>
          <ContestStatusBadge status={contest.status} />
        </div>
        <p className="text-muted-foreground text-sm md:text-base">
          Contest on{' '}
          <Link
            href={`/org/events/${event.id}`}
            className="text-foreground font-medium hover:underline"
          >
            {event.title}
          </Link>
          {' · '}
          {votingWindowLabel(contest)}
          {' · '}
          {formatPerVote(contest)}
        </p>
        <p className="text-muted-foreground text-xs">
          {counts.categoryCount === 1
            ? '1 category'
            : `${counts.categoryCount} categories`}
          {' · '}
          {counts.entryCount === 1 ? '1 entry' : `${counts.entryCount} entries`}
          {' · '}
          {plural(counts.voteCount, 'vote')} cast · times in {contest.timeZone}
        </p>
      </header>

      {wentOffline ? <WentOfflineNotice onDismiss={dismiss} /> : null}

      <ReviewStateNotice
        data={data}
        submitBlocked={blocked !== null}
        submitBlockedReason={blocked}
        submitting={submit.isPending}
        withdrawing={withdraw.isPending}
        onSubmit={() => submit.mutate({ id: contest.id })}
        onWithdraw={() => withdraw.mutate({ id: contest.id })}
      />

      {isLive || contest.status === 'closed' ? (
        <PublicLink slug={contest.slug} availability={availability} />
      ) : null}

      <div className="flex min-h-0 shrink-0 flex-col gap-6">
        <SettingsCard
          contest={contest}
          report={report}
          onChanged={invalidate}
        />
        <CategoriesEditor
          contestId={contest.id}
          categories={categories}
          entries={entries}
          isLive={isLive}
          contentLocked={contentLocked}
          report={report}
          onChanged={invalidate}
        />
        <NominationsPanel
          contestId={contest.id}
          contest={contest}
          categories={categories}
          isLive={isLive}
          contentLocked={contentLocked}
          report={report}
          onChanged={invalidate}
        />
        <EntriesEditor
          contestId={contest.id}
          categories={categories}
          entries={entries}
          isLive={isLive}
          contentLocked={contentLocked}
          report={report}
          onChanged={invalidate}
        />
        <BundlesEditor
          contestId={contest.id}
          bundles={bundles}
          serviceFeeBps={data.serviceFeeBps}
          paidVotingEnabled={contest.paidVotingEnabled}
          isLive={isLive}
          contentLocked={contentLocked}
          report={report}
          onChanged={invalidate}
        />

        {isLive ? (
          <div className="border-border/60 bg-background flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-5 md:p-6">
            <div className="flex flex-col gap-1">
              <h2 className="font-heading text-foreground text-base font-bold tracking-tight">
                End the voting
              </h2>
              <p className="text-muted-foreground text-sm">
                Closing keeps every vote and leaves the results page public.
                Restarting goes through the admin review queue.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="gap-1.5"
              disabled={close.isPending}
              onClick={() => setConfirmClose(true)}
            >
              <HugeiconsIcon
                icon={PauseIcon}
                className="size-4"
                strokeWidth={1.8}
              />
              Close voting
            </Button>
          </div>
        ) : null}
      </div>

      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Close voting on “{contest.title}”?
            </AlertDialogTitle>
            <AlertDialogDescription>
              No more votes can be cast, free or paid, from the moment you
              confirm. Every vote already cast is kept and the results page
              stays public — which is why its name, description, categories and
              entries freeze until you send it for review again. Anyone holding
              unspent credits cannot spend them while it is closed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={close.isPending}>
              Keep voting open
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={close.isPending}
              onClick={() => close.mutate({ id: contest.id })}
            >
              {close.isPending ? 'Closing…' : 'Close voting'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{contest.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone, and it takes every category, entry and
              bundle with it. Only a contest nobody has voted in and nobody has
              bought votes for can be deleted — once either has happened, close
              it instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => remove.mutate({ id: contest.id })}
            >
              {remove.isPending ? 'Deleting…' : 'Delete contest'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/**
 * Why submit would be refused, said before they press it. Mirrors
 * `assertReadyToSubmit` in packages/api/src/routers/org/contests.ts — the
 * server is still the authority, this just saves a round trip into an error.
 */
function submitBlockedReason(data: ContestDetail): string | null {
  const { contest, categories, bundles } = data
  if (categories.length === 0) {
    return 'Add at least one category first — a category is the thing people vote in.'
  }
  if (!contest.freeVotingEnabled && !contest.paidVotingEnabled) {
    return 'Turn on free voting, paid voting or both — nobody can vote otherwise.'
  }
  if (
    contest.paidVotingEnabled &&
    contest.pricePerVoteMinor === 0 &&
    !bundles.some((b) => b.active)
  ) {
    return 'Paid voting is on but there is nothing to buy. Set a price per vote, add a bundle, or turn paid voting off.'
  }
  if (
    contest.votingClosesAt &&
    new Date(contest.votingClosesAt) <= new Date()
  ) {
    return 'Voting is set to close in the past. Move that time later or clear it.'
  }
  return null
}

function PublicLink({
  slug,
  availability,
}: {
  slug: string
  availability: ContestDetail['availability']
}) {
  const path = publicContestPath(slug)

  async function copy() {
    const url =
      typeof window === 'undefined' ? path : `${window.location.origin}${path}`
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Link copied')
    } catch {
      toast.error('Could not copy the link', { description: url })
    }
  }

  return (
    <div className="border-border/60 bg-background flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase">
          <HugeiconsIcon
            icon={ChampionIcon}
            className="size-3.5"
            strokeWidth={1.8}
          />
          Share this link
        </p>
        <code className="text-foreground truncate text-sm">{path}</code>
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={copy}
          className="gap-1.5"
        >
          <HugeiconsIcon
            icon={Copy01Icon}
            className="size-4"
            strokeWidth={1.8}
          />
          Copy
        </Button>
        <Button size="sm" variant="outline" asChild className="gap-1.5">
          <a href={path} target="_blank" rel="noreferrer">
            <HugeiconsIcon
              icon={LinkSquare02Icon}
              className="size-4"
              strokeWidth={1.8}
            />
            Open
          </a>
        </Button>
      </div>
      {availability && !availability.open ? (
        <p className="text-muted-foreground w-full text-xs">
          Anyone opening it right now is told voting is not open.
        </p>
      ) : null}
      <p className="text-muted-foreground w-full text-xs">
        This link was fixed when you created the contest and never changes, so
        renaming is safe.
      </p>
    </div>
  )
}
