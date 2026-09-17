import test from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { randomUUID } from 'node:crypto'
import { runMigrations } from '../server/migrations.js'

const { Pool } = pg
const databaseUrl = process.env.TEST_DATABASE_URL || ''

function integrationTest(name, fn) {
  test(name, { skip: !databaseUrl }, fn)
}

integrationTest('database migrations are tracked and idempotent', async () => {
  const pool = new Pool({ connectionString: databaseUrl })

  try {
    await runMigrations({ pool })
    const secondPass = await runMigrations({ pool })
    assert.deepEqual(secondPass, [])

    const result = await pool.query(
      `SELECT name
       FROM schema_migrations
       WHERE name IN (
         '001_demo_sessions.sql',
         '002_accounts_ledger.sql',
         '003_account_auth.sql',
         '004_remove_session_balance.sql',
         '005_account_roles.sql',
         '006_audit_events.sql',
         '007_game_rounds.sql',
         '008_sandbox_payments.sql'
       )
       ORDER BY name`,
    )
    assert.deepEqual(
      result.rows.map((row) => row.name),
      [
        '001_demo_sessions.sql',
        '002_accounts_ledger.sql',
        '003_account_auth.sql',
        '004_remove_session_balance.sql',
        '005_account_roles.sql',
        '006_audit_events.sql',
        '007_game_rounds.sql',
        '008_sandbox_payments.sql',
      ],
    )

    const legacyBalanceColumn = await pool.query(
      `SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'demo_sessions'
         AND column_name = 'balance'`,
    )
    assert.equal(legacyBalanceColumn.rowCount, 0)

    const gameRoundsTable = await pool.query(
      `SELECT 1
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = 'game_rounds'`,
    )
    assert.equal(gameRoundsTable.rowCount, 1)

    const paymentOperationsTable = await pool.query(
      `SELECT 1
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = 'payment_operations'`,
    )
    assert.equal(paymentOperationsTable.rowCount, 1)

    const paymentEventsTable = await pool.query(
      `SELECT 1
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = 'payment_events'`,
    )
    assert.equal(paymentEventsTable.rowCount, 1)

    const clearing = await pool.query(
      `SELECT asset_code, purpose, allow_negative
       FROM ledger_accounts
       WHERE id = 'sys_demo_payment_clearing'`,
    )
    assert.equal(clearing.rowCount, 1)
    assert.equal(clearing.rows[0].asset_code, 'DEMO')
    assert.equal(clearing.rows[0].purpose, 'payment_clearing')
    assert.equal(clearing.rows[0].allow_negative, true)

    const auditId = randomUUID()
    await pool.query(
      `INSERT INTO audit_events (id, event_type, occurred_at, account_id, data)
       VALUES ($1, 'test.audit', NOW(), NULL, '{}'::jsonb)`,
      [auditId],
    )
    await assert.rejects(
      pool.query(`UPDATE audit_events SET event_type = 'test.changed' WHERE id = $1`, [auditId]),
      /append-only/,
    )
    await assert.rejects(
      pool.query(`DELETE FROM audit_events WHERE id = $1`, [auditId]),
      /append-only/,
    )
  } finally {
    await pool.end()
  }
})

integrationTest('legacy M5 sessions preserve value and history across ledger bootstrap and balance-column removal', async () => {
  const admin = new Pool({ connectionString: databaseUrl })
  const schema = `legacy_m5_${process.pid}_${Date.now()}`
  let legacyPool

  try {
    await admin.query(`CREATE SCHEMA "${schema}"`)
    legacyPool = new Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${schema}`,
    })

    await legacyPool.query(`
      CREATE TABLE schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE demo_sessions (
        id TEXT PRIMARY KEY,
        player VARCHAR(40) NOT NULL DEFAULT '',
        balance NUMERIC(18,2) NOT NULL,
        spins BIGINT NOT NULL DEFAULT 0,
        created_at BIGINT NOT NULL,
        last_seen_at BIGINT NOT NULL
      );

      INSERT INTO schema_migrations (name) VALUES ('001_demo_sessions.sql');

      INSERT INTO demo_sessions (
        id, player, balance, spins, created_at, last_seen_at
      ) VALUES (
        'legacy-session-001', 'Legacy Player', 123.45, 7, 1000, 2000
      );
    `)

    const applied = await runMigrations({ pool: legacyPool })
    assert.deepEqual(applied, [
      '002_accounts_ledger.sql',
      '003_account_auth.sql',
      '004_remove_session_balance.sql',
      '005_account_roles.sql',
      '006_audit_events.sql',
      '007_game_rounds.sql',
      '008_sandbox_payments.sql',
    ])

    const session = await legacyPool.query(
      `SELECT id, account_id, player, spins, created_at, last_seen_at, auth_required
       FROM demo_sessions
       WHERE id = 'legacy-session-001'`,
    )
    assert.equal(session.rows[0].id, 'legacy-session-001')
    assert.equal(session.rows[0].player, 'Legacy Player')
    assert.equal(Number(session.rows[0].spins), 7)
    assert.equal(Number(session.rows[0].created_at), 1000)
    assert.equal(Number(session.rows[0].last_seen_at), 2000)
    assert.equal(session.rows[0].auth_required, false)
    assert.ok(session.rows[0].account_id)

    const account = await legacyPool.query(
      `SELECT display_name, status
       FROM accounts
       WHERE id = $1`,
      [session.rows[0].account_id],
    )
    assert.equal(account.rows[0].display_name, 'Legacy Player')
    assert.equal(account.rows[0].status, 'active')

    const roles = await legacyPool.query(
      `SELECT role
       FROM account_roles
       WHERE account_id = $1
       ORDER BY role`,
      [session.rows[0].account_id],
    )
    assert.deepEqual(roles.rows.map((row) => row.role), ['player'])

    const wallet = await legacyPool.query(
      `SELECT id, balance_atomic
       FROM ledger_accounts
       WHERE account_id = $1
         AND asset_code = 'DEMO'
         AND purpose = 'available'`,
      [session.rows[0].account_id],
    )
    assert.equal(wallet.rowCount, 1)
    assert.equal(wallet.rows[0].balance_atomic, '12345')

    const issuance = await legacyPool.query(
      `SELECT balance_atomic
       FROM ledger_accounts
       WHERE id = 'sys_demo_issuance'`,
    )
    assert.equal(issuance.rows[0].balance_atomic, '-12345')

    const initialCredit = await legacyPool.query(
      `SELECT id
       FROM ledger_transactions
       WHERE type = 'INITIAL_CREDIT'
         AND reference_type = 'demo_session'
         AND reference_id = 'legacy-session-001'`,
    )
    assert.equal(initialCredit.rowCount, 1)

    const entries = await legacyPool.query(
      `SELECT ledger_account_id, amount_atomic
       FROM ledger_entries
       WHERE transaction_id = $1
       ORDER BY ledger_account_id`,
      [initialCredit.rows[0].id],
    )
    assert.equal(entries.rowCount, 2)
    assert.equal(
      entries.rows.reduce((sum, row) => sum + BigInt(row.amount_atomic), 0n),
      0n,
    )

    const removedColumn = await admin.query(
      `SELECT 1
       FROM information_schema.columns
       WHERE table_schema = $1
         AND table_name = 'demo_sessions'
         AND column_name = 'balance'`,
      [schema],
    )
    assert.equal(removedColumn.rowCount, 0)

    const auditTable = await admin.query(
      `SELECT 1
       FROM information_schema.tables
       WHERE table_schema = $1
         AND table_name = 'audit_events'`,
      [schema],
    )
    assert.equal(auditTable.rowCount, 1)

    const gameRoundsTable = await admin.query(
      `SELECT 1
       FROM information_schema.tables
       WHERE table_schema = $1
         AND table_name = 'game_rounds'`,
      [schema],
    )
    assert.equal(gameRoundsTable.rowCount, 1)

    const paymentOperationsTable = await admin.query(
      `SELECT 1
       FROM information_schema.tables
       WHERE table_schema = $1
         AND table_name = 'payment_operations'`,
      [schema],
    )
    assert.equal(paymentOperationsTable.rowCount, 1)

    const secondPass = await runMigrations({ pool: legacyPool })
    assert.deepEqual(secondPass, [])
  } finally {
    await legacyPool?.end().catch(() => {})
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {})
    await admin.end()
  }
})