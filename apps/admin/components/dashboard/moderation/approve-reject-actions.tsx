'use client'

import { useRouter } from 'next/navigation'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { Button } from '@ticketur/ui/components/button'

import { useTRPC } from '@/lib/trpc'
import { useActionDialog } from '@/components/dashboard/action-dialog/store'

// A form and a contest are each approved at the revision the admin was shown
// (the server refuses any other), so their actions carry that revision.
type Props = {
  id: string
  name: string
  redirectTo?: string
} & (
  | { kind: 'vendor' | 'event' }
  | { kind: 'form'; revision: number }
  | { kind: 'contest'; revision: number }
)

export function ApproveRejectActions(props: Props) {
  const { kind, id, name, redirectTo = '/moderation' } = props
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const router = useRouter()

  function invalidate() {
    queryClient.invalidateQueries({
      queryKey: trpc.admin.moderation.pendingVendors.queryKey(),
    })
    queryClient.invalidateQueries({
      queryKey: trpc.admin.moderation.pendingEvents.queryKey(),
    })
    queryClient.invalidateQueries({
      queryKey: trpc.admin.moderation.stats.queryKey(),
    })
    if (kind === 'vendor') {
      queryClient.invalidateQueries({
        queryKey: trpc.admin.moderation.vendorById.queryKey({ id }),
      })
    } else if (kind === 'event') {
      queryClient.invalidateQueries({
        queryKey: trpc.admin.moderation.eventById.queryKey({ id }),
      })
      queryClient.invalidateQueries({
        queryKey: trpc.admin.events.list.queryKey(),
      })
      queryClient.invalidateQueries({
        queryKey: trpc.admin.events.stats.queryKey(),
      })
    } else if (kind === 'contest') {
      invalidateReviewed()
      queryClient.invalidateQueries({
        queryKey: trpc.admin.moderation.pendingContests.queryKey(),
      })
      // An approved contest joins the live list; a rejected one leaves it.
      queryClient.invalidateQueries({
        queryKey: trpc.admin.moderation.liveContests.queryKey(),
      })
      queryClient.invalidateQueries({
        queryKey: trpc.admin.moderation.queue.queryKey(),
      })
      queryClient.invalidateQueries({
        queryKey: trpc.admin.overview.stats.queryKey(),
      })
    } else {
      invalidateReviewed()
      queryClient.invalidateQueries({
        queryKey: trpc.admin.moderation.pendingForms.queryKey(),
      })
      // An approved form joins the live list; a rejected one leaves it.
      queryClient.invalidateQueries({
        queryKey: trpc.admin.moderation.liveForms.queryKey(),
      })
      queryClient.invalidateQueries({
        queryKey: trpc.admin.moderation.queue.queryKey(),
      })
      queryClient.invalidateQueries({
        queryKey: trpc.admin.overview.stats.queryKey(),
      })
    }
  }

  // After a failed form or contest decision it has changed, or been reviewed
  // by someone else: reload it, so the admin sees what it is now — and so the
  // revision the next attempt sends is the one on screen.
  function invalidateReviewed() {
    if (kind === 'contest') {
      queryClient.invalidateQueries({
        queryKey: trpc.admin.moderation.contestById.queryKey({ id }),
      })
      return
    }
    queryClient.invalidateQueries({
      queryKey: trpc.admin.moderation.formById.queryKey({ id }),
    })
  }

  const approveVendorMut = useMutation(
    trpc.admin.moderation.approveVendor.mutationOptions({
      onSuccess: () => {
        toast.success('Vendor approved', {
          description: 'They have been notified by email.',
        })
        invalidate()
        router.push(redirectTo)
      },
      onError: (e) =>
        toast.error('Could not approve', { description: e.message }),
    })
  )

  const rejectVendorMut = useMutation(
    trpc.admin.moderation.rejectVendor.mutationOptions({
      onSuccess: () => {
        toast.success('Vendor rejected', {
          description: 'They have been notified by email.',
        })
        invalidate()
        router.push(redirectTo)
      },
      onError: (e) =>
        toast.error('Could not reject', { description: e.message }),
    })
  )

  const approveEventMut = useMutation(
    trpc.admin.moderation.approveEvent.mutationOptions({
      onSuccess: () => {
        toast.success('Event approved', {
          description: 'The organizer has been notified by email.',
        })
        invalidate()
        router.push(redirectTo)
      },
      onError: (e) =>
        toast.error('Could not approve', { description: e.message }),
    })
  )

  const rejectEventMut = useMutation(
    trpc.admin.moderation.rejectEvent.mutationOptions({
      onSuccess: () => {
        toast.success('Event rejected', {
          description: 'The organizer has been notified by email.',
        })
        invalidate()
        router.push(redirectTo)
      },
      onError: (e) =>
        toast.error('Could not reject', { description: e.message }),
    })
  )

  const approveFormMut = useMutation(
    trpc.admin.moderation.approveForm.mutationOptions({
      onSuccess: () => {
        toast.success('Form approved', {
          description:
            'It can now take submissions, and the organizer has been notified by email.',
        })
        invalidate()
        router.push(redirectTo)
      },
      onError: (e) => {
        toast.error('Could not approve', { description: e.message })
        invalidateReviewed()
      },
    })
  )

  const rejectFormMut = useMutation(
    trpc.admin.moderation.rejectForm.mutationOptions({
      onSuccess: () => {
        toast.success('Form rejected', {
          description: 'The organizer has been emailed the reason.',
        })
        invalidate()
        router.push(redirectTo)
      },
      onError: (e) => {
        toast.error('Could not reject', { description: e.message })
        invalidateReviewed()
      },
    })
  )

  const approveContestMut = useMutation(
    trpc.admin.moderation.approveContest.mutationOptions({
      onSuccess: () => {
        toast.success('Contest approved', {
          description:
            'It can now take votes, and the organizer has been notified by email.',
        })
        invalidate()
        router.push(redirectTo)
      },
      onError: (e) => {
        toast.error('Could not approve', { description: e.message })
        invalidateReviewed()
      },
    })
  )

  const rejectContestMut = useMutation(
    trpc.admin.moderation.rejectContest.mutationOptions({
      onSuccess: () => {
        toast.success('Contest rejected', {
          description: 'The organizer has been emailed the reason.',
        })
        invalidate()
        router.push(redirectTo)
      },
      onError: (e) => {
        toast.error('Could not reject', { description: e.message })
        invalidateReviewed()
      },
    })
  )

  const busy =
    approveVendorMut.isPending ||
    rejectVendorMut.isPending ||
    approveEventMut.isPending ||
    rejectEventMut.isPending ||
    approveFormMut.isPending ||
    rejectFormMut.isPending ||
    approveContestMut.isPending ||
    rejectContestMut.isPending

  const dialog = useActionDialog()

  // A form and a contest both demand a written reason; a vendor and an event
  // do not.
  const reasonRequired = kind === 'form' || kind === 'contest'

  async function handleApprove() {
    const ok = await dialog.confirm({
      title: kind === 'vendor' ? `Approve ${name}?` : `Approve "${name}"?`,
      description:
        kind === 'vendor'
          ? 'They will be notified by email and become bookable for events.'
          : kind === 'event'
            ? 'It will go live and the organizer will be notified by email.'
            : kind === 'contest'
              ? 'Approve only if the whole ballot, and what a vote costs, are fine to put in front of the public. The contest can then take votes, and the organizer is emailed.'
              : 'Approve only if every question is fine to ask applicants. The form can then take submissions, and the organizer is emailed.',
      confirmLabel: 'Approve',
      tone: 'success',
    })
    if (!ok) return
    if (props.kind === 'form') {
      approveFormMut.mutate({ id, revision: props.revision })
    } else if (props.kind === 'contest') {
      approveContestMut.mutate({ id, revision: props.revision })
    } else if (props.kind === 'vendor') approveVendorMut.mutate({ id })
    else approveEventMut.mutate({ id })
  }

  async function handleReject() {
    const reason = await dialog.prompt({
      title: kind === 'vendor' ? `Reject ${name}?` : `Reject "${name}"?`,
      description:
        kind === 'vendor'
          ? 'They will be emailed the reason and can update + resubmit their profile.'
          : kind === 'event'
            ? 'The event moves back to drafts and the organizer gets emailed the reason.'
            : kind === 'contest'
              ? 'The contest stays offline and takes no votes. The organizer is emailed this reason so they can fix it and resubmit.'
              : 'The form stays offline. The organizer is emailed this reason so they can fix the form and resubmit it.',
      inputLabel: reasonRequired ? 'Reason' : 'Reason (optional)',
      placeholder:
        kind === 'form'
          ? 'Which questions need to change before this can be approved?'
          : kind === 'contest'
            ? 'What on the ballot, or in the pricing, needs to change before this can be approved?'
            : 'What needs to change before this can be approved?',
      confirmLabel: 'Reject',
      tone: 'danger',
      required: reasonRequired,
    })
    if (reason === null) return
    if (kind === 'vendor') rejectVendorMut.mutate({ id, reason })
    else if (kind === 'event') rejectEventMut.mutate({ id, reason })
    else if (kind === 'contest') {
      rejectContestMut.mutate({ id, reason: reason.trim() })
    } else rejectFormMut.mutate({ id, reason: reason.trim() })
  }

  return (
    <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-end">
      <Button
        type="button"
        size="lg"
        disabled={busy}
        onClick={handleApprove}
        className="bg-emerald-500 text-white hover:bg-emerald-600"
      >
        Approve
      </Button>
      <Button
        type="button"
        size="lg"
        variant="outline"
        disabled={busy}
        onClick={handleReject}
        className="border-rose-400 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
      >
        Reject
      </Button>
    </div>
  )
}
