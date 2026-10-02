import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server'
import { createTRPCRouter } from '../trpc'

import { dashboardRouter } from './dashboard'
import { eventsRouter } from './events'
import { vendorsRouter } from './vendors'
import { orgProfileRouter } from './org/profile'
import { orgVouchersRouter } from './org/vouchers'
import { orgFormsRouter } from './org/forms'
import { vendorRouter } from './vendor/_index'
import { publicRouter } from './public/_index'
import { accountRouter } from './account/_index'
import { adminRouter } from './admin/_index'

export const appRouter = createTRPCRouter({
  org: createTRPCRouter({
    dashboard: dashboardRouter,
    events: eventsRouter,
    vendors: vendorsRouter,
    profile: orgProfileRouter,
    vouchers: orgVouchersRouter,
    forms: orgFormsRouter,
  }),
  vendor: vendorRouter,
  public: publicRouter,
  account: accountRouter,
  admin: adminRouter,
})

export type AppRouter = typeof appRouter
export type RouterInputs = inferRouterInputs<AppRouter>
export type RouterOutputs = inferRouterOutputs<AppRouter>
