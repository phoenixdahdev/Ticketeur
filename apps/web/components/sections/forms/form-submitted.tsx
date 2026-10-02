'use client'

import { useState } from 'react'
import Link from 'next/link'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  CheckmarkCircle02Icon,
  Copy01Icon,
  Mail01Icon,
  Tick02Icon,
} from '@hugeicons/core-free-icons'

import { Button } from '@ticketur/ui/components/button'

import type { FormEventSummary } from '@/components/sections/forms/types'

export type SubmittedResult = {
  reference: string
  status: 'submitted' | 'approved' | 'pending_payment'
}

// A free application is finished the moment it is accepted, so this is the
// screen that has to carry the reference. It is what the applicant quotes in
// every support message and what the confirmation email repeats, so it is the
// largest thing here and it can be copied in one tap — on a phone, reading a
// code back off the screen while typing it into WhatsApp is the alternative.
export function FormSubmitted({
  result,
  formTitle,
  event,
  email,
}: {
  result: SubmittedResult
  formTitle: string
  event: FormEventSummary
  email: string | null
}) {
  const [copied, setCopied] = useState(false)

  async function copyReference() {
    try {
      await navigator.clipboard.writeText(result.reference)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access can be refused; the code is on screen regardless.
    }
  }

  const approved = result.status === 'approved'

  return (
    <section className="flex flex-col items-center gap-6 py-6 text-center">
      <span className="flex size-16 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
        <HugeiconsIcon
          icon={CheckmarkCircle02Icon}
          className="size-8"
          strokeWidth={2}
        />
      </span>

      <div className="flex flex-col gap-2">
        <h2 className="font-heading text-foreground text-3xl font-bold tracking-tight">
          {approved ? "You're in!" : 'Application received'}
        </h2>
        <p className="text-muted-foreground mx-auto max-w-prose text-sm leading-6">
          {approved
            ? `Your application for ${formTitle} is confirmed. Nothing else is needed from you.`
            : `Your application for ${formTitle} is in. The organizer reviews every application and we'll email you as soon as they decide.`}
        </p>
      </div>

      <div className="border-border bg-card flex w-full max-w-sm flex-col items-center gap-3 rounded-2xl border p-6">
        <p className="text-muted-foreground text-xs font-bold tracking-[0.2em] uppercase">
          Your reference
        </p>
        <p className="font-heading text-foreground text-3xl font-bold tracking-[0.15em] select-all">
          {result.reference}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void copyReference()}
        >
          <HugeiconsIcon
            icon={copied ? Tick02Icon : Copy01Icon}
            strokeWidth={2}
          />
          {copied ? 'Copied' : 'Copy reference'}
        </Button>
        <p className="text-muted-foreground text-xs leading-5">
          Quote this if you ever need to ask about your application. It is
          always in your account too, under My applications.
        </p>
      </div>

      <p className="text-muted-foreground flex items-center justify-center gap-2 text-sm">
        <HugeiconsIcon
          icon={Mail01Icon}
          className="text-primary size-4 shrink-0"
          strokeWidth={1.8}
        />
        <span>
          {email
            ? `We've emailed a confirmation to ${email}.`
            : "We've emailed you a confirmation."}
        </span>
      </p>

      <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
        <Button asChild size="xl">
          <Link href="/account/applications">View my application</Link>
        </Button>
        <Button asChild variant="outline" size="xl">
          <Link href={`/events/${event.slug}`}>Back to {event.title}</Link>
        </Button>
      </div>
    </section>
  )
}
