import {
  Button,
  Column,
  Container,
  Heading,
  Preview,
  Row,
  Section,
  Text,
} from 'react-email'

import { BRAND_NAME, BRAND_NAME_UPPER } from '../components/brand'
import EmailContainer from '../components/container'

interface SubmissionConfirmationEmailProps {
  applicantName: string
  formTitle: string
  eventTitle: string
  eventDate: string
  eventLocation: string
  reference: string
  // 'approved' when the form approves automatically; 'submitted' when the
  // organizer reviews each application.
  status: 'submitted' | 'approved'
  // Pre-formatted fee paid ("₦5,000"), or null for a free application.
  amountPaid: string | null
  eventUrl: string
}

export default function SubmissionConfirmationEmail({
  applicantName = 'there',
  formTitle = 'Registration',
  eventTitle = 'the event',
  eventDate = '',
  eventLocation = '',
  reference = '',
  status = 'submitted',
  amountPaid = null,
  eventUrl = '#',
}: Partial<SubmissionConfirmationEmailProps>) {
  const approved = status === 'approved'
  return (
    <EmailContainer
      preview={
        <Preview>
          {approved
            ? `You're in: ${formTitle} at ${eventTitle}`
            : `We received your application for ${formTitle}`}
        </Preview>
      }
    >
      <Container className="mx-auto my-0 max-w-150 px-10">
        <Heading className="m-0 mb-4 text-2xl font-bold text-gray-900">
          {approved ? "You're in" : 'Application received'}
        </Heading>

        <Text className="m-0 mb-4 text-base leading-6 text-gray-700">
          Hi {applicantName},
        </Text>

        {approved ? (
          <Text className="m-0 mb-4 text-base leading-6 text-gray-700">
            Your application for <strong>{formTitle}</strong> at{' '}
            <strong>{eventTitle}</strong> is confirmed.
          </Text>
        ) : (
          <Text className="m-0 mb-4 text-base leading-6 text-gray-700">
            Thanks for applying for <strong>{formTitle}</strong> at{' '}
            <strong>{eventTitle}</strong>. The organizer will review your
            application, and we&apos;ll email you as soon as they decide.
          </Text>
        )}

        <Section className="mb-6 rounded-lg bg-gray-50 px-5 py-4">
          <Text className="m-0 text-sm leading-5 text-gray-600">
            Your reference
          </Text>
          <Text className="m-0 mt-1 text-2xl leading-8 font-bold tracking-widest text-gray-900">
            {reference}
          </Text>
          <Text className="m-0 mt-2 text-sm leading-5 text-gray-600">
            Quote it if you contact the organizer or {BRAND_NAME} support about
            your application.
          </Text>
        </Section>

        <Section className="mb-6 rounded-lg border border-gray-200 px-5 py-4">
          <DetailRow label="Event:" value={eventTitle} />
          {eventDate ? <DetailRow label="Date:" value={eventDate} /> : null}
          {eventLocation ? (
            <DetailRow label="Location:" value={eventLocation} />
          ) : null}
          <DetailRow
            label="Fee:"
            value={amountPaid ? `${amountPaid} paid` : 'Free'}
            last
          />
        </Section>

        <Section className="mb-8">
          <Button
            href={eventUrl}
            className="bg-brand inline-block rounded-md px-6 py-3 text-center text-base font-semibold text-white no-underline"
          >
            View event
          </Button>
        </Section>

        <Text className="m-0 mt-6 text-base leading-6 font-semibold text-gray-800">
          The {BRAND_NAME_UPPER} Team
        </Text>
      </Container>
    </EmailContainer>
  )
}

function DetailRow({
  label,
  value,
  last,
}: {
  label: string
  value: string
  last?: boolean
}) {
  return (
    <Row className={last ? '' : 'mb-2'}>
      <Column align="left" className="text-sm leading-5 text-gray-600">
        {label}
      </Column>
      <Column
        align="right"
        className="text-sm leading-5 font-semibold text-gray-900"
      >
        {value}
      </Column>
    </Row>
  )
}

SubmissionConfirmationEmail.PreviewProps = {
  applicantName: 'Amaka',
  formTitle: 'Contestant Registration',
  eventTitle: 'Face of Haiku 2026',
  eventDate: 'November 21, 2026',
  eventLocation: 'Eko Convention Centre, Lagos',
  reference: 'K7QM-3XPD',
  status: 'submitted',
  amountPaid: '₦5,000',
  eventUrl: 'https://www.useticketeur.com/events/demo',
} satisfies SubmissionConfirmationEmailProps

export { SubmissionConfirmationEmail }
