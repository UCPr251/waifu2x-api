import type { Request, Response, NextFunction } from 'express'

export function log(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip ? req.ip.startsWith('::ffff:') ? req.ip.slice(7) : req.ip : ''
  req.pureIp = ip
  if (config.logging.ignoreDownloadLogs && req.path.includes('/download')) {
    return next()
  }
  const start = Date.now()
  const userInfo = `${ip} ${req.method} ${safeDecode(req.url)}`
  logger.info(userInfo)
  res.on('finish', () => {
    const { statusCode } = res
    const responseTime = Date.now() - start
    const _data = res._responseData || {}
    const data = JSON.stringify(_data.code == 0 ? _data.data : _data)
    const logLength = 100
    const truncatedData = data.length > logLength ? `${data.slice(0, logLength)} ...${data.length - logLength} more` : data
    const msg = `${userInfo} ${logger.green(statusCode)} ${truncatedData ? truncatedData + ' ' : ''}${logger.green(responseTime + 'ms')}`
    if (statusCode >= 500) {
      logger.info(logger.red(msg))
    } else if (statusCode >= 400) {
      logger.info(logger.yellow(msg))
    } else {
      logger.info(msg)
    }
  })
  next()
}

function safeDecode(encoded: string) {
  try {
    return decodeURIComponent(encoded)
  } catch {
    return encoded
  }
}