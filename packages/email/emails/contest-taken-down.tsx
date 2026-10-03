import { Button, Container, Heading, Preview, Section, Text } from 'react-email'

import { BRAND_NAME, BRAND_NAME_UPPER } from '../components/brand'
import EmailContainer from '../components/container'

// Sent when an admin takes a contest that was already public off the platform
// (admin.moderation.takeDownContest). Deliberately not the rejection email,
// for the reason form-taken-down.tsx gives: this contest WAS approved and
// live, so "wasn't approved" would read as nonsense to an organizer whose
// voters have been voting — and paying — for weeks.
//
// It says two things a form takedown does not have to: votes already cast are
// kept, and credits people BOUGHT are still theirs. Money is the first thing
// an organizer will be asked about.
interface ContestTakenDownEmailProps {
  organizerName: string
  contestTitle: string
  eventTitle: string
  reason: string
  manageUrl: string
}

export default function ContestTakenDownEmail({
  organizerName = 'Friend',
  contestTitle = 'Your contest',
  eventTitle = 'your event',
  reason = '',
  manageUrl = '#',
}: Partial<ContestTakenDownEmailProps>) {
  return (
    <EmailContainer
      preview={
        <Preview>
          {contestTitle} has been taken down on {BRAND_NAME}
        </Preview>
      }
    >
      <Container className="mx-auto my-0 max-w-150 px-10">
        <Heading className="m-0 mb-4 text-2xl font-bold text-gray-900">
          Your contest has been taken down
        </Heading>

        <Text className="m-0 mb-4 text-base leading-6 text-gray-700">
          Hi {organizerName},
        </Text>

        <Text className="m-0 mb-4 text-base leading-6 text-gray-700">
          We&apos;ve taken <strong>{contestTitle}</strong> for{' '}
          <strong>{eventTitle}</strong> off {BRAND_NAME}. Voting has stopped and
          its page is no longer public.
        </Text>

        {reason ? (
          <Section className="mb-6 rounded-lg bg-gray-50 px-5 py-4">
            <Text className="m-0 text-sm leading-5 text-gray-700">
              <strong>Reason:</strong> {reason}
            </Text>
          </Section>
        ) : null}

        <Text className="m-0 mb-4 text-base leading-6 text-gray-700">
          Every vote already cast is kept, and so is every vote balance people
          have paid for. Nobody loses what they bought.
        </Text>

        <Text className="m-0 mb-4 text-base leading-6 text-gray-700">
          If you can deal with the reason above, edit the contest and submit it
          for review. It can only go back online once an admin has approved it
          again.
        </Text>

        <Section className="mb-8">
          <Button
            href={manageUrl}
            className="inline-block rounded-md border border-gray-300 px-6 py-3 text-center text-base font-semibold text-gray-800 no-underline"
          >
            Open contest
          </Button>
        </Section>

        <Text className="m-0 mt-6 text-base leading-6 font-semibold text-gray-800">
          The {BRAND_NAME_UPPER} Team
        </Text>
      </Container>
    </EmailContainer>
  )
}

ContestTakenDownEmail.PreviewProps = {
  organizerName: 'Jordan',
  contestTitle: 'Face of Haiku 2026',
  eventTitle: 'Miss Lagos 2026',
  reason:
    'The contest page tells voters to send money to a bank account outside Ticketeur. Sell votes through bundles instead.',
  manageUrl: 'https://www.useticketeur.com/org/events/demo',
} satisfies ContestTakenDownEmailProps

export { ContestTakenDownEmail }
