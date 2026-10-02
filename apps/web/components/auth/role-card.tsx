'use client'

import Link from 'next/link'
import Image from 'next/image'
import { motion } from 'motion/react'
import { Button } from '@ticketur/ui/components/button'

// Two modes: pass `href` to navigate (signup role selection), or `onSelect` to
// run an action (post-social-signup role choice, which calls the API instead).
export type RoleCardProps = {
  title: string
  description: string
  imageSrc: string
  imageAlt: string
  index?: number
  href?: string
  onSelect?: () => void
  pending?: boolean
  disabled?: boolean
}

export function RoleCard({
  title,
  description,
  imageSrc,
  imageAlt,
  href,
  onSelect,
  pending = false,
  disabled = false,
  index = 0,
}: RoleCardProps) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        delay: 0.05 + index * 0.08,
        duration: 0.5,
        ease: [0.22, 1, 0.36, 1],
      }}
      whileHover={{ y: -4 }}
      className="border-border/60 bg-card group flex w-full flex-col overflow-hidden rounded-xl border shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="bg-muted relative aspect-368/192 overflow-hidden">
        <Image
          src={imageSrc}
          alt={imageAlt}
          fill
          sizes="(min-width: 1024px) 368px, (min-width: 768px) 50vw, 100vw"
          className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          priority={index === 0}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-linear-to-t from-black/20 via-transparent to-transparent"
        />
      </div>

      <div className="flex flex-col gap-4 p-6">
        <div className="flex flex-col gap-2.5">
          <h2 className="font-heading text-foreground text-xl leading-7 font-bold tracking-tight">
            {title}
          </h2>
          <p className="text-muted-foreground text-sm leading-5">
            {description}
          </p>
        </div>

        {href ? (
          <Button size="xl" className="w-full" asChild>
            <Link href={href}>Continue</Link>
          </Button>
        ) : (
          <Button
            size="xl"
            className="w-full"
            onClick={onSelect}
            disabled={disabled || pending}
          >
            {pending ? 'Setting up…' : 'Continue'}
          </Button>
        )}
      </div>
    </motion.article>
  )
}
