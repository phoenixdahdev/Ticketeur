'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { HugeiconsIcon } from '@hugeicons/react'
import { InstagramIcon } from '@hugeicons/core-free-icons'
import { toast } from 'sonner'

import { cn } from '@ticketur/ui/lib/utils'
import { authClient } from '@/lib/auth-client'

type SocialProvider = {
  label: string
  icon: React.ReactNode
  onClick?: () => void
  // Providers without real credentials stay unclickable rather than failing
  // mid-redirect.
  disabled?: boolean
}

function GoogleGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn('size-5', className)} aria-hidden>
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

function AppleGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn('size-5', className)} aria-hidden>
      <path
        fill="currentColor"
        d="M17.5 12.7a5 5 0 0 1 2.4-4.2 5 5 0 0 0-4-2.1c-1.7-.2-3.3 1-4.2 1-.9 0-2.2-1-3.6-1A5.3 5.3 0 0 0 3.7 9c-1.9 3.3-.5 8.2 1.4 10.9.9 1.3 2 2.8 3.4 2.7 1.4-.1 1.9-.9 3.6-.9s2.1.9 3.6.9 2.5-1.3 3.4-2.6a11 11 0 0 0 1.6-3.2 4.8 4.8 0 0 1-3.2-4.1Zm-2.7-7.9A4.8 4.8 0 0 0 16 1.3a4.9 4.9 0 0 0-3.2 1.6 4.5 4.5 0 0 0-1.1 3.4 4 4 0 0 0 3.1-1.5Z"
      />
    </svg>
  )
}

function notYetWired() {
  toast('Coming soon', {
    description: 'This provider is not wired up yet.',
  })
}

export function SocialAuthButtons() {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function continueWithGoogle() {
    setPending(true)
    // Popup sign-in: the OAuth round trip happens in a popup on our own
    // origin, so the session cookie it sets is the one this page reads. The
    // opener is never navigated by better-auth, so we route it ourselves.
    const { error } = await authClient.signIn.popup({
      provider: 'google',
      callbackURL: '/post-login',
      newUserCallbackURL: '/welcome',
    })
    setPending(false)

    if (!error) {
      // /post-login resolves the destination server-side, including sending a
      // first-time social user to pick a role.
      router.refresh()
      router.push('/post-login')
      return
    }

    // Dismissing the popup is a deliberate action, not an error worth a toast.
    if (error.code === 'POPUP_CLOSED') return

    if (error.code === 'POPUP_BLOCKED') {
      // Blocked popups are common enough that failing here would just dead-end
      // the user — fall back to the full-page redirect flow, where better-auth
      // handles the new-user destination itself.
      await authClient.signIn.social({
        provider: 'google',
        callbackURL: '/post-login',
        newUserCallbackURL: '/welcome',
      })
      return
    }

    toast.error('Google sign-in failed', {
      description: error.message ?? 'Please try again.',
    })
  }

  const providers: SocialProvider[] = [
    {
      label: 'Continue with Google',
      icon: <GoogleGlyph />,
      onClick: () => void continueWithGoogle(),
      disabled: pending,
    },
    {
      label: 'Continue with Instagram',
      icon: (
        <HugeiconsIcon
          icon={InstagramIcon}
          className="size-5 text-[#d62976]"
          strokeWidth={1.8}
        />
      ),
      onClick: notYetWired,
      disabled: true,
    },
    {
      label: 'Continue with Apple',
      icon: <AppleGlyph className="text-foreground" />,
      onClick: notYetWired,
      disabled: true,
    },
  ]

  return (
    <div className="flex items-center justify-center gap-4">
      {providers.map((p) => (
        <button
          key={p.label}
          type="button"
          onClick={p.onClick}
          aria-label={p.label}
          disabled={p.disabled}
          className="border-border/70 bg-background hover:border-primary/60 hover:bg-muted/40 flex size-11 items-center justify-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        >
          {p.icon}
        </button>
      ))}
    </div>
  )
}
