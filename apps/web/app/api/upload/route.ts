import { NextResponse } from 'next/server'
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'

import { auth } from '@/lib/auth'

// Upload kinds — each maps to a folder + size/type policy.
const UPLOAD_KINDS = {
  'event-banner': {
    folder: 'events/banners',
    maxBytes: 8 * 1024 * 1024,
    allow: ['image/jpeg', 'image/png', 'image/webp', 'image/avif'],
    requireOrganizer: true,
  },
  'vendor-logo': {
    folder: 'vendors/logos',
    maxBytes: 2 * 1024 * 1024,
    allow: [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/avif',
      'image/svg+xml',
    ],
    requireVendor: true,
  },
  'org-logo': {
    folder: 'organizers/logos',
    maxBytes: 2 * 1024 * 1024,
    allow: [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/avif',
      'image/svg+xml',
    ],
    requireOrganizer: true,
  },
  'vendor-banner': {
    folder: 'vendors/banners',
    maxBytes: 8 * 1024 * 1024,
    allow: ['image/jpeg', 'image/png', 'image/webp', 'image/avif'],
    requireVendor: true,
  },
  'vendor-showcase': {
    folder: 'vendors/showcase',
    maxBytes: 6 * 1024 * 1024,
    allow: ['image/jpeg', 'image/png', 'image/webp', 'image/avif'],
    requireVendor: true,
  },
  // Registration-form answers (image / images / file fields). Deliberately
  // role-free: an applicant is whoever signed in — usually an attendee — so
  // requiring a role here would make every upload field unusable. A session
  // is still required (above), and the per-user prefix still applies.
  //
  // The MIME lists mirror IMAGE_MIME_TYPES / PDF_MIME_TYPES in
  // packages/api/src/lib/form-fields.ts, which is what validates the stored
  // URL at submit; a field may accept fewer types than its kind allows, and
  // the server enforces that per field.
  'form-image': {
    folder: 'forms/images',
    maxBytes: 8 * 1024 * 1024,
    allow: ['image/jpeg', 'image/png', 'image/webp', 'image/avif'],
  },
  'form-document': {
    folder: 'forms/documents',
    maxBytes: 8 * 1024 * 1024,
    allow: ['application/pdf'],
  },
} as const

type UploadKind = keyof typeof UPLOAD_KINDS

function isUploadKind(value: unknown): value is UploadKind {
  return typeof value === 'string' && value in UPLOAD_KINDS
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as HandleUploadBody

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const session = await auth.api.getSession({ headers: request.headers })
        if (!session) {
          throw new Error('Not authenticated')
        }

        const role = session.user.role ?? 'attendee'

        // clientPayload encodes the upload kind so a vendor can't accidentally
        // (or maliciously) write to /events/banners/* and vice versa.
        let kind: UploadKind | null = null
        if (clientPayload) {
          try {
            const parsed = JSON.parse(clientPayload) as { kind?: unknown }
            if (isUploadKind(parsed.kind)) kind = parsed.kind
          } catch {
            // fall through — kind stays null and we reject below
          }
        }

        if (!kind) {
          throw new Error('Missing or invalid upload kind')
        }

        const policy = UPLOAD_KINDS[kind]

        if (
          'requireOrganizer' in policy &&
          policy.requireOrganizer &&
          role !== 'organizer' &&
          role !== 'admin'
        ) {
          throw new Error('Organizer role required for this upload')
        }
        if (
          'requireVendor' in policy &&
          policy.requireVendor &&
          role !== 'vendor' &&
          role !== 'admin'
        ) {
          throw new Error('Vendor role required for this upload')
        }

        // Re-scope the pathname to the policy folder + a per-user prefix so
        // users can't write outside their own namespace. addRandomSuffix
        // guarantees no overwrites between distinct uploads.
        const safeName = pathname.split('/').pop() ?? 'file'
        const prefixedPathname = `${policy.folder}/${session.user.id}/${safeName}`

        return {
          pathname: prefixedPathname,
          allowedContentTypes: [...policy.allow],
          maximumSizeInBytes: policy.maxBytes,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({
            userId: session.user.id,
            kind,
          }),
        } as const
      },
      onUploadCompleted: async () => {
        // Successful uploads are reflected in the form's onChange handler on
        // the client side. No DB write here — the URL gets persisted when the
        // user submits the surrounding form (event create, vendor profile).
      },
    })

    return NextResponse.json(jsonResponse)
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 }
    )
  }
}
