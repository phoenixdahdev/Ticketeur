import type { MetadataRoute } from 'next'
import { and, eq, inArray } from 'drizzle-orm'

import { db, events, user } from '@ticketur/db'
import { notCurrentlyBanned } from '@ticketur/api/lib/predicates'
import { env } from '@ticketur/env/client'

// A sitemap is a cached Route Handler by default, which would mean querying
// the database during `next build` — and CI builds with a placeholder
// DATABASE_URL. Generating per request keeps the build hermetic; crawlers hit
// this rarely enough that a query per request costs nothing.
export const dynamic = 'force-dynamic'

const STATIC_ROUTES: Array<{
  path: string
  changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency']
  priority: number
}> = [
  { path: '', changeFrequency: 'daily', priority: 1 },
  { path: '/events', changeFrequency: 'daily', priority: 0.9 },
  { path: '/vendors/list', changeFrequency: 'weekly', priority: 0.8 },
  { path: '/vendors', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/organizers', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/get-started', changeFrequency: 'monthly', priority: 0.5 },
  { path: '/terms', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/terms/full', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/privacy', changeFrequency: 'yearly', priority: 0.3 },
]

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')
  const now = new Date()

  // Same visibility rules the public pages enforce, so the sitemap can never
  // advertise a URL that would 404 or leak a hidden entity. Events keep
  // 'upcoming' after they finish, and archived ones stay reachable as a record
  // of what happened — both resolve, so both belong here. 'suspended' and
  // 'draft' do not.
  const [eventRows, vendorRows] = await Promise.all([
    db
      .select({ slug: events.slug, updatedAt: events.updatedAt })
      .from(events)
      .innerJoin(user, eq(user.id, events.organizerId))
      .where(
        and(
          inArray(events.status, ['upcoming', 'archived']),
          notCurrentlyBanned
        )
      ),
    db
      .select({ id: user.id, updatedAt: user.updatedAt })
      .from(user)
      .where(
        and(
          eq(user.role, 'vendor'),
          eq(user.vendorApprovalStatus, 'approved'),
          notCurrentlyBanned
        )
      ),
  ])

  return [
    ...STATIC_ROUTES.map((route) => ({
      url: `${base}${route.path}`,
      lastModified: now,
      changeFrequency: route.changeFrequency,
      priority: route.priority,
    })),
    ...eventRows.map((event) => ({
      url: `${base}/events/${event.slug}`,
      lastModified: event.updatedAt ?? now,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
    ...vendorRows.map((vendor) => ({
      url: `${base}/vendors/${vendor.id}`,
      lastModified: vendor.updatedAt ?? now,
      changeFrequency: 'weekly' as const,
      priority: 0.6,
    })),
  ]
}
