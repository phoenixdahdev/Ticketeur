import { FormPageSkeleton } from '@/components/sections/forms/form-page-content'

export default function Loading() {
  return (
    <section className="mx-auto flex w-full max-w-180 flex-col px-5 py-8 md:py-12">
      <FormPageSkeleton />
    </section>
  )
}
