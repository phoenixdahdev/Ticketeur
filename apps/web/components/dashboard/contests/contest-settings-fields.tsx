'use client'

import { HugeiconsIcon } from '@hugeicons/react'
import { Alert02Icon, LockPasswordIcon } from '@hugeicons/core-free-icons'

import { cn } from '@ticketur/ui/lib/utils'
import { Input } from '@ticketur/ui/components/input'
import { Textarea } from '@ticketur/ui/components/textarea'
import { Switch } from '@ticketur/ui/components/switch'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@ticketur/ui/components/field'
import {
  NativeSelect,
  NativeSelectOption,
} from '@ticketur/ui/components/native-select'

import {
  browserTimeZone,
  formatKobo,
  fromDateTimeInput,
  nairaToKobo,
  TIME_ZONE_CHOICES,
  toDateTimeInput,
  type ContestDetail,
} from '@/lib/org-contests'

// The settings every contest has. `org.contests.create` and
// `org.contests.update` take exactly this set and replace it wholesale, so
// one editor serves both.
//
// Five of these are reviewed content and the rest are operational — the
// server decides, in recordContentChange, and the UI must say which is which
// before the organizer types. The name, the description and the three money
// settings are what an admin judges; the windows, the time zone and the
// order of things are not.

export type ContestSettingsValues = {
  title: string
  description: string
  timeZone: string
  votingOpensAt: string
  votingClosesAt: string
  nominationsOpenAt: string
  nominationsCloseAt: string
  freeVotingEnabled: boolean
  paidVotingEnabled: boolean
  // Naira, as typed. Converted to kobo on save.
  pricePerVote: string
}

export type ContestSettingsErrors = Partial<
  Record<keyof ContestSettingsValues, string>
>

export const emptyContestSettings = (): ContestSettingsValues => ({
  title: '',
  description: '',
  // The organizer's own zone, when we can read it: a contest is almost always
  // run where the organizer is, and getting this wrong moves the moment the
  // daily free vote resets. They can change it, and the server refuses a zone
  // it cannot resolve.
  timeZone: browserTimeZone(),
  votingOpensAt: '',
  votingClosesAt: '',
  nominationsOpenAt: '',
  nominationsCloseAt: '',
  freeVotingEnabled: true,
  paidVotingEnabled: true,
  pricePerVote: '',
})

export function settingsFromContest(
  contest: ContestDetail['contest']
): ContestSettingsValues {
  return {
    title: contest.title,
    description: contest.description,
    timeZone: contest.timeZone,
    votingOpensAt: toDateTimeInput(contest.votingOpensAt),
    votingClosesAt: toDateTimeInput(contest.votingClosesAt),
    nominationsOpenAt: toDateTimeInput(contest.nominationsOpenAt),
    nominationsCloseAt: toDateTimeInput(contest.nominationsCloseAt),
    freeVotingEnabled: contest.freeVotingEnabled,
    paidVotingEnabled: contest.paidVotingEnabled,
    pricePerVote:
      contest.pricePerVoteMinor === 0
        ? ''
        : String(contest.pricePerVoteMinor / 100),
  }
}

/** Which of these the admin reviews, so the editor can warn before saving. */
export function reviewedContentChanged(
  values: ContestSettingsValues,
  contest: ContestDetail['contest']
): boolean {
  return (
    values.title.trim() !== contest.title ||
    values.description.trim() !== contest.description ||
    values.freeVotingEnabled !== contest.freeVotingEnabled ||
    values.paidVotingEnabled !== contest.paidVotingEnabled ||
    (nairaToKobo(values.pricePerVote === '' ? '0' : values.pricePerVote) ??
      -1) !== contest.pricePerVoteMinor
  )
}

export type ContestSettingsInput = {
  title: string
  description: string
  timeZone: string
  votingOpensAt: Date | null
  votingClosesAt: Date | null
  nominationsOpenAt: Date | null
  nominationsCloseAt: Date | null
  freeVotingEnabled: boolean
  paidVotingEnabled: boolean
  pricePerVoteMinor: number
}

const INT4_MAX = 2_147_483_647

// Mirrors the zod shape on org.contests.create / update, so the organizer
// sees the problem in place rather than as a toast from the server. The
// server is still the authority — it also checks the time zone against what
// the runtime can actually resolve.
export function validateContestSettings(
  values: ContestSettingsValues
):
  | { ok: true; input: ContestSettingsInput }
  | { ok: false; errors: ContestSettingsErrors } {
  const errors: ContestSettingsErrors = {}

  const title = values.title.trim()
  if (title.length === 0) errors.title = 'Give your contest a name'
  else if (title.length > 200) {
    errors.title = 'Keep the name under 200 characters'
  }

  const description = values.description.trim()
  if (description.length > 5000) {
    errors.description = 'Keep the description under 5,000 characters'
  }

  if (values.timeZone.trim() === '') {
    errors.timeZone = 'Choose the time zone this contest runs in'
  }

  const votingOpensAt = fromDateTimeInput(values.votingOpensAt)
  if (values.votingOpensAt.trim() && !votingOpensAt) {
    errors.votingOpensAt = 'That is not a valid date and time'
  }
  const votingClosesAt = fromDateTimeInput(values.votingClosesAt)
  if (values.votingClosesAt.trim() && !votingClosesAt) {
    errors.votingClosesAt = 'That is not a valid date and time'
  }
  if (votingOpensAt && votingClosesAt && votingClosesAt <= votingOpensAt) {
    errors.votingClosesAt = 'Voting must close after it opens'
  }

  const nominationsOpenAt = fromDateTimeInput(values.nominationsOpenAt)
  if (values.nominationsOpenAt.trim() && !nominationsOpenAt) {
    errors.nominationsOpenAt = 'That is not a valid date and time'
  }
  const nominationsCloseAt = fromDateTimeInput(values.nominationsCloseAt)
  if (values.nominationsCloseAt.trim() && !nominationsCloseAt) {
    errors.nominationsCloseAt = 'That is not a valid date and time'
  }
  if (
    nominationsOpenAt &&
    nominationsCloseAt &&
    nominationsCloseAt <= nominationsOpenAt
  ) {
    errors.nominationsCloseAt = 'Nominations must close after they open'
  }

  const pricePerVoteMinor = nairaToKobo(
    values.pricePerVote === '' ? '0' : values.pricePerVote
  )
  if (pricePerVoteMinor === null) {
    errors.pricePerVote = 'Enter a price of ₦0 or more'
  } else if (pricePerVoteMinor > INT4_MAX) {
    errors.pricePerVote = 'That price is too large'
  }

  if (!values.freeVotingEnabled && !values.paidVotingEnabled) {
    errors.freeVotingEnabled =
      'Turn on free voting, paid voting or both — nobody can vote otherwise'
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return {
    ok: true,
    input: {
      title,
      description,
      timeZone: values.timeZone.trim(),
      votingOpensAt,
      votingClosesAt,
      nominationsOpenAt,
      nominationsCloseAt,
      freeVotingEnabled: values.freeVotingEnabled,
      paidVotingEnabled: values.paidVotingEnabled,
      pricePerVoteMinor: pricePerVoteMinor ?? 0,
    },
  }
}

export function ContestSettingsFields({
  values,
  onChange,
  errors,
  disabled = false,
  // A closed contest's results page still shows all of this, so the API
  // freezes it until the contest is submitted for review again.
  contentLocked = false,
  idPrefix = 'contest',
}: {
  values: ContestSettingsValues
  onChange: (next: ContestSettingsValues) => void
  errors: ContestSettingsErrors
  disabled?: boolean
  contentLocked?: boolean
  idPrefix?: string
}) {
  const set = <K extends keyof ContestSettingsValues>(
    key: K,
    value: ContestSettingsValues[K]
  ) => onChange({ ...values, [key]: value })

  const id = (name: string) => `${idPrefix}-${name}`

  // The organizer's zone is worth offering even when it is not on the short
  // list — a Nigerian diaspora organizer in Houston is still running a Lagos
  // contest, and seeing their own zone there makes the choice conscious.
  const local = browserTimeZone()
  const zones = Array.from(
    new Set([...TIME_ZONE_CHOICES, local, values.timeZone].filter(Boolean))
  )

  return (
    <div className="flex flex-col gap-5">
      {contentLocked ? (
        <p className="border-border/60 bg-muted/40 text-muted-foreground flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs leading-5">
          <HugeiconsIcon
            icon={LockPasswordIcon}
            className="mt-px size-4 shrink-0"
            strokeWidth={1.8}
          />
          <span>
            This contest is closed but its results page is still public, so
            everything the public can read is frozen. Submit it for review to
            change it.
          </span>
        </p>
      ) : null}

      <ReviewedMarkerLegend />

      <Field data-invalid={errors.title ? true : undefined}>
        <FieldLabel htmlFor={id('title')} className="text-sm font-semibold">
          Contest name <ReviewedMarker />
        </FieldLabel>
        <Input
          id={id('title')}
          value={values.title}
          maxLength={200}
          disabled={disabled || contentLocked}
          onChange={(e) => set('title', e.target.value)}
          placeholder="e.g. Face of Lagos 2026"
          aria-invalid={Boolean(errors.title)}
        />
        <FieldDescription>
          Voters read this at the top of the page.
        </FieldDescription>
        <FieldError
          errors={[errors.title ? { message: errors.title } : undefined]}
        />
      </Field>

      <Field data-invalid={errors.description ? true : undefined}>
        <FieldLabel
          htmlFor={id('description')}
          className="text-sm font-semibold"
        >
          Description <ReviewedMarker />
        </FieldLabel>
        <Textarea
          id={id('description')}
          rows={4}
          maxLength={5000}
          disabled={disabled || contentLocked}
          value={values.description}
          onChange={(e) => set('description', e.target.value)}
          placeholder="What this contest is, who is in it, and how the winner is decided."
          aria-invalid={Boolean(errors.description)}
        />
        <FieldDescription>
          {values.description.trim().length.toLocaleString('en-NG')} / 5,000
          characters.
        </FieldDescription>
        <FieldError
          errors={[
            errors.description ? { message: errors.description } : undefined,
          ]}
        />
      </Field>

      <Field data-invalid={errors.timeZone ? true : undefined}>
        <FieldLabel htmlFor={id('timeZone')} className="text-sm font-semibold">
          Time zone
        </FieldLabel>
        <NativeSelect
          id={id('timeZone')}
          className="w-full"
          value={values.timeZone}
          disabled={disabled}
          onChange={(e) => set('timeZone', e.target.value)}
          aria-invalid={Boolean(errors.timeZone)}
        >
          {zones.map((zone) => (
            <NativeSelectOption key={zone} value={zone}>
              {zone === local ? `${zone} (yours)` : zone}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <FieldDescription>
          This decides when each day rolls over for the free daily vote. A Lagos
          contest resets at midnight in Lagos.
        </FieldDescription>
        <FieldError
          errors={[errors.timeZone ? { message: errors.timeZone } : undefined]}
        />
      </Field>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Field data-invalid={errors.votingOpensAt ? true : undefined}>
          <FieldLabel
            htmlFor={id('votingOpensAt')}
            className="text-sm font-semibold"
          >
            Voting opens
          </FieldLabel>
          <Input
            id={id('votingOpensAt')}
            type="datetime-local"
            value={values.votingOpensAt}
            disabled={disabled}
            onChange={(e) => set('votingOpensAt', e.target.value)}
            aria-invalid={Boolean(errors.votingOpensAt)}
          />
          <FieldDescription>
            Leave empty to open as soon as an admin approves it.
          </FieldDescription>
          <FieldError
            errors={[
              errors.votingOpensAt
                ? { message: errors.votingOpensAt }
                : undefined,
            ]}
          />
        </Field>

        <Field data-invalid={errors.votingClosesAt ? true : undefined}>
          <FieldLabel
            htmlFor={id('votingClosesAt')}
            className="text-sm font-semibold"
          >
            Voting closes
          </FieldLabel>
          <Input
            id={id('votingClosesAt')}
            type="datetime-local"
            value={values.votingClosesAt}
            disabled={disabled}
            onChange={(e) => set('votingClosesAt', e.target.value)}
            aria-invalid={Boolean(errors.votingClosesAt)}
          />
          <FieldDescription>
            Leave empty to stay open until you close it.
          </FieldDescription>
          <FieldError
            errors={[
              errors.votingClosesAt
                ? { message: errors.votingClosesAt }
                : undefined,
            ]}
          />
        </Field>

        <Field data-invalid={errors.nominationsOpenAt ? true : undefined}>
          <FieldLabel
            htmlFor={id('nominationsOpenAt')}
            className="text-sm font-semibold"
          >
            Nominations open
          </FieldLabel>
          <Input
            id={id('nominationsOpenAt')}
            type="datetime-local"
            value={values.nominationsOpenAt}
            disabled={disabled}
            onChange={(e) => set('nominationsOpenAt', e.target.value)}
            aria-invalid={Boolean(errors.nominationsOpenAt)}
          />
          <FieldDescription>
            Optional. Leave both nomination fields empty if you are adding the
            entries yourself.
          </FieldDescription>
          <FieldError
            errors={[
              errors.nominationsOpenAt
                ? { message: errors.nominationsOpenAt }
                : undefined,
            ]}
          />
        </Field>

        <Field data-invalid={errors.nominationsCloseAt ? true : undefined}>
          <FieldLabel
            htmlFor={id('nominationsCloseAt')}
            className="text-sm font-semibold"
          >
            Nominations close
          </FieldLabel>
          <Input
            id={id('nominationsCloseAt')}
            type="datetime-local"
            value={values.nominationsCloseAt}
            disabled={disabled}
            onChange={(e) => set('nominationsCloseAt', e.target.value)}
            aria-invalid={Boolean(errors.nominationsCloseAt)}
          />
          <FieldError
            errors={[
              errors.nominationsCloseAt
                ? { message: errors.nominationsCloseAt }
                : undefined,
            ]}
          />
        </Field>
      </div>

      <fieldset className="border-border/60 flex flex-col gap-4 rounded-xl border p-4">
        <legend className="text-foreground px-1 text-sm font-semibold">
          How people vote <ReviewedMarker />
        </legend>

        <ToggleRow
          id={id('freeVotingEnabled')}
          checked={values.freeVotingEnabled}
          disabled={disabled || contentLocked}
          onChange={(next) => set('freeVotingEnabled', next)}
          label="Free voting"
          hint="A verified email gets one free vote per category, each day, in this contest's own time zone."
        />
        <ToggleRow
          id={id('paidVotingEnabled')}
          checked={values.paidVotingEnabled}
          disabled={disabled || contentLocked}
          onChange={(next) => set('paidVotingEnabled', next)}
          label="Paid voting"
          hint="Anyone can buy votes — in bundles, or loose at the price below."
        />
        {errors.freeVotingEnabled ? (
          <p className="text-destructive text-xs font-medium">
            {errors.freeVotingEnabled}
          </p>
        ) : null}

        {values.paidVotingEnabled ? (
          <Field data-invalid={errors.pricePerVote ? true : undefined}>
            <FieldLabel
              htmlFor={id('pricePerVote')}
              className="text-sm font-semibold"
            >
              Price per loose vote (₦)
            </FieldLabel>
            <Input
              id={id('pricePerVote')}
              type="number"
              inputMode="decimal"
              min={0}
              step={50}
              className="sm:max-w-48"
              value={values.pricePerVote}
              disabled={disabled || contentLocked}
              onChange={(e) => set('pricePerVote', e.target.value)}
              placeholder="0"
              aria-invalid={Boolean(errors.pricePerVote)}
            />
            <FieldDescription>
              {values.pricePerVote === '' || values.pricePerVote === '0'
                ? 'Leave this at ₦0 to sell votes in bundles only.'
                : `Buying 10 votes costs ${formatKobo(
                    (nairaToKobo(values.pricePerVote) ?? 0) * 10
                  )}, plus the platform fee shown to the voter.`}
            </FieldDescription>
            <FieldError
              errors={[
                errors.pricePerVote
                  ? { message: errors.pricePerVote }
                  : undefined,
              ]}
            />
          </Field>
        ) : null}
      </fieldset>
    </div>
  )
}

function ToggleRow({
  id,
  checked,
  disabled,
  onChange,
  label,
  hint,
}: {
  id: string
  checked: boolean
  disabled: boolean
  onChange: (next: boolean) => void
  label: string
  hint: string
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        <label htmlFor={id} className="text-foreground text-sm font-medium">
          {label}
        </label>
        <p className="text-muted-foreground text-xs leading-5">{hint}</p>
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        className="mt-0.5 shrink-0"
      />
    </div>
  )
}

// A quiet dot beside the settings an admin reviews, explained once above.
export function ReviewedMarker({ className }: { className?: string }) {
  return (
    <span
      title="Reviewed by an admin — changing this on a live contest stops the voting until it is approved again"
      className={cn(
        'ml-1 inline-flex items-center gap-1 align-middle text-[10px] font-bold tracking-wider text-amber-600 uppercase dark:text-amber-400',
        className
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      Reviewed
    </span>
  )
}

export function ReviewedMarkerLegend() {
  return (
    <p className="text-muted-foreground flex items-start gap-2 text-xs leading-5">
      <HugeiconsIcon
        icon={Alert02Icon}
        className="mt-px size-3.5 shrink-0"
        strokeWidth={1.9}
      />
      <span>
        Settings marked <ReviewedMarker /> are part of what an admin approves.
        Changing one on a live contest sends it back for review and stops the
        voting. The rest — the windows and the time zone — can be changed at any
        time without interrupting anything.
      </span>
    </p>
  )
}
