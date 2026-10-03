import type { Metadata } from 'next'
import { getBaseUrl } from '@ticketur/api/lib/base-url'
import { and, eq } from 'drizzle-orm'

import { db, events } from '@ticketur/db'

import { EventDetailContent } from '@/components/sections/event-detail/event-detail-content'
import { getServerTRPC, HydrateClient } from '@/lib/trpc-server'
import { formatEventDate } from '@/lib/event-display'

const SITE_NAME = 'Ticketeur'
const FALLBACK_IMAGE = '/hero-bg.png'

// Strip markdown to plain text for use in <meta name="description">.
// We don't need a perfect renderer — just remove the obvious noisy tokens.
function markdownToPlain(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, ' ') // fenced code blocks
    .replace(/`([^`]+)`/g, '$1') // inline code
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1') // images
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
    .replace(/^#{1,6}\s+/gm, '') // headings
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1') // bold / italic
    .replace(/^>\s?/gm, '') // blockquotes
    .replace(/^[-*+]\s+/gm, '') // lists
    .replace(/\s+/g, ' ') // collapse whitespace
    .trim()
}

function truncate(text: string, max = 160): string {
  if (text.length <= max) return text
  return text.slice(0, max - 1).trimEnd() + '…'
}

function absoluteUrl(value: string | null | undefined): string {
  if (!value) return `${getBaseUrl()}${FALLBACK_IMAGE}`
  if (/^https?:\/\//.test(value) || value.startsWith('data:')) return value
  return `${getBaseUrl()}${value.startsWith('/') ? value : `/${value}`}`
}

export async function generateMetadata({
  params,
}: PageProps<'/events/[slug]'>): Promise<Metadata> {
  const { slug } = await params

  const [event] = await db
    .select({
      id: events.id,
      slug: events.slug,
      title: events.title,
      description: events.description,
      bannerUrl: events.bannerUrl,
      eventDate: events.eventDate,
      endDate: events.endDate,
      eventTime: events.eventTime,
      location: events.location,
      status: events.status,
    })
    .from(events)
    .where(and(eq(events.slug, slug), eq(events.status, 'upcoming')))
    .limit(1)

  if (!event) {
    return {
      title: 'Event not found',
      description: 'This event is no longer available on Ticketeur.',
    }
  }

  const baseUrl = getBaseUrl()
  const url = `${baseUrl}/events/${event.slug}`
  const imageUrl = absoluteUrl(event.bannerUrl)
  const plain = markdownToPlain(event.description ?? '')
  const description =
    plain.length > 0
      ? truncate(plain, 160)
      : `${formatEventDate(event.eventDate, event.endDate)} at ${event.location}. Get your tickets on ${SITE_NAME}.`

  return {
    title: event.title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title: event.title,
      description,
      siteName: SITE_NAME,
      url,
      type: 'website',
      images: [
        {
          url: imageUrl,
          width: 1200,
          height: 630,
          alt: event.title,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: event.title,
      description,
      images: [imageUrl],
    },
    other: {
      ...(event.eventDate ? { 'event:start_date': event.eventDate } : {}),
      'event:start_time': event.eventTime,
      'event:location': event.location,
    },
  }
}

export default async function EventDetailPage({
  params,
}: PageProps<'/events/[slug]'>) {
  const { slug } = await params
  // Prefetch the event so the detail view (and the tickets tab, which shares
  // this query key) hydrate instead of fetching client-side.
  const { trpc, queryClient } = await getServerTRPC()
  await Promise.all([
    queryClient.prefetchQuery(trpc.public.events.bySlug.queryOptions({ slug })),
    // The contests on this event, so the link to one is on the page the
    // moment it paints rather than after the client has fetched.
    queryClient.prefetchQuery(
      trpc.public.contestDiscovery.forEvent.queryOptions({ eventSlug: slug })
    ),
  ])
  return (
    <HydrateClient>
      <EventDetailContent slug={slug} />
    </HydrateClient>
  )
}
