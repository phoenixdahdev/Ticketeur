'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import { cn } from '@ticketur/ui/lib/utils'
import { Button } from '@ticketur/ui/components/button'
import { Input } from '@ticketur/ui/components/input'
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from '@ticketur/ui/components/input-otp'

import { authClient } from '@/lib/auth-client'
import { withNext } from '@/lib/post-login-redirect'

type Mode = 'totp' | 'backup'

export function TwoFactorForm({ next }: { next?: string | null }) {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('totp')
  const [code, setCode] = useState('')
  const [trustDevice, setTrustDevice] = useState(false)
  const [submitting, startSubmit] = useTransition()

  function verifyTotp(value: string) {
    startSubmit(async () => {
      const { error } = await authClient.twoFactor.verifyTotp({
        code: value,
        trustDevice,
      })

      if (error) {
        toast.error('Invalid code', {
          description: error.message ?? 'Double-check the code and try again.',
        })
        setCode('')
        return
      }

      toast.success('Signed in')
      router.push(withNext('/post-login', next))
    })
  }

  function verifyBackup() {
    if (!code.trim()) return
    startSubmit(async () => {
      const { error } = await authClient.twoFactor.verifyBackupCode({
        code: code.trim(),
      })

      if (error) {
        toast.error('Invalid backup code', {
          description: error.message ?? 'Try another code.',
        })
        return
      }

      toast.success('Signed in with backup code')
      router.push(withNext('/post-login', next))
    })
  }

  return (
    <>
      <header className="flex flex-col gap-3">
        <h1 className="font-heading text-foreground text-2xl leading-tight font-bold tracking-tight md:text-[32px] md:leading-tight">
          Two-factor authentication
        </h1>
        <p className="text-muted-foreground text-base leading-6">
          {mode === 'totp'
            ? 'Enter the 6-digit code from your authenticator app to finish signing in.'
            : 'Enter one of the backup codes you saved when enabling 2FA.'}
        </p>
      </header>

      <div className="flex items-center gap-2 text-sm">
        <button
          type="button"
          onClick={() => {
            setMode('totp')
            setCode('')
          }}
          className={cn(
            'rounded-full px-3 py-1 font-medium transition-colors',
            mode === 'totp'
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          Authenticator code
        </button>
        <button
          type="button"
          onClick={() => {
            setMode('backup')
            setCode('')
          }}
          className={cn(
            'rounded-full px-3 py-1 font-medium transition-colors',
            mode === 'backup'
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          Backup code
        </button>
      </div>

      <form
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault()
          if (mode === 'backup') verifyBackup()
        }}
        noValidate
      >
        {mode === 'totp' ? (
          <div className="flex flex-col items-center gap-4">
            <InputOTP
              maxLength={6}
              value={code}
              onChange={(v) => {
                setCode(v)
                if (v.length === 6) void verifyTotp(v)
              }}
              disabled={submitting}
            >
              <InputOTPGroup>
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <InputOTPSlot key={i} index={i} className="size-12 text-lg" />
                ))}
              </InputOTPGroup>
            </InputOTP>

            <label className="text-muted-foreground flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={trustDevice}
                onChange={(e) => setTrustDevice(e.target.checked)}
                className="accent-primary size-4"
              />
              Trust this device for 30 days
            </label>
          </div>
        ) : (
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="xxxx-xxxx-xxxx"
            autoComplete="one-time-code"
            disabled={submitting}
          />
        )}

        {mode === 'backup' ? (
          <Button
            type="submit"
            size="xl"
            className="w-full"
            disabled={submitting || !code.trim()}
          >
            {submitting ? 'Verifying…' : 'Verify backup code'}
          </Button>
        ) : null}

        <p className="text-muted-foreground text-center text-sm">
          <Link
            href="/login"
            className="text-primary font-semibold hover:underline"
          >
            Back to sign in
          </Link>
        </p>
      </form>
    </>
  )
}
