import { task } from '@trigger.dev/sdk'
import { render } from '@react-email/render'
import FormTakenDownEmail from '@ticketur/email/emails/form-taken-down'

import { FROM_EMAIL } from '../constants'
import { formTakenDownSchema } from '../schema'
import { sendEmail } from '../utils/resend'

export const sendFormTakenDownTask = task({
  id: 'send-form-taken-down',
  run: async (payload: unknown, { ctx }) => {
    const data = formTakenDownSchema.parse(payload)

    const html = await render(
      FormTakenDownEmail({
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
        subject: `${data.formTitle} has been taken down`,
        html,
      },
      ctx.run.id
    )
  },
})
