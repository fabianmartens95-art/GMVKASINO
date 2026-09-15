import pg from 'pg'
import { loadServerConfig } from '../server/config.js'
import { createPostgresPoolConfig } from '../server/index.js'
import { LedgerReconciler } from '../server/ledgerReconciliation.js'

const { Pool } = pg
const config = loadServerConfig(process.env)

if (!config.databaseUrl) {
  throw new Error('DATABASE_URL is required for ledger reconciliation')
}

const pool = new Pool(createPostgresPoolConfig(config))

try {
  const reconciler = new LedgerReconciler({ pool })
  const report = await reconciler.reconcile({
    assetCode: process.env.LEDGER_RECONCILE_ASSET || null,
  })

  console.log(JSON.stringify(report, null, 2))
  if (!report.ok) process.exitCode = 1
} finally {
  await pool.end()
}
