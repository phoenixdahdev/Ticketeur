'use client'

import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Coins01Icon } from '@hugeicons/core-free-icons'

import { Button } from '@ticketur/ui/components/button'
import { Input } from '@ticketur/ui/components/input'

import {
  looksLikeEmail,
  normalizeEmail,
} from '@/components/sections/contests/voter-identity'

// The balance a voter is holding for this contest, and the way back to it.
//
// /checkout/return sends a voter here with "You have N votes to cast". The
// credits hang on their email and nothing else, so this is where that email
// is asked for — once, remembered on the device, and shown back to them so
// they can tell at a glance whose balance they are spending.

export function VoteWallet({
  voterEmail,
  remaining,
  loading,
  canBuy,
  onIdentify,
  onForget,
  onBuy,
}: {
  /** The address this device last voted or paid with, or null. */
  voterEmail: string | null
  /** Votes left, or null while unknown (no email, or still loading). */
  remaining: number | null
  loading: boolean
  /** The contest has something to sell. */
  canBuy: boolean
  onIdentify: (email: string) => void
  onForget: () => void
  onBuy: () => void
}) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (!voterEmail) {
    return (
      <section className="border-border bg-card flex flex-col gap-3 rounded-2xl border p-5">
        <div className="flex items-start gap-2.5">
          <HugeiconsIcon
            icon={Coins01Icon}
            className="text-primary mt-0.5 size-5 shrink-0"
            strokeWidth={1.8}
          />
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="text-foreground text-sm font-semibold">
              Already bought votes?
            </h2>
            <p className="text-muted-foreground text-sm leading-6">
              Your votes are held against the email you paid with. Put it in and
              we’ll show what you have left to spend.
            </p>
          </div>
        </div>

        <form
          className="flex flex-col gap-2 sm:flex-row"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            if (!looksLikeEmail(draft)) {
              setError('Enter the email you paid with.')
              return
            }
            setError(null)
            onIdentify(normalizeEmail(draft))
          }}
        >
          <Input
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            aria-label="The email you paid with"
            aria-invalid={error !== null}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              setError(null)
            }}
          />
          <Button type="submit" className="shrink-0">
            Show my votes
          </Button>
        </form>
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}

        {canBuy ? (
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto sm:self-start"
            onClick={onBuy}
          >
            Buy votes
          </Button>
        ) : null}
      </section>
    )
  }

  return (
    <section className="border-primary/30 bg-primary/5 flex flex-col gap-3 rounded-2xl border p-5">
      <div className="flex items-start gap-2.5">
        <HugeiconsIcon
          icon={Coins01Icon}
          className="text-primary mt-0.5 size-5 shrink-0"
          strokeWidth={1.8}
        />
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="font-heading text-foreground text-lg font-bold tabular-nums">
            {loading || remaining === null
              ? 'Checking your votes…'
              : remaining === 0
                ? 'No votes left to spend'
                : `${remaining.toLocaleString('en-US')} ${
                    remaining === 1 ? 'vote' : 'votes'
                  } to cast`}
          </h2>
          <p className="text-muted-foreground text-xs break-all">
            Held against {voterEmail}
          </p>
        </div>
      </div>

      {remaining !== null && remaining > 0 ? (
        <p className="text-muted-foreground text-sm leading-6">
          Pick anyone still in the running below and press{' '}
          <span className="text-foreground font-medium">Use my votes</span>.
          Spend them all on one entry or split them up.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {canBuy ? (
          <Button type="button" onClick={onBuy}>
            {remaining && remaining > 0 ? 'Buy more votes' : 'Buy votes'}
          </Button>
        ) : null}
        <Button type="button" variant="outline" onClick={onForget}>
          Use a different email
        </Button>
      </div>
    </section>
  )
}
