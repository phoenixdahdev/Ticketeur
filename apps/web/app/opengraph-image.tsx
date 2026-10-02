import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const alt =
  'Ticketeur — discover events, book tickets, and find vendors to work with'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

// Brand values mirrored from the design system. Satori cannot parse the
// oklch() custom properties in globals.css, so these are the hex equivalents
// already used elsewhere for non-CSS surfaces (see tickets-pdf.ts) and in the
// logo itself (#1A0D42 ink, #6633FF accent).
const PRIMARY = '#6633FF'
const FOREGROUND = '#1A0D42'
const MUTED = '#4B4B57'
const BACKGROUND = '#FAFAFA'
const BORDER = '#E6E6EA'

// Trap is the heading font. Satori needs TTF/OTF — the repo ships WOFF2 for
// the browser, so these are the same faces converted to OTF.
const [trapBold, trapRegular, logo] = await Promise.all([
  readFile(join(process.cwd(), 'assets/Trap-Bold.otf')),
  readFile(join(process.cwd(), 'assets/Trap-Regular.otf')),
  readFile(join(process.cwd(), 'public/logo.svg')),
])

// Satori renders SVG through <img>, so the real mark is inlined as a data URI
// rather than redrawn.
const logoSrc = `data:image/svg+xml;base64,${logo.toString('base64')}`

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: BACKGROUND,
          fontFamily: 'Trap',
          padding: 72,
        }}
      >
        {/* Wordmark */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoSrc} width={58} height={55} alt="" />
          <div
            style={{
              fontSize: 40,
              fontWeight: 700,
              color: FOREGROUND,
              letterSpacing: -0.5,
            }}
          >
            Ticketeur
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div
            style={{
              display: 'flex',
              fontSize: 76,
              fontWeight: 700,
              color: FOREGROUND,
              lineHeight: 1.1,
              letterSpacing: -2,
              maxWidth: 940,
            }}
          >
            Discover events, book tickets, and find vendors.
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: 32,
              fontWeight: 400,
              color: MUTED,
            }}
          >
            Everything an event needs, in one place.
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderTop: `2px solid ${BORDER}`,
            paddingTop: 28,
          }}
        >
          <div style={{ display: 'flex', fontSize: 28, color: MUTED }}>
            useticketeur.com
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: 26,
              fontWeight: 700,
              color: PRIMARY,
            }}
          >
            Find your next event
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'Trap', data: trapBold, style: 'normal', weight: 700 },
        { name: 'Trap', data: trapRegular, style: 'normal', weight: 400 },
      ],
    }
  )
}
