import { Button, Container, Heading, Preview, Section, Text } from 'react-email'

import { BRAND_NAME, BRAND_NAME_UPPER } from '../components/brand'
import EmailContainer from '../components/container'

// Sent when an admin turns a contest down (admin.moderation.rejectContest).
// The contest stays offline and the organizer's route back is to fix the
// reason and submit it again — exactly the loop form-rejected.tsx describes.
interface ContestRejectedEmailProps {
  organizerName: string
  contestTitle: string
  eventTitle: string
  reason: string
  manageUrl: string
}

export default function ContestRejectedEmail({
  organizerName = 'Friend',
  contestTitle = 'Your contest',
  eventTitle = 'your event',
  reason = '',
  manageUrl = '#',
}: Partial<ContestRejectedEmailProps>) {
  return (
    <EmailContainer
      preview={
        <Preview>
          {contestTitle} wasn&apos;t approved on {BRAND_NAME}
        </Preview>
      }
    >
      <Container className="mx-auto my-0 max-w-150 px-10">
        <Heading className="m-0 mb-4 text-2xl font-bold text-gray-900">
          Your contest wasn&apos;t approved
        </Heading>

        <Text className="m-0 mb-4 text-base leading-6 text-gray-700">
          Hi {organizerName},
        </Text>

        <Text className="m-0 mb-4 text-base leading-6 text-gray-700">
          We reviewed <strong>{contestTitle}</strong> for{' '}
          <strong>{eventTitle}</strong> and we&apos;re unable to publish it on{' '}
          {BRAND_NAME} as submitted, so it isn&apos;t taking votes.
        </Text>

        {reason ? (
          <Section className="mb-6 rounded-lg bg-gray-50 px-5 py-4">
            <Text className="m-0 text-sm leading-5 text-gray-700">
              <strong>Reason:</strong> {reason}
            </Text>
          </Section>
        ) : null}

        <Text className="m-0 mb-4 text-base leading-6 text-gray-700">
          You can edit the contest from your organizer dashboard — its
          categories, who is on the ballot, and what a vote costs — and submit
          it again for review.
        </Text>

        <Section className="mb-8">
          <Button
            href={manageUrl}
            className="inline-block rounded-md border border-gray-300 px-6 py-3 text-center text-base font-semibold text-gray-800 no-underline"
          >
            Edit contest
          </Button>
        </Section>

        <Text className="m-0 mt-6 text-base leading-6 font-semibold text-gray-800">
          The {BRAND_NAME_UPPER} Team
        </Text>
      </Container>
    </EmailContainer>
  )
}

ContestRejectedEmail.PreviewProps = {
  organizerName: 'Jordan',
  contestTitle: 'Face of Haiku 2026',
  eventTitle: 'Miss Lagos 2026',
  reason:
    'Two of the entries use photos of people who have not agreed to take part. Remove them before submitting again.',
  manageUrl: 'https://www.useticketeur.com/org/events/demo',
} satisfies ContestRejectedEmailProps

export { ContestRejectedEmail }
