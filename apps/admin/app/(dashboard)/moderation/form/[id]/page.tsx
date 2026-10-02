import type { Metadata } from 'next'

import { FormModDetailContent } from '@/components/dashboard/moderation/form-mod-detail-content'

export async function generateMetadata({
  params,
}: PageProps<'/moderation/form/[id]'>): Promise<Metadata> {
  const { id } = await params
  return { title: `Form review ${id.slice(0, 8)}` }
}

export default async function FormModerationPage({
  params,
}: PageProps<'/moderation/form/[id]'>) {
  const { id } = await params

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 md:gap-8">
      <header className="flex flex-col gap-1.5">
        <h1 className="font-heading text-foreground text-2xl font-bold tracking-tight md:text-[28px]">
          Review registration form
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          Every question below is shown as applicants will see it. The form
          takes no submissions until you approve it.
        </p>
      </header>

      <FormModDetailContent id={id} />
    </div>
  )
}
