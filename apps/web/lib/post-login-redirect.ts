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

export function getPostLoginPath(role: string | null | undefined): string {
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
