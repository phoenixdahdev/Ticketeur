'use client'

import Image from 'next/image'
import Link from 'next/link'
import { motion } from 'motion/react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Calendar03Icon, Location01Icon } from '@hugeicons/core-free-icons'

import { cn } from '@ticketur/ui/lib/utils'
import { formatEventDateRange } from '@/lib/date'

export type SmallEventStatus = 'upcoming' | 'past' | 'live' | 'sold-out'

export type SmallEventCardProps = {
  id?: string
  title: string
  category: string
  status?: SmallEventStatus
  price: string
  date: string | Date | null
  endDate?: string | Date | null
  location: string
  imageUrl: string
  href?: string
  className?: string
}

const STATUS_CLASSES: Record<SmallEventStatus, string> = {
  upcoming: 'bg-[#dcfce7] text-[#16a34a] dark:bg-[#16a34a]/15',
  past: 'bg-[#ededed] text-[#6d6d6d] dark:bg-white/10 dark:text-muted-foreground',
  live: 'bg-[#fef2f2] text-[#dc2626] dark:bg-[#dc2626]/15',
  'sold-out':
    'bg-[#ededed] text-[#6d6d6d] dark:bg-white/10 dark:text-muted-foreground',
}

const STATUS_LABEL: Record<SmallEventStatus, string> = {
  upcoming: 'Upcoming',
  past: 'Past',
  live: 'Live now',
  'sold-out': 'Sold out',
}

export function SmallEventCard({
  title,
  category,
  status,
  price,
  date,
  endDate,
  location,
  imageUrl,
  href = '#',
  className,
}: SmallEventCardProps) {
  return (
    <motion.article
      whileHover={{ y: -3 }}
      transition={{ type: 'spring', stiffness: 320, damping: 24 }}
      className={cn(
        'group border-border bg-card flex h-full flex-col overflow-hidden rounded-2xl border shadow-sm transition-shadow duration-300 hover:shadow-lg',
        className
      )}
    >
      <div className="bg-muted relative aspect-[298/184] w-full overflow-hidden">
        <Image
          src={imageUrl}
          alt={title}
          fill
          sizes="(min-width: 1024px) 300px, (min-width: 640px) 45vw, 100vw"
          className="object-cover transition-transform duration-500 group-hover:scale-[1.04]"
        />
      </div>

      <div className="flex flex-1 flex-col gap-3 px-4 pt-4">
        <div className="flex items-center gap-2">
          <span className="dark:text-muted-foreground inline-flex rounded bg-[#f1f1f1] px-2 py-0.5 text-[10px] font-semibold tracking-wider text-[#6d6d6d] uppercase dark:bg-white/10">
            {category}
          </span>
          {status ? (
            <span
              className={cn(
                'inline-flex rounded px-2 py-0.5 text-[10px] font-semibold tracking-wide',
                STATUS_CLASSES[status]
              )}
            >
              {STATUS_LABEL[status]}
            </span>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <h3 className="font-heading text-foreground text-lg font-semibold tracking-tight">
            {title}
          </h3>
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <HugeiconsIcon
              icon={Calendar03Icon}
              className="size-4 shrink-0"
              strokeWidth={1.6}
            />
            <span>{formatEventDateRange(date, endDate ?? null)}</span>
          </div>
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <HugeiconsIcon
              icon={Location01Icon}
              className="size-4 shrink-0"
              strokeWidth={1.6}
            />
            <span className="truncate">{location}</span>
          </div>
        </div>
      </div>

      <div className="border-border mt-4 flex items-center justify-between gap-2 border-t px-4 py-4">
        <span className="font-heading text-primary text-lg font-bold">
          {price}
        </span>
        {/* A finished event cannot be bought — the server rejects it too — but
            its page is the public record of what was hosted, so the link stays
            and only the call to action changes. */}
        <Link
          href={href}
          className={cn(
            'text-sm font-medium transition-colors',
            status === 'past'
              ? 'text-muted-foreground hover:text-foreground'
              : 'text-primary hover:text-primary-hover'
          )}
        >
          {status === 'past' ? 'Closed' : 'Buy Ticket'}
        </Link>
      </div>
    </motion.article>
  )
}
