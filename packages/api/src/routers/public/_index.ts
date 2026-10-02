import { createTRPCRouter } from '../../trpc'

import { publicCheckoutRouter } from './checkout'
import { publicEventsRouter } from './events'
import { publicVendorsRouter } from './vendors'
import { publicReviewsRouter } from './reviews'
import { publicVouchersRouter } from './vouchers'
import { publicFormsRouter } from './forms'

export const publicRouter = createTRPCRouter({
  checkout: publicCheckoutRouter,
  events: publicEventsRouter,
  vendors: publicVendorsRouter,
  reviews: publicReviewsRouter,
  vouchers: publicVouchersRouter,
  forms: publicFormsRouter,
})

export type PublicRouter = typeof publicRouter
