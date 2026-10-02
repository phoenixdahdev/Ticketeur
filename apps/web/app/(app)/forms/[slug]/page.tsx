import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getBaseUrl } from '@ticketur/api/lib/base-url'

import { FormPageContent } from '@/components/sections/forms/form-page-content'
import { getServerTRPC, HydrateClient } from '@/lib/trpc-server'
import { formatEventDate } from '@/lib/event-display'

const SITE_NAME = 'Ticketeur'
const FALLBACK_IMAGE = '/hero-bg.png'

// The link organizers send out, and the one the admin moderation screen shows:
// /forms/{slug}. Nothing else resolves a form.
//
// Availability is a function of the clock and of how many spots are left, so
// this can't be cached: a form that opened a minute ago must be open here.
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

// Shares the request's query client with the page below, so the form is read
// once and the page's prefetch is a cache hit.
async function loadForm(slug: string) {
  const { trpc, queryClient } = await getServerTRPC()
  return queryClient.fetchQuery(trpc.public.forms.bySlug.queryOptions({ slug }))
}

export async function generateMetadata(
  props: PageProps<'/forms/[slug]'>
): Promise<Metadata> {
  const { slug } = await props.params
  const data = await loadForm(slug)

  if (!data) {
    return {
      title: 'Form not found',
      description: 'This form is no longer available on Ticketeur.',
    }
  }

  const { form, event } = data
  const url = `${getBaseUrl()}/forms/${form.slug}`
  const imageUrl = absoluteUrl(event.bannerUrl)
  const description = form.description
    ? truncate(form.description)
    : `Apply to ${event.title} — ${formatEventDate(event.eventDate, event.endDate)} at ${event.location}. Applications on ${SITE_NAME}.`

  return {
    title: `${form.title} — ${event.title}`,
    description,
    alternates: { canonical: url },
    openGraph: {
      title: form.title,
      description,
      siteName: SITE_NAME,
      url,
      type: 'website',
      images: [{ url: imageUrl, width: 1200, height: 630, alt: event.title }],
    },
    twitter: {
      card: 'summary_large_image',
      title: form.title,
      description,
      images: [imageUrl],
    },
  }
}

export default async function PublicFormPage(
  props: PageProps<'/forms/[slug]'>
) {
  const { slug } = await props.params

  // null means no such form, a form still in draft or under review, or an
  // event that isn't public. None of them should admit the form exists.
  const data = await loadForm(slug)
  if (!data) notFound()

  // Same input as the client's first query, or the key differs and this is
  // thrown away.
  const { trpc, queryClient } = await getServerTRPC()
  await queryClient.prefetchQuery(
    trpc.public.forms.bySlug.queryOptions({ slug })
  )

  return (
    <HydrateClient>
      <section className="mx-auto flex w-full max-w-180 flex-col px-5 py-8 md:py-12">
        <FormPageContent slug={slug} />
      </section>
    </HydrateClient>
  )
}
