import { task } from '@trigger.dev/sdk'
import { render } from '@react-email/render'
import SubmissionConfirmationEmail from '@ticketur/email/emails/submission-confirmation'

import { FROM_EMAIL } from '../constants'
import { submissionConfirmationSchema } from '../schema'
import { sendEmail } from '../utils/resend'

export const sendSubmissionConfirmationTask = task({
  id: 'send-submission-confirmation',
  run: async (payload: unknown, { ctx }) => {
    const data = submissionConfirmationSchema.parse(payload)

    const html = await render(
      SubmissionConfirmationEmail({
        applicantName: data.applicantName,
        formTitle: data.formTitle,
        eventTitle: data.eventTitle,
        eventDate: data.eventDate,
        eventLocation: data.eventLocation,
        reference: data.reference,
        status: data.status,
        amountPaid: data.amountPaid,
        eventUrl: data.eventUrl,
      })
    )

    await sendEmail(
      {
        from: FROM_EMAIL,
        to: data.email,
        subject:
          data.status === 'approved'
            ? `You're in: ${data.formTitle} (${data.reference})`
            : `Application received: ${data.formTitle} (${data.reference})`,
        html,
      },
      ctx.run.id
    )
  },
})
