import { task } from '@trigger.dev/sdk'
import { render } from '@react-email/render'
import SubmissionRejectedEmail from '@ticketur/email/emails/submission-rejected'

import { FROM_EMAIL } from '../constants'
import { submissionRejectedSchema } from '../schema'
import { sendEmail } from '../utils/resend'

export const sendSubmissionRejectedTask = task({
  id: 'send-submission-rejected',
  run: async (payload: unknown, { ctx }) => {
    const data = submissionRejectedSchema.parse(payload)

    const html = await render(
      SubmissionRejectedEmail({
        applicantName: data.applicantName,
        formTitle: data.formTitle,
        eventTitle: data.eventTitle,
        reference: data.reference,
        reason: data.reason,
      })
    )

    await sendEmail(
      {
        from: FROM_EMAIL,
        to: data.email,
        subject: `Your application for ${data.formTitle} wasn't approved`,
        html,
      },
      ctx.run.id
    )
  },
})
