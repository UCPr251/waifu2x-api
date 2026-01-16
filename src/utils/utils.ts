import crypto from 'crypto'

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

interface RetryOptions<V = any> {
  defaultValue?: V
  times?: number
  delay?: number
  tip?: string
}

export async function retry<
  T extends ((i: number) => any) | (() => any),
  V extends any
>(
  fnc: T,
  options: RetryOptions<V> & { defaultValue: V }
): Promise<Awaited<ReturnType<T>> | V>
export async function retry<
  T extends ((i: number) => any) | (() => any)
>(
  fnc: T,
  options?: RetryOptions<undefined>
): Promise<Awaited<ReturnType<T>> | undefined>
export async function retry<
  T extends ((i: number) => any) | (() => any),
  V extends any = undefined
>(
  fnc: T,
  options: RetryOptions<V> = {}
): Promise<Awaited<ReturnType<T>> | V | undefined> {
  const { defaultValue, times, delay, tip } = {
    times: 3,
    delay: 500,
    tip: '',
    ...options
  }
  for (let i = 1; i <= times; i++) {
    try {
      return await fnc(i)
    } catch (e) {
      logger.error(`第${i}次尝试失败：${tip}\n`, e)
      if (i === times) return defaultValue
      await sleep(delay)
    }
  }
  return defaultValue
}

export function md5(data: string | Buffer): string {
  return crypto.createHash('md5').update(data).digest('hex')
}

export function randomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * chars.length)
    result += chars[randomIndex]
  }
  return result
}

export function uuid(): string {
  let bytes = crypto.randomBytes(16)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  let hex = bytes.toString("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}
