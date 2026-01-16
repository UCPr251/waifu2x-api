import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import type { Pool } from 'pg'
import { config } from '../utils/config.js'

export type UpscaleParams = {
  scale: number
  noise: number
  tile: string
  model: string
  gpu: string
  threads: string
  format: 'jpg' | 'png' | 'webp'
  tta: boolean
}

export type TaskRow = {
  task_id: string
  file_uid: string
  cache_key: string
  source_key: string
  cid: string
  status: TaskStatus
  output_path: string | null
  input_path: string
  format: string
  error: string | null
  params: UpscaleParams
  updated_at: string
  created_at: string
}

export type TaskStatus = 'queued' | 'processing' | 'completed' | 'failed'

export class CacheService {
  private readonly cacheRoot: string
  private readonly tempRoot: string

  constructor(private readonly pool: Pool) {
    const cwd = process.cwd()
    this.cacheRoot = path.resolve(cwd, config.paths.cacheDir || 'cache')
    this.tempRoot = path.resolve(cwd, config.paths.tempDir || 'uploads/runtime')
  }

  async init(): Promise<void> {
    await Promise.all([
      fsp.mkdir(this.cacheRoot, { recursive: true }),
      fsp.mkdir(this.tempRoot, { recursive: true })
    ])
  }

  buildCacheKey(imageHash: string, params: UpscaleParams): string {
    return [
      imageHash,
      `s${params.scale}`,
      `n${params.noise}`,
      params.format,
      params.model,
      params.tta ? 'tta' : 'no-tta'
    ].join(':')
  }

  async findCacheHit(cacheKey: string, getTimeConsuming = () => '') {
    const { rows } = await this.pool.query<RawTaskRow>(
      'SELECT task_id, file_uid, cache_key, source_key, cid, status, output_path, input_path, format, error, params::text, created_at, updated_at FROM waifu2x_tasks WHERE cache_key = $1 AND status = $2 ORDER BY updated_at DESC LIMIT 1',
      [cacheKey, 'completed']
    )
    if (!rows.length) {
      logger.debug(`${logger.green('[缓存]')} [未命中] key=${cacheKey}${getTimeConsuming()}`)
      return null
    }
    const parsed = this.mapRow(rows[0])
    const ttlSeconds = config.cache.ttlSeconds
    if (ttlSeconds) {
      const expiresAt = new Date(parsed.updated_at).getTime() + ttlSeconds * 1000
      if (Date.now() > expiresAt) {
        logger.debug(`${logger.green('[缓存]')} [过期] key=${cacheKey} 已超过TTL，忽略缓存${getTimeConsuming()}`)
        return null
      }
    }
    logger.debug(`${logger.green('[缓存]')} [命中] key=${cacheKey} 任务${parsed.task_id}${getTimeConsuming()}`)
    const outputPath = await this.ensureFileOnDisk(parsed)
    if (!outputPath) return null
    return {
      taskId: parsed.task_id,
      fileUid: parsed.file_uid,
      outputPath,
      format: parsed.format,
      createdAt: parsed.created_at,
      updatedAt: parsed.updated_at
    }
  }

  async findActiveTask(cacheKey: string, getTimeConsuming = () => ''): Promise<TaskRow | null> {
    const { rows } = await this.pool.query<RawTaskRow>(
      `SELECT task_id, file_uid, cache_key, source_key, cid, status, output_path, input_path, format, error, params::text, created_at, updated_at
       FROM waifu2x_tasks
       WHERE cache_key = $1 AND status IN ($2, $3)
       ORDER BY updated_at DESC
       LIMIT 1`,
      [cacheKey, 'queued', 'processing']
    )
    if (!rows.length) {
      return null
    }
    const row = this.mapRow(rows[0])
    logger.debug(`${logger.green('[缓存]')} [队列复用] key=${cacheKey} 任务${row.task_id.slice(0, 8)} 状态=${row.status}${getTimeConsuming()}`)
    return row
  }

  async createQueuedTask(args: {
    taskId: string
    fileUid: string
    cacheKey: string
    sourceKey: string
    cid: string
    imageHash: string
    params: UpscaleParams
    buffer: Buffer
    getTimeConsuming?: () => string
  }): Promise<{ inputPath: string, outputPath: string }> {
    const { getTimeConsuming = () => '' } = args

    const inputPath = path.join(this.tempRoot, `${args.taskId}.bin`)
    await fsp.mkdir(path.dirname(inputPath), { recursive: true })
    await fsp.writeFile(inputPath, args.buffer)
    logger.debug(`${logger.green('[缓存]')} [写入临时] 任务${args.taskId.slice(0, 8)} 输入${inputPath} 大小${(args.buffer.length / 1024 / 1024).toFixed(2)}MB${getTimeConsuming()}`)

    const outputPath = this.buildOutputPath({
      sourceKey: args.sourceKey,
      cid: args.cid,
      fileUid: args.fileUid,
      format: args.params.format
    })
    await fsp.mkdir(path.dirname(outputPath), { recursive: true })

    await this.pool.query(
      `INSERT INTO waifu2x_tasks (
        task_id, file_uid, cache_key, source_key, cid, image_hash,
        params, status, input_path, format
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (task_id) DO NOTHING`,
      [
        args.taskId,
        args.fileUid,
        args.cacheKey,
        args.sourceKey,
        args.cid,
        args.imageHash,
        JSON.stringify(args.params),
        'queued',
        inputPath,
        args.params.format
      ]
    )
    logger.debug(`${logger.green('[缓存]')} [记录入库] 任务${args.taskId.slice(0, 8)} 文件${args.fileUid} 状态=queued${getTimeConsuming()}`)

    return { inputPath, outputPath }
  }

  async markProcessing(taskId: string, getTimeConsuming = () => ''): Promise<void> {
    await this.pool.query(
      'UPDATE waifu2x_tasks SET status = $1, started_at = NOW(), updated_at = NOW() WHERE task_id = $2',
      ['processing', taskId]
    )
    logger.debug(`${logger.green('[缓存]')} [标记处理中] 任务${taskId.slice(0, 8)}${getTimeConsuming()}`)
  }

  async listPendingTasks(): Promise<TaskRow[]> {
    const { rows } = await this.pool.query<RawTaskRow>(
      `SELECT task_id, file_uid, cache_key, source_key, cid, status, output_path, input_path, format, error,
              params::text, created_at, updated_at
       FROM waifu2x_tasks
       WHERE status IN ($1, $2)
       ORDER BY created_at ASC`,
      ['queued', 'processing']
    )
    return rows.map((row) => this.mapRow(row))
  }

  async requeueTask(taskId: string): Promise<void> {
    await this.pool.query(
      'UPDATE waifu2x_tasks SET status = $1, started_at = NULL, updated_at = NOW() WHERE task_id = $2',
      ['queued', taskId]
    )
  }

  async markCompleted(taskId: string, data: {
    outputPath: string
    buffer: Buffer
    fileSize: number
    getTimeConsuming?: () => string
  }): Promise<void> {
    await this.pool.query(
      'UPDATE waifu2x_tasks SET status = $1, output_path = $2, file_size = $3, finished_at = NOW(), updated_at = NOW() WHERE task_id = $4',
      ['completed', data.outputPath, data.fileSize, taskId]
    )
    logger.debug(`${logger.green('[缓存]')} [完成写入] 任务${taskId.slice(0, 8)} 输出${data.outputPath} 大小${(data.fileSize / 1024 / 1024).toFixed(2)}MB${data.getTimeConsuming?.() || ''}`)
  }

  async markFailed(taskId: string, error: Error, getTimeConsuming = () => ''): Promise<void> {
    await this.pool.query(
      'UPDATE waifu2x_tasks SET status = $1, error = $2, finished_at = NOW(), updated_at = NOW() WHERE task_id = $3',
      ['failed', error.message, taskId]
    )
    logger.debug(`${logger.green('[缓存]')} [标记失败] 任务${taskId} 原因：${error.message}${getTimeConsuming()}`)
  }

  async cleanupInput(pathToRemove: string, getTimeConsuming = () => ''): Promise<void> {
    try {
      await fsp.rm(pathToRemove, { force: true })
      logger.debug(`${logger.green('[缓存]')} [清理] 已删除临时文件${pathToRemove}${getTimeConsuming()}`)
    } catch (err) {
      logger.warn('Failed to cleanup input file', pathToRemove, err)
    }
  }

  async getTask(taskId: string): Promise<TaskRow | null> {
    const { rows } = await this.pool.query<RawTaskRow>(
      'SELECT task_id, file_uid, cache_key, source_key, cid, status, output_path, input_path, format, error, params::text, created_at, updated_at FROM waifu2x_tasks WHERE task_id = $1 LIMIT 1',
      [taskId]
    )
    if (!rows.length) return null
    return this.mapRow(rows[0])
  }

  async ensureFileOnDisk(row: TaskRow): Promise<string | null> {
    const targetPath = row.output_path ?? this.buildOutputPath({
      sourceKey: row.source_key,
      cid: row.cid,
      fileUid: row.file_uid,
      format: row.params.format
    })
    if (targetPath && fs.existsSync(targetPath)) {
      return targetPath
    }
    logger.warn(`${logger.green('[缓存]')} [缺失文件] 任务${row.task_id} 对应文件不存在，执行数据清理`)
    await this.deleteTask(row.task_id)
    return null
  }

  buildOutputPath(args: { sourceKey: string, cid: string, fileUid: string, format: string }): string {
    return path.join(this.cacheRoot, args.sourceKey, args.cid, `${args.fileUid}.${args.format}`)
  }

  getMime(format: string): string {
    switch (format) {
      case 'png':
        return 'image/png'
      case 'webp':
        return 'image/webp'
      default:
        return 'image/jpeg'
    }
  }

  private mapRow(row: RawTaskRow): TaskRow {
    return {
      ...row,
      params: JSON.parse(row.params)
    }
  }

  async deleteTask(taskId: string): Promise<void> {
    await this.pool.query('DELETE FROM waifu2x_tasks WHERE task_id = $1', [taskId])
    logger.debug(`${logger.green('[缓存]')} [删除记录] 任务${taskId} 已移除数据库记录`)
  }
}

type RawTaskRow = Omit<TaskRow, 'params'> & { params: string }
