import type { Metadata } from 'next'

import { ContestsContent } from '@/components/dashboard/contests/contests-content'

export const metadata: Metadata = {
  title: 'Contests & Voting',
  description:
    'Pageants, awards and public votes across your events on Ticketeur.',
}

export default function OrgContestsPage() {
  return <ContestsContent />
}
