import { tasks } from '@trigger.dev/sdk'
import { eq } from 'drizzle-orm'

import { contests, db, events, orders } from '@ticketur/db'

import { toFlutterwaveAmount } from './payment-amount'
import { VOTE_CODE_TTL_MINUTES } from './vote-otp'

// The receipt a voter gets once their vote purchase clears
// (packages/jobs/src/tasks/send-vote-purchase.ts).
//
// Loads what it needs by order id rather than taking it from the caller, so
// the figures in the email come from the committed row and cannot describe a
// transaction that rolled back. Never throws: the payment has already been
// accepted, so a failed enqueue is logged for a resend by hand rather than
// failing fulfilment.

function formatAmountPaid(totalMinor: number): string {
  return `₦${toFlutterwaveAmount(totalMinor).toLocaleString('en-US')}`
}

export async function sendVotePurchaseReceipt(
  orderId: string,
  args: {
    baseUrl: string
    votesGranted: number
    votesRemaining: number
    // Voting had closed before the charge cleared: the credits cannot be
    // spent and the money is owed back. The email has to say so.
    unusable: boolean
  }
): Promise<void> {
  try {
    const [row] = await db
      .select({
        buyerEmail: orders.buyerEmail,
        buyerName: orders.buyerName,
        totalMinor: orders.totalMinor,
        status: orders.status,
        contestTitle: contests.title,
        contestSlug: contests.slug,
        eventTitle: events.title,
      })
      .from(orders)
      .innerJoin(contests, eq(contests.id, orders.referenceId))
      .innerJoin(events, eq(events.id, contests.eventId))
      .where(eq(orders.id, orderId))
      .limit(1)
    if (!row) {
      console.error('[votes] receipt skipped: order or contest not found', {
        orderId,
      })
      return
    }
    // Belt and braces: only a paid order has a receipt to send.
    if (row.status !== 'paid') {
      console.error('[votes] receipt skipped: order is not paid', {
        orderId,
        status: row.status,
      })
      return
    }
    if (row.buyerEmail.trim() === '') return

    await tasks.trigger('send-vote-purchase', {
      email: row.buyerEmail,
      voterName: row.buyerName.trim() || 'there',
      contestTitle: row.contestTitle,
      eventTitle: row.eventTitle,
      votesGranted: args.votesGranted,
      votesRemaining: args.votesRemaining,
      // Inclusive of the platform service fee, because that is what the voter
      // was charged (packages/api/src/lib/fees.ts).
      amountPaid: formatAmountPaid(row.totalMinor),
      contestUrl: `${args.baseUrl}/contests/${row.contestSlug}`,
      unusable: args.unusable,
    })
  } catch (err) {
    console.error('[votes] could not queue the vote purchase receipt', {
      orderId,
      error: err,
    })
  }
}

// ─── The free-vote code ────────────────────────────────────────────────────

/**
 * Email a free voter their one-time code
 * (packages/jobs/src/tasks/send-vote-code.ts).
 *
 * Unlike the receipt above this takes its content from the caller rather than
 * re-reading a row, for one reason: the CODE only ever exists in memory.
 * `vote_otps` stores a scrypt digest, so there is nothing to load it back
 * from — re-reading would be impossible, not merely wasteful. The contest and
 * event titles come from the row the caller already resolved through
 * `loadPublicContest`, so they are no less trustworthy for arriving as
 * arguments.
 *
 * Never throws. The digest is already committed by the time this runs, so a
 * failed enqueue must leave the voter able to ask for another code rather
 * than turn the request itself into an error they cannot act on.
 */
export async function sendVoteCode(args: {
  email: string
  code: string
  contestTitle: string
  eventTitle: string
  contestUrl: string
  // Omitted means the free vote, which is what every existing caller meant.
  purpose?: 'free_vote' | 'paid_vote'
}): Promise<void> {
  try {
    if (args.email.trim() === '') return
    await tasks.trigger('send-vote-code', {
      email: args.email,
      code: args.code,
      purpose: args.purpose ?? 'free_vote',
      contestTitle: args.contestTitle,
      eventTitle: args.eventTitle,
      contestUrl: args.contestUrl,
      expiresInMinutes: VOTE_CODE_TTL_MINUTES,
    })
  } catch (err) {
    // Logs no code and no address — only enough to find the request again.
    console.error('[votes] could not queue the free-vote code email', {
      contestTitle: args.contestTitle,
      error: err,
    })
  }
}
