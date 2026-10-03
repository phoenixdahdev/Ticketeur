'use client'

import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { CheckmarkCircle02Icon, Mail01Icon } from '@hugeicons/core-free-icons'

import {
  MAX_NOMINATION_REASON,
  MAX_NOMINEE_NAME,
  MAX_PHONE,
} from '@ticketur/api/lib/nominations'
import { Button } from '@ticketur/ui/components/button'
import { Input } from '@ticketur/ui/components/input'
import { Label } from '@ticketur/ui/components/label'
import { Spinner } from '@ticketur/ui/components/spinner'
import { Textarea } from '@ticketur/ui/components/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@ticketur/ui/components/dialog'
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from '@ticketur/ui/components/input-otp'
import {
  NativeSelect,
  NativeSelectOption,
} from '@ticketur/ui/components/native-select'

import { useTRPC } from '@/lib/trpc'
import {
  Notice,
  RefusalNotice,
} from '@/components/sections/contests/contest-notice'
import {
  classifyVoteRefusal,
  type VoteRefusal,
} from '@/components/sections/contests/voting-state'
import type { ContestCategory } from '@/components/sections/contests/types'
import {
  looksLikeEmail,
  normalizeEmail,
} from '@/components/sections/contests/voter-identity'

// Putting a name forward.
//
// Three steps, because the middle one is not optional: the nominator's
// address is verified by a one-time code before anything is stored. The
// server's reason for that is in packages/api/src/routers/public/
// nominations.ts — the only duplicate rule the schema has keys on that
// address, so an unproved one makes it decorative. The copy here says the
// honest version: it is how we keep one person from filling the list.
//
// The refusals are rendered as the words the server sent, through the same
// classifier the vote dialogs use — the shapes are identical (a conflict, a
// rate limit, a dead code, a closed window), so a second table of sentences
// would only be the first one drifting.

type Step = 'details' | 'code' | 'done'

type Draft = {
  categoryId: string
  nomineeName: string
  nomineeEmail: string
  nomineePhone: string
  reason: string
  email: string
}

function emptyDraft(categoryId: string, email: string): Draft {
  return {
    categoryId,
    nomineeName: '',
    nomineeEmail: '',
    nomineePhone: '',
    reason: '',
    email,
  }
}

export function NominateDialog({
  contestId,
  categories,
  defaultCategoryId,
  defaultEmail,
  open,
  onOpenChange,
  onNominated,
  onStale,
  onEmailUsed,
}: {
  contestId: string
  categories: ContestCategory[]
  defaultCategoryId: string | null
  defaultEmail: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** A nomination landed. */
  onNominated: () => void
  /** The server says the page is stale — re-read it. */
  onStale: () => void
  /** Remember the address this person is known by on this contest. */
  onEmailUsed: (email: string) => void
}) {
  const trpc = useTRPC()
  const firstCategory = defaultCategoryId ?? categories[0]?.id ?? ''

  const [step, setStep] = useState<Step>('details')
  const [draft, setDraft] = useState<Draft>(() =>
    emptyDraft(firstCategory, defaultEmail)
  )
  const [code, setCode] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<VoteRefusal | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [expiresInMinutes, setExpiresInMinutes] = useState<number | null>(null)
  const [nominated, setNominated] = useState<string | null>(null)

  // Reopening must not show the last nomination's refusal, and must not keep
  // a code that has already been spent.
  useEffect(() => {
    if (!open) return
    setStep('details')
    setCode('')
    setFieldError(null)
    setRefusal(null)
    setDraft(emptyDraft(firstCategory, defaultEmail))
  }, [open, firstCategory, defaultEmail])

  const requestCode = useMutation(
    trpc.public.nominations.requestCode.mutationOptions({
      onSuccess: (result) => {
        setRefusal(null)
        setSentTo(normalizeEmail(draft.email))
        setExpiresInMinutes(result.expiresInMinutes)
        setStep('code')
      },
      onError: (error) => {
        const classified = classifyVoteRefusal(error.data?.code, error.message)
        setRefusal(classified)
        if (classified.refetch) onStale()
      },
    })
  )

  const nominate = useMutation(
    trpc.public.nominations.nominate.mutationOptions({
      onSuccess: (result) => {
        setRefusal(null)
        setNominated(result.nomineeName)
        setStep('done')
        onEmailUsed(normalizeEmail(draft.email))
        onNominated()
      },
      onError: (error) => {
        const classified = classifyVoteRefusal(error.data?.code, error.message)
        setRefusal(classified)
        // A spent, wrong or expired code has to be replaced, so send them
        // back for a new one rather than leaving six dead digits on screen.
        if (classified.kind === 'code') {
          setCode('')
          setStep('details')
        }
        if (classified.refetch) onStale()
      },
    })
  )

  const busy = requestCode.isPending || nominate.isPending

  function send() {
    setFieldError(null)
    if (draft.categoryId === '') {
      setFieldError('Pick the category you are nominating for.')
      return
    }
    if (draft.nomineeName.trim() === '') {
      setFieldError('Who are you nominating?')
      return
    }
    if (
      draft.nomineeEmail.trim() !== '' &&
      !looksLikeEmail(draft.nomineeEmail)
    ) {
      setFieldError("That doesn't look like the nominee's email address.")
      return
    }
    if (!looksLikeEmail(draft.email)) {
      setFieldError('Enter the email address you want your code sent to.')
      return
    }
    requestCode.mutate({
      contestId,
      email: normalizeEmail(draft.email),
    })
  }

  function submit(value: string) {
    nominate.mutate({
      contestId,
      categoryId: draft.categoryId,
      nomineeName: draft.nomineeName.trim(),
      nomineeEmail: draft.nomineeEmail.trim() || null,
      nomineePhone: draft.nomineePhone.trim() || null,
      reason: draft.reason.trim(),
      email: normalizeEmail(draft.email),
      code: value,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-140">
        <DialogHeader>
          <DialogTitle>
            {step === 'done' ? 'Nomination received' : 'Nominate someone'}
          </DialogTitle>
          <DialogDescription>
            {step === 'done'
              ? 'The organizer decides which names go on the ballot.'
              : 'Tell the organizer who should be on the ballot. We email you a code first, so one person cannot put the same list forward over and over.'}
          </DialogDescription>
        </DialogHeader>

        {refusal ? <RefusalNotice refusal={refusal} /> : null}

        {step === 'details' ? (
          <form
            className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto"
            noValidate
            onSubmit={(e) => {
              e.preventDefault()
              send()
            }}
          >
            {categories.length > 1 ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="nominate-category">Category</Label>
                <NativeSelect
                  id="nominate-category"
                  value={draft.categoryId}
                  disabled={busy}
                  onChange={(e) =>
                    setDraft({ ...draft, categoryId: e.target.value })
                  }
                >
                  {categories.map((category) => (
                    <NativeSelectOption key={category.id} value={category.id}>
                      {category.title}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
            ) : null}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nominate-name">Who are you nominating?</Label>
              <Input
                id="nominate-name"
                value={draft.nomineeName}
                maxLength={MAX_NOMINEE_NAME}
                placeholder="Their full name"
                disabled={busy}
                onChange={(e) => {
                  setDraft({ ...draft, nomineeName: e.target.value })
                  setFieldError(null)
                }}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nominate-reason">Why them?</Label>
              <Textarea
                id="nominate-reason"
                rows={3}
                maxLength={MAX_NOMINATION_REASON}
                value={draft.reason}
                placeholder="Optional. The organizer reads this; it does not go on the ballot."
                disabled={busy}
                onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="nominate-nominee-email">
                  Their email{' '}
                  <span className="text-muted-foreground font-normal">
                    (optional)
                  </span>
                </Label>
                <Input
                  id="nominate-nominee-email"
                  type="email"
                  inputMode="email"
                  value={draft.nomineeEmail}
                  placeholder="So the organizer can reach them"
                  disabled={busy}
                  onChange={(e) => {
                    setDraft({ ...draft, nomineeEmail: e.target.value })
                    setFieldError(null)
                  }}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="nominate-nominee-phone">
                  Their phone{' '}
                  <span className="text-muted-foreground font-normal">
                    (optional)
                  </span>
                </Label>
                <Input
                  id="nominate-nominee-phone"
                  type="tel"
                  inputMode="tel"
                  maxLength={MAX_PHONE}
                  value={draft.nomineePhone}
                  disabled={busy}
                  onChange={(e) =>
                    setDraft({ ...draft, nomineePhone: e.target.value })
                  }
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nominate-email">Your email</Label>
              <Input
                id="nominate-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={draft.email}
                disabled={busy}
                onChange={(e) => {
                  setDraft({ ...draft, email: e.target.value })
                  setFieldError(null)
                }}
              />
              <p className="text-muted-foreground text-xs leading-5">
                Only the organizer sees it. It is never shown on the contest
                page, and it is what stops the same person nominating the same
                name twice.
              </p>
            </div>

            {fieldError ? (
              <p role="alert" className="text-destructive text-sm">
                {fieldError}
              </p>
            ) : null}

            <Button type="submit" size="xl" className="w-full" disabled={busy}>
              {requestCode.isPending ? (
                <>
                  <Spinner />
                  Sending your code…
                </>
              ) : (
                <>
                  <HugeiconsIcon
                    icon={Mail01Icon}
                    className="size-4"
                    strokeWidth={2}
                  />
                  Email me a code
                </>
              )}
            </Button>

            {sentTo ? (
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-4"
                onClick={() => {
                  setRefusal(null)
                  setStep('code')
                }}
              >
                I already have a code
              </button>
            ) : null}
          </form>
        ) : null}

        {step === 'code' ? (
          <form
            className="flex flex-col items-center gap-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault()
              if (code.length === 6) submit(code)
            }}
          >
            <p className="text-muted-foreground text-center text-sm leading-6">
              Enter the 6-digit code we sent to{' '}
              <span className="text-foreground font-medium">
                {sentTo ?? normalizeEmail(draft.email)}
              </span>
              .
              {expiresInMinutes
                ? ` It works for ${expiresInMinutes} minutes, and for this one nomination only.`
                : ' It works for this one nomination only.'}
            </p>

            <InputOTP
              maxLength={6}
              value={code}
              disabled={busy}
              onChange={(value) => {
                setCode(value)
                setRefusal(null)
                if (value.length === 6) submit(value)
              }}
            >
              <InputOTPGroup>
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <InputOTPSlot key={i} index={i} className="size-11 text-lg" />
                ))}
              </InputOTPGroup>
            </InputOTP>

            <Button
              type="submit"
              size="xl"
              className="w-full"
              disabled={busy || code.length !== 6}
            >
              {nominate.isPending ? (
                <>
                  <Spinner />
                  Sending your nomination…
                </>
              ) : (
                `Nominate ${draft.nomineeName.trim() || 'them'}`
              )}
            </Button>

            <button
              type="button"
              className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-4"
              disabled={busy}
              onClick={() => {
                setCode('')
                setRefusal(null)
                setStep('details')
              }}
            >
              Go back, or send the code again
            </button>
          </form>
        ) : null}

        {step === 'done' ? (
          <div className="flex flex-col gap-4">
            <Notice tone="success" icon={CheckmarkCircle02Icon} role="status">
              <p>
                Thanks — <span className="font-semibold">{nominated}</span> has
                been put forward.
              </p>
              <p className="mt-1 text-xs leading-5 opacity-80">
                Nothing is public yet. The organizer reads every nomination and
                decides who goes on the ballot; voting opens after that. To
                nominate somebody else, ask for a new code — each one is good
                for one nomination.
              </p>
            </Notice>
            <Button
              type="button"
              size="xl"
              className="w-full"
              onClick={() => onOpenChange(false)}
            >
              Back to the contest
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
