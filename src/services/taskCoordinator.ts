import fsp from 'node:fs/promises'
import { md5, randomString, uuid } from '../utils/utils.js'
import { config } from '../utils/config.js'
import { CacheService, type UpscaleParams, type TaskRow } from './cacheService.js'
import { TaskScheduler } from './taskScheduler.js'
import { Waifu2xRunner } from './waifu2xRunner.js'

export type SubmitPayload = {
  buffer: Buffer
  sourceKey: string
  cid: string
  getTimeConsuming?: () => string
  overrides?: Partial<SubmissionParams>
}

export type SubmissionParams = Omit<UpscaleParams, 'gpu'> & { gpu: string }
type ImageFormat = 'jpg' | 'png' | 'webp'

export type SubmitResult = {
  taskId: string
  fileUid: string
  status: 'queued' | 'completed'
  cached: boolean
  downloadUrl: string
  filePath?: string
  format?: string
}

export class TaskCoordinator {
  constructor(
    private readonly cacheService: CacheService,
    private readonly scheduler: TaskScheduler,
    private readonly runner: Waifu2xRunner
  ) {
  }

  async submit(payload: SubmitPayload): Promise<SubmitResult> {
    const { getTimeConsuming = () => '' } = payload
    const stats = this.scheduler.stats
    if (stats.pending + stats.active >= this.maxQueueSize) {
      logger.debug(`${logger.blue('[调度]')} [拥塞] 任务队列达到上限，拒绝新任务${getTimeConsuming()}`)
      throw new TaskQueueFullError()
    }
    const merged = this.mergeParams(payload.overrides)
    const taskMeta = this.buildImageLabel(payload.sourceKey, payload.cid)
    logger.debug(`${logger.blue('[调度]')} [入站] ${taskMeta} 待处理数据${(payload.buffer.length / 1024 / 1024).toFixed(2)}MB${getTimeConsuming()}`)
    const imageHash = md5(payload.buffer)
    logger.debug(`${logger.blue('[调度]')} [哈希] ${taskMeta} 结果${imageHash}${getTimeConsuming()}`)
    const cacheKey = this.cacheService.buildCacheKey(imageHash, merged)

    const cached = await this.cacheService.findCacheHit(cacheKey, getTimeConsuming)
    if (cached) {
      logger.debug(`${logger.blue('[调度]')} [缓存命中] ${taskMeta} 复用任务${cached.taskId.slice(0, 8)} 更新时间${cached.updatedAt}${getTimeConsuming()}`)
      return {
        taskId: cached.taskId,
        fileUid: cached.fileUid,
        status: 'completed',
        cached: true,
        downloadUrl: this.buildDownloadUrl(cached.taskId),
        filePath: cached.outputPath,
        format: cached.format
      }
    }

    const inflight = await this.cacheService.findActiveTask(cacheKey, getTimeConsuming)
    if (inflight) {
      logger.debug(`${logger.blue('[调度]')} [排队复用] ${taskMeta} 复用进行中任务${inflight.task_id.slice(0, 8)} 当前状态${inflight.status}${getTimeConsuming()}`)
      return {
        taskId: inflight.task_id,
        fileUid: inflight.file_uid,
        status: 'queued',
        cached: true,
        downloadUrl: this.buildDownloadUrl(inflight.task_id),
        format: inflight.format
      }
    }

    const taskId = uuid()
    const fileUid = randomString(16)
    const { inputPath, outputPath } = await this.cacheService.createQueuedTask({
      taskId,
      fileUid,
      cacheKey,
      sourceKey: payload.sourceKey,
      cid: payload.cid,
      imageHash,
      params: merged,
      buffer: payload.buffer,
      getTimeConsuming,
    })

    logger.debug(`${logger.blue('[调度]')} [入队] ${taskMeta} 任务${taskId.slice(0, 8)} 文件${fileUid} 临时输入${inputPath}${getTimeConsuming()}`)

    this.scheduler.add({
      id: taskId,
      run: () => this.executeTask({
        taskId,
        fileUid,
        inputPath,
        outputPath,
        params: merged,
        getTimeConsuming
      })
    })

    return {
      taskId,
      fileUid,
      status: 'queued',
      cached: false,
      downloadUrl: this.buildDownloadUrl(taskId)
    }
  }

  async fetchTask(taskId: string): Promise<TaskRow | null> {
    return this.cacheService.getTask(taskId)
  }

  async getDownloadPayload(taskId: string) {
    const task = await this.fetchTask(taskId)
    const shortTaskId = taskId.slice(0, 8)
    if (!task) {
      logger.debug(`${logger.blue('[调度]')} [任务缺失] 任务${shortTaskId} 未找到记录`)
      return null
    }
    if (task.status !== 'completed') {
      !config.logging.ignoreDownloadDebugLogs && logger.debug(`${logger.blue('[调度]')} [任务排队] 任务${shortTaskId} 状态${task.status}`)
      return { task }
    }
    const filePath = await this.cacheService.ensureFileOnDisk(task)
    if (!filePath) {
      logger.debug(`${logger.blue('[调度]')} [缓存丢失] 任务${shortTaskId} 输出文件丢失，已移除缓存记录`)
      return null
    }
    const buffer = await fsp.readFile(filePath)
    logger.debug(`${logger.blue('[调度]')} [缓存复用] 任务${shortTaskId} 输出${filePath} 大小${(buffer.length / 1024 / 1024).toFixed(2)}MB`)
    return {
      task,
      buffer,
      filePath
    }
  }

  async resumePendingTasks(): Promise<void> {
    const pending = await this.cacheService.listPendingTasks()
    if (!pending.length) return
    logger.info(`${logger.blue('[调度]')} 恢复未完成任务 ${pending.length} 个`)
    for (const task of pending) {
      if (task.status === 'processing') {
        await this.cacheService.requeueTask(task.task_id)
      }
      const outputPath = this.cacheService.buildOutputPath({
        sourceKey: task.source_key,
        cid: task.cid,
        fileUid: task.file_uid,
        format: task.params.format
      })
      const taskMeta = this.buildImageLabel(task.source_key, task.cid)
      logger.debug(`${logger.blue('[调度]')} [恢复排队] ${taskMeta} 任务${task.task_id.slice(0, 8)} 原状态${task.status}`)
      this.scheduler.add({
        id: task.task_id,
        run: () => this.executeTask({
          taskId: task.task_id,
          fileUid: task.file_uid,
          inputPath: task.input_path,
          outputPath,
          params: task.params
        })
      })
    }
  }

  private async executeTask(args: {
    taskId: string
    fileUid: string
    inputPath: string
    outputPath: string
    params: SubmissionParams
    getTimeConsuming?: () => string
  }) {
    const { getTimeConsuming = () => '' } = args

    await this.cacheService.markProcessing(args.taskId, getTimeConsuming)
    const execStart = Date.now()
    const shortTaskId = args.taskId.slice(0, 8)
    logger.debug(`${logger.blue('[调度]')} [开始执行] 任务${shortTaskId} 输入${args.inputPath} 目标${args.outputPath}${getTimeConsuming()}`)
    try {
      const timeout = config.scheduler.taskTimeoutMs ?? 600_000
      await this.runner.run({
        taskId: args.taskId,
        inputPath: args.inputPath,
        outputPath: args.outputPath,
        params: args.params,
        timeoutMs: timeout
      })
      logger.debug(`${logger.blue('[调度]')} [算力完成] 任务${shortTaskId}${getTimeConsuming()}`)
      const buffer = await fsp.readFile(args.outputPath)
      await this.cacheService.markCompleted(args.taskId, {
        outputPath: args.outputPath,
        buffer,
        fileSize: buffer.length,
        getTimeConsuming
      })
      logger.debug(`${logger.blue('[调度]')} [写入缓存] 任务${shortTaskId} 输出大小${(buffer.length / 1024 / 1024).toFixed(2)}MB 总耗时${Date.now() - execStart}ms${getTimeConsuming()}`)
    } catch (error) {
      logger.debug(`${logger.blue('[调度]')} [执行失败] 任务${shortTaskId} 出错：${(error as Error).message}${getTimeConsuming()}`)
      await this.cacheService.markFailed(args.taskId, error as Error, getTimeConsuming)
      throw error
    } finally {
      await this.cacheService.cleanupInput(args.inputPath)
      logger.debug(`${logger.blue('[调度]')} [清理输入] 任务${shortTaskId} 已删除临时文件${args.inputPath}${getTimeConsuming()}`)
    }
  }

  private mergeParams(overrides?: Partial<SubmissionParams>): SubmissionParams {
    const defaults = config.waifu2x || {}
    const tileValue = overrides?.tile ?? defaults.tile ?? 256
    const scaleCandidate = overrides?.scale ?? defaults.scale ?? 2
    return {
      scale: this.normalizeScale(scaleCandidate),
      noise: this.parseNoise(overrides?.noise ?? defaults.noise ?? 1),
      tile: typeof tileValue === 'string' ? tileValue : `${tileValue}`,
      model: String(overrides?.model || defaults.model || 'models-cunet'),
      gpu: String(overrides?.gpu ?? defaults.gpu ?? 0),
      threads: String(overrides?.threads || defaults.threads || '2:2:2'),
      format: this.parseFormat(overrides?.format || defaults.format || 'jpg'),
      tta: Boolean(overrides?.tta ?? defaults.tta ?? false)
    }
  }

  private parseNumber(value: number, fallback: number): number {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }

  private normalizeScale(value: number): number {
    const parsed = this.parseNumber(value, 2)
    const allowed = [1, 2, 4, 8, 16, 32]
    return allowed.includes(parsed) ? parsed : 2
  }

  private parseNoise(value: number): number {
    const parsed = Math.round(this.parseNumber(value, 1))
    return Math.max(-1, Math.min(3, parsed))
  }

  private parseFormat(value: string): ImageFormat {
    const format = (value || '').toLowerCase()
    return (['jpg', 'png', 'webp'] as const).includes(format as ImageFormat) ? format as ImageFormat : 'jpg'
  }

  private buildDownloadUrl(taskId: string): string {
    return `/api/download/${taskId}`
  }

  private get maxQueueSize(): number {
    const raw = Number(config.scheduler.maxQueueSize)
    return Number.isFinite(raw) && raw > 0 ? raw : 200
  }

  private buildImageLabel(sourceKey: string, cid: string): string {
    return `来源${sourceKey} 漫画${cid}`
  }
}

export class TaskQueueFullError extends Error {
  readonly statusCode = 429

  constructor(message = 'Task queue is full, please retry later') {
    super(message)
    this.name = 'TaskQueueFullError'
  }
}
