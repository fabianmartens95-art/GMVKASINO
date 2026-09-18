export class PlayerDirectoryError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'PlayerDirectoryError'
    this.code = code
    this.status = 400
  }
}

function normalizeQuery(value) {
  if (typeof value !== 'string') {
    throw new PlayerDirectoryError('INVALID_PLAYER_QUERY', 'Player lookup query is required')
  }
  const query = value.trim()
  if (query.length < 2 || query.length > 64) {
    throw new PlayerDirectoryError('INVALID_PLAYER_QUERY', 'Player lookup query must be between 2 and 64 characters')
  }
  return query
}

function normalizeLimit(value) {
  if (value === undefined || value === null || value === '') return 10
  const limit = Number(value)
  if (!Number.isInteger(limit) || limit < 1 || limit > 25) {
    throw new PlayerDirectoryError('INVALID_PLAYER_LIMIT', 'Player lookup limit must be an integer between 1 and 25')
  }
  return limit
}

export class PlayerDirectory {
  constructor({ pool } = {}) {
    if (!pool) throw new Error('PlayerDirectory requires a pool')
    this.pool = pool
  }

  async search({ query, limit } = {}) {
    const normalizedQuery = normalizeQuery(query)
    const safeLimit = normalizeLimit(limit)

    const result = await this.pool.query(
      `SELECT
         a.id,
         a.display_name,
         a.status,
         a.created_at
       FROM accounts a
       WHERE EXISTS (
         SELECT 1
         FROM account_roles ar
         WHERE ar.account_id = a.id
           AND ar.role = 'player'
       )
         AND (
           a.id = $1
           OR LEFT(LOWER(COALESCE(a.display_name, '')), LENGTH(LOWER($1))) = LOWER($1)
         )
       ORDER BY
         CASE WHEN a.id = $1 THEN 0 ELSE 1 END,
         LOWER(COALESCE(a.display_name, '')),
         a.id
       LIMIT $2`,
      [normalizedQuery, safeLimit],
    )

    return result.rows.map((row) => ({
      id: row.id,
      displayName: row.display_name || '',
      status: row.status,
      createdAt: Number(row.created_at),
    }))
  }
}
