import { ContestPageSkeleton } from '@/components/sections/contests/contest-page-content'

export default function Loading() {
  return (
    <section className="mx-auto flex w-full max-w-200 flex-col px-5 py-8 md:py-12">
      <ContestPageSkeleton />
    </section>
  )
}
