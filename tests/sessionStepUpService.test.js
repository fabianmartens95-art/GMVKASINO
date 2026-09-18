import test from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { runMigrations } from '../server/migrations.js'
import { AccountAuthService } from '../server/accountAuthService.js'
import { SessionStepUpService, SessionStepUpError } from '../server/sessionStepUpService.js'

const { Pool } = pg
const databaseUrl = process.env.TEST_DATABASE_URL || ''

function integrationTest(name, fn) {
  test(name, { skip: !databaseUrl }, fn)
}


integrationTest('trusted verifier upgrades only the active current session to MFA assurance', async () => {
  const pool = new Pool({ connectionString: databaseUrl })
  let now = 50_000

  try {
    await runMigrations({ pool })
    const auth = new AccountAuthService({ pool, startingBalance: 1000, now: () => now })
    const registered = await auth.register({
      email: `stepup-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      password: 'step-up-password-123',
    })

    await pool.query(
      `UPDATE accounts
       SET email_verified_at = $2,
           mfa_enrolled_at = $2
       WHERE id = $1`,
      [registered.account.id, now],
    )

    const calls = []
    const stepUp = new SessionStepUpService({
      pool,
      now: () => now,
      verifier: {
        async verify(input) {
          calls.push(input)
          return { verified: true, assurance: 'mfa' }
        },
      },
    })

    now += 1000
    const result = await stepUp.verifyAndUpgrade({
      token: registered.auth.token,
      proof: { challengeResponse: 'opaque-proof' },
      requestId: 'step-up-request-001',
    })

    assert.deepEqual(result.assurance, { level: 'mfa', verifiedAt: now })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].accountId, registered.account.id)
    assert.deepEqual(calls[0].currentAssurance, { level: 'base', verifiedAt: null })

    const profile = await auth.profile(registered.auth.token)
    assert.equal(profile.assurance.level, 'mfa')
    assert.equal(profile.assurance.verifiedAt, now)
  } finally {
    await pool.end()
  }
})

integrationTest('failed verifier and assurance downgrade leave persisted session state unchanged', async () => {
  const pool = new Pool({ connectionString: databaseUrl })
  let now = 70_000

  try {
    await runMigrations({ pool })
    const auth = new AccountAuthService({ pool, startingBalance: 1000, now: () => now })
    const registered = await auth.register({
      email: `stepup-fail-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      password: 'step-up-password-456',
    })

    const rejecting = new SessionStepUpService({
      pool,
      now: () => now,
      verifier: { async verify() { return { verified: false } } },
    })

    await assert.rejects(
      rejecting.verifyAndUpgrade({
        token: registered.auth.token,
        proof: 'bad-proof',
      }),
      (error) => error instanceof SessionStepUpError
        && error.code === 'STEP_UP_VERIFICATION_FAILED',
    )

    assert.deepEqual((await auth.profile(registered.auth.token)).assurance, {
      level: 'base',
      verifiedAt: null,
    })

    await pool.query(
      `UPDATE accounts
       SET email_verified_at = $2,
           mfa_enrolled_at = $2
       WHERE id = $1`,
      [registered.account.id, now],
    )
    await pool.query(
      `UPDATE auth_sessions
       SET assurance_level = 'mfa',
           assurance_at = $2
       WHERE account_id = $1`,
      [registered.account.id, now],
    )

    const downgrade = new SessionStepUpService({
      pool,
      now: () => now + 1,
      verifier: { async verify() { return { verified: true, assurance: 'verified_email' } } },
    })

    await assert.rejects(
      downgrade.verifyAndUpgrade({
        token: registered.auth.token,
        proof: 'valid-but-weaker-proof',
      }),
      (error) => error instanceof SessionStepUpError
        && error.code === 'ASSURANCE_DOWNGRADE_REJECTED',
    )

    assert.equal((await auth.profile(registered.auth.token)).assurance.level, 'mfa')
  } finally {
    await pool.end()
  }
})
