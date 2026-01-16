export interface Waifu2xConfig {
  executablePath: string
  modelsDir: string
  gpuId: number
  numThreads: number
  tileSize: number
  verbose: boolean
}

export interface ProcessingConfig {
  noiseLevel: number
  scale: number
  format: 'png' | 'jpg' | 'webp'
  quality: number
  enableTTA: boolean
}

export interface SchedulerConfig {
  maxConcurrentTasks: number
  queueSize: number
  taskTimeout: number
  enableLIFO: boolean
  enableCache: boolean
  cacheTTL: number
  mergeSimilarRequests: boolean
  mergeWindowMs: number
}

export interface TaskRequest {
  id: string
  imagePath: string
  options: {
    noise: number
    scale: number
    format: string
    quality: number
    tta: boolean
  }
  createdAt: number
  callback: (result: TaskResult) => void
}

export interface TaskResult {
  id: string
  success: boolean
  outputPath?: string
  error?: string
  processingTime: number
  cached: boolean
}

export interface CacheEntry {
  key: string
  outputPath: string
  createdAt: number
  size: number
  accessCount: number
}