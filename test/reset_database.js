import { config } from '../dist/utils/config.js'
import { Pool } from 'pg'

const pgConfig = {
  connectionString: config.postgres.connectionString,
  max: 5,
  idleTimeoutMillis: 10_000
}

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

export async function resetDatabase() {
  const pool = new Pool(pgConfig)
  try {
    await pool.query('DROP TABLE IF EXISTS waifu2x_tasks')
    await pool.query(TABLE_DDL)
    const { rows } = await pool.query('SELECT COUNT(*)::INTEGER AS count FROM waifu2x_tasks')
    console.log(`[reset_database] waifu2x_tasks 已重建，当前记录数=${rows[0].count}`)
  } catch (error) {
    console.error('[reset_database] 重置失败', error)
    throw error
  } finally {
    await pool.end()
  }
}

if (import.meta.main) {
  resetDatabase().then(() => {
    process.exit(0)
  }).catch(() => {
    process.exit(1)
  })
}
