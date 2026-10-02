'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import { ViewIcon, ViewOffSlashIcon } from '@hugeicons/core-free-icons'

import { Button } from '@ticketur/ui/components/button'
import { Input } from '@ticketur/ui/components/input'
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from '@ticketur/ui/components/field'

import { authClient } from '@/lib/auth-client'
import { withNext } from '@/lib/post-login-redirect'
import { SocialAuthButtons } from '@/components/auth/social-auth-buttons'

const loginSchema = z.object({
  email: z.email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
})

type LoginValues = z.infer<typeof loginSchema>

// `next` is where the person was headed before sign-in interrupted them (a
// registration form they were filling in, say). It rides along to /post-login,
// and through 2FA when that is in the way.
export function LoginForm({ next }: { next?: string | null }) {
  const router = useRouter()
  const [showPassword, setShowPassword] = useState(false)
  const [isPending, startTransition] = useTransition()

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
    mode: 'onTouched',
  })

  function onSubmit(data: LoginValues) {
    startTransition(async () => {
      const { data: result, error } = await authClient.signIn.email({
        email: data.email,
        password: data.password,
      })

      if (error) {
        toast.error('Sign in failed', {
          description: error.message ?? 'Check your credentials and try again.',
        })
        return
      }

      if (result && 'twoFactorRedirect' in result && result.twoFactorRedirect) {
        router.push(withNext('/two-factor', next))
        return
      }

      toast.success('Welcome back')
      router.push(withNext('/post-login', next))
      // Refresh so server components (notably the session-aware site header)
      // re-render with the new session instead of the cached logged-out view.
      // Without this the header only updates after a manual page reload.
      router.refresh()
    })
  }

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={form.handleSubmit(onSubmit)}
      noValidate
    >
      <FieldGroup>
        <Controller
          name="email"
          control={form.control}
          render={({ field: rhf, fieldState }) => (
            <Field data-invalid={fieldState.invalid || undefined}>
              <FieldLabel
                htmlFor={rhf.name}
                className="text-foreground text-base font-semibold"
              >
                Email Address
              </FieldLabel>
              <Input
                name={rhf.name}
                ref={rhf.ref}
                value={rhf.value ?? ''}
                onChange={rhf.onChange}
                onBlur={rhf.onBlur}
                id={rhf.name}
                type="email"
                placeholder="alex@example.com"
                autoComplete="email"
                aria-invalid={fieldState.invalid}
              />
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />

        <Controller
          name="password"
          control={form.control}
          render={({ field: rhf, fieldState }) => (
            <Field data-invalid={fieldState.invalid || undefined}>
              <div className="flex items-center justify-between">
                <FieldLabel
                  htmlFor={rhf.name}
                  className="text-foreground text-base font-semibold"
                >
                  Password
                </FieldLabel>
                <Link
                  href="/forgot-password"
                  className="text-primary text-sm font-medium hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <Input
                  name={rhf.name}
                  ref={rhf.ref}
                  value={rhf.value ?? ''}
                  onChange={rhf.onChange}
                  onBlur={rhf.onBlur}
                  id={rhf.name}
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  aria-invalid={fieldState.invalid}
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
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
      </FieldGroup>

      <Button type="submit" size="xl" className="w-full" disabled={isPending}>
        {isPending ? 'Signing in…' : 'Sign In'}
      </Button>

      <FieldSeparator>or</FieldSeparator>

      <SocialAuthButtons next={next} />
    </form>
  )
}
