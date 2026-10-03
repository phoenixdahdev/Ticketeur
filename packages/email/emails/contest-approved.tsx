import {
  Button,
  Container,
  Heading,
  Preview,
  Row,
  Section,
  Text,
} from 'react-email'

import { BRAND_NAME, BRAND_NAME_UPPER } from '../components/brand'
import EmailContainer from '../components/container'

// Sent when an admin approves a contest's ballot and its prices
// (admin.moderation.approveContest). The counterpart of form-approved.tsx,
// and it says the same two things: it is live now, and changing what the
// public sees pauses it for another review.
interface ContestApprovedEmailProps {
  organizerName: string
  contestTitle: string
  eventTitle: string
  publicUrl: string
  manageUrl: string
}

export default function ContestApprovedEmail({
  organizerName = 'Friend',
  contestTitle = 'Your contest',
  eventTitle = 'your event',
  publicUrl = '#',
  manageUrl = '#',
}: Partial<ContestApprovedEmailProps>) {
  return (
    <EmailContainer
      preview={
        <Preview>{`${contestTitle} is approved on ${BRAND_NAME}`}</Preview>
      }
    >
      <Container className="mx-auto my-0 max-w-150 px-10">
        <Heading className="m-0 mb-4 text-2xl font-bold text-gray-900">
          Your contest is approved
        </Heading>

        <Text className="m-0 mb-4 text-base leading-6 text-gray-700">
          Hi {organizerName},
        </Text>

        <Text className="m-0 mb-4 text-base leading-6 text-gray-700">
          Good news — <strong>{contestTitle}</strong> for{' '}
          <strong>{eventTitle}</strong> has been approved. It takes votes inside
          the voting window you set.
        </Text>

        <Text className="m-0 mb-4 text-base leading-6 text-gray-700">
          Share the contest link so people can vote. If you later change its
          wording, its categories, who is on the ballot or what a vote costs,
          the contest pauses for a quick review before voting starts again.
        </Text>

        <Section className="mb-8">
          <Row>
            <Button
              href={publicUrl}
              className="bg-brand mr-3 inline-block rounded-md px-6 py-3 text-center text-base font-semibold text-white no-underline"
            >
              View contest
            </Button>
            <Button
              href={manageUrl}
              className="inline-block rounded-md border border-gray-300 px-6 py-3 text-center text-base font-semibold text-gray-800 no-underline"
            >
              Manage contest
            </Button>
          </Row>
        </Section>

        <Text className="m-0 mt-6 text-base leading-6 font-semibold text-gray-800">
          Cheers,
        </Text>
        <Text className="m-0 text-base leading-6 font-semibold text-gray-800">
          The {BRAND_NAME_UPPER} Team
        </Text>
      </Container>
    </EmailContainer>
  )
}

ContestApprovedEmail.PreviewProps = {
  organizerName: 'Jordan',
  contestTitle: 'Face of Haiku 2026',
  eventTitle: 'Miss Lagos 2026',
  publicUrl: 'https://www.useticketeur.com/contests/demo',
  manageUrl: 'https://www.useticketeur.com/org/events/demo',
} satisfies ContestApprovedEmailProps

export { ContestApprovedEmail }
