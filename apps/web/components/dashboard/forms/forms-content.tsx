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
  UserGroupIcon,
} from '@hugeicons/core-free-icons'

import { cn } from '@ticketur/ui/lib/utils'
import { Button } from '@ticketur/ui/components/button'
import { Input } from '@ticketur/ui/components/input'
import {
  NativeSelect,
  NativeSelectOption,
} from '@ticketur/ui/components/native-select'
import type { FormStatus } from '@ticketur/db'

import { useTRPC } from '@/lib/trpc'
import {
  FORM_TYPE_LABEL,
  intakeWindowLabel,
  plural,
  type FormListRow,
} from '@/lib/org-forms'
import { FormStatusBadge } from '@/components/dashboard/forms/review-notice'

const FORMS_PAGE_SIZE = 10

const ALL_EVENTS = '__all__'

const TAB_VALUES = [
  'all',
  'draft',
  'pending_review',
  'published',
  'rejected',
  'closed',
] as const
type TabValue = (typeof TAB_VALUES)[number]

const TABS: { value: TabValue; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Drafts' },
  { value: 'pending_review', label: 'In Review' },
  { value: 'published', label: 'Live' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'closed', label: 'Closed' },
]

const SORT_FIELDS = ['name', 'event', 'status', 'applications'] as const
type SortField = (typeof SORT_FIELDS)[number]

const DIR_VALUES = ['asc', 'desc'] as const
type SortDir = (typeof DIR_VALUES)[number]

// Ranked so sorting by status walks the lifecycle, not the alphabet.
const STATUS_ORDER: Record<FormStatus, number> = {
  rejected: 0,
  pending_review: 1,
  draft: 2,
  published: 3,
  closed: 4,
}

export function FormsContent() {
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

  // `list` returns every form the organizer owns, with counts, in one query;
  // filtering, sorting and paging are the client's to do.
  const listQuery = useQuery(trpc.org.forms.list.queryOptions({}))
  const all = useMemo(() => listQuery.data ?? [], [listQuery.data])

  const events = useMemo(() => {
    const byId = new Map<string, string>()
    for (const form of all) byId.set(form.eventId, form.eventTitle)
    return [...byId].map(([id, title]) => ({ id, title }))
  }, [all])

  // Applications sitting at 'submitted' are the organizer's own queue.
  const needsAttention = useMemo(
    () => all.reduce((sum, form) => sum + form.submitted, 0),
    [all]
  )

  const filtered = useMemo(() => {
    const needle = params.q.trim().toLowerCase()
    return all.filter((form) => {
      if (params.tab !== 'all' && form.status !== params.tab) return false
      if (params.event !== ALL_EVENTS && form.eventId !== params.event) {
        return false
      }
      if (needle === '') return true
      return (
        form.title.toLowerCase().includes(needle) ||
        form.eventTitle.toLowerCase().includes(needle)
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
        case 'applications':
          return sign * (a.total - b.total)
        case 'status':
        default:
          return (
            sign * (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) ||
            b.createdAt.getTime() - a.createdAt.getTime()
          )
      }
    })
  }, [filtered, params.dir, params.sort])

  const total = sorted.length
  const totalPages = Math.max(1, Math.ceil(total / FORMS_PAGE_SIZE))
  const current = Math.min(Math.max(params.page, 1), totalPages)
  const rows = sorted.slice(
    (current - 1) * FORMS_PAGE_SIZE,
    current * FORMS_PAGE_SIZE
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
            Registration Forms
          </h1>
          <p className="text-muted-foreground text-sm md:text-base">
            Contestant and vendor sign-ups for your events. An admin approves
            the questions before a form can take applications.
          </p>
        </div>
        <Button size="xl" asChild className="w-full md:w-auto">
          <Link href="/org/forms/new" className="gap-2">
            <HugeiconsIcon
              icon={PlusSignIcon}
              className="size-5"
              strokeWidth={2}
            />
            New Form
          </Link>
        </Button>
      </header>

      {needsAttention > 0 ? (
        <p className="border-primary/25 bg-primary/5 text-foreground/90 shrink-0 rounded-xl border px-4 py-3 text-sm">
          <strong className="font-semibold">
            {plural(needsAttention, 'application')}
          </strong>{' '}
          across your forms {needsAttention === 1 ? 'is' : 'are'} waiting for
          your decision.
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
                  : all.filter((f) => f.status === t.value).length
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
                      layoutId="org-forms-tab-indicator"
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
                aria-label="Search forms"
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
                    Form
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
                    field="applications"
                    sort={params.sort}
                    dir={params.dir}
                    onSort={handleSort}
                  >
                    Applications
                  </SortableHeader>
                  <th className="px-5 py-4 text-left">Spots</th>
                  <th className="px-5 py-4 text-left">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-border/60 divide-y">
                {listQuery.isLoading ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-16 text-center">
                      <p className="text-muted-foreground text-sm">
                        Loading forms…
                      </p>
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-16 text-center">
                      <p className="text-muted-foreground text-sm">
                        {all.length === 0
                          ? 'No registration forms yet — create one to start taking contestant or vendor sign-ups.'
                          : 'No forms match your filters.'}
                      </p>
                    </td>
                  </tr>
                ) : (
                  rows.map((form) => <FormRow key={form.id} form={form} />)
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

function FormRow({ form }: { form: FormListRow }) {
  const spots =
    form.capacity === null
      ? `${form.claimed.toLocaleString('en-NG')} taken`
      : `${form.claimed.toLocaleString('en-NG')} / ${form.capacity.toLocaleString('en-NG')}`
  const pct =
    form.capacity && form.capacity > 0
      ? Math.min(100, Math.round((form.claimed / form.capacity) * 100))
      : 0

  return (
    <tr className="text-sm">
      <td className="px-5 py-4">
        <div className="flex min-w-0 flex-col gap-1">
          <Link
            href={`/org/forms/${form.id}`}
            className="text-foreground hover:text-primary font-semibold transition-colors"
          >
            {form.title}
          </Link>
          <span className="text-muted-foreground text-xs">
            {FORM_TYPE_LABEL[form.type]} · {intakeWindowLabel(form)}
          </span>
        </div>
      </td>
      <td className="text-foreground max-w-[200px] px-5 py-4">
        <Link
          href={`/org/events/${form.eventId}`}
          className="hover:text-primary line-clamp-2 transition-colors"
        >
          {form.eventTitle}
        </Link>
      </td>
      <td className="px-5 py-4">
        <div className="flex max-w-[260px] flex-col gap-1">
          <FormStatusBadge status={form.status} className="w-fit" />
          {form.status === 'rejected' && form.rejectionReason ? (
            <span
              title={form.rejectionReason}
              className="line-clamp-2 text-xs text-rose-600 dark:text-rose-400"
            >
              {form.rejectionReason}
            </span>
          ) : form.status === 'pending_review' ? (
            <span className="text-muted-foreground text-xs">
              Not accepting applications while an admin reviews it
            </span>
          ) : null}
        </div>
      </td>
      <td className="px-5 py-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-foreground font-semibold">
            {form.total.toLocaleString('en-NG')}
          </span>
          {form.submitted > 0 ? (
            <Link
              href={`/org/forms/${form.id}/submissions?status=submitted`}
              className="text-primary text-xs font-semibold hover:underline"
            >
              {form.submitted} need review
            </Link>
          ) : (
            <span className="text-muted-foreground text-xs">
              {form.approved} approved
            </span>
          )}
        </div>
      </td>
      <td className="px-5 py-4">
        <div className="flex min-w-[140px] flex-col gap-1.5">
          <span className="text-muted-foreground text-xs">{spots}</span>
          {form.capacity !== null ? (
            <div className="bg-muted relative h-1.5 w-full overflow-hidden rounded-full">
              <div
                className="bg-foreground absolute inset-y-0 left-0 rounded-full"
                style={{ width: `${pct}%` }}
              />
            </div>
          ) : null}
        </div>
      </td>
      <td className="px-5 py-4">
        <div className="flex items-center gap-1">
          <IconAction
            href={`/org/forms/${form.id}`}
            label={`Edit ${form.title}`}
            icon={Edit02Icon}
          />
          <IconAction
            href={`/org/forms/${form.id}/submissions`}
            label={`Applications for ${form.title}`}
            icon={UserGroupIcon}
          />
        </div>
      </td>
    </tr>
  )
}

function IconAction({
  icon,
  label,
  href,
}: {
  icon: Parameters<typeof HugeiconsIcon>[0]['icon']
  label: string
  href: string
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      className="text-primary hover:bg-primary/10 focus-visible:ring-primary/40 inline-flex size-8 items-center justify-center rounded-md transition-colors outline-none focus-visible:ring-2"
    >
      <HugeiconsIcon icon={icon} className="size-4" strokeWidth={1.8} />
    </Link>
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

  const start = total === 0 ? 0 : (current - 1) * FORMS_PAGE_SIZE + 1
  const end = Math.min(current * FORMS_PAGE_SIZE, total)

  return (
    <div className="flex shrink-0 flex-col items-start justify-between gap-4 pt-2 sm:flex-row sm:items-center">
      <p className="text-muted-foreground text-xs sm:text-sm">
        {total === 0 ? 'No forms' : `Showing ${start}–${end} of ${total} forms`}
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
