import type { Request, Response, NextFunction } from 'express'
import { Router } from 'express'
import { CacheService } from '../services/cacheService.js'
import { TaskCoordinator, TaskQueueFullError, type SubmissionParams } from '../services/taskCoordinator.js'
import { config } from '../utils/config.js'
import fs from 'fs'

const getTimeConsumingCache = new Map<string, () => string>()

export function createUpscaleRouter(coordinator: TaskCoordinator, cacheService: CacheService): Router {
  const router = Router()

  router.post('/upscale', async (req, res, next) => {
    const requestStart = Date.now()
    const getTimeConsuming = () => ' ' + logger.blue(`${Date.now() - requestStart}ms`)
    try {
      const imageBuffer = extractImage(req)
      if (!imageBuffer || !imageBuffer.length) {
        return res.status(400).send({ error: 'Missing image payload' })
      }

      if (config.api.maxInputSizeMB) {
        const maxSizeBytes = config.api.maxInputSizeMB * 1024 * 1024
        if (imageBuffer.length > maxSizeBytes) {
          return res.status(413).send({ error: `Image size exceeds the maximum limit of ${config.api.maxInputSizeMB} MB` })
        }
      }

      const sourceKey = readString(req.query.sourceKey) || readString((req.body as any)?.sourceKey)
      const cid = readString(req.query.cid) || readString((req.body as any)?.cid)
      const eid = readString(req.query.eid) || readString((req.body as any)?.eid)
      const page = readString(req.query.page) || readString((req.body as any)?.page)
      if (!sourceKey || !cid) {
        return res.status(400).send({ error: 'sourceKey and cid are required' })
      }

      const imageMeta = formatImageMeta({ sourceKey, cid, eid, page })
      logger.debug(`${logger.magenta('[接口]')} [接收] ${imageMeta} 原始大小${(imageBuffer.length / 1024 / 1024).toFixed(2)}MB${getTimeConsuming()}`)

      const overridesRaw = extractOverrides(req)

      const outcome = await coordinator.submit({
        buffer: imageBuffer,
        sourceKey,
        cid,
        overrides: overridesRaw as Partial<SubmissionParams>,
        getTimeConsuming,
      })

      if (!outcome.cached && config.api.saveUploads) {
        const dir = `uploads/save/${sourceKey}/${cid}`
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true })
        }
        fs.promises.writeFile(`${dir}/${outcome.fileUid}_${eid || ''}_${page || ''}_${Date.now()}.jpg`, imageBuffer)
      }

      getTimeConsumingCache.delete(outcome.taskId)
      getTimeConsumingCache.set(outcome.taskId, getTimeConsuming)

      const shortTaskId = outcome.taskId.slice(0, 8)
      logger.debug(`${logger.magenta('[接口]')} [派发完成] ${imageMeta} 任务${shortTaskId}${getTimeConsuming()}`)

      const wantsBinary = shouldStreamImmediately(req)
        || (outcome.status === 'completed' && config.cache.directDownloadOnHit)

      if (outcome.status === 'completed' && wantsBinary && outcome.filePath) {
        const mime = cacheService.getMime(outcome.format || config.waifu2x.format || 'jpg')
        res.setHeader('Content-Type', mime)
        res.setHeader('X-Task-Id', outcome.taskId)
        logger.debug(`${logger.magenta('[接口]')} [缓存直出] ${imageMeta} 任务${shortTaskId}命中缓存${getTimeConsuming()}`)
        return res.sendFile(outcome.filePath, (err) => {
          if (err) next(err)
        })
      }

      const responsePayload = {
        taskId: outcome.taskId,
        status: outcome.status,
        cached: outcome.cached,
        downloadUrl: outcome.downloadUrl
      }
      logger.debug(`${logger.magenta('[接口]')} [响应] ${imageMeta} 任务${shortTaskId} 状态${outcome.status} 缓存命中=${outcome.cached}${getTimeConsuming()}`)
      return res.status(outcome.status === 'completed' ? 200 : 202).send(responsePayload)
    } catch (error) {
      if (error instanceof TaskQueueFullError) {
        return res.status(error.statusCode).send({ error: error.message })
      }
      next(error)
    }
  })

  const handleDownload = async (req: Request<{ taskId?: string }>, res: Response, next: NextFunction) => {
    const requestStart = Date.now()
    const pathTaskId = readString(req.params.taskId)
    const taskId = pathTaskId || readString(req.query.taskId)
    if (!taskId) {
      return res.status(400).send({ error: 'taskId is required' })
    }
    try {
      const getTimeConsuming = getTimeConsumingCache.get(taskId) || (() => '')
      const shortTaskId = taskId.slice(0, 8)
      !config.logging.ignoreDownloadDebugLogs && logger.debug(`${logger.magenta('[接口]')} [下载请求] 任务${shortTaskId}${getTimeConsuming()}`)
      const payload = await coordinator.getDownloadPayload(taskId)
      if (!payload) {
        getTimeConsumingCache.delete(taskId)
        return res.status(404).send({ error: 'Task not found' })
      }

      if (payload.task.status !== 'completed') {
        !config.logging.ignoreDownloadDebugLogs && logger.debug(`${logger.magenta('[接口]')} [下载等待] 任务${shortTaskId} 当前状态${payload.task.status}${getTimeConsuming()}`)
        return res.status(payload.task.status === 'failed' ? 500 : 202).send({
          status: payload.task.status,
          error: payload.task.error || undefined
        })
      }

      const mime = cacheService.getMime(payload.task.format)
      res.setHeader('Content-Type', mime)
      res.setHeader('Content-Length', String(payload.buffer!.length))
      logger.debug(`${logger.magenta('[接口]')} [下载完成] 任务${shortTaskId} 输出格式${payload.task.format} 大小${(payload.buffer!.length / 1024 / 1024).toFixed(2)}MB 响应耗时${Date.now() - requestStart}ms${getTimeConsuming()}`)
      getTimeConsumingCache.delete(taskId)
      return res.end(payload.buffer)
    } catch (error) {
      next(error)
    }
  }

  router.get('/download', handleDownload)
  router.get('/download/:taskId', handleDownload)

  return router
}

function extractImage(req: Request): Buffer | null {
  if (Buffer.isBuffer(req.body)) {
    return req.body
  }
  if (req.body && typeof req.body === 'object') {
    const encoded = (req.body as any).image
    if (encoded && typeof encoded === 'string') {
      return Buffer.from(encoded, 'base64')
    }
  }
  return null
}

function extractOverrides(req: Request): Record<string, any> {
  const sources = [] as Record<string, any>[]
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    sources.push(req.body as Record<string, any>)
  }
  sources.push(req.query as Record<string, any>)

  const merged: Record<string, any> = {}
  for (const source of sources) {
    for (const key of Object.keys(source)) {
      const value = source[key]
      if (value !== undefined) {
        merged[key] = Array.isArray(value) ? value[0] : value
      }
    }
  }

  const overrides: Record<string, any> = {}
  if (merged.scale !== undefined) {
    const value = Number(merged.scale)
    if (Number.isFinite(value)) overrides.scale = value
  }
  if (merged.noise !== undefined) {
    const value = Number(merged.noise)
    if (Number.isFinite(value)) overrides.noise = value
  }
  if (merged.tile !== undefined) overrides.tile = merged.tile
  if (merged.model !== undefined) overrides.model = merged.model
  if (merged.gpu !== undefined) overrides.gpu = merged.gpu
  if (merged.threads !== undefined) overrides.threads = merged.threads
  if (merged.format !== undefined) overrides.format = merged.format
  if (merged.tta !== undefined) overrides.tta = merged.tta === true || merged.tta === 'true' || merged.tta === '1'
  return overrides
}

function readString(value: unknown): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null
  }
  if (typeof value === 'string') {
    return value
  }
  return null
}

function shouldStreamImmediately(req: Request): boolean {
  const direct = readString(req.query.direct)
  return direct === '1' || direct === 'true'
}

function formatImageMeta(info: { sourceKey: string, cid: string, eid?: string | null, page?: string | null }): string {
  const pageText = info.page ? `第${info.page}页` : '未知页'
  const eidText = info.eid ? `章节${info.eid}` : '章节未知'
  return `源${info.sourceKey} 漫画${info.cid} eid=${eidText} page=${pageText}`
}
