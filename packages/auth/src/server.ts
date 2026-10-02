import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin, twoFactor, emailOTP, oauthPopup } from 'better-auth/plugins'
import {
  dispatchPasswordReset,
  dispatchTwoFactorOtp,
  dispatchVerificationOtp,
  dispatchWelcome,
} from './notify'

import { db } from '@ticketur/db'
import { env } from '@ticketur/env/core'

import {
  ac,
  attendee,
  organizer,
  vendor,
  admin as adminRole,
} from './permissions'
import { userAdditionalFields } from './fields'

export function createAuth(cookiePrefix: string) {
  return betterAuth({
    appName: 'Ticketur',
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    database: drizzleAdapter(db, { provider: 'pg' }),

    emailVerification: {
      // Signup verification is owned by the emailOTP plugin below
      // (overrideDefaultEmailVerification + sendVerificationOnSignUp). Setting
      // sendOnSignUp here too would double up the signup email, so it's left off.
      autoSignInAfterVerification: true,
    },

    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      sendResetPassword: async ({ user, url }) => {
        await dispatchPasswordReset({
          email: user.email,
          name: user.name,
          resetUrl: url,
        })
      },
    },

    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        enabled: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
      },
    },

    plugins: [
      emailOTP({
        overrideDefaultEmailVerification: true,
        sendVerificationOnSignUp: true,
        otpLength: 6,
        expiresIn: 600,
        async sendVerificationOTP({ email, otp, type }) {
          await dispatchVerificationOtp({
            email,
            otp,
            type,
          })
        },
      }),
      twoFactor({
        issuer: 'Ticketur',
        otpOptions: {
          sendOTP: async ({ user, otp }) => {
            await dispatchTwoFactorOtp({
              email: user.email,
              otp,
            })
          },
        },
      }),
      admin({
        ac,
        roles: {
          attendee,
          organizer,
          vendor,
          admin: adminRole,
        },
        defaultRole: 'attendee',
        adminRoles: ['admin'],
      }),
      oauthPopup(),
    ],

    user: {
      additionalFields: userAdditionalFields,
    },

    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const allowed = ['attendee', 'organizer', 'vendor']
            const requested = (user as unknown as Record<string, unknown>)
              .requestedRole
            const candidate = typeof requested === 'string' ? requested : ''
            const role = allowed.includes(candidate) ? candidate : 'attendee'
            return { data: { ...user, role, vendorApprovalStatus: null } }
          },
          after: async (user) => {
            // Fire-and-forget: a failed welcome email must not fail signup,
            // but the rejection still has to be reported instead of unhandled.
            void dispatchWelcome({
              email: user.email,
              name: user.name,
            }).catch((error: unknown) => {
              console.error('[auth] welcome email failed', error)
            })
          },
        },
      },
    },

    advanced: {
      cookiePrefix,
    },
    // env.BETTER_AUTH_URL is optional in @ticketur/env/core (the Trigger.dev
    // worker loads that module without it), so drop it when it is unset.
    trustedOrigins: [...(env.APP_URLS ?? []), env.BETTER_AUTH_URL].filter(
      (origin): origin is string => origin !== undefined
    ),
  })
}

export type Auth = ReturnType<typeof createAuth>
export type Session = Awaited<ReturnType<Auth['api']['getSession']>>
