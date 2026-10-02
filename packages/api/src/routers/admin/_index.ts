import { createTRPCRouter } from '../../trpc'

import { adminUsersRouter } from './users'
import { adminEventsRouter } from './events'
import { adminTransactionsRouter } from './transactions'
import { adminModerationRouter } from './moderation'
import { adminOverviewRouter } from './overview'
import { adminVouchersRouter } from './vouchers'
import { adminEmailsRouter } from './emails'
import { adminPaymentDiscrepanciesRouter } from './payment-discrepancies'

export const adminRouter = createTRPCRouter({
  users: adminUsersRouter,
  events: adminEventsRouter,
  transactions: adminTransactionsRouter,
  moderation: adminModerationRouter,
  overview: adminOverviewRouter,
  vouchers: adminVouchersRouter,
  emails: adminEmailsRouter,
  paymentDiscrepancies: adminPaymentDiscrepanciesRouter,
})
