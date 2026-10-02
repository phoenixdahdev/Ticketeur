import { Container, Heading, Preview, Section, Text } from 'react-email'

import { BRAND_NAME_UPPER } from '../components/brand'
import EmailContainer from '../components/container'

interface SubmissionRejectedEmailProps {
  applicantName: string
  formTitle: string
  eventTitle: string
  reference: string
  // The organizer's reason, written for the applicant.
  reason: string
  // What the applicant paid to apply, in kobo. 0 for a free application, or
  // for one whose fee never cleared. Non-zero means we are holding their money
  // for something they didn't get, so the email has to say so.
  refundOwedMinor: number
}

// Matches formatNaira in the web app. Duplicated rather than imported: this
// package renders in the Trigger.dev worker and must not depend on the app.
function naira(minor: number): string {
  return `₦${(minor / 100).toLocaleString('en-US', {
    maximumFractionDigits: 0,
  })}`
}

export default function SubmissionRejectedEmail({
  applicantName = 'there',
  formTitle = 'Registration',
  eventTitle = 'the event',
  reference = '',
  reason = '',
  refundOwedMinor = 0,
}: Partial<SubmissionRejectedEmailProps>) {
  return (
    <EmailContainer
      preview={
        <Preview>{`Your application for ${formTitle} wasn't approved`}</Preview>
      }
    >
      <Container className="mx-auto my-0 max-w-150 px-10">
        <Heading className="m-0 mb-4 text-2xl font-bold text-gray-900">
          Your application wasn&apos;t approved
        </Heading>

        <Text className="m-0 mb-4 text-base leading-6 text-gray-700">
          Hi {applicantName},
        </Text>

        <Text className="m-0 mb-4 text-base leading-6 text-gray-700">
          The organizer of <strong>{eventTitle}</strong> reviewed your
          application for <strong>{formTitle}</strong> and wasn&apos;t able to
          approve it.
        </Text>

        {reason ? (
          <Section className="mb-6 rounded-lg bg-gray-50 px-5 py-4">
            <Text className="m-0 text-sm leading-5 text-gray-700">
              <strong>Reason:</strong> {reason}
            </Text>
          </Section>
        ) : null}

        {refundOwedMinor > 0 ? (
          <Section className="mb-6 rounded-lg bg-gray-50 px-5 py-4">
            <Text className="m-0 text-sm leading-5 text-gray-700">
              <strong>
                Your {naira(refundOwedMinor)} fee is due back to you.
              </strong>{' '}
              You paid this to apply, and the place it was for wasn&apos;t
              given. Refunds are made by hand rather than automatically, so
              please allow a few working days for it to reach the account you
              paid from. You don&apos;t need to do anything to claim it — if it
              hasn&apos;t arrived within five working days, reply to this email
              and quote your reference below.
            </Text>
          </Section>
        ) : null}

        <Text className="m-0 mb-4 text-base leading-6 text-gray-700">
          If you have questions, contact the organizer and quote your reference,{' '}
          <strong>{reference}</strong>.
        </Text>

        <Text className="m-0 mt-6 text-base leading-6 font-semibold text-gray-800">
          The {BRAND_NAME_UPPER} Team
        </Text>
      </Container>
    </EmailContainer>
  )
}

SubmissionRejectedEmail.PreviewProps = {
  applicantName: 'Amaka',
  formTitle: 'Contestant Registration',
  eventTitle: 'Face of Haiku 2026',
  reference: 'K7QM-3XPD',
  reason: 'Applicants must be 18 to 27 on the day of the event.',
  refundOwedMinor: 525000,
} satisfies SubmissionRejectedEmailProps

export { SubmissionRejectedEmail }
