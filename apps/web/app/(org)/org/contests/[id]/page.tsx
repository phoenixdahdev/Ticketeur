import type { Metadata } from 'next'

import { ContestEditor } from '@/components/dashboard/contests/contest-editor'

type RouteParams = Promise<{ id: string }>

export const metadata: Metadata = {
  title: 'Contest',
  description: 'Build the ballot, price the votes and send it for review.',
}

export default async function OrgContestEditorPage({
  params,
}: {
  params: RouteParams
}) {
  const { id } = await params
  return <ContestEditor id={id} />
}
