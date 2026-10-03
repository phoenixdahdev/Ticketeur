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
  formatKobo,
  koboToNaira,
  nairaToKobo,
  serviceFeeMinor,
  type VoteBundle,
} from '@/lib/org-contests'
import {
  LiveEditWarning,
  type ReviewReport,
} from '@/components/dashboard/contests/review-notice'

// MAX_BUNDLES_PER_CONTEST in packages/api/src/lib/contests.ts, copied rather
// than imported: that module reaches for the database.
const MAX_BUNDLES = 20
const INT4_MAX = 2_147_483_647

// Packs of votes on sale — "20 votes — ₦1,000". Buying one grants a BALANCE
// for the contest, which the voter then spends across the entries; a bundle
// never votes for anybody.
//
// The label, the pack size and the price are reviewed content, the same call
// a form's price options get: what the public pays is part of what they agree
// to. Retiring a bundle from sale is not — it can only take an offer away —
// and that is also why it is the way to withdraw a price once money has come
// in, rather than deleting it.
export function BundlesEditor({
  contestId,
  bundles,
  serviceFeeBps,
  paidVotingEnabled,
  isLive,
  contentLocked,
  report,
  onChanged,
}: {
  contestId: string
  bundles: VoteBundle[]
  serviceFeeBps: number
  paidVotingEnabled: boolean
  isLive: boolean
  contentLocked: boolean
  report: ReviewReport
  onChanged: () => void
}) {
  const trpc = useTRPC()
  const [adding, setAdding] = useState(false)
  const [deleting, setDeleting] = useState<VoteBundle | null>(null)

  const add = useMutation(
    trpc.org.contests.bundles.add.mutationOptions({
      onSuccess: (result) => {
        report(result, 'Bundle added.')
        onChanged()
      },
      onError: (err) =>
        toast.error('Could not add the bundle', { description: err.message }),
    })
  )

  const remove = useMutation(
    trpc.org.contests.bundles.delete.mutationOptions({
      onSuccess: () => {
        setDeleting(null)
        toast.success('Bundle removed.')
        onChanged()
      },
      onError: (err) =>
        toast.error('Could not remove the bundle', {
          description: err.message,
        }),
    })
  )

  const onSale = bundles.filter((b) => b.active)

  return (
    <section className="border-border/60 bg-background flex shrink-0 flex-col gap-4 rounded-2xl border p-5 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-foreground text-base font-bold tracking-tight md:text-lg">
            Vote bundles
          </h2>
          <p className="text-muted-foreground text-sm">
            {bundles.length === 0
              ? 'None yet. A bundle is a pack of votes at one price; buying it gives the voter a balance to spend across this contest.'
              : `${onSale.length} on sale${bundles.length > onSale.length ? `, ${bundles.length - onSale.length} retired` : ''}.`}
          </p>
        </div>
        {!adding && !contentLocked && bundles.length < MAX_BUNDLES ? (
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
            Add bundle
          </Button>
        ) : null}
      </div>

      {!paidVotingEnabled ? (
        <p className="border-border/60 bg-muted/40 text-muted-foreground rounded-xl border px-3 py-2.5 text-xs leading-5">
          Paid voting is switched off in Settings, so nothing here is on sale.
          Bundles you set up now go live the moment you turn it back on.
        </p>
      ) : null}

      {isLive && (bundles.length > 0 || adding) ? (
        <LiveEditWarning what="a bundle's name, size or price" />
      ) : null}

      {bundles.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {bundles.map((bundle) => (
            <BundleRow
              key={bundle.id}
              bundle={bundle}
              serviceFeeBps={serviceFeeBps}
              isLive={isLive}
              contentLocked={contentLocked}
              report={report}
              onChanged={onChanged}
              onDelete={() => setDeleting(bundle)}
            />
          ))}
        </ul>
      ) : null}

      {adding ? (
        <NewBundleRow
          pending={add.isPending}
          isLive={isLive}
          serviceFeeBps={serviceFeeBps}
          onCancel={() => setAdding(false)}
          onSubmit={(values) => add.mutate({ contestId, ...values })}
        />
      ) : null}

      <p className="text-muted-foreground text-xs leading-5">
        Prices are what you receive against. The platform fee is added on top at
        checkout and shown to the voter as its own line.
      </p>

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
              Once anybody has bought votes in this contest its bundles stay on
              the record and this is refused — retire the bundle instead, which
              takes it off sale immediately and keeps the history intact.
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
              {remove.isPending ? 'Deleting…' : 'Delete bundle'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

type BundleDraft = { label: string; votes: string; price: string }

type BundleInput = { label: string; votes: number; priceMinor: number }

function validateBundle(
  draft: BundleDraft
): { ok: true; input: BundleInput } | { ok: false; error: string } {
  const label = draft.label.trim()
  if (label.length === 0) return { ok: false, error: 'Give the bundle a name' }
  if (label.length > 120) {
    return { ok: false, error: 'Keep the name under 120 characters' }
  }

  const votes = Number(draft.votes.trim())
  if (!Number.isInteger(votes) || votes < 1 || votes > 100_000) {
    return { ok: false, error: 'Enter a whole number of votes, 1 to 100,000' }
  }

  const priceMinor = nairaToKobo(draft.price === '' ? '0' : draft.price)
  if (priceMinor === null)
    return { ok: false, error: 'Enter a price of ₦0 or more' }
  if (priceMinor > INT4_MAX)
    return { ok: false, error: 'That price is too large' }

  return { ok: true, input: { label, votes, priceMinor } }
}

function PriceFootnote({
  priceMinor,
  votes,
  serviceFeeBps,
}: {
  priceMinor: number
  votes: number
  serviceFeeBps: number
}) {
  if (priceMinor <= 0 || votes <= 0) return null
  const fee = serviceFeeMinor(priceMinor, serviceFeeBps)
  return (
    <p className="text-muted-foreground text-xs">
      The voter pays {formatKobo(priceMinor + fee)} — {formatKobo(priceMinor)}{' '}
      to you plus {formatKobo(fee)} platform fee. That is{' '}
      {formatKobo(Math.round(priceMinor / votes))} a vote.
    </p>
  )
}

function BundleRow({
  bundle,
  serviceFeeBps,
  isLive,
  contentLocked,
  report,
  onChanged,
  onDelete,
}: {
  bundle: VoteBundle
  serviceFeeBps: number
  isLive: boolean
  contentLocked: boolean
  report: ReviewReport
  onChanged: () => void
  onDelete: () => void
}) {
  const trpc = useTRPC()
  const [draft, setDraft] = useState<BundleDraft>(() => draftOf(bundle))
  const [error, setError] = useState<string | null>(null)

  // Follow the server once a save lands, keyed on the stored values rather
  // than the row object, which is new on every refetch.
  useEffect(() => {
    setDraft(draftOf(bundle))
  }, [bundle.label, bundle.votes, bundle.priceMinor])

  const update = useMutation(
    trpc.org.contests.bundles.update.mutationOptions({
      onSuccess: (result) => {
        report(result, `“${draft.label.trim()}” saved.`)
        onChanged()
      },
      onError: (err) =>
        toast.error('Could not save the bundle', { description: err.message }),
    })
  )

  const setActive = useMutation(
    trpc.org.contests.bundles.setActive.mutationOptions({
      onSuccess: ({ active }) => {
        toast.success(active ? 'Back on sale.' : 'Retired — off sale now.')
        onChanged()
      },
      onError: (err) =>
        toast.error('Could not change that', { description: err.message }),
    })
  )

  const dirty =
    draft.label !== bundle.label ||
    draft.votes !== String(bundle.votes) ||
    draft.price !== koboToNaira(bundle.priceMinor)

  function save() {
    const result = validateBundle(draft)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError(null)
    update.mutate({ id: bundle.id, ...result.input })
  }

  return (
    <li
      className={cn(
        'border-border/60 flex flex-col gap-3 rounded-xl border p-4',
        bundle.active ? '' : 'opacity-70'
      )}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
        <BundleField label="Name" htmlFor={`bun-label-${bundle.id}`}>
          <Input
            id={`bun-label-${bundle.id}`}
            value={draft.label}
            maxLength={120}
            disabled={update.isPending || contentLocked}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            placeholder="20 votes"
          />
        </BundleField>
        <BundleField
          label="Votes"
          htmlFor={`bun-votes-${bundle.id}`}
          className="sm:w-28"
        >
          <Input
            id={`bun-votes-${bundle.id}`}
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={draft.votes}
            disabled={update.isPending || contentLocked}
            onChange={(e) => setDraft({ ...draft, votes: e.target.value })}
          />
        </BundleField>
        <BundleField
          label="Price (₦)"
          htmlFor={`bun-price-${bundle.id}`}
          className="sm:w-36"
        >
          <Input
            id={`bun-price-${bundle.id}`}
            type="number"
            inputMode="decimal"
            min={0}
            step={100}
            value={draft.price}
            disabled={update.isPending || contentLocked}
            onChange={(e) => setDraft({ ...draft, price: e.target.value })}
          />
        </BundleField>
        <button
          type="button"
          aria-label={`Delete ${bundle.label}`}
          title={`Delete ${bundle.label}`}
          onClick={onDelete}
          disabled={update.isPending || contentLocked}
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
        <PriceFootnote
          priceMinor={bundle.priceMinor}
          votes={bundle.votes}
          serviceFeeBps={serviceFeeBps}
        />
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={setActive.isPending}
            onClick={() =>
              setActive.mutate({ id: bundle.id, active: !bundle.active })
            }
          >
            {bundle.active ? 'Retire' : 'Put back on sale'}
          </Button>
          {dirty ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={update.isPending}
                onClick={() => {
                  setDraft(draftOf(bundle))
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
            </>
          ) : null}
        </div>
      </div>

      {dirty && isLive ? (
        <p className="flex items-start gap-2 text-xs leading-5 text-amber-700 dark:text-amber-300">
          <HugeiconsIcon
            icon={Alert02Icon}
            className="mt-px size-3.5 shrink-0"
            strokeWidth={1.9}
          />
          Saving this changes what a voter is charged, so your contest stops
          taking votes and goes back into the admin review queue. Retiring it
          does not.
        </p>
      ) : null}

      {error ? (
        <p className="text-destructive text-xs font-medium">{error}</p>
      ) : null}
    </li>
  )
}

function NewBundleRow({
  pending,
  isLive,
  serviceFeeBps,
  onCancel,
  onSubmit,
}: {
  pending: boolean
  isLive: boolean
  serviceFeeBps: number
  onCancel: () => void
  onSubmit: (values: BundleInput) => void
}) {
  const [draft, setDraft] = useState<BundleDraft>({
    label: '',
    votes: '',
    price: '',
  })
  const [error, setError] = useState<string | null>(null)

  const preview = validateBundle(draft)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!preview.ok) {
      setError(preview.error)
      return
    }
    setError(null)
    onSubmit(preview.input)
    // Kept open and cleared, so a price ladder goes in one rung at a time.
    setDraft({ label: '', votes: '', price: '' })
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      className="border-primary/30 bg-primary/5 flex flex-col gap-3 rounded-xl border border-dashed p-4"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <BundleField label="Name" htmlFor="bun-new-label">
          <Input
            id="bun-new-label"
            value={draft.label}
            maxLength={120}
            disabled={pending}
            autoFocus
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            placeholder="e.g. 20 votes"
          />
        </BundleField>
        <BundleField label="Votes" htmlFor="bun-new-votes" className="sm:w-28">
          <Input
            id="bun-new-votes"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={draft.votes}
            disabled={pending}
            onChange={(e) => setDraft({ ...draft, votes: e.target.value })}
            placeholder="20"
          />
        </BundleField>
        <BundleField
          label="Price (₦)"
          htmlFor="bun-new-price"
          className="sm:w-36"
        >
          <Input
            id="bun-new-price"
            type="number"
            inputMode="decimal"
            min={0}
            step={100}
            value={draft.price}
            disabled={pending}
            onChange={(e) => setDraft({ ...draft, price: e.target.value })}
            placeholder="1000"
          />
        </BundleField>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        {preview.ok ? (
          <PriceFootnote
            priceMinor={preview.input.priceMinor}
            votes={preview.input.votes}
            serviceFeeBps={serviceFeeBps}
          />
        ) : (
          <span />
        )}
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
                : 'Add bundle'}
          </Button>
        </div>
      </div>

      {error ? (
        <p className="text-destructive text-xs font-medium">{error}</p>
      ) : null}
    </form>
  )
}

function BundleField({
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

function draftOf(bundle: VoteBundle): BundleDraft {
  return {
    label: bundle.label,
    votes: String(bundle.votes),
    price: koboToNaira(bundle.priceMinor),
  }
}
