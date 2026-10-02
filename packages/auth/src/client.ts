import { createAuthClient } from 'better-auth/react'
import {
  adminClient,
  twoFactorClient,
  emailOTPClient,
  inferAdditionalFields,
  oauthPopupClient,
} from 'better-auth/client/plugins'

import {
  ac,
  attendee,
  organizer,
  vendor,
  admin as adminRole,
} from './permissions'
import { userAdditionalFields } from './fields'

import type {
  InferSignUpEmailCtx,
  InferUserUpdateCtx,
} from 'better-auth/client'

export type PortabilityAnchors = [
  InferSignUpEmailCtx<never, never>,
  InferUserUpdateCtx<never, never>,
]

export function createClient(baseURL: string) {
  return createAuthClient({
    baseURL,
    plugins: [
      inferAdditionalFields({ user: userAdditionalFields }),
      emailOTPClient(),
      twoFactorClient({
        twoFactorPage: '/two-factor',
      }),
      adminClient({
        ac,
        roles: {
          attendee,
          organizer,
          vendor,
          admin: adminRole,
        },
      }),
      oauthPopupClient(),
    ],
  })
}

export type AuthClient = ReturnType<typeof createClient>
