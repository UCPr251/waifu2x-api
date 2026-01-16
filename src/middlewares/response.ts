import type { Request, Response, NextFunction } from 'express'

export function response(req: Request, res: Response, next: NextFunction) {
  const originalSend = res.send
  res.send = (data) => {
    if (typeof data !== 'object') {
      return originalSend.call(res, data)
    }
    const { statusCode } = res
    if (statusCode >= 200 && statusCode < 300) {
      data = {
        code: 0,
        msg: 'success',
        data
      }
      if (data.data.msg) {
        data.msg = data.data.msg
        delete data.data.msg
      }
    } else if (data.error) {
      data = {
        code: statusCode,
        msg: data.error,
        ...data
      }
      delete data.error
    } else {
      data = {
        code: statusCode,
        msg: 'error',
        ...data
      }
    }
    res._responseData = data
    data = JSON.stringify(data)
    if (!res.headersSent)
      res.setHeader('Content-Type', 'application/json')
    return originalSend.call(res, data)
  }
  next()
}