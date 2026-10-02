'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import { MailValidation01Icon, Loading03Icon } from '@hugeicons/core-free-icons'

import { cn } from '@ticketur/ui/lib/utils'
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from '@ticketur/ui/components/input-otp'

import { authClient } from '@/lib/auth-client'
import { withNext } from '@/lib/post-login-redirect'

const RESEND_COOLDOWN_SECONDS = 45

export function VerifyEmailForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const email = searchParams.get('email') ?? ''
  // Carried from sign-up, so verifying lands back where they started.
  const next = searchParams.get('next')

  const [otp, setOtp] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const [verifying, startVerify] = useTransition()
  const [resending, startResend] = useTransition()
  const cooldownTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (cooldown <= 0) return
    cooldownTimer.current = setInterval(() => {
      setCooldown((s) => (s <= 1 ? 0 : s - 1))
    }, 1000)
    return () => {
      if (cooldownTimer.current) clearInterval(cooldownTimer.current)
    }
  }, [cooldown])

  function verify(value: string) {
    if (!email) {
      toast.error('Missing email', {
        description: 'Open this page from the link we sent to your inbox.',
      })
      return
    }
    startVerify(async () => {
      const { error } = await authClient.emailOtp.verifyEmail({
        email,
        otp: value,
      })

      if (error) {
        toast.error('Invalid or expired code', {
          description: error.message ?? 'Double-check the code and try again.',
        })
        setOtp('')
        return
      }

      toast.success('Email verified', {
        description: 'You can now sign in to your account.',
      })
      router.push(withNext('/post-login', next))
    })
  }

  function resend() {
    if (!email) {
      toast.error('Missing email', {
        description: 'Open this page from the link we sent to your inbox.',
      })
      return
    }
    if (cooldown > 0) return
    startResend(async () => {
      const { error } = await authClient.emailOtp.sendVerificationOtp({
        email,
        type: 'email-verification',
      })
      if (error) {
        toast.error('Could not resend', {
          description: error.message ?? 'Please try again in a moment.',
        })
        return
      }
      setCooldown(RESEND_COOLDOWN_SECONDS)
      toast.success('New code sent', { description: `Check ${email}.` })
    })
  }

  const resendDisabled = resending || cooldown > 0

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col items-center gap-5 text-center">
        <div className="bg-primary/10 text-primary ring-primary/15 flex size-16 items-center justify-center rounded-2xl ring-8">
          <HugeiconsIcon
            icon={MailValidation01Icon}
            className="size-7"
            strokeWidth={1.8}
          />
        </div>

        <div className="flex flex-col gap-2">
          <h1 className="font-heading text-foreground text-2xl leading-tight font-bold tracking-tight md:text-[32px] md:leading-[1.2]">
            Verify your email
          </h1>
          <p className="text-muted-foreground text-base leading-6">
            {email ? (
              <>
                We sent a 6-digit code to{' '}
                <span className="text-foreground font-semibold">{email}</span>.
                Enter it below to finish setting up your account.
              </>
            ) : (
              'Enter the 6-digit code we sent to your email to finish setting up your account.'
            )}
          </p>
        </div>
      </div>

      <form
        className="flex flex-col items-center gap-5"
        onSubmit={(e) => e.preventDefault()}
        noValidate
      >
        <InputOTP
          maxLength={6}
          value={otp}
          onChange={(v) => {
            setOtp(v)
            if (v.length === 6) void verify(v)
          }}
          disabled={verifying}
          autoFocus
        >
          <InputOTPGroup className="gap-2">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <InputOTPSlot
                key={i}
                index={i}
                className="size-12 rounded-xl border-[1.5px] text-xl font-semibold md:size-14 md:text-2xl"
              />
            ))}
          </InputOTPGroup>
        </InputOTP>

        {verifying ? (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <HugeiconsIcon
              icon={Loading03Icon}
              className="size-4 animate-spin"
              strokeWidth={2}
            />
            Verifying…
          </p>
        ) : (
          <p className="text-muted-foreground text-sm">
            Didn&apos;t receive the code?{' '}
            <button
              type="button"
              onClick={resend}
              disabled={resendDisabled}
              className={cn(
                'font-medium transition-colors',
                resendDisabled
                  ? 'text-muted-foreground/70 cursor-not-allowed'
                  : 'text-primary hover:underline'
              )}
            >
              {resending
                ? 'Sending…'
                : cooldown > 0
                  ? `Resend in ${cooldown}s`
                  : 'Resend code'}
            </button>
          </p>
        )}
      </form>

      <div className="border-border/60 flex flex-col items-center gap-3 border-t pt-6 text-sm">
        <p className="text-muted-foreground text-center">
          Check your spam folder if you don&apos;t see it. Still stuck?{' '}
          <a
            href="mailto:support@ticketur.app"
            className="text-primary font-medium hover:underline"
          >
            Contact support
          </a>
          .
        </p>
        <Link
          href="/login"
          className="text-muted-foreground hover:text-foreground text-sm transition-colors"
        >
          ← Back to sign in
        </Link>
      </div>
    </div>
  )
}
