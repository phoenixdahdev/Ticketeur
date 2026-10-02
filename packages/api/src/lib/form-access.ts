import { TRPCError } from '@trpc/server'
import { eq } from 'drizzle-orm'

import type { Database } from '@ticketur/db'
import {
  events,
  formFields,
  formPriceOptions,
  forms,
  submissions,
} from '@ticketur/db'

import type { Context } from '../trpc'

// Ownership guards for the organizer forms routers. A form is exactly as
// private as the event it hangs off, so every procedure resolves its target
// (form, field, price option or submission) up to the owning event and calls
// one of these first, inside its own resolver. The check is the one
// events.ts makes in each resolver: the event's organizer, or an admin.

// An organizer procedure's context: the session is guaranteed.
export type OrganizerContext = Context & {
  session: NonNullable<Context['session']>
}

export function managesEvent(
  ctx: OrganizerContext,
  organizerId: string
): boolean {
  return (
    organizerId === ctx.session.user.id || ctx.session.user.role === 'admin'
  )
}

function assertManages(ctx: OrganizerContext, organizerId: string): void {
  if (!managesEvent(ctx, organizerId)) {
    throw new TRPCError({ code: 'FORBIDDEN' })
  }
}

// What the routers need of the owning event: the ownership check, slug
// generation, and the "can this event take a form" rule.
const eventColumns = {
  id: events.id,
  organizerId: events.organizerId,
  slug: events.slug,
  title: events.title,
  status: events.status,
  eventDate: events.eventDate,
  endDate: events.endDate,
}

export async function requireOwnedEvent(
  ctx: OrganizerContext,
  eventId: string
) {
  const [event] = await ctx.db
    .select(eventColumns)
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1)
  if (!event) throw new TRPCError({ code: 'NOT_FOUND' })
  assertManages(ctx, event.organizerId)
  return event
}

// A form with its event, ownership unchecked: for queries that answer null
// rather than throw (mirroring events.byId).
export async function findForm(db: Database, formId: string) {
  const [row] = await db
    .select({ form: forms, event: eventColumns })
    .from(forms)
    .innerJoin(events, eq(events.id, forms.eventId))
    .where(eq(forms.id, formId))
    .limit(1)
  return row ?? null
}

export async function requireOwnedForm(ctx: OrganizerContext, formId: string) {
  const row = await findForm(ctx.db, formId)
  if (!row) throw new TRPCError({ code: 'NOT_FOUND' })
  assertManages(ctx, row.event.organizerId)
  return row
}

export async function requireOwnedField(
  ctx: OrganizerContext,
  fieldId: string
) {
  const [row] = await ctx.db
    .select({ field: formFields, organizerId: events.organizerId })
    .from(formFields)
    .innerJoin(forms, eq(forms.id, formFields.formId))
    .innerJoin(events, eq(events.id, forms.eventId))
    .where(eq(formFields.id, fieldId))
    .limit(1)
  if (!row) throw new TRPCError({ code: 'NOT_FOUND' })
  assertManages(ctx, row.organizerId)
  return row
}

export async function requireOwnedPriceOption(
  ctx: OrganizerContext,
  optionId: string
) {
  const [row] = await ctx.db
    .select({ option: formPriceOptions, organizerId: events.organizerId })
    .from(formPriceOptions)
    .innerJoin(forms, eq(forms.id, formPriceOptions.formId))
    .innerJoin(events, eq(events.id, forms.eventId))
    .where(eq(formPriceOptions.id, optionId))
    .limit(1)
  if (!row) throw new TRPCError({ code: 'NOT_FOUND' })
  assertManages(ctx, row.organizerId)
  return row
}

// A submission with its form and the event's organizer, ownership unchecked.
export async function findSubmission(db: Database, submissionId: string) {
  const [row] = await db
    .select({
      submission: submissions,
      form: {
        id: forms.id,
        eventId: forms.eventId,
        title: forms.title,
        slug: forms.slug,
        type: forms.type,
        reviewMode: forms.reviewMode,
      },
      organizerId: events.organizerId,
    })
    .from(submissions)
    .innerJoin(forms, eq(forms.id, submissions.formId))
    .innerJoin(events, eq(events.id, forms.eventId))
    .where(eq(submissions.id, submissionId))
    .limit(1)
  return row ?? null
}

export async function requireOwnedSubmission(
  ctx: OrganizerContext,
  submissionId: string
) {
  const row = await findSubmission(ctx.db, submissionId)
  if (!row) throw new TRPCError({ code: 'NOT_FOUND' })
  assertManages(ctx, row.organizerId)
  return row
}
