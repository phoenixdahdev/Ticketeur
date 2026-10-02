import {
  Button,
  Container,
  Heading,
  Preview,
  Section,
  Text,
} from 'react-email'

import { BRAND_NAME, BRAND_NAME_UPPER } from '../components/brand'
import EmailContainer from '../components/container'

interface FormRejectedEmailProps {
  organizerName: string
  formTitle: string
  eventTitle: string
  reason: string
  manageUrl: string
}

export default function FormRejectedEmail({
  organizerName = 'Friend',
  formTitle = 'Your form',
  eventTitle = 'your event',
  reason = '',
  manageUrl = '#',
}: Partial<FormRejectedEmailProps>) {
  return (
    <EmailContainer
      preview={
        <Preview>
          {formTitle} wasn&apos;t approved on {BRAND_NAME}
        </Preview>
      }
    >
      <Container className="mx-auto my-0 max-w-150 px-10">
        <Heading className="m-0 mb-4 text-2xl font-bold text-gray-900">
          Your form wasn&apos;t approved
        </Heading>

        <Text className="m-0 mb-4 text-base leading-6 text-gray-700">
          Hi {organizerName},
        </Text>

        <Text className="m-0 mb-4 text-base leading-6 text-gray-700">
          We reviewed <strong>{formTitle}</strong> for{' '}
          <strong>{eventTitle}</strong> and we&apos;re unable to publish it on{' '}
          {BRAND_NAME} as submitted, so it isn&apos;t taking submissions.
        </Text>

        {reason ? (
          <Section className="mb-6 rounded-lg bg-gray-50 px-5 py-4">
            <Text className="m-0 text-sm leading-5 text-gray-700">
              <strong>Reason:</strong> {reason}
            </Text>
          </Section>
        ) : null}

        <Text className="m-0 mb-4 text-base leading-6 text-gray-700">
          You can edit the form from your organizer dashboard and submit it
          again for review.
        </Text>

        <Section className="mb-8">
          <Button
            href={manageUrl}
            className="inline-block rounded-md border border-gray-300 px-6 py-3 text-center text-base font-semibold text-gray-800 no-underline"
          >
            Edit form
          </Button>
        </Section>

        <Text className="m-0 mt-6 text-base leading-6 font-semibold text-gray-800">
          The {BRAND_NAME_UPPER} Team
        </Text>
      </Container>
    </EmailContainer>
  )
}

FormRejectedEmail.PreviewProps = {
  organizerName: 'Jordan',
  formTitle: 'Contestant Registration',
  eventTitle: 'Miss Lagos 2026',
  reason:
    'The form asks for applicants’ BVN and bank PIN. Remove those questions; collect payment through the form’s price options instead.',
  manageUrl: 'https://www.useticketeur.com/org/events/demo',
} satisfies FormRejectedEmailProps

export { FormRejectedEmail }
