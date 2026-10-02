import type { Metadata } from 'next'

import { FeeSettingsContent } from '@/components/dashboard/settings/fee-settings-content'

export const metadata: Metadata = {
  title: 'Settings',
}

export default function SettingsPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 md:gap-8">
      <header className="flex flex-col gap-1.5">
        <h1 className="font-heading text-foreground text-2xl font-bold tracking-tight md:text-[28px]">
          Platform settings
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          What Ticketeur charges on top of ticket sales, registration fees and
          paid voting. Changes apply to orders placed from then on.
        </p>
      </header>

      <FeeSettingsContent />
    </div>
  )
}
