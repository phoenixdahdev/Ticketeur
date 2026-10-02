'use client'

import { useQuery } from '@tanstack/react-query'
import { MoneyBag02Icon, Alert02Icon } from '@hugeicons/core-free-icons'

import { useTRPC } from '@/lib/trpc'
import { StatCard } from '@/components/dashboard/stat-card'
import { formatMoney } from '@/components/dashboard/refunds/kinds'

export function RefundsStats() {
  const trpc = useTRPC()
  const { data, isLoading } = useQuery(
    trpc.admin.paymentDiscrepancies.stats.queryOptions()
  )

  return (
    <section
      aria-label="Refunds owed"
      className="grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2"
    >
      <StatCard
        label="Owed back to customers"
        value={data ? formatMoney(data.openOwedMinor) : '—'}
        icon={MoneyBag02Icon}
        tone="orange"
        badge={data && data.open > 0 ? 'Action needed' : undefined}
        loading={isLoading}
      />
      <StatCard
        label="Awaiting a refund"
        value={data ? data.open.toLocaleString('en-US') : '—'}
        icon={Alert02Icon}
        tone="orange"
        loading={isLoading}
      />
      {/* Charges the naira total above could not include — a charge in
          another currency, or one whose amount Flutterwave did not give us a
          readable number for. Said out loud so the total is never mistaken
          for the whole of what is owed. */}
      {data && data.openUnknownAmount > 0 ? (
        <p className="text-muted-foreground sm:col-span-2 text-sm">
          {data.openUnknownAmount}{' '}
          {data.openUnknownAmount === 1 ? 'charge is' : 'charges are'} not in
          the total above — the amount has to be read off Flutterwave.
        </p>
      ) : null}
    </section>
  )
}
