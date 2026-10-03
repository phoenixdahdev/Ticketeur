import { and, eq, sql } from 'drizzle-orm'

import type { ContestStatus, Database, VoteKind } from '@ticketur/db'
import { contests, db, entries, orders, voteCredits, votes } from '@ticketur/db'

import { newId } from './ids'

// Contest voting mechanics: the credit balance a purchase grants, spending it,
// and landing a vote in the ledger.
//
// Two paths share this module, and both must end up in the same `votes` rows:
//
//   paid — the voter buys a bundle (or loose votes), fulfilment grants the
//          credits, and each cast spends from that balance. Credits are a
//          BALANCE per (contest, voter), not a vote for anyone: the voter
//          decides where they go afterwards.
//   free — a verified email gets one vote per category per day, spends no
//          credits, and goes straight to castVotes.
//
// ── Where each guarantee lives ──
// Every rule that two concurrent requests could otherwise slip past is decided
// by the DATABASE, in one statement, never by a read followed by a write:
//
//   not spending credits you never bought  → spendVoteCredits' conditional
//     UPDATE (`spent + n <= purchased`), the idiom mintOrderTickets uses on
//     ticket stock. A zero-row result IS the refusal.
//   not voting for an entry that is withdrawn, disqualified, or in another
//     contest or category → castVotes' conditional UPDATE on `entries`. The
//     same statement that bumps voteCount is the one that checks the entry,
//     so there is no window between the check and the count.
//   not crediting one payment twice → grantVoteCredits, see its comment.
//
// The read-time checks (votingAvailability below, the router's entry lookup)
// exist so the UI can say WHY something is refused. They are never the thing
// that makes it safe.
//
// ── Lock order ──
// Always vote_credits → entries → votes. The free path simply skips the first,
// so it can never hold `entries` while waiting for a credit row, and the two
// paths cannot deadlock each other.

// The tx handle drizzle hands to `db.transaction(async (tx) => …)`. Declared
// here rather than imported so this module depends on nothing but the schema.
export type DbTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0]

/**
 * The identity a vote and a credit balance hang on. Lower-cased and trimmed in
 * ONE place, because `vote_credits_owner_unique` is on the raw column: if the
 * grant stored "Ada@x.com" and the spend looked up "ada@x.com" the voter would
 * have paid for a balance they can never reach.
 */
export function normalizeVoterEmail(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * The day a vote counts against, 'YYYY-MM-DD'. UTC, matching every other date
 * bucket on the platform (`stillRunning`, `hasEnded` in predicates.ts).
 *
 * Shared so the free path's daily allowance resets on exactly the day this
 * writes — the partial unique index `votes_free_daily_unique` is on this
 * string, so two definitions of "today" would be two different allowances.
 * Note for the free path: at UTC+1 the Nigerian day rolls over at 01:00 local.
 */
export const DEFAULT_VOTE_TIME_ZONE = 'Africa/Lagos'

/**
 * Whether a string is an IANA zone this runtime can actually resolve. Used
 * when a contest's zone is set, so a typo is refused at write time rather
 * than silently shifting every free vote at read time.
 */
export function isValidTimeZone(timeZone: string): boolean {
  if (timeZone.trim() === '') return false
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone })
    return true
  } catch {
    return false
  }
}

/**
 * The calendar day a vote counts against — the bucket the daily free vote
 * resets on, as 'YYYY-MM-DD'.
 *
 * Computed in the CONTEST'S OWN zone, not the server's. A Nigerian contest
 * rolls over at local midnight; on a UTC server, a naive
 * `toISOString().slice(0, 10)` would roll it over at 01:00 local instead,
 * which is both wrong and invisible — the index would happily enforce the
 * wrong day. 'en-CA' is used because it formats as YYYY-MM-DD natively.
 *
 * An unresolvable zone falls back to the default rather than throwing: a vote
 * must not fail because a contest carries a bad string, and the fallback is
 * the zone this platform operates in.
 */
export function voteDay(
  timeZone: string = DEFAULT_VOTE_TIME_ZONE,
  now: Date = new Date()
): string {
  // Tried in order, because the fallback can fail too: a runtime built with
  // small-icu resolves no named zone at all, so formatting with the default
  // after rejecting the argument would throw just the same. UTC is the last
  // resort — it is the one zone every build can resolve. A vote must never
  // fail because of how the runtime was compiled.
  for (const zone of [timeZone, DEFAULT_VOTE_TIME_ZONE, 'UTC']) {
    if (!isValidTimeZone(zone)) continue
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: zone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(now)
    } catch {
      // Resolvable but unformattable: try the next one.
    }
  }
  // Nothing resolved. toISOString is UTC and always works.
  return now.toISOString().slice(0, 10)
}

// ─── The voting window ──────────────────────────────────────────────────────

export type VotingClosedReason = 'not_published' | 'not_open_yet' | 'closed'

export type VotingAvailability =
  { open: true } | { open: false; reason: VotingClosedReason }

/** Just the columns the window rule reads. */
export type VotingWindow = {
  status: ContestStatus
  votingOpensAt: Date | null
  votingClosesAt: Date | null
}

/**
 * Whether a contest takes votes right now, and why not when it doesn't.
 *
 * A read-time rule, in the style of `hasEnded`: nothing sweeps contests shut,
 * so the window is checked on every read and every cast rather than by a job.
 * NULL opensAt means open from the moment it was published; NULL closesAt
 * means open until the organizer closes it. `closesAt` is EXCLUSIVE — voting
 * is open while `now < closesAt` — the same boundary `formAvailability` uses.
 *
 * One definition for the public page, the checkout guard and the cast guard,
 * so the three cannot drift.
 */
export function votingAvailability(
  contest: VotingWindow,
  now: Date = new Date()
): VotingAvailability {
  if (contest.status !== 'published') {
    // 'closed' is the contest finishing normally; draft, pending_review,
    // rejected and suspended are all "this is not a contest you can vote in",
    // and the public loader never surfaces them anyway.
    return {
      open: false,
      reason: contest.status === 'closed' ? 'closed' : 'not_published',
    }
  }
  if (contest.votingClosesAt && now >= contest.votingClosesAt) {
    return { open: false, reason: 'closed' }
  }
  if (contest.votingOpensAt && now < contest.votingOpensAt) {
    return { open: false, reason: 'not_open_yet' }
  }
  return { open: true }
}

/** `votingAvailability` as a boolean, for callers with nothing to explain. */
export function votingIsOpen(
  contest: VotingWindow,
  now: Date = new Date()
): boolean {
  return votingAvailability(contest, now).open
}

// ─── Granting credits ───────────────────────────────────────────────────────

export type VoteCreditBalance = {
  creditId: string
  contestId: string
  voterEmail: string
  purchased: number
  spent: number
}

/** Why a grant did not happen. A subset of VoteCreditFailure, deliberately
 * sharing its words so fulfilment can pass a reason straight through. */
export type GrantVoteCreditsFailure =
  // The order is already 'paid', so this is a replay. See the comment below.
  | 'already_credited'
  // No such order.
  | 'order_missing'
  // The order's quantity is not a positive number of votes.
  | 'no_votes'

export type GrantVoteCreditsResult =
  | { granted: true; balance: VoteCreditBalance }
  | { granted: false; reason: GrantVoteCreditsFailure }

/**
 * Add the votes an order bought to its buyer's balance for the contest.
 *
 * ── Why this cannot credit one payment twice ──
 * It is the `justFulfilled` pattern from orders.ts, enforced here instead of
 * trusted from the caller. fulfillOrder locks the order row FOR UPDATE and
 * flips it pending→paid in the same transaction as the delivery, so exactly
 * one caller ever makes that transition: the FW webhook, the /checkout/return
 * page and the reconciliation job all race into the same lock and the losers
 * re-read `status = 'paid'` and deliver nothing.
 *
 * This function takes that same row lock itself and refuses an order that is
 * already 'paid'. Re-locking inside fulfillOrder's transaction is free (a
 * Postgres row lock is per-transaction), and it means a replay cannot double
 * credit even if it somehow reaches this function directly — on a replay the
 * lock is released only by the winner's COMMIT, after which the status is
 * 'paid' and this returns `already_credited`.
 *
 * THE LIMIT, stated plainly: the once-only token is the order's pending→paid
 * transition, so this is only safe inside the transaction that performs it.
 * grantVoteCredits must not be called anywhere but fulfilment. Two calls from
 * outside fulfilment, where nothing flips the status, would both see 'pending'
 * and both credit. (The alternative — recomputing `purchased` as the sum of
 * every paid vote_purchase order for this voter — would be idempotent on its
 * own, but it would redefine `purchased` as derived and quietly overwrite any
 * credit granted by another route, so it is not what this does.)
 *
 * The upsert itself is a single statement against `vote_credits_owner_unique`,
 * so two grants for different orders by the same voter cannot lose one to a
 * lost update: the second blocks on the row and adds to the committed total.
 */
export async function grantVoteCredits(
  tx: DbTransaction,
  args: {
    contestId: string
    voterEmail: string
    voterUserId: string | null
    // How many votes this order bought.
    votes: number
    orderId: string
  }
): Promise<GrantVoteCreditsResult> {
  if (!Number.isSafeInteger(args.votes) || args.votes <= 0) {
    return { granted: false, reason: 'no_votes' }
  }
  const voterEmail = normalizeVoterEmail(args.voterEmail)

  const [order] = await tx
    .select({ status: orders.status })
    .from(orders)
    .where(eq(orders.id, args.orderId))
    .for('update')
    .limit(1)
  if (!order) return { granted: false, reason: 'order_missing' }
  if (order.status === 'paid') {
    return { granted: false, reason: 'already_credited' }
  }

  const now = new Date()
  const [row] = await tx
    .insert(voteCredits)
    .values({
      id: newId('vcr'),
      contestId: args.contestId,
      voterEmail,
      voterUserId: args.voterUserId,
      purchased: args.votes,
      spent: 0,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [voteCredits.contestId, voteCredits.voterEmail],
      set: {
        // Read-modify-write in ONE statement: `purchased` is the committed
        // value of the row this conflicted with, not a value we read earlier.
        purchased: sql`${voteCredits.purchased} + ${args.votes}`,
        // A voter who bought as a guest and later signed in gets their
        // account attached; one who buys signed-out afterwards keeps it.
        voterUserId: sql`coalesce(excluded.${sql.raw(voteCredits.voterUserId.name)}, ${voteCredits.voterUserId})`,
        updatedAt: now,
      },
    })
    .returning({
      id: voteCredits.id,
      purchased: voteCredits.purchased,
      spent: voteCredits.spent,
    })

  // Unreachable: the insert either inserts or updates, and both RETURNING.
  if (!row) return { granted: false, reason: 'order_missing' }

  return {
    granted: true,
    balance: {
      creditId: row.id,
      contestId: args.contestId,
      voterEmail,
      purchased: row.purchased,
      spent: row.spent,
    },
  }
}

// ─── Spending credits ───────────────────────────────────────────────────────

export type SpendVoteCreditsResult =
  | { ok: true; purchased: number; spent: number; remaining: number }
  | { ok: false }

/**
 * Take `count` votes off a voter's balance for a contest. `ok: false` means
 * there were not enough — or there is no balance at all.
 *
 * ONE conditional UPDATE, never a read followed by a write:
 *
 *   SET spent = spent + n WHERE … AND spent + n <= purchased
 *
 * exactly as `mintOrderTickets` guards ticket stock with
 * `sold + n <= quantity`. Why that is enough at READ COMMITTED: two concurrent
 * spends on the same balance both try to lock the row; the loser blocks until
 * the winner commits, then RE-EVALUATES its WHERE clause against the winner's
 * committed row. So the second spend tests `spent + n <= purchased` against
 * the already-decremented balance and matches nothing when the credits have
 * run out. A read-then-write would have both read the old `spent` and both
 * pass. The CHECK constraint `vote_credits_not_overspent` backs this up at the
 * storage layer, so even a future caller that got the SQL wrong cannot
 * overspend — it would get an error instead of a silent overdraft.
 *
 * Must run inside the caller's transaction, so the spend and the vote it pays
 * for commit together: if the cast is refused, the rollback hands the credits
 * straight back.
 */
export async function spendVoteCredits(
  tx: DbTransaction,
  args: { contestId: string; voterEmail: string; count: number }
): Promise<SpendVoteCreditsResult> {
  if (!Number.isSafeInteger(args.count) || args.count <= 0) return { ok: false }
  const voterEmail = normalizeVoterEmail(args.voterEmail)

  const updated = await tx
    .update(voteCredits)
    .set({
      spent: sql`${voteCredits.spent} + ${args.count}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(voteCredits.contestId, args.contestId),
        eq(voteCredits.voterEmail, voterEmail),
        sql`${voteCredits.spent} + ${args.count} <= ${voteCredits.purchased}`
      )
    )
    .returning({
      purchased: voteCredits.purchased,
      spent: voteCredits.spent,
    })

  const row = updated[0]
  if (!row) return { ok: false }
  return {
    ok: true,
    purchased: row.purchased,
    spent: row.spent,
    remaining: row.purchased - row.spent,
  }
}

// ─── Casting a vote ─────────────────────────────────────────────────────────

export type CastVotesResult =
  | { ok: true; voteId: string; voteCount: number }
  | { ok: false; reason: 'entry_unavailable' }

/**
 * Land a vote in the `votes` ledger and bump `entries.voteCount`, in one
 * transaction, so the running total and the audit trail it is derived from can
 * never disagree.
 *
 * ── The entry guard ──
 * The UPDATE that bumps the count is also the check. Its WHERE clause pins the
 * entry's id, its contest, its category and `status = 'active'` at once, so a
 * zero-row result (`entry_unavailable`) covers every way the vote is not
 * allowed, decided by the database:
 *   - the entry does not exist;
 *   - it belongs to a DIFFERENT CONTEST — credits are per contest, and this is
 *     what stops a balance bought for one contest being spent in another;
 *   - it belongs to a different category than the caller believes;
 *   - it was withdrawn or disqualified. A withdrawn or disqualified entry
 *     stays visible with the votes it already has, and takes no new ones; an
 *     organizer disqualifying mid-request wins the race rather than losing it.
 * The caller re-checks all of this first only so it can say which one it was.
 *
 * ── Contract for the FREE path (built next) ──
 * Call this UNCHANGED. A free vote is exactly this call with
 * `kind: 'free'`, `quantity: 1`, `orderId: null` and no spendVoteCredits
 * before it. Two things are deliberately NOT handled here, because they are
 * the free path's:
 *   - the one-per-email-per-category-per-day allowance. It is the partial
 *     unique index `votes_free_daily_unique` on (categoryId, voterEmail,
 *     votedOn), and this function does NOT catch its violation: the INSERT
 *     raises, the caller's transaction rolls back (including the voteCount
 *     bump), and the free resolver turns the error into "you have already
 *     voted in this category today". Catching it here would hide the one
 *     guarantee that makes free voting safe under concurrency.
 *   - proving the email. That is vote_otps, and it must happen before this.
 *   - THE VOTING WINDOW. This function never loads the contest, so it cannot
 *     tell an open contest from a closed, suspended or not-yet-open one. Call
 *     votingAvailability first, as vote-checkout.castPaid does, or free votes
 *     will keep landing after voting has shut.
 *
 * ── Why orderId is null on the paid path ──
 * Paid votes spend a pooled BALANCE that may have been bought over several
 * orders, so no single order funded a given cast. `vote-checkout.castPaid`
 * therefore passes null; the money trail is vote_credits plus the
 * vote_purchase orders carrying this contest in `referenceId`. The parameter
 * stays for a caller that genuinely has one order behind one vote.
 */
export async function castVotes(
  tx: DbTransaction,
  args: {
    contestId: string
    categoryId: string
    entryId: string
    kind: VoteKind
    voterEmail: string
    voterUserId: string | null
    // Paid votes can be allocated several at a time; a free vote is always 1.
    quantity: number
    orderId: string | null
    // 'YYYY-MM-DD', from voteDay().
    votedOn: string
  }
): Promise<CastVotesResult> {
  if (!Number.isSafeInteger(args.quantity) || args.quantity <= 0) {
    return { ok: false, reason: 'entry_unavailable' }
  }
  const voterEmail = normalizeVoterEmail(args.voterEmail)

  // The guard and the increment, in one statement. Taken BEFORE the ledger
  // insert so a refused vote writes nothing, and so every caller takes the
  // `entries` row at the same point in the lock order.
  const [bumped] = await tx
    .update(entries)
    .set({
      voteCount: sql`${entries.voteCount} + ${args.quantity}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(entries.id, args.entryId),
        eq(entries.contestId, args.contestId),
        eq(entries.categoryId, args.categoryId),
        eq(entries.status, 'active')
      )
    )
    .returning({ voteCount: entries.voteCount })

  if (!bumped) return { ok: false, reason: 'entry_unavailable' }

  const voteId = newId('vote')
  await tx.insert(votes).values({
    id: voteId,
    contestId: args.contestId,
    categoryId: args.categoryId,
    entryId: args.entryId,
    kind: args.kind,
    voterEmail,
    voterUserId: args.voterUserId,
    quantity: args.quantity,
    orderId: args.orderId,
    votedOn: args.votedOn,
  })

  return { ok: true, voteId, voteCount: bumped.voteCount }
}

// ─── Fulfilling a vote purchase ─────────────────────────────────────────────

export type VoteCreditFailure =
  // The order names no contest.
  | 'no_reference'
  // The contest it names is gone.
  | 'contest_missing'
  // The order carries no buyer email, so there is no balance to credit.
  | 'no_voter'
  // 'already_credited' and 'order_missing' are reachable only in states
  // fulfilment cannot produce; see grantVoteCredits.
  | GrantVoteCreditsFailure

export type VotePurchaseCredit = {
  contestId: string
  voterEmail: string
  // Votes THIS order bought.
  votesGranted: number
  // The balance afterwards.
  purchased: number
  spent: number
  // True when the contest had already stopped accepting votes by the time the
  // charge cleared. The credits exist and can never be spent, so the caller
  // owes the buyer their money back — fulfilment records that obligation.
  unusable: boolean
  contestTitle: string
  contestSlug: string
}

/**
 * The vote-purchase half of fulfillOrder, mirroring `creditRegistrationFee`.
 * Only fulfillOrder calls this, inside its transaction, holding the order row
 * lock, and only after the charge has passed its amount and currency check:
 * this never looks at the charge, so it must never be reached any other way.
 *
 * ── What the order carries, and why ──
 * `referenceId` is the CONTEST, not an entry: buying grants a balance for the
 * contest and the voter chooses entries later. (The `orders.referenceId`
 * comment predates the voting model and says "a contest entry"; it cannot be,
 * because vote_credits is keyed on (contest, voter).)
 *
 * `quantity` is the number of VOTES, snapshotted at checkout — deliberately
 * not a pointer to the bundle. The same reasoning as `orders.feeMinor`: the
 * buyer gets what they bought even if the organizer edits the bundle, retires
 * it, or changes how many votes it grants while the payment is in flight.
 *
 * ── Deliberately checks nothing about the contest's state ──
 * Contests close and get suspended while a voter is on the payment page; none
 * of that undoes a payment, exactly as a form closing does not undo a paid
 * registration. Refusing here would be worse than crediting: the money has
 * arrived, and a refusal strands the order with nothing recorded against it.
 * Credits that can no longer be spent are logged loudly below so a person can
 * refund them — nothing does that automatically.
 */
export async function creditVotePurchase(
  tx: DbTransaction,
  order: {
    id: string
    referenceId: string | null
    quantity: number
    buyerEmail: string
    buyerId: string | null
  }
): Promise<
  | { ok: true; credit: VotePurchaseCredit }
  | { ok: false; reason: VoteCreditFailure }
> {
  if (!order.referenceId) return { ok: false, reason: 'no_reference' }
  const voterEmail = normalizeVoterEmail(order.buyerEmail)
  if (voterEmail === '') return { ok: false, reason: 'no_voter' }
  if (!Number.isSafeInteger(order.quantity) || order.quantity <= 0) {
    return { ok: false, reason: 'no_votes' }
  }

  const [contest] = await tx
    .select({
      id: contests.id,
      title: contests.title,
      slug: contests.slug,
      status: contests.status,
      votingOpensAt: contests.votingOpensAt,
      votingClosesAt: contests.votingClosesAt,
    })
    .from(contests)
    .where(eq(contests.id, order.referenceId))
    .limit(1)
  if (!contest) return { ok: false, reason: 'contest_missing' }

  const granted = await grantVoteCredits(tx, {
    contestId: contest.id,
    voterEmail,
    voterUserId: order.buyerId,
    votes: order.quantity,
    orderId: order.id,
  })
  if (!granted.granted) return { ok: false, reason: granted.reason }

  const unusable = !votingIsOpen(contest)
  if (unusable) {
    // Paid for, credited, and unspendable: the contest closed or was
    // suspended between the payment link and the charge clearing. The money is
    // real, so fulfilment puts it on the Refunds Owed screen for a person to
    // pay back — nothing refunds it automatically.
    console.error('[votes] credits granted to a contest that is not voting', {
      orderId: order.id,
      contestId: contest.id,
      contestStatus: contest.status,
      votesGranted: order.quantity,
      voterEmail,
    })
  }

  return {
    ok: true,
    credit: {
      unusable,
      contestTitle: contest.title,
      contestSlug: contest.slug,
      contestId: contest.id,
      voterEmail,
      votesGranted: order.quantity,
      purchased: granted.balance.purchased,
      spent: granted.balance.spent,
    },
  }
}

// ─── What the checkout return page shows ───────────────────────────────────

export type VotesForOrder = {
  contestTitle: string
  contestSlug: string
  // Votes this order bought.
  votesBought: number
  // Votes spendable right now, across every purchase for this contest.
  votesRemaining: number
  // Voting had already stopped when the charge cleared, so the balance cannot
  // be spent and the money is owed back. The page must say so rather than
  // invite them to vote.
  unusable: boolean
}

/**
 * The vote-purchase counterpart of `loadRegistrationForOrder`: everything the
 * /checkout/return page needs, read after fulfilment has committed. Returns
 * null when the order has no contest behind it, so the page can fall back
 * rather than render half a screen.
 */
export async function loadVotesForOrder(order: {
  referenceId: string | null
  buyerEmail: string
  quantity: number
}): Promise<VotesForOrder | null> {
  if (!order.referenceId) return null
  const voterEmail = normalizeVoterEmail(order.buyerEmail)

  const [contest] = await db
    .select({
      id: contests.id,
      title: contests.title,
      slug: contests.slug,
      status: contests.status,
      votingOpensAt: contests.votingOpensAt,
      votingClosesAt: contests.votingClosesAt,
    })
    .from(contests)
    .where(eq(contests.id, order.referenceId))
    .limit(1)
  if (!contest) return null

  const [balance] = await db
    .select({ purchased: voteCredits.purchased, spent: voteCredits.spent })
    .from(voteCredits)
    .where(
      and(
        eq(voteCredits.contestId, contest.id),
        eq(voteCredits.voterEmail, voterEmail)
      )
    )
    .limit(1)

  return {
    contestTitle: contest.title,
    contestSlug: contest.slug,
    votesBought: order.quantity,
    votesRemaining: balance ? balance.purchased - balance.spent : 0,
    unusable: !votingIsOpen(contest),
  }
}
