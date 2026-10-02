'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Controller, useForm, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import { ViewIcon, ViewOffSlashIcon } from '@hugeicons/core-free-icons'

import { Button } from '@ticketur/ui/components/button'
import { Input } from '@ticketur/ui/components/input'
import { Textarea } from '@ticketur/ui/components/textarea'
import { Checkbox } from '@ticketur/ui/components/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ticketur/ui/components/select'
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from '@ticketur/ui/components/field'

import {
  SIGNUP_SCHEMAS,
  getSignupDefaultValues,
  type SignupRoleConfig,
} from '@/lib/signup-roles'
import { authClient } from '@/lib/auth-client'
import { withNext } from '@/lib/post-login-redirect'
import { PasswordStrength } from '@/components/auth/password-strength'
import { SocialAuthButtons } from '@/components/auth/social-auth-buttons'

type SignupFormValues = {
  fullName?: string
  orgName?: string
  orgType?: string
  businessName?: string
  category?: string
  description?: string
  email?: string
  password: string
  confirmPassword: string
  agree: boolean
}

export function SignupForm({
  config,
  initialEmail = '',
  lockEmail = false,
  next = null,
}: {
  config: SignupRoleConfig
  initialEmail?: string
  lockEmail?: boolean
  // Where to return to once the account exists and its email is verified.
  next?: string | null
}) {
  const router = useRouter()
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [isPending, startTransition] = useTransition()

  const schema = SIGNUP_SCHEMAS[config.role]
  const defaults = getSignupDefaultValues(config) as SignupFormValues
  if (initialEmail) defaults.email = initialEmail
  const form = useForm<SignupFormValues>({
    resolver: zodResolver(schema) as unknown as Resolver<SignupFormValues>,
    defaultValues: defaults,
    mode: 'onTouched',
  })

  const password = form.watch('password') ?? ''

  function onSubmit(data: SignupFormValues) {
    startTransition(async () => {
      const name = (
        data.fullName ??
        data.orgName ??
        data.businessName ??
        ''
      ).trim()

      const additionalFields: Record<string, string> = {}
      if (data.orgName) additionalFields.orgName = data.orgName
      if (data.orgType) additionalFields.orgType = data.orgType
      if (data.businessName) additionalFields.businessName = data.businessName
      if (data.category) additionalFields.businessCategory = data.category
      if (data.description)
        additionalFields.businessDescription = data.description

      const { error } = await authClient.signUp.email({
        name,
        email: data.email ?? '',
        password: data.password,
        requestedRole: config.role,
        ...additionalFields,
      })

      if (error) {
        toast.error('Sign up failed', {
          description: error.message ?? 'Please try again.',
        })
        return
      }

      toast.success('Account created', {
        description: 'Check your inbox for a verification code.',
      })
      router.push(
        withNext(
          `/verify-email?email=${encodeURIComponent(data.email ?? '')}`,
          next
        )
      )
    })
  }

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={form.handleSubmit(onSubmit)}
      noValidate
    >
      <FieldGroup>
        {config.fields.map((field) => (
          <Controller
            key={field.name}
            name={field.name as keyof SignupFormValues}
            control={form.control}
            render={({ field: rhf, fieldState }) => (
              <Field data-invalid={fieldState.invalid || undefined}>
                <FieldLabel
                  htmlFor={rhf.name}
                  className="text-foreground text-base font-semibold"
                >
                  {field.label}
                </FieldLabel>
                {field.type === 'textarea' ? (
                  <Textarea
                    name={rhf.name}
                    ref={rhf.ref}
                    value={typeof rhf.value === 'string' ? rhf.value : ''}
                    onChange={rhf.onChange}
                    onBlur={rhf.onBlur}
                    id={rhf.name}
                    placeholder={field.placeholder}
                    rows={3}
                    aria-invalid={fieldState.invalid}
                    className="min-h-20 resize-none rounded-[8px] py-3.5"
                  />
                ) : field.type === 'select' ? (
                  <Select
                    name={rhf.name}
                    value={typeof rhf.value === 'string' ? rhf.value : ''}
                    onValueChange={(v) => {
                      rhf.onChange(v)
                      rhf.onBlur()
                    }}
                  >
                    <SelectTrigger
                      id={rhf.name}
                      aria-invalid={fieldState.invalid}
                      className="h-13! w-full rounded-[8px] px-4 text-base md:text-sm"
                    >
                      <SelectValue placeholder={field.placeholder} />
                    </SelectTrigger>
                    <SelectContent>
                      {field.options?.map((opt) => (
                        <SelectItem key={opt} value={opt}>
                          {opt}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    name={rhf.name}
                    ref={rhf.ref}
                    value={typeof rhf.value === 'string' ? rhf.value : ''}
                    onChange={rhf.onChange}
                    onBlur={rhf.onBlur}
                    id={rhf.name}
                    type={field.type}
                    placeholder={field.placeholder}
                    autoComplete={field.autoComplete}
                    aria-invalid={fieldState.invalid}
                    readOnly={field.name === 'email' && lockEmail}
                    className={
                      field.name === 'email' && lockEmail
                        ? 'bg-muted/40 cursor-not-allowed'
                        : undefined
                    }
                  />
                )}
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
        ))}

        <Controller
          name="password"
          control={form.control}
          render={({ field: rhf, fieldState }) => (
            <Field data-invalid={fieldState.invalid || undefined}>
              <FieldLabel
                htmlFor={rhf.name}
                className="text-foreground text-base font-semibold"
              >
                Password
              </FieldLabel>
              <div className="relative">
                <Input
                  name={rhf.name}
                  ref={rhf.ref}
                  value={typeof rhf.value === 'string' ? rhf.value : ''}
                  onChange={rhf.onChange}
                  onBlur={rhf.onBlur}
                  id={rhf.name}
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Create a secure password"
                  autoComplete="new-password"
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
              <PasswordStrength password={password ?? ''} />
            </Field>
          )}
        />

        <Controller
          name="confirmPassword"
          control={form.control}
          render={({ field: rhf, fieldState }) => (
            <Field data-invalid={fieldState.invalid || undefined}>
              <FieldLabel
                htmlFor={rhf.name}
                className="text-foreground text-base font-semibold"
              >
                Confirm Password
              </FieldLabel>
              <div className="relative">
                <Input
                  name={rhf.name}
                  ref={rhf.ref}
                  value={typeof rhf.value === 'string' ? rhf.value : ''}
                  onChange={rhf.onChange}
                  onBlur={rhf.onBlur}
                  id={rhf.name}
                  type={showConfirmPassword ? 'text' : 'password'}
                  placeholder="Re-enter your password"
                  autoComplete="new-password"
                  aria-invalid={fieldState.invalid}
                  className="pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((v) => !v)}
                  aria-label={
                    showConfirmPassword ? 'Hide password' : 'Show password'
                  }
                  className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2 rounded-md p-1 transition-colors"
                >
                  <HugeiconsIcon
                    icon={showConfirmPassword ? ViewOffSlashIcon : ViewIcon}
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

      <Controller
        name="agree"
        control={form.control}
        render={({ field: rhf, fieldState }) => (
          <Field
            orientation="horizontal"
            className="items-start gap-3"
            data-invalid={fieldState.invalid || undefined}
          >
            <Checkbox
              id="agree"
              checked={!!rhf.value}
              onCheckedChange={(v) => rhf.onChange(v === true)}
              onBlur={rhf.onBlur}
              aria-invalid={fieldState.invalid}
              className="mt-0.5"
            />
            <div className="flex flex-1 flex-col gap-1">
              <FieldLabel
                htmlFor="agree"
                className="text-muted-foreground text-sm leading-5 font-normal"
              >
                <span className="block">
                  I agree to the{' '}
                  <Link
                    href="/terms"
                    className="text-primary font-medium hover:underline"
                  >
                    Terms of Service
                  </Link>{' '}
                  and{' '}
                  <Link
                    href="/privacy"
                    className="text-primary font-medium hover:underline"
                  >
                    Privacy Policy
                  </Link>
                  .
                </span>
              </FieldLabel>
              <FieldError errors={[fieldState.error]} />
            </div>
          </Field>
        )}
      />

      <Button type="submit" size="xl" className="w-full" disabled={isPending}>
        {isPending ? 'Creating account…' : 'Sign Up'}
      </Button>

      <FieldSeparator>or</FieldSeparator>

      <SocialAuthButtons next={next} />
    </form>
  )
}
