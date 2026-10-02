import type { Metadata } from 'next'

import { OverviewStats } from '@/components/dashboard/overview/overview-stats'
import { RefundsOwedAlert } from '@/components/dashboard/overview/refunds-owed-alert'
import { ModerationQueue } from '@/components/dashboard/overview/moderation-queue'
import { RecentActivity } from '@/components/dashboard/overview/recent-activity'
import { getSession } from '@/lib/auth'

export const metadata: Metadata = {
  title: 'Overview',
}

export default async function OverviewPage() {
  const session = await getSession()
  const firstName = session?.user?.name?.split(' ')[0] ?? 'Admin'

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 md:gap-8">
      <header className="flex flex-col gap-1.5">
        <h1 className="font-heading text-foreground text-2xl font-bold tracking-tight md:text-[28px]">
          Welcome back, {firstName}
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          Monitor and manage your platform with ease
        </p>
      </header>

      <RefundsOwedAlert />

      <OverviewStats />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.5fr_1fr] lg:gap-6">
        <ModerationQueue />
        <RecentActivity />
      </div>
    </div>
  )
}
