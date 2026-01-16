import type { UpscaleParams } from './cacheService.js'
import { config } from '../utils/config.js'
import { spawn } from 'node:child_process'
import fsp from 'node:fs/promises'
import path from 'node:path'

export interface RunnerTask {
  taskId: string
  inputPath: string
  outputPath: string
  params: UpscaleParams
  timeoutMs: number
}

export class Waifu2xRunner {
  constructor(private readonly executableOverride?: string) { }

  async run(task: RunnerTask): Promise<{ elapsedMs: number }> {
    await fsp.mkdir(path.dirname(task.outputPath), { recursive: true })

    const args = this.buildArgs(task)
    const executable = this.resolveExecutable()
    const start = Date.now()
    const shortTaskId = task.taskId.slice(0, 8)
    logger.info(`${logger.orange('[算力]')} [开始] 任务${shortTaskId} 开始执行 参数: ${args.join(' ')}`)
    await this.spawnProcess(executable, task, args)
    const elapsedMs = Date.now() - start
    logger.info(`${logger.orange('[算力]')} [完成] 任务${shortTaskId} 超分用时${logger.red(`${elapsedMs}ms`)}`)
    return { elapsedMs }
  }

  private buildArgs(task: RunnerTask): string[] {
    const { params } = task
    const args = [
      '-i', task.inputPath,
      '-o', task.outputPath,
      '-n', params.noise.toString(),
      '-s', params.scale.toString(),
      '-t', params.tile.toString(),
      '-m', params.model.toString(),
      '-g', params.gpu.toString(),
      '-j', params.threads.toString(),
      '-f', params.format.toString()
    ]
    if (params.tta) {
      args.push('-x')
    }
    return args
  }

  private resolveExecutable(): string {
    const executable = this.executableOverride || config.waifu2x.path
    if (!executable) {
      throw new Error('waifu2x.path is not configured')
    }
    return executable
  }

  private spawnProcess(executable: string, task: RunnerTask, args: string[], getTimeConsuming = () => ''): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(executable, args, {
        windowsHide: true
      })

      const stderr: string[] = []
      const stdout: string[] = []

      child.stdout?.on('data', (data) => stdout.push(data.toString()))
      child.stderr?.on('data', (data) => stderr.push(data.toString()))

      const timeout = task.timeoutMs > 0
        ? setTimeout(() => {
          child.kill()
          logger.debug(`${logger.orange('[算力]')} [超时] 任务${task.taskId} 超时${task.timeoutMs}ms，已终止进程${getTimeConsuming()}`)
          reject(new Error(`waifu2x task ${task.taskId} timed out (${task.timeoutMs}ms)`))
        }, task.timeoutMs)
        : null

      child.on('error', (error) => {
        if (timeout) clearTimeout(timeout)
        reject(error)
      })

      child.on('close', (code) => {
        if (timeout) clearTimeout(timeout)
        if (code === 0) {
          if (stdout.length) {
            logger.debug(`${logger.orange('[算力]')} [输出] 任务${task.taskId.slice(0, 8)} 输出: ${stdout.join('').trim()}${getTimeConsuming()}`)
          }
          resolve()
        } else {
          const errorMsg = stderr.join('').trim()
          logger.debug(`${logger.orange('[算力]')} [异常] 任务${task.taskId} 异常退出(code=${code})：${errorMsg}${getTimeConsuming()}`)
          reject(new Error(`waifu2x exited with code ${code}: ${errorMsg}`))
        }
      })
    })
  }
}
