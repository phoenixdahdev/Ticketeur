'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { Button } from '@ticketur/ui/components/button'

import { useTRPC } from '@/lib/trpc'
import { useActionDialog } from '@/components/dashboard/action-dialog/store'

// Pulling a public contest down. Separate from ApproveRejectActions because
// it applies to the opposite situation: that one decides a contest waiting
// for review, this one undoes a decision already made, on a contest that is
// live (or closed but still showing its results page).
//
// It is not reversible by the organizer: the contest can only come back by
// them fixing it and an admin approving it here again.
export function TakeDownContestAction({
  id,
  name,
  // 'published' means votes can be cast right now; 'closed' means the
  // results page is public but voting has stopped.
  live,
  // Votes people have paid for and not yet cast. Named in the dialog,
  // because a takedown strands them and that is the thing the organizer and
  // the platform will be asked about.
  unspentCredits,
}: {
  id: string
  name: string
  live: boolean
  unspentCredits: number
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const dialog = useActionDialog()

  const takeDown = useMutation(
    trpc.admin.moderation.takeDownContest.mutationOptions({
      onSuccess: () => {
        toast.success('Contest taken down', {
          description:
            'Voting has stopped, its page is offline, and the organizer has been emailed the reason.',
        })
        queryClient.invalidateQueries({
          queryKey: trpc.admin.moderation.contestById.queryKey({ id }),
        })
        queryClient.invalidateQueries({
          queryKey: trpc.admin.moderation.pendingContests.queryKey(),
        })
        // It has just left the live list.
        queryClient.invalidateQueries({
          queryKey: trpc.admin.moderation.liveContests.queryKey(),
        })
        queryClient.invalidateQueries({
          queryKey: trpc.admin.moderation.queue.queryKey(),
        })
      },
      onError: (e) => {
        toast.error('Could not take this contest down', {
          description: e.message,
        })
        queryClient.invalidateQueries({
          queryKey: trpc.admin.moderation.contestById.queryKey({ id }),
        })
      },
    })
  )

  const creditWarning =
    unspentCredits > 0
      ? ` ${unspentCredits.toLocaleString('en-NG')} vote${unspentCredits === 1 ? '' : 's'} people have paid for will be left unusable.`
      : ''

  async function handleTakeDown() {
    const reason = await dialog.prompt({
      title: `Take "${name}" down?`,
      description:
        (live
          ? 'Voting stops immediately and its public page goes offline. Every vote already cast is kept, and so is every paid-for vote balance. The organizer is emailed this reason and can only get the contest back by fixing it and having an admin approve it again.'
          : 'Its public results page goes offline. Every vote already cast is kept. The organizer is emailed this reason and cannot put it back — it can only return through review.') +
        creditWarning,
      inputLabel: 'Reason',
      placeholder: 'What is wrong with this contest?',
      confirmLabel: 'Take it down',
      tone: 'danger',
      required: true,
    })
    if (reason === null) return
    takeDown.mutate({ id, reason: reason.trim() })
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-5 sm:flex-row sm:items-center sm:justify-between md:p-6 dark:border-rose-500/40 dark:bg-rose-500/10">
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold text-rose-900 dark:text-rose-200">
          Take this contest off the platform
        </h3>
        <p className="text-sm text-rose-900/80 dark:text-rose-200/80">
          {live
            ? 'Stops voting at once and hides the page. Use it when an approved contest turns out to put someone on the ballot who never agreed, or is fraudulent.'
            : 'Voting has ended, but the results page is still public. Taking it down hides it.'}
        </p>
      </div>
      <Button
        type="button"
        size="lg"
        disabled={takeDown.isPending}
        onClick={handleTakeDown}
        className="shrink-0 bg-rose-600 text-white hover:bg-rose-700"
      >
        {takeDown.isPending ? 'Taking down…' : 'Take down'}
      </Button>
    </div>
  )
}
