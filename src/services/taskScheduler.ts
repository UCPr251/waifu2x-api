import PQueue from 'p-queue'
import { config } from '../utils/config.js'

export type TaskJob = {
  id: string
  run: () => Promise<void>
  getTimeConsuming?: () => string
}

type QueueStrategy = 'fifo' | 'lifo'

export class TaskScheduler {
  private readonly queue: PQueue
  private lifoSequence = 0

  constructor() {
    this.queue = new PQueue({
      concurrency: TaskScheduler.normalizeConcurrency(config.scheduler.concurrency)
    })
  }

  add(job: TaskJob): void {
    const { getTimeConsuming = () => '' } = job

    const schedulerSettings = this.getSchedulerSettings()
    this.applyConcurrency(schedulerSettings.concurrency)

    const shortTaskId = job.id.slice(0, 8)

    const addOptions = schedulerSettings.strategy === 'lifo'
      ? { priority: this.nextLifoPriority() }
      : undefined

    void this.queue.add(async () => {
      logger.debug(`${logger.yellow('[队列]')} [执行] 任务${shortTaskId} 当前运行${this.queue.pending}个 排队${this.queue.size}个${getTimeConsuming()}`)
      try {
        await job.run()
        logger.debug(`${logger.yellow('[队列]')} [完成] 任务${shortTaskId}执行成功 当前运行${this.queue.pending}个 排队${this.queue.size}个${getTimeConsuming()}`)
      } catch (error) {
        logger.error(`${logger.yellow('[队列]')} [失败] 任务${shortTaskId}执行出错`, error)
        throw error
      }
    }, addOptions)

    logger.debug(`${logger.yellow('[队列]')} [接收] 新任务${shortTaskId} 模式${schedulerSettings.strategy.toUpperCase()} 当前运行${this.queue.pending}个 排队${this.queue.size}个${getTimeConsuming()}`)
  }

  get stats() {
    return {
      pending: this.queue.size,
      active: this.queue.pending
    }
  }

  private getSchedulerSettings(): { concurrency: number, strategy: QueueStrategy } {
    const schedulerConfig = config.scheduler || {}
    const concurrency = TaskScheduler.normalizeConcurrency(schedulerConfig.concurrency)
    const fallback = schedulerConfig.lifo ? 'lifo' : 'fifo'
    return {
      concurrency,
      strategy: fallback
    }
  }

  private static normalizeConcurrency(raw?: number): number {
    const parsed = Number(raw) || 1
    return parsed > 0 ? parsed : 1
  }

  private applyConcurrency(target: number): void {
    if (this.queue.concurrency !== target) {
      this.queue.concurrency = target
    }
  }

  private nextLifoPriority(): number {
    this.lifoSequence = (this.lifoSequence + 1) % Number.MAX_SAFE_INTEGER
    if (this.lifoSequence === 0) {
      this.lifoSequence = 1
    }
    return this.lifoSequence
  }
}
