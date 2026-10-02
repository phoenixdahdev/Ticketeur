import type { Metadata } from 'next'

import { SubmissionsContent } from '@/components/dashboard/forms/submissions-content'

type RouteParams = Promise<{ id: string }>

export const metadata: Metadata = {
  title: 'Applications',
  description: 'Review, approve and export applications to your form.',
}

export default async function OrgFormSubmissionsPage({
  params,
}: {
  params: RouteParams
}) {
  const { id } = await params
  return <SubmissionsContent formId={id} />
}
