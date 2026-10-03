import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getBaseUrl } from '@ticketur/api/lib/base-url'

import { ContestPageContent } from '@/components/sections/contests/contest-page-content'
import { getServerTRPC, HydrateClient } from '@/lib/trpc-server'
import { formatEventDate } from '@/lib/event-display'

const SITE_NAME = 'Ticketeur'
const FALLBACK_IMAGE = '/hero-bg.png'

// The link in the "your votes are ready" and "your code" emails, and the one
// the organizer shares: /contests/{slug}. Nothing else resolves a contest.
//
// Never cached. Whether voting is open is a function of the clock, and the
// vote counts are the point of the page — a contest that opened a minute ago
// must be open here, and a leaderboard served from a cache is not a
// leaderboard. (`force-dynamic` rather than `connection()`, matching
// /forms/[slug]: one convention for the public pages that must not be stale.)
export const dynamic = 'force-dynamic'

function absoluteUrl(value: string | null | undefined): string {
  if (!value) return `${getBaseUrl()}${FALLBACK_IMAGE}`
  if (/^https?:\/\//.test(value) || value.startsWith('data:')) return value
  return `${getBaseUrl()}${value.startsWith('/') ? value : `/${value}`}`
}

function truncate(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  return `${flat.slice(0, max - 1).trimEnd()}…`
}

// This read IS the prefetch. getServerTRPC is cached per request, so the
// result lands in the very query client HydrateClient dehydrates, under the
// key the client's own bySlug({ slug }) asks for — metadata and the page
// share one database round trip, and the client hydrates instead of
// refetching.
//
// `undefined` means the read itself failed. A database blip is not a missing
// contest: it must not 404 and it must not take the page down, so the page
// falls through and the client query (which retries) picks it up.
async function loadContest(slug: string) {
  const { trpc, queryClient } = await getServerTRPC()
  try {
    return await queryClient.fetchQuery(
      trpc.public.contests.bySlug.queryOptions({ slug })
    )
  } catch {
    return undefined
  }
}

export async function generateMetadata(
  props: PageProps<'/contests/[slug]'>
): Promise<Metadata> {
  const { slug } = await props.params
  const data = await loadContest(slug)

  if (data === undefined) {
    // The read failed; don't claim anything about the contest either way.
    return { title: 'Vote' }
  }
  if (data === null) {
    return {
      title: 'Contest not found',
      description: 'This contest is no longer available on Ticketeur.',
    }
  }

  const { contest, event } = data
  const url = `${getBaseUrl()}/contests/${contest.slug}`
  const imageUrl = absoluteUrl(event.bannerUrl)
  const description = contest.description
    ? truncate(contest.description)
    : `Vote in ${contest.title} at ${event.title} — ${formatEventDate(event.eventDate, event.endDate)}, ${event.location}. Voting on ${SITE_NAME}.`

  return {
    title: `${contest.title} — ${event.title}`,
    description,
    alternates: { canonical: url },
    openGraph: {
      title: contest.title,
      description,
      siteName: SITE_NAME,
      url,
      type: 'website',
      images: [{ url: imageUrl, width: 1200, height: 630, alt: event.title }],
    },
    twitter: {
      card: 'summary_large_image',
      title: contest.title,
      description,
      images: [imageUrl],
    },
  }
}

export default async function PublicContestPage(
  props: PageProps<'/contests/[slug]'>
) {
  const { slug } = await props.params

  // Also the prefetch — see loadContest. null means no such contest, one
  // still in draft or under review, one an admin has suspended, or an event
  // that isn't public; none of them should admit the contest exists.
  // undefined is a failed read, which falls through to the client query
  // rather than becoming a 404.
  const data = await loadContest(slug)
  if (data === null) notFound()

  return (
    <HydrateClient>
      <section className="mx-auto flex w-full max-w-200 flex-col px-5 py-8 md:py-12">
        <ContestPageContent slug={slug} />
      </section>
    </HydrateClient>
  )
}
