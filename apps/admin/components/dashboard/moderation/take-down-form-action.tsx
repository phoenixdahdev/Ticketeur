'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { Button } from '@ticketur/ui/components/button'

import { useTRPC } from '@/lib/trpc'
import { useActionDialog } from '@/components/dashboard/action-dialog/store'

// Pulling a public form down. Separate from ApproveRejectActions because it
// applies to the opposite situation: that one decides a form waiting for
// review, this one undoes a decision already made, on a form that is live (or
// closed but still showing a public page).
//
// It is not reversible by the organizer: the form can only come back by them
// fixing it and an admin approving it here again.
export function TakeDownFormAction({
  id,
  name,
  // 'published' means applicants can apply right now; 'closed' means the page
  // is public but intake has stopped.
  live,
}: {
  id: string
  name: string
  live: boolean
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const dialog = useActionDialog()

  const takeDown = useMutation(
    trpc.admin.moderation.takeDownForm.mutationOptions({
      onSuccess: () => {
        toast.success('Form taken down', {
          description:
            'It takes no more applications, its page is offline, and the organizer has been emailed the reason.',
        })
        queryClient.invalidateQueries({
          queryKey: trpc.admin.moderation.formById.queryKey({ id }),
        })
        queryClient.invalidateQueries({
          queryKey: trpc.admin.moderation.pendingForms.queryKey(),
        })
        // It has just left the live list.
        queryClient.invalidateQueries({
          queryKey: trpc.admin.moderation.liveForms.queryKey(),
        })
        queryClient.invalidateQueries({
          queryKey: trpc.admin.moderation.queue.queryKey(),
        })
      },
      onError: (e) => {
        toast.error('Could not take this form down', { description: e.message })
        queryClient.invalidateQueries({
          queryKey: trpc.admin.moderation.formById.queryKey({ id }),
        })
      },
    })
  )

  async function handleTakeDown() {
    const reason = await dialog.prompt({
      title: `Take "${name}" down?`,
      description: live
        ? 'It stops accepting applications immediately and its public page goes offline. Applications already made are kept, and anyone who has paid is still credited. The organizer is emailed this reason and can only get the form back by fixing it and having an admin approve it again.'
        : 'Its public page goes offline. Applications already made are kept. The organizer is emailed this reason and cannot reopen the form — it can only come back through review.',
      inputLabel: 'Reason',
      placeholder: 'What is wrong with this form?',
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
          Take this form off the platform
        </h3>
        <p className="text-sm text-rose-900/80 dark:text-rose-200/80">
          {live
            ? 'Stops applications at once and hides the page. Use it when an approved form turns out to ask for something it should not, or is fraudulent.'
            : 'This form has stopped taking applications, but its page is still public. Taking it down hides it.'}
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
