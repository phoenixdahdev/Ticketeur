import {
  Button,
  Container,
  Heading,
  Preview,
  Row,
  Section,
  Text,
} from 'react-email'

import { BRAND_NAME_UPPER } from '../components/brand'
import EmailContainer from '../components/container'

interface SubmissionApprovedEmailProps {
  applicantName: string
  formTitle: string
  eventTitle: string
  eventDate: string
  eventLocation: string
  reference: string
  eventUrl: string
}

export default function SubmissionApprovedEmail({
  applicantName = 'there',
  formTitle = 'Registration',
  eventTitle = 'the event',
  eventDate = '',
  eventLocation = '',
  reference = '',
  eventUrl = '#',
}: Partial<SubmissionApprovedEmailProps>) {
  return (
    <EmailContainer
      preview={
        <Preview>{`Your application for ${formTitle} was approved`}</Preview>
      }
    >
      <Container className="mx-auto my-0 max-w-150 px-10">
        <Heading className="m-0 mb-4 text-2xl font-bold text-gray-900">
          Your application was approved
        </Heading>

        <Text className="m-0 mb-4 text-base leading-6 text-gray-700">
          Hi {applicantName},
        </Text>

        <Text className="m-0 mb-4 text-base leading-6 text-gray-700">
          Good news: the organizer of <strong>{eventTitle}</strong> has approved
          your application for <strong>{formTitle}</strong>.
        </Text>

        <Section className="mb-6 rounded-lg bg-gray-50 px-5 py-4">
          <Row>
            <Text className="m-0 text-sm leading-5 text-gray-700">
              <strong>Reference:</strong> {reference}
            </Text>
          </Row>
          {eventDate ? (
            <Row>
              <Text className="m-0 mt-1 text-sm leading-5 text-gray-700">
                <strong>Date:</strong> {eventDate}
              </Text>
            </Row>
          ) : null}
          {eventLocation ? (
            <Row>
              <Text className="m-0 mt-1 text-sm leading-5 text-gray-700">
                <strong>Location:</strong> {eventLocation}
              </Text>
            </Row>
          ) : null}
        </Section>

        <Text className="m-0 mb-4 text-base leading-6 text-gray-700">
          The organizer may be in touch with next steps. Keep your reference
          handy in case you need to contact them.
        </Text>

        <Section className="mb-8">
          <Button
            href={eventUrl}
            className="bg-brand inline-block rounded-md px-6 py-3 text-center text-base font-semibold text-white no-underline"
          >
            View event
          </Button>
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

SubmissionApprovedEmail.PreviewProps = {
  applicantName: 'Amaka',
  formTitle: 'Contestant Registration',
  eventTitle: 'Face of Haiku 2026',
  eventDate: 'November 21, 2026',
  eventLocation: 'Eko Convention Centre, Lagos',
  reference: 'K7QM-3XPD',
  eventUrl: 'https://www.useticketeur.com/events/demo',
} satisfies SubmissionApprovedEmailProps

export { SubmissionApprovedEmail }
