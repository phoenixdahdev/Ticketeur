import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { RoleCard, type RoleCardProps } from '@/components/auth/role-card'
import { AuthHeader } from '@/components/layout/auth-header'
import { getSession } from '@/lib/auth'
import {
  getPostLoginPath,
  safeNextPath,
  withNext,
} from '@/lib/post-login-redirect'

export const metadata: Metadata = {
  title: 'Get Started',
  description: 'Choose how you want to join Ticketeur.',
}

export const dynamic = 'force-dynamic'

const ROLES: Array<Omit<RoleCardProps, 'index'>> = [
  {
    title: 'Attendee',
    description:
      'Join to find and buy tickets for local and international events.',
    imageSrc: '/auth/get-started-attendee.png',
    imageAlt: 'Crowd of attendees at a live event',
    href: '/signup?role=attendee',
  },
  {
    title: 'Organizer',
    description:
      'Join to create, manage, and sell tickets for your own events.',
    imageSrc: '/auth/get-started-org.png',
    imageAlt: 'Organizer on stage at an event',
    href: '/signup?role=organizer',
  },
  {
    title: 'Vendor',
    description: 'Join to showcase your brand and sell products at events.',
    imageSrc: '/auth/get-started-vendor.png',
    imageAlt: 'Food vendor serving customers at an event',
    href: '/signup?role=vendor',
  },
]

export default async function GetStartedPage(props: PageProps<'/get-started'>) {
  // Where to return to once the account exists; carried onto each role's
  // sign-up link and through verification.
  const next = safeNextPath((await props.searchParams).next)

  // An already-authenticated user has no role to choose — send them straight
  // to their dashboard/home instead of the role-selection screen.
  const session = await getSession()
  if (session) {
    const role =
      (session.user as unknown as { role?: string | null }).role ?? null
    redirect(getPostLoginPath(role, next))
  }

  return (
    <div className="dark:bg-background flex min-h-svh flex-col bg-[#fafafa]">
      <AuthHeader />
      <main className="flex flex-1 flex-col">
        {' '}
        <div className="mx-auto flex w-full max-w-360 flex-col items-center gap-12 px-4 py-16 md:px-10 md:py-20">
          <header className="flex max-w-225 flex-col items-center gap-4 text-center">
            <h1 className="font-heading text-foreground text-3xl leading-tight font-bold tracking-tight sm:text-4xl md:text-5xl md:leading-[1.17]">
              How would you like to join Ticketeur?
            </h1>
            <p className="font-heading text-muted-foreground max-w-172 text-base leading-7 font-normal sm:text-lg md:text-xl">
              Choose the role that best fits your needs. You can always explore
              other roles later.
            </p>
          </header>

          <div className="grid w-full max-w-289.5 grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {ROLES.map((role, i) => (
              <RoleCard
                key={role.title}
                {...role}
                href={withNext(role.href ?? '/signup', next)}
                index={i}
              />
            ))}
          </div>

          <p className="text-muted-foreground text-base">
            Already have an account?{' '}
            <Link
              href={withNext('/login', next)}
              className="text-primary font-medium hover:underline"
            >
              Log in
            </Link>
          </p>
        </div>
      </main>
    </div>
  )
}
