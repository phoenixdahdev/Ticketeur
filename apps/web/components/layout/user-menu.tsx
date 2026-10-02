'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion, type Variants } from 'motion/react'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  UserIcon,
  Settings02Icon,
  Logout02Icon,
  Ticket01Icon,
  File01Icon,
  DashboardSquare02Icon,
} from '@hugeicons/core-free-icons'

import { cn } from '@ticketur/ui/lib/utils'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@ticketur/ui/components/avatar'

import { authClient } from '@/lib/auth-client'

export type UserMenuUser = {
  name: string
  email: string
  image?: string | null
}

function getInitials(name: string) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
  return initials || '?'
}

const panelVariants: Variants = {
  hidden: {
    opacity: 0,
    y: -8,
    scale: 0.94,
    transition: {
      duration: 0.14,
      ease: [0.4, 0, 1, 1],
      when: 'afterChildren',
      staggerChildren: 0.02,
      staggerDirection: -1,
    },
  },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.22,
      ease: [0.22, 1, 0.36, 1],
      when: 'beforeChildren',
      staggerChildren: 0.04,
      delayChildren: 0.04,
    },
  },
}

const itemVariants: Variants = {
  hidden: { opacity: 0, x: -6 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.24, ease: [0.22, 1, 0.36, 1] },
  },
}

export function UserMenu({
  user,
  dashboardHref,
}: {
  user: UserMenuUser
  dashboardHref?: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return

    function onPointerDown(e: PointerEvent) {
      const el = containerRef.current
      if (!el) return
      if (el.contains(e.target as Node)) return
      setOpen(false)
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function handleSignOut() {
    setOpen(false)
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
    <div ref={containerRef} className="relative">
      <motion.button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Open account menu"
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.92 }}
        transition={{ type: 'spring', stiffness: 420, damping: 22 }}
        className="focus-visible:ring-primary/40 rounded-full transition-shadow outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
      >
        <Avatar
          className={cn(
            'size-10 border-2 transition-colors md:size-11',
            open ? 'border-primary' : 'border-border/60 hover:border-primary/60'
          )}
        >
          {user.image ? <AvatarImage src={user.image} alt={user.name} /> : null}
          <AvatarFallback className="bg-primary/10 text-primary text-sm font-semibold">
            {getInitials(user.name)}
          </AvatarFallback>
        </Avatar>
      </motion.button>

      <AnimatePresence>
        {open ? (
          <motion.div
            role="menu"
            aria-label="Account menu"
            variants={panelVariants}
            initial="hidden"
            animate="visible"
            exit="hidden"
            style={{ transformOrigin: 'top right' }}
            className="border-border/70 bg-popover text-popover-foreground absolute top-[calc(100%+10px)] right-0 z-50 w-64 overflow-hidden rounded-2xl border shadow-lg shadow-black/5 dark:shadow-black/30"
          >
            <motion.div
              variants={itemVariants}
              className="border-border/60 flex items-center gap-3 border-b px-4 py-3"
            >
              <Avatar className="size-10 shrink-0">
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
                  {user.email}
                </span>
              </div>
            </motion.div>

            <nav className="flex flex-col p-1">
              {dashboardHref ? (
                <MenuLink
                  href={dashboardHref}
                  icon={DashboardSquare02Icon}
                  label="Dashboard"
                  onClick={() => setOpen(false)}
                />
              ) : null}
              <MenuLink
                href="/account"
                icon={UserIcon}
                label="Profile"
                onClick={() => setOpen(false)}
              />
              <MenuLink
                href="/account/tickets"
                icon={Ticket01Icon}
                label="My tickets"
                onClick={() => setOpen(false)}
              />
              <MenuLink
                href="/account/applications"
                icon={File01Icon}
                label="My applications"
                onClick={() => setOpen(false)}
              />
              <MenuLink
                href="/account/settings"
                icon={Settings02Icon}
                label="Settings"
                onClick={() => setOpen(false)}
              />
            </nav>

            <motion.div
              variants={itemVariants}
              className="border-border/60 border-t p-1"
            >
              <button
                type="button"
                role="menuitem"
                onClick={handleSignOut}
                className="text-destructive hover:bg-destructive/10 focus-visible:bg-destructive/10 focus-visible:ring-destructive/40 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors outline-none focus-visible:ring-2"
              >
                <HugeiconsIcon
                  icon={Logout02Icon}
                  className="size-4"
                  strokeWidth={1.8}
                />
                Sign out
              </button>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

type IconData = Parameters<typeof HugeiconsIcon>[0]['icon']

function MenuLink({
  href,
  icon,
  label,
  onClick,
}: {
  href: string
  icon: IconData
  label: string
  onClick: () => void
}) {
  return (
    <motion.div variants={itemVariants}>
      <Link
        href={href}
        role="menuitem"
        onClick={onClick}
        className="text-foreground hover:bg-muted focus-visible:bg-muted focus-visible:ring-primary/40 flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors outline-none focus-visible:ring-2"
      >
        <HugeiconsIcon
          icon={icon}
          className="text-muted-foreground size-4"
          strokeWidth={1.8}
        />
        {label}
      </Link>
    </motion.div>
  )
}
