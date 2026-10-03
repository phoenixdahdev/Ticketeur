import type { Metadata } from 'next'

import { ContestModDetailContent } from '@/components/dashboard/moderation/contest-mod-detail-content'

export async function generateMetadata({
  params,
}: PageProps<'/moderation/contest/[id]'>): Promise<Metadata> {
  const { id } = await params
  return { title: `Contest review ${id.slice(0, 8)}` }
}

export default async function ContestModerationPage({
  params,
}: PageProps<'/moderation/contest/[id]'>) {
  const { id } = await params

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 md:gap-8">
      <header className="flex flex-col gap-1.5">
        <h1 className="font-heading text-foreground text-2xl font-bold tracking-tight md:text-[28px]">
          Review contest
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          The whole ballot below is shown as voters will see it, with what a
          vote costs. The contest takes no votes until you approve it.
        </p>
      </header>

      <ContestModDetailContent id={id} />
    </div>
  )
}
