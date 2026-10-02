import { z } from 'zod'
import { createEnv } from '@t3-oss/env-nextjs'

export const env = createEnv({
  client: {
    NEXT_PUBLIC_APP_URL: z.url().default('http://localhost:3000'),
    // GA4 measurement ID. Optional on purpose: unset means no analytics is
    // loaded at all, so local runs and preview deploys stay out of the
    // production property. Set it in the production environment only.
    NEXT_PUBLIC_GA_ID: z.string().optional(),
  },
  runtimeEnv: {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_GA_ID: process.env.NEXT_PUBLIC_GA_ID,
  },
  emptyStringAsUndefined: true,
})
