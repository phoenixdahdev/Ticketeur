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

// An admin took a form that was already public off the platform. Same shape as
// a rejection, different message: this form was live, so the organizer is told
// it has been pulled down rather than that it wasn't approved.
export const formTakenDownSchema = z.object({
  email: z.email(),
  organizerName: z.string(),
  formTitle: z.string(),
  eventTitle: z.string(),
  // Required: an admin can't take a form down without saying why.
  reason: z.string().min(1),
  manageUrl: z.url(),
})
export type FormTakenDownPayload = z.infer<typeof formTakenDownSchema>
// ─── Registration form submissions ─────────────────────────────────────────
// Sent to the applicant. The API triggers these from packages/api/src/lib/
// form-emails.ts: the confirmation once a submission is complete (on submit
// when free, once its fee is paid otherwise), approval and rejection from the
// organizer's review.

export const submissionConfirmationSchema = z.object({
  email: z.email(),
  applicantName: z.string(),
  formTitle: z.string(),
  eventTitle: z.string(),
  // Pre-formatted display strings, as for the other event emails.
  eventDate: z.string().default(''),
  eventLocation: z.string().default(''),
  // The code the applicant quotes (e.g. "K7QM-3XPD").
  reference: z.string(),
  // 'approved' on an auto-approve form; 'submitted' awaits the organizer.
  status: z.enum(['submitted', 'approved']),
  // Pre-formatted fee paid ("₦5,000"); null for a free submission.
  amountPaid: z.string().nullable().default(null),
  eventUrl: z.url(),
})

export const submissionApprovedSchema = z.object({
  email: z.email(),
  applicantName: z.string(),
  formTitle: z.string(),
  eventTitle: z.string(),
  eventDate: z.string().default(''),
  eventLocation: z.string().default(''),
  reference: z.string(),
  eventUrl: z.url(),
})

export const submissionRejectedSchema = z.object({
  email: z.email(),
  applicantName: z.string(),
  formTitle: z.string(),
  eventTitle: z.string(),
  reference: z.string(),
  // The organizer's reason, written for the applicant.
  reason: z.string().default(''),
  // The registration fee we are holding for an application that was turned
  // down, in kobo. Defaults to 0 so an older queued payload still parses.
  refundOwedMinor: z.number().int().min(0).default(0),
})

export type SubmissionConfirmationPayload = z.infer<
  typeof submissionConfirmationSchema
>
export type SubmissionApprovedPayload = z.infer<typeof submissionApprovedSchema>
export type SubmissionRejectedPayload = z.infer<typeof submissionRejectedSchema>

// The receipt for a vote purchase.
export const votePurchaseSchema = z.object({
  email: z.email(),
  voterName: z.string(),
  contestTitle: z.string(),
  eventTitle: z.string(),
  votesGranted: z.number().int().min(0),
  votesRemaining: z.number().int().min(0),
  // Pre-formatted and inclusive of the service fee, so the email cannot
  // disagree with what was charged.
  amountPaid: z.string(),
  contestUrl: z.string(),
  // Voting had already closed when the payment cleared: the credits cannot be
  // spent and the money is owed back.
  unusable: z.boolean().default(false),
})
export type VotePurchasePayload = z.infer<typeof votePurchaseSchema>
