'use client'

import { notFound } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import type { IconSvgElement } from '@hugeicons/react'
import {
  MusicNote03Icon,
  Idea01Icon,
  DrinkIcon,
  UserGroupIcon,
  GameController01Icon,
  CameraVideoIcon,
  Briefcase01Icon,
  PaintBoardIcon,
  StarIcon,
} from '@hugeicons/core-free-icons'

import { useTRPC } from '@/lib/trpc'
import { formatNaira, formatEventDate } from '@/lib/event-display'

import { EventHero } from '@/components/sections/event-detail/event-hero'
import { EventTabs } from '@/components/sections/event-detail/event-tabs'
import { EventContests } from '@/components/sections/event-detail/event-contests'
import { EventForms } from '@/components/sections/event-detail/event-forms'
import { SimilarEvents } from '@/components/sections/event-detail/similar-events'
import { EventDetailSkeleton } from '@/components/sections/event-detail/event-detail-skeleton'
import type { EventVendor } from '@/components/sections/event-detail/vendors-tab'
import type { EventDetailData } from '@/components/sections/event-detail/types'

const FEATURE_ICONS: Record<string, IconSvgElement> = {
  'Live DJ Sets': MusicNote03Icon,
  'Laser Show': Idea01Icon,
  'Open VIP Bar': DrinkIcon,
  Mascots: UserGroupIcon,
  Games: GameController01Icon,
  'Food & Drink': DrinkIcon,
  Workshops: Briefcase01Icon,
  Networking: UserGroupIcon,
  'Live Music': MusicNote03Icon,
  'Photo Booth': CameraVideoIcon,
  'Art Showcase': PaintBoardIcon,
}

function iconForFeature(label: string): IconSvgElement {
  return FEATURE_ICONS[label] ?? StarIcon
}

const EVENT_PLACEHOLDER = '/hero-bg.png'

export function EventDetailContent({ slug }: { slug: string }) {
  const trpc = useTRPC()
  const { data, isLoading } = useQuery(
    trpc.public.events.bySlug.queryOptions({ slug })
  )

  if (isLoading) {
    return <EventDetailSkeleton />
  }
  if (!data) {
    notFound()
  }

  const { event, minPriceMinor } = data

  const detail: EventDetailData = {
    id: event.id,
    slug: event.slug,
    title: event.title,
    status: 'Upcoming Event',
    date: formatEventDate(event.eventDate, event.endDate),
    time: event.eventTime,
    location: event.location,
    imageUrl: event.bannerUrl ?? EVENT_PLACEHOLDER,
    description: event.description ? [event.description] : [],
    features: event.features.map((label) => ({
      icon: iconForFeature(label),
      label,
    })),
    price: minPriceMinor > 0 ? formatNaira(minPriceMinor) : 'Free',
    buyHref: `/events/${event.slug}?tab=tickets`,
  }

  const vendors: EventVendor[] = data.vendors.map((v) => ({
    id: v.id,
    vendorId: v.vendorId,
    businessName: v.businessName,
    businessCategory: v.businessCategory,
    businessDescription: v.businessDescription,
    tagline: v.tagline,
    image: v.image,
  }))

  return (
    <>
      <EventHero event={detail} />
      {/* Renders nothing unless this event has a contest the public may see.
          Its own query, not a field on bySlug: the event read is the hottest
          on the platform and most events have no contest at all. */}
      <EventForms slug={slug} />
      <EventContests slug={slug} />
      <EventTabs event={detail} vendors={vendors} />
      <SimilarEvents eventId={event.id} />
    </>
  )
}
