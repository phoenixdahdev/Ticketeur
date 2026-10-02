import type { Metadata } from 'next'

import { SubmissionDetail } from '@/components/dashboard/forms/submission-detail'

type RouteParams = Promise<{ id: string; submissionId: string }>

export const metadata: Metadata = {
  title: 'Application',
  description: 'Every answer against its question, with approve and reject.',
}

export default async function OrgSubmissionDetailPage({
  params,
}: {
  params: RouteParams
}) {
  const { id, submissionId } = await params
  return <SubmissionDetail formId={id} submissionId={submissionId} />
}
