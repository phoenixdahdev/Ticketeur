import { task } from '@trigger.dev/sdk'
import { render } from '@react-email/render'
import VoteCodeEmail from '@ticketur/email/emails/vote-code'

import { FROM_EMAIL } from '../constants'
import { voteCodeSchema } from '../schema'
import { sendEmail } from '../utils/resend'

export const sendVoteCodeTask = task({
  id: 'send-vote-code',
  run: async (payload: unknown, { ctx }) => {
    const data = voteCodeSchema.parse(payload)

    const html = await render(
      VoteCodeEmail({
        code: data.code,
        contestTitle: data.contestTitle,
        eventTitle: data.eventTitle,
        contestUrl: data.contestUrl,
        expiresInMinutes: data.expiresInMinutes,
      })
    )

    await sendEmail(
      {
        from: FROM_EMAIL,
        to: data.email,
        // The code stays out of the subject line: subjects show up on lock
        // screens and in notification previews, and this one is a credential.
        subject: `Your voting code for ${data.contestTitle}`,
        html,
      },
      ctx.run.id
    )
  },
})
