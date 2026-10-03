import { and, asc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'

import { events, forms } from '@ticketur/db'

import { createTRPCRouter, publicProcedure } from '../../trpc'
import { formAvailability } from '../../lib/forms'
import { loadPriceOptions, loadPublicForm } from './forms'

// Finding a registration form without being sent the link.
//
// ── Why this exists ──
// A published form was reachable only by someone who already had
// /forms/{slug}. `bySlug` resolves a form you can already name, and
// `public.events.bySlug` says nothing about forms, so an event page could not
// offer the very registration its organizer had opened — applicants had to be
// sent a link out of band. This is the one read that closes that, and it
// returns nothing an applicant could not see by opening the form itself.
//
// ── One definition of "public", not two ──
// The gate is `loadPublicForm`, called per form, exactly as `bySlug` and
// `submit` call it. Copying its conditions into a list query is how the two
// drift; putting each candidate through the real gate means a status added to
// that allow-list later, or a new rule about banned organizers, applies here
// for free.
//
// The candidate query is cheap (`forms_event_idx`) and the loop is capped.
const MAX_FORMS_PER_EVENT = 10

export const publicFormDiscoveryRouter = createTRPCRouter({
  /**
   * The registration forms on an event that the public may see, oldest first.
   *
   * An empty list for an event with none, an event that isn't public, and an
   * event that does not exist — the same answer to all three, because none of
   * them should tell a stranger which it was.
   */
  forEvent: publicProcedure
    .input(z.object({ eventSlug: z.string() }))
    .query(async ({ ctx, input }) => {
      // Narrowing only. Everything deciding visibility is in the gate below.
      const candidates = await ctx.db
        .select({ id: forms.id })
        .from(forms)
        .innerJoin(events, eq(events.id, forms.eventId))
        .where(
          and(
            eq(events.slug, input.eventSlug),
            inArray(forms.status, ['published', 'closed'])
          )
        )
        .orderBy(asc(forms.createdAt), asc(forms.id))
        .limit(MAX_FORMS_PER_EVENT)

      const visible = []
      for (const candidate of candidates) {
        const found = await loadPublicForm(ctx.db, eq(forms.id, candidate.id))
        if (!found) continue
        const { form, event } = found
        // The same read-time rule the form page itself applies, so a card
        // saying "open" and the page it links to cannot disagree. Price
        // options are part of that rule: a form whose every option is full
        // is full.
        const options = await loadPriceOptions(ctx.db, form.id)
        const availability = formAvailability(form, event, options)
        visible.push({
          slug: form.slug,
          type: form.type,
          title: form.title,
          description: form.description,
          opensAt: form.opensAt,
          closesAt: form.closesAt,
          open: availability.open,
          reason: availability.open ? null : availability.reason,
        })
      }
      return visible
    }),
})

export type PublicFormDiscoveryRouter = typeof publicFormDiscoveryRouter
