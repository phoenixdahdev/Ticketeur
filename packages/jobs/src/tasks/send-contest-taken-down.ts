import { task } from '@trigger.dev/sdk'
import { render } from '@react-email/render'
import ContestTakenDownEmail from '@ticketur/email/emails/contest-taken-down'

import { FROM_EMAIL } from '../constants'
import { contestTakenDownSchema } from '../schema'
import { sendEmail } from '../utils/resend'

export const sendContestTakenDownTask = task({
  id: 'send-contest-taken-down',
  run: async (payload: unknown, { ctx }) => {
    const data = contestTakenDownSchema.parse(payload)

    const html = await render(
      ContestTakenDownEmail({
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
        subject: `${data.contestTitle} has been taken down`,
        html,
      },
      ctx.run.id
    )
  },
})
