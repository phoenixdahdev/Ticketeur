import type { Metadata } from 'next'

import { RefundDetailContent } from '@/components/dashboard/refunds/refund-detail-content'

export const metadata: Metadata = {
  title: 'Refund Owed',
}

export default async function RefundDetailPage({
  params,
}: PageProps<'/refunds/[id]'>) {
  const { id } = await params

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 md:gap-8">
      <header className="flex flex-col gap-1.5">
        <h1 className="font-heading text-foreground text-2xl font-bold tracking-tight md:text-[28px]">
          Refunds Owed
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          Check the figures, refund in Flutterwave, then record it here.
        </p>
      </header>

      <RefundDetailContent id={id} />
    </div>
  )
}
