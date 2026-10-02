import { task } from '@trigger.dev/sdk'
import { render } from '@react-email/render'
import SubmissionApprovedEmail from '@ticketur/email/emails/submission-approved'

import { FROM_EMAIL } from '../constants'
import { submissionApprovedSchema } from '../schema'
import { sendEmail } from '../utils/resend'

export const sendSubmissionApprovedTask = task({
  id: 'send-submission-approved',
  run: async (payload: unknown, { ctx }) => {
    const data = submissionApprovedSchema.parse(payload)

    const html = await render(
      SubmissionApprovedEmail({
        applicantName: data.applicantName,
        formTitle: data.formTitle,
        eventTitle: data.eventTitle,
        eventDate: data.eventDate,
        eventLocation: data.eventLocation,
        reference: data.reference,
        eventUrl: data.eventUrl,
      })
    )

    await sendEmail(
      {
        from: FROM_EMAIL,
        to: data.email,
        subject: `Approved: ${data.formTitle} at ${data.eventTitle}`,
        html,
      },
      ctx.run.id
    )
  },
})
