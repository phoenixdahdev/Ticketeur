import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { getSession } from '@/lib/auth'
import { MyApplicationsContent } from '@/components/sections/account/my-applications-content'
import { getServerTRPC, HydrateClient } from '@/lib/trpc-server'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'My applications',
  description: 'Forms you’ve applied to on Ticketeur, and where each stands.',
}

export default async function MyApplicationsPage() {
  const session = await getSession()
  if (!session) {
    redirect('/login?redirect=/account/applications')
  }
  const { trpc, queryClient } = await getServerTRPC()
  await queryClient.prefetchQuery(trpc.account.submissions.list.queryOptions())
  return (
    <HydrateClient>
      <MyApplicationsContent />
    </HydrateClient>
  )
}
