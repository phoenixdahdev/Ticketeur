import { task } from '@trigger.dev/sdk'
import { render } from '@react-email/render'
import FormApprovedEmail from '@ticketur/email/emails/form-approved'

import { FROM_EMAIL } from '../constants'
import { formApprovedSchema } from '../schema'
import { sendEmail } from '../utils/resend'

export const sendFormApprovedTask = task({
  id: 'send-form-approved',
  run: async (payload: unknown, { ctx }) => {
    const data = formApprovedSchema.parse(payload)

    const html = await render(
      FormApprovedEmail({
        organizerName: data.organizerName,
        formTitle: data.formTitle,
        eventTitle: data.eventTitle,
        publicUrl: data.publicUrl,
        manageUrl: data.manageUrl,
      })
    )

    await sendEmail(
      {
        from: FROM_EMAIL,
        to: data.email,
        subject: `${data.formTitle} is approved`,
        html,
      },
      ctx.run.id
    )
  },
})
