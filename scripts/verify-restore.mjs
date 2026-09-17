import pg from 'pg'
import { runMigrations } from '../server/migrations.js'
import { LedgerReconciler } from '../server/ledgerReconciliation.js'

const { Pool } = pg

const SOURCE_DATABASE_URL = process.env.DATABASE_URL || ''
const RESTORE_DATABASE_URL = process.env.RESTORE_DATABASE_URL || ''
const ASSET_CODE = (process.env.LEDGER_RECONCILE_ASSET || 'DEMO').trim().toUpperCase()

const TABLES = Object.freeze([
  'schema_migrations',
  'accounts',
  'account_roles',
  'assets',
  'ledger_accounts',
  'ledger_transactions',
  'ledger_entries',
  'demo_sessions',
  'auth_sessions',
  'audit_events',
  'game_rounds',
])

function requireUrl(value, name) {
  if (!value) throw new Error(`${name} is required`)
  return value
}

async function tableCount(pool, tableName) {
  if (!TABLES.includes(tableName)) throw new Error(`Table is not allowlisted: ${tableName}`)
  const result = await pool.query(`SELECT COUNT(*)::int AS count FROM ${tableName}`)
  return Number(result.rows[0].count)
}

async function collectCounts(pool) {
  const counts = {}
  for (const tableName of TABLES) {
    counts[tableName] = await tableCount(pool, tableName)
  }
  return counts
}

function compareCounts(sourceCounts, restoredCounts) {
  const mismatches = []
  for (const tableName of TABLES) {
    if (sourceCounts[tableName] !== restoredCounts[tableName]) {
      mismatches.push({
        table: tableName,
        source: sourceCounts[tableName],
        restored: restoredCounts[tableName],
      })
    }
  }
  return mismatches
}

async function legacyBalanceColumnExists(pool) {
  const result = await pool.query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'demo_sessions'
       AND column_name = 'balance'`,
  )
  return result.rowCount > 0
}

async function main() {
  const sourcePool = new Pool({ connectionString: requireUrl(SOURCE_DATABASE_URL, 'DATABASE_URL') })
  const restoredPool = new Pool({ connectionString: requireUrl(RESTORE_DATABASE_URL, 'RESTORE_DATABASE_URL') })

  try {
    const migrationsAppliedAfterRestore = await runMigrations({ pool: restoredPool })
    if (migrationsAppliedAfterRestore.length !== 0) {
      throw new Error(`Restored database was not migration-complete: ${migrationsAppliedAfterRestore.join(', ')}`)
    }

    const [sourceCounts, restoredCounts] = await Promise.all([
      collectCounts(sourcePool),
      collectCounts(restoredPool),
    ])
    const countMismatches = compareCounts(sourceCounts, restoredCounts)
    if (countMismatches.length > 0) {
      throw new Error(`Restored database row-count mismatch: ${JSON.stringify(countMismatches)}`)
    }

    if (await legacyBalanceColumnExists(restoredPool)) {
      throw new Error('Restored database unexpectedly contains demo_sessions.balance')
    }

    const reconciliation = await new LedgerReconciler({ pool: restoredPool }).reconcile({
      assetCode: ASSET_CODE,
    })
    if (!reconciliation.ok) {
      throw new Error(`Restored ledger reconciliation failed: ${JSON.stringify({
        accountMismatches: reconciliation.accountMismatches,
        transactionMismatches: reconciliation.transactionMismatches,
        assetMismatches: reconciliation.assetMismatches,
      })}`)
    }

    console.log(JSON.stringify({
      ok: true,
      tablesCompared: TABLES.length,
      counts: restoredCounts,
      reconciliation: {
        assetCode: reconciliation.assetCode,
        accountsChecked: reconciliation.accountsChecked,
        transactionsChecked: reconciliation.transactionsChecked,
        assetsChecked: reconciliation.assetsChecked,
      },
    }))
  } finally {
    await Promise.allSettled([sourcePool.end(), restoredPool.end()])
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error?.message || 'Restore verification failed',
  }))
  process.exitCode = 1
})
