import 'express'

declare global {
  namespace Express {
    interface Request {
      pureIp: string
    }
    interface Response {
      _responseData: {
        code: number,
        msg: string,
        data: any
      }
    }
  }
}

