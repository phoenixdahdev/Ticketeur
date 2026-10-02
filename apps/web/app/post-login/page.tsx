import { redirect } from 'next/navigation'

import { getSession } from '@/lib/auth'
import {
  getPostLoginPath,
  needsRoleSelection,
  withNext,
} from '@/lib/post-login-redirect'

export const dynamic = 'force-dynamic'

export default async function PostLoginPage(props: PageProps<'/post-login'>) {
  const { next } = await props.searchParams
  const session = await getSession()
  if (!session) redirect(withNext('/login', next))
  const user = session.user as unknown as {
    role?: string | null
    requestedRole?: string | null
  }
  const role = user.role ?? null
  // Role selection first; `next` is carried through it so a first-time social
  // sign-up still lands back where they started.
  if (needsRoleSelection(role, user.requestedRole)) {
    redirect(withNext('/welcome', next))
  }
  redirect(getPostLoginPath(role, next))
}
