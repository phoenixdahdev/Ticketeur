'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import { Alert02Icon } from '@hugeicons/core-free-icons'

import { cn } from '@ticketur/ui/lib/utils'
import { Button } from '@ticketur/ui/components/button'

import { useTRPC } from '@/lib/trpc'
import type { ContestDetail } from '@/lib/org-contests'
import type { ReviewReport } from '@/components/dashboard/contests/review-notice'
import {
  ContestSettingsFields,
  reviewedContentChanged,
  settingsFromContest,
  validateContestSettings,
  type ContestSettingsErrors,
  type ContestSettingsValues,
} from '@/components/dashboard/contests/contest-settings-fields'

// `org.contests.update` replaces the whole settings set in one call, so this
// card sends every value every time — and works out, before it does, whether
// the change touches reviewed content or only the clock.
export function SettingsCard({
  contest,
  report,
  onChanged,
}: {
  contest: ContestDetail['contest']
  report: ReviewReport
  onChanged: () => void
}) {
  const trpc = useTRPC()
  const [values, setValues] = useState<ContestSettingsValues>(() =>
    settingsFromContest(contest)
  )
  const [errors, setErrors] = useState<ContestSettingsErrors>({})

  // The saved settings as a VALUE rather than an identity: `contest` is a new
  // object on every refetch, so resetting the editor whenever it changes
  // would wipe an edit in progress the moment one landed.
  const savedKey = JSON.stringify(settingsFromContest(contest))
  const saved = useMemo(
    () => JSON.parse(savedKey) as ContestSettingsValues,
    [savedKey]
  )
  useEffect(() => setValues(saved), [saved])

  const update = useMutation(
    trpc.org.contests.update.mutationOptions({
      onSuccess: (result) => {
        report(result, 'Settings saved.')
        onChanged()
      },
      onError: (err) =>
        toast.error('Could not save the settings', {
          description: err.message,
        }),
    })
  )

  const dirty = (Object.keys(saved) as (keyof ContestSettingsValues)[]).some(
    (key) => values[key] !== saved[key]
  )
  const isLive = contest.status === 'published'
  const willGoOffline = isLive && reviewedContentChanged(values, contest)

  function save() {
    const result = validateContestSettings(values)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setErrors({})
    update.mutate({ id: contest.id, ...result.input })
  }

  return (
    <section className="border-border/60 bg-background flex shrink-0 flex-col gap-5 rounded-2xl border p-5 md:p-6">
      <div className="flex flex-col gap-1">
        <h2 className="font-heading text-foreground text-base font-bold tracking-tight md:text-lg">
          Settings
        </h2>
        <p className="text-muted-foreground text-sm">
          What voters read, when voting runs, and how a vote is paid for.
        </p>
      </div>

      <ContestSettingsFields
        values={values}
        onChange={setValues}
        errors={errors}
        disabled={update.isPending}
        contentLocked={contest.status === 'closed'}
        idPrefix={`settings-${contest.id}`}
      />

      {dirty ? (
        <div className="flex flex-col gap-3 border-t border-dashed pt-4">
          {isLive ? (
            <p
              className={cn(
                'flex items-start gap-2 text-xs leading-5',
                willGoOffline
                  ? 'text-amber-700 dark:text-amber-300'
                  : 'text-muted-foreground'
              )}
            >
              <HugeiconsIcon
                icon={Alert02Icon}
                className="mt-px size-3.5 shrink-0"
                strokeWidth={1.9}
              />
              {willGoOffline
                ? 'You have changed the name, the description or how voting is paid for. An admin reviews all of that, so saving stops the voting and sends your contest back to the review queue.'
                : 'Only the windows or the time zone have changed, so saving leaves your contest live and taking votes.'}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              disabled={update.isPending}
              onClick={save}
              className="min-w-40"
            >
              {update.isPending
                ? 'Saving…'
                : willGoOffline
                  ? 'Save and send for review'
                  : 'Save settings'}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={update.isPending}
              onClick={() => {
                setValues(saved)
                setErrors({})
              }}
            >
              Reset
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
