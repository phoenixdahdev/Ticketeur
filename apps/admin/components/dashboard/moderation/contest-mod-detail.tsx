import Image from 'next/image'
import { format } from 'date-fns'
import { HugeiconsIcon } from '@hugeicons/react'
import type { IconSvgElement } from '@hugeicons/react'
import {
  Alert02Icon,
  Calendar03Icon,
  Clock01Icon,
  GlobalIcon,
  Tag01Icon,
  UserGroupIcon,
} from '@hugeicons/core-free-icons'

import { cn } from '@ticketur/ui/lib/utils'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@ticketur/ui/components/avatar'
import type { RouterOutputs } from '@ticketur/api'

import { ApproveRejectActions } from '@/components/dashboard/moderation/approve-reject-actions'
import { TakeDownContestAction } from '@/components/dashboard/moderation/take-down-contest-action'
import {
  formatEventDateRange,
  formatShortDate as formatJoined,
  toDate,
} from '@/lib/date'

type ReviewContest = NonNullable<
  RouterOutputs['admin']['moderation']['contestById']
>
type Category = ReviewContest['categories'][number]
type Entry = Category['entries'][number]
type Bundle = ReviewContest['bundles'][number]

const STATUS_LABEL: Record<ReviewContest['status'], string> = {
  draft: 'a draft',
  pending_review: 'waiting for review',
  published: 'live',
  rejected: 'rejected',
  closed: 'closed',
  suspended: 'taken down',
}

const EVENT_STATUS_LABEL: Record<ReviewContest['event']['status'], string> = {
  draft: 'Event is a draft',
  'in-review': 'Event awaiting approval',
  upcoming: 'Event is live',
  archived: 'Event archived',
  suspended: 'Event suspended',
}

const ENTRY_STATUS_LABEL: Record<Entry['status'], string | null> = {
  active: null,
  withdrawn: 'Withdrawn',
  disqualified: 'Disqualified',
}

// Prices come back in minor units (kobo).
function formatNaira(minor: number) {
  return minor === 0 ? 'Free' : `₦${(minor / 100).toLocaleString('en-NG')}`
}

function formatDateTime(iso: string) {
  const date = toDate(iso)
  return date ? format(date, "MMM d, yyyy 'at' h:mm a") : iso
}

function votingWindowLabel(contest: ReviewContest) {
  const { votingOpensAt: opens, votingClosesAt: closes } = contest
  if (opens && closes) {
    return `Voting ${formatDateTime(opens)} – ${formatDateTime(closes)}`
  }
  if (opens) return `Voting opens ${formatDateTime(opens)}`
  if (closes) return `Voting closes ${formatDateTime(closes)}`
  return 'Voting runs from approval until the organizer closes it'
}

function nominationsLabel(contest: ReviewContest) {
  const { nominationsOpenAt: opens, nominationsCloseAt: closes } = contest
  if (!opens && !closes) return null
  if (opens && closes) {
    return `Nominations ${formatDateTime(opens)} – ${formatDateTime(closes)}`
  }
  if (opens) return `Nominations open ${formatDateTime(opens)}`
  return `Nominations close ${formatDateTime(closes!)}`
}

function reviewedLabel(contest: ReviewContest) {
  if (!contest.lastReview) return ''
  const by = contest.lastReview.by ? ` by ${contest.lastReview.by}` : ''
  return ` on ${formatJoined(contest.lastReview.at)}${by}`
}

function getInitials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p.charAt(0).toUpperCase())
      .join('') || '?'
  )
}

// Everything an admin is judging, laid out the way a voter meets it: the
// wording, the ballot category by category, and what a vote costs. Nothing
// here is editable — approving approves exactly this revision.
export function ContestModDetail({
  contest,
  changedWhileOpen,
}: {
  contest: ReviewContest
  // A reload replaced the version the admin first opened.
  changedWhileOpen: boolean
}) {
  const entryCount = contest.categories.reduce(
    (n, category) => n + category.entries.length,
    0
  )
  const nominations = nominationsLabel(contest)

  return (
    <div className="flex flex-col gap-6 md:gap-8">
      <div className="border-border/60 bg-background relative aspect-[1360/360] w-full overflow-hidden rounded-2xl border">
        {contest.event.bannerUrl ? (
          <Image
            src={contest.event.bannerUrl}
            alt=""
            fill
            sizes="(max-width: 1024px) 100vw, 1360px"
            className="object-cover"
            priority
          />
        ) : (
          <div className="from-primary to-primary/70 size-full bg-gradient-to-br" />
        )}
      </div>

      {changedWhileOpen ? (
        <Notice
          tone="warning"
          title="This contest changed while you were reviewing it"
        >
          You&apos;re now looking at the latest version. Read the whole ballot
          again before you approve it.
        </Notice>
      ) : null}

      <ReviewNotice contest={contest} />

      <section className="border-border/60 bg-background flex flex-col gap-2 rounded-2xl border p-5 md:p-6">
        <h3 className="text-foreground text-base font-semibold">
          Contest Name
        </h3>
        <p className="text-foreground text-base">{contest.title}</p>
      </section>

      <section className="border-border/60 bg-background flex flex-col gap-2 rounded-2xl border p-5 md:p-6">
        <h3 className="text-foreground text-base font-semibold">Description</h3>
        <p className="text-muted-foreground text-sm whitespace-pre-wrap md:text-base">
          {contest.description || 'No description.'}
        </p>
      </section>

      <section className="border-border/60 bg-background flex flex-col gap-4 rounded-2xl border p-5 md:p-6">
        <h3 className="text-foreground text-base font-semibold">
          Contest Details
        </h3>
        <div className="flex flex-wrap gap-3">
          <DetailPill icon={Tag01Icon} text={contest.event.title} />
          <DetailPill
            icon={Calendar03Icon}
            text={`${formatEventDateRange(contest.event.eventDate, contest.event.endDate)} · ${EVENT_STATUS_LABEL[contest.event.status]}`}
          />
          <DetailPill icon={Clock01Icon} text={votingWindowLabel(contest)} />
          {nominations ? (
            <DetailPill icon={UserGroupIcon} text={nominations} />
          ) : null}
          {/* The zone decides when "today" rolls over for the daily free
              vote, so it is part of what a free voter is being promised. */}
          <DetailPill icon={GlobalIcon} text={contest.timeZone} />
        </div>
        <p className="text-muted-foreground text-xs">
          {contest.submittedAt
            ? `Submitted for review ${formatDateTime(contest.submittedAt)} · `
            : ''}
          {contest.voteCount.toLocaleString('en-NG')} vote
          {contest.voteCount === 1 ? '' : 's'} cast
          {contest.unspentCredits > 0
            ? ` · ${contest.unspentCredits.toLocaleString('en-NG')} paid-for vote${contest.unspentCredits === 1 ? '' : 's'} not yet used`
            : ''}
        </p>
      </section>

      <VotingCostSection contest={contest} />

      <section className="border-border/60 bg-background flex flex-col gap-5 rounded-2xl border p-5 md:p-6">
        <div className="flex flex-col gap-1">
          <h3 className="text-foreground text-base font-semibold">
            What People Vote On
          </h3>
          <p className="text-muted-foreground text-sm">
            {contest.categories.length}{' '}
            {contest.categories.length === 1 ? 'category' : 'categories'} and{' '}
            {entryCount} {entryCount === 1 ? 'entry' : 'entries'}, in the order
            they appear on the contest page. Every name, photo and bio below was
            written by the organizer.
          </p>
        </div>

        {contest.categories.length === 0 ? (
          <p className="border-border/60 text-muted-foreground rounded-xl border border-dashed p-4 text-center text-sm">
            This contest has no categories, so there is nothing to vote in.
          </p>
        ) : (
          contest.categories.map((category, i) => (
            <CategoryPreview
              key={category.id}
              category={category}
              number={i + 1}
            />
          ))
        )}
      </section>

      <section className="border-border/60 bg-background flex flex-col gap-3 rounded-2xl border p-5 md:p-6">
        <h3 className="text-foreground text-base font-semibold">
          Organizer Details
        </h3>
        <div className="flex items-start gap-4">
          <Avatar className="border-border/60 size-16 border">
            {contest.organizer.image ? (
              <AvatarImage asChild src={contest.organizer.image} alt="">
                <Image
                  src={contest.organizer.image}
                  alt=""
                  width={64}
                  height={64}
                  className="object-cover"
                />
              </AvatarImage>
            ) : null}
            <AvatarFallback className="bg-primary/10 text-primary text-base font-semibold">
              {getInitials(contest.organizer.name)}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-1 flex-col gap-1">
            <span className="text-foreground text-lg font-bold">
              {contest.organizer.name}
            </span>
            <span className="text-muted-foreground text-sm">
              {contest.organizer.email}
            </span>
            <div className="mt-2 flex items-center gap-3">
              <span
                className={cn(
                  'text-xs font-semibold',
                  contest.organizer.status === 'active'
                    ? 'text-emerald-600'
                    : 'text-rose-600'
                )}
              >
                {contest.organizer.status === 'active' ? 'Active' : 'Suspended'}
              </span>
              <span className="text-muted-foreground/40">•</span>
              <span className="text-foreground text-xs font-semibold">
                Date Joined
              </span>
              <span className="text-muted-foreground text-xs">
                {formatJoined(contest.organizer.joinedAt)}
              </span>
            </div>
          </div>
        </div>
      </section>

      {contest.status === 'pending_review' ? (
        <ApproveRejectActions
          kind="contest"
          id={contest.id}
          name={contest.title}
          revision={contest.revision}
          redirectTo="/moderation?tab=contests"
        />
      ) : null}

      {/* A contest the public can reach: live, or closed with its results
          page still up. Approval is behind it, so the only moderation left
          is pulling it. */}
      {contest.status === 'published' || contest.status === 'closed' ? (
        <TakeDownContestAction
          id={contest.id}
          name={contest.title}
          live={contest.status === 'published'}
          unspentCredits={contest.unspentCredits}
        />
      ) : null}
    </div>
  )
}

// What the public is charged, and how. Reviewed content, exactly as a form's
// price options are — so it gets a section of its own rather than a footnote.
function VotingCostSection({ contest }: { contest: ReviewContest }) {
  const onSale = contest.bundles.filter((b) => b.active)
  const retired = contest.bundles.filter((b) => !b.active)

  return (
    <section className="border-border/60 bg-background flex flex-col gap-4 rounded-2xl border p-5 md:p-6">
      <div className="flex flex-col gap-1">
        <h3 className="text-foreground text-base font-semibold">
          How Voting Is Paid For
        </h3>
        <p className="text-muted-foreground text-sm">
          What the public is charged is part of what they agree to. A platform
          service fee is added on top of every price below at checkout and shown
          to the voter as its own line.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <CostRow
          on={contest.freeVotingEnabled}
          label="Free voting"
          detail="One free vote per verified email, per category, per day."
        />
        <CostRow
          on={contest.paidVotingEnabled}
          label="Paid voting"
          detail={
            contest.pricePerVoteMinor > 0
              ? `${formatNaira(contest.pricePerVoteMinor)} for a single vote, plus any bundles below.`
              : 'Bundles only — no price is set for a single loose vote.'
          }
        />
      </div>

      {onSale.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {onSale.map((bundle) => (
            <BundleRow key={bundle.id} bundle={bundle} />
          ))}
        </ul>
      ) : contest.paidVotingEnabled ? (
        <p className="border-border/60 text-muted-foreground rounded-xl border border-dashed p-4 text-center text-sm">
          No vote bundles are on sale.
        </p>
      ) : null}

      {retired.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-xs">
            Retired — not on sale, kept because orders already reference them:
          </p>
          <ul className="flex flex-col gap-2">
            {retired.map((bundle) => (
              <BundleRow key={bundle.id} bundle={bundle} />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

function CostRow({
  on,
  label,
  detail,
}: {
  on: boolean
  label: string
  detail: string
}) {
  return (
    <div className="border-input flex flex-wrap items-center justify-between gap-2 rounded-[8px] border px-4 py-3 text-sm">
      <span className="flex flex-col gap-0.5">
        <span className="text-foreground font-medium">{label}</span>
        <span className="text-muted-foreground text-xs">{detail}</span>
      </span>
      <span
        className={cn(
          'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold',
          on
            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400'
            : 'bg-muted text-muted-foreground'
        )}
      >
        {on ? 'On' : 'Off'}
      </span>
    </div>
  )
}

function BundleRow({ bundle }: { bundle: Bundle }) {
  return (
    <li
      className={cn(
        'border-input flex flex-wrap items-center justify-between gap-2 rounded-[8px] border px-4 py-3 text-sm',
        !bundle.active && 'opacity-60'
      )}
    >
      <span className="flex items-center gap-3">
        <span className="text-foreground font-medium">{bundle.label}</span>
        <span className="text-muted-foreground text-xs">
          {bundle.votes.toLocaleString('en-NG')} vote
          {bundle.votes === 1 ? '' : 's'}
        </span>
      </span>
      <span className="text-foreground font-semibold">
        {formatNaira(bundle.priceMinor)}
      </span>
    </li>
  )
}

function CategoryPreview({
  category,
  number,
}: {
  category: Category
  number: number
}) {
  return (
    <div className="border-border/60 flex flex-col gap-3 rounded-xl border p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
          Category {number}
        </span>
        <span className="bg-muted text-foreground inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold uppercase">
          {category.entries.length}{' '}
          {category.entries.length === 1 ? 'entry' : 'entries'}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-foreground text-sm font-semibold whitespace-pre-wrap">
          {category.title}
        </p>
        {category.description ? (
          <p className="text-muted-foreground text-xs whitespace-pre-wrap">
            {category.description}
          </p>
        ) : null}
      </div>

      {category.entries.length === 0 ? (
        <p className="border-border/60 text-muted-foreground rounded-[8px] border border-dashed px-4 py-3 text-center text-xs">
          Nobody is standing in this category yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {category.entries.map((entry) => (
            <EntryPreview key={entry.id} entry={entry} />
          ))}
        </ul>
      )}
    </div>
  )
}

// An entry IS the ballot: the organizer wrote every word and picked the
// photo, so all of it is on screen rather than summarised.
function EntryPreview({ entry }: { entry: Entry }) {
  const flag = ENTRY_STATUS_LABEL[entry.status]

  return (
    <li className="border-input flex items-start gap-3 rounded-[8px] border px-4 py-3">
      {entry.photoUrl ? (
        <Image
          src={entry.photoUrl}
          alt=""
          width={56}
          height={56}
          className="size-14 shrink-0 rounded-md object-cover"
        />
      ) : (
        <div className="bg-muted text-muted-foreground flex size-14 shrink-0 items-center justify-center rounded-md text-xs font-semibold">
          No photo
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-foreground text-sm font-semibold whitespace-pre-wrap">
            {entry.displayName}
          </span>
          {flag ? (
            <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-500/15 dark:text-rose-400">
              {flag}
            </span>
          ) : null}
          {entry.promoted ? (
            <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[10px] font-semibold">
              From a registration
            </span>
          ) : null}
        </span>
        {entry.bio ? (
          <span className="text-muted-foreground text-xs whitespace-pre-wrap">
            {entry.bio}
          </span>
        ) : null}
      </div>
      <span className="text-muted-foreground shrink-0 text-xs whitespace-nowrap">
        {entry.voteCount.toLocaleString('en-NG')} vote
        {entry.voteCount === 1 ? '' : 's'}
      </span>
    </li>
  )
}

const NOTICE_TONE = {
  warning:
    'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200',
  danger:
    'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200',
  muted: 'border-border/60 bg-muted/40 text-foreground',
} as const

// Why this contest is in front of the admin, when it isn't simply new.
function ReviewNotice({ contest }: { contest: ReviewContest }) {
  if (contest.status === 'suspended') {
    return (
      <Notice tone="danger" title="This contest was taken down">
        Voting has stopped and its page is not public. Its organizer can only
        get it back by fixing it and submitting it for review
        {reviewedLabel(contest) ? `. Taken down${reviewedLabel(contest)}` : ''}.
        <span className="mt-2 block font-medium whitespace-pre-wrap">
          “{contest.rejectionReason}”
        </span>
      </Notice>
    )
  }
  if (contest.status !== 'pending_review') {
    return (
      <Notice
        tone="muted"
        title={`This contest is ${STATUS_LABEL[contest.status]}`}
      >
        It isn&apos;t waiting for review, so there is nothing to approve.
        {contest.lastReview ? ` Last reviewed${reviewedLabel(contest)}.` : ''}
      </Notice>
    )
  }
  if (contest.history === 'resubmitted') {
    return (
      <Notice tone="danger" title="Resubmitted after a rejection">
        An earlier version was rejected{reviewedLabel(contest)}. Check the
        reason has been dealt with:
        <span className="mt-2 block font-medium whitespace-pre-wrap">
          “{contest.rejectionReason}”
        </span>
      </Notice>
    )
  }
  if (contest.history === 'edited') {
    return (
      <Notice tone="warning" title="Changed after approval">
        This contest was approved{reviewedLabel(contest)}, then its organizer
        edited it, so voting stopped until you approve this version.
        {contest.voteCount > 0
          ? ` ${contest.voteCount.toLocaleString('en-NG')} vote${contest.voteCount === 1 ? ' has' : 's have'} already been cast.`
          : ''}
      </Notice>
    )
  }
  return null
}

function Notice({
  tone,
  title,
  children,
}: {
  tone: keyof typeof NOTICE_TONE
  title: string
  children: React.ReactNode
}) {
  return (
    <section
      className={cn(
        'flex items-start gap-3 rounded-2xl border p-5 md:p-6',
        NOTICE_TONE[tone]
      )}
    >
      <HugeiconsIcon
        icon={Alert02Icon}
        className="mt-0.5 size-5 shrink-0"
        strokeWidth={1.8}
      />
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="text-sm">{children}</p>
      </div>
    </section>
  )
}

function DetailPill({ icon, text }: { icon: IconSvgElement; text: string }) {
  return (
    <span className="border-primary/30 bg-primary/5 text-foreground inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm">
      <HugeiconsIcon
        icon={icon}
        className="text-primary size-4"
        strokeWidth={1.8}
      />
      {text}
    </span>
  )
}
