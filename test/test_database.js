import { config } from '../dist/utils/config.js'
import { Pool } from 'pg'

// 基础格式：postgres://用户名:密码@主机:端口/数据库名
const pgConfig = {
  connectionString: config.postgres.connectionString,
  max: 5,
  idleTimeoutMillis: 10_000
}

const pool = new Pool(pgConfig)

async function testPool() {
  try {
    const res = await pool.query('SELECT * FROM waifu2x_tasks')

    // const res = await pool.query(
    //   'SELECT task_id, file_uid, cache_key, source_key, cid, status, output_path, input_path, format, error, params::text, created_at, updated_at FROM waifu2x_tasks WHERE status = $1 ORDER BY updated_at DESC',
    //   ['completed']
    // )

    console.log(res.rows)
  } catch (err) {
    console.error('错误：', err)
  }
}

const start = performance.now()

await testPool()
const end = performance.now()

console.log(`Query took ${end - start} milliseconds`)

process.exit(0)
