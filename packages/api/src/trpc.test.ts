import assert from 'node:assert/strict'
import { beforeEach, describe, test } from 'node:test'

import { rateLimitSettings, rateLimitStore } from './lib/rate-limit'
import {
  call,
  callStreamedBatch,
  callTimes,
  fromIp,
  sessionFor,
} from './test-support/trpc-harness'

// The rate-limit middleware, through the real fetch adapter.
//
// Every case here drives `publicProcedure` / `adminProcedure` exactly as they
// are exported from ./trpc — no re-implementation, no test-only policy — so a
// change that unhooks the middleware, or hooks it onto the wrong builder,
// fails here.

const READS = rateLimitSettings.read.limit
const WRITES = rateLimitSettings.write.limit

beforeEach(() => {
  rateLimitStore.reset()
})

describe('the shipped defaults', () => {
  test('are on, and reads are far more generous than writes', () => {
    assert.equal(rateLimitSettings.enabled, true)
    assert.equal(READS, 300)
    assert.equal(WRITES, 30)
    assert.ok(
      READS > WRITES * 5,
      'a leaderboard read and a vote cast are not the same risk'
    )
    assert.equal(rateLimitSettings.read.windowMs, 60_000)
    assert.equal(rateLimitSettings.write.windowMs, 60_000)
  })
})

describe('a public read', () => {
  test('passes under the limit and is refused over it', async () => {
    const headers = fromIp('41.58.1.1')

    const allowed = await callTimes(READS, {
      path: 'publicRead',
      type: 'query',
      headers,
    })
    for (const [i, result] of allowed.entries()) {
      assert.equal(result.code, null, `read ${i + 1} of ${READS} should pass`)
      assert.equal(result.status, 200)
    }

    const refused = await call({ path: 'publicRead', type: 'query', headers })
    assert.equal(refused.code, 'TOO_MANY_REQUESTS')
    assert.equal(refused.status, 429)
  })

  test('is told how long to wait, in words and in a header', async () => {
    const headers = fromIp('41.58.1.2')
    await callTimes(READS, { path: 'publicRead', type: 'query', headers })

    const refused = await call({ path: 'publicRead', type: 'query', headers })
    assert.equal(refused.code, 'TOO_MANY_REQUESTS')
    // Copy a person can act on: what happened, how long, what to do.
    assert.match(
      refused.message ?? '',
      /^Too many requests from your network\. Wait \d+ seconds? and reload the page\.$/
    )
    // The same number, machine-readable, both on the transport and in the
    // error shape (the streaming batch link only gets the latter).
    assert.ok(refused.retryAfterSeconds !== null)
    assert.equal(refused.retryAfter, String(refused.retryAfterSeconds))
    assert.ok(Number(refused.retryAfter) >= 1)
  })

  test('and the browser will not retry it into a storm', async () => {
    // packages/ui/src/lib/query-client.ts refuses to retry anything whose
    // error shape carries a 4xx `httpStatus`. A refusal that arrived as a 5xx
    // would be retried three times with backoff, so a throttled page would
    // make four calls instead of one.
    const headers = fromIp('41.58.1.4')
    await callTimes(READS, { path: 'publicRead', type: 'query', headers })
    const refused = await call({ path: 'publicRead', type: 'query', headers })
    assert.equal(refused.httpStatus, 429)
  })

  test('a successful response carries no Retry-After', async () => {
    const ok = await call({
      path: 'publicRead',
      type: 'query',
      headers: fromIp('41.58.1.3'),
    })
    assert.equal(ok.code, null)
    assert.equal(ok.retryAfter, null)
  })
})

describe('a public write', () => {
  test('has its own, much smaller budget', async () => {
    const headers = fromIp('41.58.2.1')

    const allowed = await callTimes(WRITES, {
      path: 'publicWrite',
      type: 'mutation',
      headers,
    })
    for (const [i, result] of allowed.entries()) {
      assert.equal(result.code, null, `write ${i + 1} of ${WRITES} should pass`)
    }

    const refused = await call({
      path: 'publicWrite',
      type: 'mutation',
      headers,
    })
    assert.equal(refused.code, 'TOO_MANY_REQUESTS')
    assert.equal(refused.status, 429)
    assert.match(refused.message ?? '', /and try again\.$/)
  })

  test('spending the write budget leaves reading alone', async () => {
    const headers = fromIp('41.58.2.2')
    await callTimes(WRITES + 5, {
      path: 'publicWrite',
      type: 'mutation',
      headers,
    })

    const read = await call({ path: 'publicRead', type: 'query', headers })
    assert.equal(
      read.code,
      null,
      'a caller who overdid one form submission must still be able to browse'
    )
  })

  test('and the write limit really is the tighter of the two', async () => {
    const headers = fromIp('41.58.2.3')
    // The read budget is nowhere near spent at the point writes run out.
    await callTimes(WRITES + 1, {
      path: 'publicWrite',
      type: 'mutation',
      headers,
    })
    const reads = await callTimes(WRITES + 1, {
      path: 'publicRead',
      type: 'query',
      headers,
    })
    for (const read of reads) assert.equal(read.code, null)
  })
})

describe('on the streaming batch transport the apps actually use', () => {
  test('the refusal arrives per call, with the wait, but no header', async () => {
    const headers = fromIp('41.58.12.1')
    await callTimes(READS, { path: 'publicRead', type: 'query', headers })

    const batch = await callStreamedBatch({
      paths: ['publicRead', 'publicRead'],
      headers,
    })

    // Every call in the batch is refused, and each refusal carries the wait
    // in the body — the message for a person, the number for the UI.
    assert.equal(batch.refusals.length, 2)
    for (const refusal of batch.refusals) {
      assert.equal(refusal.code, 'TOO_MANY_REQUESTS')
      assert.match(refusal.message, /Wait \d+ seconds? and reload the page\./)
      assert.ok(
        typeof refusal.retryAfterSeconds === 'number' &&
          refusal.retryAfterSeconds >= 1
      )
    }

    // And the honest caveat, pinned: tRPC has to send the headers before any
    // procedure runs on this transport, so `Retry-After` cannot be among
    // them. Anything claiming otherwise in the docs would fail here.
    assert.equal(batch.retryAfter, null)
    assert.equal(batch.status, 200)
  })

  test('an allowed batch still goes through unharmed', async () => {
    const batch = await callStreamedBatch({
      paths: ['publicRead', 'publicRead', 'publicRead'],
      headers: fromIp('41.58.12.2'),
    })
    assert.deepEqual(batch.refusals, [])
    assert.equal(
      batch.body.split('"ok"').length - 1,
      3,
      'all three calls should have answered'
    )
  })

  test('each call in a batch spends its own token', async () => {
    const headers = fromIp('41.58.12.3')
    // A batch of three leaves the budget three lower, not one.
    await callStreamedBatch({
      paths: ['publicRead', 'publicRead', 'publicRead'],
      headers,
    })
    const rest = await callTimes(READS - 3, {
      path: 'publicRead',
      type: 'query',
      headers,
    })
    for (const result of rest) assert.equal(result.code, null)
    const refused = await call({ path: 'publicRead', type: 'query', headers })
    assert.equal(refused.code, 'TOO_MANY_REQUESTS')
  })
})

describe('the window', () => {
  test('reopens as time passes, and not before', async (t) => {
    t.mock.timers.enable({ apis: ['Date'] })
    const headers = fromIp('41.58.11.1')

    await callTimes(READS, { path: 'publicRead', type: 'query', headers })
    const refused = await call({ path: 'publicRead', type: 'query', headers })
    assert.equal(refused.code, 'TOO_MANY_REQUESTS')

    // Still inside the wait the caller was given.
    t.mock.timers.tick((Number(refused.retryAfter) - 1) * 1000)
    const tooSoon = await call({ path: 'publicRead', type: 'query', headers })
    assert.equal(
      tooSoon.code,
      'TOO_MANY_REQUESTS',
      'the wait the caller was told must be honest'
    )

    // Past it.
    t.mock.timers.tick(2_000)
    const afterWaiting = await call({
      path: 'publicRead',
      type: 'query',
      headers,
    })
    assert.equal(
      afterWaiting.code,
      null,
      'waiting the advertised time must actually work'
    )

    // And a whole window restores the whole budget.
    t.mock.timers.tick(60_000)
    const full = await callTimes(READS, {
      path: 'publicRead',
      type: 'query',
      headers,
    })
    for (const result of full) assert.equal(result.code, null)
  })
})

describe('whose budget is spent', () => {
  test('two addresses do not share one', async () => {
    const attacker = fromIp('203.0.113.9')
    await callTimes(READS + 1, {
      path: 'publicRead',
      type: 'query',
      headers: attacker,
    })
    const attackerAgain = await call({
      path: 'publicRead',
      type: 'query',
      headers: attacker,
    })
    assert.equal(attackerAgain.code, 'TOO_MANY_REQUESTS')

    const bystander = await call({
      path: 'publicRead',
      type: 'query',
      headers: fromIp('41.58.3.1'),
    })
    assert.equal(
      bystander.code,
      null,
      "one address flooding must not spend another's budget"
    )
  })

  test('a caller cannot buy a fresh budget with a forged header', async () => {
    // The edge appends the address it accepted the connection from, so the
    // spoofed entries sit in front of it and are ignored.
    const edgeSees = '41.58.4.1'
    await callTimes(READS, {
      path: 'publicRead',
      type: 'query',
      headers: { 'x-forwarded-for': edgeSees },
    })

    const withForgedPrefix = await call({
      path: 'publicRead',
      type: 'query',
      headers: { 'x-forwarded-for': `9.9.9.9, ${edgeSees}` },
    })
    assert.equal(
      withForgedPrefix.code,
      'TOO_MANY_REQUESTS',
      'prepending an address must not move the caller to a new bucket'
    )
  })

  test('a caller with no address at all is still counted', async () => {
    await callTimes(READS, { path: 'publicRead', type: 'query' })
    const refused = await call({ path: 'publicRead', type: 'query' })
    assert.equal(
      refused.code,
      'TOO_MANY_REQUESTS',
      'a missing header must fail into a shared bucket, not out of the brake'
    )
  })

  test('signing in gives a caller their own budget', async () => {
    const nat = fromIp('41.58.5.1')
    await callTimes(READS + 1, {
      path: 'publicRead',
      type: 'query',
      headers: nat,
    })

    const signedIn = await call({
      path: 'publicRead',
      type: 'query',
      headers: nat,
      session: sessionFor('attendee'),
    })
    assert.equal(
      signedIn.code,
      null,
      'carrier NAT must not throttle a signed-in voter for their neighbours'
    )
  })
})

describe('what is never throttled', () => {
  test('admin procedures, however hard they are hit', async () => {
    const headers = fromIp('41.58.6.1')
    const session = sessionFor('admin')

    // Far past both ceilings, on a reader and a writer, from one address.
    const reads = await callTimes(READS * 2, {
      path: 'adminRead',
      type: 'query',
      headers,
      session,
    })
    const writes = await callTimes(WRITES * 10, {
      path: 'adminWrite',
      type: 'mutation',
      headers,
      session,
    })

    for (const [i, result] of [...reads, ...writes].entries()) {
      assert.equal(
        result.code,
        null,
        `admin call ${i + 1} must never be refused`
      )
      assert.equal(result.status, 200)
      assert.equal(result.retryAfter, null)
    }
  })

  test('an admin flood does not spend the public budget either', async () => {
    const headers = fromIp('41.58.6.2')
    await callTimes(READS * 2, {
      path: 'adminRead',
      type: 'query',
      headers,
      session: sessionFor('admin'),
    })

    const publicRead = await call({
      path: 'publicRead',
      type: 'query',
      headers,
      session: sessionFor('admin'),
    })
    assert.equal(publicRead.code, null)
  })

  test('an in-process caller, which is how a page prefetches', async () => {
    // apps/web/lib/trpc-server.tsx builds its context with `headers: null`.
    const results = await callTimes(READS * 2, {
      path: 'publicRead',
      type: 'query',
      overNetwork: false,
    })
    for (const result of results) assert.equal(result.code, null)
  })

  test('and a server render does not spend a visitor budget', async () => {
    await callTimes(READS * 2, {
      path: 'publicRead',
      type: 'query',
      overNetwork: false,
    })
    const visitor = await call({
      path: 'publicRead',
      type: 'query',
      headers: fromIp('41.58.7.1'),
    })
    assert.equal(visitor.code, null)
    assert.equal(
      rateLimitStore.size(),
      1,
      'a prefetch must not create a bucket at all'
    )
  })
})

describe('an unauthenticated caller on an admin procedure', () => {
  test('is refused for the right reason, and is not counted', async () => {
    const headers = fromIp('41.58.8.1')
    const results = await callTimes(WRITES * 5, {
      path: 'adminWrite',
      type: 'mutation',
      headers,
    })
    for (const result of results) {
      assert.equal(
        result.code,
        'UNAUTHORIZED',
        'the auth guard answers, not the brake'
      )
    }
    assert.equal(
      rateLimitStore.size(),
      0,
      'probing an admin endpoint must not create a rate-limit bucket'
    )
  })
})
