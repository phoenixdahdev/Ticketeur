import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import {
  Alert02Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  InformationCircleIcon,
} from '@hugeicons/core-free-icons'

import { cn } from '@ticketur/ui/lib/utils'

import type { VoteRefusal } from '@/components/sections/contests/voting-state'

export type NoticeTone = 'info' | 'success' | 'warning' | 'error' | 'muted'

const TONE_CLASS: Record<NoticeTone, string> = {
  info: 'border-primary/30 bg-primary/5 text-foreground',
  success:
    'border-emerald-500/40 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200',
  warning:
    'border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200',
  error: 'border-destructive/40 bg-destructive/5 text-destructive',
  muted: 'border-border bg-muted/40 text-muted-foreground',
}

const TONE_ICON: Record<NoticeTone, IconSvgElement> = {
  info: InformationCircleIcon,
  success: CheckmarkCircle02Icon,
  warning: Clock01Icon,
  error: Alert02Icon,
  muted: InformationCircleIcon,
}

export function Notice({
  tone,
  icon,
  role,
  children,
}: {
  tone: NoticeTone
  icon?: IconSvgElement
  role?: 'alert' | 'status'
  children: React.ReactNode
}) {
  return (
    <div
      role={role}
      className={cn(
        'flex items-start gap-2.5 rounded-xl border p-4 text-sm leading-6',
        TONE_CLASS[tone]
      )}
    >
      <HugeiconsIcon
        icon={icon ?? TONE_ICON[tone]}
        className="mt-0.5 size-4 shrink-0"
        strokeWidth={1.8}
      />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

/**
 * A refused vote, in the server's own words.
 *
 * The important one is `daily_allowance` — "you've already used your free
 * vote in this category today" is the COMMON outcome of free voting, not a
 * fault, and it is rendered in the same calm tone as everything else on the
 * page. Red text and an alert role would tell a voter who did nothing wrong
 * that something broke.
 */
export function RefusalNotice({ refusal }: { refusal: VoteRefusal }) {
  return (
    <Notice
      tone={refusal.tone}
      icon={refusal.kind === 'daily_allowance' ? Clock01Icon : undefined}
      // Announced, but not as an alert when nothing went wrong.
      role={refusal.tone === 'error' ? 'alert' : 'status'}
    >
      <p>{refusal.message}</p>
      {refusal.hint ? (
        <p className="mt-1 text-xs leading-5 opacity-80">{refusal.hint}</p>
      ) : null}
    </Notice>
  )
}
