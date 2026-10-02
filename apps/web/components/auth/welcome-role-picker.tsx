'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'

import { RoleCard } from '@/components/auth/role-card'
import { useTRPC } from '@/lib/trpc'
import { getPostLoginPath } from '@/lib/post-login-redirect'

type SelectableRole = 'attendee' | 'organizer' | 'vendor'

const ROLES: Array<{
  role: SelectableRole
  title: string
  description: string
  imageSrc: string
  imageAlt: string
}> = [
  {
    role: 'attendee',
    title: 'Attendee',
    description:
      'Join to find and buy tickets for local and international events.',
    imageSrc: '/auth/get-started-attendee.png',
    imageAlt: 'Crowd of attendees at a live event',
  },
  {
    role: 'organizer',
    title: 'Organizer',
    description:
      'Join to create, manage, and sell tickets for your own events.',
    imageSrc: '/auth/get-started-org.png',
    imageAlt: 'Organizer on stage at an event',
  },
  {
    role: 'vendor',
    title: 'Vendor',
    description: 'Join to showcase your brand and sell products at events.',
    imageSrc: '/auth/get-started-vendor.png',
    imageAlt: 'Food vendor serving customers at an event',
  },
]

export function WelcomeRolePicker({ name }: { name?: string | null }) {
  const trpc = useTRPC()
  const router = useRouter()
  const [pendingRole, setPendingRole] = useState<SelectableRole | null>(null)

  const chooseRole = useMutation(
    trpc.account.profile.chooseRole.mutationOptions({
      onSuccess: (result) => {
        // Drop any cached RSC payload first: the destination is role-gated and
        // the role only just changed (sessions read it from the DB, so the
        // server will see the new value).
        router.refresh()
        router.replace(getPostLoginPath(result.role))
      },
      onError: (e) => {
        setPendingRole(null)
        toast.error('Could not set up your account', { description: e.message })
      },
    })
  )

  return (
    <div className="mx-auto flex w-full max-w-360 flex-col items-center gap-12 px-4 py-16 md:px-10 md:py-20">
      <header className="flex max-w-225 flex-col items-center gap-4 text-center">
        <h1 className="font-heading text-foreground text-3xl leading-tight font-bold tracking-tight sm:text-4xl md:text-5xl md:leading-[1.17]">
          {name ? `Welcome, ${name.split(' ')[0]}` : 'Welcome to Ticketeur'}
        </h1>
        <p className="font-heading text-muted-foreground max-w-172 text-base leading-7 font-normal sm:text-lg md:text-xl">
          One last thing — how would you like to use Ticketeur? Choose the role
          that best fits your needs.
        </p>
      </header>

      <div className="grid w-full max-w-289.5 grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {ROLES.map((r, i) => (
          <RoleCard
            key={r.role}
            title={r.title}
            description={r.description}
            imageSrc={r.imageSrc}
            imageAlt={r.imageAlt}
            index={i}
            pending={pendingRole === r.role}
            disabled={chooseRole.isPending}
            onSelect={() => {
              setPendingRole(r.role)
              chooseRole.mutate({ role: r.role })
            }}
          />
        ))}
      </div>

      <p className="text-muted-foreground max-w-172 text-center text-sm">
        Organizers and vendors are reviewed before going live — you can finish
        setting up your profile right after this.
      </p>
    </div>
  )
}
