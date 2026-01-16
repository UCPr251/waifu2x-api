import { config } from '../dist/utils/config.js'
import { spawn } from 'node:child_process'
import PQueue from 'p-queue'
import path from 'node:path'
import fs from 'fs'

const waifu2x = config.waifu2x
const args = [
  '-i', '',
  '-o', '',
  '-n', waifu2x.noise.toString(),
  '-s', waifu2x.scale.toString(),
  '-t', waifu2x.tile.toString(),
  '-m', waifu2x.model.toString(),
  '-g', waifu2x.gpu.toString(),
  '-j', waifu2x.threads.toString(),
  '-f', waifu2x.format.toString()
]
if (waifu2x.tta) {
  args.push('-x')
}

async function upscale(input, output) {
  args[1] = input
  args[3] = output
  return new Promise((resolve, reject) => {
    const child = spawn(waifu2x.path, args, {
      windowsHide: true
    })
    child.stdout?.on('data', (data) => {
      // console.log(data.toString())
    })
    child.stderr?.on('data', (data) => {
      // console.error(data.toString())
    })
    const timeoutMs = config.scheduler.taskTimeoutMs
    const timeout = timeoutMs > 0
      ? setTimeout(() => {
        child.kill()
        console.log(`任务超时 > ${timeoutMs}ms，已终止进程`)
        reject(new Error(`waifu2x task ${task.taskId} timed out (${timeoutMs}ms)`))
      }, timeoutMs)
      : null
    child.on('error', (error) => {
      if (timeout) clearTimeout(timeout)
      reject(error)
    })
    child.on('close', (code) => {
      if (timeout) clearTimeout(timeout)
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`waifu2x exited with code ${code}`))
      }
    })
  })
}

async function test_directory() {
  const outputDirectory = output + '_dir'
  if (!fs.existsSync(outputDirectory)) {
    fs.mkdirSync(outputDirectory, { recursive: true })
  }
  console.log('start upscale directory...')
  const start_directory = performance.now()
  await upscale(input, outputDirectory)
  const end_directory = performance.now()
  console.log(`upscale directory done in ${(end_directory - start_directory).toFixed(2)} ms`)
}

async function test_files() {
  const outputFiles = output + '_files'
  if (!fs.existsSync(outputFiles)) {
    fs.mkdirSync(outputFiles, { recursive: true })
  }
  console.log('start upscale files with concurrency...')
  const start_files = performance.now()
  const queue = new PQueue({ concurrency: config.scheduler.concurrency })
  for (const file of fs.readdirSync(input)) {
    queue.add(async () => {
      const inputFilePath = path.join(input, file)
      const outputFilePath = path.join(outputFiles, file)
      await upscale(inputFilePath, outputFilePath)
    })
  }
  await queue.onIdle()
  const end_files = performance.now()
  console.log(`upscale files done in ${(end_files - start_files).toFixed(2)} ms`)
}

const oriConsoleLog = console.log
console.log = (...args) => oriConsoleLog.call(console, ...args, '\n')

console.log(args)

const input = path.resolve('test/images')
const output = input + '_upscale'

console.log(`Waifu2x Path: ${waifu2x.path}`)

// test upscale: directory or single file

await test_directory()

await test_files()

process.exit(0)
