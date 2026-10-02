import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { getSession } from '@/lib/auth'
import { ApplicationDetailContent } from '@/components/sections/account/application-detail-content'
import { getServerTRPC, HydrateClient } from '@/lib/trpc-server'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'My application',
  description: 'Your application, the answers you sent and where it stands.',
}

type RouteParams = Promise<{ id: string }>

export default async function ApplicationDetailPage({
  params,
}: {
  params: RouteParams
}) {
  const { id } = await params
  const session = await getSession()
  if (!session) {
    redirect(`/login?redirect=/account/applications/${id}`)
  }
  // The prefetch runs as the signed-in caller, so it can only ever land their
  // own application in the cache; the query answers null for anyone else's and
  // the client renders the not-found state from that.
  const { trpc, queryClient } = await getServerTRPC()
  await queryClient.prefetchQuery(
    trpc.account.submissions.byId.queryOptions({ id })
  )
  return (
    <HydrateClient>
      <ApplicationDetailContent id={id} />
    </HydrateClient>
  )
}
