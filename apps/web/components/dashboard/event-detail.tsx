'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import type { IconSvgElement } from '@hugeicons/react'
import {
  ArrowLeft01Icon,
  Edit02Icon,
  PlusSignIcon,
  Calendar03Icon,
  Clock01Icon,
  Location01Icon,
  Money01Icon,
  Ticket01Icon,
  CheckmarkCircle02Icon,
  QrCodeScanIcon,
  ArchiveIcon,
  Delete02Icon,
  MusicNote03Icon,
  Idea01Icon,
  DrinkIcon,
  UserGroupIcon,
  GameController01Icon,
  CameraVideoIcon,
  Briefcase01Icon,
  PaintBoardIcon,
  Sparkles,
  StarIcon,
} from '@hugeicons/core-free-icons'

import { cn } from '@ticketur/ui/lib/utils'
import { Button } from '@ticketur/ui/components/button'
import { MarkdownView } from '@ticketur/ui/components/markdown-view'

import { EventGuestList } from '@/components/dashboard/event-guest-list'
import { EventFormsPanel } from '@/components/dashboard/forms/event-forms-panel'
import { EventContestsPanel } from '@/components/dashboard/contests/event-contests-panel'
import { useTRPC } from '@/lib/trpc'
import { STATUS_LABEL, STATUS_TONE, type EventStatus } from '@/lib/org-events'
import {
  eventCode,
  formatEventDate,
  formatNaira,
  formatWeekday,
} from '@/lib/event-display'

const FEATURE_ICONS: Record<string, IconSvgElement> = {
  'Live DJ Sets': MusicNote03Icon,
  'Laser Show': Idea01Icon,
  'Open VIP Bar': DrinkIcon,
  Mascots: UserGroupIcon,
  Games: GameController01Icon,
  'Food & Drink': DrinkIcon,
  Workshops: Briefcase01Icon,
  Networking: UserGroupIcon,
  'Live Music': MusicNote03Icon,
  'Photo Booth': CameraVideoIcon,
  'Art Showcase': PaintBoardIcon,
}

function iconForFeature(label: string): IconSvgElement {
  return FEATURE_ICONS[label] ?? StarIcon ?? Sparkles
}

const STATUS_HERO_BADGE: Record<EventStatus, string> = {
  upcoming: 'bg-emerald-500 text-white',
  'in-review': 'bg-sky-500 text-white',
  draft: 'bg-amber-500 text-white',
  archived: 'bg-zinc-700 text-white',
  suspended: 'bg-rose-500 text-white',
}

const STATUS_HERO_LABEL: Record<EventStatus, string> = {
  upcoming: 'UPCOMING EVENT',
  'in-review': 'IN REVIEW',
  draft: 'DRAFT',
  archived: 'ARCHIVED',
  suspended: 'SUSPENDED',
}

export function EventDetail({ id }: { id: string }) {
  const trpc = useTRPC()
  const router = useRouter()
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery(
    trpc.org.events.byId.queryOptions({ id })
  )

  const archive = useMutation(
    trpc.org.events.archive.mutationOptions({
      onSuccess: () => {
        toast.success('Event archived')
        queryClient.invalidateQueries({
          queryKey: trpc.org.events.byId.queryKey({ id }),
        })
        queryClient.invalidateQueries({
          queryKey: trpc.org.events.list.queryKey(),
        })
        queryClient.invalidateQueries({
          queryKey: trpc.org.dashboard.stats.queryKey(),
        })
      },
      onError: (e) =>
        toast.error('Could not archive', { description: e.message }),
    })
  )

  const remove = useMutation(
    trpc.org.events.delete.mutationOptions({
      onSuccess: () => {
        toast.success('Event deleted')
        queryClient.invalidateQueries({
          queryKey: trpc.org.events.list.queryKey(),
        })
        queryClient.invalidateQueries({
          queryKey: trpc.org.dashboard.stats.queryKey(),
        })
        router.push('/org/events')
      },
      onError: (e) =>
        toast.error('Could not delete', { description: e.message }),
    })
  )

  const publish = useMutation(
    trpc.org.events.publish.mutationOptions({
      onSuccess: () => {
        toast.success('Event submitted for review')
        queryClient.invalidateQueries({
          queryKey: trpc.org.events.byId.queryKey({ id }),
        })
        queryClient.invalidateQueries({
          queryKey: trpc.org.events.list.queryKey(),
        })
        queryClient.invalidateQueries({
          queryKey: trpc.org.dashboard.stats.queryKey(),
        })
      },
      onError: (e) =>
        toast.error('Could not publish', { description: e.message }),
    })
  )

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-muted-foreground text-sm">Loading event…</p>
      </div>
    )
  }
  if (!data) {
    // Server returned null — let server-side notFound handle it via the page.
    return null
  }

  const { event, tiers, vendors, externalInvites, sold, total, revenueMinor } =
    data
  const status = event.status as EventStatus
  const showStats = status === 'upcoming' || status === 'archived'
  const showStepper = status === 'in-review'
  // Editable until the event is frozen (archived/suspended). Published events
  // stay editable so organizers can correct details.
  const showEdit =
    status === 'draft' || status === 'in-review' || status === 'upcoming'
  const showPublish = status === 'draft'
  const pct = total > 0 ? Math.min(100, Math.round((sold / total) * 100)) : 0
  const code = eventCode(event.id)

  return (
    <div className="flex min-h-0 flex-1 [scrollbar-width:none] flex-col gap-6 overflow-y-auto md:gap-8 [&::-webkit-scrollbar]:hidden">
      <header className="flex shrink-0 flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-6">
        <div className="flex flex-col gap-1.5">
          <h1 className="font-heading text-foreground text-2xl font-bold tracking-tight md:text-[28px]">
            Events
          </h1>
          <p className="text-muted-foreground text-sm md:text-base">
            Track, manage and edit your scheduled events
          </p>
        </div>
        <Button size="xl" asChild className="w-full md:w-auto">
          <Link href="/org/create-event" className="gap-2">
            <HugeiconsIcon
              icon={PlusSignIcon}
              className="size-5"
              strokeWidth={2}
            />
            Create Event
          </Link>
        </Button>
      </header>

      {event.pendingChanges ? (
        <div className="border-primary/25 bg-primary/5 text-foreground/90 shrink-0 rounded-xl border px-4 py-3 text-sm">
          You have changes awaiting admin approval. The details below are the
          current live version — your edits appear once an admin approves them.
        </div>
      ) : null}

      <div className="flex shrink-0 items-center justify-between gap-3">
        <Link
          href="/org/events"
          className="text-foreground hover:text-primary inline-flex items-center gap-1.5 text-sm font-medium transition-colors"
        >
          <HugeiconsIcon
            icon={ArrowLeft01Icon}
            className="size-4"
            strokeWidth={2}
          />
          Back
        </Link>
        <div className="flex items-center gap-3">
          {status === 'upcoming' ? (
            <Link
              href={`/org/events/${event.id}/check-in`}
              className="text-primary hover:text-primary/80 inline-flex items-center gap-1.5 text-sm font-semibold transition-colors"
            >
              <HugeiconsIcon
                icon={QrCodeScanIcon}
                className="size-4"
                strokeWidth={2}
              />
              Check In
            </Link>
          ) : null}
          {showEdit ? (
            <Link
              href={`/org/events/${event.id}/edit`}
              className="text-primary hover:text-primary/80 inline-flex items-center gap-1.5 text-sm font-semibold transition-colors"
            >
              <HugeiconsIcon
                icon={Edit02Icon}
                className="size-4"
                strokeWidth={2}
              />
              Edit Event
            </Link>
          ) : null}
          {showPublish ? (
            <button
              type="button"
              disabled={publish.isPending}
              onClick={() => publish.mutate({ id: event.id })}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-600 transition-colors hover:text-emerald-700 disabled:opacity-50 dark:text-emerald-400 dark:hover:text-emerald-300"
            >
              <HugeiconsIcon
                icon={CheckmarkCircle02Icon}
                className="size-4"
                strokeWidth={2}
              />
              Publish
            </button>
          ) : null}
          {status === 'upcoming' ? (
            <button
              type="button"
              disabled={archive.isPending}
              onClick={() => archive.mutate({ id: event.id })}
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm font-semibold transition-colors disabled:opacity-50"
            >
              <HugeiconsIcon
                icon={ArchiveIcon}
                className="size-4"
                strokeWidth={2}
              />
              Archive
            </button>
          ) : null}
          {status === 'archived' || status === 'draft' ? (
            <button
              type="button"
              disabled={remove.isPending}
              onClick={() => {
                if (
                  confirm(`Delete "${event.title}"? This cannot be undone.`)
                ) {
                  remove.mutate({ id: event.id })
                }
              }}
              className="text-destructive hover:text-destructive/80 inline-flex items-center gap-1.5 text-sm font-semibold transition-colors disabled:opacity-50"
            >
              <HugeiconsIcon
                icon={Delete02Icon}
                className="size-4"
                strokeWidth={2}
              />
              Delete
            </button>
          ) : null}
        </div>
      </div>

      {showStepper ? <ReviewStepper /> : null}

      <HeroCard
        status={status}
        title={event.title}
        code={code}
        bannerUrl={event.bannerUrl}
      />

      <Section title="Description">
        {event.description ? (
          <MarkdownView className="text-muted-foreground prose-p:text-muted-foreground">
            {event.description}
          </MarkdownView>
        ) : (
          <p className="text-muted-foreground text-sm leading-7 md:text-base">
            No description provided.
          </p>
        )}
      </Section>

      <Section title="Event Details">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <DetailItem
            icon={Calendar03Icon}
            primary={
              event.endDate && event.endDate !== event.eventDate
                ? formatEventDate(event.eventDate, event.endDate)
                : event.eventDate
                  ? `${formatWeekday(event.eventDate)}, ${formatEventDate(event.eventDate)}`
                  : 'TBD'
            }
          />
          <DetailItem icon={Clock01Icon} primary={event.eventTime} />
          <DetailItem icon={Location01Icon} primary={event.location} />
        </div>
      </Section>

      {event.features.length > 0 ? (
        <Section title="Features">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
            {event.features.map((label) => (
              <FeatureCard
                key={label}
                icon={iconForFeature(label)}
                label={label}
              />
            ))}
          </div>
        </Section>
      ) : null}

      {showStats ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatBlock
            icon={Money01Icon}
            label="Total Revenue"
            value={formatNaira(revenueMinor)}
            tone="emerald"
          />
          <SoldStatBlock sold={sold} total={total} pct={pct} />
          <DateStatBlock
            date={formatEventDate(event.eventDate, event.endDate)}
            ended={status === 'archived'}
          />
        </div>
      ) : null}

      <Section title="Ticket Tier Sales">
        {tiers.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No ticket tiers configured.
          </p>
        ) : (
          <div className="border-border/60 bg-background overflow-hidden rounded-2xl border">
            <ul className="divide-border/60 divide-y">
              {tiers.map((t, idx) => (
                <TicketTierRow
                  key={t.id}
                  name={t.name}
                  tierLabel={`Tier ${idx + 1}`}
                  sold={t.sold}
                  total={t.quantity}
                  price={formatNaira(t.priceMinor)}
                  status={status}
                />
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section title="Registration Forms">
        <EventFormsPanel eventId={event.id} />
      </Section>

      <Section title="Contests & Voting">
        <EventContestsPanel eventId={event.id} />
      </Section>

      <Section title="Guest List">
        <EventGuestList eventId={event.id} />
      </Section>

      {(vendors.length > 0 || externalInvites.length > 0) && (
        <Section title="Assigned Vendors">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {vendors.map((v) => (
              <VendorCard
                key={v.id}
                name={v.vendor.businessName ?? 'Vendor'}
                description={v.vendor.businessDescription ?? ''}
                image={v.vendor.image}
                status={v.status === 'accepted' ? 'verified' : 'pending'}
              />
            ))}
            {externalInvites.map((inv) => (
              <VendorCard
                key={inv.id}
                name={inv.businessName}
                description={`Invited via email — ${inv.email}`}
                image={null}
                status={inv.status === 'accepted' ? 'verified' : 'pending'}
              />
            ))}
          </div>
        </Section>
      )}

      <div className="flex shrink-0 items-center justify-between md:hidden">
        <span
          className={cn(
            'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium',
            STATUS_TONE[status]
          )}
        >
          {STATUS_LABEL[status]}
        </span>
      </div>
    </div>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="flex shrink-0 flex-col gap-3">
      <h2 className="font-heading text-foreground text-base font-bold tracking-tight md:text-lg">
        {title}
      </h2>
      {children}
    </section>
  )
}

function HeroCard({
  status,
  title,
  code,
  bannerUrl,
}: {
  status: EventStatus
  title: string
  code: string
  bannerUrl: string | null
}) {
  return (
    <div className="relative isolate flex h-[200px] shrink-0 items-end overflow-hidden rounded-2xl md:h-[280px]">
      <Image
        src={bannerUrl ?? '/hero-bg.png'}
        alt=""
        fill
        priority
        sizes="(min-width: 768px) 900px, 100vw"
        className="object-cover"
        unoptimized={Boolean(bannerUrl?.startsWith('data:'))}
      />
      <div
        aria-hidden
        className="absolute inset-0 bg-linear-to-t from-black/80 via-black/40 to-black/30"
      />
      <div className="relative flex w-full flex-col gap-2 p-5 md:p-7">
        <span
          className={cn(
            'inline-flex w-fit items-center rounded-md px-2.5 py-1 text-[10px] font-bold tracking-wider uppercase',
            STATUS_HERO_BADGE[status]
          )}
        >
          {STATUS_HERO_LABEL[status]}
        </span>
        <h2 className="font-heading text-2xl font-bold tracking-tight text-white md:text-3xl">
          {title}
        </h2>
        <p className="text-xs text-white/70 md:text-sm">ID: {code}</p>
      </div>
    </div>
  )
}

function ReviewStepper() {
  return (
    <div className="border-border/60 bg-background flex shrink-0 rounded-2xl border p-5 md:p-6">
      <div className="flex w-full items-start">
        <StepperStep
          bullet={
            <span className="bg-primary flex size-7 items-center justify-center rounded-full text-white">
              <HugeiconsIcon
                icon={CheckmarkCircle02Icon}
                className="size-4"
                strokeWidth={2.5}
              />
            </span>
          }
          label="Published"
          tone="active"
        />
        <StepperConnector filled />
        <StepperStep
          bullet={
            <span className="bg-primary flex size-7 items-center justify-center rounded-full">
              <span className="bg-background flex size-3.5 items-center justify-center rounded-full">
                <span className="bg-primary size-1.5 rounded-full" />
              </span>
            </span>
          }
          label="In - Review"
          tone="active"
        />
        <StepperConnector filled={false} />
        <StepperStep
          bullet={
            <span className="bg-muted-foreground/40 size-1.5 rounded-full" />
          }
          label="Approved"
          tone="muted"
        />
      </div>
    </div>
  )
}

function StepperStep({
  bullet,
  label,
  tone,
}: {
  bullet: React.ReactNode
  label: string
  tone: 'active' | 'muted'
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex h-7 items-center justify-center">{bullet}</div>
      <span
        className={cn(
          'text-xs font-medium md:text-sm',
          tone === 'muted' ? 'text-muted-foreground' : 'text-foreground'
        )}
      >
        {label}
      </span>
    </div>
  )
}

function StepperConnector({ filled }: { filled: boolean }) {
  return (
    <div className="flex h-7 flex-1 items-center px-1">
      <div
        className={cn(
          'h-0.5 w-full rounded-full',
          filled ? 'bg-primary' : 'bg-border/40'
        )}
      />
    </div>
  )
}

function DetailItem({
  icon,
  primary,
}: {
  icon: IconSvgElement
  primary: string
}) {
  return (
    <div className="flex items-center gap-2.5">
      <HugeiconsIcon
        icon={icon}
        className="text-primary size-5 shrink-0"
        strokeWidth={1.8}
      />
      <span className="text-foreground text-sm font-medium md:text-base">
        {primary}
      </span>
    </div>
  )
}

function FeatureCard({ icon, label }: { icon: IconSvgElement; label: string }) {
  return (
    <div className="bg-primary/5 border-primary/10 flex flex-col items-center justify-center gap-2 rounded-xl border px-3 py-4">
      <span className="bg-background text-primary flex size-9 items-center justify-center rounded-full">
        <HugeiconsIcon icon={icon} className="size-4" strokeWidth={1.8} />
      </span>
      <span className="text-foreground text-center text-xs font-medium md:text-sm">
        {label}
      </span>
    </div>
  )
}

function StatBlock({
  icon,
  label,
  value,
  tone,
}: {
  icon: IconSvgElement
  label: string
  value: string
  tone: 'emerald' | 'primary'
}) {
  return (
    <div className="border-border/60 bg-background flex flex-col gap-3 rounded-2xl border p-5 shadow-sm shadow-black/[0.02]">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'flex size-8 items-center justify-center rounded-lg',
            tone === 'emerald'
              ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400'
              : 'bg-primary/10 text-primary'
          )}
        >
          <HugeiconsIcon icon={icon} className="size-4" strokeWidth={1.8} />
        </span>
        <span className="text-muted-foreground text-sm font-medium">
          {label}
        </span>
      </div>
      <p className="font-heading text-foreground text-2xl font-bold tracking-tight md:text-[28px]">
        {value}
      </p>
    </div>
  )
}

function SoldStatBlock({
  sold,
  total,
  pct,
}: {
  sold: number
  total: number
  pct: number
}) {
  return (
    <div className="border-border/60 bg-background flex flex-col gap-3 rounded-2xl border p-5 shadow-sm shadow-black/[0.02]">
      <div className="flex items-center gap-2">
        <span className="bg-primary/10 text-primary flex size-8 items-center justify-center rounded-lg">
          <HugeiconsIcon
            icon={Ticket01Icon}
            className="size-4"
            strokeWidth={1.8}
          />
        </span>
        <span className="text-muted-foreground text-sm font-medium">
          Tickets Sold
        </span>
      </div>
      <p className="font-heading text-foreground text-2xl font-bold tracking-tight md:text-[28px]">
        {sold.toLocaleString()}{' '}
        <span className="text-muted-foreground text-sm font-medium">
          / {total.toLocaleString()}
        </span>
      </p>
      <div className="flex items-center gap-2">
        <div className="bg-muted relative h-1.5 flex-1 overflow-hidden rounded-full">
          <div
            className="bg-primary absolute inset-y-0 left-0 rounded-full"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-muted-foreground text-xs font-semibold">
          {pct}%
        </span>
      </div>
    </div>
  )
}

function DateStatBlock({ date, ended }: { date: string; ended: boolean }) {
  return (
    <div className="border-border/60 bg-background flex flex-col gap-3 rounded-2xl border p-5 shadow-sm shadow-black/[0.02]">
      <div className="flex items-center gap-2">
        <span className="bg-primary/10 text-primary flex size-8 items-center justify-center rounded-lg">
          <HugeiconsIcon
            icon={Calendar03Icon}
            className="size-4"
            strokeWidth={1.8}
          />
        </span>
        <span className="text-muted-foreground text-sm font-medium">
          Event Date
        </span>
      </div>
      <p className="font-heading text-foreground text-2xl font-bold tracking-tight md:text-[28px]">
        {date.replace(/, \d{4}$/, '')}
      </p>
      {ended ? (
        <p className="text-muted-foreground text-xs font-semibold">Ended</p>
      ) : null}
    </div>
  )
}

function TicketTierRow({
  name,
  tierLabel,
  sold,
  total,
  price,
  status,
}: {
  name: string
  tierLabel: string
  sold: number
  total: number
  price: string
  status: EventStatus
}) {
  const isInReviewOrDraft = status === 'in-review' || status === 'draft'
  const pct = total > 0 ? Math.min(100, Math.round((sold / total) * 100)) : 0
  const soldOut = sold >= total && total > 0
  const almostDone = !soldOut && pct >= 90
  const active = !soldOut && !almostDone && sold > 0

  let badge: { label: string; className: string } | null = null
  if (status === 'archived' || soldOut) {
    badge = {
      label: 'SOLD OUT',
      className:
        'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
    }
  } else if (status === 'upcoming') {
    if (almostDone) {
      badge = {
        label: 'ALMOST DONE',
        className:
          'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
      }
    } else if (active) {
      badge = {
        label: 'ACTIVE',
        className:
          'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400',
      }
    }
  }

  return (
    <li className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center md:gap-5">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-lg">
          <HugeiconsIcon
            icon={Ticket01Icon}
            className="size-4"
            strokeWidth={1.8}
          />
        </span>
        <div className="flex min-w-0 flex-col">
          <p className="text-foreground text-sm font-semibold">{name}</p>
          <p className="text-muted-foreground text-xs">{tierLabel}</p>
        </div>
      </div>

      <div className="flex flex-1 items-center gap-3 md:max-w-xs">
        {isInReviewOrDraft ? (
          <span className="text-muted-foreground text-sm">
            {total} available
          </span>
        ) : (
          <>
            <span className="text-muted-foreground text-xs whitespace-nowrap">
              {sold}/{total}
            </span>
            <div className="bg-muted relative h-1.5 flex-1 overflow-hidden rounded-full">
              <div
                className="bg-foreground absolute inset-y-0 left-0 rounded-full"
                style={{ width: `${pct}%` }}
              />
            </div>
          </>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 md:justify-end md:gap-5">
        {badge ? (
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider whitespace-nowrap',
              badge.className
            )}
          >
            {badge.label}
          </span>
        ) : (
          <span className="md:hidden" />
        )}
        <span className="text-foreground text-sm font-bold whitespace-nowrap">
          {price}
        </span>
      </div>
    </li>
  )
}

function VendorCard({
  name,
  description,
  image,
  status,
}: {
  name: string
  description: string
  image: string | null
  status: 'verified' | 'pending'
}) {
  const initial = name.charAt(0).toUpperCase()
  return (
    <div className="border-border/60 bg-background flex flex-col gap-3 overflow-hidden rounded-2xl border p-3">
      <div className="bg-primary/10 relative flex h-28 items-center justify-center overflow-hidden rounded-xl">
        {image ? (
          <Image src={image} alt={name} fill className="object-cover" />
        ) : (
          <span className="font-heading text-primary text-3xl font-bold opacity-60">
            {initial}
          </span>
        )}
        <span
          className={cn(
            'absolute top-2 right-2 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase',
            status === 'verified'
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400'
              : 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400'
          )}
        >
          {status}
        </span>
      </div>
      <div className="flex flex-col gap-1 px-1">
        <p className="text-foreground text-sm font-semibold">{name}</p>
        <p className="text-muted-foreground line-clamp-2 text-xs leading-5">
          {description}
        </p>
      </div>
    </div>
  )
}
