import { Button, Container, Heading, Preview, Section, Text } from 'react-email'

import { BRAND_NAME_UPPER } from '../components/brand'
import EmailContainer from '../components/container'

interface VotePurchaseEmailProps {
  voterName: string
  contestTitle: string
  eventTitle: string
  // Votes this purchase bought.
  votesGranted: number
  // Votes they can spend right now, this purchase included.
  votesRemaining: number
  // Already formatted for display ("₦1,050"), inclusive of the service fee,
  // so the email cannot disagree with what was charged.
  amountPaid: string
  contestUrl: string
  // True when the contest had stopped accepting votes before the payment
  // cleared. The credits exist but cannot be spent, and the money is coming
  // back — saying nothing here would leave them waiting to use votes that
  // will never work.
  unusable: boolean
}

export default function VotePurchaseEmail({
  voterName = 'there',
  contestTitle = 'the contest',
  eventTitle = 'the event',
  votesGranted = 0,
  votesRemaining = 0,
  amountPaid = '',
  contestUrl = '',
  unusable = false,
}: Partial<VotePurchaseEmailProps>) {
  const plural = votesGranted === 1 ? 'vote' : 'votes'
  return (
    <EmailContainer
      preview={
        <Preview>{`${votesGranted} ${plural} for ${contestTitle}`}</Preview>
      }
    >
      <Container className="mx-auto my-0 max-w-150 px-10">
        <Heading className="m-0 mb-4 text-2xl font-bold text-gray-900">
          Your votes are ready
        </Heading>

        <Text className="m-0 mb-4 text-base leading-6 text-gray-700">
          Hi {voterName},
        </Text>

        <Text className="m-0 mb-4 text-base leading-6 text-gray-700">
          Thank you — your payment of <strong>{amountPaid}</strong> went
          through, and{' '}
          <strong>
            {votesGranted} {plural}
          </strong>{' '}
          have been added to your balance for <strong>{contestTitle}</strong> at{' '}
          {eventTitle}.
        </Text>

        {unusable ? (
          <Section className="mb-6 rounded-lg bg-gray-50 px-5 py-4">
            <Text className="m-0 text-sm leading-5 text-gray-700">
              <strong>
                Voting closed before your payment reached us, so these votes
                cannot be used.
              </strong>{' '}
              You are owed {amountPaid} back. Refunds are made by hand rather
              than automatically, so please allow a few working days for it to
              reach the account you paid from. You don&apos;t need to do
              anything to claim it.
            </Text>
          </Section>
        ) : (
          <>
            <Section className="mb-6 rounded-lg bg-gray-50 px-5 py-4">
              <Text className="m-0 text-sm leading-5 text-gray-700">
                You have <strong>{votesRemaining}</strong>{' '}
                {votesRemaining === 1 ? 'vote' : 'votes'} to spend. They can go
                to one entry or be split across several — it is up to you.
              </Text>
            </Section>

            <Section className="mb-6">
              <Button
                href={contestUrl}
                className="bg-brand inline-block rounded-md px-6 py-3 text-center text-base font-semibold text-white no-underline"
              >
                Cast your votes
              </Button>
            </Section>
          </>
        )}

        <Text className="m-0 mt-6 text-base leading-6 font-semibold text-gray-800">
          The {BRAND_NAME_UPPER} Team
        </Text>
      </Container>
    </EmailContainer>
  )
}

VotePurchaseEmail.PreviewProps = {
  voterName: 'Amaka',
  contestTitle: 'Face of Haiku 2026',
  eventTitle: 'Haiku Festival',
  votesGranted: 20,
  votesRemaining: 23,
  amountPaid: '₦1,050',
  contestUrl: 'https://www.useticketeur.com/contests/face-of-haiku-2026',
  unusable: false,
} satisfies VotePurchaseEmailProps

export { VotePurchaseEmail }
