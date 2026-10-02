'use client'

import { upload } from '@vercel/blob/client'

type UploadResult = {
  url: string
  pathname: string
  contentType: string
  contentDisposition: string
  downloadUrl?: string
}

export type UploadKind =
  | 'event-banner'
  | 'vendor-logo'
  | 'vendor-banner'
  | 'vendor-showcase'
  | 'org-logo'
  | 'form-image'
  | 'form-document'

export type UploadProgress = {
  loaded: number
  total: number
  percentage: number
}

export type UploadFileOptions = {
  kind: UploadKind
  file: File
  // Overrides the stored file name. Registration-form uploads use it to force
  // an extension that matches the file's real type, because the server reads
  // the type back off the stored URL (uploadUrlError in
  // packages/api/src/lib/form-fields.ts) and a phone can hand us a photo
  // named with no extension at all.
  name?: string
  onProgress?: (progress: UploadProgress) => void
  signal?: AbortSignal
}

export async function uploadFile({
  kind,
  file,
  name,
  onProgress,
  signal,
}: UploadFileOptions): Promise<UploadResult> {
  const result = await upload(name ?? file.name, file, {
    access: 'public',
    handleUploadUrl: '/api/upload',
    clientPayload: JSON.stringify({ kind }),
    onUploadProgress: onProgress,
    abortSignal: signal,
  })
  return result as UploadResult
}
