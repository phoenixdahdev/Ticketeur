'use client'

import { useMemo } from 'react'
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
  Search01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
} from '@hugeicons/core-free-icons'

import { cn } from '@ticketur/ui/lib/utils'
import { Input } from '@ticketur/ui/components/input'
import {
  NativeSelect,
  NativeSelectOption,
} from '@ticketur/ui/components/native-select'

import { useTRPC } from '@/lib/trpc'
import { formatShortDate } from '@/lib/date'
import {
  DISCREPANCY_KINDS,
  KIND_LABEL,
  KIND_SEVERITY,
  formatMoney,
} from '@/components/dashboard/refunds/kinds'

const KIND_FILTERS = ['all', ...DISCREPANCY_KINDS] as const
const STATUS_FILTERS = ['open', 'resolved', 'all'] as const

const STATUS_LABEL: Record<(typeof STATUS_FILTERS)[number], string> = {
  open: 'Awaiting refund',
  resolved: 'Refunded',
  all: 'All',
}

const PAGE_SIZE = 10

export function RefundsContent() {
  const trpc = useTRPC()

  const [params, setParams] = useQueryStates(
    {
      kind: parseAsStringLiteral(KIND_FILTERS).withDefault('all'),
      status: parseAsStringLiteral(STATUS_FILTERS).withDefault('open'),
      q: parseAsString.withDefault(''),
      page: parseAsInteger.withDefault(1),
    },
    { history: 'replace', clearOnDefault: true }
  )

  const listQuery = useQuery(
    trpc.admin.paymentDiscrepancies.list.queryOptions({
      kind: params.kind,
      status: params.status,
      q: params.q,
      page: params.page,
      pageSize: PAGE_SIZE,
    })
  )

  const rows = listQuery.data?.rows ?? []
  const total = listQuery.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const current = Math.min(Math.max(params.page, 1), totalPages)

  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label="Filter by what happened"
        className="bg-background -mx-1 flex shrink-0 [scrollbar-width:none] items-center gap-2 overflow-x-auto px-1 py-1 sm:mx-0 [&::-webkit-scrollbar]:hidden"
      >
        {KIND_FILTERS.map((k) => {
          const active = params.kind === k
          return (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => void setParams({ kind: k, page: 1 })}
              className={cn(
                'border-border/60 relative shrink-0 rounded-full border px-5 py-2 text-sm font-semibold whitespace-nowrap transition-colors md:px-6 md:py-2.5',
                active
                  ? 'text-primary-foreground border-transparent'
                  : 'text-foreground/80 hover:text-foreground'
              )}
            >
              {active ? (
                <motion.span
                  layoutId="refunds-kind-pill"
                  className="bg-primary absolute inset-0 rounded-full"
                  transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                />
              ) : null}
              <span className="relative">
                {k === 'all' ? 'All' : KIND_LABEL[k]}
              </span>
            </button>
          )
        })}
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
        <div className="relative w-full">
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
            placeholder="Customer, order ID, tx_ref or transaction ID"
            aria-label="Search refunds owed"
            className="h-10 w-full pl-9"
          />
        </div>
        <NativeSelect
          value={params.status}
          aria-label="Filter by refund status"
          onChange={(e) =>
            void setParams({
              status: e.target
                .value as (typeof STATUS_FILTERS)[number],
              page: 1,
            })
          }
          className="w-full md:w-56"
        >
          {STATUS_FILTERS.map((s) => (
            <NativeSelectOption key={s} value={s}>
              {STATUS_LABEL[s]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>

      <div className="border-border/60 bg-background overflow-hidden rounded-2xl border">
        <div className="[scrollbar-width:none] overflow-x-auto [&::-webkit-scrollbar]:hidden">
          <table className="w-full min-w-[960px] table-auto">
            <thead className="bg-primary/5">
              <tr className="text-muted-foreground text-xs font-semibold tracking-wider uppercase select-none">
                <th className="px-5 py-4 text-left">Customer</th>
                <th className="px-5 py-4 text-left">What happened</th>
                <th className="px-5 py-4 text-right">Order asked for</th>
                <th className="px-5 py-4 text-right">Customer paid</th>
                <th className="px-5 py-4 text-right">Owed back</th>
                <th className="px-5 py-4 text-left">Detected</th>
                <th className="px-5 py-4 text-left">Refund</th>
              </tr>
            </thead>
            <tbody className="divide-border/60 divide-y">
              {listQuery.isLoading ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center">
                    <p className="text-muted-foreground text-sm">Loading…</p>
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center">
                    <p className="text-muted-foreground text-sm">
                      {params.q || params.kind !== 'all'
                        ? 'Nothing matches these filters.'
                        : params.status === 'open'
                          ? 'No refunds owed — every charge is settled.'
                          : 'Nothing recorded yet.'}
                    </p>
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr
                    key={row.id}
                    className="hover:bg-muted/40 text-sm transition-colors"
                  >
                    <td className="px-5 py-4">
                      <Link
                        href={`/refunds/${row.id}`}
                        className="flex flex-col"
                      >
                        <span className="text-foreground hover:text-primary font-semibold transition-colors">
                          {row.customerName}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {row.customerEmail || row.orderId}
                        </span>
                      </Link>
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={cn(
                          'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold whitespace-nowrap',
                          KIND_SEVERITY[row.kind] === 'danger'
                            ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400'
                            : 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400'
                        )}
                      >
                        {KIND_LABEL[row.kind]}
                      </span>
                      {row.eventName ? (
                        <span className="text-muted-foreground mt-1 block text-xs">
                          {row.eventName}
                        </span>
                      ) : null}
                    </td>
                    <td className="text-muted-foreground px-5 py-4 text-right whitespace-nowrap">
                      {formatMoney(row.expectedMinor)}
                    </td>
                    <td className="text-foreground px-5 py-4 text-right whitespace-nowrap">
                      {formatMoney(row.paidMinor, row.paidCurrency)}
                    </td>
                    <td className="px-5 py-4 text-right font-semibold whitespace-nowrap text-rose-600 dark:text-rose-400">
                      {formatMoney(row.owedMinor, row.paidCurrency)}
                    </td>
                    <td className="text-muted-foreground px-5 py-4 whitespace-nowrap">
                      {formatShortDate(row.detectedAt)}
                    </td>
                    <td className="px-5 py-4 whitespace-nowrap">
                      {row.status === 'resolved' ? (
                        <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                          Recorded
                        </span>
                      ) : (
                        <Link
                          href={`/refunds/${row.id}`}
                          className="text-primary text-xs font-semibold hover:underline"
                        >
                          Review →
                        </Link>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Pagination
        total={total}
        shown={rows.length}
        current={current}
        totalPages={totalPages}
        onPage={(p) => void setParams({ page: p })}
      />
    </div>
  )
}

function Pagination({
  total,
  shown,
  current,
  totalPages,
  onPage,
}: {
  total: number
  shown: number
  current: number
  totalPages: number
  onPage: (page: number) => void
}) {
  const visibleRange = useMemo(() => {
    if (totalPages <= 3) {
      return Array.from({ length: totalPages }, (_, i) => i + 1)
    }
    if (current <= 2) return [1, 2, 3]
    if (current >= totalPages - 1) {
      return [totalPages - 2, totalPages - 1, totalPages]
    }
    return [current - 1, current, current + 1]
  }, [current, totalPages])

  return (
    <div className="flex flex-col items-start justify-between gap-4 pt-2 sm:flex-row sm:items-center">
      <p className="text-muted-foreground text-xs sm:text-sm">
        Showing {shown} of {total.toLocaleString('en-US')}
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
          : 'text-foreground hover:bg-muted'
      )}
    >
      {children}
    </button>
  )
}
