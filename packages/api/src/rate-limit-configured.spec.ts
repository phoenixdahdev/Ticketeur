import assert from 'node:assert/strict'
import { beforeEach, describe, test } from 'node:test'

// The two limits really are read from the environment, and really do change
// behaviour — not just the number reported back.
//
// Set before the imports, in this file's own process. See the note in
// rate-limit-kill-switch.spec.ts.
process.env.RATE_LIMIT_READS_PER_MINUTE = '4'
process.env.RATE_LIMIT_WRITES_PER_MINUTE = '1'

const { rateLimitSettings, rateLimitStore } = await import('./lib/rate-limit')
const { call, callTimes, fromIp } = await import('./test-support/trpc-harness')

beforeEach(() => {
  rateLimitStore.reset()
})

describe('limits configured from the environment', () => {
  test('replace the defaults', () => {
    assert.equal(rateLimitSettings.read.limit, 4)
    assert.equal(rateLimitSettings.write.limit, 1)
  })

  test('are what the middleware actually enforces, for reads', async () => {
    const headers = fromIp('41.58.10.1')
    const results = await callTimes(5, {
      path: 'publicRead',
      type: 'query',
      headers,
    })
    assert.deepEqual(
      results.map((r) => r.code),
      [null, null, null, null, 'TOO_MANY_REQUESTS']
    )
  })

  test('and for writes, separately', async () => {
    const headers = fromIp('41.58.10.2')
    const results = await callTimes(2, {
      path: 'publicWrite',
      type: 'mutation',
      headers,
    })
    assert.deepEqual(
      results.map((r) => r.code),
      [null, 'TOO_MANY_REQUESTS']
    )
    // A one-per-minute budget means the wait is close to a whole minute.
    assert.equal(results[1]?.retryAfter, '60')
  })

  test('with the window still a minute, so the wait is proportionate', async () => {
    const headers = fromIp('41.58.10.3')
    await callTimes(4, { path: 'publicRead', type: 'query', headers })
    const refused = await call({ path: 'publicRead', type: 'query', headers })
    // Four a minute is one every fifteen seconds.
    assert.equal(refused.retryAfter, '15')
  })
})
