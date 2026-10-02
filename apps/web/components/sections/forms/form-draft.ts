'use client'

import type { AnswerDraft } from '@/components/sections/forms/types'

// A registration form can run to dozens of questions, and answering them is
// the expensive part: on a phone, on mobile data, often with photos. Three
// things routinely interrupt that — signing in to submit, a failed payment
// coming back through Flutterwave, and simply losing the tab — and none of
// them should cost the applicant their answers.
//
// So every change is written to localStorage, keyed by form slug, and read
// back when the page loads. Uploads survive too: an answer holds the uploaded
// URL, not the file, so a restored draft still points at the photo.
//
// Per-device and per-browser, deliberately: it is a convenience, never the
// record. The submission is the record.

const VERSION = 1
const PREFIX = `ticketeur:form-draft:${VERSION}:`

// Long enough to survive a sign-up with email verification and a night's
// sleep; short enough that a form answered months ago doesn't come back.
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export type FormDraft = {
  answers: AnswerDraft
  priceOptionId: string | null
  savedAt: number
}

function storageKey(slug: string): string {
  return `${PREFIX}${slug}`
}

// Safari in private mode throws on access, not just on write, and a browser
// with site data blocked throws too. A draft is a nicety; never let it break
// the page.
function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function readDraft(slug: string): FormDraft | null {
  const store = storage()
  if (!store) return null
  try {
    const raw = store.getItem(storageKey(slug))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const draft = parsed as Partial<FormDraft>
    if (
      !draft.answers ||
      typeof draft.answers !== 'object' ||
      Array.isArray(draft.answers) ||
      typeof draft.savedAt !== 'number'
    ) {
      return null
    }
    if (Date.now() - draft.savedAt > MAX_AGE_MS) {
      store.removeItem(storageKey(slug))
      return null
    }
    return {
      answers: draft.answers,
      priceOptionId:
        typeof draft.priceOptionId === 'string' ? draft.priceOptionId : null,
      savedAt: draft.savedAt,
    }
  } catch {
    return null
  }
}

export function writeDraft(
  slug: string,
  draft: Omit<FormDraft, 'savedAt'>
): void {
  const store = storage()
  if (!store) return
  try {
    store.setItem(
      storageKey(slug),
      JSON.stringify({ ...draft, savedAt: Date.now() })
    )
  } catch {
    // Out of quota, most likely. Nothing useful to do, and nothing worth
    // interrupting the applicant over.
  }
}

export function clearDraft(slug: string): void {
  const store = storage()
  if (!store) return
  try {
    store.removeItem(storageKey(slug))
  } catch {
    // ignored — see writeDraft
  }
}

// Whether a restored draft holds anything worth telling the applicant about.
// A blank checkbox or an empty string is not an answer.
export function draftHasAnswers(draft: FormDraft): boolean {
  if (draft.priceOptionId) return true
  return Object.values(draft.answers).some((value) => {
    if (value === null || value === undefined) return false
    if (typeof value === 'string') return value.trim() !== ''
    if (Array.isArray(value)) return value.length > 0
    if (typeof value === 'boolean') return value
    return true
  })
}
