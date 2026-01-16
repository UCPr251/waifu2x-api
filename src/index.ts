import express from 'express'
import compression from 'compression'
import cors from 'cors'
import helmet, { type HelmetOptions } from 'helmet'
import rateLimit from 'express-rate-limit'

import './utils/logger.js'
import { config } from './utils/config.js'

import { initDatabase } from './services/database.js'
import { CacheService } from './services/cacheService.js'
import { TaskScheduler } from './services/taskScheduler.js'
import { Waifu2xRunner } from './services/waifu2xRunner.js'
import { TaskCoordinator } from './services/taskCoordinator.js'
import { createUpscaleRouter } from './routes/upscale.js'
import { logstreamRouter } from './routes/logstream.js'
import { authenticate, log, response } from './middlewares/index.js'

async function bootstrap() {
  const app = express()
  app.disable('x-powered-by')

  if (config.api.enableCors) {
    app.use(cors())
  }
  if (config.api.helmet !== false)
    app.use(helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'img-src': ["'self'", 'data:', 'blob:'],
          'script-src': ["'self'", "'unsafe-inline'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          'font-src': ["'self'", 'data:'],
          'connect-src': ["'self'"]
        }
      }
    }))
  app.use(compression())
  app.use(rateLimit({
    windowMs: 60_000,
    limit: () => config.api.rateLimitPerMinute || 60,
    skipFailedRequests: true,
    requestWasSuccessful: (req, res) => !req.path.includes('/download') || res.statusCode !== 202, // ignore download polling
    legacyHeaders: false,
    standardHeaders: 'draft-7'
  }))

  const maxSizeMB = config.api.maxInputSizeMB || 100
  app.use(express.raw({ type: 'application/octet-stream', limit: maxSizeMB + 'mb' }))
  app.use(express.json({ limit: maxSizeMB + 'mb' }))
  app.use(express.urlencoded({ extended: true, limit: maxSizeMB + 'mb' }))

  app.use(log)
  app.use(response)
  app.use(authenticate)

  const pool = await initDatabase()
  const cacheService = new CacheService(pool)
  await cacheService.init()
  const scheduler = new TaskScheduler()
  const runner = new Waifu2xRunner()
  const coordinator = new TaskCoordinator(cacheService, scheduler, runner)
  await coordinator.resumePendingTasks()

  app.use('/favicon.ico', express.static('resources/favicon.ico', { maxAge: '365d' }))
  app.use('/public', express.static('resources/public', { maxAge: '30d' }))
  app.use('/log', express.static('resources/log', { maxAge: '30d' }))
  app.use('/studio', express.static('resources/studio', { maxAge: '7d' }))
  app.get('/', (_req, res) => res.redirect('/studio/'))

  app.use('/api', createUpscaleRouter(coordinator, cacheService), logstreamRouter)

  app.get('/health', (_, res) => {
    res.send({ status: 'ok' })
  })

  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error('Unhandled error', err)
    if (res.headersSent) return
    res.status(500).send({ error: 'Internal server error' })
  })

  const host = config.api.host || '127.0.0.1'
  const port = config.api.port || 6251
  app.listen(port, host, () => {
    logger.info(`🚀 Waifu2x API listening on http://${host}:${port}/api`)
    logger.info(`💻 Remote Waifu2x 超分工作台 Page: http://127.0.0.1:${port}/studio/`)
    logger.info(`🌐 Local Real-Time Log Page: http://127.0.0.1:${port}/log/?token=${config.api.logToken}`)
  })
}

process.env.TZ = 'Asia/Shanghai'
process.on('uncaughtException', (err) => (global.logger || console).error('Uncaught Exception:', err))
process.on('unhandledRejection', (err) => (global.logger || console).error('Unhandled Rejection:', err))

bootstrap().catch((error) => {
  logger.error('Failed to bootstrap service', error)
  process.exit(1)
})