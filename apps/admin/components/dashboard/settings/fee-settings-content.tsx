'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import type { IconSvgElement } from '@hugeicons/react'
import {
  Alert02Icon,
  Clock01Icon,
  InformationCircleIcon,
  Ticket01Icon,
  UserMultiple02Icon,
  VoteIcon,
} from '@hugeicons/core-free-icons'

import {
  feeBpsFromPercent,
  formatFeeBps,
  type FeeKind,
} from '@ticketur/api/lib/fees'
import { Button } from '@ticketur/ui/components/button'
import { Input } from '@ticketur/ui/components/input'
import { Skeleton } from '@ticketur/ui/components/skeleton'

import { useTRPC } from '@/lib/trpc'
import { useActionDialog } from '@/components/dashboard/action-dialog/store'

// The platform service fee, as three rates an admin can change.
//
// Everything on this screen is a percentage, because that is what the business
// talks in. Everything stored is basis points, because that is what the fee is
// computed with. The two conversions live in @ticketur/api/lib/fees, beside the
// arithmetic that charges the fee, so this screen cannot drift from checkout.

type Field = {
  kind: FeeKind
  label: string
  icon: IconSvgElement
  blurb: string
}

const FIELDS: Field[] = [
  {
    kind: 'ticket',
    label: 'Ticket sales',
    icon: Ticket01Icon,
    blurb: 'Added to every paid ticket order at checkout.',
  },
  {
    kind: 'registration',
    label: 'Registration fees',
    icon: UserMultiple02Icon,
    blurb:
      'Added to a paid application on a registration form — contestant entry, vendor booth.',
  },
  {
    kind: 'vote',
    label: 'Paid voting',
    icon: VoteIcon,
    blurb:
      'For paid contest voting. Saved and ready, but nothing charges it yet.',
  },
]

type Draft = Record<FeeKind, string>

const EMPTY_DRAFT: Draft = { ticket: '', registration: '', vote: '' }

// Basis points → the percentage shown in the input: 500 → "5", 525 → "5.25".
function toPercentInput(bps: number): string {
  return String(Number((bps / 100).toFixed(2)))
}

export function FeeSettingsContent() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const dialog = useActionDialog()

  const feesQuery = useQuery(trpc.admin.settings.fees.queryOptions())
  const historyQuery = useQuery(trpc.admin.settings.feeHistory.queryOptions())

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [touched, setTouched] = useState(false)

  // Seed the inputs from the server once, and re-seed after a save (which
  // refetches). An edit in progress is never overwritten: `touched` stays true
  // until the save that clears it.
  const rates = feesQuery.data?.rates
  useEffect(() => {
    if (!rates || touched) return
    setDraft({
      ticket: toPercentInput(rates.ticket),
      registration: toPercentInput(rates.registration),
      vote: toPercentInput(rates.vote),
    })
  }, [rates, touched])

  const save = useMutation(
    trpc.admin.settings.updateFees.mutationOptions({
      onSuccess: ({ changed }) => {
        setTouched(false)
        void queryClient.invalidateQueries({
          queryKey: trpc.admin.settings.fees.queryKey(),
        })
        void queryClient.invalidateQueries({
          queryKey: trpc.admin.settings.feeHistory.queryKey(),
        })
        toast.success(
          changed.length === 0
            ? 'Nothing changed'
            : 'Saved — new orders from now on use these rates'
        )
      },
      onError: (error) =>
        toast.error('Could not save the fees', { description: error.message }),
    })
  )

  // Each input, parsed. null means "not a percentage we will store", which is
  // both the error state and what blocks the save.
  const parsed: Record<FeeKind, number | null> = {
    ticket: feeBpsFromPercent(draft.ticket),
    registration: feeBpsFromPercent(draft.registration),
    vote: feeBpsFromPercent(draft.vote),
  }
  const anyInvalid = FIELDS.some((f) => parsed[f.kind] === null)
  const dirty =
    rates !== undefined &&
    FIELDS.some((f) => parsed[f.kind] !== null && parsed[f.kind] !== rates[f.kind])

  async function onSave() {
    if (anyInvalid || !rates) return
    const next = {
      ticketFeeBps: parsed.ticket!,
      registrationFeeBps: parsed.registration!,
      voteFeeBps: parsed.vote!,
    }

    const lines = FIELDS.filter((f) => parsed[f.kind] !== rates[f.kind]).map(
      (f) =>
        `${f.label}: ${formatFeeBps(rates[f.kind])} → ${formatFeeBps(parsed[f.kind]!)}`
    )
    const ok = await dialog.confirm({
      title: 'Change the platform fees?',
      description: `${lines.join('. ')}. This applies to orders placed from now on. Orders that already exist, including unpaid ones, keep the fee they were created with.`,
      confirmLabel: 'Save fees',
      tone: 'danger',
    })
    if (ok) save.mutate(next)
  }

  if (feesQuery.isLoading) {
    return (
      <div className="flex max-w-3xl flex-col gap-6">
        <Skeleton className="h-64 w-full rounded-2xl" />
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>
    )
  }

  if (feesQuery.isError || !feesQuery.data) {
    return (
      <div className="border-destructive/40 bg-destructive/5 text-destructive flex max-w-3xl items-start gap-2 rounded-2xl border p-5 text-sm">
        <HugeiconsIcon
          icon={Alert02Icon}
          className="mt-0.5 size-4 shrink-0"
          strokeWidth={2}
        />
        <span>
          Couldn&apos;t load the current fees. Nothing has changed — reload the
          page and try again.
        </span>
      </div>
    )
  }

  // Past the guard above, so these are the live values rather than `rates`,
  // which TypeScript still sees as possibly undefined.
  const { rates: liveRates, usingDefaults, updatedAt, updatedBy } =
    feesQuery.data

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <section className="border-border/60 bg-background flex flex-col gap-5 rounded-2xl border p-5 md:p-6">
        <div className="flex flex-col gap-1.5">
          <h2 className="font-heading text-foreground text-base font-bold">
            Service fee rates
          </h2>
          <p className="text-muted-foreground text-sm leading-6">
            What the platform takes on top of what the buyer is paying. Enter a
            percentage between 0 and 100 — two decimal places at most, so 2.5%
            and 7.25% are both fine.
          </p>
        </div>

        <div className="flex flex-col gap-5">
          {FIELDS.map((field) => {
            const invalid = parsed[field.kind] === null
            const current = liveRates[field.kind]
            return (
              <div key={field.kind} className="flex flex-col gap-2">
                <label
                  htmlFor={`fee-${field.kind}`}
                  className="text-foreground flex items-center gap-2 text-sm font-semibold"
                >
                  <HugeiconsIcon
                    icon={field.icon}
                    className="text-muted-foreground size-4"
                    strokeWidth={1.8}
                  />
                  {field.label}
                </label>
                <div className="flex items-center gap-3">
                  <div className="relative w-36">
                    <Input
                      id={`fee-${field.kind}`}
                      inputMode="decimal"
                      value={draft[field.kind]}
                      aria-invalid={invalid}
                      aria-describedby={`fee-${field.kind}-help`}
                      onChange={(e) => {
                        setTouched(true)
                        setDraft((d) => ({
                          ...d,
                          [field.kind]: e.target.value,
                        }))
                      }}
                      className="pr-8"
                    />
                    <span
                      aria-hidden
                      className="text-muted-foreground pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm"
                    >
                      %
                    </span>
                  </div>
                  <span className="text-muted-foreground text-xs">
                    now {formatFeeBps(current)}
                  </span>
                </div>
                <p
                  id={`fee-${field.kind}-help`}
                  className={
                    invalid
                      ? 'text-destructive text-xs'
                      : 'text-muted-foreground text-xs'
                  }
                >
                  {invalid
                    ? 'Enter a percentage between 0 and 100.'
                    : field.blurb}
                </p>
              </div>
            )
          })}
        </div>

        <div className="flex items-start gap-3 rounded-xl border border-[#fde68a] bg-[#fffbeb] p-4 dark:border-[#b45309]/40 dark:bg-[#b45309]/10">
          <HugeiconsIcon
            icon={InformationCircleIcon}
            className="mt-px size-4 shrink-0 text-[#b45309] dark:text-[#fbbf24]"
            strokeWidth={1.8}
          />
          <p className="text-sm leading-6 text-[#92400e] dark:text-[#fbbf24]">
            <strong className="font-semibold">Future orders only.</strong> Every
            order stores the fee it was created with, so changing a rate here
            leaves past orders, receipts and unpaid payment links exactly as
            they are. The new rate applies to the next order placed.
          </p>
        </div>

        <div className="border-border/60 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p className="text-muted-foreground text-xs">
            {usingDefaults || !updatedAt
              ? 'Never changed — the platform is running on the 5% defaults.'
              : `Last changed by ${updatedBy ? `${updatedBy.name} (${updatedBy.email})` : 'a deleted account'} on ${format(updatedAt, 'd MMM yyyy, HH:mm')}.`}
          </p>
          <Button
            type="button"
            size="lg"
            onClick={onSave}
            disabled={anyInvalid || !dirty || save.isPending}
          >
            {save.isPending ? 'Saving…' : 'Save fees'}
          </Button>
        </div>
      </section>

      <section className="border-border/60 bg-background flex flex-col gap-4 rounded-2xl border p-5 md:p-6">
        <div className="flex items-center gap-2">
          <HugeiconsIcon
            icon={Clock01Icon}
            className="text-muted-foreground size-4"
            strokeWidth={1.8}
          />
          <h2 className="font-heading text-foreground text-base font-bold">
            Change history
          </h2>
        </div>

        {historyQuery.isLoading ? (
          <Skeleton className="h-20 w-full rounded-xl" />
        ) : historyQuery.data && historyQuery.data.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {historyQuery.data.map((entry) => {
              const moves = [
                {
                  label: 'Ticket sales',
                  from: entry.previousTicketFeeBps,
                  to: entry.ticketFeeBps,
                },
                {
                  label: 'Registration fees',
                  from: entry.previousRegistrationFeeBps,
                  to: entry.registrationFeeBps,
                },
                {
                  label: 'Paid voting',
                  from: entry.previousVoteFeeBps,
                  to: entry.voteFeeBps,
                },
              ].filter((m) => m.from !== m.to)
              return (
                <li
                  key={entry.id}
                  className="border-border/60 flex flex-col gap-1 rounded-xl border p-3.5"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-foreground text-sm font-semibold">
                      {entry.changedByName || 'A deleted account'}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {format(entry.createdAt, 'd MMM yyyy, HH:mm')}
                    </span>
                  </div>
                  {entry.changedByEmail ? (
                    <span className="text-muted-foreground text-xs">
                      {entry.changedByEmail}
                    </span>
                  ) : null}
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {moves.map((m) => (
                      <li key={m.label} className="text-sm">
                        <span className="text-muted-foreground">
                          {m.label}:{' '}
                        </span>
                        <span className="text-foreground font-semibold">
                          {formatFeeBps(m.from)} → {formatFeeBps(m.to)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">
            No changes yet. Every future change is recorded here with who made
            it and when.
          </p>
        )}
      </section>
    </div>
  )
}
