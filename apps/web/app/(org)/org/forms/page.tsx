import type { Metadata } from 'next'

import { FormsContent } from '@/components/dashboard/forms/forms-content'

export const metadata: Metadata = {
  title: 'Registration Forms',
  description:
    'Contestant and vendor sign-up forms across your events on Ticketeur.',
}

export default function OrgFormsPage() {
  return <FormsContent />
}
