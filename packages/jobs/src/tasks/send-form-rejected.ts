import { task } from '@trigger.dev/sdk'
import { render } from '@react-email/render'
import FormRejectedEmail from '@ticketur/email/emails/form-rejected'

import { FROM_EMAIL } from '../constants'
import { formRejectedSchema } from '../schema'
import { sendEmail } from '../utils/resend'

export const sendFormRejectedTask = task({
  id: 'send-form-rejected',
  run: async (payload: unknown, { ctx }) => {
    const data = formRejectedSchema.parse(payload)

    const html = await render(
      FormRejectedEmail({
        organizerName: data.organizerName,
        formTitle: data.formTitle,
        eventTitle: data.eventTitle,
        reason: data.reason,
        manageUrl: data.manageUrl,
      })
    )

    await sendEmail(
      {
        from: FROM_EMAIL,
        to: data.email,
        subject: `${data.formTitle} wasn't approved on Ticketeur`,
        html,
      },
      ctx.run.id
    )
  },
})
