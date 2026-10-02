'use client'

import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Alert02Icon,
  Delete02Icon,
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
import { Input } from '@ticketur/ui/components/input'
import { Label } from '@ticketur/ui/components/label'

import { useTRPC } from '@/lib/trpc'
import {
  formatOptionPrice,
  koboToNaira,
  nairaToKobo,
  plural,
  type FormPriceOption,
} from '@/lib/org-forms'
import type { ReviewReport } from '@/components/dashboard/forms/fields-editor'
import { LiveEditWarning } from '@/components/dashboard/forms/review-notice'

// MAX_PRICE_OPTIONS_PER_FORM in packages/api/src/lib/forms.ts, copied rather
// than imported: that module reaches for node:crypto and the database, which
// has no business in a client bundle.
const MAX_OPTIONS = 20

// Priced choices an applicant picks exactly one of — vendor booth types, a
// pageant entry fee. A form with no options here is free.
//
// Rows are edited in place rather than through a dialog: a vendor form often
// carries half a dozen booth types, and opening a modal per booth is a chore.
//
// The review boundary runs through the middle of a row. A name or a price is
// part of what an applicant agrees to, so an admin reviews it and changing it
// on a live form takes the form offline. A quantity limit is capacity, which
// is operational — so each row says which of the two it is about to do.
export function PriceOptionsEditor({
  formId,
  options,
  isLive,
  report,
  onChanged,
}: {
  formId: string
  options: FormPriceOption[]
  isLive: boolean
  report: ReviewReport
  onChanged: () => void
}) {
  const trpc = useTRPC()
  const [adding, setAdding] = useState(false)
  const [deleting, setDeleting] = useState<FormPriceOption | null>(null)

  const add = useMutation(
    trpc.org.forms.priceOptions.add.mutationOptions({
      onSuccess: (result) => {
        report(result, 'Option added.')
        onChanged()
      },
      onError: (err) =>
        toast.error('Could not add the option', { description: err.message }),
    })
  )

  const remove = useMutation(
    trpc.org.forms.priceOptions.delete.mutationOptions({
      onSuccess: (result) => {
        setDeleting(null)
        report(result, 'Option removed.')
        onChanged()
      },
      onError: (err) =>
        toast.error('Could not remove the option', {
          description: err.message,
        }),
    })
  )

  const total = options.reduce((sum, option) => sum + option.claimed, 0)

  return (
    <section className="border-border/60 bg-background flex shrink-0 flex-col gap-4 rounded-2xl border p-5 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-foreground text-base font-bold tracking-tight md:text-lg">
            Paid options
          </h2>
          <p className="text-muted-foreground text-sm">
            {options.length === 0
              ? 'None yet — this form is free to apply to. Add an option to charge a fee or offer booth types.'
              : `Applicants pick exactly one of these ${plural(options.length, 'option')}.`}
          </p>
        </div>
        {!adding && options.length < MAX_OPTIONS ? (
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
            Add option
          </Button>
        ) : null}
      </div>

      {isLive && (options.length > 0 || adding) ? (
        <LiveEditWarning what="an option's name or price" />
      ) : null}

      {options.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {options.map((option) => (
            <OptionRow
              key={option.id}
              option={option}
              isLive={isLive}
              report={report}
              onChanged={onChanged}
              onDelete={() => setDeleting(option)}
            />
          ))}
        </ul>
      ) : null}

      {adding ? (
        <NewOptionRow
          pending={add.isPending}
          isLive={isLive}
          onCancel={() => setAdding(false)}
          onSubmit={(values) => add.mutate({ formId, ...values })}
        />
      ) : null}

      {options.length > 0 ? (
        <p className="text-muted-foreground text-xs">
          {plural(total, 'application')} currently hold one of these options. An
          option any application has chosen cannot be deleted.
        </p>
      ) : null}

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove “{deleting?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {isLive
                ? 'Your form is live. Removing an option takes it offline and sends it back to the admin review queue, so it stops accepting applications until that version is approved. '
                : ''}
              An option an applicant has already chosen stays — it is part of
              their record, and possibly of their payment.
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
              {remove.isPending ? 'Removing…' : 'Remove option'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

type OptionDraft = { name: string; price: string; limit: string }

type OptionInput = {
  name: string
  priceMinor: number
  quantityLimit: number | null
}

function validateOption(
  draft: OptionDraft
): { ok: true; input: OptionInput } | { ok: false; error: string } {
  const name = draft.name.trim()
  if (name.length === 0) return { ok: false, error: 'Give the option a name' }
  if (name.length > 120) {
    return { ok: false, error: 'Keep the name under 120 characters' }
  }

  const priceMinor = nairaToKobo(draft.price === '' ? '0' : draft.price)
  if (priceMinor === null) {
    return { ok: false, error: 'Enter a price of ₦0 or more' }
  }
  if (priceMinor > 2_147_483_647) {
    return { ok: false, error: 'That price is too large' }
  }

  let quantityLimit: number | null = null
  const rawLimit = draft.limit.trim()
  if (rawLimit !== '') {
    const parsed = Number(rawLimit)
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1_000_000) {
      return {
        ok: false,
        error: 'Enter a whole number of spots, or leave it empty',
      }
    }
    quantityLimit = parsed
  }

  return { ok: true, input: { name, priceMinor, quantityLimit } }
}

function OptionRow({
  option,
  isLive,
  report,
  onChanged,
  onDelete,
}: {
  option: FormPriceOption
  isLive: boolean
  report: ReviewReport
  onChanged: () => void
  onDelete: () => void
}) {
  const trpc = useTRPC()
  const [draft, setDraft] = useState<OptionDraft>(() => draftOf(option))
  const [error, setError] = useState<string | null>(null)

  // Follow the server once a save lands, so the row isn't left "dirty". Keyed
  // on the stored values rather than the row object, which is new on every
  // refetch: otherwise a background refetch would throw away an edit in
  // progress.
  useEffect(() => {
    setDraft(draftOf(option))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [option.id, option.name, option.priceMinor, option.quantityLimit])

  const update = useMutation(
    trpc.org.forms.priceOptions.update.mutationOptions({
      onSuccess: (result) => {
        report(result, `“${draft.name.trim()}” saved.`)
        onChanged()
      },
      onError: (err) =>
        toast.error('Could not save the option', { description: err.message }),
    })
  )

  const dirty =
    draft.name !== option.name ||
    draft.price !== koboToNaira(option.priceMinor) ||
    draft.limit !== limitOf(option)

  // Only the name and the price are reviewed content; a quantity limit is
  // capacity, which never interrupts a live form.
  const termsChanged =
    draft.name.trim() !== option.name ||
    nairaToKobo(draft.price === '' ? '0' : draft.price) !== option.priceMinor
  const willGoOffline = isLive && termsChanged

  function save() {
    const result = validateOption(draft)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError(null)
    update.mutate({ id: option.id, ...result.input })
  }

  return (
    <li className="border-border/60 flex flex-col gap-3 rounded-xl border p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
        <OptionField label="Name" htmlFor={`opt-name-${option.id}`}>
          <Input
            id={`opt-name-${option.id}`}
            value={draft.name}
            maxLength={120}
            disabled={update.isPending}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="Food stall"
          />
        </OptionField>
        <OptionField
          label="Price (₦)"
          htmlFor={`opt-price-${option.id}`}
          className="sm:w-36"
        >
          <Input
            id={`opt-price-${option.id}`}
            type="number"
            inputMode="decimal"
            min={0}
            step={100}
            value={draft.price}
            disabled={update.isPending}
            onChange={(e) => setDraft({ ...draft, price: e.target.value })}
            placeholder="0"
          />
        </OptionField>
        <OptionField
          label="Spots"
          htmlFor={`opt-limit-${option.id}`}
          className="sm:w-32"
        >
          <Input
            id={`opt-limit-${option.id}`}
            type="number"
            inputMode="numeric"
            min={Math.max(1, option.claimed)}
            step={1}
            value={draft.limit}
            disabled={update.isPending}
            onChange={(e) => setDraft({ ...draft, limit: e.target.value })}
            placeholder="No limit"
          />
        </OptionField>
        <button
          type="button"
          aria-label={`Remove ${option.name}`}
          title={`Remove ${option.name}`}
          onClick={onDelete}
          disabled={update.isPending || option.claimed > 0}
          className="text-destructive hover:bg-destructive/10 focus-visible:ring-primary/40 inline-flex size-13 shrink-0 items-center justify-center rounded-md transition-colors outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-30"
        >
          <HugeiconsIcon
            icon={Delete02Icon}
            className="size-4"
            strokeWidth={1.8}
          />
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-xs">
          {formatOptionPrice(option.priceMinor)} ·{' '}
          {option.quantityLimit === null
            ? `${option.claimed.toLocaleString('en-NG')} taken, no limit`
            : `${option.claimed.toLocaleString('en-NG')} of ${option.quantityLimit.toLocaleString('en-NG')} taken`}
        </p>
        {dirty ? (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={update.isPending}
              onClick={() => {
                setDraft(draftOf(option))
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
                : willGoOffline
                  ? 'Save and send for review'
                  : 'Save'}
            </Button>
          </div>
        ) : null}
      </div>

      {dirty && isLive ? (
        <p
          className={cn(
            'flex items-start gap-2 text-xs leading-5',
            willGoOffline
              ? 'text-amber-700 dark:text-amber-300'
              : 'text-muted-foreground'
          )}
        >
          <HugeiconsIcon
            icon={Alert02Icon}
            className="mt-px size-3.5 shrink-0"
            strokeWidth={1.9}
          />
          {willGoOffline
            ? 'Saving this changes the name or price an applicant agrees to, so your form goes offline and back into the admin review queue.'
            : 'Only the number of spots has changed — that is capacity, so saving leaves your form live.'}
        </p>
      ) : null}

      {error ? (
        <p className="text-destructive text-xs font-medium">{error}</p>
      ) : null}
    </li>
  )
}

function NewOptionRow({
  pending,
  isLive,
  onCancel,
  onSubmit,
}: {
  pending: boolean
  isLive: boolean
  onCancel: () => void
  onSubmit: (values: OptionInput) => void
}) {
  const [draft, setDraft] = useState<OptionDraft>({
    name: '',
    price: '',
    limit: '',
  })
  const [error, setError] = useState<string | null>(null)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const result = validateOption(draft)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError(null)
    onSubmit(result.input)
    // Kept open and cleared, so a vendor form's booth types go in one by one.
    setDraft({ name: '', price: '', limit: '' })
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      className="border-primary/30 bg-primary/5 flex flex-col gap-3 rounded-xl border border-dashed p-4"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <OptionField label="Name" htmlFor="opt-new-name">
          <Input
            id="opt-new-name"
            value={draft.name}
            maxLength={120}
            disabled={pending}
            autoFocus
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="e.g. Food stall"
          />
        </OptionField>
        <OptionField
          label="Price (₦)"
          htmlFor="opt-new-price"
          className="sm:w-36"
        >
          <Input
            id="opt-new-price"
            type="number"
            inputMode="decimal"
            min={0}
            step={100}
            value={draft.price}
            disabled={pending}
            onChange={(e) => setDraft({ ...draft, price: e.target.value })}
            placeholder="0"
          />
        </OptionField>
        <OptionField label="Spots" htmlFor="opt-new-limit" className="sm:w-32">
          <Input
            id="opt-new-limit"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={draft.limit}
            disabled={pending}
            onChange={(e) => setDraft({ ...draft, limit: e.target.value })}
            placeholder="No limit"
          />
        </OptionField>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-xs">
          Leave the price at ₦0 for a free choice on an otherwise paid form.
        </p>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={onCancel}
          >
            Done
          </Button>
          <Button type="submit" size="sm" disabled={pending}>
            {pending
              ? 'Adding…'
              : isLive
                ? 'Add and send for review'
                : 'Add option'}
          </Button>
        </div>
      </div>

      {error ? (
        <p className="text-destructive text-xs font-medium">{error}</p>
      ) : null}
    </form>
  )
}

function OptionField({
  label,
  htmlFor,
  className,
  children,
}: {
  label: string
  htmlFor: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={htmlFor} className="text-xs font-semibold">
        {label}
      </Label>
      {children}
    </div>
  )
}

function draftOf(option: FormPriceOption): OptionDraft {
  return {
    name: option.name,
    price: koboToNaira(option.priceMinor),
    limit: limitOf(option),
  }
}

function limitOf(option: FormPriceOption): string {
  return option.quantityLimit === null ? '' : String(option.quantityLimit)
}
