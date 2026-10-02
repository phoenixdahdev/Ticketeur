// A social sign-up carries no `requestedRole`: better-auth parses additional
// user fields from the provider profile, and Google has no such claim, so the
// create hook falls back to `attendee` for everyone who signs up with Google.
// Those users have not actually chosen anything yet, so send them to /welcome.
//
// Popup sign-in makes this check necessary rather than optional: the popup
// never navigates the opener, so better-auth's own newUserCallbackURL only
// applies to the redirect fallback.
export function needsRoleSelection(
  role: string | null | undefined,
  requestedRole: string | null | undefined
): boolean {
  return (role ?? 'attendee') === 'attendee' && !requestedRole
}

// ─── Returning somewhere specific after signing in ──────────────────────────

// Sign-in is sometimes a detour: someone halfway through a registration form
// has to sign in to submit it, and dropping them on a dashboard afterwards
// loses the work. Those entry points carry `?next=<path>`, which every step of
// the round trip (login → 2FA → /post-login, or sign-up → verify → /welcome →
// /post-login) passes along, and `getPostLoginPath` honours at the end.
//
// Only a same-origin path is ever honoured. `next` arrives from the URL bar,
// so an open redirect is the thing to rule out: anything that a browser could
// resolve to another host is dropped rather than corrected.
const MAX_NEXT_LENGTH = 512

export function safeNextPath(
  value: string | string[] | null | undefined
): string | null {
  const raw = Array.isArray(value) ? value[0] : value
  if (!raw || raw.length > MAX_NEXT_LENGTH) return null
  // '//host' and '/\host' are both protocol-relative in practice; a value that
  // doesn't start with '/' could be 'https://…' or a scheme-less host.
  if (!raw.startsWith('/')) return null
  if (raw.startsWith('//') || raw.startsWith('/\\')) return null
  // A control character (a stray newline in particular) has no business in a
  // Location header.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null
  return raw
}

// Append `?next=…` to a destination, or leave it alone when there is nothing
// safe to carry.
export function withNext(
  path: string,
  next: string | string[] | null | undefined
): string {
  const safe = safeNextPath(next)
  if (!safe) return path
  return `${path}${path.includes('?') ? '&' : '?'}next=${encodeURIComponent(safe)}`
}

// `next` wins over the role's home: it is where the person was actually
// headed, and they only signed in to get back to it.
export function getPostLoginPath(
  role: string | null | undefined,
  next?: string | string[] | null
): string {
  const safe = safeNextPath(next)
  if (safe) return safe

  switch (role) {
    case 'organizer':
      return '/org/dashboard'
    case 'vendor':
      return '/vendor/dashboard'
    case 'admin':
      // The admin dashboard is a separate app (its own deploy). There is no
      // admin area in the web app, so send admins to the public home instead
      // of a route that 404s here.
      return '/'
    default:
      return '/'
  }
}
