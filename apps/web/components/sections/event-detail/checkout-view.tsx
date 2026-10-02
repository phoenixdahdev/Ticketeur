'use client'

import { useState, useTransition } from 'react'
import { motion } from 'motion/react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowRight01Icon,
  InformationCircleIcon,
  Shield01Icon,
  UserIcon,
} from '@hugeicons/core-free-icons'

import { cn } from '@ticketur/ui/lib/utils'
import { Button } from '@ticketur/ui/components/button'
import { Input } from '@ticketur/ui/components/input'

import { calculateFeeMinor } from '@ticketur/api/lib/fees'

import type { TicketTier } from '@/components/sections/event-detail/tickets-tab'
import type { EventDetailData } from '@/components/sections/event-detail/types'
import { useVoucher } from '@/components/sections/event-detail/use-voucher'
import { VoucherField } from '@/components/sections/event-detail/voucher-field'
import { useTRPC } from '@/lib/trpc'
import { useSession } from '@/lib/auth-client'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function CheckoutView({
  event,
  tiers,
  quantities,
  serviceFeeBps,
  onBack,
}: {
  event: EventDetailData
  tiers: TicketTier[]
  quantities: Record<string, number>
  // The platform's ticket service-fee rate in basis points, from the same
  // public.events.bySlug query that priced the tiers above. For DISPLAY only —
  // checkout.start reads the rate from the database again and that figure is
  // what gets charged, so a tab left open across a rate change can show a
  // stale fee but cannot pay one.
  serviceFeeBps: number
  onBack: () => void
}) {
  const trpc = useTRPC()
  const session = useSession()
  const sessionUser = session.data?.user ?? null
  const [form, setForm] = useState({ name: '', email: '', phone: '' })
  const [errors, setErrors] = useState<{
    name?: string
    email?: string
    phone?: string
  }>({})
  const [, startTransition] = useTransition()

  const selected = tiers.filter((t) => (quantities[t.id] ?? 0) > 0)
  const subtotal = selected.reduce(
    (sum, t) => sum + t.price * (quantities[t.id] ?? 0),
    0
  )

  // All money math in minor units, mirroring the server: discount comes off the
  // subtotal, the fee is charged on the discounted subtotal, total is the sum.
  const subtotalMinor = Math.round(subtotal * 100)
  const voucher = useVoucher(event.id, subtotalMinor)
  const discountMinor = voucher.discountMinor
  const discountedMinor = Math.max(0, subtotalMinor - discountMinor)
  const feeMinor = calculateFeeMinor(discountedMinor, serviceFeeBps)
  const totalMinor = discountedMinor + feeMinor
  const serviceFee = feeMinor / 100
  const discount = discountMinor / 100
  const total = totalMinor / 100
  const isFree = totalMinor === 0 && selected.length > 0

  const start = useMutation(
    trpc.public.checkout.start.mutationOptions({
      onSuccess: ({ paymentUrl, orderId, free }) => {
        if (free) {
          // No payment needed — order is already fulfilled, go to tickets.
          window.location.href = `/tickets/${orderId}`
          return
        }
        // Redirect off-domain to Flutterwave's hosted checkout. Customer
        // returns to /checkout/return after paying.
        if (paymentUrl) window.location.href = paymentUrl
      },
      onError: (err) => {
        toast.error('Could not start checkout', {
          description: err.message,
        })
      },
    })
  )

  function fillFromSession() {
    if (!sessionUser) return
    setForm((f) => ({
      ...f,
      name: sessionUser.name ?? f.name,
      email: sessionUser.email ?? f.email,
    }))
    setErrors({})
  }

  function validate() {
    const e: typeof errors = {}
    if (!form.name.trim()) e.name = 'Required'
    if (!EMAIL_RE.test(form.email.trim())) e.email = 'Enter a valid email'
    if (form.phone.trim().length < 7) e.phone = 'Enter a valid phone'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function onSubmit(ev: React.FormEvent) {
    ev.preventDefault()
    if (!validate()) return
    if (selected.length === 0) {
      toast.error('Pick at least one ticket tier first.')
      return
    }
    const items = selected.map((t) => ({
      tierId: t.id,
      quantity: quantities[t.id] ?? 0,
    }))
    startTransition(() => {
      start.mutate({
        eventId: event.id,
        items,
        buyerName: form.name.trim(),
        buyerEmail: form.email.trim(),
        buyerPhone: form.phone.trim(),
        ...(voucher.code ? { voucherCode: voucher.code } : {}),
      })
    })
  }

  const submitting = start.isPending

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
        <span className="text-foreground font-semibold">Checkout</span>
      </nav>

      <form
        onSubmit={onSubmit}
        className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_400px] lg:gap-8"
      >
        <div className="flex flex-col gap-6">
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="border-border bg-card flex flex-col gap-5 rounded-2xl border p-5 md:p-6"
          >
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
                  onClick={fillFromSession}
                  className="text-primary hover:text-primary-hover bg-primary/10 hover:bg-primary/15 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors"
                >
                  Use my details
                </button>
              ) : null}
            </div>

            <Field label="Full Name" htmlFor="ck-name" error={errors.name}>
              <Input
                id="ck-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Alex Johnson"
                autoComplete="name"
                aria-invalid={!!errors.name}
                disabled={submitting}
              />
            </Field>

            <Field
              label="Purchaser Email"
              htmlFor="ck-email"
              helper="Tickets will be sent to this email address."
              error={errors.email}
            >
              <Input
                id="ck-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="alex@example.com"
                autoComplete="email"
                aria-invalid={!!errors.email}
                disabled={submitting}
              />
            </Field>

            <Field label="Phone Number" htmlFor="ck-phone" error={errors.phone}>
              <Input
                id="ck-phone"
                type="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="+234 000 000 0000"
                autoComplete="tel"
                aria-invalid={!!errors.phone}
                disabled={submitting}
              />
            </Field>
          </motion.section>

          {isFree ? (
            <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-500/40 dark:bg-emerald-500/15">
              <div className="flex size-9 items-center justify-center rounded-lg bg-emerald-500 text-white">
                <HugeiconsIcon
                  icon={Shield01Icon}
                  className="size-4"
                  strokeWidth={2}
                />
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">
                  This ticket is free
                </span>
                <span className="text-xs text-emerald-900/80 dark:text-emerald-200/80">
                  No payment needed. Click the button below and we&apos;ll email
                  your ticket immediately.
                </span>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-3 rounded-lg border border-[#bfdbfe] bg-[#eff6ff] p-4 dark:border-[#1e40af]/40 dark:bg-[#1e40af]/15">
              <div className="flex size-9 items-center justify-center rounded-lg bg-[#135bec] text-white">
                <HugeiconsIcon
                  icon={Shield01Icon}
                  className="size-4"
                  strokeWidth={2}
                />
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold text-[#1e3a8a] dark:text-[#93c5fd]">
                  Secure payment by Flutterwave
                </span>
                <span className="text-xs text-[#1e3a8a]/80 dark:text-[#93c5fd]/80">
                  You&apos;ll be redirected to Flutterwave to enter your card,
                  bank or USSD details. We never see them.
                </span>
              </div>
            </div>
          )}

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

        <motion.aside
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            delay: 0.12,
            duration: 0.35,
            ease: [0.22, 1, 0.36, 1],
          }}
          className="border-border bg-card flex flex-col gap-6 rounded-2xl border p-5 md:p-6 lg:sticky lg:top-24 lg:self-start"
        >
          <h2 className="font-heading text-foreground text-lg font-semibold">
            Order Summary
          </h2>

          <div className="flex flex-col gap-2">
            <span className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
              Ticket Tier
            </span>
            {selected.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No tickets selected.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {selected.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-baseline justify-between gap-2"
                  >
                    <span className="font-heading text-foreground text-base font-semibold">
                      {t.name}
                    </span>
                    <span className="font-heading text-primary flex items-baseline gap-1 text-sm font-bold">
                      {t.priceDisplay}
                      <span className="text-muted-foreground text-xs font-medium">
                        ({quantities[t.id]})
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {selected.length > 0 && subtotal > 0 ? (
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
              disabled={selected.length === 0 || submitting}
              className="w-full"
            >
              {submitting
                ? isFree
                  ? 'Reserving…'
                  : 'Redirecting…'
                : isFree
                  ? 'Get free ticket'
                  : 'Pay Now'}
            </Button>
            <p className="text-muted-foreground text-center text-xs">
              By completing your purchase, you agree to our{' '}
              <span className="text-primary font-medium">Terms of Service</span>
            </p>
          </div>

          <span className="sr-only">Checkout for {event.title}</span>
        </motion.aside>
      </form>
    </div>
  )
}

function Field({
  label,
  htmlFor,
  helper,
  error,
  children,
}: {
  label: string
  htmlFor: string
  helper?: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={htmlFor}
        className="text-foreground text-sm font-semibold"
      >
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-destructive text-xs">{error}</p>
      ) : helper ? (
        <p className="text-muted-foreground text-xs">{helper}</p>
      ) : null}
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
    <div className={cn('flex items-baseline justify-between gap-4 text-sm')}>
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('text-foreground font-semibold', valueClassName)}>
        {value}
      </span>
    </div>
  )
}
