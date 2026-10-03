import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  clientIpFromHeaders,
  createRateLimitStore,
  rateLimitKey,
  rateLimitMessage,
  rateLimitedRetryAfter,
  RateLimitedError,
  type RateLimitPolicy,
} from './rate-limit'

const MINUTE = 60_000
const THREE_PER_MINUTE: RateLimitPolicy = { limit: 3, windowMs: MINUTE }

describe('the token bucket', () => {
  test('admits a caller up to the limit, then holds them back', () => {
    const store = createRateLimitStore()
    const t0 = 1_000_000

    for (let i = 0; i < 3; i++) {
      assert.equal(
        store.take('k', THREE_PER_MINUTE, t0).allowed,
        true,
        `call ${i + 1} of 3 should pass`
      )
    }

    const refused = store.take('k', THREE_PER_MINUTE, t0)
    assert.equal(refused.allowed, false)
    assert.ok(refused.allowed === false)
    assert.ok(refused.retryAfterSeconds >= 1)
    // One token back in a third of a minute.
    assert.equal(refused.retryAfterSeconds, 20)
  })

  test('the budget comes back as the window passes', () => {
    const store = createRateLimitStore()
    const t0 = 0
    for (let i = 0; i < 3; i++) store.take('k', THREE_PER_MINUTE, t0)
    assert.equal(store.take('k', THREE_PER_MINUTE, t0).allowed, false)

    // Exactly one token's worth of time: one more call, and only one.
    const oneToken = MINUTE / 3
    assert.equal(store.take('k', THREE_PER_MINUTE, t0 + oneToken).allowed, true)
    assert.equal(
      store.take('k', THREE_PER_MINUTE, t0 + oneToken).allowed,
      false
    )

    // A whole window later the bucket is full again, and no fuller.
    for (let i = 0; i < 3; i++) {
      assert.equal(
        store.take('k', THREE_PER_MINUTE, t0 + 10 * MINUTE).allowed,
        true,
        `call ${i + 1} after a long idle should pass`
      )
    }
    assert.equal(
      store.take('k', THREE_PER_MINUTE, t0 + 10 * MINUTE).allowed,
      false,
      'the bucket must not refill past its capacity'
    )
  })

  test('two callers do not share a budget', () => {
    const store = createRateLimitStore()
    for (let i = 0; i < 3; i++) store.take('alice', THREE_PER_MINUTE, 0)
    assert.equal(store.take('alice', THREE_PER_MINUTE, 0).allowed, false)
    assert.equal(
      store.take('bob', THREE_PER_MINUTE, 0).allowed,
      true,
      "alice's flood must not spend bob's budget"
    )
  })

  test('a refused call does not spend a token', () => {
    const store = createRateLimitStore()
    for (let i = 0; i < 3; i++) store.take('k', THREE_PER_MINUTE, 0)

    // Hammer it while refused. If refusals were charged, the debt would grow
    // and the caller would never get back in.
    for (let i = 0; i < 500; i++) store.take('k', THREE_PER_MINUTE, 0)

    const after = store.take('k', THREE_PER_MINUTE, MINUTE / 3)
    assert.equal(
      after.allowed,
      true,
      'one token of time must still buy one call after 500 refusals'
    )
  })

  test('the first refusal of a run is flagged, the rest are not', () => {
    const store = createRateLimitStore()
    for (let i = 0; i < 3; i++) store.take('k', THREE_PER_MINUTE, 0)

    const first = store.take('k', THREE_PER_MINUTE, 0)
    assert.ok(first.allowed === false)
    assert.equal(first.firstRefusal, true)

    for (let i = 0; i < 10; i++) {
      const next = store.take('k', THREE_PER_MINUTE, 0)
      assert.ok(next.allowed === false)
      assert.equal(next.firstRefusal, false, 'a flood must log once, not 10x')
    }

    // Allowed again, then refused again: that is a new run.
    assert.equal(store.take('k', THREE_PER_MINUTE, MINUTE / 3).allowed, true)
    const newRun = store.take('k', THREE_PER_MINUTE, MINUTE / 3)
    assert.ok(newRun.allowed === false)
    assert.equal(newRun.firstRefusal, true)
  })

  test('a clock that jumps backwards cannot hand out tokens', () => {
    const store = createRateLimitStore()
    for (let i = 0; i < 3; i++) store.take('k', THREE_PER_MINUTE, 10 * MINUTE)
    assert.equal(store.take('k', THREE_PER_MINUTE, 10 * MINUTE).allowed, false)
    assert.equal(
      store.take('k', THREE_PER_MINUTE, 0).allowed,
      false,
      'time running backwards must withhold a refill, never grant one'
    )
  })

  test('memory is bounded, and the hot bucket survives eviction', () => {
    const store = createRateLimitStore({ maxKeys: 10 })

    // Spend 'hot' down to nothing.
    for (let i = 0; i < 3; i++) store.take('hot', THREE_PER_MINUTE, 0)
    assert.equal(store.take('hot', THREE_PER_MINUTE, 0).allowed, false)

    // 50 one-shot keys go through, each touching 'hot' again so it stays the
    // most recently used — which is exactly what a caller being throttled
    // looks like.
    for (let i = 0; i < 50; i++) {
      store.take(`drive-by-${i}`, THREE_PER_MINUTE, 0)
      store.take('hot', THREE_PER_MINUTE, 0)
      assert.ok(store.size() <= 10, 'the store must stay bounded')
    }

    assert.equal(
      store.take('hot', THREE_PER_MINUTE, 0).allowed,
      false,
      'the bucket doing the work must not be the one evicted'
    )

    // And the bound really is LEAST-recently-used, not some other order: the
    // newest drive-by is still resident, so it has only the two tokens it did
    // not spend, rather than a full bucket.
    assert.equal(store.take('drive-by-49', THREE_PER_MINUTE, 0).allowed, true)
    assert.equal(store.take('drive-by-49', THREE_PER_MINUTE, 0).allowed, true)
    assert.equal(
      store.take('drive-by-49', THREE_PER_MINUTE, 0).allowed,
      false,
      'the most recently seen key must be one of the ones kept'
    )
  })
})

describe('reads and writes are separate budgets', () => {
  test('exhausting one leaves the other alone', () => {
    const store = createRateLimitStore()
    const read: RateLimitPolicy = { limit: 10, windowMs: MINUTE }
    const write: RateLimitPolicy = { limit: 2, windowMs: MINUTE }
    const headers = new Headers({ 'x-forwarded-for': '41.58.1.1' })

    const readKey = rateLimitKey({ kind: 'read', headers, userId: null })
    const writeKey = rateLimitKey({ kind: 'write', headers, userId: null })
    assert.notEqual(readKey, writeKey)

    for (let i = 0; i < 2; i++) store.take(writeKey, write, 0)
    assert.equal(store.take(writeKey, write, 0).allowed, false)
    assert.equal(
      store.take(readKey, read, 0).allowed,
      true,
      'a spent write budget must not stop the caller reading'
    )
  })
})

describe('which caller a call is charged to', () => {
  test("Vercel's own header wins, and cannot be forged from outside", () => {
    const headers = new Headers({
      'x-vercel-forwarded-for': '41.58.1.1',
      'x-real-ip': '10.0.0.9',
      'x-forwarded-for': '203.0.113.5',
    })
    assert.equal(clientIpFromHeaders(headers), '41.58.1.1')
  })

  test('x-forwarded-for is read from the END, not the start', () => {
    // What a spoofing caller sends, once the edge has appended the address it
    // actually accepted the connection from. Reading the first entry would
    // let the caller choose their own bucket; reading the last cannot.
    const headers = new Headers({
      'x-forwarded-for': '1.1.1.1, 2.2.2.2, 41.58.1.1',
    })
    assert.equal(clientIpFromHeaders(headers), '41.58.1.1')
  })

  test('a spoofed header cannot move a caller off their own bucket', () => {
    const honest = new Headers({ 'x-forwarded-for': '41.58.1.1' })
    const spoofed = new Headers({
      'x-forwarded-for': 'not-an-ip, 41.58.1.1',
    })
    assert.equal(
      rateLimitKey({ kind: 'read', headers: honest, userId: null }),
      rateLimitKey({ kind: 'read', headers: spoofed, userId: null })
    )
  })

  test('a duplicated header collapses to the same answer', () => {
    // Fetch Headers join repeated headers with ", ", so two copies look like
    // one list — and the edge's entry is still the last one.
    const headers = new Headers()
    headers.append('x-forwarded-for', '9.9.9.9')
    headers.append('x-forwarded-for', '41.58.1.1')
    assert.equal(clientIpFromHeaders(headers), '41.58.1.1')
  })

  test('blank and whitespace-only entries are ignored', () => {
    const headers = new Headers({ 'x-forwarded-for': '41.58.1.1, , ' })
    assert.equal(clientIpFromHeaders(headers), '41.58.1.1')
  })

  test('no forwarding header at all means no address', () => {
    assert.equal(clientIpFromHeaders(new Headers()), null)
  })

  test('a keyless caller lands in one shared bucket, never in none', () => {
    const key = rateLimitKey({
      kind: 'read',
      headers: new Headers(),
      userId: null,
    })
    assert.equal(key, 'read:unattributed')
    // Everyone unattributed shares it: the brake degrades to a global cap
    // rather than disappearing for anyone who can strip a header.
    assert.equal(
      rateLimitKey({
        kind: 'read',
        headers: new Headers({ 'user-agent': 'curl' }),
        userId: null,
      }),
      key
    )
  })

  test('a signed-in caller is keyed by account, not by address', () => {
    // Carrier NAT puts a great many real phones behind one address; the
    // account is both the better identity and the fairer budget.
    const nat = new Headers({ 'x-forwarded-for': '41.58.1.1' })
    const alice = rateLimitKey({ kind: 'read', headers: nat, userId: 'u_a' })
    const bob = rateLimitKey({ kind: 'read', headers: nat, userId: 'u_b' })
    assert.notEqual(alice, bob)
    assert.match(alice, /user:u_a$/)
  })
})

describe('what the caller is told', () => {
  test('the message names the wait and what to do about it', () => {
    assert.equal(
      rateLimitMessage('read', 20),
      'Too many requests from your network. Wait 20 seconds and reload the page.'
    )
    assert.equal(
      rateLimitMessage('write', 1),
      'Too many requests from your network. Wait 1 second and try again.'
    )
  })

  test('the wait survives being carried as an error cause', () => {
    const error = { cause: new RateLimitedError(17) }
    assert.equal(rateLimitedRetryAfter(error), 17)
  })

  test('an unrelated error is not mistaken for a refusal', () => {
    assert.equal(rateLimitedRetryAfter(new Error('nope')), null)
    assert.equal(rateLimitedRetryAfter({ cause: new Error('nope') }), null)
    assert.equal(rateLimitedRetryAfter(null), null)
    assert.equal(rateLimitedRetryAfter({ cause: 'RateLimitedError' }), null)
  })
})
