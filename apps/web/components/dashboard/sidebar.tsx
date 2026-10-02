'use client'

import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { motion } from 'motion/react'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import type { IconSvgElement } from '@hugeicons/react'
import {
  DashboardSquare02Icon,
  Calendar03Icon,
  Analytics01Icon,
  CheckListIcon,
  Logout02Icon,
  Tag01Icon,
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

export type SidebarUser = {
  name: string
  email: string
  image?: string | null
}

export type SidebarNavLink = {
  href: string
  label: string
  icon: IconSvgElement
}

export type SidebarConfig = {
  homeHref: string
  navLinks: SidebarNavLink[]
  profileHref: string
  profileLabel: string
}

export const ORG_SIDEBAR_CONFIG: SidebarConfig = {
  homeHref: '/org/dashboard',
  navLinks: [
    { href: '/org/dashboard', label: 'Overview', icon: DashboardSquare02Icon },
    { href: '/org/events', label: 'My Events', icon: Calendar03Icon },
    { href: '/org/forms', label: 'Forms', icon: CheckListIcon },
    { href: '/org/vouchers', label: 'Vouchers', icon: Tag01Icon },
  ],
  profileHref: '/org/profile',
  profileLabel: 'Account Settings',
}

export const VENDOR_SIDEBAR_CONFIG: SidebarConfig = {
  homeHref: '/vendor/dashboard',
  navLinks: [
    {
      href: '/vendor/dashboard',
      label: 'Overview',
      icon: DashboardSquare02Icon,
    },
    { href: '/vendor/events', label: 'Events', icon: Calendar03Icon },
    { href: '/vendor/analytics', label: 'Analytics', icon: Analytics01Icon },
  ],
  profileHref: '/vendor/profile',
  profileLabel: 'Profile',
}

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
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function Sidebar({
  user,
  config = ORG_SIDEBAR_CONFIG,
  onNavigate,
}: {
  user: SidebarUser
  config?: SidebarConfig
  onNavigate?: () => void
}) {
  const router = useRouter()
  const pathname = usePathname() ?? ''

  async function handleSignOut() {
    onNavigate?.()
    await authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          toast.success('Signed out')
          router.push('/')
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
        href={config.homeHref}
        aria-label="Ticketeur home"
        onClick={onNavigate}
        className="border-border/60 flex items-center gap-2 border-b px-6 py-6"
      >
        <LogoIcon className="h-9 w-auto" />
        <span className="font-heading text-foreground text-xl font-semibold tracking-tight">
          Ticketeur
        </span>
      </Link>

      <nav aria-label="Dashboard" className="flex-1 px-4 py-6">
        <ul className="flex flex-col gap-1">
          {config.navLinks.map((link) => {
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
                      layoutId="org-sidebar-indicator"
                      className="bg-primary/10 absolute inset-0 rounded-xl"
                      transition={{
                        type: 'spring',
                        stiffness: 380,
                        damping: 30,
                      }}
                    />
                  ) : null}
                  <span className="relative flex items-center gap-3">
                    <HugeiconsIcon
                      icon={link.icon}
                      className="size-5"
                      strokeWidth={1.8}
                    />
                    {link.label}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      <div className="border-border/60 flex flex-col gap-3 border-t px-4 py-4">
        <Link
          href={config.profileHref}
          onClick={onNavigate}
          className="hover:bg-muted -mx-1 flex items-center gap-3 rounded-xl px-3 py-2 transition-colors"
        >
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
              {config.profileLabel}
            </span>
          </div>
        </Link>
        <Button
          type="button"
          size="lg"
          variant="outline"
          className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive justify-center gap-2"
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
