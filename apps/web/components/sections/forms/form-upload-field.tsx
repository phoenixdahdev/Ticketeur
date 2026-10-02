'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Alert02Icon,
  Cancel01Icon,
  Delete02Icon,
  ImageAdd01Icon,
  Pdf01Icon,
  RefreshIcon,
  SquareLock02Icon,
  Upload01Icon,
} from '@hugeicons/core-free-icons'

import { cn } from '@ticketur/ui/lib/utils'
import { Button } from '@ticketur/ui/components/button'
import { Progress } from '@ticketur/ui/components/progress'

import {
  acceptAttribute,
  describeAccepted,
  fileRejection,
  formatBytes,
  isAbort,
  MAX_UPLOAD_BYTES,
  uploadAnswerFile,
  uploadErrorMessage,
} from '@/components/sections/forms/form-upload'
import type { PublicField } from '@/components/sections/forms/types'

// An upload answer, from the picker to a stored URL.
//
// The rule this is built around: one failed upload must never cost the other
// answers. So a URL is committed to the answer the moment it lands, and
// everything still in flight lives here beside it. A dropped connection
// leaves one retryable tile, not an empty form.
//
// Committed URLs are the parent's `value` — which is what the draft saves and
// what submit sends. Anything uploading, blocked on sign-in, or failed is
// local: it has no URL yet, so there is nothing to answer with.

type PendingStatus = 'uploading' | 'blocked' | 'error'

type Pending = {
  key: string
  name: string
  size: number
  // An object URL for an image, so the applicant sees their photo straight
  // away rather than a spinner over a slow upload.
  previewUrl: string | null
  status: PendingStatus
  progress: number
  error: string | null
  // A file rejected for its type or size can't be retried — only replaced.
  retryable: boolean
}

function asUrlList(value: unknown): string[] {
  if (typeof value === 'string') return value ? [value] : []
  if (Array.isArray(value))
    return value.filter((v): v is string => typeof v === 'string')
  return []
}

export function FormUploadField({
  field,
  value,
  onChange,
  invalid,
  describedBy,
  signedIn,
  onRequestSignin,
  onBusyChange,
  disabled,
}: {
  field: PublicField
  value: unknown
  onChange: (next: string | string[] | undefined) => void
  invalid: boolean
  describedBy?: string
  signedIn: boolean
  // Uploading needs an account (the blob route refuses an anonymous upload),
  // so picking a file while signed out opens the sign-in dialog and the file
  // waits here rather than being thrown away.
  onRequestSignin: () => void
  // Lets the form refuse to submit while a photo is still going up.
  onBusyChange: (busy: boolean) => void
  disabled?: boolean
}) {
  const inputId = useId()
  const accepted = field.acceptedFileTypes ?? []
  const multiple = field.type === 'images'
  const maxFiles = multiple ? (field.maxFiles ?? 5) : 1
  const isPdf = field.type === 'file'

  const committed = asUrlList(value)
  const [pending, setPending] = useState<Pending[]>([])

  // Files and abort handles are not state: they never render, and keeping
  // them out of state keeps retry free of stale closures.
  const filesRef = useRef(new Map<string, File>())
  const abortRef = useRef(new Map<string, AbortController>())
  const previewRef = useRef(new Map<string, string>())
  const inputRef = useRef<HTMLInputElement>(null)

  // onChange would otherwise have to be in every callback's dependency list.
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const committedRef = useRef(committed)
  committedRef.current = committed

  const uploading = pending.some((p) => p.status === 'uploading')
  const busyChangeRef = useRef(onBusyChange)
  busyChangeRef.current = onBusyChange
  useEffect(() => {
    busyChangeRef.current(uploading)
  }, [uploading])

  const forget = useCallback((key: string) => {
    abortRef.current.get(key)?.abort()
    abortRef.current.delete(key)
    filesRef.current.delete(key)
    const preview = previewRef.current.get(key)
    if (preview) {
      URL.revokeObjectURL(preview)
      previewRef.current.delete(key)
    }
  }, [])

  // Abort anything still running and release every object URL.
  useEffect(() => {
    const aborts = abortRef.current
    const previews = previewRef.current
    return () => {
      for (const controller of aborts.values()) controller.abort()
      for (const url of previews.values()) URL.revokeObjectURL(url)
      aborts.clear()
      previews.clear()
    }
  }, [])

  const commit = useCallback(
    (url: string) => {
      const next = multiple ? [...committedRef.current, url] : url
      committedRef.current = multiple ? (next as string[]) : [url]
      onChangeRef.current(next)
    },
    [multiple]
  )

  const runUpload = useCallback(
    async (key: string) => {
      const file = filesRef.current.get(key)
      if (!file) return

      const controller = new AbortController()
      abortRef.current.set(key, controller)
      setPending((items) =>
        items.map((p) =>
          p.key === key
            ? { ...p, status: 'uploading', progress: 0, error: null }
            : p
        )
      )

      try {
        const url = await uploadAnswerFile({
          file,
          accepted,
          signal: controller.signal,
          onProgress: ({ percentage }) => {
            setPending((items) =>
              items.map((p) =>
                p.key === key ? { ...p, progress: percentage } : p
              )
            )
          },
        })
        // Committed first, then dropped from the pending list, so the tile
        // never blinks empty between the two.
        commit(url)
        forget(key)
        setPending((items) => items.filter((p) => p.key !== key))
      } catch (err) {
        abortRef.current.delete(key)
        // An abort is the applicant pressing remove; the tile is already gone.
        if (isAbort(err) || controller.signal.aborted) return
        const message = uploadErrorMessage(err)
        setPending((items) =>
          items.map((p) =>
            p.key === key
              ? { ...p, status: 'error', error: message, retryable: true }
              : p
          )
        )
      }
    },
    [accepted, commit, forget]
  )

  // Files picked while signed out wait here. Once there is a session they go
  // up on their own — the applicant doesn't have to find the picker again.
  const runUploadRef = useRef(runUpload)
  runUploadRef.current = runUpload
  useEffect(() => {
    if (!signedIn) return
    setPending((items) => {
      const blocked = items.filter((p) => p.status === 'blocked')
      if (blocked.length === 0) return items
      for (const item of blocked) {
        void runUploadRef.current(item.key)
      }
      return items.map((p) =>
        p.status === 'blocked' ? { ...p, status: 'uploading', error: null } : p
      )
    })
  }, [signedIn])

  function addFiles(picked: File[]) {
    if (picked.length === 0) return

    // A single-file field replaces rather than appends: picking again is how
    // you change your mind about the photo you chose.
    if (!multiple) {
      for (const item of pending) forget(item.key)
      setPending([])
      onChangeRef.current(undefined)
      committedRef.current = []
    }

    const room = multiple
      ? Math.max(0, maxFiles - committedRef.current.length - pending.length)
      : 1
    const taking = picked.slice(0, room)
    const dropped = picked.length - taking.length

    const next: Pending[] = []
    for (const file of taking) {
      const key = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
      filesRef.current.set(key, file)

      const rejection = fileRejection(file, accepted)
      // Keep a preview even for a rejected file: seeing which photo was
      // refused is most of the message.
      let previewUrl: string | null = null
      if (!isPdf) {
        try {
          previewUrl = URL.createObjectURL(file)
          previewRef.current.set(key, previewUrl)
        } catch {
          previewUrl = null
        }
      }

      next.push({
        key,
        name: file.name,
        size: file.size,
        previewUrl,
        status: rejection ? 'error' : signedIn ? 'uploading' : 'blocked',
        progress: 0,
        error: rejection,
        retryable: false,
      })
    }

    if (dropped > 0) {
      next.push({
        key: `over-${Date.now()}`,
        name: `${dropped} more file${dropped === 1 ? '' : 's'}`,
        size: 0,
        previewUrl: null,
        status: 'error',
        progress: 0,
        error: `You can upload ${maxFiles} image${maxFiles === 1 ? '' : 's'} here, so ${dropped === 1 ? 'this one was' : 'these were'} left out.`,
        retryable: false,
      })
    }

    setPending((items) => (multiple ? [...items, ...next] : next))

    if (signedIn) {
      for (const item of next) {
        if (item.status === 'uploading') void runUpload(item.key)
      }
    } else if (next.some((item) => item.status === 'blocked')) {
      onRequestSignin()
    }
  }

  function removeCommitted(url: string) {
    const next = committedRef.current.filter((u) => u !== url)
    committedRef.current = next
    onChangeRef.current(multiple ? next : undefined)
  }

  function removePending(key: string) {
    forget(key)
    setPending((items) => items.filter((p) => p.key !== key))
  }

  const total = committed.length + pending.length
  const canAddMore = !disabled && total < maxFiles
  const tileClass =
    'bg-muted relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl border'

  return (
    <div className="flex flex-col gap-3">
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        className="sr-only"
        accept={acceptAttribute(accepted)}
        multiple={multiple}
        disabled={disabled}
        aria-describedby={describedBy}
        onChange={(e) => {
          addFiles(Array.from(e.target.files ?? []))
          // Lets the same file be picked again after a removal.
          e.target.value = ''
        }}
      />

      {isPdf ? (
        <PdfList
          committed={committed}
          pending={pending}
          onRemoveCommitted={removeCommitted}
          onRemovePending={removePending}
          onRetry={(key) => void runUpload(key)}
        />
      ) : (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {committed.map((url) => (
            <figure key={url} className={cn(tileClass, 'border-border')}>
              {/* A just-uploaded photo of the applicant's own choosing, shown
                  at thumbnail size — next/image would add an optimizer round
                  trip against a blob that may not have propagated yet. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt=""
                loading="lazy"
                className="size-full object-cover"
              />
              <RemoveButton
                label="Remove this photo"
                onClick={() => removeCommitted(url)}
                disabled={disabled}
              />
            </figure>
          ))}

          {pending.map((item) => (
            <figure
              key={item.key}
              className={cn(
                tileClass,
                item.status === 'error'
                  ? 'border-destructive/60'
                  : 'border-border'
              )}
            >
              {item.previewUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={item.previewUrl}
                  alt=""
                  className={cn(
                    'size-full object-cover',
                    item.status !== 'uploading' && 'opacity-50'
                  )}
                />
              ) : (
                <HugeiconsIcon
                  icon={Alert02Icon}
                  className="text-muted-foreground size-6"
                  strokeWidth={1.8}
                />
              )}

              <PendingOverlay item={item} />

              <RemoveButton
                label={
                  item.status === 'uploading'
                    ? 'Cancel this upload'
                    : 'Remove this file'
                }
                onClick={() => removePending(item.key)}
                disabled={disabled}
              />

              {item.status === 'error' && item.retryable ? (
                <button
                  type="button"
                  onClick={() => void runUpload(item.key)}
                  className="bg-foreground/85 text-background absolute inset-x-1 bottom-1 flex items-center justify-center gap-1 rounded-lg py-1 text-[11px] font-semibold"
                >
                  <HugeiconsIcon
                    icon={RefreshIcon}
                    className="size-3"
                    strokeWidth={2.2}
                  />
                  Retry
                </button>
              ) : null}
            </figure>
          ))}

          {canAddMore ? (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              aria-invalid={invalid}
              className={cn(
                'text-muted-foreground hover:border-primary/60 hover:text-primary flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed transition-colors',
                invalid ? 'border-destructive' : 'border-border'
              )}
            >
              <HugeiconsIcon
                icon={ImageAdd01Icon}
                className="size-6"
                strokeWidth={1.6}
              />
              <span className="text-[11px] font-medium">
                {total === 0 ? 'Add photo' : 'Add another'}
              </span>
            </button>
          ) : null}
        </div>
      )}

      {isPdf && canAddMore ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => inputRef.current?.click()}
          className="w-fit"
          aria-invalid={invalid}
        >
          <HugeiconsIcon icon={Upload01Icon} strokeWidth={1.8} />
          {total === 0 ? 'Choose a PDF' : 'Replace PDF'}
        </Button>
      ) : null}

      {pending.some((p) => p.status === 'error' && p.error) ? (
        <ul className="flex flex-col gap-1">
          {pending
            .filter((p) => p.status === 'error' && p.error)
            .map((p) => (
              <li
                key={`msg-${p.key}`}
                className="text-destructive flex items-start gap-1.5 text-xs leading-5"
              >
                <HugeiconsIcon
                  icon={Alert02Icon}
                  className="mt-0.5 size-3.5 shrink-0"
                  strokeWidth={2}
                />
                <span>
                  <span className="font-medium">{p.name}</span> — {p.error}
                </span>
              </li>
            ))}
        </ul>
      ) : null}

      {pending.some((p) => p.status === 'blocked') ? (
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <HugeiconsIcon
            icon={SquareLock02Icon}
            className="size-3.5 shrink-0"
            strokeWidth={1.8}
          />
          Waiting for you to sign in — nothing is lost.
        </p>
      ) : null}

      <p className="text-muted-foreground text-xs">
        {describeAccepted(accepted)} · up to {formatBytes(MAX_UPLOAD_BYTES)}
        {multiple ? ` · ${maxFiles} max` : ''}
      </p>
    </div>
  )
}

function PendingOverlay({ item }: { item: Pending }) {
  if (item.status === 'uploading') {
    return (
      <div className="absolute inset-x-1.5 bottom-1.5 flex flex-col gap-1">
        <Progress value={item.progress} className="h-1.5" />
        <span className="text-background bg-foreground/70 w-fit rounded px-1 text-[10px] font-semibold">
          {Math.round(item.progress)}%
        </span>
      </div>
    )
  }
  if (item.status === 'blocked') {
    return (
      <span className="bg-foreground/80 text-background absolute inset-x-1 bottom-1 rounded-lg py-1 text-center text-[10px] font-semibold">
        Sign in to upload
      </span>
    )
  }
  return null
}

function RemoveButton({
  label,
  onClick,
  disabled,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="bg-foreground/70 text-background hover:bg-destructive absolute top-1 right-1 flex size-6 items-center justify-center rounded-full transition-colors"
    >
      <HugeiconsIcon
        icon={Cancel01Icon}
        className="size-3.5"
        strokeWidth={2.4}
      />
    </button>
  )
}

function PdfList({
  committed,
  pending,
  onRemoveCommitted,
  onRemovePending,
  onRetry,
}: {
  committed: string[]
  pending: Pending[]
  onRemoveCommitted: (url: string) => void
  onRemovePending: (key: string) => void
  onRetry: (key: string) => void
}) {
  if (committed.length === 0 && pending.length === 0) return null
  return (
    <ul className="flex flex-col gap-2">
      {committed.map((url) => (
        <li
          key={url}
          className="border-border bg-card flex items-center gap-3 rounded-xl border p-3"
        >
          <HugeiconsIcon
            icon={Pdf01Icon}
            className="text-primary size-5 shrink-0"
            strokeWidth={1.8}
          />
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
          >
            {decodeURIComponent(url.split('/').pop() ?? 'Document.pdf')}
          </a>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Remove this document"
            onClick={() => onRemoveCommitted(url)}
          >
            <HugeiconsIcon icon={Delete02Icon} strokeWidth={1.8} />
          </Button>
        </li>
      ))}

      {pending.map((item) => (
        <li
          key={item.key}
          className={cn(
            'bg-card flex flex-col gap-2 rounded-xl border p-3',
            item.status === 'error' ? 'border-destructive/60' : 'border-border'
          )}
        >
          <div className="flex items-center gap-3">
            <HugeiconsIcon
              icon={item.status === 'error' ? Alert02Icon : Pdf01Icon}
              className={cn(
                'size-5 shrink-0',
                item.status === 'error' ? 'text-destructive' : 'text-primary'
              )}
              strokeWidth={1.8}
            />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {item.name}
            </span>
            {item.status === 'error' && item.retryable ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onRetry(item.key)}
              >
                <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} />
                Retry
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={
                item.status === 'uploading'
                  ? 'Cancel this upload'
                  : 'Remove this document'
              }
              onClick={() => onRemovePending(item.key)}
            >
              <HugeiconsIcon icon={Delete02Icon} strokeWidth={1.8} />
            </Button>
          </div>
          {item.status === 'uploading' ? (
            <Progress value={item.progress} className="h-1.5" />
          ) : null}
          {item.status === 'blocked' ? (
            <p className="text-muted-foreground text-xs">
              Waiting for you to sign in.
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
