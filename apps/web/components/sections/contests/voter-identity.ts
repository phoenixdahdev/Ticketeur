'use client'

// The address a voter is known by, remembered on this device.
//
// A vote balance hangs on the email and nothing else (see lib/votes.ts), so
// the voter has to type it again every time they come back — after paying
// through Flutterwave, after closing the tab, after voting free yesterday.
// Remembering it is the difference between "cast your votes" and "what did I
// pay with again?".
//
// Per contest, because one person can hold credits in several, and a global
// "last email" would show the wrong balance on the wrong page. Per device and
// per browser: a convenience, never the record. The vote_credits row is the
// record, and the email is typed into every mutation regardless — nothing
// here is trusted by the server.

const VERSION = 1
const PREFIX = `ticketeur:voter-email:${VERSION}:`

// Long enough to cover a contest that runs for a season.
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000

type Stored = { email: string; savedAt: number }

function storageKey(contestId: string): string {
  return `${PREFIX}${contestId}`
}

// Safari in private mode throws on access, not just on write. Never let a
// remembered address be the reason the page fails to render.
function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function readVoterEmail(contestId: string): string | null {
  const store = storage()
  if (!store) return null
  try {
    const raw = store.getItem(storageKey(contestId))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const stored = parsed as Partial<Stored>
    if (
      typeof stored.email !== 'string' ||
      typeof stored.savedAt !== 'number'
    ) {
      return null
    }
    if (Date.now() - stored.savedAt > MAX_AGE_MS) {
      store.removeItem(storageKey(contestId))
      return null
    }
    return stored.email
  } catch {
    return null
  }
}

export function writeVoterEmail(contestId: string, email: string): void {
  const store = storage()
  if (!store) return
  try {
    const stored: Stored = { email, savedAt: Date.now() }
    store.setItem(storageKey(contestId), JSON.stringify(stored))
  } catch {
    // Out of quota, or site data blocked. Nothing worth interrupting a vote
    // over.
  }
}

export function clearVoterEmail(contestId: string): void {
  const store = storage()
  if (!store) return
  try {
    store.removeItem(storageKey(contestId))
  } catch {
    // ignored — see writeVoterEmail
  }
}

/**
 * The same normalisation the server keys credits and free votes on
 * (`normalizeVoterEmail` in packages/api/src/lib/votes.ts). Copied rather
 * than imported because that module pulls in the database client, which
 * cannot go into a browser bundle. Two lines, and the server normalises
 * again on every call, so this only decides what we SHOW and what we
 * remember — never what is looked up.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** Good enough to stop an obvious typo costing a round trip. The server's
 * `z.email()` is what actually decides. */
export function looksLikeEmail(email: string): boolean {
  const value = normalizeEmail(email)
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}
