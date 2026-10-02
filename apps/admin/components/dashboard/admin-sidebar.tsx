'use client'

import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { motion } from 'motion/react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import type { IconSvgElement } from '@hugeicons/react'
import {
  DashboardSquare02Icon,
  UserMultiple02Icon,
  Calendar03Icon,
  CreditCardIcon,
  Shield01Icon,
  CouponPercentIcon,
  Mail01Icon,
  MoneyBag02Icon,
  Logout02Icon,
  Settings02Icon,
} from '@hugeicons/core-free-icons'

import { cn } from '@ticketur/ui/lib/utils'
import { Button } from '@ticketur/ui/components/button'
import { LogoIcon } from '@ticketur/ui/icons/logo-icon'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@ticketur/ui/components/avatar'

import { authClient } from '@/lib/auth-client'
import { useTRPC } from '@/lib/trpc'

export type SidebarUser = {
  name: string
  email: string
  image?: string | null
}

type NavLink = {
  href: string
  label: string
  icon: IconSvgElement
}

const NAV_LINKS: NavLink[] = [
  { href: '/', label: 'Overview', icon: DashboardSquare02Icon },
  { href: '/users', label: 'Users', icon: UserMultiple02Icon },
  { href: '/events', label: 'Events', icon: Calendar03Icon },
  { href: '/transactions', label: 'Transactions', icon: CreditCardIcon },
  { href: '/vouchers', label: 'Vouchers', icon: CouponPercentIcon },
  { href: '/emails', label: 'Emails', icon: Mail01Icon },
  { href: '/moderation', label: 'Moderation', icon: Shield01Icon },
  // Money the platform is holding that it may owe back. Carries a live count
  // so an unrefunded charge is noticed from any page, not discovered.
  { href: '/refunds', label: 'Refunds Owed', icon: MoneyBag02Icon },
  // Settings last: it is configuration, not daily work.
  { href: '/settings', label: 'Settings', icon: Settings02Icon },
]

function getInitials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p.charAt(0).toUpperCase())
      .join('') || '?'
  )
}

function isActivePath(pathname: string, href: string) {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function AdminSidebar({
  user,
  onNavigate,
}: {
  user: SidebarUser
  onNavigate?: () => void
}) {
  const router = useRouter()
  const pathname = usePathname() ?? ''
  const trpc = useTRPC()
  const discrepancies = useQuery(
    trpc.admin.paymentDiscrepancies.stats.queryOptions()
  )
  const owedCount = discrepancies.data?.open ?? 0

  async function handleSignOut() {
    onNavigate?.()
    await authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          toast.success('Signed out')
          router.push('/sign-in')
          router.refresh()
        },
        onError: (ctx) => {
          toast.error('Could not sign out', {
            description: ctx.error.message ?? 'Please try again.',
          })
        },
      },
    })
  }

  return (
    <div className="flex h-full flex-col">
      <Link
        href="/"
        aria-label="Ticketeur Admin"
        onClick={onNavigate}
        className="border-border/60 flex items-center gap-2 border-b px-6 py-6"
      >
        <LogoIcon className="h-9 w-auto" />
        <span className="font-heading text-foreground text-xl font-semibold tracking-tight">
          Ticketeur
        </span>
      </Link>

      <nav aria-label="Admin" className="flex-1 px-4 py-6">
        <ul className="flex flex-col gap-1">
          {NAV_LINKS.map((link) => {
            const active = isActivePath(pathname, link.href)
            return (
              <li key={link.href}>
                <Link
                  href={link.href}
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                    active
                      ? 'bg-primary/10 text-primary'
                      : 'text-foreground/70 hover:bg-muted hover:text-foreground'
                  )}
                >
                  {active ? (
                    <motion.span
                      layoutId="admin-sidebar-indicator"
                      className="bg-primary/10 absolute inset-0 rounded-xl"
                      transition={{
                        type: 'spring',
                        stiffness: 380,
                        damping: 30,
                      }}
                    />
                  ) : null}
                  <span className="relative flex flex-1 items-center gap-3">
                    <HugeiconsIcon
                      icon={link.icon}
                      className="size-5"
                      strokeWidth={1.8}
                    />
                    {link.label}
                    {link.href === '/refunds' && owedCount > 0 ? (
                      <span
                        aria-label={`${owedCount} awaiting a refund`}
                        className="bg-destructive text-destructive-foreground ml-auto inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-bold"
                      >
                        {owedCount > 99 ? '99+' : owedCount}
                      </span>
                    ) : null}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      <div className="border-border/60 flex flex-col gap-3 border-t px-4 py-4">
        <div className="-mx-1 flex items-center gap-3 rounded-xl px-3 py-2">
          <Avatar className="border-border/60 size-10 shrink-0 border">
            {user.image ? (
              <AvatarImage src={user.image} alt={user.name} />
            ) : null}
            <AvatarFallback className="bg-primary/10 text-primary text-sm font-semibold">
              {getInitials(user.name)}
            </AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col">
            <span className="text-foreground truncate text-sm font-semibold">
              {user.name}
            </span>
            <span className="text-muted-foreground truncate text-xs">
              Account Settings
            </span>
          </div>
        </div>
        <Button
          type="button"
          size="lg"
          className="justify-center gap-2"
          onClick={handleSignOut}
        >
          <HugeiconsIcon
            icon={Logout02Icon}
            className="size-5"
            strokeWidth={1.8}
          />
          Sign Out
        </Button>
      </div>
    </div>
  )
}
