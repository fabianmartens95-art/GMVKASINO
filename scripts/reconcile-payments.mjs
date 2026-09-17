import pg from 'pg'
import { loadServerConfig } from '../server/config.js'
import { createPostgresPoolConfig } from '../server/index.js'
import { PaymentReconciler } from '../server/paymentReconciliation.js'

const { Pool } = pg
const config = loadServerConfig(process.env)

if (!config.databaseUrl) {
  throw new Error('DATABASE_URL is required for payment reconciliation')
}

const pool = new Pool(createPostgresPoolConfig(config))

try {
  const report = await new PaymentReconciler({ pool }).reconcile()
  console.log(JSON.stringify(report, null, 2))
  if (!report.ok) process.exitCode = 1
} finally {
  await pool.end()
}
