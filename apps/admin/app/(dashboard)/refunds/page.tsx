import type { Metadata } from 'next'

import { RefundsStats } from '@/components/dashboard/refunds/refunds-stats'
import { RefundsContent } from '@/components/dashboard/refunds/refunds-content'

export const metadata: Metadata = {
  title: 'Refunds Owed',
}

export default function RefundsPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 md:gap-8">
      <header className="flex flex-col gap-1.5">
        <h1 className="font-heading text-foreground text-2xl font-bold tracking-tight md:text-[28px]">
          Refunds Owed
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          Charges that took a customer&apos;s money and left something
          unsettled. Refund each one in Flutterwave, then record it here.
        </p>
      </header>

      <RefundsStats />

      <RefundsContent />
    </div>
  )
}
