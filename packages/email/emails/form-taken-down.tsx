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

// Sent when an admin takes a form that was already public off the platform
// (admin.moderation.takeDownForm). Deliberately not the rejection email: this
// form WAS approved and live, so "wasn't approved" would read as nonsense to
// an organizer whose applicants have been applying for weeks.
interface FormTakenDownEmailProps {
  organizerName: string
  formTitle: string
  eventTitle: string
  reason: string
  manageUrl: string
}

export default function FormTakenDownEmail({
  organizerName = 'Friend',
  formTitle = 'Your form',
  eventTitle = 'your event',
  reason = '',
  manageUrl = '#',
}: Partial<FormTakenDownEmailProps>) {
  return (
    <EmailContainer
      preview={
        <Preview>
          {formTitle} has been taken down on {BRAND_NAME}
        </Preview>
      }
    >
      <Container className="mx-auto my-0 max-w-150 px-10">
        <Heading className="m-0 mb-4 text-2xl font-bold text-gray-900">
          Your form has been taken down
        </Heading>

        <Text className="m-0 mb-4 text-base leading-6 text-gray-700">
          Hi {organizerName},
        </Text>

        <Text className="m-0 mb-4 text-base leading-6 text-gray-700">
          We&apos;ve taken <strong>{formTitle}</strong> for{' '}
          <strong>{eventTitle}</strong> off {BRAND_NAME}. It has stopped
          accepting applications and its page is no longer public.
        </Text>

        {reason ? (
          <Section className="mb-6 rounded-lg bg-gray-50 px-5 py-4">
            <Text className="m-0 text-sm leading-5 text-gray-700">
              <strong>Reason:</strong> {reason}
            </Text>
          </Section>
        ) : null}

        <Text className="m-0 mb-4 text-base leading-6 text-gray-700">
          Every application you already have is kept, and you can still review
          them from your dashboard. Anyone who had already paid is still
          credited.
        </Text>

        <Text className="m-0 mb-4 text-base leading-6 text-gray-700">
          If you can deal with the reason above, edit the form and submit it for
          review. It can only go back online once an admin has approved it
          again.
        </Text>

        <Section className="mb-8">
          <Button
            href={manageUrl}
            className="inline-block rounded-md border border-gray-300 px-6 py-3 text-center text-base font-semibold text-gray-800 no-underline"
          >
            Open form
          </Button>
        </Section>

        <Text className="m-0 mt-6 text-base leading-6 font-semibold text-gray-800">
          The {BRAND_NAME_UPPER} Team
        </Text>
      </Container>
    </EmailContainer>
  )
}

FormTakenDownEmail.PreviewProps = {
  organizerName: 'Jordan',
  formTitle: 'Vendor Booth Registration',
  eventTitle: 'Miss Lagos 2026',
  reason:
    'The booth description asks applicants to send a bank transfer to an account outside Ticketeur. Take payment through the form’s price options instead.',
  manageUrl: 'https://www.useticketeur.com/org/events/demo',
} satisfies FormTakenDownEmailProps

export { FormTakenDownEmail }
