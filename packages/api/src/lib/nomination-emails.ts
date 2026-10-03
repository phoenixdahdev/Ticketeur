import { tasks } from '@trigger.dev/sdk'

import { VOTE_CODE_TTL_MINUTES } from './vote-otp'

// The one-time code that proves the address behind a nomination
// (packages/jobs/src/tasks/send-nomination-code.ts).
//
// A copy of `sendVoteCode`'s shape rather than a call into it: the code is
// the same credential out of the same `vote_otps` row, but the message is
// not. The free-vote email reads "Enter this code to cast your free vote",
// and sending that to somebody who is putting a name forward would describe
// something they did not ask to do.
//
// Never throws. The code is already stored by the time this runs, so a mail
// failure must not turn into a refusal the nominator could fix by asking for
// another one — they would get a second code and the same silence. Logged
// with neither the code nor the address, only enough to find the request.

export async function sendNominationCode(args: {
  email: string
  code: string
  contestTitle: string
  eventTitle: string
  contestUrl: string
}): Promise<void> {
  try {
    if (args.email.trim() === '') return
    await tasks.trigger('send-nomination-code', {
      email: args.email,
      code: args.code,
      contestTitle: args.contestTitle,
      eventTitle: args.eventTitle,
      contestUrl: args.contestUrl,
      expiresInMinutes: VOTE_CODE_TTL_MINUTES,
    })
  } catch (err) {
    console.error('[nominations] could not queue the nomination code email', {
      contestTitle: args.contestTitle,
      error: err,
    })
  }
}
