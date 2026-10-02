'use client'

import { useState, useTransition } from 'react'
import { motion } from 'motion/react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  AddCircleIcon,
  ArrowRight01Icon,
  Delete02Icon,
  InformationCircleIcon,
  Shield01Icon,
  UserIcon,
  UserMultiple02Icon,
} from '@hugeicons/core-free-icons'

import { cn } from '@ticketur/ui/lib/utils'
import { Button } from '@ticketur/ui/components/button'
import { Input } from '@ticketur/ui/components/input'
import {
  NativeSelect,
  NativeSelectOption,
} from '@ticketur/ui/components/native-select'

import { calculateFeeMinor } from '@ticketur/api/lib/fees'

import type { TicketTier } from '@/components/sections/event-detail/tickets-tab'
import type { EventDetailData } from '@/components/sections/event-detail/types'
import { useVoucher } from '@/components/sections/event-detail/use-voucher'
import { VoucherField } from '@/components/sections/event-detail/voucher-field'
import { useTRPC } from '@/lib/trpc'
import { useSession } from '@/lib/auth-client'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_TICKETS = 50

type Attendee = { key: string; name: string; email: string; tierId: string }

function newAttendee(tierId: string): Attendee {
  return { key: crypto.randomUUID(), name: '', email: '', tierId }
}

export function GroupCheckoutView({
  event,
  tiers,
  serviceFeeBps,
  onBack,
}: {
  event: EventDetailData
  tiers: TicketTier[]
  // The platform's ticket service-fee rate in basis points — see CheckoutView.
  // Display only; checkout.start recomputes the fee it charges.
  serviceFeeBps: number
  onBack: () => void
}) {
  const trpc = useTRPC()
  const session = useSession()
  const sessionUser = session.data?.user ?? null

  const sellable = tiers.filter((t) => t.status !== 'sold-out')
  const defaultTierId = sellable[0]?.id ?? ''
  const tierById = new Map(tiers.map((t) => [t.id, t]))

  const [form, setForm] = useState({ name: '', email: '', phone: '' })
  const [attendees, setAttendees] = useState<Attendee[]>([
    newAttendee(defaultTierId),
  ])
  const [, startTransition] = useTransition()

  // Per-tier counts and subtotal from the attendee rows that have a tier.
  const perTier = new Map<string, number>()
  for (const a of attendees) {
    if (a.tierId) perTier.set(a.tierId, (perTier.get(a.tierId) ?? 0) + 1)
  }
  const subtotal = [...perTier.entries()].reduce((sum, [tierId, count]) => {
    const tier = tierById.get(tierId)
    return sum + (tier ? tier.price * count : 0)
  }, 0)

  const subtotalMinor = Math.round(subtotal * 100)
  const voucher = useVoucher(event.id, subtotalMinor)
  const discountMinor = voucher.discountMinor
  const discountedMinor = Math.max(0, subtotalMinor - discountMinor)
  const feeMinor = calculateFeeMinor(discountedMinor, serviceFeeBps)
  const totalMinor = discountedMinor + feeMinor
  const serviceFee = feeMinor / 100
  const discount = discountMinor / 100
  const total = totalMinor / 100
  const isFree = totalMinor === 0 && attendees.length > 0

  const start = useMutation(
    trpc.public.checkout.start.mutationOptions({
      onSuccess: ({ paymentUrl, orderId, free }) => {
        if (free) {
          window.location.href = `/tickets/${orderId}`
          return
        }
        if (paymentUrl) window.location.href = paymentUrl
      },
      onError: (err) =>
        toast.error('Could not start checkout', { description: err.message }),
    })
  )

  const submitting = start.isPending

  function updateAttendee(key: string, patch: Partial<Attendee>) {
    setAttendees((rows) =>
      rows.map((r) => (r.key === key ? { ...r, ...patch } : r))
    )
  }
  function addAttendee() {
    if (attendees.length >= MAX_TICKETS) {
      toast.error(`You can buy at most ${MAX_TICKETS} tickets per order.`)
      return
    }
    setAttendees((rows) => [...rows, newAttendee(defaultTierId)])
  }
  function removeAttendee(key: string) {
    setAttendees((rows) =>
      rows.length <= 1 ? rows : rows.filter((r) => r.key !== key)
    )
  }
  function fillBuyerFromSession() {
    if (!sessionUser) return
    setForm((f) => ({
      ...f,
      name: sessionUser.name ?? f.name,
      email: sessionUser.email ?? f.email,
    }))
  }

  function onSubmit(ev: React.FormEvent) {
    ev.preventDefault()
    if (!form.name.trim()) return toast.error('Enter the purchaser name.')
    if (!EMAIL_RE.test(form.email.trim()))
      return toast.error('Enter a valid purchaser email.')
    if (form.phone.trim().length < 7)
      return toast.error('Enter a valid phone number.')

    const cleaned = attendees.map((a) => ({
      name: a.name.trim(),
      email: a.email.trim(),
      tierId: a.tierId,
    }))
    if (cleaned.length === 0) return toast.error('Add at least one attendee.')
    if (cleaned.length > MAX_TICKETS)
      return toast.error(`At most ${MAX_TICKETS} tickets per order.`)
    for (const [i, a] of cleaned.entries()) {
      if (!a.name) return toast.error(`Attendee ${i + 1}: name is required.`)
      if (!EMAIL_RE.test(a.email))
        return toast.error(`Attendee ${i + 1}: enter a valid email.`)
      if (!a.tierId || !tierById.has(a.tierId))
        return toast.error(`Attendee ${i + 1}: choose a ticket.`)
    }
    // Per-tier stock guard (friendly; server re-checks).
    for (const [tierId, count] of perTier.entries()) {
      const tier = tierById.get(tierId)
      if (tier && count > tier.remaining) {
        return toast.error(
          `Only ${tier.remaining} ${tier.name} ticket${tier.remaining === 1 ? '' : 's'} left.`
        )
      }
    }

    startTransition(() => {
      start.mutate({
        eventId: event.id,
        mode: 'group',
        attendees: cleaned,
        buyerName: form.name.trim(),
        buyerEmail: form.email.trim(),
        buyerPhone: form.phone.trim(),
        ...(voucher.code ? { voucherCode: voucher.code } : {}),
      })
    })
  }

  return (
    <div className="flex flex-col gap-6 md:gap-8">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
        <button
          type="button"
          onClick={onBack}
          className="text-primary hover:text-primary-hover font-medium transition-colors"
        >
          Tickets
        </button>
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          className="text-muted-foreground size-4"
          strokeWidth={2}
        />
        <span className="text-foreground font-semibold">Group checkout</span>
      </nav>

      <form
        onSubmit={onSubmit}
        className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_400px] lg:gap-8"
      >
        <div className="flex flex-col gap-6">
          {/* Purchaser */}
          <section className="border-border bg-card flex flex-col gap-5 rounded-2xl border p-5 md:p-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <HugeiconsIcon
                  icon={UserIcon}
                  className="text-primary size-5"
                  strokeWidth={1.8}
                />
                <h2 className="font-heading text-foreground text-lg font-semibold">
                  Purchaser Information
                </h2>
              </div>
              {sessionUser ? (
                <button
                  type="button"
                  onClick={fillBuyerFromSession}
                  className="text-primary hover:text-primary-hover bg-primary/10 hover:bg-primary/15 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors"
                >
                  Use my details
                </button>
              ) : null}
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Full Name">
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Alex Johnson"
                  autoComplete="name"
                  disabled={submitting}
                />
              </Field>
              <Field label="Phone Number">
                <Input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="+234 000 000 0000"
                  autoComplete="tel"
                  disabled={submitting}
                />
              </Field>
            </div>
            <Field
              label="Purchaser Email"
              helper="Your receipt goes here. Each attendee's ticket is emailed to them."
            >
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="alex@example.com"
                autoComplete="email"
                disabled={submitting}
              />
            </Field>
          </section>

          {/* Attendees */}
          <section className="border-border bg-card flex flex-col gap-5 rounded-2xl border p-5 md:p-6">
            <div className="flex items-center gap-2">
              <HugeiconsIcon
                icon={UserMultiple02Icon}
                className="text-primary size-5"
                strokeWidth={1.8}
              />
              <h2 className="font-heading text-foreground text-lg font-semibold">
                Attendees
              </h2>
              <span className="text-muted-foreground text-sm">
                ({attendees.length})
              </span>
            </div>

            <div className="flex flex-col gap-4">
              {attendees.map((a, i) => (
                <div
                  key={a.key}
                  className="border-border grid grid-cols-1 gap-3 rounded-xl border p-4 md:grid-cols-[1fr_1fr_auto]"
                >
                  <Field label={`Attendee ${i + 1} name`}>
                    <Input
                      value={a.name}
                      onChange={(e) =>
                        updateAttendee(a.key, { name: e.target.value })
                      }
                      placeholder="Full name"
                      disabled={submitting}
                    />
                  </Field>
                  <Field
                    label="Email"
                    helper="Their ticket is sent here."
                  >
                    <Input
                      type="email"
                      value={a.email}
                      onChange={(e) =>
                        updateAttendee(a.key, { email: e.target.value })
                      }
                      placeholder="attendee@example.com"
                      disabled={submitting}
                    />
                  </Field>
                  <div className="flex items-end gap-2">
                    <Field label="Ticket" className="flex-1">
                      <NativeSelect
                        className="w-full"
                        value={a.tierId}
                        onChange={(e) =>
                          updateAttendee(a.key, { tierId: e.target.value })
                        }
                        disabled={submitting}
                      >
                        {sellable.map((t) => (
                          <NativeSelectOption key={t.id} value={t.id}>
                            {t.name} — {t.priceDisplay}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </Field>
                    <button
                      type="button"
                      onClick={() => removeAttendee(a.key)}
                      disabled={attendees.length <= 1 || submitting}
                      aria-label={`Remove attendee ${i + 1}`}
                      className="text-muted-foreground hover:text-destructive mb-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border border-transparent transition-colors disabled:opacity-40"
                    >
                      <HugeiconsIcon
                        icon={Delete02Icon}
                        className="size-5"
                        strokeWidth={1.8}
                      />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <Button
              type="button"
              variant="outline"
              onClick={addAttendee}
              disabled={attendees.length >= MAX_TICKETS || submitting}
              className="self-start"
            >
              <HugeiconsIcon
                icon={AddCircleIcon}
                className="size-4"
                strokeWidth={1.8}
              />
              Add attendee
            </Button>
          </section>

          <div className="flex items-start gap-3 rounded-lg border border-[#fde68a] bg-[#fffbeb] p-4 dark:border-[#b45309]/40 dark:bg-[#b45309]/10">
            <HugeiconsIcon
              icon={InformationCircleIcon}
              className="size-5 shrink-0 text-[#b45309] dark:text-[#fbbf24]"
              strokeWidth={1.8}
            />
            <p className="text-sm text-[#92400e] dark:text-[#fbbf24]">
              <strong className="font-semibold">No-Refund Policy:</strong> All
              sales are final. Since Ticketeur is a moderated marketplace for
              community events, we cannot offer refunds once the purchase is
              complete.
            </p>
          </div>
        </div>

        {/* Order summary */}
        <motion.aside
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="border-border bg-card flex flex-col gap-6 rounded-2xl border p-5 md:p-6 lg:sticky lg:top-24 lg:self-start"
        >
          <h2 className="font-heading text-foreground text-lg font-semibold">
            Order Summary
          </h2>

          <div className="flex flex-col gap-2">
            <span className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
              Ticket Tier
            </span>
            {perTier.size === 0 ? (
              <p className="text-muted-foreground text-sm">No tickets yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {[...perTier.entries()].map(([tierId, count]) => {
                  const tier = tierById.get(tierId)
                  if (!tier) return null
                  return (
                    <li
                      key={tierId}
                      className="flex items-baseline justify-between gap-2"
                    >
                      <span className="font-heading text-foreground text-base font-semibold">
                        {tier.name}
                      </span>
                      <span className="font-heading text-primary flex items-baseline gap-1 text-sm font-bold">
                        {tier.priceDisplay}
                        <span className="text-muted-foreground text-xs font-medium">
                          ({count})
                        </span>
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {subtotal > 0 ? (
            <div className="border-border border-t pt-4">
              <VoucherField
                voucher={voucher}
                discount={discount}
                disabled={submitting}
              />
            </div>
          ) : null}

          <div className="border-border flex flex-col gap-2 border-t pt-4">
            <Row label="Subtotal" value={`₦${subtotal.toLocaleString()}.00`} />
            {discount > 0 ? (
              <Row
                label={`Discount (${voucher.code})`}
                value={`−₦${discount.toLocaleString()}.00`}
                valueClassName="text-emerald-600 dark:text-emerald-400"
              />
            ) : null}
            {serviceFee > 0 ? (
              <Row
                label="Service Fee"
                value={`₦${serviceFee.toLocaleString()}.00`}
              />
            ) : null}
          </div>

          <div className="border-border flex items-baseline justify-between gap-4 border-t pt-4">
            <span className="font-heading text-foreground text-base font-semibold md:text-lg">
              Total Amount
            </span>
            <span className="font-heading text-primary text-2xl font-bold md:text-3xl">
              {isFree ? 'Free' : `₦${total.toLocaleString()}`}
            </span>
          </div>

          <div className="bg-muted/40 dark:bg-muted/20 flex flex-col gap-2 rounded-xl p-4">
            <Button
              type="submit"
              size="xl"
              disabled={subtotal < 0 || submitting}
              className="w-full"
            >
              {submitting
                ? isFree
                  ? 'Reserving…'
                  : 'Redirecting…'
                : isFree
                  ? 'Get free tickets'
                  : 'Pay Now'}
            </Button>
            <div className="flex items-center justify-center gap-1.5">
              <HugeiconsIcon
                icon={Shield01Icon}
                className="text-muted-foreground size-3.5"
                strokeWidth={1.8}
              />
              <p className="text-muted-foreground text-center text-xs">
                Secure checkout processed by Ticketeur
              </p>
            </div>
          </div>
        </motion.aside>
      </form>
    </div>
  )
}

function Field({
  label,
  helper,
  className,
  children,
}: {
  label: string
  helper?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <label className="text-foreground text-sm font-semibold">{label}</label>
      {children}
      {helper ? <p className="text-muted-foreground text-xs">{helper}</p> : null}
    </div>
  )
}

function Row({
  label,
  value,
  valueClassName,
}: {
  label: string
  value: string
  valueClassName?: string
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('text-foreground font-semibold', valueClassName)}>
        {value}
      </span>
    </div>
  )
}
