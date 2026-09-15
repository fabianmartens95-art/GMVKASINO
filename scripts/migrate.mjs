import { createPostgresPool } from '../server/postgresSessionRepository.js'
import { runMigrations } from '../server/migrations.js'

const connectionString = process.env.DATABASE_URL?.trim()
if (!connectionString) {
  console.error('DATABASE_URL is required for npm run db:migrate')
  process.exit(1)
}

const pool = createPostgresPool({ connectionString })

try {
  const applied = await runMigrations({ pool })
  if (applied.length === 0) {
    console.log('Database schema is already up to date')
  } else {
    console.log(`Applied migrations: ${applied.join(', ')}`)
  }
} finally {
  await pool.end()
}
