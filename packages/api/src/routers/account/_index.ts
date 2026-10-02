import { createTRPCRouter } from '../../trpc'

import { accountProfileRouter } from './profile'
import { accountTicketsRouter } from './tickets'

export const accountRouter = createTRPCRouter({
  profile: accountProfileRouter,
  tickets: accountTicketsRouter,
})

export type AccountRouter = typeof accountRouter
