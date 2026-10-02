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

// This read IS the prefetch. getServerTRPC is cached per request, so the
// result lands in the very query client HydrateClient dehydrates, under the
// key the client's own bySlug({ slug }) asks for — metadata and the page share
// one database round trip, and the client hydrates instead of refetching.
//
// `undefined` means the read itself failed. A database blip is not a missing
// form: it must not 404 and it must not take the page down, so the page falls
// through and the client query (which retries) picks it up.
async function loadForm(slug: string) {
  const { trpc, queryClient } = await getServerTRPC()
  try {
    return await queryClient.fetchQuery(
      trpc.public.forms.bySlug.queryOptions({ slug })
    )
  } catch {
    return undefined
  }
}

export async function generateMetadata(
  props: PageProps<'/forms/[slug]'>
): Promise<Metadata> {
  const { slug } = await props.params
  const data = await loadForm(slug)

  if (data === undefined) {
    // The read failed; don't claim anything about the form either way.
    return { title: 'Apply' }
  }
  if (data === null) {
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

  // Also the prefetch — see loadForm. null means no such form, a form still in
  // draft or under review, or an event that isn't public; none of them should
  // admit the form exists. undefined is a failed read, which falls through to
  // the client query rather than becoming a 404.
  const data = await loadForm(slug)
  if (data === null) notFound()

  return (
    <HydrateClient>
      <section className="mx-auto flex w-full max-w-180 flex-col px-5 py-8 md:py-12">
        <FormPageContent slug={slug} />
      </section>
    </HydrateClient>
  )
}
