import { eq } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { user } from '@ticketur/db'

import { createTRPCRouter, protectedProcedure } from '../../trpc'

// Roles a person may pick for themselves. `admin` is deliberately absent — it
// is seeded, never self-assigned.
const selectableRole = z.enum(['attendee', 'organizer', 'vendor'])

export const accountProfileRouter = createTRPCRouter({
  // Onboarding for social sign-ups. A Google sign-up carries no requestedRole
  // (the field is parsed from the provider profile, which has no such claim),
  // so the create hook falls back to `attendee` for everyone. This lets a brand
  // new user pick the role they actually came for.
  chooseRole: protectedProcedure
    .input(z.object({ role: selectableRole }))
    .mutation(async ({ ctx, input }) => {
      const current = ctx.session.user.role ?? 'attendee'
      // Only the default role can be traded in. Anyone already holding a real
      // role (or an admin) must go through moderation, not this endpoint.
      if (current !== 'attendee') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Your account role is already set.',
        })
      }

      await ctx.db
        .update(user)
        .set({
          role: input.role,
          // Mirrors what the signup form records, so the two paths agree.
          requestedRole: input.role,
          // A vendor is not pending until they save a profile — same as the
          // email signup path (see vendor.profile.save).
          vendorApprovalStatus: null,
          updatedAt: new Date(),
        })
        .where(eq(user.id, ctx.session.user.id))

      return { role: input.role }
    }),
})

export type AccountProfileRouter = typeof accountProfileRouter
