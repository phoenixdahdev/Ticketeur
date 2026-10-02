import 'dotenv/config'
import { z } from 'zod'
import { createEnv } from '@t3-oss/env-core'

// Shared server env for every Node-side consumer: @ticketur/db, @ticketur/auth,
// @ticketur/api, @ticketur/observability, the two Next.js apps that pull those
// in, and the Trigger.dev worker in @ticketur/jobs (which reaches this module
// through @ticketur/db and src/utils/resend.ts).
//
// Because one module serves all of them, only a variable that *every* one of
// those environments provisions can be declared required: a required variable
// that a single environment lacks makes this module throw on import in that
// environment. Each package's .env.example documents the set it ships with.
export const env = createEnv({
  server: {
    // Required in every environment that loads this module.
    DATABASE_URL: z.string().min(1),
    // Better Auth is configured by the two Next.js apps only; the Trigger.dev
    // worker does not provision these (see packages/jobs/.env.example). They
    // are still shape-checked whenever they are set.
    BETTER_AUTH_SECRET: z.string().min(32).optional(),
    BETTER_AUTH_URL: z.url().optional(),
    BETTER_AUTH_API_KEY: z.string().optional(),
    APP_URLS: z
      .string()
      .default('http://localhost:3000')
      .transform((val) => val.split(',').map((url) => url.trim())),
    GOOGLE_CLIENT_ID: z.string().optional().default(''),
    GOOGLE_CLIENT_SECRET: z.string().optional().default(''),
    RESEND_API_KEY: z.string().min(1),
    // The Trigger.dev worker environment receives Trigger's own TRIGGER_PROJECT_REF
    // rather than this project id (packages/jobs/trigger.config.ts resolves the ref
    // from either), so it is not provisioned in every environment and cannot be
    // required here.
    TRIGGER_PROJECT_ID: z.string().min(1).optional(),
    TRIGGER_SECRET_KEY: z.string().optional(),
    BLOB_READ_WRITE_TOKEN: z.string().optional(),
    FLW_PUBLIC_KEY: z.string().optional(),
    FLW_SECRET_KEY: z.string().optional(),
    FLW_SECRET_HASH: z.string().optional(),
    // Shared by the web app and the Trigger.dev worker: the worker's scheduled
    // `reconcile-pending-orders` task sends it as a bearer token to the web
    // app's /api/cron/reconcile-orders. The route enforces a minimum length
    // rather than this schema, so a malformed value fails that one route
    // closed instead of every consumer of this module on import.
    CRON_SECRET: z.string().optional(),
    // Axiom observability (OpenTelemetry traces + structured logs). Optional
    // so local dev and CI builds without Axiom configured are a graceful no-op.
    AXIOM_TOKEN: z.string().optional(),
    AXIOM_DATASET: z.string().optional(),
    AXIOM_HOST: z.string().default('api.axiom.co'),
    NODE_ENV: z
      .enum(['development', 'production', 'test'])
      .default('development'),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
})
