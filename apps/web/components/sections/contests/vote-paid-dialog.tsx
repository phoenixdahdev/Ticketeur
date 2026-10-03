'use client'

import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  CheckmarkCircle02Icon,
  Mail01Icon,
  ShieldKeyIcon,
} from '@hugeicons/core-free-icons'

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
import { MAX_VOTES_PER_CAST } from '@/lib/vote-pricing'
import {
  Notice,
  RefusalNotice,
} from '@/components/sections/contests/contest-notice'
import {
  classifyVoteRefusal,
  type VoteRefusal,
} from '@/components/sections/contests/voting-state'
import {
  holdPaidCode,
  paidCodeFor,
  type PaidVoteCode,
} from '@/components/sections/contests/paid-vote-code'
import type { RankedEntry } from '@/components/sections/contests/types'

// Spending bought votes.
//
// No money here, by design: `buyVotes` took the payment and granted a balance
// for the contest, and this only decides where some of that balance goes. So
// there is no price to show, only a count — and the count the server hands
// back after the cast is the one this page then believes, because it came
// from the row it just wrote.
//
// ── Why there is a code step now ──
// A balance hangs on an email and nothing else, so `castPaid` used to let
// anyone who knew an address spend what that address had paid for. It now
// wants the same one-time code free voting wants, and this dialog is the
// free dialog's email → code → done, with the quantity carried through.
//
// ── Why the code is asked for ONCE ──
// `castPaid` verifies the code without consuming it, so one code is good for
// a short spending session (ten minutes and five casts, both enforced in
// `vote_otps`). The session is held by the BALLOT, not by this component, so
// closing this dialog and opening it on the next entry does not throw the
// credential away — see contest-ballot.tsx and paid-vote-code.ts. The second
// and third casts are therefore: pick a number, press the button.
//
// Every refusal is rendered as the words the server sent, through the same
// classifier the other three dialogs use.

type Step = 'amount' | 'code' | 'done'

export function VotePaidDialog({
  contestId,
  entry,
  voterEmail,
  creditsRemaining,
  heldCode,
  open,
  onOpenChange,
  onCast,
  onCodeHeld,
  onStale,
}: {
  contestId: string
  entry: RankedEntry | null
  voterEmail: string
  /** Votes this voter has left, as the page currently believes. */
  creditsRemaining: number
  /** The code this spending session is running on, or null. */
  heldCode: PaidVoteCode | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Landed: hand back the authoritative balance the server returned. */
  onCast: (remaining: number) => void
  /** Keep (or drop) the session credential for the rest of the ballot. */
  onCodeHeld: (held: PaidVoteCode | null) => void
  onStale: () => void
}) {
  const trpc = useTRPC()
  const [step, setStep] = useState<Step>('amount')
  const [quantity, setQuantity] = useState(1)
  const [code, setCode] = useState('')
  const [refusal, setRefusal] = useState<VoteRefusal | null>(null)
  const [sentAt, setSentAt] = useState<{
    expiresAt: Date
    expiresInMinutes: number
    castsPerCode: number
  } | null>(null)
  const [done, setDone] = useState<{
    quantity: number
    remaining: number
  } | null>(null)

  // The credential, only if it is for this address and has not run out.
  const live = paidCodeFor(heldCode, voterEmail)

  // castPaid will spend at most MAX_VOTES_PER_CAST in one go, and never more
  // than the balance. Offering a bigger number would only earn a refusal.
  const ceiling = Math.max(1, Math.min(creditsRemaining, MAX_VOTES_PER_CAST))

  // Reopening for a different entry starts clean — but NOT the held code,
  // which belongs to the session rather than to one entry.
  useEffect(() => {
    if (!open) return
    setStep('amount')
    setQuantity(1)
    setCode('')
    setRefusal(null)
    setDone(null)
  }, [open, entry?.id])

  const requestCode = useMutation(
    trpc.public.voteCheckout.requestCode.mutationOptions({
      onSuccess: (result) => {
        setRefusal(null)
        setSentAt({
          expiresAt: result.expiresAt,
          expiresInMinutes: result.expiresInMinutes,
          castsPerCode: result.castsPerCode,
        })
        setStep('code')
      },
      onError: (error) => {
        const classified = classifyVoteRefusal(error.data?.code, error.message)
        setRefusal(classified)
        if (classified.refetch) onStale()
      },
    })
  )

  const castPaid = useMutation(
    trpc.public.voteCheckout.castPaid.mutationOptions({
      onSuccess: (result, variables) => {
        setRefusal(null)
        // The code survived the cast, so hold it for the next entry. When the
        // voter typed one we were never told the expiry for, holdPaidCode
        // assumes the usual ten minutes — see its comment.
        onCodeHeld(
          holdPaidCode({
            email: voterEmail,
            code: variables.code,
            expiresAt: sentAt?.expiresAt ?? null,
          })
        )
        setDone({
          quantity: result.quantity,
          remaining: result.creditsRemaining,
        })
        setStep('done')
        onCast(result.creditsRemaining)
      },
      onError: (error) => {
        const classified = classifyVoteRefusal(error.data?.code, error.message)
        setRefusal(classified)
        if (classified.refetch) onStale()
        // The balance is not what this page thought. Re-read it with
        // everything else rather than leaving a number on screen that just
        // proved wrong.
        if (classified.kind === 'balance') onStale()
        // A wrong, spent, expired or used-up code cannot be retried — castPaid
        // answers TOO_MANY_REQUESTS only when a code has run out of casts, so
        // both of these mean the session is over. Drop it and send them back
        // for a new one rather than leaving six dead digits on screen.
        if (classified.kind === 'code' || classified.kind === 'rate_limited') {
          onCodeHeld(null)
          setCode('')
          setSentAt(null)
          setStep('amount')
        }
      },
    })
  )

  const busy = requestCode.isPending || castPaid.isPending
  const wanted = Math.min(ceiling, Math.max(1, quantity))
  // The ballot only offers "Use my votes" once it knows an address, so this
  // is belt and braces — but an empty one would be a validation error from
  // the server rather than something the voter could act on.
  const ready = voterEmail !== '' && creditsRemaining > 0

  function cast(value: string) {
    if (!entry) return
    castPaid.mutate({
      contestId,
      entryId: entry.id,
      voterEmail,
      quantity: wanted,
      code: value,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-120">
        <DialogHeader>
          <DialogTitle>
            {done
              ? 'Votes cast'
              : `Vote for ${entry?.displayName ?? 'this entry'}`}
          </DialogTitle>
          <DialogDescription>
            {done
              ? `${done.quantity.toLocaleString('en-US')} ${
                  done.quantity === 1 ? 'vote' : 'votes'
                } added to ${entry?.displayName ?? 'this entry'}.`
              : `You have ${creditsRemaining.toLocaleString('en-US')} ${
                  creditsRemaining === 1 ? 'vote' : 'votes'
                } left to spend in this contest.`}
          </DialogDescription>
        </DialogHeader>

        {refusal ? <RefusalNotice refusal={refusal} /> : null}

        {step === 'amount' ? (
          <form
            className="flex flex-col gap-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault()
              if (!ready) return
              if (live) cast(live.code)
              else requestCode.mutate({ contestId, email: voterEmail })
            }}
          >
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="paid-vote-quantity"
                className="text-foreground text-sm font-medium"
              >
                How many votes
              </label>
              <div className="flex items-center gap-2">
                <Input
                  id="paid-vote-quantity"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={ceiling}
                  step={1}
                  className="w-28"
                  value={quantity}
                  disabled={busy}
                  onChange={(e) => {
                    const parsed = Number.parseInt(e.target.value, 10)
                    setQuantity(
                      Number.isFinite(parsed)
                        ? Math.min(ceiling, Math.max(1, parsed))
                        : 1
                    )
                  }}
                />
                {ceiling > 1 ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => setQuantity(ceiling)}
                  >
                    All {ceiling.toLocaleString('en-US')}
                  </Button>
                ) : null}
              </div>
              <p className="text-muted-foreground text-xs leading-5">
                Spending from the balance held against{' '}
                <span className="text-foreground font-medium">
                  {voterEmail}
                </span>
                .
              </p>
            </div>

            {live ? (
              <Notice tone="info" icon={ShieldKeyIcon}>
                <p>
                  Confirmed as{' '}
                  <span className="font-semibold break-all">{voterEmail}</span>.
                </p>
                <p className="mt-1 text-xs leading-5 opacity-80">
                  You won&apos;t need the code again for the next few minutes —
                  spend the rest of your votes wherever you like.
                </p>
              </Notice>
            ) : (
              <p className="text-muted-foreground text-sm leading-6">
                Your votes are held against your email, so we send a 6-digit
                code to make sure it&apos;s you spending them. One code covers
                the next several votes.
              </p>
            )}

            <Button
              type="submit"
              size="xl"
              className="w-full"
              disabled={busy || !ready}
            >
              {busy ? (
                <>
                  <Spinner />
                  {castPaid.isPending ? 'Casting…' : 'Sending your code…'}
                </>
              ) : live ? (
                `Cast ${wanted.toLocaleString('en-US')} ${
                  wanted === 1 ? 'vote' : 'votes'
                }`
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

            {!live ? (
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-4"
                disabled={busy}
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
              if (code.length === 6) cast(code)
            }}
          >
            <p className="text-muted-foreground text-center text-sm leading-6">
              Enter the 6-digit code we sent to{' '}
              <span className="text-foreground font-medium break-all">
                {voterEmail}
              </span>
              .
              {sentAt
                ? ` It works for ${sentAt.expiresInMinutes} minutes, and covers up to ${sentAt.castsPerCode} casts.`
                : ' It covers the next several votes.'}
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
              disabled={busy || !ready || code.length !== 6}
            >
              {castPaid.isPending ? (
                <>
                  <Spinner />
                  Casting…
                </>
              ) : (
                `Cast ${wanted.toLocaleString('en-US')} ${
                  wanted === 1 ? 'vote' : 'votes'
                }`
              )}
            </Button>

            <button
              type="button"
              className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-4"
              disabled={busy}
              onClick={() => {
                setCode('')
                setRefusal(null)
                setStep('amount')
              }}
            >
              Change how many, or send the code again
            </button>
          </form>
        ) : null}

        {step === 'done' && done ? (
          <div className="flex flex-col gap-4">
            <Notice tone="success" icon={CheckmarkCircle02Icon} role="status">
              <p>
                Counted for{' '}
                <span className="font-semibold">{entry?.displayName}</span>.
              </p>
              <p className="mt-1 text-xs leading-5 opacity-80">
                {done.remaining > 0
                  ? `${done.remaining.toLocaleString('en-US')} ${
                      done.remaining === 1 ? 'vote' : 'votes'
                    } left — spend them on anyone still in the running, no code needed for the next few minutes.`
                  : 'That was your last vote. Buy more to keep going.'}
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
