import type { Metadata } from 'next'
import { getBaseUrl } from '@ticketur/api/lib/base-url'
import Image from 'next/image'
import Link from 'next/link'
import { eq } from 'drizzle-orm'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Calendar03Icon,
  CheckmarkCircle02Icon,
  Location01Icon,
  Mail01Icon,
} from '@hugeicons/core-free-icons'

import { Button } from '@ticketur/ui/components/button'
import { db, orders } from '@ticketur/db'
import { verifyTransaction } from '@ticketur/api/lib/flutterwave'
import {
  loadRegistrationForOrder,
  type RegistrationForOrder,
} from '@ticketur/api/lib/form-payments'
import {
  fulfillOrder,
  loadOrderById,
  loadOrderItems,
  notifyFulfilment,
  type OrderItemRow,
  type OrderWithDetails,
} from '@ticketur/api/lib/orders'

import { formatEventDate, formatNaira } from '@/lib/event-display'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Payment',
}

type SP = Promise<{
  status?: string | string[]
  tx_ref?: string | string[]
  transaction_id?: string | string[]
}>

function pickFirst(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0]
  return value
}

export default async function CheckoutReturnPage({
  searchParams,
}: {
  searchParams: SP
}) {
  const sp = await searchParams
  const status = pickFirst(sp.status)
  const txRef = pickFirst(sp.tx_ref)
  const transactionId = pickFirst(sp.transaction_id)

  if (!txRef) {
    return (
      <FailedScreen reason={status === 'cancelled' ? 'cancelled' : 'failed'} />
    )
  }

  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.flwTxRef, txRef))
    .limit(1)

  if (status === 'cancelled' || status === 'failed') {
    // A registration fee isn't a ticket purchase, and its application is
    // still waiting on the fee, so it gets its own words. (Unless another
    // attempt on the same checkout paid it already.)
    if (order?.type === 'registration_fee') {
      const head = await loadOrderById(order.id)
      if (head) {
        return (
          <RegistrationScreen
            state={head.order.status === 'paid' ? 'paid' : status}
            head={head}
            registration={await loadRegistrationForOrder(head.order)}
          />
        )
      }
    }
    return (
      <FailedScreen reason={status === 'cancelled' ? 'cancelled' : 'failed'} />
    )
  }

  if (!order) {
    // The buyer returned holding a Flutterwave tx_ref we have no order for —
    // the same "paid with nothing attached" case the webhook guards. Log it so
    // it is not inferred solely from a user complaint.
    console.error('[checkout] return page: no order for payment tx_ref', {
      txRef,
      transactionId: transactionId ?? null,
    })
    return <FailedScreen reason="missing" />
  }

  // Belt-and-braces: the webhook should have already fulfilled this order, but
  // if the user beat it back we re-verify and fulfill here. Idempotent — only
  // the pending→paid transition fires the emails (and a ticket order's PDF).
  // fulfillOrder checks the verified charge's amount and currency itself,
  // exactly as for the webhook, and delivers by order type; a charge that
  // doesn't pay for the order leaves it 'failed' (handled below).
  if (order.status !== 'paid' && transactionId) {
    try {
      const tx = await verifyTransaction(transactionId)
      if (tx && tx.status === 'successful' && tx.tx_ref === txRef) {
        const result = await fulfillOrder({ orderId: order.id, charge: tx })
        if (result) await notifyFulfilment(result, getBaseUrl())
      }
    } catch (err) {
      // The webhook still retries this order, but a buyer parked on the
      // processing screen needs a cause we can look up. Covers the verify call
      // too, which previously threw out of the page on a gateway error.
      console.error('[checkout] return-page fulfillment failed', {
        orderId: order.id,
        txRef,
        transactionId,
        error: err,
      })
      // fall through — show the processing screen
    }
  }

  const head = await loadOrderById(order.id)
  if (!head) return <FailedScreen reason="missing" />

  // Only a ticket order gets the ticket views below.
  if (head.order.type === 'registration_fee') {
    return (
      <RegistrationScreen
        state={
          head.order.status === 'paid'
            ? 'paid'
            : head.order.status === 'failed'
              ? 'unconfirmed'
              : 'processing'
        }
        head={head}
        registration={await loadRegistrationForOrder(head.order)}
      />
    )
  }
  if (head.order.type !== 'ticket') {
    // A type with no fulfilment yet (vendor_fee, vote_purchase): fulfillOrder
    // refused it and left it for a person, so there is nothing to show yet.
    return <OtherPaymentScreen reference={orderRef(order.id)} />
  }

  // 'failed': a verified charge did not pay for the order, or the payment
  // itself failed. Either way nothing is still processing.
  if (head.order.status === 'failed') {
    return <FailedScreen reason="unconfirmed" reference={orderRef(order.id)} />
  }
  if (head.order.status !== 'paid') return <ProcessingScreen orderId={order.id} />

  const items = await loadOrderItems(order.id)
  return <SuccessScreen head={head} items={items} />
}

function orderRef(id: string) {
  return `#${id.replace(/^ord_/, '').slice(0, 8).toUpperCase()}`
}

function SuccessScreen({
  head,
  items,
}: {
  head: OrderWithDetails
  items: OrderItemRow[]
}) {
  const { order, event } = head
  const paidWhen = new Date(order.paidAt ?? order.createdAt).toLocaleDateString(
    'en-US',
    { month: 'short', day: '2-digit', year: 'numeric' }
  )

  return (
    <section className="mx-auto flex w-full max-w-160 flex-col items-center gap-8 px-5 py-14 md:py-20">
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="flex size-16 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
          <HugeiconsIcon
            icon={CheckmarkCircle02Icon}
            className="size-8"
            strokeWidth={2}
          />
        </span>
        <div className="flex flex-col gap-1.5">
          <h1 className="font-heading text-foreground text-3xl font-bold tracking-tight md:text-4xl">
            Payment Successful!
          </h1>
          <p className="text-muted-foreground text-sm md:text-base">
            Your tickets for {event.title} are confirmed.
          </p>
        </div>
      </div>

      {/* Summary card */}
      <div className="border-border bg-card w-full overflow-hidden rounded-2xl border">
        <div className="flex items-start gap-4 p-5 md:p-6">
          <div className="bg-muted relative size-20 shrink-0 overflow-hidden rounded-xl">
            {event.bannerUrl ? (
              <Image
                src={event.bannerUrl}
                alt=""
                fill
                sizes="80px"
                className="object-cover"
                unoptimized={event.bannerUrl.startsWith('data:')}
              />
            ) : (
              <div className="from-primary/30 to-background absolute inset-0 bg-linear-to-br" />
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="bg-primary/10 text-primary rounded px-2 py-0.5 text-[11px] font-bold tracking-wider uppercase">
                Order {orderRef(order.id)}
              </span>
              <span className="text-muted-foreground text-xs">{paidWhen}</span>
            </div>
            <h2 className="font-heading text-foreground text-xl font-bold">
              {event.title}
            </h2>
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <HugeiconsIcon
                icon={Calendar03Icon}
                className="text-primary size-4 shrink-0"
                strokeWidth={1.8}
              />
              <span>
                {formatEventDate(event.eventDate, event.endDate)} ·{' '}
                {event.eventTime}
              </span>
            </div>
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <HugeiconsIcon
                icon={Location01Icon}
                className="text-primary size-4 shrink-0"
                strokeWidth={1.8}
              />
              <span className="truncate">{event.location}</span>
            </div>
          </div>
        </div>

        <div className="border-border flex flex-col gap-2 border-t p-5 text-sm md:p-6">
          {items.map((item) => (
            <Row
              key={item.id}
              label={`${item.tierName} × ${item.quantity}`}
              value={
                item.unitPriceMinor === 0
                  ? 'Free'
                  : formatNaira(item.unitPriceMinor * item.quantity)
              }
            />
          ))}
          <div className="border-border/60 mt-1 flex flex-col gap-2 border-t pt-3">
            <Row label="Subtotal" value={formatNaira(order.subtotalMinor)} />
            {order.discountMinor > 0 ? (
              <Row
                label="Discount"
                value={`−${formatNaira(order.discountMinor)}`}
                valueClassName="text-emerald-600 dark:text-emerald-400"
              />
            ) : null}
            {order.feeMinor > 0 ? (
              <Row label="Service Fee" value={formatNaira(order.feeMinor)} />
            ) : null}
          </div>
          <div className="border-border/60 flex items-baseline justify-between gap-4 border-t pt-3">
            <span className="font-heading text-foreground text-base font-semibold">
              Total Paid
            </span>
            <span className="font-heading text-primary text-xl font-bold md:text-2xl">
              {order.totalMinor === 0 ? 'Free' : formatNaira(order.totalMinor)}
            </span>
          </div>
        </div>
      </div>

      <div className="text-muted-foreground flex items-center justify-center gap-2 text-center text-sm">
        <HugeiconsIcon
          icon={Mail01Icon}
          className="text-primary size-4 shrink-0"
          strokeWidth={1.8}
        />
        <span>
          Your QR code and ticket details have been sent to your email address.
        </span>
      </div>

      <div className="flex w-full flex-col gap-3 sm:flex-row">
        <Button asChild size="xl" className="flex-1">
          <Link href={`/tickets/${order.id}`}>View my tickets</Link>
        </Button>
        <Button asChild variant="outline" size="xl" className="flex-1">
          <Link href="/events">Explore more events</Link>
        </Button>
      </div>
    </section>
  )
}

function ProcessingScreen({ orderId }: { orderId: string }) {
  return (
    <section className="mx-auto flex w-full max-w-180 flex-col items-center gap-6 px-6 py-20 text-center md:py-28">
      <p className="text-primary text-xs font-bold tracking-[0.2em] uppercase">
        Processing
      </p>
      <h1 className="font-heading text-foreground text-3xl font-bold tracking-tight md:text-4xl">
        We&apos;re confirming your payment
      </h1>
      <p className="text-muted-foreground text-sm leading-7">
        This usually only takes a moment. Your tickets will appear here and in
        your email as soon as it clears.
      </p>
      <Button asChild size="xl">
        <Link href={`/tickets/${orderId}`}>Check my tickets</Link>
      </Button>
    </section>
  )
}

function FailedScreen({
  reason,
  reference,
}: {
  reason: 'cancelled' | 'failed' | 'missing' | 'unconfirmed'
  reference?: string
}) {
  const message =
    reason === 'cancelled'
      ? 'Looks like you cancelled the payment. No charge was made.'
      : reason === 'missing'
        ? "We couldn't find that order — the link may have expired."
        : reason === 'unconfirmed'
          ? `We couldn't confirm a payment that covers this order, so no tickets were issued. If you were charged, contact support${reference ? ` and quote order ${reference}` : ''} so we can put it right.`
          : 'Your payment did not go through. Please try again or use a different card.'
  return (
    <section className="mx-auto flex w-full max-w-180 flex-col items-center gap-6 px-6 py-20 text-center md:py-28">
      <p className="text-destructive text-xs font-bold tracking-[0.2em] uppercase">
        Payment {reason === 'cancelled' ? 'cancelled' : 'incomplete'}
      </p>
      <h1 className="font-heading text-foreground text-3xl font-bold tracking-tight md:text-4xl">
        {reason === 'cancelled'
          ? 'No problem, we held nothing'
          : "We couldn't complete your purchase"}
      </h1>
      <p className="text-muted-foreground text-sm leading-7">{message}</p>
      <Button asChild size="xl">
        <Link href="/events">Browse events</Link>
      </Button>
    </section>
  )
}

type RegistrationState =
  | 'paid'
  | 'processing'
  | 'unconfirmed'
  | 'cancelled'
  | 'failed'

// A registration-fee payer's view: where their application stands and the
// reference to quote. Never tickets: a registration fee doesn't buy any.
function RegistrationScreen({
  state,
  head,
  registration,
}: {
  state: RegistrationState
  head: OrderWithDetails
  registration: RegistrationForOrder | null
}) {
  const { order, event } = head
  const formTitle = registration?.formTitle ?? 'this event'
  const amount = formatNaira(order.totalMinor)
  const reference = registration?.reference ?? orderRef(order.id)
  const complete =
    registration?.status === 'submitted' || registration?.status === 'approved'

  const copy: {
    eyebrow: string
    title: string
    body: string
    tone: 'success' | 'neutral' | 'error'
  } = (() => {
    switch (state) {
      case 'paid':
        if (registration?.status === 'approved') {
          return {
            eyebrow: 'Payment confirmed',
            title: "You're in!",
            body: `Your ${amount} payment is confirmed and your application for ${formTitle} is approved.`,
            tone: 'success',
          }
        }
        if (registration?.status === 'submitted') {
          return {
            eyebrow: 'Payment confirmed',
            title: 'Application submitted',
            body: `Your ${amount} payment is confirmed. The organizer will review your application for ${formTitle}, and we'll email you when they decide.`,
            tone: 'success',
          }
        }
        return {
          eyebrow: 'Payment received',
          title: 'We received your payment',
          body: `If you have questions about your application for ${formTitle}, contact support and quote reference ${reference}.`,
          tone: 'success',
        }
      case 'processing':
        return {
          eyebrow: 'Processing',
          title: "We're confirming your payment",
          body: `This usually only takes a moment. Your application for ${formTitle} goes through once it clears, and we'll email you a confirmation.`,
          tone: 'neutral',
        }
      case 'unconfirmed':
        return {
          eyebrow: 'Payment incomplete',
          title: "We couldn't confirm your payment",
          body: `We couldn't confirm a payment that covers the fee, so your application for ${formTitle} isn't complete. If you were charged, contact support and quote reference ${reference} so we can put it right.`,
          tone: 'error',
        }
      case 'cancelled':
        return {
          eyebrow: 'Payment cancelled',
          title: 'Your application is not complete',
          body: `You cancelled the payment, so no charge was made. Your application for ${formTitle} only goes through once the fee is paid, so you can apply again whenever you're ready.`,
          tone: 'error',
        }
      case 'failed':
        return {
          eyebrow: 'Payment incomplete',
          title: "Your payment didn't go through",
          body: `Your application for ${formTitle} only goes through once the fee is paid. Please apply again, or use a different card.`,
          tone: 'error',
        }
    }
  })()

  return (
    <section className="mx-auto flex w-full max-w-180 flex-col items-center gap-6 px-6 py-20 text-center md:py-28">
      {copy.tone === 'success' ? (
        <span className="flex size-16 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
          <HugeiconsIcon
            icon={CheckmarkCircle02Icon}
            className="size-8"
            strokeWidth={2}
          />
        </span>
      ) : null}
      <p
        className={`text-xs font-bold tracking-[0.2em] uppercase ${
          copy.tone === 'error' ? 'text-destructive' : 'text-primary'
        }`}
      >
        {copy.eyebrow}
      </p>
      <h1 className="font-heading text-foreground text-3xl font-bold tracking-tight md:text-4xl">
        {copy.title}
      </h1>
      <p className="text-muted-foreground text-sm leading-7">{copy.body}</p>

      {registration ? (
        <div className="border-border bg-card flex w-full flex-col gap-2 rounded-2xl border p-5 text-left md:p-6">
          <Row label="Application" value={registration.formTitle} />
          <Row label="Event" value={event.title} />
          <Row label="Reference" value={registration.reference} />
          <Row label={state === 'paid' ? 'Fee paid' : 'Fee'} value={amount} />
        </div>
      ) : null}

      {state === 'paid' && complete && registration ? (
        <div className="text-muted-foreground flex items-center justify-center gap-2 text-center text-sm">
          <HugeiconsIcon
            icon={Mail01Icon}
            className="text-primary size-4 shrink-0"
            strokeWidth={1.8}
          />
          <span>
            We&apos;ve sent a confirmation with your reference to{' '}
            {registration.applicantEmail}.
          </span>
        </div>
      ) : null}

      <Button asChild size="xl">
        <Link href={`/events/${event.slug}`}>Back to event</Link>
      </Button>
    </section>
  )
}

// An order type with no fulfilment yet. Nothing was delivered, and nothing
// here suggests tickets.
function OtherPaymentScreen({ reference }: { reference: string }) {
  return (
    <section className="mx-auto flex w-full max-w-180 flex-col items-center gap-6 px-6 py-20 text-center md:py-28">
      <p className="text-primary text-xs font-bold tracking-[0.2em] uppercase">
        Processing
      </p>
      <h1 className="font-heading text-foreground text-3xl font-bold tracking-tight md:text-4xl">
        We&apos;re confirming your payment
      </h1>
      <p className="text-muted-foreground text-sm leading-7">
        We&apos;ll email you once it&apos;s confirmed. If you have questions,
        contact support and quote order {reference}.
      </p>
      <Button asChild size="xl">
        <Link href="/events">Browse events</Link>
      </Button>
    </section>
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
      <span className={`text-foreground font-semibold ${valueClassName ?? ''}`}>
        {value}
      </span>
    </div>
  )
}
