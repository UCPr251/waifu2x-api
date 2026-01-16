import type { Request, Response, NextFunction } from 'express'

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const ip = req.pureIp
  if (!ip) return res.end()
  if (config.api.blackIPs?.includes?.(ip)) {
    logger.mark(`blackIP: ${ip} Forbidden access ` + req.url)
    return res.status(403).end()
  }
  next()
}
