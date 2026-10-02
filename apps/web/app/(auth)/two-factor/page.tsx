import type { Metadata } from 'next'

import { AuthShell } from '@/components/auth/auth-shell'
import { TwoFactorForm } from '@/components/auth/two-factor-form'
import { SIGNUP_ROLES } from '@/lib/signup-roles'

export const metadata: Metadata = {
  title: 'Two-Factor Authentication',
  description: 'Enter your authentication code to sign in.',
}

export default async function TwoFactorPage(props: PageProps<'/two-factor'>) {
  const { next } = await props.searchParams
  const { imageSrc, imageMobileSrc, imageAlt } = SIGNUP_ROLES.attendee

  return (
    <AuthShell
      imageSrc={imageSrc}
      imageMobileSrc={imageMobileSrc}
      imageAlt={imageAlt}
    >
      <TwoFactorForm next={typeof next === 'string' ? next : null} />
    </AuthShell>
  )
}
