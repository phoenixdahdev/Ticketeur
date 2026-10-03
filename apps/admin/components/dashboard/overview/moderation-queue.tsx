'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { formatDistanceToNow } from 'date-fns'
import { HugeiconsIcon } from '@hugeicons/react'
import { Delete02Icon, ViewIcon, Tick02Icon } from '@hugeicons/core-free-icons'

import type { RouterOutputs } from '@ticketur/api'

import { useTRPC } from '@/lib/trpc'
import { toDate } from '@/lib/date'
import { useActionDialog } from '@/components/dashboard/action-dialog/store'

type QueueItem = RouterOutputs['admin']['moderation']['queue'][number]

function relativeTime(iso: string) {
  const d = toDate(iso)
  if (!d) return ''
  return `Reported ${formatDistanceToNow(d, { addSuffix: false })} ago`
}

function getInitials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p.charAt(0).toUpperCase())
      .join('') || '?'
  )
}

export function ModerationQueue() {
  const trpc = useTRPC()
  const router = useRouter()
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery(
    trpc.admin.moderation.queue.queryOptions()
  )

  function invalidate() {
    queryClient.invalidateQueries({
      queryKey: trpc.admin.moderation.queue.queryKey(),
    })
    queryClient.invalidateQueries({
      queryKey: trpc.admin.moderation.stats.queryKey(),
    })
    queryClient.invalidateQueries({
      queryKey: trpc.admin.moderation.pendingVendors.queryKey(),
    })
    queryClient.invalidateQueries({
      queryKey: trpc.admin.moderation.pendingEvents.queryKey(),
    })
    queryClient.invalidateQueries({
      queryKey: trpc.admin.moderation.flaggedActivities.queryKey(),
    })
    queryClient.invalidateQueries({
      queryKey: trpc.admin.moderation.pendingForms.queryKey(),
    })
    queryClient.invalidateQueries({
      queryKey: trpc.admin.moderation.pendingContests.queryKey(),
    })
    queryClient.invalidateQueries({
      queryKey: trpc.admin.overview.stats.queryKey(),
    })
  }

  const approveVendorMut = useMutation(
    trpc.admin.moderation.approveVendor.mutationOptions({
      onSuccess: () => {
        toast.success('Vendor approved', {
          description: 'They have been notified by email.',
        })
        invalidate()
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
      },
      onError: (e) =>
        toast.error('Could not reject', { description: e.message }),
    })
  )

  const rejectFormMut = useMutation(
    trpc.admin.moderation.rejectForm.mutationOptions({
      onSuccess: () => {
        toast.success('Form rejected', {
          description: 'The organizer has been emailed the reason.',
        })
        invalidate()
      },
      onError: (e) =>
        toast.error('Could not reject', { description: e.message }),
    })
  )

  const rejectContestMut = useMutation(
    trpc.admin.moderation.rejectContest.mutationOptions({
      onSuccess: () => {
        toast.success('Contest rejected', {
          description: 'The organizer has been emailed the reason.',
        })
        invalidate()
      },
      onError: (e) =>
        toast.error('Could not reject', { description: e.message }),
    })
  )

  const dismissFlagMut = useMutation(
    trpc.admin.moderation.dismissFlag.mutationOptions({
      onSuccess: () => {
        toast.success('Report dismissed')
        invalidate()
      },
      onError: (e) =>
        toast.error('Could not dismiss', { description: e.message }),
    })
  )

  const busy =
    approveVendorMut.isPending ||
    rejectVendorMut.isPending ||
    approveEventMut.isPending ||
    rejectEventMut.isPending ||
    rejectFormMut.isPending ||
    rejectContestMut.isPending ||
    dismissFlagMut.isPending

  const dialog = useActionDialog()

  async function handleApprove(item: QueueItem) {
    if (busy) return
    // A form is approved from its review page, after reading its questions,
    // and a contest from its own after reading the whole ballot. Neither can
    // be approved here: the server demands the revision that was SHOWN, and
    // this row has not shown anything.
    if (
      item.kind === 'report' ||
      item.kind === 'form' ||
      item.kind === 'contest'
    ) {
      router.push(item.href)
      return
    }
    const ok = await dialog.confirm({
      title:
        item.kind === 'vendor'
          ? `Approve ${item.title}?`
          : `Approve "${item.title}"?`,
      description:
        item.kind === 'vendor'
          ? 'They will be notified by email and become bookable for events.'
          : 'It will go live and the organizer will be notified by email.',
      confirmLabel: 'Approve',
      tone: 'success',
    })
    if (!ok) return
    if (item.kind === 'vendor') approveVendorMut.mutate({ id: item.id })
    else approveEventMut.mutate({ id: item.id })
  }

  async function handleReject(item: QueueItem) {
    if (busy) return
    if (item.kind === 'report') {
      const ok = await dialog.confirm({
        title: 'Dismiss this report?',
        description: 'It will be marked resolved with no action taken.',
        confirmLabel: 'Dismiss',
      })
      if (!ok) return
      dismissFlagMut.mutate({ id: item.id })
      return
    }
    if (item.kind === 'form') {
      const reason = await dialog.prompt({
        title: `Reject "${item.title}"?`,
        description:
          'The form stays offline. The organizer is emailed this reason so they can fix the form and resubmit it.',
        inputLabel: 'Reason',
        placeholder:
          'Which questions need to change before this can be approved?',
        confirmLabel: 'Reject',
        tone: 'danger',
        required: true,
      })
      if (reason === null) return
      rejectFormMut.mutate({ id: item.id, reason: reason.trim() })
      return
    }
    if (item.kind === 'contest') {
      const reason = await dialog.prompt({
        title: `Reject "${item.title}"?`,
        description:
          'The contest stays offline and takes no votes. The organizer is emailed this reason so they can fix it and resubmit.',
        inputLabel: 'Reason',
        placeholder:
          'What on the ballot, or in the pricing, needs to change before this can be approved?',
        confirmLabel: 'Reject',
        tone: 'danger',
        required: true,
      })
      if (reason === null) return
      rejectContestMut.mutate({ id: item.id, reason: reason.trim() })
      return
    }
    const reason = await dialog.prompt({
      title:
        item.kind === 'vendor'
          ? `Reject ${item.title}?`
          : `Reject "${item.title}"?`,
      description:
        item.kind === 'vendor'
          ? 'They will be emailed the reason and can update + resubmit their profile.'
          : 'The event moves back to drafts and the organizer gets emailed the reason.',
      inputLabel: 'Reason (optional)',
      placeholder: 'What needs to change before this can be approved?',
      confirmLabel: 'Reject',
      tone: 'danger',
    })
    if (reason === null) return
    if (item.kind === 'vendor') rejectVendorMut.mutate({ id: item.id, reason })
    else rejectEventMut.mutate({ id: item.id, reason })
  }

  const items = data ?? []

  return (
    <section
      aria-label="Moderation queue"
      className="border-border/60 bg-background flex flex-col gap-4 rounded-2xl border p-5 shadow-sm shadow-black/[0.02] md:p-6"
    >
      <header className="flex items-center justify-between">
        <h2 className="font-heading text-foreground text-lg font-bold tracking-tight md:text-xl">
          Moderation Queue
        </h2>
        <Link
          href="/moderation"
          className="text-primary text-sm font-semibold hover:underline"
        >
          View All
        </Link>
      </header>

      {isLoading ? (
        <div className="flex flex-col gap-3 py-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-muted h-14 animate-pulse rounded-xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">
          Nothing pending — all caught up.
        </p>
      ) : (
        <ul className="flex flex-col">
          {items.map((item) => (
            <li
              key={`${item.kind}-${item.id}`}
              className="border-border/60 flex items-center gap-3 border-b py-3 first:pt-0 last:border-b-0 last:pb-0"
            >
              {item.imageUrl ? (
                <Image
                  src={item.imageUrl}
                  alt=""
                  width={56}
                  height={56}
                  className="size-12 shrink-0 rounded-full object-cover md:size-14"
                />
              ) : (
                <div className="bg-primary/10 text-primary flex size-12 shrink-0 items-center justify-center rounded-full text-xs font-semibold md:size-14">
                  {getInitials(item.title)}
                </div>
              )}
              <div className="flex min-w-0 flex-1 flex-col">
                <p className="text-foreground truncate text-sm font-semibold md:text-base">
                  {item.title}
                </p>
                <p className="text-muted-foreground truncate text-xs md:text-sm">
                  {item.reasonLabel}{' '}
                  <span className="text-primary font-medium">
                    {item.reasonValue}
                  </span>
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <span className="text-muted-foreground hidden text-xs whitespace-nowrap md:block">
                  {relativeTime(item.timestamp)}
                </span>
                <div className="flex items-center gap-1.5">
                  <ActionPill
                    tone="danger"
                    label={item.kind === 'report' ? 'Dismiss' : 'Reject'}
                    disabled={busy}
                    onClick={() => handleReject(item)}
                  >
                    <HugeiconsIcon
                      icon={Delete02Icon}
                      className="size-4"
                      strokeWidth={1.8}
                    />
                  </ActionPill>
                  <ActionPill
                    tone="muted"
                    label="View"
                    disabled={busy}
                    onClick={() => router.push(item.href)}
                  >
                    <HugeiconsIcon
                      icon={ViewIcon}
                      className="size-4"
                      strokeWidth={1.8}
                    />
                  </ActionPill>
                  <ActionPill
                    tone="success"
                    label={
                      item.kind === 'report'
                        ? 'Open'
                        : item.kind === 'form' || item.kind === 'contest'
                          ? 'Review to approve'
                          : 'Approve'
                    }
                    disabled={busy || item.kind === 'report'}
                    onClick={() => handleApprove(item)}
                  >
                    <HugeiconsIcon
                      icon={Tick02Icon}
                      className="size-4"
                      strokeWidth={2}
                    />
                  </ActionPill>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function ActionPill({
  tone,
  label,
  children,
  disabled,
  onClick,
}: {
  tone: 'danger' | 'muted' | 'success'
  label: string
  children: React.ReactNode
  disabled?: boolean
  onClick?: () => void
}) {
  const styles = {
    danger: 'bg-red-100 text-red-600 hover:bg-red-200',
    muted: 'bg-muted text-foreground hover:bg-muted/80',
    success: 'bg-emerald-100 text-emerald-600 hover:bg-emerald-200',
  }[tone]
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-7 w-9 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${styles}`}
    >
      {children}
    </button>
  )
}
