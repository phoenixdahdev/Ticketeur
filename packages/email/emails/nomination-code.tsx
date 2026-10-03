import { Container, Heading, Preview, Section, Text } from 'react-email'

import { BRAND_NAME_UPPER } from '../components/brand'
import EmailContainer from '../components/container'

interface NominationCodeEmailProps {
  // The one-time code itself. It exists here and in the nominator's browser
  // and nowhere else — the database holds only a scrypt digest of it.
  code: string
  contestTitle: string
  eventTitle: string
  contestUrl: string
  // How long the code is good for, from VOTE_CODE_TTL_MINUTES, so this email
  // cannot promise a window the verifier will not honour.
  expiresInMinutes: number
}

// The same one-time code machinery the free vote uses (`vote_otps`), for the
// same reason — the address behind a nomination has to be real — but its own
// words. A nominator is not voting, and an email telling them to "cast your
// free vote" would be describing something they did not do.
export default function NominationCodeEmail({
  code = '482916',
  contestTitle = 'the contest',
  eventTitle = 'the event',
  contestUrl = '',
  expiresInMinutes = 10,
}: Partial<NominationCodeEmailProps>) {
  return (
    <EmailContainer
      preview={<Preview>{`Your nomination code for ${contestTitle}`}</Preview>}
    >
      <Container className="mx-auto my-0 max-w-150 px-10">
        <Heading className="text-brand-dark m-0 mb-4 text-2xl font-bold">
          Your nomination code
        </Heading>

        <Text className="m-0 mb-6 text-base leading-6 text-gray-700">
          Enter this code to put a name forward in{' '}
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
            A nomination is not a vote. The organizer reads every name put
            forward and decides which ones go on the ballot — voting comes after
            that.
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
          If you didn&apos;t ask to nominate anybody, you can safely ignore this
          email — nothing is put forward until the code is used, and nobody can
          use it but you.
        </Text>

        <Text className="m-0 text-sm leading-5 text-gray-500">
          &mdash; The {BRAND_NAME_UPPER} Team
        </Text>
      </Container>
    </EmailContainer>
  )
}
