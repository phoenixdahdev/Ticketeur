'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { Alert02Icon, Tick02Icon } from '@hugeicons/core-free-icons'

import { cn } from '@ticketur/ui/lib/utils'
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
import { formatNaira } from '@/lib/event-display'
import {
  MAX_LOOSE_VOTES_PER_ORDER,
  priceVotePurchase,
  votePurchaseProblem,
  type VotePriceBreakdown,
  type VotePurchaseChoice,
} from '@/lib/vote-pricing'
import {
  Notice,
  RefusalNotice,
} from '@/components/sections/contests/contest-notice'
import {
  classifyVoteRefusal,
  type VoteRefusal,
} from '@/components/sections/contests/voting-state'
import type {
  ContestSummary,
  VoteBundle,
} from '@/components/sections/contests/types'
import {
  looksLikeEmail,
  normalizeEmail,
} from '@/components/sections/contests/voter-identity'

// Buying votes.
//
// ── The voter bears the service fee and sees it ──
// Subtotal, service fee and total are three separate lines before the button
// that takes their money, exactly as ticket checkout and registration do. The
// arithmetic is priceVotePurchase (lib/vote-pricing.ts), which mirrors
// buyVotes line for line and applies the fee with the very function the
// server charges with, at the rate bySlug shipped alongside these bundles.
//
// ── And the two are checked against each other ──
// A preview can still be stale: an admin can change the vote rate, or an
// organizer can re-price a bundle, while this dialog is open. buyVotes
// returns the order's OWN subtotal, fee and total — the figures it just
// wrote and will charge — so this compares them against what was on screen
// and refuses to navigate when they differ, showing the real total and
// letting the voter decide. The voter is never sent to pay an amount they
// were not shown.
//
// Nothing is granted here: fulfilment grants the credits when Flutterwave
// confirms the charge, and the voter picks entries afterwards.

type Selection =
  { kind: 'bundle'; bundleId: string } | { kind: 'loose'; votes: number }

/** What buyVotes quoted when it disagreed with the preview. */
type Requote = {
  quoted: VotePriceBreakdown
  paymentUrl: string
}

export function VoteBuyDialog({
  contest,
  bundles,
  serviceFeeBps,
  defaultEmail,
  defaultName,
  open,
  onOpenChange,
  onStale,
  onEmailUsed,
}: {
  contest: ContestSummary
  bundles: VoteBundle[]
  /** Basis points, from the same bySlug read that priced the bundles. */
  serviceFeeBps: number
  defaultEmail: string
  defaultName: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onStale: () => void
  onEmailUsed: (email: string) => void
}) {
  const trpc = useTRPC()
  const sellsLoose = contest.pricePerVoteMinor > 0

  const [selection, setSelection] = useState<Selection>(() =>
    bundles[0]
      ? { kind: 'bundle', bundleId: bundles[0].id }
      : { kind: 'loose', votes: 1 }
  )
  const [name, setName] = useState(defaultName)
  const [email, setEmail] = useState(defaultEmail)
  const [errors, setErrors] = useState<{ name?: string; email?: string }>({})
  const [refusal, setRefusal] = useState<VoteRefusal | null>(null)
  const [requote, setRequote] = useState<Requote | null>(null)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setErrors({})
    setRefusal(null)
    setRequote(null)
    setLeaving(false)
    setEmail(defaultEmail)
    setName(defaultName)
  }, [open, defaultEmail, defaultName])

  const selectedBundle =
    selection.kind === 'bundle'
      ? (bundles.find((b) => b.id === selection.bundleId) ?? null)
      : null

  const choice: VotePurchaseChoice | null = useMemo(() => {
    if (selection.kind === 'bundle') {
      if (!selectedBundle) return null
      return {
        kind: 'bundle',
        bundleId: selectedBundle.id,
        votes: selectedBundle.votes,
        priceMinor: selectedBundle.priceMinor,
      }
    }
    if (!sellsLoose) return null
    return {
      kind: 'loose',
      votes: selection.votes,
      pricePerVoteMinor: contest.pricePerVoteMinor,
    }
  }, [selection, selectedBundle, sellsLoose, contest.pricePerVoteMinor])

  const price = choice ? priceVotePurchase(choice, serviceFeeBps) : null
  const problem = price ? votePurchaseProblem(price) : null

  const buyVotes = useMutation(
    trpc.public.voteCheckout.buyVotes.mutationOptions({
      onSuccess: (order) => {
        onEmailUsed(normalizeEmail(email))

        // The money shown must be the money charged. These three numbers come
        // off the order row buyVotes just wrote, so if any of them differs
        // from the preview the preview was wrong — stop and say so rather
        // than hand the voter to Flutterwave for an amount nobody showed them.
        const agrees =
          price !== null &&
          order.subtotalMinor === price.subtotalMinor &&
          order.feeMinor === price.feeMinor &&
          order.totalMinor === price.totalMinor &&
          order.votes === price.votes

        if (!agrees) {
          setRequote({
            quoted: {
              votes: order.votes,
              subtotalMinor: order.subtotalMinor,
              feeMinor: order.feeMinor,
              totalMinor: order.totalMinor,
            },
            paymentUrl: order.paymentUrl,
          })
          // Whatever moved — the rate, the bundle — the page is behind.
          onStale()
          return
        }

        setLeaving(true)
        window.location.href = order.paymentUrl
      },
      onError: (error) => {
        const classified = classifyVoteRefusal(error.data?.code, error.message)
        setRefusal(classified)
        if (classified.refetch) onStale()
      },
    })
  )

  const busy = buyVotes.isPending || leaving

  function submit() {
    setRefusal(null)
    const nextErrors: { name?: string; email?: string } = {}
    if (name.trim() === '') nextErrors.name = 'Tell us who the votes are for.'
    if (!looksLikeEmail(email)) {
      nextErrors.email = 'Enter a valid email — your votes are held against it.'
    }
    setErrors(nextErrors)
    if (nextErrors.name || nextErrors.email) return
    if (!choice || !price || problem) return

    buyVotes.mutate({
      contestId: contest.id,
      bundleId: choice.kind === 'bundle' ? choice.bundleId : null,
      votes: choice.kind === 'loose' ? choice.votes : null,
      voterName: name.trim(),
      voterEmail: normalizeEmail(email),
    })
  }

  const nothingOnSale = bundles.length === 0 && !sellsLoose

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-130">
        <DialogHeader>
          <DialogTitle>Buy votes</DialogTitle>
          <DialogDescription>
            Votes are added to your balance for {contest.title}. You choose who
            to spend them on afterwards — one entry, or split across several.
          </DialogDescription>
        </DialogHeader>

        {nothingOnSale ? (
          <Notice tone="muted">
            This contest isn’t selling votes at the moment.
          </Notice>
        ) : requote ? (
          <RequoteConfirm
            requote={requote}
            onCancel={() => {
              setRequote(null)
              onOpenChange(false)
            }}
          />
        ) : (
          <form
            className="flex flex-col gap-5"
            noValidate
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            {refusal ? <RefusalNotice refusal={refusal} /> : null}

            {bundles.length > 0 ? (
              <fieldset className="flex flex-col gap-2.5">
                <legend className="text-foreground mb-2 text-sm font-semibold">
                  Choose a pack
                </legend>
                {bundles.map((bundle) => {
                  const selected =
                    selection.kind === 'bundle' &&
                    selection.bundleId === bundle.id
                  return (
                    <label
                      key={bundle.id}
                      className={cn(
                        'flex cursor-pointer items-center gap-3 rounded-xl border p-4 transition-colors',
                        selected
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-primary/60'
                      )}
                    >
                      <input
                        type="radio"
                        name="vote-bundle"
                        className="sr-only"
                        value={bundle.id}
                        checked={selected}
                        disabled={busy}
                        onChange={() =>
                          setSelection({ kind: 'bundle', bundleId: bundle.id })
                        }
                      />
                      <span
                        aria-hidden
                        className={cn(
                          'flex size-5 shrink-0 items-center justify-center rounded-full border',
                          selected
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-input'
                        )}
                      >
                        {selected ? (
                          <HugeiconsIcon
                            icon={Tick02Icon}
                            className="size-3"
                            strokeWidth={3}
                          />
                        ) : null}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="text-foreground text-sm font-semibold">
                          {bundle.label}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {bundle.votes.toLocaleString('en-US')}{' '}
                          {bundle.votes === 1 ? 'vote' : 'votes'}
                        </span>
                      </span>
                      <span className="font-heading text-primary shrink-0 text-base font-bold">
                        {formatNaira(bundle.priceMinor)}
                      </span>
                    </label>
                  )
                })}
              </fieldset>
            ) : null}

            {sellsLoose ? (
              <label
                className={cn(
                  'flex cursor-pointer flex-col gap-3 rounded-xl border p-4 transition-colors',
                  selection.kind === 'loose'
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/60'
                )}
              >
                <span className="flex items-center gap-3">
                  <input
                    type="radio"
                    name="vote-bundle"
                    className="sr-only"
                    checked={selection.kind === 'loose'}
                    disabled={busy}
                    onChange={() => setSelection({ kind: 'loose', votes: 1 })}
                  />
                  <span
                    aria-hidden
                    className={cn(
                      'flex size-5 shrink-0 items-center justify-center rounded-full border',
                      selection.kind === 'loose'
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-input'
                    )}
                  >
                    {selection.kind === 'loose' ? (
                      <HugeiconsIcon
                        icon={Tick02Icon}
                        className="size-3"
                        strokeWidth={3}
                      />
                    ) : null}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-foreground text-sm font-semibold">
                      {bundles.length > 0 ? 'Or buy single votes' : 'Buy votes'}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {formatNaira(contest.pricePerVoteMinor)} each
                    </span>
                  </span>
                </span>

                {selection.kind === 'loose' ? (
                  <span className="flex items-center gap-2">
                    <span className="text-muted-foreground text-xs">
                      How many
                    </span>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={MAX_LOOSE_VOTES_PER_ORDER}
                      step={1}
                      className="w-28"
                      value={selection.votes}
                      disabled={busy}
                      onChange={(e) => {
                        const parsed = Number.parseInt(e.target.value, 10)
                        setSelection({
                          kind: 'loose',
                          votes: Number.isFinite(parsed)
                            ? Math.min(
                                MAX_LOOSE_VOTES_PER_ORDER,
                                Math.max(1, parsed)
                              )
                            : 1,
                        })
                      }}
                    />
                  </span>
                ) : null}
              </label>
            ) : null}

            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="buy-votes-name"
                  className="text-foreground text-sm font-medium"
                >
                  Your name
                </label>
                <Input
                  id="buy-votes-name"
                  autoComplete="name"
                  value={name}
                  disabled={busy}
                  aria-invalid={errors.name !== undefined}
                  onChange={(e) => setName(e.target.value)}
                />
                {errors.name ? (
                  <p role="alert" className="text-destructive text-sm">
                    {errors.name}
                  </p>
                ) : null}
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="buy-votes-email"
                  className="text-foreground text-sm font-medium"
                >
                  Your email
                </label>
                <Input
                  id="buy-votes-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  disabled={busy}
                  aria-invalid={errors.email !== undefined}
                  onChange={(e) => setEmail(e.target.value)}
                />
                {errors.email ? (
                  <p role="alert" className="text-destructive text-sm">
                    {errors.email}
                  </p>
                ) : (
                  <p className="text-muted-foreground text-xs leading-5">
                    Your votes are held against this address, so use one you can
                    get back to. Buying for someone else? Put their address here
                    and the votes land in their balance.
                  </p>
                )}
              </div>
            </div>

            {price ? <PriceSummary price={price} /> : null}

            {problem ? (
              <p
                role="alert"
                className="text-destructive flex items-start gap-2 text-sm"
              >
                <HugeiconsIcon
                  icon={Alert02Icon}
                  className="mt-0.5 size-4 shrink-0"
                  strokeWidth={2}
                />
                {problem}
              </p>
            ) : null}

            <Button
              type="submit"
              size="xl"
              className="w-full"
              disabled={busy || price === null || problem !== null}
            >
              {leaving ? (
                <>
                  <Spinner />
                  Taking you to payment…
                </>
              ) : buyVotes.isPending ? (
                <>
                  <Spinner />
                  Starting your payment…
                </>
              ) : price ? (
                `Pay ${formatNaira(price.totalMinor)}`
              ) : (
                'Pay'
              )}
            </Button>

            <p className="text-muted-foreground text-xs leading-5">
              You pay through Flutterwave on the next screen. Your votes land in
              your balance once the payment clears, and you come back here to
              spend them.
            </p>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * Subtotal, service fee and total — three lines, never one. The fee is the
 * platform's, the voter pays it, and a total that quietly absorbs it is the
 * thing this platform has decided not to do anywhere money changes hands.
 */
function PriceSummary({
  price,
  title,
}: {
  price: VotePriceBreakdown
  title?: string
}) {
  return (
    <div className="bg-muted/50 flex flex-col gap-2 rounded-xl px-4 py-3">
      <div className="flex items-baseline justify-between gap-4 text-sm">
        <span className="text-muted-foreground">
          {title ??
            `${price.votes.toLocaleString('en-US')} ${
              price.votes === 1 ? 'vote' : 'votes'
            }`}
        </span>
        <span className="text-foreground font-semibold">
          {formatNaira(price.subtotalMinor)}
        </span>
      </div>
      {price.feeMinor > 0 ? (
        <div className="flex items-baseline justify-between gap-4 text-sm">
          <span className="text-muted-foreground">Service fee</span>
          <span className="text-foreground font-semibold">
            {formatNaira(price.feeMinor)}
          </span>
        </div>
      ) : null}
      <div className="border-border/60 flex items-baseline justify-between gap-4 border-t pt-2">
        <span className="text-foreground text-sm font-semibold">Total</span>
        <span className="font-heading text-foreground text-lg font-bold">
          {formatNaira(price.totalMinor)}
        </span>
      </div>
    </div>
  )
}

/**
 * The preview and the order disagreed. The order exists and its payment link
 * is for the figures below, so the only honest options are to pay THAT or to
 * walk away — not to send them off quoting a price that was never real.
 */
function RequoteConfirm({
  requote,
  onCancel,
}: {
  requote: Requote
  onCancel: () => void
}) {
  const [leaving, setLeaving] = useState(false)
  return (
    <div className="flex flex-col gap-4">
      <Notice tone="warning" role="alert">
        <p>The price changed while this was open.</p>
        <p className="mt-1 text-xs leading-5 opacity-80">
          Nothing has been charged. Here is what this payment is actually for —
          check it before you go on.
        </p>
      </Notice>

      <PriceSummary
        price={requote.quoted}
        title={`${requote.quoted.votes.toLocaleString('en-US')} ${
          requote.quoted.votes === 1 ? 'vote' : 'votes'
        }`}
      />

      <Button
        type="button"
        size="xl"
        className="w-full"
        disabled={leaving}
        onClick={() => {
          setLeaving(true)
          window.location.href = requote.paymentUrl
        }}
      >
        {leaving ? (
          <>
            <Spinner />
            Taking you to payment…
          </>
        ) : (
          `Pay ${formatNaira(requote.quoted.totalMinor)}`
        )}
      </Button>
      <Button
        type="button"
        size="xl"
        variant="outline"
        className="w-full"
        disabled={leaving}
        onClick={onCancel}
      >
        Don’t pay — go back
      </Button>
    </div>
  )
}
