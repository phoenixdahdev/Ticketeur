'use client'

import { useCallback, useMemo, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { toast } from 'sonner'
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
  Download01Icon,
  Search01Icon,
  ViewIcon,
} from '@hugeicons/core-free-icons'

import { cn } from '@ticketur/ui/lib/utils'
import { Button } from '@ticketur/ui/components/button'
import { Input } from '@ticketur/ui/components/input'

import { useTRPC } from '@/lib/trpc'
import {
  downloadCsv,
  formatDateTime,
  plural,
  SUBMISSION_STATUS_LABEL,
  SUBMISSION_STATUS_TONE,
  SUBMISSIONS_PAGE_SIZE,
  type SubmissionRow,
} from '@/lib/org-forms'
import { FormStatusBadge } from '@/components/dashboard/forms/review-notice'

const STATUS_VALUES = [
  'all',
  'submitted',
  'approved',
  'rejected',
  'pending_payment',
] as const
type StatusValue = (typeof STATUS_VALUES)[number]

const TABS: { value: StatusValue; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'submitted', label: 'Needs review' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'pending_payment', label: 'Awaiting payment' },
]

const SORT_FIELDS = ['date', 'name', 'status'] as const
type SortField = (typeof SORT_FIELDS)[number]

const DIR_VALUES = ['asc', 'desc'] as const
type SortDir = (typeof DIR_VALUES)[number]

export function SubmissionsContent({ formId }: { formId: string }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [exporting, setExporting] = useState(false)

  const [params, setParams] = useQueryStates(
    {
      status: parseAsStringLiteral(STATUS_VALUES).withDefault('all'),
      q: parseAsString.withDefault(''),
      sort: parseAsStringLiteral(SORT_FIELDS).withDefault('date'),
      dir: parseAsStringLiteral(DIR_VALUES).withDefault('desc'),
      page: parseAsInteger.withDefault(1),
    },
    { history: 'replace', clearOnDefault: true }
  )

  const formQuery = useQuery(trpc.org.forms.byId.queryOptions({ id: formId }))

  const listQuery = useQuery(
    trpc.org.forms.submissions.list.queryOptions({
      formId,
      status: params.status,
      q: params.q,
      sort: params.sort,
      dir: params.dir,
      page: params.page,
      pageSize: SUBMISSIONS_PAGE_SIZE,
    })
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

  // `export` hands back a finished table; turning it into a file is the
  // browser's job.
  const exportCsv = useCallback(async () => {
    setExporting(true)
    try {
      const table = await queryClient.fetchQuery(
        trpc.org.forms.submissions.export.queryOptions({
          formId,
          status: params.status,
        })
      )
      downloadCsv(table)
      toast.success('Download started', {
        description: `${plural(table.rows.length, 'application')} exported.`,
      })
    } catch (err) {
      toast.error('Could not export', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setExporting(false)
    }
  }, [formId, params.status, queryClient, trpc])

  const form = formQuery.data
  const rows = listQuery.data?.rows ?? []
  const total = listQuery.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / SUBMISSIONS_PAGE_SIZE))
  const current = Math.min(Math.max(params.page, 1), totalPages)
  const hasPriceOptions = (form?.priceOptions.length ?? 0) > 0

  const counts = form?.counts
  const tabCount = useMemo(() => {
    if (!counts) return () => null as number | null
    return (value: StatusValue): number | null => {
      switch (value) {
        case 'all':
          return counts.total
        case 'submitted':
          return counts.submitted
        case 'approved':
          return counts.approved
        case 'rejected':
          return counts.rejected
        case 'pending_payment':
          return counts.pendingPayment
      }
    }
  }, [counts])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 md:gap-8">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <Link
          href={`/org/forms/${formId}`}
          className="text-foreground hover:text-primary inline-flex items-center gap-1.5 text-sm font-medium transition-colors"
        >
          <HugeiconsIcon
            icon={ArrowLeft01Icon}
            className="size-4"
            strokeWidth={2}
          />
          Back to the form
        </Link>
      </div>

      <header className="flex shrink-0 flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-6">
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-heading text-foreground text-2xl font-bold tracking-tight md:text-[28px]">
              Applications
            </h1>
            {form ? <FormStatusBadge status={form.form.status} /> : null}
          </div>
          <p className="text-muted-foreground text-sm md:text-base">
            {form ? form.form.title : 'Loading…'}
            {form ? ` · ${form.event.title}` : ''}
          </p>
        </div>
        <Button
          type="button"
          size="xl"
          variant="outline"
          disabled={exporting || total === 0}
          onClick={() => void exportCsv()}
          className="w-full gap-2 md:w-auto"
        >
          <HugeiconsIcon
            icon={Download01Icon}
            className="size-5"
            strokeWidth={1.8}
          />
          {exporting ? 'Preparing…' : 'Export CSV'}
        </Button>
      </header>

      {form && form.form.status === 'pending_review' ? (
        <p className="shrink-0 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-100">
          This form is waiting for an admin to approve its questions, so no new
          applications can arrive. The ones below are unaffected — review them
          as usual.
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="flex shrink-0 flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-6">
          <div
            role="tablist"
            aria-label="Filter by application status"
            className="border-border/60 -mx-1 flex [scrollbar-width:none] items-center gap-1 overflow-x-auto border-b px-1 pb-px md:flex-1 [&::-webkit-scrollbar]:hidden"
          >
            {TABS.map((t) => {
              const active = params.status === t.value
              const count = tabCount(t.value)
              return (
                <button
                  key={t.value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => void setParams({ status: t.value, page: 1 })}
                  className={cn(
                    'relative shrink-0 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors md:text-base',
                    active
                      ? 'text-primary'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {t.label}
                  {count ? (
                    <span className="text-muted-foreground ml-1.5 text-xs font-semibold">
                      {count}
                    </span>
                  ) : null}
                  {active ? (
                    <motion.span
                      layoutId="org-submissions-tab-indicator"
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

          <div className="relative w-full sm:w-72">
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
              placeholder="Name, email or reference"
              aria-label="Search applications"
              className="h-10 w-full pl-9"
            />
          </div>
        </div>

        <div className="border-border/60 bg-background flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border shadow-sm shadow-black/[0.02]">
          <div className="min-h-0 w-full flex-1 [scrollbar-width:none] overflow-auto [&::-webkit-scrollbar]:hidden">
            <table className="w-full min-w-[860px] table-auto">
              <thead className="bg-primary/5">
                <tr className="text-muted-foreground text-xs font-semibold tracking-wider uppercase select-none">
                  <SortableHeader
                    field="name"
                    sort={params.sort}
                    dir={params.dir}
                    onSort={handleSort}
                  >
                    Applicant
                  </SortableHeader>
                  <SortableHeader
                    field="status"
                    sort={params.sort}
                    dir={params.dir}
                    onSort={handleSort}
                  >
                    Status
                  </SortableHeader>
                  {hasPriceOptions ? (
                    <th className="px-5 py-4 text-left">Option</th>
                  ) : null}
                  <SortableHeader
                    field="date"
                    sort={params.sort}
                    dir={params.dir}
                    onSort={handleSort}
                  >
                    Applied
                  </SortableHeader>
                  <th className="px-5 py-4 text-left">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-border/60 divide-y">
                {listQuery.isLoading ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-16 text-center">
                      <p className="text-muted-foreground text-sm">
                        Loading applications…
                      </p>
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-16 text-center">
                      <p className="text-muted-foreground text-sm">
                        {params.q || params.status !== 'all'
                          ? 'No applications match your filters.'
                          : 'Nobody has applied yet.'}
                      </p>
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <SubmissionTableRow
                      key={row.id}
                      row={row}
                      formId={formId}
                      showOption={hasPriceOptions}
                    />
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

function SubmissionTableRow({
  row,
  formId,
  showOption,
}: {
  row: SubmissionRow
  formId: string
  showOption: boolean
}) {
  const href = `/org/forms/${formId}/submissions/${row.id}`
  return (
    <tr className="text-sm">
      <td className="px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="bg-muted relative size-10 shrink-0 overflow-hidden rounded-full">
            {row.thumbnailUrl ? (
              <Image
                src={row.thumbnailUrl}
                alt=""
                fill
                sizes="40px"
                className="object-cover"
              />
            ) : (
              <span className="text-muted-foreground flex size-full items-center justify-center text-xs font-semibold">
                {initials(row.applicantName)}
              </span>
            )}
          </span>
          <div className="flex min-w-0 flex-col">
            <Link
              href={href}
              className="text-foreground hover:text-primary font-semibold transition-colors"
            >
              {row.applicantName}
            </Link>
            <span className="text-muted-foreground truncate text-xs">
              {row.applicantEmail} · {row.reference}
            </span>
          </div>
        </div>
      </td>
      <td className="px-5 py-4">
        <span
          className={cn(
            'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap',
            SUBMISSION_STATUS_TONE[row.status]
          )}
        >
          {SUBMISSION_STATUS_LABEL[row.status]}
        </span>
      </td>
      {showOption ? (
        <td className="text-foreground px-5 py-4">
          {row.priceOptionName ?? '—'}
        </td>
      ) : null}
      <td className="text-foreground px-5 py-4 whitespace-nowrap">
        {formatDateTime(row.createdAt)}
      </td>
      <td className="px-5 py-4">
        <Link
          href={href}
          aria-label={`Review ${row.applicantName}'s application`}
          className="text-primary hover:bg-primary/10 focus-visible:ring-primary/40 inline-flex size-8 items-center justify-center rounded-md transition-colors outline-none focus-visible:ring-2"
        >
          <HugeiconsIcon icon={ViewIcon} className="size-4" strokeWidth={1.8} />
        </Link>
      </td>
    </tr>
  )
}

function initials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('') || '?'
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

  const start = total === 0 ? 0 : (current - 1) * SUBMISSIONS_PAGE_SIZE + 1
  const end = Math.min(current * SUBMISSIONS_PAGE_SIZE, total)

  return (
    <div className="flex shrink-0 flex-col items-start justify-between gap-4 pt-2 sm:flex-row sm:items-center">
      <p className="text-muted-foreground text-xs sm:text-sm">
        {total === 0
          ? 'No applications'
          : `Showing ${start}–${end} of ${total} applications`}
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
