import { createTRPCRouter } from '../../trpc'

import { publicCheckoutRouter } from './checkout'
import { publicContestsRouter } from './contests'
import { publicEventsRouter } from './events'
import { publicVendorsRouter } from './vendors'
import { publicReviewsRouter } from './reviews'
import { publicVouchersRouter } from './vouchers'
import { publicFormsRouter } from './forms'
import { publicVoteBalanceRouter } from './vote-balance'
import { publicVoteCheckoutRouter } from './vote-checkout'
import { publicVoteFreeRouter } from './vote-free'

export const publicRouter = createTRPCRouter({
  checkout: publicCheckoutRouter,
  events: publicEventsRouter,
  vendors: publicVendorsRouter,
  reviews: publicReviewsRouter,
  vouchers: publicVouchersRouter,
  forms: publicFormsRouter,
  contests: publicContestsRouter,
  voteCheckout: publicVoteCheckoutRouter,
  voteBalance: publicVoteBalanceRouter,
  voteFree: publicVoteFreeRouter,
})

export type PublicRouter = typeof publicRouter
