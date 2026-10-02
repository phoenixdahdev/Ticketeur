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

interface FormApprovedEmailProps {
  organizerName: string
  formTitle: string
  eventTitle: string
  publicUrl: string
  manageUrl: string
}

export default function FormApprovedEmail({
  organizerName = 'Friend',
  formTitle = 'Your form',
  eventTitle = 'your event',
  publicUrl = '#',
  manageUrl = '#',
}: Partial<FormApprovedEmailProps>) {
  return (
    <EmailContainer
      preview={
        <Preview>{`${formTitle} is approved on ${BRAND_NAME}`}</Preview>
      }
    >
      <Container className="mx-auto my-0 max-w-150 px-10">
        <Heading className="m-0 mb-4 text-2xl font-bold text-gray-900">
          Your form is approved
        </Heading>

        <Text className="m-0 mb-4 text-base leading-6 text-gray-700">
          Hi {organizerName},
        </Text>

        <Text className="m-0 mb-4 text-base leading-6 text-gray-700">
          Good news — <strong>{formTitle}</strong> for{' '}
          <strong>{eventTitle}</strong> has been approved. It takes submissions
          whenever your event is live on {BRAND_NAME} and the form is open.
        </Text>

        <Text className="m-0 mb-4 text-base leading-6 text-gray-700">
          Share the form link with the people you want to hear from. If you
          later change its questions, wording or prices, the form pauses for a
          quick review before it takes submissions again.
        </Text>

        <Section className="mb-8">
          <Row>
            <Button
              href={publicUrl}
              className="bg-brand mr-3 inline-block rounded-md px-6 py-3 text-center text-base font-semibold text-white no-underline"
            >
              View form
            </Button>
            <Button
              href={manageUrl}
              className="inline-block rounded-md border border-gray-300 px-6 py-3 text-center text-base font-semibold text-gray-800 no-underline"
            >
              Manage form
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

FormApprovedEmail.PreviewProps = {
  organizerName: 'Jordan',
  formTitle: 'Contestant Registration',
  eventTitle: 'Miss Lagos 2026',
  publicUrl: 'https://www.useticketeur.com/forms/demo',
  manageUrl: 'https://www.useticketeur.com/org/events/demo',
} satisfies FormApprovedEmailProps

export { FormApprovedEmail }
