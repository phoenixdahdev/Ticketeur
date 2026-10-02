import type { Metadata } from 'next'

import { FormBuilder } from '@/components/dashboard/forms/form-builder'

type RouteParams = Promise<{ id: string }>

export const metadata: Metadata = {
  title: 'Registration Form',
  description: 'Build your form, preview it and send it for review.',
}

export default async function OrgFormBuilderPage({
  params,
}: {
  params: RouteParams
}) {
  const { id } = await params
  return <FormBuilder id={id} />
}
