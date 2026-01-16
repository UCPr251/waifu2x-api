import { config } from '../dist/utils/config.js'

const POLL_INTERVAL_MS = 300
const POLL_TIMEOUT_MS = 300_000

const apiBase = `http://${config.api.host === '0.0.0.0' ? 'localhost' : config.api.host}:${config.api.port}/api`

/**
 * Process an image
 * @param image {ArrayBuffer} - The image to process
 * @param cid {string} - The comic ID
 * @param eid {string} - The episode ID
 * @param page {number} - The page number
 * @param sourceKey {string} - The source key
 * @returns {Promise<{image: Promise<ArrayBuffer>, onCancel: () => void}>}
 */
async function processImage(image, cid, eid, page, sourceKey) {
  const start_upload = performance.now()

  if (!image) throw new Error('image payload is required')
  if (!cid || !sourceKey) throw new Error('cid and sourceKey are required')

  const controller = new AbortController()
  const signal = controller.signal

  const imagePromise = (async () => {
    const body = toBuffer(image)
    const upscaleUrl = buildApiUrl('/upscale')
    upscaleUrl.searchParams.set('cid', cid)
    upscaleUrl.searchParams.set('sourceKey', sourceKey)
    if (eid) upscaleUrl.searchParams.set('eid', eid)
    if (page !== undefined && page !== null) {
      upscaleUrl.searchParams.set('page', String(page))
    }
    upscaleUrl.searchParams.set('scale', '2')
    upscaleUrl.searchParams.set('noise', '1')
    upscaleUrl.searchParams.set('format', 'jpg')
    upscaleUrl.searchParams.set('direct', '1')

    const response = await fetch(upscaleUrl, {
      method: 'POST',
      body,
      signal,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Accept': 'application/json,image/*'
      }
    })

    const end_upload = performance.now()
    console.log(`Upload took ${end_upload - start_upload} milliseconds`)

    if (response.ok && isBinaryResponse(response)) {
      return response.arrayBuffer()
    }

    const payload = await parseJson(response)
    const data = payload?.data ?? payload
    if (!data || !data.taskId) {
      throw new Error('Malformed waifu2x response payload')
    }

    const downloadUrl = resolveDownloadUrl(data.downloadUrl, data.taskId)
    return pollUntilReady(downloadUrl, signal)
  })()

  return {
    image: imagePromise,
    onCancel: () => controller.abort()
  }
}

function buildApiUrl(pathname) {
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`
  const url = new URL(`${apiBase}${normalizedPath}`)
  return url
}

function resolveDownloadUrl(downloadUrl, taskId) {
  if (downloadUrl) {
    return new URL(downloadUrl, apiBase).toString()
  }
  const fallback = buildApiUrl(`/download/${taskId}`)
  return fallback.toString()
}

async function pollUntilReady(downloadUrl, signal) {
  const start_download = performance.now()

  const startedAt = Date.now()
  while (true) {
    if (signal.aborted) throw createAbortError()
    const response = await fetch(downloadUrl, {
      method: 'GET',
      signal,
      headers: {
        'Accept': 'application/octet-stream,image/*'
      }
    })

    if (response.ok && isBinaryResponse(response)) {
      const end_download = performance.now()
      console.log(`Download took ${end_download - start_download} milliseconds`)

      return response.arrayBuffer()
    }

    if (response.status === 202 && Date.now() - startedAt < POLL_TIMEOUT_MS) {
      await delay(POLL_INTERVAL_MS, signal)
      continue
    }

    const body = await safeText(response)
    const message = extractErrorMessage(body) || response.statusText
    throw new Error(`Download failed (${response.status}): ${message}`)
  }
}

function isBinaryResponse(response) {
  const type = response.headers.get('content-type') || ''
  return type.startsWith('image/') || type.includes('application/octet-stream')
}

async function parseJson(response) {
  const text = await safeText(response)
  if (!response.ok) {
    const message = extractErrorMessage(text) || response.statusText
    throw new Error(`Upscale request failed (${response.status}): ${message}`)
  }
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`Failed to parse waifu2x response: ${error.message}`)
  }
}

async function safeText(response) {
  try {
    return await response.text()
  } catch {
    return ''
  }
}

function extractErrorMessage(raw) {
  if (!raw) return ''
  try {
    const parsed = JSON.parse(raw)
    return parsed?.msg || parsed?.error || parsed?.data?.error || raw
  } catch {
    return raw
  }
}

function toBuffer(value) {
  if (Buffer.isBuffer(value)) return value
  if (value instanceof ArrayBuffer) return Buffer.from(value)
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  }
  throw new TypeError('image must be an ArrayBuffer, TypedArray, or Buffer')
}

function delay(ms, signal) {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      cleanup()
      reject(createAbortError())
    }
    const cleanup = () => signal?.removeEventListener('abort', onAbort)
    if (signal) signal.addEventListener('abort', onAbort, { once: true })
  })
}

function createAbortError(message = 'Aborted') {
  if (typeof DOMException === 'function') {
    return new DOMException(message, 'AbortError')
  }
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

// Example usage
if (import.meta.main) {
  const oriConsoleLog = console.log
  console.log = (...args) => oriConsoleLog.call(console, '\n', ...args)

  const fs = await import('fs/promises')
  const path = await import('path')
  const inputPath = path.resolve('./test/images/input.jpg')
  const outputPath = path.resolve('./test/images/output.jpg')
  const imageData = await fs.readFile(inputPath)

  const start = performance.now()
  console.log('Processing image...')
  const { image: processedImage, onCancel } = await processImage(
    imageData.buffer,
    'comic123',
    'episode1',
    1,
    'sourceKeyExample'
  )
  try {
    const resultBuffer = await processedImage
    await fs.writeFile(outputPath, Buffer.from(resultBuffer))
    const end = performance.now()
    console.log(`Image processed in ${end - start} milliseconds`)
    console.log('Image saved to', outputPath)
  } catch (error) {
    console.error('Error processing image:', error)
  }
  process.exit(0)
}