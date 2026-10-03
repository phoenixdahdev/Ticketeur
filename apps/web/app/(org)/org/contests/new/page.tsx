import type { Metadata } from 'next'

import { ContestCreateContent } from '@/components/dashboard/contests/contest-create'

// `?eventId=` lets an event page start a contest already pointed at itself.
type RouteSearchParams = Promise<{ eventId?: string | string[] }>

export const metadata: Metadata = {
  title: 'New Contest',
  description: 'Start a pageant, an award or any public vote on your event.',
}

export default async function OrgNewContestPage({
  searchParams,
}: {
  searchParams: RouteSearchParams
}) {
  const { eventId } = await searchParams
  const initial = Array.isArray(eventId) ? eventId[0] : eventId
  return <ContestCreateContent eventId={initial ?? null} />
}
