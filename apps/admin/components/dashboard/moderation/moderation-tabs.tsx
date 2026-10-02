'use client'

import { motion } from 'motion/react'
import { useQuery } from '@tanstack/react-query'
import { parseAsStringLiteral, useQueryState } from 'nuqs'

import { cn } from '@ticketur/ui/lib/utils'

import { useTRPC } from '@/lib/trpc'
import { ModerationVendorsTable } from '@/components/dashboard/moderation/moderation-vendors-table'
import { ModerationEventsTable } from '@/components/dashboard/moderation/moderation-events-table'
import { ModerationEventEditsTable } from '@/components/dashboard/moderation/moderation-event-edits-table'
import { ModerationFormsTable } from '@/components/dashboard/moderation/moderation-forms-table'
import { FlaggedActivitiesList } from '@/components/dashboard/moderation/flagged-activities-list'

const TABS = ['vendors', 'events', 'edits', 'forms', 'flagged'] as const
type Tab = (typeof TABS)[number]

const TAB_LABELS: Record<Tab, string> = {
  vendors: 'Vendors',
  events: 'Events',
  edits: 'Event Edits',
  forms: 'Forms',
  flagged: 'Flagged Activities',
}

export function ModerationTabs() {
  const trpc = useTRPC()

  const [tab, setTab] = useQueryState(
    'tab',
    parseAsStringLiteral(TABS).withDefault('vendors')
  )

  const vendorsQuery = useQuery(
    trpc.admin.moderation.pendingVendors.queryOptions(undefined, {
      enabled: tab === 'vendors',
    })
  )
  const eventsQuery = useQuery(
    trpc.admin.moderation.pendingEvents.queryOptions(undefined, {
      enabled: tab === 'events',
    })
  )
  const editsQuery = useQuery(
    trpc.admin.moderation.pendingEventEdits.queryOptions(undefined, {
      enabled: tab === 'edits',
    })
  )
  const formsQuery = useQuery(
    trpc.admin.moderation.pendingForms.queryOptions(undefined, {
      enabled: tab === 'forms',
    })
  )
  const flaggedQuery = useQuery(
    trpc.admin.moderation.flaggedActivities.queryOptions(undefined, {
      enabled: tab === 'flagged',
    })
  )

  return (
    <div className="flex flex-col gap-6">
      <div
        role="tablist"
        aria-label="Moderation queue"
        className="bg-background -mx-1 flex shrink-0 [scrollbar-width:none] items-center gap-2 overflow-x-auto px-1 py-1 sm:mx-0 [&::-webkit-scrollbar]:hidden"
      >
        {TABS.map((t) => {
          const active = tab === t
          return (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => void setTab(t)}
              className={cn(
                'border-border/60 relative shrink-0 rounded-full border px-6 py-2 text-sm font-semibold whitespace-nowrap transition-colors md:px-7 md:py-2.5 md:text-base',
                active
                  ? 'text-primary-foreground border-transparent'
                  : 'text-foreground/80 hover:text-foreground'
              )}
            >
              {active ? (
                <motion.span
                  layoutId="moderation-tab-pill"
                  className="bg-primary absolute inset-0 rounded-full"
                  transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                />
              ) : null}
              <span className="relative">{TAB_LABELS[t]}</span>
            </button>
          )
        })}
      </div>

      <div>
        {tab === 'vendors' ? (
          <ModerationVendorsTable
            rows={vendorsQuery.data ?? []}
            loading={vendorsQuery.isLoading}
          />
        ) : tab === 'events' ? (
          <ModerationEventsTable
            rows={eventsQuery.data ?? []}
            loading={eventsQuery.isLoading}
          />
        ) : tab === 'edits' ? (
          <ModerationEventEditsTable
            rows={editsQuery.data ?? []}
            loading={editsQuery.isLoading}
          />
        ) : tab === 'forms' ? (
          <ModerationFormsTable
            rows={formsQuery.data ?? []}
            loading={formsQuery.isLoading}
          />
        ) : (
          <FlaggedActivitiesList
            rows={flaggedQuery.data ?? []}
            loading={flaggedQuery.isLoading}
          />
        )}
      </div>
    </div>
  )
}
