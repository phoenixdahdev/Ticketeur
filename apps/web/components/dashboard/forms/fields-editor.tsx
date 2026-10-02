'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Delete02Icon,
  Edit02Icon,
  PlusSignIcon,
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
import {
  effectiveRules,
  MAX_FIELDS_PER_FORM,
} from '@ticketur/api/lib/form-fields'

import { useTRPC } from '@/lib/trpc'
import {
  FIELD_TYPE_LABEL,
  fileTypeLabels,
  plural,
  type FormField,
  type ReviewEffect,
} from '@/lib/org-forms'
import {
  FieldDialog,
  type FieldDefinitionInput,
} from '@/components/dashboard/forms/field-dialog'
import { LiveEditWarning } from '@/components/dashboard/forms/review-notice'

export type ReviewReport = (effect: ReviewEffect, done: string) => void

// The questions, in the order applicants answer them.
//
// Adding, editing and deleting a question all change what an admin approved,
// so each is announced through `report` and warned about first when the form
// is live. Reordering is different — the same questions in another order ask
// nothing new — so it saves in one `reorder` call and leaves the review
// alone. The list says so, because the difference is not obvious.
export function FieldsEditor({
  formId,
  fields,
  isLive,
  hasSubmissions,
  report,
  onChanged,
}: {
  formId: string
  fields: FormField[]
  isLive: boolean
  hasSubmissions: boolean
  report: ReviewReport
  onChanged: () => void
}) {
  const trpc = useTRPC()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<FormField | null>(null)
  const [deleting, setDeleting] = useState<FormField | null>(null)

  // The order being arranged, which is only sent when the organizer saves it.
  const [order, setOrder] = useState<string[]>(() => fields.map((f) => f.id))
  const [announcement, setAnnouncement] = useState('')

  const serverOrder = useMemo(() => fields.map((f) => f.id), [fields])

  // Follow the server whenever the set of questions changes (one was added or
  // removed, or another tab saved an order), so the list can't drift.
  useEffect(() => {
    setOrder((current) => {
      const sameSet =
        current.length === serverOrder.length &&
        current.every((id) => serverOrder.includes(id))
      return sameSet ? current : serverOrder
    })
  }, [serverOrder])

  const byId = useMemo(
    () => new Map(fields.map((field) => [field.id, field])),
    [fields]
  )
  const ordered = order
    .map((id) => byId.get(id))
    .filter((field): field is FormField => field !== undefined)

  const orderChanged =
    order.length === serverOrder.length &&
    order.some((id, index) => id !== serverOrder[index])

  const add = useMutation(
    trpc.org.forms.fields.add.mutationOptions({
      onSuccess: (result) => {
        setDialogOpen(false)
        report(result, 'Question added.')
        onChanged()
      },
      onError: (err) =>
        toast.error('Could not add the question', { description: err.message }),
    })
  )

  const update = useMutation(
    trpc.org.forms.fields.update.mutationOptions({
      onSuccess: (result) => {
        setDialogOpen(false)
        report(result, 'Question saved.')
        onChanged()
      },
      onError: (err) =>
        toast.error('Could not save the question', {
          description: err.message,
        }),
    })
  )

  const remove = useMutation(
    trpc.org.forms.fields.delete.mutationOptions({
      onSuccess: (result) => {
        setDeleting(null)
        report(result, 'Question deleted.')
        onChanged()
      },
      onError: (err) =>
        toast.error('Could not delete the question', {
          description: err.message,
        }),
    })
  )

  const reorder = useMutation(
    trpc.org.forms.fields.reorder.mutationOptions({
      onSuccess: () => {
        toast.success('New order saved', {
          description:
            'Reordering asks nothing new, so your form stays exactly as it is.',
        })
        onChanged()
      },
      onError: (err) => {
        setOrder(serverOrder)
        toast.error('Could not save the new order', {
          description: err.message,
        })
      },
    })
  )

  const busy = add.isPending || update.isPending

  function move(index: number, delta: -1 | 1) {
    const to = index + delta
    if (to < 0 || to >= order.length) return
    const next = [...order]
    const [moved] = next.splice(index, 1)
    next.splice(to, 0, moved!)
    setOrder(next)
    const label = byId.get(moved!)?.label ?? 'Question'
    setAnnouncement(
      `${label} moved to position ${to + 1} of ${next.length}. Save the order to keep it.`
    )
  }

  return (
    <section className="border-border/60 bg-background flex shrink-0 flex-col gap-4 rounded-2xl border p-5 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-foreground text-base font-bold tracking-tight md:text-lg">
            Questions
          </h2>
          <p className="text-muted-foreground text-sm">
            {fields.length === 0
              ? 'A form needs at least one question before it can be submitted for review.'
              : `${plural(fields.length, 'question')}, in the order applicants answer them.`}
          </p>
        </div>
        <Button
          type="button"
          onClick={() => {
            setEditing(null)
            setDialogOpen(true)
          }}
          disabled={fields.length >= MAX_FIELDS_PER_FORM}
          className="gap-1.5"
        >
          <HugeiconsIcon
            icon={PlusSignIcon}
            className="size-4"
            strokeWidth={2}
          />
          Add question
        </Button>
      </div>

      {isLive ? <LiveEditWarning what="a question" /> : null}

      {ordered.length === 0 ? (
        <p className="border-border/60 text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm">
          No questions yet. Add the first one to get started.
        </p>
      ) : (
        <ol className="flex flex-col gap-2">
          {ordered.map((field, index) => (
            <li
              key={field.id}
              className="border-border/60 flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-center sm:gap-4"
            >
              <span className="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
                {index + 1}
              </span>

              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <p className="text-foreground text-sm font-semibold">
                  {field.label}
                  {field.required ? (
                    <span
                      className="text-rose-500"
                      title="Required"
                      aria-label="Required"
                    >
                      {' '}
                      *
                    </span>
                  ) : null}
                </p>
                <p className="text-muted-foreground text-xs">
                  {fieldSummary(field)}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <RowButton
                  label={`Move "${field.label}" up`}
                  icon={ArrowUp01Icon}
                  disabled={index === 0 || reorder.isPending}
                  onClick={() => move(index, -1)}
                />
                <RowButton
                  label={`Move "${field.label}" down`}
                  icon={ArrowDown01Icon}
                  disabled={index === ordered.length - 1 || reorder.isPending}
                  onClick={() => move(index, 1)}
                />
                <RowButton
                  label={`Edit "${field.label}"`}
                  icon={Edit02Icon}
                  tone="primary"
                  onClick={() => {
                    setEditing(field)
                    setDialogOpen(true)
                  }}
                />
                <RowButton
                  label={`Delete "${field.label}"`}
                  icon={Delete02Icon}
                  tone="danger"
                  onClick={() => setDeleting(field)}
                />
              </div>
            </li>
          ))}
        </ol>
      )}

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {orderChanged ? (
        <div className="border-primary/30 bg-primary/5 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3">
          <p className="text-foreground text-sm">
            <span className="font-semibold">Order not saved yet.</span>{' '}
            Reordering does not need another review — your form stays exactly as
            it is.
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={reorder.isPending}
              onClick={() => setOrder(serverOrder)}
            >
              Reset
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={reorder.isPending}
              onClick={() => reorder.mutate({ formId, fieldIds: order })}
            >
              {reorder.isPending ? 'Saving…' : 'Save order'}
            </Button>
          </div>
        </div>
      ) : null}

      <FieldDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        field={editing}
        isLive={isLive}
        pending={busy}
        hasSubmissions={hasSubmissions}
        onSave={(definition: FieldDefinitionInput) => {
          if (editing) update.mutate({ id: editing.id, ...definition })
          else add.mutate({ formId, ...definition })
        }}
      />

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleting?.label}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {isLive
                ? 'Your form is live. Deleting a question takes it offline and sends it back to the admin review queue, so it stops accepting applications until that version is approved. '
                : ''}
              A question anyone has already answered cannot be deleted — make it
              optional instead.
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
              {remove.isPending ? 'Deleting…' : 'Delete question'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

// A one-line answer to "what does this question accept?", built from the same
// effective rules the public form enforces.
export function fieldSummary(field: FormField): string {
  const rules = effectiveRules(field)
  const parts: string[] = [FIELD_TYPE_LABEL[field.type]]

  switch (field.type) {
    case 'short_text':
    case 'long_text':
      if (field.maxLength !== null) {
        parts.push(
          `up to ${field.maxLength.toLocaleString('en-NG')} characters`
        )
      }
      break
    case 'number': {
      if (field.minValue !== null && field.maxValue !== null) {
        parts.push(`${field.minValue} to ${field.maxValue}`)
      } else if (field.minValue !== null) {
        parts.push(`at least ${field.minValue}`)
      } else if (field.maxValue !== null) {
        parts.push(`at most ${field.maxValue}`)
      }
      break
    }
    case 'dropdown':
      parts.push(plural(field.optionsJson?.length ?? 0, 'choice'))
      break
    case 'images':
      parts.push(`up to ${rules.maxFiles ?? 5}`)
      parts.push(fileTypeLabels(rules.acceptedFileTypes ?? []))
      break
    case 'image':
      parts.push(fileTypeLabels(rules.acceptedFileTypes ?? []))
      break
    // 'file' is PDF and nothing else, which its type label already says.
    case 'file':
      break
    default:
      break
  }

  parts.push(field.required ? 'Required' : 'Optional')
  return parts.filter(Boolean).join(' · ')
}

function RowButton({
  label,
  icon,
  onClick,
  disabled,
  tone = 'default',
}: {
  label: string
  icon: Parameters<typeof HugeiconsIcon>[0]['icon']
  onClick: () => void
  disabled?: boolean
  tone?: 'default' | 'primary' | 'danger'
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'focus-visible:ring-primary/40 inline-flex size-9 items-center justify-center rounded-md transition-colors outline-none focus-visible:ring-2',
        'disabled:cursor-not-allowed disabled:opacity-30',
        tone === 'danger'
          ? 'text-destructive hover:bg-destructive/10'
          : tone === 'primary'
            ? 'text-primary hover:bg-primary/10'
            : 'text-foreground hover:bg-muted'
      )}
    >
      <HugeiconsIcon icon={icon} className="size-4" strokeWidth={1.8} />
    </button>
  )
}
