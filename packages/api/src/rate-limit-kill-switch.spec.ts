import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

// The kill switch, exercised the way an operator uses it: the environment
// variable is set, and the process starts.
//
// `node --test` runs each test file in its own process, so setting the
// variable here affects nothing else. It has to be set BEFORE the imports
// below, because @ticketur/env/core reads and validates the environment once,
// at module load — which is also why turning the brake off in production
// needs a redeploy, and why that is worth saying out loud rather than
// implying the change is instant.
process.env.RATE_LIMIT_ENABLED = 'false'

const { rateLimitSettings, rateLimitStore } = await import('./lib/rate-limit')
const { call, callTimes, fromIp } = await import('./test-support/trpc-harness')

describe('RATE_LIMIT_ENABLED=false', () => {
  test('turns the brake off', () => {
    assert.equal(rateLimitSettings.enabled, false)
  })

  test('lets a caller through far past both ceilings', async () => {
    rateLimitStore.reset()
    const headers = fromIp('41.58.9.1')

    const reads = await callTimes(rateLimitSettings.read.limit * 2, {
      path: 'publicRead',
      type: 'query',
      headers,
    })
    const writes = await callTimes(rateLimitSettings.write.limit * 5, {
      path: 'publicWrite',
      type: 'mutation',
      headers,
    })

    for (const [i, result] of [...reads, ...writes].entries()) {
      assert.equal(result.code, null, `call ${i + 1} should pass`)
      assert.equal(result.status, 200)
      assert.equal(result.retryAfter, null)
    }
  })

  test('and stops counting entirely, rather than counting and forgiving', async () => {
    rateLimitStore.reset()
    await callTimes(50, {
      path: 'publicRead',
      type: 'query',
      headers: fromIp('41.58.9.2'),
    })
    assert.equal(
      rateLimitStore.size(),
      0,
      'a disabled brake should cost nothing, not even memory'
    )
  })

  test('without disturbing anything else about the call', async () => {
    const unauthorized = await call({
      path: 'adminWrite',
      type: 'mutation',
      headers: fromIp('41.58.9.3'),
    })
    assert.equal(unauthorized.code, 'UNAUTHORIZED')
  })
})
