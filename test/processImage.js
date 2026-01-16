// edit DEFAULT_API_BASE to your local server address if needed
const DEFAULT_API_BASE = 'http://127.0.0.1:6251/api'
const POLL_INTERVAL_MS = 200
const POLL_TIMEOUT_MS = 300_000

const apiBase = normalizeBase(DEFAULT_API_BASE)

/**
 * Process an image
 * @param image {ArrayBuffer} - The image to process
 * @param cid {string} - The comic ID
 * @param eid {string} - The episode ID
 * @param page {number} - The page number
 * @param sourceKey {string} - The source key
 * @returns {Promise<ArrayBuffer>}
 */
async function processImage(image, cid, eid, page, sourceKey) {
  const upscaleQuery = buildQuery({
    cid,
    sourceKey,
    eid: eid || '',
    page: isFiniteNumber(page) ? String(page) : '',
    scale: '2',
    noise: '1',
    format: 'jpg',
    direct: '1'
  })
  const upscaleUrl = buildApiUrl('/upscale', upscaleQuery)

  const response = await fetch(upscaleUrl, {
    method: 'POST',
    body: image,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Accept': 'application/json,image/*'
    }
  })

  if (response.ok && isBinaryResponse(response)) {
    return response.arrayBuffer()
  }

  if (response.status === 413) {
    return Promise.resolve(image)
  }

  const payload = await parseJson(response)
  const data = payload && payload.data ? payload.data : payload
  if (!data || !data.taskId) {
    return Promise.resolve(image)
  }

  const downloadUrl = resolveDownloadUrl(data.downloadUrl, data.taskId)
  return pollUntilReady(downloadUrl)
}

function buildApiUrl(pathname, queryString) {
  const normalizedPath = pathname.charAt(0) === '/' ? pathname : '/' + pathname
  let basePath = apiBase.path
  if (basePath && basePath.charAt(0) !== '/') {
    basePath = '/' + basePath
  }
  const url = apiBase.origin + (basePath || '') + normalizedPath
  if (queryString) {
    return url + '?' + queryString
  }
  return url
}

function buildQuery(params) {
  const parts = []
  for (const key in params) {
    const value = params[key]
    if (value === undefined || value === null || value === '') continue
    parts.push(key + '=' + value)
  }
  return parts.join('&')
}

function resolveDownloadUrl(downloadUrl, taskId) {
  if (downloadUrl && startsWithHttp(downloadUrl)) {
    return downloadUrl
  }
  if (downloadUrl) {
    const normalized = downloadUrl.charAt(0) === '/' ? downloadUrl : '/' + downloadUrl
    return apiBase.origin + normalized
  }
  return buildApiUrl(`/download/${taskId}`)
}

async function pollUntilReady(downloadUrl) {
  const startedAt = Date.now()
  while (true) {
    const response = await fetch(downloadUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/octet-stream,image/*'
      }
    })

    if (response.status === 200 && isBinaryResponse(response)) {
      return response.arrayBuffer()
    }

    if (response.status === 202 && Date.now() - startedAt < POLL_TIMEOUT_MS) {
      await delay(POLL_INTERVAL_MS)
      continue
    }

    if (response.ok) {
      continue
    }

    const body = await safeText(response)
    const message = extractErrorMessage(body) || response.statusText
    throw new Error(`Download failed (${response.status}): ${message}`)
  }
}

function isBinaryResponse(response) {
  const type = response.headers['content-type'] || ''
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

function delay(ms) {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function normalizeBase(baseUrl) {
  const match = baseUrl.match(/^(https?:\/\/[^/]+)(\/.*)?$/i)
  if (!match) {
    throw new Error('Invalid API base URL')
  }
  const origin = match[1]
  const rawPath = match[2] || ''
  const trimmed = rawPath.endsWith('/') ? rawPath.slice(0, -1) : rawPath
  return {
    origin,
    path: trimmed === '/' ? '' : trimmed
  }
}

function startsWithHttp(value) {
  const lower = value.toLowerCase()
  return lower.startsWith('http://') || lower.startsWith('https://')
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

// Run this with venera Debug JS Evaluator to test your local server:
// processImage(new ArrayBuffer(8), 'test-cid', 'test-eid', 1, 'test-sourceKey')
