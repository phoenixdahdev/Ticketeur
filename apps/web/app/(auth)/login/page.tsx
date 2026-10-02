import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { AuthShell } from '@/components/auth/auth-shell'
import { LoginForm } from '@/components/auth/login-form'
import { SIGNUP_ROLES } from '@/lib/signup-roles'
import { getSession } from '@/lib/auth'
import { getPostLoginPath, withNext } from '@/lib/post-login-redirect'

export const metadata: Metadata = {
  title: 'Sign In',
  description: 'Sign in to your Ticketeur account.',
}

export const dynamic = 'force-dynamic'

export default async function LoginPage(props: PageProps<'/login'>) {
  // Where to return to once signed in — set by whatever sent them here.
  const { next } = await props.searchParams

  // Already signed in? Skip the form and go straight to the right place.
  const session = await getSession()
  if (session) {
    const role =
      (session.user as unknown as { role?: string | null }).role ?? null
    redirect(getPostLoginPath(role, next))
  }

  const signUpHref = withNext('/get-started', next)

  const { imageSrc, imageMobileSrc, imageAlt } = SIGNUP_ROLES.attendee

  return (
    <AuthShell
      imageSrc={imageSrc}
      imageMobileSrc={imageMobileSrc}
      imageAlt={imageAlt}
    >
      <div className="text-muted-foreground hidden items-center justify-end text-sm md:flex">
        Don&apos;t have an account?&nbsp;
        <Link
          href={signUpHref}
          className="text-primary font-semibold hover:underline"
        >
          Sign Up
        </Link>
      </div>

      <header className="flex flex-col gap-3">
        <h1 className="font-heading text-foreground text-2xl leading-tight font-bold tracking-tight md:text-[32px] md:leading-tight">
          Welcome back
        </h1>
        <p className="text-muted-foreground text-base leading-6">
          Sign in to your Ticketeur account to continue.
        </p>
      </header>

      <LoginForm next={typeof next === 'string' ? next : null} />

      <p className="text-muted-foreground mt-2 text-center text-sm md:hidden">
        Don&apos;t have an account?{' '}
        <Link
          href={signUpHref}
          className="text-primary font-semibold hover:underline"
        >
          Sign Up
        </Link>
      </p>
    </AuthShell>
  )
}
