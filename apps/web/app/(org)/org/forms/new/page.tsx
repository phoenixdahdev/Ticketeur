import type { Metadata } from 'next'

import { FormCreateContent } from '@/components/dashboard/forms/form-create'

// `?eventId=` lets an event page start a form already pointed at itself.
type RouteSearchParams = Promise<{ eventId?: string | string[] }>

export const metadata: Metadata = {
  title: 'New Registration Form',
  description: 'Start a contestant or vendor sign-up form for your event.',
}

export default async function OrgNewFormPage({
  searchParams,
}: {
  searchParams: RouteSearchParams
}) {
  const { eventId } = await searchParams
  const initial = Array.isArray(eventId) ? eventId[0] : eventId
  return <FormCreateContent eventId={initial ?? null} />
}
