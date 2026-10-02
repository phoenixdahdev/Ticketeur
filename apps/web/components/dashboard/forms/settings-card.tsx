'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import { Alert02Icon } from '@hugeicons/core-free-icons'

import { cn } from '@ticketur/ui/lib/utils'
import { Button } from '@ticketur/ui/components/button'

import { useTRPC } from '@/lib/trpc'
import type { FormDetail } from '@/lib/org-forms'
import type { ReviewReport } from '@/components/dashboard/forms/fields-editor'
import {
  SettingsFields,
  settingsFromForm,
  validateSettings,
  wordingChanged,
  type SettingsErrors,
  type SettingsValues,
} from '@/components/dashboard/forms/form-settings-fields'

// `org.forms.update` replaces the whole settings set in one call, so this card
// sends every value every time — and works out, before it does, whether the
// change touches the two reviewed values (the name and the description) or
// only the operational ones.
export function SettingsCard({
  form,
  report,
  onChanged,
}: {
  form: FormDetail['form']
  report: ReviewReport
  onChanged: () => void
}) {
  const trpc = useTRPC()
  const [values, setValues] = useState<SettingsValues>(() =>
    settingsFromForm(form)
  )
  const [errors, setErrors] = useState<SettingsErrors>({})

  // The saved settings, as a value rather than an identity: `form` is a new
  // object on every refetch, so resetting the editor whenever it changes
  // would wipe an edit in progress the moment one landed.
  const savedKey = JSON.stringify(settingsFromForm(form))
  const saved = useMemo(
    () => JSON.parse(savedKey) as SettingsValues,
    [savedKey]
  )
  useEffect(() => setValues(saved), [saved])

  const update = useMutation(
    trpc.org.forms.update.mutationOptions({
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

  const dirty = (Object.keys(saved) as (keyof SettingsValues)[]).some(
    (key) => values[key] !== saved[key]
  )
  const isLive = form.status === 'published'
  const willGoOffline = isLive && wordingChanged(values, form)

  function save() {
    const result = validateSettings(values)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setErrors({})
    update.mutate({ id: form.id, ...result.input })
  }

  return (
    <section className="border-border/60 bg-background flex shrink-0 flex-col gap-5 rounded-2xl border p-5 md:p-6">
      <div className="flex flex-col gap-1">
        <h2 className="font-heading text-foreground text-base font-bold tracking-tight md:text-lg">
          Settings
        </h2>
        <p className="text-muted-foreground text-sm">
          The name and description applicants read, and when the form takes
          applications.
        </p>
      </div>

      <SettingsFields
        values={values}
        onChange={setValues}
        errors={errors}
        disabled={update.isPending}
        wordingLocked={form.status === 'closed'}
        idPrefix={`settings-${form.id}`}
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
                ? 'You have changed the name or the description. Both are reviewed by an admin, so saving takes your form offline and sends it back to the review queue.'
                : 'Only operational settings have changed — dates, spots, approval mode or the form type — so saving leaves your form live.'}
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
