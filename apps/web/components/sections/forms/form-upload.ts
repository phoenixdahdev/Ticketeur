'use client'

import { uploadUrlError } from '@ticketur/api/lib/form-fields'

import { uploadFile, type UploadKind, type UploadProgress } from '@/lib/upload'

// Uploading an answer. Phone uploads fail often — a tunnel, a dropped signal,
// a 12 MP photo on 3G — so everything here is built to fail loudly and early
// rather than at submit: the wrong type and the oversized file are turned away
// before a byte leaves the device, and the stored URL is checked against the
// very rule the server will apply when it validates the answer.

// Mirrors the per-kind maximumSizeInBytes in app/api/upload/route.ts. Checked
// here only so an 11 MB photo is refused instantly with a readable message,
// rather than after a two-minute upload on mobile data. The route is the
// authority.
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'application/pdf': 'pdf',
}

const LABEL_BY_MIME: Record<string, string> = {
  'image/jpeg': 'JPG',
  'image/png': 'PNG',
  'image/webp': 'WEBP',
  'image/avif': 'AVIF',
  'application/pdf': 'PDF',
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// "JPG, PNG or WEBP"
export function describeAccepted(accepted: readonly string[]): string {
  const labels = accepted.map((mime) => LABEL_BY_MIME[mime] ?? mime)
  if (labels.length <= 1) return labels[0] ?? 'file'
  return `${labels.slice(0, -1).join(', ')} or ${labels[labels.length - 1]}`
}

// The file picker's filter. Phone cameras ignore it often enough that
// fileRejection below still has to check.
export function acceptAttribute(accepted: readonly string[]): string {
  return accepted.join(',')
}

function uploadKindFor(accepted: readonly string[]): UploadKind {
  // A field is either an image field or the PDF one; never both.
  return accepted.includes('application/pdf') ? 'form-document' : 'form-image'
}

// Why this file can't be uploaded here, or null when it can.
export function fileRejection(
  file: File,
  accepted: readonly string[]
): string | null {
  if (file.size === 0) return 'That file is empty'
  if (file.size > MAX_UPLOAD_BYTES) {
    return `That file is ${formatBytes(file.size)} — the limit is ${formatBytes(MAX_UPLOAD_BYTES)}`
  }
  if (!accepted.includes(file.type)) {
    // A HEIC photo straight off an iPhone lands here, and it is the single
    // most likely rejection, so say what to do about it.
    return `That file isn't a ${describeAccepted(accepted)}`
  }
  return null
}

// A storage name with an extension that matches the file's real type.
//
// The server reads an upload's type back off the stored URL's extension
// (uploadUrlError in packages/api/src/lib/form-fields.ts), and a phone will
// happily hand us "image" with no extension at all, or "photo.HEIC" for
// something the browser reports as image/jpeg. Deriving the extension from the
// type keeps the two in step.
function storageName(file: File): string {
  const extension = EXTENSION_BY_MIME[file.type]
  const base =
    file.name
      .replace(/\.[^.]*$/, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '')
      .slice(0, 60) || 'upload'
  return extension ? `${base}.${extension}` : base
}

export type UploadAnswerArgs = {
  file: File
  accepted: readonly string[]
  onProgress?: (progress: UploadProgress) => void
  signal?: AbortSignal
}

// Uploads one answer file and returns the URL to store. Throws with a message
// meant to be shown as-is.
export async function uploadAnswerFile({
  file,
  accepted,
  onProgress,
  signal,
}: UploadAnswerArgs): Promise<string> {
  const rejection = fileRejection(file, accepted)
  if (rejection) throw new Error(rejection)

  const result = await uploadFile({
    kind: uploadKindFor(accepted),
    file,
    name: storageName(file),
    onProgress,
    signal,
  })

  // The same check the server runs at submit. If the stored URL wouldn't pass
  // there, say so now — while the file is still in hand and retrying costs one
  // tap — rather than at the end of a long form.
  const urlError = uploadUrlError(result.url, accepted)
  if (urlError) throw new Error(urlError)

  return result.url
}

// An aborted upload is the applicant pressing "remove", not a failure.
export function isAbort(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true
  return error instanceof Error && /abort/i.test(error.message)
}

export function uploadErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : ''
  if (!raw) return "That upload didn't go through. Please try again."
  if (/not authenticated/i.test(raw)) {
    return 'Your session expired. Sign in again to upload.'
  }
  if (/failed to fetch|network|load failed/i.test(raw)) {
    return "The connection dropped mid-upload. Tap retry when you're back online."
  }
  return raw
}
