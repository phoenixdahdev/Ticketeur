import { task } from '@trigger.dev/sdk'
import { render } from '@react-email/render'
import ContestApprovedEmail from '@ticketur/email/emails/contest-approved'

import { FROM_EMAIL } from '../constants'
import { contestApprovedSchema } from '../schema'
import { sendEmail } from '../utils/resend'

export const sendContestApprovedTask = task({
  id: 'send-contest-approved',
  run: async (payload: unknown, { ctx }) => {
    const data = contestApprovedSchema.parse(payload)

    const html = await render(
      ContestApprovedEmail({
        organizerName: data.organizerName,
        contestTitle: data.contestTitle,
        eventTitle: data.eventTitle,
        publicUrl: data.publicUrl,
        manageUrl: data.manageUrl,
      })
    )

    await sendEmail(
      {
        from: FROM_EMAIL,
        to: data.email,
        subject: `${data.contestTitle} is approved`,
        html,
      },
      ctx.run.id
    )
  },
})
