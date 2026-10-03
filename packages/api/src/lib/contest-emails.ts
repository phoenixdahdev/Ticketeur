import { tasks } from '@trigger.dev/sdk'

// The three emails an organizer gets when an admin decides their contest,
// queued on Trigger.dev (packages/jobs/src/tasks/send-contest-*.ts):
//   approved   — the contest is live and takes votes in its window.
//   rejected   — turned down, with the reason they must deal with.
//   taken down — it WAS live and has been pulled; votes and paid-for credits
//                are kept.
//
// NONE of them throws. The decision they report has already committed by the
// time they run, so a failed enqueue must not turn a successful approval into
// an error the admin sees — they would retry, and the second attempt would
// fail the revision guard (the contest is no longer 'pending_review'), which
// reads as "the organizer changed it" and is simply false. A dropped email is
// logged and resent by hand; a lost approval is not recoverable from the UI.
//
// This is the one place these differ from the form review emails, which call
// `tasks.trigger` inline in the router behind `void`. `void` on a rejected
// promise is an unhandled rejection, which Node may turn into a process
// exit — the wrapper is deliberate, and matches ./vote-emails.ts.
//
// Every argument is a value the caller already read from the committed row.

type Decision = {
  email: string
  organizerName: string
  contestTitle: string
  eventTitle: string
}

function skip(args: Decision): boolean {
  return args.email.trim() === ''
}

function logFailure(what: string, contestTitle: string, err: unknown): void {
  // The contest's title, not the organizer's address: enough to find the
  // decision again in the admin log without putting an email in the logs.
  console.error(`[contests] could not queue the ${what} email`, {
    contestTitle,
    error: err,
  })
}

export async function sendContestApproved(
  args: Decision & { publicUrl: string; manageUrl: string }
): Promise<void> {
  try {
    if (skip(args)) return
    await tasks.trigger('send-contest-approved', {
      email: args.email,
      organizerName: args.organizerName,
      contestTitle: args.contestTitle,
      eventTitle: args.eventTitle,
      publicUrl: args.publicUrl,
      manageUrl: args.manageUrl,
    })
  } catch (err) {
    logFailure('contest approved', args.contestTitle, err)
  }
}

export async function sendContestRejected(
  args: Decision & { reason: string; manageUrl: string }
): Promise<void> {
  try {
    if (skip(args)) return
    await tasks.trigger('send-contest-rejected', {
      email: args.email,
      organizerName: args.organizerName,
      contestTitle: args.contestTitle,
      eventTitle: args.eventTitle,
      reason: args.reason,
      manageUrl: args.manageUrl,
    })
  } catch (err) {
    logFailure('contest rejected', args.contestTitle, err)
  }
}

export async function sendContestTakenDown(
  args: Decision & { reason: string; manageUrl: string }
): Promise<void> {
  try {
    if (skip(args)) return
    await tasks.trigger('send-contest-taken-down', {
      email: args.email,
      organizerName: args.organizerName,
      contestTitle: args.contestTitle,
      eventTitle: args.eventTitle,
      reason: args.reason,
      manageUrl: args.manageUrl,
    })
  } catch (err) {
    logFailure('contest taken down', args.contestTitle, err)
  }
}
