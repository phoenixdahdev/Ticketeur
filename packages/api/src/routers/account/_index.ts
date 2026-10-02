import { createTRPCRouter } from '../../trpc'

import { accountProfileRouter } from './profile'
import { accountSubmissionsRouter } from './submissions'
import { accountTicketsRouter } from './tickets'

export const accountRouter = createTRPCRouter({
  profile: accountProfileRouter,
  submissions: accountSubmissionsRouter,
  tickets: accountTicketsRouter,
})

export type AccountRouter = typeof accountRouter
