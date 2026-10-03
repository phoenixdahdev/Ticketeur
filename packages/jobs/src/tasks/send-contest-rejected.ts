import { task } from '@trigger.dev/sdk'
import { render } from '@react-email/render'
import ContestRejectedEmail from '@ticketur/email/emails/contest-rejected'

import { FROM_EMAIL } from '../constants'
import { contestRejectedSchema } from '../schema'
import { sendEmail } from '../utils/resend'

export const sendContestRejectedTask = task({
  id: 'send-contest-rejected',
  run: async (payload: unknown, { ctx }) => {
    const data = contestRejectedSchema.parse(payload)

    const html = await render(
      ContestRejectedEmail({
        organizerName: data.organizerName,
        contestTitle: data.contestTitle,
        eventTitle: data.eventTitle,
        reason: data.reason,
        manageUrl: data.manageUrl,
      })
    )

    await sendEmail(
      {
        from: FROM_EMAIL,
        to: data.email,
        subject: `${data.contestTitle} wasn't approved on Ticketeur`,
        html,
      },
      ctx.run.id
    )
  },
})
