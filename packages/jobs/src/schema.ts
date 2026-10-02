import { z } from 'zod'

export const verificationOtpSchema = z.object({
  email: z.email(),
  otp: z.string(),
  type: z
    .enum(['email-verification', 'sign-in', 'forget-password'])
    .default('email-verification'),
})

export const passwordResetSchema = z.object({
  email: z.email(),
  name: z.string(),
  resetUrl: z.url(),
})

export const twoFactorOtpSchema = z.object({
  email: z.email(),
  otp: z.string(),
})

export const welcomeEmailSchema = z.object({
  email: z.email(),
  name: z.string(),
})

export const vendorInviteSchema = z.object({
  email: z.email(),
  businessName: z.string(),
  contactName: z.string(),
  organizerName: z.string(),
  eventTitle: z.string(),
  signupUrl: z.url(),
})

export const eventApprovedSchema = z.object({
  email: z.email(),
  organizerName: z.string(),
  eventTitle: z.string(),
  eventDate: z.string(),
  eventLocation: z.string(),
  publicUrl: z.url(),
  manageUrl: z.url(),
})

export const ticketConfirmationSchema = z.object({
  email: z.email(),
  firstName: z.string(),
  eventTitle: z.string(),
  eventDate: z.string(),
  eventTime: z.string(),
  eventLocation: z.string(),
  // Summary string for the subject/fallback (e.g. "2× VIP, 1× General").
  ticketTier: z.string(),
  quantity: z.number().int().min(1),
  // Per-tier breakdown for multi-tier orders. When present the email renders
  // one row per tier; otherwise it falls back to the single `ticketTier`.
  items: z
    .array(
      z.object({ tierName: z.string(), quantity: z.number().int().min(1) })
    )
    .optional(),
  ticketsUrl: z.url(),
  // Optional PDF attachment fetched at send time. URL must be public.
  pdfUrl: z.url().optional(),
  pdfFilename: z.string().optional(),
})

export const accountSuspendedSchema = z.object({
  email: z.email(),
  name: z.string(),
  reason: z.string().default(''),
  // Pre-formatted display string ("May 31, 2026") so the worker doesn't need
  // date-fns. Empty when no expiry.
  expiresAt: z.string().nullable().default(null),
})

export const accountDisabledSchema = z.object({
  email: z.email(),
  name: z.string(),
  reason: z.string().default(''),
})

export const accountReactivatedSchema = z.object({
  email: z.email(),
  name: z.string(),
})

export const accountRemovedSchema = z.object({
  email: z.email(),
  name: z.string(),
})

export const vendorApprovedSchema = z.object({
  email: z.email(),
  vendorName: z.string(),
  businessName: z.string(),
  profileUrl: z.url(),
})

export const vendorRejectedSchema = z.object({
  email: z.email(),
  vendorName: z.string(),
  businessName: z.string(),
  reason: z.string().default(''),
})

export const eventRejectedSchema = z.object({
  email: z.email(),
  organizerName: z.string(),
  eventTitle: z.string(),
  reason: z.string().default(''),
})

export const eventEditApprovedSchema = z.object({
  email: z.email(),
  organizerName: z.string(),
  eventTitle: z.string(),
  publicUrl: z.url(),
  manageUrl: z.url(),
})

export const eventEditRejectedSchema = z.object({
  email: z.email(),
  organizerName: z.string(),
  eventTitle: z.string(),
  reason: z.string().default(''),
})

export type VerificationOtpPayload = z.infer<typeof verificationOtpSchema>
export type PasswordResetPayload = z.infer<typeof passwordResetSchema>
export type TwoFactorOtpPayload = z.infer<typeof twoFactorOtpSchema>
export type WelcomeEmailPayload = z.infer<typeof welcomeEmailSchema>
export type VendorInvitePayload = z.infer<typeof vendorInviteSchema>
export type EventApprovedPayload = z.infer<typeof eventApprovedSchema>
export type TicketConfirmationPayload = z.infer<typeof ticketConfirmationSchema>
export type AccountSuspendedPayload = z.infer<typeof accountSuspendedSchema>
export type AccountDisabledPayload = z.infer<typeof accountDisabledSchema>
export type AccountReactivatedPayload = z.infer<typeof accountReactivatedSchema>
export type AccountRemovedPayload = z.infer<typeof accountRemovedSchema>
export type VendorApprovedPayload = z.infer<typeof vendorApprovedSchema>
export type VendorRejectedPayload = z.infer<typeof vendorRejectedSchema>
export type EventRejectedPayload = z.infer<typeof eventRejectedSchema>
export type EventEditApprovedPayload = z.infer<typeof eventEditApprovedSchema>
export type EventEditRejectedPayload = z.infer<typeof eventEditRejectedSchema>

export const voucherCodeSchema = z.object({
  // One send fans out to many recipients; the task loops so a single failure
  // doesn't lose the rest of the batch.
  emails: z.array(z.email()).min(1).max(200),
  code: z.string(),
  discountLabel: z.string(),
  eventTitle: z.string().nullable().default(null),
  expiresOn: z.string().nullable().default(null),
  ctaUrl: z.url(),
  note: z.string().nullable().default(null),
})
export type VoucherCodePayload = z.infer<typeof voucherCodeSchema>

export const adminBroadcastSchema = z.object({
  // One batch of recipients; the API fans a large audience into several sends.
  emails: z.array(z.email()).min(1).max(100),
  subject: z.string(),
  // Markdown authored in the admin composer.
  body: z.string(),
})
export type AdminBroadcastPayload = z.infer<typeof adminBroadcastSchema>

// Registration form review. An admin approved a form's questions (it now takes
// submissions), or rejected them with a reason the organizer must address.
export const formApprovedSchema = z.object({
  email: z.email(),
  organizerName: z.string(),
  formTitle: z.string(),
  eventTitle: z.string(),
  publicUrl: z.url(),
  manageUrl: z.url(),
})
export type FormApprovedPayload = z.infer<typeof formApprovedSchema>

export const formRejectedSchema = z.object({
  email: z.email(),
  organizerName: z.string(),
  formTitle: z.string(),
  eventTitle: z.string(),
  // Required: an admin can't reject a form without saying why.
  reason: z.string().min(1),
  manageUrl: z.url(),
})
export type FormRejectedPayload = z.infer<typeof formRejectedSchema>
