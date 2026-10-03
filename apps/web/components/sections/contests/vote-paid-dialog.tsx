'use client'

import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { CheckmarkCircle02Icon } from '@hugeicons/core-free-icons'

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
import type { RankedEntry } from '@/components/sections/contests/types'

// Spending bought votes.
//
// No money here, by design: `buyVotes` took the payment and granted a balance
// for the contest, and this only decides where some of that balance goes. So
// there is no price to show, only a count — and the count the server hands
// back after the cast is the one this page then believes, because it came
// from the row it just wrote.

export function VotePaidDialog({
  contestId,
  entry,
  voterEmail,
  creditsRemaining,
  open,
  onOpenChange,
  onCast,
  onStale,
}: {
  contestId: string
  entry: RankedEntry | null
  voterEmail: string
  /** Votes this voter has left, as the page currently believes. */
  creditsRemaining: number
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Landed: hand back the authoritative balance the server returned. */
  onCast: (remaining: number) => void
  onStale: () => void
}) {
  const trpc = useTRPC()
  const [quantity, setQuantity] = useState(1)
  const [refusal, setRefusal] = useState<VoteRefusal | null>(null)
  const [done, setDone] = useState<{
    quantity: number
    remaining: number
  } | null>(null)

  // castPaid will spend at most MAX_VOTES_PER_CAST in one go, and never more
  // than the balance. Offering a bigger number would only earn a refusal.
  const ceiling = Math.max(1, Math.min(creditsRemaining, MAX_VOTES_PER_CAST))

  useEffect(() => {
    if (!open) return
    setQuantity(1)
    setRefusal(null)
    setDone(null)
  }, [open, entry?.id])

  const castPaid = useMutation(
    trpc.public.voteCheckout.castPaid.mutationOptions({
      onSuccess: (result) => {
        setRefusal(null)
        setDone({
          quantity: result.quantity,
          remaining: result.creditsRemaining,
        })
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
      },
    })
  )

  const busy = castPaid.isPending

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

        {done ? (
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
                    } left — spend them on anyone still in the running.`
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
        ) : (
          <form
            className="flex flex-col gap-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault()
              if (!entry) return
              castPaid.mutate({
                contestId,
                entryId: entry.id,
                voterEmail,
                quantity: Math.min(ceiling, Math.max(1, quantity)),
              })
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

            <Button
              type="submit"
              size="xl"
              className="w-full"
              disabled={busy || creditsRemaining <= 0}
            >
              {busy ? (
                <>
                  <Spinner />
                  Casting…
                </>
              ) : (
                `Cast ${quantity.toLocaleString('en-US')} ${
                  quantity === 1 ? 'vote' : 'votes'
                }`
              )}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
