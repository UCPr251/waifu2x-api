import type { Request, Response } from 'express'
import { Router } from 'express'

const counter: Record<string, number> = {}

export const logstreamRouter: Router = Router()
logstreamRouter.get('/logstream', logstream)

function logstream(req: Request, res: Response) {
  if (config.api.logToken) {
    if (!req.query.token || req.query.token !== config.api.logToken) {
      counter[req.pureIp] = (counter[req.pureIp] || 0) + 1
      if (counter[req.pureIp] >= 5) {
        logger.mark(`无效日志访问令牌尝试次数: IP ${req.pureIp} 次数 ${counter[req.pureIp]} 路径` + req.url)
        config.api.blackIPs.push(req.pureIp)
        config.save()
      }
      return res.status(403).send({ error: 'Forbidden' })
    }
  }
  delete counter[req.pureIp]
  logger.debug(`Log stream started: ${req.pureIp} Current viewers: ${logger.logout.length + 1}`)
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  req.socket.setKeepAlive(true)
  if (typeof res.flushHeaders === 'function') res.flushHeaders()
  res.write(':ok\n\n')
  const fnc = (log: string) => {
    if (res.writableEnded) {
      logger.logout = logger.logout.filter((item) => item !== fnc)
    } else {
      res.write(log.split('\n')
        .map(line => `data: ${line}`)
        .join('\n') + '\n\n'
      )
    }
  }
  logger.logout.push(fnc)
  req.on('close', () => {
    logger.logout = logger.logout.filter((item) => item !== fnc)
    logger.debug(`Log stream closed: ${req.pureIp} Left viewers: ${logger.logout.length}`)
    res.end()
  })
}
