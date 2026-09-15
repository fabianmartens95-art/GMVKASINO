import pg from 'pg'
import { runMigrations } from '../server/migrations.js'

const { Pool } = pg
const connectionString = process.env.DATABASE_URL?.trim()

if (!connectionString) {
  console.error('DATABASE_URL is required for npm run db:migrate')
  process.exit(1)
}

const sslEnabled = /^(1|true|yes|on)$/i.test(process.env.DATABASE_SSL || '')
const ca = process.env.DATABASE_SSL_CA?.trim()
const pool = new Pool({
  connectionString,
  ...(sslEnabled
    ? {
        ssl: {
          rejectUnauthorized: true,
          ...(ca ? { ca } : {}),
        },
      }
    : {}),
})

try {
  const applied = await runMigrations({ pool })
  console.log(applied.length > 0
    ? `Applied migrations: ${applied.join(', ')}`
    : 'Database schema is already up to date')
} finally {
  await pool.end()
}
