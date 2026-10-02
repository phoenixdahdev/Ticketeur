// Flutterwave Standard v3 — minimal client wrapper.
// Docs: https://developer.flutterwave.com (v3 endpoints)
//
// The calls we use here:
//   1) POST /v3/payments  — create hosted-checkout link
//   2) GET  /v3/transactions/:id/verify — confirm a transaction
//   3) Webhook signature verification — header `verif-hash` must equal
//      our configured FLW_SECRET_HASH. Plus we always re-verify by id
//      before persisting the paid state to the DB.
//   4) GET  /v3/transactions/verify_by_reference and GET /v3/transactions
//      (by tx_ref) — the reconciliation job's lookups for pending orders,
//      which carry a tx_ref but no transaction id yet.

import { env } from '@ticketur/env/core'

const BASE_URL = 'https://api.flutterwave.com/v3'

export type FlutterwaveCustomer = {
  email: string
  name: string
  phonenumber?: string
}

export type FlutterwaveCustomization = {
  title?: string
  description?: string
  logo?: string
}

export type CreatePaymentInput = {
  txRef: string
  // Amount in major units (Naira). Flutterwave doesn't accept kobo.
  amount: number
  currency?: 'NGN'
  redirectUrl: string
  customer: FlutterwaveCustomer
  meta?: Record<string, string | number>
  customizations?: FlutterwaveCustomization
}

export type CreatePaymentResult = {
  link: string
}

type FlutterwaveCreatePaymentResponse = {
  status: 'success' | 'error'
  message: string
  data?: { link: string }
}

function requireSecret(): string {
  if (!env.FLW_SECRET_KEY) {
    throw new Error('FLW_SECRET_KEY is not configured')
  }
  return env.FLW_SECRET_KEY
}

export async function createPayment(
  input: CreatePaymentInput
): Promise<CreatePaymentResult> {
  const secret = requireSecret()

  const body = {
    tx_ref: input.txRef,
    amount: input.amount,
    currency: input.currency ?? 'NGN',
    redirect_url: input.redirectUrl,
    customer: input.customer,
    meta: input.meta ?? {},
    customizations: input.customizations,
    payment_options: 'card,banktransfer,ussd,account',
  }

  const res = await fetch(`${BASE_URL}/payments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const json = (await res.json()) as FlutterwaveCreatePaymentResponse
  if (!res.ok || json.status !== 'success' || !json.data?.link) {
    throw new Error(
      `Flutterwave create payment failed: ${json.message ?? res.statusText}`
    )
  }
  return { link: json.data.link }
}

// The parts of Flutterwave's transaction record we read. The verify endpoints
// return more (flw_ref, app_fee, amount_settled, payment_type, ...), passed
// through untyped.
export type FlutterwaveTransaction = {
  id: number
  tx_ref: string
  status: string
  // The transaction's amount in `currency`: what the charge was for. For
  // Flutterwave Standard that is the `amount` we sent to POST /payments; for a
  // charge someone initiates against our public key with our tx_ref, it is
  // whatever they chose — which is why fulfilment must check it. This is the
  // field to verify against the order: it is the one Flutterwave's
  // verification guide compares (`data.amount === expectedAmount` and
  // `data.currency === expectedCurrency`), and it does not move with who
  // bears Flutterwave's processing fee.
  amount: number
  // What the customer was debited: `amount` plus any Flutterwave fee passed on
  // to them, so it exceeds `amount` when the account makes customers bear
  // fees. Deliberately not used for verification. An equality check on it
  // would reject correctly paid orders on such an account, and a >= check
  // would accept a charge whose `amount` fell short by up to the fee. The
  // merchant's net (`amount_settled`, i.e. `amount` less `app_fee` when the
  // merchant bears the fee) can't be compared to the order total either.
  // Optional: only logged, for investigating a rejected charge.
  charged_amount?: number
  currency: string
  customer: {
    email: string
    name?: string
    phone_number?: string | null
  }
}

type FlutterwaveVerifyResponse = {
  status: 'success' | 'error'
  message: string
  data?: FlutterwaveTransaction
}

export async function verifyTransaction(
  transactionId: string | number,
  { signal }: { signal?: AbortSignal } = {}
): Promise<FlutterwaveTransaction | null> {
  const secret = requireSecret()
  // Encoded: the return page passes this straight from its query string, and
  // an unencoded "../" would point our secret-keyed request at another path.
  const id = encodeURIComponent(String(transactionId))
  const res = await fetch(`${BASE_URL}/transactions/${id}/verify`, {
    headers: { Authorization: `Bearer ${secret}` },
    signal,
  })
  const json = (await res.json()) as FlutterwaveVerifyResponse
  if (!res.ok || json.status !== 'success' || !json.data) {
    return null
  }
  return json.data
}

// The answer to "what does Flutterwave hold for this tx_ref?". It separates
// "Flutterwave answered" from "we got no answer", which a caller deciding
// whether to fail an order must never confuse.
export type ReferenceLookup =
  | { kind: 'found'; transaction: FlutterwaveTransaction }
  // Flutterwave answered with no transaction for the reference.
  | { kind: 'none'; httpStatus: number }
  // Our secret key was refused, so every lookup will fail the same way.
  | { kind: 'unauthorized'; httpStatus: number }
  // No usable answer: network error, timeout, rate limit, 5xx, bad body.
  | { kind: 'unavailable'; reason: string }

function describeFetchError(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err)
}

// GET /v3/transactions/verify_by_reference — verify by the tx_ref we set at
// checkout, for an order that has no transaction id yet.
export async function verifyTransactionByReference(
  txRef: string,
  { signal }: { signal?: AbortSignal } = {}
): Promise<ReferenceLookup> {
  const secret = requireSecret()
  const query = new URLSearchParams({ tx_ref: txRef })
  let res: Response
  try {
    res = await fetch(`${BASE_URL}/transactions/verify_by_reference?${query}`, {
      headers: { Authorization: `Bearer ${secret}` },
      signal,
    })
  } catch (err) {
    return { kind: 'unavailable', reason: describeFetchError(err) }
  }
  if (res.status === 401 || res.status === 403) {
    return { kind: 'unauthorized', httpStatus: res.status }
  }
  const json = (await res
    .json()
    .catch(() => null)) as FlutterwaveVerifyResponse | null
  if (res.ok && json?.status === 'success' && json.data) {
    return { kind: 'found', transaction: json.data }
  }
  // Flutterwave documents a failed lookup only as HTTP 400. A tx_ref with no
  // transaction (an abandoned checkout) is the expected cause, but not the
  // only possible one. That is safe because 'none' only ever leaves an order
  // pending: misreading some other 400 costs a re-check on the next run.
  if (res.status === 400 || res.status === 404) {
    return { kind: 'none', httpStatus: res.status }
  }
  return { kind: 'unavailable', reason: `HTTP ${res.status}` }
}

export type FlutterwaveChargeAttempt = Pick<
  FlutterwaveTransaction,
  'id' | 'tx_ref' | 'status' | 'amount' | 'currency'
>

export type AttemptsLookup =
  | {
      kind: 'found'
      attempts: FlutterwaveChargeAttempt[]
      // False when Flutterwave paged the result, or didn't say how many pages
      // it has. Then an attempt we didn't see may still exist.
      complete: boolean
    }
  | { kind: 'unauthorized'; httpStatus: number }
  | { kind: 'unavailable'; reason: string }

type FlutterwaveListResponse = {
  status: 'success' | 'error'
  message: string
  meta?: { page_info?: { total_pages?: number } }
  data?: FlutterwaveChargeAttempt[]
}

// GET /v3/transactions filtered by tx_ref: every charge attempt on one
// checkout. A buyer can retry a failed card on the same Flutterwave checkout,
// so one tx_ref can carry several attempts, and verify_by_reference returns
// only one of them. `from`/`to` are YYYY-MM-DD and bound the search window.
export async function listTransactionsByReference(
  txRef: string,
  { from, to, signal }: { from: string; to: string; signal?: AbortSignal }
): Promise<AttemptsLookup> {
  const secret = requireSecret()
  const query = new URLSearchParams({ tx_ref: txRef, from, to })
  let res: Response
  try {
    res = await fetch(`${BASE_URL}/transactions?${query}`, {
      headers: { Authorization: `Bearer ${secret}` },
      signal,
    })
  } catch (err) {
    return { kind: 'unavailable', reason: describeFetchError(err) }
  }
  if (res.status === 401 || res.status === 403) {
    return { kind: 'unauthorized', httpStatus: res.status }
  }
  const json = (await res
    .json()
    .catch(() => null)) as FlutterwaveListResponse | null
  if (!res.ok || json?.status !== 'success' || !Array.isArray(json.data)) {
    return { kind: 'unavailable', reason: `HTTP ${res.status}` }
  }
  const totalPages = json.meta?.page_info?.total_pages
  return {
    kind: 'found',
    attempts: json.data,
    complete: typeof totalPages === 'number' && totalPages <= 1,
  }
}

export function isWebhookSignatureValid(headerValue: string | null): boolean {
  if (!env.FLW_SECRET_HASH || !headerValue) return false
  return headerValue === env.FLW_SECRET_HASH
}
