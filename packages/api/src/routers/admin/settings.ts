import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'

import {
  platformFeeChanges,
  platformSettings,
  user,
  PLATFORM_SETTINGS_ROW_ID,
} from '@ticketur/db'

import { adminProcedure, createTRPCRouter } from '../../trpc'
import {
  MAX_SERVICE_FEE_BPS,
  MIN_SERVICE_FEE_BPS,
  type FeeKind,
} from '../../lib/fees'
import {
  getStoredFeeRates,
  lockStoredFeeRates,
} from '../../lib/platform-settings'
import { newId } from '../../lib/ids'

// The admin end of the platform service-fee rates: read them, change them, and
// see who changed them last.
//
// Every rate is BASIS POINTS — integers, 500 = 5%. The admin screen talks in
// percent and converts; nothing here accepts a percentage, so there is one
// representation to reason about and no chance of a 5 being stored where 500
// was meant.

// 0 to 10000 inclusive: 0% to 100%. An integer, so a fractional basis point
// cannot creep in and make the stored rate disagree with the integer maths
// that charges it. The same bound is a CHECK constraint on the column.
const feeBps = z
  .number()
  .int('Use a whole number of basis points')
  .min(MIN_SERVICE_FEE_BPS, 'A rate cannot be negative')
  .max(MAX_SERVICE_FEE_BPS, 'A rate cannot be more than 100%')

const updateInput = z.object({
  ticketFeeBps: feeBps,
  registrationFeeBps: feeBps,
  voteFeeBps: feeBps,
})

// How many changes the screen lists. The whole point of the log is that it is
// long; this is one page of it.
const HISTORY_LIMIT = 50

export const adminSettingsRouter = createTRPCRouter({
  // The rates in force, and who put them there.
  //
  // `usingDefaults` is true while nobody has ever saved: the platform is
  // charging the built-in 500 bp on all three and there is no settings row
  // yet. The screen says so rather than implying someone chose it.
  fees: adminProcedure.query(async ({ ctx }) => {
    const stored = await getStoredFeeRates(ctx.db)

    let updatedBy: { name: string; email: string } | null = null
    if (stored.updatedBy) {
      const [row] = await ctx.db
        .select({ name: user.name, email: user.email })
        .from(user)
        .where(eq(user.id, stored.updatedBy))
        .limit(1)
      updatedBy = row ?? null
    }

    return {
      rates: stored.rates,
      usingDefaults: stored.updatedAt === null,
      updatedAt: stored.updatedAt,
      updatedBy,
    }
  }),

  // The audit log, newest first. Each row carries the previous and the new
  // value of all three rates, so a single entry reads as "tickets 5% → 7%,
  // changed by X on date Y" with nothing to infer.
  feeHistory: adminProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({
        id: platformFeeChanges.id,
        changedBy: platformFeeChanges.changedBy,
        changedByName: platformFeeChanges.changedByName,
        changedByEmail: platformFeeChanges.changedByEmail,
        previousTicketFeeBps: platformFeeChanges.previousTicketFeeBps,
        previousRegistrationFeeBps:
          platformFeeChanges.previousRegistrationFeeBps,
        previousVoteFeeBps: platformFeeChanges.previousVoteFeeBps,
        ticketFeeBps: platformFeeChanges.ticketFeeBps,
        registrationFeeBps: platformFeeChanges.registrationFeeBps,
        voteFeeBps: platformFeeChanges.voteFeeBps,
        createdAt: platformFeeChanges.createdAt,
      })
      .from(platformFeeChanges)
      .orderBy(desc(platformFeeChanges.createdAt))
      .limit(HISTORY_LIMIT)
  }),

  // Save all three rates together.
  //
  // Future orders only. `orders.feeMinor` and `orders.totalMinor` are written
  // once at checkout and never recomputed from a rate, so nothing here can
  // reach an order that already exists — including a pending one whose
  // payment link is already out there, which stays payable for the amount it
  // was issued for.
  //
  // One transaction, so the rates and the audit entry that explains them
  // commit together: there is no state in which the fee changed and the record
  // of who changed it is missing.
  updateFees: adminProcedure
    .input(updateInput)
    .mutation(async ({ ctx, input }) => {
      const actor = ctx.session.user

      return ctx.db.transaction(async (tx) => {
        // Read inside the transaction and under a row lock, so the
        // "previous" values recorded are the ones actually replaced even if
        // two admins save at the same instant.
        const before = await lockStoredFeeRates(tx)

        const after = {
          ticket: input.ticketFeeBps,
          registration: input.registrationFeeBps,
          vote: input.voteFeeBps,
        }
        const changed = (['ticket', 'registration', 'vote'] as FeeKind[]).filter(
          (kind) => before.rates[kind] !== after[kind]
        )

        // Nothing moved — someone opened the screen and pressed Save. Don't
        // write a row that says a rate changed when none did; an audit log
        // full of no-ops is an audit log nobody reads.
        if (changed.length === 0) {
          return { changed: [] as FeeKind[], rates: before.rates }
        }

        const now = new Date()
        await tx
          .insert(platformSettings)
          .values({
            id: PLATFORM_SETTINGS_ROW_ID,
            ticketFeeBps: after.ticket,
            registrationFeeBps: after.registration,
            voteFeeBps: after.vote,
            updatedBy: actor.id,
            updatedAt: now,
          })
          // The row may not exist yet: nothing seeds it, and until the first
          // save the platform runs on the defaults.
          .onConflictDoUpdate({
            target: platformSettings.id,
            set: {
              ticketFeeBps: after.ticket,
              registrationFeeBps: after.registration,
              voteFeeBps: after.vote,
              updatedBy: actor.id,
              updatedAt: now,
            },
          })

        await tx.insert(platformFeeChanges).values({
          id: newId('fee'),
          changedBy: actor.id,
          // Snapshotted beside the foreign key, which goes NULL if this
          // account is ever deleted.
          changedByName: actor.name ?? '',
          changedByEmail: actor.email ?? '',
          previousTicketFeeBps: before.rates.ticket,
          previousRegistrationFeeBps: before.rates.registration,
          previousVoteFeeBps: before.rates.vote,
          ticketFeeBps: after.ticket,
          registrationFeeBps: after.registration,
          voteFeeBps: after.vote,
          createdAt: now,
        })

        return { changed, rates: after }
      })
    }),
})

export type AdminSettingsRouter = typeof adminSettingsRouter
