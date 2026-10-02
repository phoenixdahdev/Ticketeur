'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowLeft01Icon,
  Copy01Icon,
  Delete02Icon,
  LinkSquare02Icon,
  PauseIcon,
  UserGroupIcon,
} from '@hugeicons/core-free-icons'

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

import { useTRPC } from '@/lib/trpc'
import {
  FORM_TYPE_LABEL,
  plural,
  publicFormPath,
  type FormDetail,
} from '@/lib/org-forms'
import { FieldsEditor } from '@/components/dashboard/forms/fields-editor'
import { FormPreview } from '@/components/dashboard/forms/form-preview'
import { PriceOptionsEditor } from '@/components/dashboard/forms/price-options-editor'
import {
  FormStatusBadge,
  ReviewStateNotice,
  useReReviewReporter,
  WentOfflineNotice,
} from '@/components/dashboard/forms/review-notice'
import { SettingsCard } from '@/components/dashboard/forms/settings-card'

export function FormBuilder({ id }: { id: string }) {
  const trpc = useTRPC()
  const router = useRouter()
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery(trpc.org.forms.byId.queryOptions({ id }))

  const { wentOffline, dismiss, report } = useReReviewReporter()
  const [view, setView] = useState<'build' | 'preview'>('build')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)

  function invalidate() {
    void queryClient.invalidateQueries({
      queryKey: trpc.org.forms.byId.queryKey({ id }),
    })
    void queryClient.invalidateQueries({
      queryKey: trpc.org.forms.list.queryKey(),
    })
  }

  const submit = useMutation(
    trpc.org.forms.submit.mutationOptions({
      onSuccess: () => {
        toast.success('Sent for review', {
          description:
            'An admin reads every question before the form goes live. You will see it here when they decide.',
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
    trpc.org.forms.withdraw.mutationOptions({
      onSuccess: () => {
        toast.success('Withdrawn from review', {
          description:
            'It is a draft again. Submit it when you are ready and it goes back into the queue.',
        })
        invalidate()
      },
      // The usual cause is an admin deciding first. Reload so the organizer
      // sees what the form actually is now, next to the message saying so.
      onError: (err) => {
        toast.error('Could not withdraw it', { description: err.message })
        invalidate()
      },
    })
  )

  const reopen = useMutation(
    trpc.org.forms.reopen.mutationOptions({
      onSuccess: () => {
        toast.success('Your form is live again')
        invalidate()
      },
      onError: (err) =>
        toast.error('Could not reopen', { description: err.message }),
    })
  )

  const close = useMutation(
    trpc.org.forms.close.mutationOptions({
      onSuccess: () => {
        setConfirmClose(false)
        toast.success('Applications closed', {
          description: 'Everything already submitted is kept.',
        })
        invalidate()
      },
      onError: (err) =>
        toast.error('Could not close the form', { description: err.message }),
    })
  )

  const remove = useMutation(
    trpc.org.forms.delete.mutationOptions({
      onSuccess: () => {
        toast.success('Form deleted')
        void queryClient.invalidateQueries({
          queryKey: trpc.org.forms.list.queryKey(),
        })
        router.push('/org/forms')
      },
      onError: (err) =>
        toast.error('Could not delete the form', { description: err.message }),
    })
  )

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-muted-foreground text-sm">Loading form…</p>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="border-border/60 bg-background flex flex-col items-center gap-4 rounded-2xl border p-10 text-center">
        <p className="text-muted-foreground text-sm">
          This form no longer exists, or it is not one of yours.
        </p>
        <Button asChild variant="outline">
          <Link href="/org/forms">Back to forms</Link>
        </Button>
      </div>
    )
  }

  const { form, event, fields, priceOptions, counts, availability, canReopen } =
    data
  const isLive = form.status === 'published'
  const canDelete = counts.total === 0 && form.claimed === 0
  const submitBlocked = fields.length === 0

  return (
    <div className="flex min-h-0 flex-1 [scrollbar-width:none] flex-col gap-6 overflow-y-auto md:gap-8 [&::-webkit-scrollbar]:hidden">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <Link
          href="/org/forms"
          className="text-foreground hover:text-primary inline-flex items-center gap-1.5 text-sm font-medium transition-colors"
        >
          <HugeiconsIcon
            icon={ArrowLeft01Icon}
            className="size-4"
            strokeWidth={2}
          />
          Back to forms
        </Link>

        <div className="flex flex-wrap items-center gap-3">
          <Link
            href={`/org/forms/${form.id}/submissions`}
            className="text-primary hover:text-primary/80 inline-flex items-center gap-1.5 text-sm font-semibold transition-colors"
          >
            <HugeiconsIcon
              icon={UserGroupIcon}
              className="size-4"
              strokeWidth={2}
            />
            Applications
            {counts.submitted > 0 ? (
              <span className="bg-primary text-primary-foreground inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold">
                {counts.submitted}
              </span>
            ) : null}
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
      </div>

      <header className="flex shrink-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-heading text-foreground text-2xl font-bold tracking-tight md:text-[28px]">
            {form.title}
          </h1>
          <FormStatusBadge status={form.status} />
        </div>
        <p className="text-muted-foreground text-sm md:text-base">
          {FORM_TYPE_LABEL[form.type]} form on{' '}
          <Link
            href={`/org/events/${event.id}`}
            className="text-foreground font-medium hover:underline"
          >
            {event.title}
          </Link>
          {' · '}
          {plural(counts.total, 'application')}
          {counts.submitted > 0 ? `, ${counts.submitted} awaiting you` : ''}
        </p>
      </header>

      {wentOffline ? <WentOfflineNotice onDismiss={dismiss} /> : null}

      <ReviewStateNotice
        data={data}
        submitBlocked={submitBlocked}
        submitting={submit.isPending}
        reopening={reopen.isPending}
        withdrawing={withdraw.isPending}
        onSubmit={() => submit.mutate({ id: form.id })}
        onReopen={() => reopen.mutate({ id: form.id })}
        onWithdraw={() => withdraw.mutate({ id: form.id })}
      />

      {isLive ? (
        <PublicLink slug={form.slug} availability={availability} />
      ) : null}

      <div className="flex shrink-0 items-center justify-between gap-3 xl:hidden">
        <div
          role="tablist"
          aria-label="Builder view"
          className="bg-muted/60 inline-flex items-center rounded-full p-0.5 text-sm font-medium"
        >
          {(['build', 'preview'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={view === value}
              onClick={() => setView(value)}
              className={cn(
                'rounded-full px-4 py-1.5 capitalize transition-colors',
                view === value
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {value}
            </button>
          ))}
        </div>
      </div>

      <div className="grid min-h-0 shrink-0 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(360px,420px)] xl:items-start">
        <div
          className={cn(
            'flex flex-col gap-6',
            view === 'preview' ? 'hidden xl:flex' : ''
          )}
        >
          <SettingsCard form={form} report={report} onChanged={invalidate} />
          <FieldsEditor
            formId={form.id}
            fields={fields}
            isLive={isLive}
            hasSubmissions={counts.total > 0}
            report={report}
            onChanged={invalidate}
          />
          <PriceOptionsEditor
            formId={form.id}
            options={priceOptions}
            isLive={isLive}
            report={report}
            onChanged={invalidate}
          />
          {isLive ? (
            <div className="border-border/60 bg-background flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-5 md:p-6">
              <div className="flex flex-col gap-1">
                <h2 className="font-heading text-foreground text-base font-bold tracking-tight">
                  Stop taking applications
                </h2>
                <p className="text-muted-foreground text-sm">
                  Closing keeps every application and leaves the page public.
                  You can reopen later.
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
                Close form
              </Button>
            </div>
          ) : null}
        </div>

        <div
          className={cn(
            'xl:sticky xl:top-0',
            view === 'build' ? 'hidden xl:block' : ''
          )}
        >
          <FormPreview data={data} />
        </div>
      </div>

      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close “{form.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              It stops accepting applications straight away. Everything already
              submitted is kept and you can still approve or reject it. Its page
              stays public, so its name and description freeze until you send it
              for review again. Reopening is one click while the questions are
              unchanged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={close.isPending}>
              Keep it open
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={close.isPending}
              onClick={() => close.mutate({ id: form.id })}
            >
              {close.isPending ? 'Closing…' : 'Close form'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{form.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. Only a form nobody has applied to can be
              deleted — once it has applications, close it instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => remove.mutate({ id: form.id })}
            >
              {remove.isPending ? 'Deleting…' : 'Delete form'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function PublicLink({
  slug,
  availability,
}: {
  slug: string
  availability: FormDetail['availability']
}) {
  const path = publicFormPath(slug)

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
        <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
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
          Anyone opening it right now is told it is not taking applications.
        </p>
      ) : null}
    </div>
  )
}
