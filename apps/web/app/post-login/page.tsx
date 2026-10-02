import { redirect } from 'next/navigation'

import { getSession } from '@/lib/auth'
import { getPostLoginPath, needsRoleSelection } from '@/lib/post-login-redirect'

export const dynamic = 'force-dynamic'

export default async function PostLoginPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  const user = session.user as unknown as {
    role?: string | null
    requestedRole?: string | null
  }
  const role = user.role ?? null
  if (needsRoleSelection(role, user.requestedRole)) redirect('/welcome')
  redirect(getPostLoginPath(role))
}
