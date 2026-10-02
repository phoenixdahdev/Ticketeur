'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { Alert02Icon } from '@hugeicons/core-free-icons'

import { useTRPC } from '@/lib/trpc'
import { formatMoney } from '@/components/dashboard/refunds/kinds'

/**
 * Money the platform is holding that it may owe back, on the first page an
 * admin sees. Deliberately a banner rather than one more stat tile: these are
 * customers waiting on their own money, and a tile in a row of four reads as
 * a number to glance at.
 *
 * Renders nothing when there is nothing owed.
 */
export function RefundsOwedAlert() {
  const trpc = useTRPC()
  const { data } = useQuery(trpc.admin.overview.stats.queryOptions())

  if (!data || data.openDiscrepancies === 0) return null

  const count = data.openDiscrepancies
  return (
    <Link
      href="/refunds"
      className="group flex items-center gap-4 rounded-2xl border border-rose-200 bg-rose-50/70 p-4 transition-colors hover:bg-rose-50 md:p-5 dark:border-rose-500/30 dark:bg-rose-500/10 dark:hover:bg-rose-500/15"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400">
        <HugeiconsIcon icon={Alert02Icon} className="size-5" strokeWidth={1.8} />
      </span>
      <div className="flex min-w-0 flex-col">
        <p className="text-foreground text-sm font-semibold md:text-base">
          {formatMoney(data.openDiscrepancyOwedMinor)} owed back to customers
          across {count} {count === 1 ? 'charge' : 'charges'}
        </p>
        <p className="text-muted-foreground text-xs md:text-sm">
          Each one needs a refund issued in Flutterwave by hand.
        </p>
      </div>
      <span className="text-primary ml-auto shrink-0 text-sm font-semibold group-hover:underline">
        Review →
      </span>
    </Link>
  )
}
