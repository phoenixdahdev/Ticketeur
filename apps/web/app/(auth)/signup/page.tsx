import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { AuthShell } from '@/components/auth/auth-shell'
import { SignupForm } from '@/components/auth/signup-form'
import { resolveSignupRole } from '@/lib/signup-roles'
import { getSession } from '@/lib/auth'
import {
  getPostLoginPath,
  safeNextPath,
  withNext,
} from '@/lib/post-login-redirect'

export const metadata: Metadata = {
  title: 'Sign Up',
  description: 'Create your Ticketeur account.',
}

function pickFirst(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

export default async function SignupPage(props: PageProps<'/signup'>) {
  const searchParams = await props.searchParams
  // An invite forces the role to vendor regardless of any other query.
  const invite = pickFirst(searchParams.invite)
  const isVendorInvite = invite === 'vendor'
  // Where to return to once the account is verified.
  const next = safeNextPath(searchParams.next)
  const signInHref = withNext('/login', next)

  // Already-authenticated users shouldn't be creating another account. Send
  // them to their dashboard/home. The vendor-invite flow is exempt: it may be
  // completing an invited account's setup.
  if (!isVendorInvite) {
    const session = await getSession()
    if (session) {
      const role =
        (session.user as unknown as { role?: string | null }).role ?? null
      redirect(getPostLoginPath(role, next))
    }
  }

  const roleParam = isVendorInvite ? 'vendor' : searchParams.role
  const config = resolveSignupRole(roleParam)
  const initialEmail = pickFirst(searchParams.email) ?? ''

  return (
    <AuthShell
      imageSrc={config.imageSrc}
      imageMobileSrc={config.imageMobileSrc}
      imageAlt={config.imageAlt}
    >
      <div className="text-muted-foreground hidden items-center justify-end text-sm md:flex">
        Already have an account?&nbsp;
        <Link
          href={signInHref}
          className="text-primary font-semibold hover:underline"
        >
          Sign In
        </Link>
      </div>

      <header className="flex flex-col gap-3">
        {isVendorInvite ? (
          <span className="bg-primary/10 text-primary inline-flex w-fit items-center rounded-full px-3 py-1 text-xs font-bold tracking-wider uppercase">
            Vendor invitation
          </span>
        ) : null}
        <h1 className="font-heading text-foreground text-2xl leading-tight font-bold tracking-tight md:text-[32px] md:leading-tight">
          {isVendorInvite
            ? "You're invited — set up your vendor account"
            : config.title}
        </h1>
        <p className="text-muted-foreground text-base leading-6">
          {isVendorInvite
            ? 'An organizer invited you to a Ticketeur event. Finish setting up your account to accept and start showcasing your business.'
            : config.description}
        </p>
      </header>

      <SignupForm
        config={config}
        initialEmail={initialEmail}
        lockEmail={isVendorInvite && initialEmail.length > 0}
        next={next}
      />

      <p className="text-muted-foreground mt-2 text-center text-sm md:hidden">
        Already have an account?{' '}
        <Link
          href={signInHref}
          className="text-primary font-semibold hover:underline"
        >
          Sign In
        </Link>
      </p>
    </AuthShell>
  )
}
