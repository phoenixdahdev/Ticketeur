'use client'

import { format } from 'date-fns'
import Link from 'next/link'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import { CheckmarkCircle02Icon } from '@hugeicons/core-free-icons'

import { cn } from '@ticketur/ui/lib/utils'
import { Button } from '@ticketur/ui/components/button'
import type { RouterOutputs } from '@ticketur/api'

import { useTRPC } from '@/lib/trpc'
import { toDate } from '@/lib/date'
import { useActionDialog } from '@/components/dashboard/action-dialog/store'
import {
  KIND_LABEL,
  KIND_SEVERITY,
  KIND_SUMMARY,
  formatMoney,
  reasonLabel,
} from '@/components/dashboard/refunds/kinds'

type Discrepancy = RouterOutputs['admin']['paymentDiscrepancies']['byId']

function formatMoment(iso: string | null) {
  const d = toDate(iso)
  if (!d) return '—'
  return format(d, "MMMM d, yyyy 'at' h:mm a")
}

export function RefundDetail({ item }: { item: Discrepancy }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const dialog = useActionDialog()

  const resolveMutation = useMutation(
    trpc.admin.paymentDiscrepancies.resolve.mutationOptions({
      onSuccess: () => {
        toast.success('Refund recorded')
        queryClient.invalidateQueries({
          queryKey: trpc.admin.paymentDiscrepancies.byId.queryKey({
            id: item.id,
          }),
        })
        queryClient.invalidateQueries({
          queryKey: trpc.admin.paymentDiscrepancies.list.queryKey(),
        })
        queryClient.invalidateQueries({
          queryKey: trpc.admin.paymentDiscrepancies.stats.queryKey(),
        })
        queryClient.invalidateQueries({
          queryKey: trpc.admin.overview.stats.queryKey(),
        })
      },
      onError: (e) =>
        toast.error('Could not record the refund', { description: e.message }),
    })
  )

  const owed = formatMoney(item.money.owedMinor, item.money.paidCurrency)
  const danger = KIND_SEVERITY[item.kind] === 'danger'

  async function handleResolve() {
    if (resolveMutation.isPending) return
    const note = await dialog.prompt({
      title: `Record a refund of ${owed}?`,
      description:
        'This does not refund anything. Issue the refund in Flutterwave first, then record it here so nobody refunds it twice.',
      inputLabel: 'Flutterwave refund reference, and what you did (required)',
      placeholder: 'e.g. Refunded ₦2,000 in Flutterwave — refund ref RF-10293',
      confirmLabel: 'Record refund',
      required: true,
      multiline: true,
      tone: 'success',
    })
    if (note === null || note.trim().length === 0) return
    resolveMutation.mutate({ id: item.id, note: note.trim() })
  }

  return (
    <div className="flex flex-col gap-6">
      {/* What happened, and what it means for the customer. */}
      <section
        className={cn(
          'relative flex flex-col gap-5 overflow-hidden rounded-2xl border p-5 md:p-6',
          danger
            ? 'border-rose-200 bg-rose-50/60 dark:border-rose-500/30 dark:bg-rose-500/5'
            : 'border-amber-200 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/5'
        )}
      >
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={cn(
                'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold',
                danger
                  ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300'
                  : 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300'
              )}
            >
              {KIND_LABEL[item.kind]}
            </span>
            <span className="text-muted-foreground text-xs">
              Detected {formatMoment(item.detectedAt)}
            </span>
          </div>
          <h2 className="font-heading text-foreground text-2xl font-bold tracking-tight md:text-3xl">
            {owed} owed to {item.customer.name}
          </h2>
          <p className="text-foreground/80 max-w-3xl text-sm">
            {KIND_SUMMARY[item.kind]}
          </p>
          <p className="text-muted-foreground text-sm">
            Cause: {reasonLabel(item.reason)}
            {item.detail ? ` — ${item.detail}` : ''}
          </p>
        </div>
      </section>

      {/* The three figures, each said plainly. */}
      <section className="border-border/60 bg-background flex flex-col gap-5 rounded-2xl border p-5 md:p-6">
        <h3 className="text-foreground text-base font-semibold">The money</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <MoneyBlock
            label="What the order asked for"
            value={formatMoney(item.money.expectedMinor)}
            hint="Charged to Flutterwave in whole naira"
          />
          <MoneyBlock
            label="What the customer paid"
            value={formatMoney(item.money.paidMinor, item.money.paidCurrency)}
            hint={
              item.money.paidCurrency !== 'NGN'
                ? `Charged in ${item.money.paidCurrency}, not naira`
                : 'This charge only'
            }
          />
          <MoneyBlock
            label={`Owed back to ${item.customer.name}`}
            value={owed}
            hint={
              item.kind === 'overpayment'
                ? 'The excess only — the order was fulfilled'
                : 'The whole charge — nothing was delivered'
            }
            tone={danger ? 'danger' : 'warning'}
          />
        </div>
        {item.money.orderTotalMinor !== null &&
        item.money.orderTotalMinor !== item.money.expectedMinor ? (
          <p className="text-muted-foreground text-xs">
            The order total is {formatMoney(item.money.orderTotalMinor)}.
            Flutterwave is charged in whole naira, so the amount requested
            above is that total rounded to the nearest naira.
          </p>
        ) : null}
      </section>

      {/* Everything needed to find and refund the charge in Flutterwave. */}
      <section className="border-border/60 bg-background flex flex-col gap-5 rounded-2xl border p-5 md:p-6">
        <div className="flex flex-col gap-1">
          <h3 className="text-foreground text-base font-semibold">
            Refund it in Flutterwave
          </h3>
          <p className="text-muted-foreground text-sm">
            Ticketeur never refunds automatically. Find this transaction in the
            Flutterwave dashboard, refund {owed}, then record it below.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field
            label="Flutterwave transaction ID"
            value={item.gateway.transactionId}
            mono
          />
          <Field
            label="Payment reference (tx_ref)"
            value={item.gateway.txRef ?? '—'}
            mono
          />
          <Field label="Customer" value={item.customer.name} />
          <Field label="Customer email" value={item.customer.email || '—'} />
        </div>
        {item.gateway.orderTransactionId &&
        item.gateway.orderTransactionId !== item.gateway.transactionId ? (
          <p className="text-muted-foreground text-xs">
            The order now records a different charge (
            <span className="font-mono">{item.gateway.orderTransactionId}</span>
            ) — refund the transaction ID above, not that one.
          </p>
        ) : null}
      </section>

      {/* The order this charge was against. */}
      <section className="border-border/60 bg-background flex flex-col gap-5 rounded-2xl border p-5 md:p-6">
        <h3 className="text-foreground text-base font-semibold">The order</h3>
        {item.order.status === null ? (
          <p className="text-muted-foreground text-sm">
            This order no longer exists — it was deleted after the charge was
            recorded. Everything needed to refund it is above.
          </p>
        ) : null}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 md:grid-cols-4">
          <Field label="Order ID" value={item.order.id} mono />
          <Field label="Order type" value={item.order.type.replace(/_/g, ' ')} />
          <Field label="Order status" value={item.order.status ?? 'Deleted'} />
          <Field label="Placed" value={formatMoment(item.order.createdAt)} />
        </div>
        {item.order.eventName ? (
          <Field
            label="Event"
            value={item.order.eventName}
            href={item.order.eventId ? `/events/${item.order.eventId}` : null}
          />
        ) : null}
        {item.order.status === 'paid' ? (
          <Link
            href={`/transactions/${item.order.id}`}
            className="text-primary text-sm font-semibold hover:underline"
          >
            View the transaction →
          </Link>
        ) : null}
      </section>

      {/* The one human action. */}
      <section className="border-border/60 bg-background flex flex-col gap-4 rounded-2xl border p-5 md:p-6">
        {item.resolution ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
              <HugeiconsIcon
                icon={CheckmarkCircle02Icon}
                className="size-5"
                strokeWidth={2}
              />
              <h3 className="text-base font-semibold">Refund recorded</h3>
            </div>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Field
                label="Recorded by"
                value={item.resolution.byName ?? 'A deleted admin account'}
              />
              <Field label="When" value={formatMoment(item.resolution.at)} />
            </div>
            <Field label="Note" value={item.resolution.note || '—'} />
          </div>
        ) : (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-1">
              <h3 className="text-foreground text-base font-semibold">
                Already refunded this?
              </h3>
              <p className="text-muted-foreground text-sm">
                Record it so it leaves the queue and nobody refunds {owed}{' '}
                twice.
              </p>
            </div>
            <Button
              type="button"
              size="lg"
              disabled={resolveMutation.isPending}
              onClick={handleResolve}
              className="shrink-0 bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {resolveMutation.isPending ? 'Recording…' : 'Record refund'}
            </Button>
          </div>
        )}
      </section>
    </div>
  )
}

function MoneyBlock({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: string
  hint: string
  tone?: 'danger' | 'warning'
}) {
  return (
    <div className="border-border/60 flex flex-col gap-1 rounded-xl border p-4">
      <span className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
        {label}
      </span>
      <span
        className={cn(
          'font-heading text-2xl font-bold tracking-tight',
          tone === 'danger'
            ? 'text-rose-600 dark:text-rose-400'
            : tone === 'warning'
              ? 'text-amber-600 dark:text-amber-400'
              : 'text-foreground'
        )}
      >
        {value}
      </span>
      <span className="text-muted-foreground text-xs">{hint}</span>
    </div>
  )
}

function Field({
  label,
  value,
  mono,
  href,
}: {
  label: string
  value: string
  mono?: boolean
  href?: string | null
}) {
  const body = (
    <span
      className={cn(
        'text-muted-foreground text-sm break-all',
        mono && 'font-mono text-xs'
      )}
    >
      {value}
    </span>
  )
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-foreground text-sm font-semibold">{label}</span>
      {href ? (
        <Link href={href} className="hover:text-primary transition-colors">
          {body}
        </Link>
      ) : (
        body
      )}
    </div>
  )
}
