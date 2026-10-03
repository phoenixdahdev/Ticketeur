import { Container, Heading, Preview, Section, Text } from 'react-email'

import { BRAND_NAME_UPPER } from '../components/brand'
import EmailContainer from '../components/container'

interface VoteCodeEmailProps {
  // The one-time code itself. It exists here and in the voter's browser and
  // nowhere else — the database holds only a scrypt digest of it.
  code: string
  contestTitle: string
  eventTitle: string
  contestUrl: string
  // How long the code is good for, from VOTE_CODE_TTL_MINUTES, so this email
  // cannot promise a window the verifier will not honour.
  expiresInMinutes: number
}

export default function VoteCodeEmail({
  code = '482916',
  contestTitle = 'the contest',
  eventTitle = 'the event',
  contestUrl = '',
  expiresInMinutes = 10,
}: Partial<VoteCodeEmailProps>) {
  return (
    <EmailContainer
      preview={<Preview>{`Your voting code for ${contestTitle}`}</Preview>}
    >
      <Container className="mx-auto my-0 max-w-150 px-10">
        <Heading className="text-brand-dark m-0 mb-4 text-2xl font-bold">
          Your voting code
        </Heading>

        <Text className="m-0 mb-6 text-base leading-6 text-gray-700">
          Enter this code to cast your free vote in{' '}
          <strong>{contestTitle}</strong> at {eventTitle}.
        </Text>

        <Section className="bg-brand-light border-brand-light mb-6 rounded-lg border border-solid p-6 text-center">
          <Text className="text-brand m-0 font-mono text-4xl font-bold tracking-widest">
            {code}
          </Text>
          <Text className="text-brand-dark m-0 mt-3 text-sm leading-5">
            This code expires in{' '}
            <strong>
              {expiresInMinutes} {expiresInMinutes === 1 ? 'minute' : 'minutes'}
            </strong>
            , and works once.
          </Text>
        </Section>

        <Section className="mb-6 rounded-lg bg-gray-50 px-5 py-4">
          <Text className="m-0 text-sm leading-5 text-gray-700">
            Free voting is <strong>one vote per category, per day</strong>. Come
            back tomorrow to vote again — or buy votes on the contest page if
            you would rather not wait.
          </Text>
        </Section>

        {contestUrl ? (
          <Text className="m-0 mb-4 text-sm leading-5 text-gray-500">
            The contest page is at{' '}
            <a href={contestUrl} className="text-brand no-underline">
              {contestUrl}
            </a>
            .
          </Text>
        ) : null}

        <Text className="m-0 mb-4 text-sm leading-5 text-gray-500">
          If you didn&apos;t ask to vote, you can safely ignore this email — no
          vote is cast until the code is used, and nobody can use it but you.
        </Text>

        <Text className="m-0 text-sm leading-5 text-gray-500">
          &mdash; The {BRAND_NAME_UPPER} Team
        </Text>
      </Container>
    </EmailContainer>
  )
}

VoteCodeEmail.PreviewProps = {
  code: '482916',
  contestTitle: 'Face of Haiku 2026',
  eventTitle: 'Haiku Festival',
  contestUrl: 'https://www.useticketeur.com/contests/face-of-haiku-2026',
  expiresInMinutes: 10,
} satisfies VoteCodeEmailProps

export { VoteCodeEmail }
