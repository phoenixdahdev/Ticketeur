import type { MetadataRoute } from 'next'

import { env } from '@ticketur/env/client'

export default function robots(): MetadataRoute.Robots {
  const base = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
        // Signed-in areas. Note `/vendor/` is the vendor dashboard — the
        // public directory lives at `/vendors/` and is deliberately not
        // matched by this prefix.
        '/org/',
        '/vendor/',
        '/account/',
        '/tickets/',
        '/checkout/',
        // Auth and onboarding. None of these are landing pages, and several
        // only resolve with a one-time token.
        '/login',
        '/signup',
        '/forgot-password',
        '/reset-password',
        '/verify-email',
        '/two-factor',
        '/post-login',
        '/welcome',
      ],
    },
    sitemap: `${base}/sitemap.xml`,
    host: base,
  }
}
