'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AnimatePresence, motion } from 'motion/react'
import { useQuery } from '@tanstack/react-query'
import { parseAsString, parseAsStringLiteral, useQueryStates } from 'nuqs'

import { DEFAULT_SERVICE_FEE_BPS } from '@ticketur/api/lib/fees'

import { useTRPC } from '@/lib/trpc'
import { formatNaira } from '@/lib/event-display'
import type { EventDetailData } from '@/components/sections/event-detail/types'
import { TicketSelector } from '@/components/sections/event-detail/ticket-selector'
import { CheckoutView } from '@/components/sections/event-detail/checkout-view'
import { GroupCheckoutView } from '@/components/sections/event-detail/group-checkout-view'
import {
  PurchaseModeDialog,
  type PurchaseMode,
} from '@/components/sections/event-detail/purchase-mode-dialog'

export type TicketTierStatus = 'sold-out' | 'available' | 'limited'

export type TicketTier = {
  id: string
  name: string
  status: TicketTierStatus
  description: string
  // Major-unit price (NGN) for display + checkout math.
  price: number
  priceDisplay: string
  remaining: number
  total: number
}

const STATE_KEYS = {
  // Purchase mode chosen in the overlay. Null until the buyer picks.
  mode: parseAsStringLiteral(['self', 'group'] as const),
  step: parseAsStringLiteral(['select', 'checkout']).withDefault('select'),
  // Cart encoded as "tierId:qty,tierId:qty". Tier ids never contain ':' or ','.
  cart: parseAsString.withDefault(''),
}

function parseCart(raw: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const part of raw.split(',')) {
    if (!part) continue
    const [id, q] = part.split(':')
    const qty = Number(q)
    if (id && Number.isInteger(qty) && qty > 0) out[id] = qty
  }
  return out
}

function serializeCart(map: Record<string, number>): string {
  return Object.entries(map)
    .filter(([, q]) => q > 0)
    .map(([id, q]) => `${id}:${q}`)
    .join(',')
}

function deriveTierStatus(remaining: number, total: number): TicketTierStatus {
  if (remaining <= 0) return 'sold-out'
  // "Limited" when ≤25% remain (or fewer than 20 tickets) — tweak as needed.
  if (remaining <= Math.max(20, Math.floor(total * 0.25))) return 'limited'
  return 'available'
}

export function TicketsTab({ event }: { event: EventDetailData }) {
  const trpc = useTRPC()
  const [state, setState] = useQueryStates(STATE_KEYS, { shallow: true })

  const { data, isLoading } = useQuery(
    trpc.public.events.bySlug.queryOptions({ slug: event.slug })
  )

  // The platform's ticket service-fee rate, in basis points, from the same
  // query that priced the tiers. This component renders a skeleton until that
  // query lands (see below), so by the time a checkout view is mounted the
  // rate is a real number from the server, not a guess — there is no moment at
  // which a subtotal is on screen without the fee that goes with it. The
  // fallback is the platform default and is unreachable in practice: `data` is
  // defined on every path that reaches a checkout view.
  const serviceFeeBps = data?.serviceFeeBps ?? DEFAULT_SERVICE_FEE_BPS

  const tiers: TicketTier[] = (data?.tiers ?? []).map((t) => {
    const remaining = Math.max(0, t.quantity - t.sold)
    return {
      id: t.id,
      name: t.name,
      status: deriveTierStatus(remaining, t.quantity),
      description: '',
      price: t.priceMinor / 100,
      priceDisplay: formatNaira(t.priceMinor),
      remaining,
      total: t.quantity,
    }
  })

  // Multi-tier cart: each tier holds its own quantity, so a buyer can mix a
  // free tier, VIP, General, etc. in a single order. Selection is additive.
  const quantities = parseCart(state.cart)

  const setTierQty = (tierId: string, qty: number) => {
    const tier = tiers.find((t) => t.id === tierId)
    if (!tier || tier.status === 'sold-out') return
    const clamped = Math.min(Math.max(0, qty), tier.remaining)
    const next = { ...quantities }
    if (clamped <= 0) delete next[tierId]
    else next[tierId] = clamped
    void setState({ cart: serializeCart(next) || null })
  }

  const goTo = (step: 'select' | 'checkout') => setState({ step })

  // The Purchase Mode overlay opens automatically when no mode is chosen yet
  // (i.e. the buyer just landed on the tickets tab), and can be reopened to
  // switch modes.
  const [chooserOpen, setChooserOpen] = useState(() => state.mode === null)

  const chooseMode = (mode: PurchaseMode) => {
    void setState({ mode, step: 'select' })
    setChooserOpen(false)
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-muted h-32 animate-pulse rounded-2xl" />
        ))}
      </div>
    )
  }

  // A finished event keeps its page as the public record of it, but the whole
  // purchase flow is withdrawn — checkout.start would reject the order anyway,
  // so failing here (before the buyer fills anything in) is the honest path.
  // Takes precedence over the no-tiers state below.
  if (data?.hasEnded) {
    return (
      <div className="border-border bg-muted/20 flex min-h-60 flex-col items-center justify-center rounded-2xl border border-dashed p-10 text-center">
        <p className="font-heading text-foreground text-lg font-semibold">
          This event has ended
        </p>
        <p className="text-muted-foreground mt-1 text-sm">
          Tickets are no longer on sale. Browse what&apos;s coming up next.
        </p>
        <Link
          href="/events"
          className="text-primary hover:text-primary-hover mt-4 text-sm font-semibold"
        >
          Browse upcoming events
        </Link>
      </div>
    )
  }

  if (tiers.length === 0) {
    return (
      <div className="border-border bg-muted/20 flex min-h-60 flex-col items-center justify-center rounded-2xl border border-dashed p-10 text-center">
        <p className="font-heading text-foreground text-lg font-semibold">
          Tickets aren&apos;t on sale yet
        </p>
        <p className="text-muted-foreground mt-1 text-sm">
          Check back soon — the organiser will publish tiers when ready.
        </p>
      </div>
    )
  }

  const dateLabel = event.time ? `${event.date} • ${event.time}` : event.date

  return (
    <div className="relative">
      <PurchaseModeDialog
        open={chooserOpen}
        onOpenChange={setChooserOpen}
        event={{
          title: event.title,
          dateLabel,
          location: event.location,
          imageUrl: event.imageUrl,
        }}
        onSelect={chooseMode}
      />

      {state.mode === null ? (
        <div className="border-border bg-muted/20 flex min-h-60 flex-col items-center justify-center gap-4 rounded-2xl border border-dashed p-10 text-center">
          <p className="font-heading text-foreground text-lg font-semibold">
            How would you like to buy?
          </p>
          <button
            type="button"
            onClick={() => setChooserOpen(true)}
            className="text-primary hover:text-primary-hover text-sm font-semibold"
          >
            Choose purchase mode
          </button>
        </div>
      ) : (
        <>
          <div className="mb-6 flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Buying:</span>
            <span className="text-foreground font-semibold">
              {state.mode === 'group' ? 'For Multiple Attendees' : 'For Myself'}
            </span>
            <button
              type="button"
              onClick={() => setChooserOpen(true)}
              className="text-primary hover:text-primary-hover font-semibold"
            >
              Change
            </button>
          </div>

          {state.mode === 'group' ? (
            <GroupCheckoutView
              event={event}
              tiers={tiers}
              serviceFeeBps={serviceFeeBps}
              onBack={() => setChooserOpen(true)}
            />
          ) : (
            <AnimatePresence mode="wait" initial={false}>
              {state.step === 'select' ? (
                <motion.div
                  key="select"
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -12 }}
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                >
                  <TicketSelector
                    event={event}
                    tiers={tiers}
                    quantities={quantities}
                    onQuantityChange={setTierQty}
                    onCheckout={() => goTo('checkout')}
                  />
                </motion.div>
              ) : (
                <motion.div
                  key="checkout"
                  initial={{ opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 12 }}
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                >
                  <CheckoutView
                    event={event}
                    tiers={tiers}
                    quantities={quantities}
                    serviceFeeBps={serviceFeeBps}
                    onBack={() => goTo('select')}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </>
      )}
    </div>
  )
}
