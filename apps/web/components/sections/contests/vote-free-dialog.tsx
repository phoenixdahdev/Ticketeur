'use client'

import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { CheckmarkCircle02Icon, Mail01Icon } from '@hugeicons/core-free-icons'

import { Button } from '@ticketur/ui/components/button'
import { Input } from '@ticketur/ui/components/input'
import { Spinner } from '@ticketur/ui/components/spinner'
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

import { useTRPC } from '@/lib/trpc'
import {
  Notice,
  RefusalNotice,
} from '@/components/sections/contests/contest-notice'
import {
  classifyVoteRefusal,
  DAILY_RESET_HINT,
  type VoteRefusal,
} from '@/components/sections/contests/voting-state'
import type { RankedEntry } from '@/components/sections/contests/types'
import {
  looksLikeEmail,
  normalizeEmail,
} from '@/components/sections/contests/voter-identity'

// Free voting: one vote per email, per category, per day.
//
// Two steps because that is what the API is: `requestCode` mails a one-time
// code, `castFree` takes the code and the entry. The code is single use, so a
// voter wanting to vote in several categories needs one per category — the
// copy says so rather than letting them discover it.
//
// Every refusal this can meet is rendered as the words the server sent, and
// the common one — "you've already used your free vote for this category
// today" — is deliberately not styled as an error. See classifyVoteRefusal.

type Step = 'email' | 'code' | 'done'

export function VoteFreeDialog({
  contestId,
  entry,
  categoryTitle,
  defaultEmail,
  open,
  onOpenChange,
  onVoted,
  onStale,
  onEmailUsed,
}: {
  contestId: string
  entry: RankedEntry | null
  categoryTitle: string | null
  defaultEmail: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** A vote landed: the counts on the page are now out of date. */
  onVoted: () => void
  /** The server says the page is stale — re-read it. */
  onStale: () => void
  /** Remember the address this voter is known by. */
  onEmailUsed: (email: string) => void
}) {
  const trpc = useTRPC()
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState(defaultEmail)
  const [code, setCode] = useState('')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<VoteRefusal | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [expiresInMinutes, setExpiresInMinutes] = useState<number | null>(null)

  // Reopening for a different entry must not show the last entry's refusal,
  // and must not keep a code that has already been spent.
  useEffect(() => {
    if (!open) return
    setStep('email')
    setCode('')
    setEmailError(null)
    setRefusal(null)
    setEmail(defaultEmail)
  }, [open, entry?.id, defaultEmail])

  const requestCode = useMutation(
    trpc.public.voteFree.requestCode.mutationOptions({
      onSuccess: (result) => {
        setRefusal(null)
        setSentTo(normalizeEmail(email))
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

  const castFree = useMutation(
    trpc.public.voteFree.castFree.mutationOptions({
      onSuccess: () => {
        setRefusal(null)
        setStep('done')
        onEmailUsed(normalizeEmail(email))
        onVoted()
      },
      onError: (error) => {
        const classified = classifyVoteRefusal(error.data?.code, error.message)
        setRefusal(classified)
        // A spent, wrong or expired code has to be replaced, so send them
        // back for a new one rather than leaving six dead digits on screen.
        if (classified.kind === 'code') {
          setCode('')
          setStep('email')
        }
        if (classified.refetch) onStale()
      },
    })
  )

  const busy = requestCode.isPending || castFree.isPending

  function send() {
    setEmailError(null)
    if (!looksLikeEmail(email)) {
      setEmailError('Enter the email address you want your code sent to.')
      return
    }
    requestCode.mutate({ contestId, email: normalizeEmail(email) })
  }

  function cast(value: string) {
    if (!entry) return
    castFree.mutate({
      contestId,
      entryId: entry.id,
      email: normalizeEmail(email),
      code: value,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-130">
        <DialogHeader>
          <DialogTitle>
            {step === 'done'
              ? 'Your vote is in'
              : `Vote for ${entry?.displayName ?? 'this entry'}`}
          </DialogTitle>
          <DialogDescription>
            {step === 'done'
              ? `Counted for ${entry?.displayName ?? 'this entry'}${
                  categoryTitle ? ` in ${categoryTitle}` : ''
                }.`
              : 'Free voting is one vote per category per day. We email a code to make sure each address votes once.'}
          </DialogDescription>
        </DialogHeader>

        {refusal ? <RefusalNotice refusal={refusal} /> : null}

        {step === 'email' ? (
          <form
            className="flex flex-col gap-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault()
              send()
            }}
          >
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="free-vote-email"
                className="text-foreground text-sm font-medium"
              >
                Your email
              </label>
              <Input
                id="free-vote-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                aria-invalid={emailError !== null}
                disabled={busy}
                onChange={(e) => {
                  setEmail(e.target.value)
                  setEmailError(null)
                }}
              />
              {emailError ? (
                <p role="alert" className="text-destructive text-sm">
                  {emailError}
                </p>
              ) : null}
            </div>

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

            <p className="text-muted-foreground text-xs leading-5">
              {DAILY_RESET_HINT}
            </p>
          </form>
        ) : null}

        {step === 'code' ? (
          <form
            className="flex flex-col items-center gap-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault()
              if (code.length === 6) cast(code)
            }}
          >
            <p className="text-muted-foreground text-center text-sm leading-6">
              Enter the 6-digit code we sent to{' '}
              <span className="text-foreground font-medium">
                {sentTo ?? normalizeEmail(email)}
              </span>
              .
              {expiresInMinutes
                ? ` It works for ${expiresInMinutes} minutes, and for this one vote only.`
                : ' It works for this one vote only.'}
            </p>

            <InputOTP
              maxLength={6}
              value={code}
              disabled={busy}
              onChange={(value) => {
                setCode(value)
                setRefusal(null)
                if (value.length === 6) cast(value)
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
              {castFree.isPending ? (
                <>
                  <Spinner />
                  Casting your vote…
                </>
              ) : (
                'Cast my free vote'
              )}
            </Button>

            <button
              type="button"
              className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-4"
              disabled={busy}
              onClick={() => {
                setCode('')
                setRefusal(null)
                setStep('email')
              }}
            >
              Send the code again, or use a different email
            </button>
          </form>
        ) : null}

        {step === 'done' ? (
          <div className="flex flex-col gap-4">
            <Notice tone="success" icon={CheckmarkCircle02Icon} role="status">
              <p>
                Thanks — your free vote for{' '}
                <span className="font-semibold">{entry?.displayName}</span> has
                been counted.
              </p>
              <p className="mt-1 text-xs leading-5 opacity-80">
                {DAILY_RESET_HINT} To vote in another category now, ask for a
                new code there — each code is good for one vote.
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
