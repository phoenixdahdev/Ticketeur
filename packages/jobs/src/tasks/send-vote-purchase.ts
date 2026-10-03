import { task } from '@trigger.dev/sdk'
import { render } from '@react-email/render'
import VotePurchaseEmail from '@ticketur/email/emails/vote-purchase'

import { FROM_EMAIL } from '../constants'
import { votePurchaseSchema } from '../schema'
import { sendEmail } from '../utils/resend'

export const sendVotePurchaseTask = task({
  id: 'send-vote-purchase',
  run: async (payload: unknown, { ctx }) => {
    const data = votePurchaseSchema.parse(payload)

    const html = await render(
      VotePurchaseEmail({
        voterName: data.voterName,
        contestTitle: data.contestTitle,
        eventTitle: data.eventTitle,
        votesGranted: data.votesGranted,
        votesRemaining: data.votesRemaining,
        amountPaid: data.amountPaid,
        contestUrl: data.contestUrl,
        unusable: data.unusable,
      })
    )

    await sendEmail(
      {
        from: FROM_EMAIL,
        to: data.email,
        subject: data.unusable
          ? `About your payment for ${data.contestTitle}`
          : `Your votes for ${data.contestTitle}`,
        html,
      },
      ctx.run.id
    )
  },
})
