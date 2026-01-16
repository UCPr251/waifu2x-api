import { Pool, type PoolConfig } from 'pg'
import { config } from '../utils/config.js'

let pool: Pool | null = null

const TABLE_DDL = `
CREATE TABLE IF NOT EXISTS waifu2x_tasks (
  id BIGSERIAL PRIMARY KEY,
  task_id TEXT UNIQUE NOT NULL,
  file_uid TEXT NOT NULL,
  cache_key TEXT NOT NULL,
  source_key TEXT NOT NULL,
  cid TEXT NOT NULL,
  image_hash TEXT NOT NULL,
  params JSONB NOT NULL,
  status TEXT NOT NULL,
  input_path TEXT NOT NULL,
  output_path TEXT,
  format TEXT NOT NULL,
  file_size BIGINT,
  error TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_waifu2x_tasks_cache_key ON waifu2x_tasks(cache_key);
CREATE INDEX IF NOT EXISTS idx_waifu2x_tasks_status ON waifu2x_tasks(status);
`

export async function initDatabase(): Promise<Pool> {
  if (pool) return pool

  const { connectionString, ssl } = config.postgres || {}
  if (!connectionString) {
    throw new Error('PostgreSQL connectionString is not configured')
  }

  const pgConfig: PoolConfig = { connectionString }
  if (ssl) {
    pgConfig.ssl = typeof ssl === 'object' ? ssl : { rejectUnauthorized: false }
  }

  pool = new Pool(pgConfig)
  await pool.query(TABLE_DDL)
  logger.info('PostgreSQL schema ready')
  return pool
}

export function getPool(): Pool {
  if (!pool) {
    throw new Error('Database pool has not been initialised')
  }
  return pool
}
