import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { AuthHeader } from '@/components/layout/auth-header'
import { WelcomeRolePicker } from '@/components/auth/welcome-role-picker'
import { getSession } from '@/lib/auth'
import { getPostLoginPath, needsRoleSelection } from '@/lib/post-login-redirect'

export const metadata: Metadata = {
  title: 'Welcome',
  description: 'Choose how you want to use Ticketeur.',
}

export const dynamic = 'force-dynamic'

// Where better-auth sends a first-time social sign-up (newUserCallbackURL on
// signIn.social). Google supplies no requestedRole, so these users land on the
// default role and pick a real one here.
export default async function WelcomePage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const user = session.user as unknown as {
    role?: string | null
    requestedRole?: string | null
    name?: string | null
  }
  const role = user.role ?? null
  // Onboarding only. Anyone who already holds a real role, or who picked one
  // before, has nothing to choose — chooseRole would reject them anyway.
  if (!needsRoleSelection(role, user.requestedRole)) {
    redirect(getPostLoginPath(role))
  }

  return (
    <div className="dark:bg-background flex min-h-svh flex-col bg-[#fafafa]">
      <AuthHeader />
      <main className="flex flex-1 flex-col">
        <WelcomeRolePicker name={user.name ?? null} />
      </main>
    </div>
  )
}
