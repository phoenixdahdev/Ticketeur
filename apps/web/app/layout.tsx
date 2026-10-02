import './globals.css'
import type { Metadata } from 'next'
import { GoogleAnalytics } from '@next/third-parties/google'
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import { DefaultProvider } from '@ticketur/ui/providers/default-provider'
import { transformaSans, trap } from '@ticketur/ui/fonts'
import { cn } from '@ticketur/ui/lib/utils'
import { WebVitals } from '@ticketur/observability/client'
import { env } from '@ticketur/env/client'

// 56 characters: long enough to use the SERP line, short enough not to be
// truncated. Keywords lead, brand closes — matching the `%s | Ticketeur`
// template the rest of the pages render through.
const TITLE = 'Discover Events, Book Tickets & Find Vendors | Ticketeur'

// 157 characters — fills the SERP snippet without being truncated at ~160.
const DESCRIPTION =
  'Discover events near you, book tickets in minutes, and find trusted vendors for your next event. Ticketeur brings organizers, attendees and vendors together.'

export const metadata: Metadata = {
  // Resolves relative URLs in Open Graph/Twitter metadata, and silences the
  // build warning Next emits when it has no origin to resolve them against.
  metadataBase: new URL(env.NEXT_PUBLIC_APP_URL),
  title: {
    default: TITLE,
    template: '%s | Ticketeur',
  },
  description: DESCRIPTION,
  icons: {
    icon: '/logo.svg',
  },
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    siteName: 'Ticketeur',
    url: '/',
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className={cn(
          'font-sans antialiased',
          transformaSans.variable,
          trap.variable
        )}
      >
        <WebVitals />
        <NuqsAdapter>
          <DefaultProvider
            useLens={false}
            trpcUrl="/api/trpc"
            defaultTheme="light"
          >
            {children}
          </DefaultProvider>
        </NuqsAdapter>
      </body>
      {/* Loads gtag.js after hydration. Rendered only when the measurement ID
          is set, so preview and local builds ship no analytics at all. */}
      {env.NEXT_PUBLIC_GA_ID ? (
        <GoogleAnalytics gaId={env.NEXT_PUBLIC_GA_ID} />
      ) : null}
    </html>
  )
}
