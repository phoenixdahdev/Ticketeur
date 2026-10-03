import { task } from '@trigger.dev/sdk'
import { render } from '@react-email/render'
import NominationCodeEmail from '@ticketur/email/emails/nomination-code'

import { FROM_EMAIL } from '../constants'
import { nominationCodeSchema } from '../schema'
import { sendEmail } from '../utils/resend'

export const sendNominationCodeTask = task({
  id: 'send-nomination-code',
  run: async (payload: unknown, { ctx }) => {
    const data = nominationCodeSchema.parse(payload)

    const html = await render(
      NominationCodeEmail({
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
        subject: `Your nomination code for ${data.contestTitle}`,
        html,
      },
      ctx.run.id
    )
  },
})
