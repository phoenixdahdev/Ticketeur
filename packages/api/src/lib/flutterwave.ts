// Flutterwave Standard v3 — minimal client wrapper.
// Docs: https://developer.flutterwave.com (v3 endpoints)
//
// Three calls we use here:
//   1) POST /v3/payments  — create hosted-checkout link
//   2) GET  /v3/transactions/:id/verify — confirm a transaction
//   3) Webhook signature verification — header `verif-hash` must equal
//      our configured FLW_SECRET_HASH. Plus we always re-verify by id
//      before persisting the paid state to the DB.

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
  transactionId: string | number
): Promise<FlutterwaveTransaction | null> {
  const secret = requireSecret()
  // Encoded: the return page passes this straight from its query string, and
  // an unencoded "../" would point our secret-keyed request at another path.
  const id = encodeURIComponent(String(transactionId))
  const res = await fetch(`${BASE_URL}/transactions/${id}/verify`, {
    headers: { Authorization: `Bearer ${secret}` },
  })
  const json = (await res.json()) as FlutterwaveVerifyResponse
  if (!res.ok || json.status !== 'success' || !json.data) {
    return null
  }
  return json.data
}

export function isWebhookSignatureValid(headerValue: string | null): boolean {
  if (!env.FLW_SECRET_HASH || !headerValue) return false
  return headerValue === env.FLW_SECRET_HASH
}
