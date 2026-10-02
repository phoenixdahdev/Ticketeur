'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import { ViewIcon, ViewOffSlashIcon } from '@hugeicons/core-free-icons'

import { Button } from '@ticketur/ui/components/button'
import { Input } from '@ticketur/ui/components/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@ticketur/ui/components/dialog'
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from '@ticketur/ui/components/field'

import { authClient } from '@/lib/auth-client'
import { withNext } from '@/lib/post-login-redirect'

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.5 12.2c0-.8-.1-1.6-.2-2.3H12v4.4h5.9a5 5 0 0 1-2.2 3.3v2.7h3.5c2-1.9 3.2-4.7 3.2-8Z"
      />
      <path
        fill="#34A853"
        d="M12 23c3 0 5.5-1 7.3-2.7l-3.5-2.7c-1 .7-2.3 1.1-3.8 1.1a6.6 6.6 0 0 1-6.2-4.5H2.1v2.8A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.8 14.2a6.6 6.6 0 0 1 0-4.2V7.2H2.1a11 11 0 0 0 0 9.8l3.7-2.8Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.4c1.6 0 3.1.6 4.3 1.7l3.2-3.2A11 11 0 0 0 12 1 11 11 0 0 0 2.1 7.2l3.7 2.8A6.6 6.6 0 0 1 12 5.4Z"
      />
    </svg>
  )
}

export type SigninReason = 'submit' | 'upload'

const REASON_COPY: Record<SigninReason, string> = {
  submit:
    'Applications are tied to an account so we can email you your reference and keep track of where yours stands.',
  upload:
    'Uploads are tied to an account. Sign in and the files you picked will go straight up.',
}

// Sign-in without leaving the form.
//
// Someone who has filled in twenty answers should not be navigated away to
// sign in — the obvious implementation loses the lot. Signing in here keeps
// the page mounted, so there is nothing to restore and nothing to lose. The
// Google popup is the same bargain: it runs on our own origin and never
// navigates the opener.
//
// The two paths that genuinely can't stay on the page — creating an account
// (which needs email verification) and 2FA — navigate with ?next= back to
// this form, and the draft in localStorage carries the answers across.
export function FormSigninDialog({
  open,
  onOpenChange,
  reason,
  returnTo,
  onSignedIn,
  onBeforeLeave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  reason: SigninReason
  // Where to come back to — this form's path.
  returnTo: string
  // Signed in without leaving the page: carry on where they left off.
  onSignedIn: () => void
  // Called just before any navigation, so the caller can save the draft.
  onBeforeLeave: () => void
}) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [googlePending, setGooglePending] = useState(false)

  const createAccountHref = withNext('/get-started', returnTo)
  const busy = pending || googlePending

  function signInWithEmail(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!email.trim() || !password) {
      setError('Enter your email and password.')
      return
    }
    startTransition(async () => {
      const { data, error: signInError } = await authClient.signIn.email({
        email: email.trim(),
        password,
      })

      if (signInError) {
        setError(signInError.message ?? 'Check your details and try again.')
        return
      }

      if (data && 'twoFactorRedirect' in data && data.twoFactorRedirect) {
        // The one case email sign-in can't finish here. Save first, then go.
        onBeforeLeave()
        router.push(withNext('/two-factor', returnTo))
        return
      }

      setPassword('')
      onSignedIn()
    })
  }

  async function signInWithGoogle() {
    setError(null)
    setGooglePending(true)
    const { error: popupError } = await authClient.signIn.popup({
      provider: 'google',
      // Only used if better-auth falls back to a redirect.
      callbackURL: returnTo,
      newUserCallbackURL: returnTo,
    })
    setGooglePending(false)

    if (!popupError) {
      // The popup set the session cookie on our own origin; the form below is
      // still exactly as they left it.
      onSignedIn()
      return
    }

    // Closing the popup is a decision, not an error.
    if (popupError.code === 'POPUP_CLOSED') return

    if (popupError.code === 'POPUP_BLOCKED') {
      onBeforeLeave()
      await authClient.signIn.social({
        provider: 'google',
        callbackURL: returnTo,
        newUserCallbackURL: returnTo,
      })
      return
    }

    toast.error('Google sign-in failed', {
      description: popupError.message ?? 'Please try again.',
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading text-xl font-bold">
            Sign in to continue
          </DialogTitle>
          <DialogDescription>{REASON_COPY[reason]}</DialogDescription>
        </DialogHeader>

        <p className="bg-primary/5 text-muted-foreground rounded-lg px-3 py-2 text-xs leading-5">
          Your answers are saved on this device. Signing in won&apos;t lose
          them.
        </p>

        <form className="flex flex-col gap-4" onSubmit={signInWithEmail}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="form-signin-email">Email address</FieldLabel>
              <Input
                id="form-signin-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="form-signin-password">Password</FieldLabel>
              <div className="relative">
                <Input
                  id="form-signin-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy}
                  className="pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2 rounded-md p-1 transition-colors"
                >
                  <HugeiconsIcon
                    icon={showPassword ? ViewOffSlashIcon : ViewIcon}
                    className="size-5"
                    strokeWidth={1.8}
                  />
                </button>
              </div>
            </Field>
            {error ? <FieldError>{error}</FieldError> : null}
          </FieldGroup>

          <Button type="submit" size="xl" className="w-full" disabled={busy}>
            {pending ? 'Signing in…' : 'Sign in and continue'}
          </Button>
        </form>

        <FieldSeparator>or</FieldSeparator>

        <Button
          type="button"
          variant="outline"
          size="xl"
          className="w-full"
          onClick={() => void signInWithGoogle()}
          disabled={busy}
        >
          <GoogleGlyph />
          {googlePending ? 'Opening Google…' : 'Continue with Google'}
        </Button>

        <div className="text-muted-foreground flex flex-col gap-1 text-center text-sm">
          <p>
            New to Ticketeur?{' '}
            <Link
              href={createAccountHref}
              onClick={onBeforeLeave}
              className="text-primary font-semibold hover:underline"
            >
              Create an account
            </Link>
          </p>
          <p>
            <Link
              href="/forgot-password"
              onClick={onBeforeLeave}
              className="hover:text-foreground underline underline-offset-4"
            >
              Forgot your password?
            </Link>
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
