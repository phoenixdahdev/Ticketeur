import { createTRPCRouter } from '../../trpc'

import { publicCheckoutRouter } from './checkout'
import { publicContestsRouter } from './contests'
import { publicEventsRouter } from './events'
import { publicVendorsRouter } from './vendors'
import { publicReviewsRouter } from './reviews'
import { publicVouchersRouter } from './vouchers'
import { publicFormsRouter } from './forms'
import { publicVoteCheckoutRouter } from './vote-checkout'

export const publicRouter = createTRPCRouter({
  checkout: publicCheckoutRouter,
  events: publicEventsRouter,
  vendors: publicVendorsRouter,
  reviews: publicReviewsRouter,
  vouchers: publicVouchersRouter,
  forms: publicFormsRouter,
  contests: publicContestsRouter,
  voteCheckout: publicVoteCheckoutRouter,
})

export type PublicRouter = typeof publicRouter
