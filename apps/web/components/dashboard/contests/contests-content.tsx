'use client'

import { useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import {
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
  useQueryStates,
} from 'nuqs'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowUp01Icon,
  Edit02Icon,
  PlusSignIcon,
  Search01Icon,
} from '@hugeicons/core-free-icons'

import { cn } from '@ticketur/ui/lib/utils'
import { Button } from '@ticketur/ui/components/button'
import { Input } from '@ticketur/ui/components/input'
import {
  NativeSelect,
  NativeSelectOption,
} from '@ticketur/ui/components/native-select'

import { useTRPC } from '@/lib/trpc'
import {
  CONTEST_STATUS_ORDER,
  formatPerVote,
  votingWindowLabel,
  type ContestListRow,
} from '@/lib/org-contests'
import { ContestStatusBadge } from '@/components/dashboard/contests/review-notice'

const CONTESTS_PAGE_SIZE = 10

const ALL_EVENTS = '__all__'

const TAB_VALUES = [
  'all',
  'draft',
  'pending_review',
  'published',
  'rejected',
  'closed',
  'suspended',
] as const
type TabValue = (typeof TAB_VALUES)[number]

const TABS: { value: TabValue; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Drafts' },
  { value: 'pending_review', label: 'In Review' },
  { value: 'published', label: 'Live' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'closed', label: 'Closed' },
  { value: 'suspended', label: 'Taken Down' },
]

const SORT_FIELDS = ['name', 'event', 'status', 'votes'] as const
type SortField = (typeof SORT_FIELDS)[number]

const DIR_VALUES = ['asc', 'desc'] as const
type SortDir = (typeof DIR_VALUES)[number]

export function ContestsContent() {
  const trpc = useTRPC()

  const [params, setParams] = useQueryStates(
    {
      tab: parseAsStringLiteral(TAB_VALUES).withDefault('all'),
      q: parseAsString.withDefault(''),
      event: parseAsString.withDefault(ALL_EVENTS),
      sort: parseAsStringLiteral(SORT_FIELDS).withDefault('status'),
      dir: parseAsStringLiteral(DIR_VALUES).withDefault('asc'),
      page: parseAsInteger.withDefault(1),
    },
    { history: 'replace', clearOnDefault: true }
  )

  // `list` returns every contest the organizer owns, with counts, in one
  // query; filtering, sorting and paging are the client's to do.
  const listQuery = useQuery(trpc.org.contests.list.queryOptions({}))
  const all = useMemo(() => listQuery.data ?? [], [listQuery.data])

  const events = useMemo(() => {
    const byId = new Map<string, string>()
    for (const contest of all) byId.set(contest.eventId, contest.eventTitle)
    return [...byId].map(([id, title]) => ({ id, title }))
  }, [all])

  const needsAttention = useMemo(
    () =>
      all.filter((c) => c.status === 'rejected' || c.status === 'suspended')
        .length,
    [all]
  )

  const filtered = useMemo(() => {
    const needle = params.q.trim().toLowerCase()
    return all.filter((contest) => {
      if (params.tab !== 'all' && contest.status !== params.tab) return false
      if (params.event !== ALL_EVENTS && contest.eventId !== params.event) {
        return false
      }
      if (needle === '') return true
      return (
        contest.title.toLowerCase().includes(needle) ||
        contest.eventTitle.toLowerCase().includes(needle)
      )
    })
  }, [all, params.event, params.q, params.tab])

  const sorted = useMemo(() => {
    const sign = params.dir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      switch (params.sort) {
        case 'name':
          return sign * a.title.localeCompare(b.title)
        case 'event':
          return (
            sign *
            (a.eventTitle.localeCompare(b.eventTitle) ||
              a.title.localeCompare(b.title))
          )
        case 'votes':
          return sign * (a.voteCount - b.voteCount)
        case 'status':
        default:
          return (
            sign *
              (CONTEST_STATUS_ORDER[a.status] -
                CONTEST_STATUS_ORDER[b.status]) ||
            b.createdAt.getTime() - a.createdAt.getTime()
          )
      }
    })
  }, [filtered, params.dir, params.sort])

  const total = sorted.length
  const totalPages = Math.max(1, Math.ceil(total / CONTESTS_PAGE_SIZE))
  const current = Math.min(Math.max(params.page, 1), totalPages)
  const rows = sorted.slice(
    (current - 1) * CONTESTS_PAGE_SIZE,
    current * CONTESTS_PAGE_SIZE
  )

  const handleSort = useCallback(
    (field: SortField) => {
      void setParams((prev) => ({
        sort: field,
        dir:
          prev.sort === field && prev.dir === 'asc'
            ? ('desc' as SortDir)
            : ('asc' as SortDir),
        page: 1,
      }))
    },
    [setParams]
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 md:gap-8">
      <header className="flex shrink-0 flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-6">
        <div className="flex flex-col gap-1.5">
          <h1 className="font-heading text-foreground text-2xl font-bold tracking-tight md:text-[28px]">
            Contests &amp; Voting
          </h1>
          <p className="text-muted-foreground text-sm md:text-base">
            Pageants, awards and anything else the public votes on. An admin
            approves the ballot and the prices before voting can start.
          </p>
        </div>
        <Button size="xl" asChild className="w-full md:w-auto">
          <Link href="/org/contests/new" className="gap-2">
            <HugeiconsIcon
              icon={PlusSignIcon}
              className="size-5"
              strokeWidth={2}
            />
            New Contest
          </Link>
        </Button>
      </header>

      {needsAttention > 0 ? (
        <p className="shrink-0 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-100">
          <strong className="font-semibold">
            {needsAttention === 1 ? '1 contest' : `${needsAttention} contests`}
          </strong>{' '}
          {needsAttention === 1 ? 'needs' : 'need'} your attention — an admin
          turned {needsAttention === 1 ? 'it' : 'them'} down or took{' '}
          {needsAttention === 1 ? 'it' : 'them'} off the platform.
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="flex shrink-0 flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-6">
          <div
            role="tablist"
            aria-label="Filter by review status"
            className="border-border/60 -mx-1 flex [scrollbar-width:none] items-center gap-1 overflow-x-auto border-b px-1 pb-px md:flex-1 [&::-webkit-scrollbar]:hidden"
          >
            {TABS.map((t) => {
              const active = params.tab === t.value
              const count =
                t.value === 'all'
                  ? all.length
                  : all.filter((c) => c.status === t.value).length
              return (
                <button
                  key={t.value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => void setParams({ tab: t.value, page: 1 })}
                  className={cn(
                    'relative shrink-0 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors md:text-base',
                    active
                      ? 'text-primary'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {t.label}
                  {count > 0 ? (
                    <span className="text-muted-foreground ml-1.5 text-xs font-semibold">
                      {count}
                    </span>
                  ) : null}
                  {active ? (
                    <motion.span
                      layoutId="org-contests-tab-indicator"
                      className="bg-primary absolute right-0 -bottom-px left-0 h-0.5 rounded-full"
                      transition={{
                        type: 'spring',
                        stiffness: 380,
                        damping: 30,
                      }}
                    />
                  ) : null}
                </button>
              )
            })}
          </div>

          <div className="flex w-full shrink-0 flex-col gap-3 sm:flex-row md:w-auto">
            {events.length > 1 ? (
              <NativeSelect
                className="w-full sm:w-52"
                value={params.event}
                aria-label="Filter by event"
                onChange={(e) =>
                  void setParams({ event: e.target.value, page: 1 })
                }
              >
                <NativeSelectOption value={ALL_EVENTS}>
                  All events
                </NativeSelectOption>
                {events.map((ev) => (
                  <NativeSelectOption key={ev.id} value={ev.id}>
                    {ev.title}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            ) : null}
            <div className="relative w-full sm:w-64">
              <HugeiconsIcon
                icon={Search01Icon}
                className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2"
                strokeWidth={1.8}
              />
              <Input
                type="search"
                value={params.q}
                onChange={(e) =>
                  void setParams({ q: e.target.value || null, page: 1 })
                }
                placeholder="Search"
                aria-label="Search contests"
                className="h-10 w-full pl-9"
              />
            </div>
          </div>
        </div>

        <div className="border-border/60 bg-background flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border shadow-sm shadow-black/[0.02]">
          <div className="min-h-0 w-full flex-1 [scrollbar-width:none] overflow-auto [&::-webkit-scrollbar]:hidden">
            <table className="w-full min-w-[960px] table-auto">
              <thead className="bg-primary/5">
                <tr className="text-muted-foreground text-xs font-semibold tracking-wider uppercase select-none">
                  <SortableHeader
                    field="name"
                    sort={params.sort}
                    dir={params.dir}
                    onSort={handleSort}
                  >
                    Contest
                  </SortableHeader>
                  <SortableHeader
                    field="event"
                    sort={params.sort}
                    dir={params.dir}
                    onSort={handleSort}
                  >
                    Event
                  </SortableHeader>
                  <SortableHeader
                    field="status"
                    sort={params.sort}
                    dir={params.dir}
                    onSort={handleSort}
                  >
                    Review Status
                  </SortableHeader>
                  <SortableHeader
                    field="votes"
                    sort={params.sort}
                    dir={params.dir}
                    onSort={handleSort}
                  >
                    Votes
                  </SortableHeader>
                  <th className="px-5 py-4 text-left">Ballot</th>
                  <th className="px-5 py-4 text-left">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-border/60 divide-y">
                {listQuery.isLoading ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-16 text-center">
                      <p className="text-muted-foreground text-sm">
                        Loading contests…
                      </p>
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-16 text-center">
                      <p className="text-muted-foreground text-sm">
                        {all.length === 0
                          ? 'No contests yet — create one to run a pageant, an award or any public vote on your event.'
                          : 'No contests match your filters.'}
                      </p>
                    </td>
                  </tr>
                ) : (
                  rows.map((contest) => (
                    <ContestRow key={contest.id} contest={contest} />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <Pagination
          total={total}
          current={current}
          totalPages={totalPages}
          onPage={(p) => void setParams({ page: p })}
        />
      </div>
    </div>
  )
}

function ContestRow({ contest }: { contest: ContestListRow }) {
  return (
    <tr className="text-sm">
      <td className="px-5 py-4">
        <div className="flex min-w-0 flex-col gap-1">
          <Link
            href={`/org/contests/${contest.id}`}
            className="text-foreground hover:text-primary font-semibold transition-colors"
          >
            {contest.title}
          </Link>
          <span className="text-muted-foreground text-xs">
            {votingWindowLabel(contest)}
          </span>
        </div>
      </td>
      <td className="text-foreground max-w-[200px] px-5 py-4">
        <Link
          href={`/org/events/${contest.eventId}`}
          className="hover:text-primary line-clamp-2 transition-colors"
        >
          {contest.eventTitle}
        </Link>
      </td>
      <td className="px-5 py-4">
        <div className="flex max-w-[260px] flex-col gap-1">
          <ContestStatusBadge status={contest.status} className="w-fit" />
          {(contest.status === 'rejected' || contest.status === 'suspended') &&
          contest.rejectionReason ? (
            <span
              title={contest.rejectionReason}
              className="line-clamp-2 text-xs text-rose-600 dark:text-rose-400"
            >
              {contest.rejectionReason}
            </span>
          ) : contest.status === 'pending_review' ? (
            <span className="text-muted-foreground text-xs">
              Taking no votes while an admin reviews it
            </span>
          ) : null}
        </div>
      </td>
      <td className="px-5 py-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-foreground font-semibold">
            {contest.voteCount.toLocaleString('en-NG')}
          </span>
          <span className="text-muted-foreground text-xs">
            {formatPerVote(contest)}
            {contest.freeVotingEnabled ? ' · free vote on' : ''}
          </span>
        </div>
      </td>
      <td className="px-5 py-4">
        <span className="text-muted-foreground text-xs">
          {contest.categoryCount === 1
            ? '1 category'
            : `${contest.categoryCount} categories`}
          {' · '}
          {contest.entryCount === 1
            ? '1 entry'
            : `${contest.entryCount} entries`}
        </span>
      </td>
      <td className="px-5 py-4">
        <Link
          href={`/org/contests/${contest.id}`}
          aria-label={`Edit ${contest.title}`}
          className="text-primary hover:bg-primary/10 focus-visible:ring-primary/40 inline-flex size-8 items-center justify-center rounded-md transition-colors outline-none focus-visible:ring-2"
        >
          <HugeiconsIcon
            icon={Edit02Icon}
            className="size-4"
            strokeWidth={1.8}
          />
        </Link>
      </td>
    </tr>
  )
}

function SortableHeader({
  field,
  sort,
  dir,
  onSort,
  children,
}: {
  field: SortField
  sort: SortField
  dir: SortDir
  onSort: (field: SortField) => void
  children: React.ReactNode
}) {
  const active = sort === field
  return (
    <th className="px-5 py-4 text-left">
      <button
        type="button"
        onClick={() => onSort(field)}
        aria-sort={
          active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'
        }
        className={cn(
          'inline-flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase transition-colors',
          active
            ? 'text-primary'
            : 'text-muted-foreground hover:text-foreground'
        )}
      >
        <span>{children}</span>
        {active ? (
          <HugeiconsIcon
            icon={dir === 'asc' ? ArrowUp01Icon : ArrowDown01Icon}
            className="size-3.5"
            strokeWidth={2.2}
          />
        ) : null}
      </button>
    </th>
  )
}

function Pagination({
  total,
  current,
  totalPages,
  onPage,
}: {
  total: number
  current: number
  totalPages: number
  onPage: (page: number) => void
}) {
  const visibleRange = useMemo(() => {
    const max = 3
    if (totalPages <= max) {
      return Array.from({ length: totalPages }, (_, i) => i + 1)
    }
    if (current <= 2) return [1, 2, 3]
    if (current >= totalPages - 1) {
      return [totalPages - 2, totalPages - 1, totalPages]
    }
    return [current - 1, current, current + 1]
  }, [current, totalPages])

  const start = total === 0 ? 0 : (current - 1) * CONTESTS_PAGE_SIZE + 1
  const end = Math.min(current * CONTESTS_PAGE_SIZE, total)

  return (
    <div className="flex shrink-0 flex-col items-start justify-between gap-4 pt-2 sm:flex-row sm:items-center">
      <p className="text-muted-foreground text-xs sm:text-sm">
        {total === 0
          ? 'No contests'
          : `Showing ${start}–${end} of ${total} contests`}
      </p>
      <nav aria-label="Pagination" className="flex items-center gap-2">
        <PageButton
          aria-label="Previous page"
          disabled={current <= 1}
          onClick={() => onPage(current - 1)}
        >
          <HugeiconsIcon
            icon={ArrowLeft01Icon}
            className="size-4"
            strokeWidth={2}
          />
        </PageButton>
        {visibleRange.map((p) => (
          <PageButton
            key={p}
            aria-label={`Page ${p}`}
            aria-current={p === current ? 'page' : undefined}
            active={p === current}
            onClick={() => onPage(p)}
          >
            {p}
          </PageButton>
        ))}
        <PageButton
          aria-label="Next page"
          disabled={current >= totalPages}
          onClick={() => onPage(current + 1)}
        >
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            className="size-4"
            strokeWidth={2}
          />
        </PageButton>
      </nav>
    </div>
  )
}

function PageButton({
  active,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        'border-border/60 inline-flex size-9 items-center justify-center rounded-md border text-sm font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-40',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'text-foreground hover:bg-muted',
        className
      )}
    >
      {children}
    </button>
  )
}
