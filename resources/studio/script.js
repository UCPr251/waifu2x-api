const fileInput = document.getElementById('file-input')
const dropZone = document.getElementById('drop-zone')
const dropOverlay = document.getElementById('drop-overlay')
const previewPane = document.getElementById('preview-pane')
const previewMedia = previewPane?.querySelector('.preview-media')
const previewMeta = previewPane?.querySelector('.preview-meta')
const form = document.getElementById('upscale-form')
const resetBtn = document.getElementById('reset-btn')
const scaleSelect = document.getElementById('scale')
const scaleGroup = document.getElementById('scale-group')
const noiseButtons = document.getElementById('noise-group')
const noiseHidden = document.getElementById('noise')
const formatGroup = document.getElementById('format-group')
const formatSelect = document.getElementById('format')
const modelRadios = document.querySelectorAll('input[name="model"]')
const tileInput = document.getElementById('tile')
const gpuInput = document.getElementById('gpu')
const threadsInput = document.getElementById('threads')
const ttaInput = document.getElementById('tta')
const directInput = document.getElementById('direct')
const statusHint = document.getElementById('task-status-hint')
const taskIdCurrent = document.getElementById('task-id-current')
const etaDisplay = document.getElementById('eta-display')
const timelineEl = document.getElementById('status-timeline')
const resultPlaceholder = document.getElementById('result-placeholder')
const resultListEl = document.getElementById('result-list')
const toastStack = document.getElementById('toast-stack')
const themeToggle = document.getElementById('theme-toggle')
const yearEl = document.getElementById('year')

const MAX_SIZE_BYTES = 100 * 1024 * 1024
const SOURCE_KEY = 'web'
const CID_STORAGE_KEY = 'studioCid'
const CID_PATTERN = /^[a-z0-9]{16}$/
const MAX_TASK_RECORDS = 20
const STORAGE_KEYS = {
  params: 'studioParams',
  tasks: 'studioTasks'
}
const STEP_ORDER = ['upload', 'queue', 'process', 'download']

const stepElements = {}
const defaultStepDetails = {}
if (timelineEl) {
  STEP_ORDER.forEach(step => {
    const el = timelineEl.querySelector(`[data-step="${step}"]`)
    if (!el) return
    stepElements[step] = el
    const detailEl = el.querySelector('.text-muted')
    defaultStepDetails[step] = detailEl?.textContent?.trim() || ''
  })
}

const state = {
  file: null,
  buffer: null,
  previewUrl: '',
  sessionCid: '',
  taskRecords: [],
  previewCache: new Map(),
  activeTaskId: '',
  dropTimer: 0
}

init()

function init() {
  updateYear()
  initSessionCid()
  resetTimeline()
  applySavedParams(loadSavedParams())
  handleDropEvents()
  initPreviewInteractions()
  initNoiseButtons()
  initScaleButtons()
  initFormatButtons()
  bindParamPersistence()
  initForm()
  initResultListActions()
  initThemeToggle()
  restoreTasksFromStorage()
  estimateEta()
}

function initSessionCid() {
  const stored = readPersistedCid()
  if (stored) {
    state.sessionCid = stored
    return
  }
  const generated = generateRandomCid()
  state.sessionCid = generated
  persistCid(generated)
}

function readPersistedCid() {
  try {
    const value = localStorage.getItem(CID_STORAGE_KEY)
    if (typeof value === 'string' && CID_PATTERN.test(value)) {
      return value
    }
  } catch (error) {
    console.warn('读取 CID 失败', error)
  }
  return ''
}

function persistCid(cid) {
  try {
    localStorage.setItem(CID_STORAGE_KEY, cid)
  } catch (error) {
    console.warn('写入 CID 失败', error)
  }
}

function generateRandomCid(length = 16) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const cryptoObj = globalThis.crypto || globalThis.msCrypto
  if (cryptoObj?.getRandomValues) {
    const bytes = new Uint8Array(length)
    cryptoObj.getRandomValues(bytes)
    return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join('')
  }
  let result = ''
  for (let i = 0; i < length; i++) {
    result += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return result
}

function updateYear() {
  if (yearEl) {
    yearEl.textContent = String(new Date().getFullYear())
  }
}

function setStepState(step, status, detail) {
  const el = stepElements[step]
  if (!el) return
  el.dataset.state = status
  const detailEl = el.querySelector('.text-muted')
  if (detailEl) {
    const fallback = defaultStepDetails[step] || detailEl.textContent
    detailEl.textContent = detail && detail.length ? detail : fallback
  }
}

function resetTimeline() {
  STEP_ORDER.forEach((step, index) => {
    const initialState = index === 0 ? 'active' : 'pending'
    setStepState(step, initialState)
  })
  if (statusHint) statusHint.textContent = '等待开始'
  if (taskIdCurrent) taskIdCurrent.textContent = '—'
}

function markStepDone(step, detail, taskId) {
  if (!shouldUpdateTimeline(taskId)) return
  setStepState(step, 'done', detail)
}

function markStepActive(step, detail, taskId) {
  if (!shouldUpdateTimeline(taskId)) return
  setStepState(step, 'active', detail)
}

function shouldUpdateTimeline(taskId) {
  if (!taskId) return true
  if (!state.activeTaskId) return false
  return state.activeTaskId === taskId
}

function notify(type, message) {
  if (!toastStack) return
  const toast = document.createElement('div')
  toast.className = `toast ${type}`
  toast.innerHTML = `
    <span class="icon">${type === 'error' ? '<i class="fa-solid fa-circle-xmark"></i>' : type === 'success' ? '<i class="fa-solid fa-circle-check"></i>' : '<i class="fa-solid fa-circle-info"></i>'}</span>
    <span>${message}</span>
  `
  toastStack.appendChild(toast)
  setTimeout(() => {
    toast.classList.add('hide')
    setTimeout(() => toast.remove(), 300)
  }, 4000)
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '0 B'
  if (bytes < 1024) return `${bytes.toFixed(0)} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  return `${mb.toFixed(2)} MB`
}

function estimateEta() {
  if (!etaDisplay) return
  const scale = Number(scaleSelect?.value || 2)
  const noise = Number(noiseHidden?.value ?? 1)
  const base = scale >= 32 ? 40 : scale >= 16 ? 20 : scale >= 8 ? 10 : scale >= 4 ? 5 : scale >= 2 ? 3 : 1
  const ttaPenalty = ttaInput?.checked ? 2 : 1
  const etaBase = base * (1 + (noise + 1) * 0.3) * ttaPenalty
  let sizeFactor = 1
  if (state.file) {
    const sizeMB = state.file.size / (1024 * 1024)
    if (sizeMB > 0) {
      sizeFactor = sizeMB / 2
    }
  }
  const eta = etaBase * sizeFactor
  etaDisplay.textContent = `${Math.round(eta)} 秒`
}

function handleDropEvents() {
  const showOverlay = event => {
    if (!containsFiles(event)) return
    event.preventDefault()
    dropOverlay?.classList.remove('hidden')
  }

  const hideOverlayWithDelay = () => {
    clearTimeout(state.dropTimer)
    state.dropTimer = window.setTimeout(() => {
      dropOverlay?.classList.add('hidden')
    }, 120)
  };

  ['dragenter', 'dragover'].forEach(eventName => {
    window.addEventListener(eventName, event => {
      if (!containsFiles(event)) return
      showOverlay(event)
    })
  });

  ['dragleave', 'dragend'].forEach(eventName => {
    window.addEventListener(eventName, event => {
      if (!containsFiles(event)) return
      event.preventDefault()
      hideOverlayWithDelay()
    })
  })

  window.addEventListener('drop', event => {
    if (!containsFiles(event)) return
    event.preventDefault()
    const files = event.dataTransfer?.files
    if (files && files.length) setFile(files[0])
    dropOverlay?.classList.add('hidden')
  })

  document.addEventListener('dragover', event => {
    if (containsFiles(event)) event.preventDefault()
  })

  document.addEventListener('drop', event => {
    if (containsFiles(event)) event.preventDefault()
  })

  fileInput?.addEventListener('change', () => {
    if (fileInput.files && fileInput.files[0]) {
      setFile(fileInput.files[0])
    }
  })
}

function initPreviewInteractions() {
  if (!previewMedia) return
  previewMedia.addEventListener('click', event => {
    if (!(event.target instanceof Element)) return
    if (event.target.closest('[data-role="preview-remove"]')) {
      event.preventDefault()
      event.stopPropagation()
      clearSelectedFile()
      return
    }
    if (!state.file) return
    fileInput?.click()
  })
}

function containsFiles(event) {
  return Array.from(event.dataTransfer?.types || []).includes('Files')
}

function showPreview(file) {
  if (!previewPane || !previewMedia || !previewMeta) return
  if (state.previewUrl) {
    URL.revokeObjectURL(state.previewUrl)
    state.previewUrl = ''
  }
  const url = URL.createObjectURL(file)
  state.previewUrl = url
  dropZone?.classList.add('hidden')
  previewPane.classList.remove('hidden')
  previewMedia.classList.add('has-image')
  previewMedia.innerHTML = `
    <button type="button" class="preview-remove" data-role="preview-remove" aria-label="删除图片">
      <i class="fa-solid fa-trash-can"></i>
    </button>
    <img src="${url}" alt="预览" data-role="preview-image">
  `
  previewMeta.innerHTML = `
    <div class="preview-grid">
      <div><span>文件名</span><p>${file.name?.length > 12 ? file.name.slice(0, 12) + '...' : file.name}</p></div>
      <div><span>类型</span><p>${file.type || '—'}</p></div>
      <div><span>大小</span><p>${formatBytes(file.size)}</p></div>
      <div><span>分辨率</span><p data-role="resolution-value">-</p></div>
    </div>
  `
  const resolutionEl = previewMeta.querySelector('[data-role="resolution-value"]')
  const previewImg = previewMedia.querySelector('[data-role="preview-image"]')
  if (previewImg instanceof HTMLImageElement) {
    previewImg.addEventListener('load', () => {
      if (!resolutionEl) return
      const width = previewImg.naturalWidth
      const height = previewImg.naturalHeight
      if (!width || !height) return
      resolutionEl.textContent = `${width} × ${height}`
    }, { once: true })
  }
}

function clearSelectedFile() {
  if (state.previewUrl) {
    URL.revokeObjectURL(state.previewUrl)
    state.previewUrl = ''
  }
  state.file = null
  state.buffer = null
  if (fileInput) fileInput.value = ''
  previewMedia?.classList.remove('has-image')
  if (previewMedia) {
    previewMedia.innerHTML = ''
  }
  if (previewMeta) {
    previewMeta.innerHTML = ''
  }
  previewPane?.classList.add('hidden')
  dropZone?.classList.remove('hidden')
  estimateEta()
}

function setFile(file) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    notify('error', '仅支持 PNG / JPG / WebP')
    return
  }
  if (file.size > MAX_SIZE_BYTES) {
    notify('error', '文件超过 100 MB')
    return
  }
  state.file = file
  state.buffer = null
  showPreview(file)
  if (statusHint) statusHint.textContent = '已加载，等待提交'
  markStepActive('upload', '文件准备完成')
  estimateEta()
}

function getSelectedModel() {
  return Array.from(modelRadios).find(radio => radio.checked)?.value || 'models-cunet'
}

function captureCurrentParams() {
  return {
    scale: scaleSelect?.value || '2',
    noise: noiseHidden?.value || '1',
    model: getSelectedModel(),
    format: formatSelect?.value || 'jpg',
    tile: tileInput?.value?.trim() || '',
    gpu: gpuInput?.value?.trim() || '',
    threads: threadsInput?.value?.trim() || '',
    tta: Boolean(ttaInput?.checked),
    direct: Boolean(directInput?.checked)
  }
}

function buildParams(paramSnapshot) {
  const params = new URLSearchParams()
  params.set('sourceKey', SOURCE_KEY)
  params.set('cid', state.sessionCid)
  params.set('scale', paramSnapshot.scale)
  params.set('noise', paramSnapshot.noise)
  params.set('model', paramSnapshot.model)
  params.set('format', paramSnapshot.format)
  if (paramSnapshot.tile) params.set('tile', paramSnapshot.tile)
  if (paramSnapshot.gpu) params.set('gpu', paramSnapshot.gpu)
  if (paramSnapshot.threads) params.set('threads', paramSnapshot.threads)
  if (paramSnapshot.tta) params.set('tta', '1')
  if (paramSnapshot.direct) params.set('direct', '1')
  return params
}

async function ensureBuffer() {
  if (!state.file) throw new Error('请先选择图片')
  if (state.buffer) return state.buffer
  state.buffer = await state.file.arrayBuffer()
  return state.buffer
}

function createTaskRecord(taskId, paramSnapshot, overrides = {}) {
  return {
    taskId,
    sessionCid: state.sessionCid,
    sourceKey: SOURCE_KEY,
    params: paramSnapshot,
    fileName: `${taskId}.${paramSnapshot.format || 'jpg'}`,
    createdAt: Date.now(),
    status: 'queued',
    cached: false,
    previewUrl: '',
    ...overrides
  }
}

function normalizeDownloadUrl(downloadUrl, taskId) {
  const fallback = `/api/download/${taskId}`
  if (!downloadUrl) {
    return fallback
  }
  try {
    return new URL(downloadUrl, window.location.origin).toString()
  } catch (err) {
    console.error('Failed to normalize download url', err)
    return fallback
  }
}

function registerTaskRecord(record, options = {}) {
  const { persist = true } = options
  const existingIndex = state.taskRecords.findIndex(task => task.taskId === record.taskId)
  if (existingIndex >= 0) {
    state.taskRecords[existingIndex] = { ...state.taskRecords[existingIndex], ...record }
  } else {
    state.taskRecords.unshift(record)
  }
  if (state.taskRecords.length > MAX_TASK_RECORDS) {
    const removed = state.taskRecords.pop()
    if (removed) cleanupPreview(removed.taskId)
  }
  if (persist) {
    persistTaskRecords()
  }
  renderResultList()
  return record
}

function updateTaskRecord(taskId, patch, options = {}) {
  const { persist = true } = options
  const idx = state.taskRecords.findIndex(task => task.taskId === taskId)
  if (idx === -1) return null
  state.taskRecords[idx] = { ...state.taskRecords[idx], ...patch }
  if (persist) {
    persistTaskRecords()
  }
  renderResultList()
  return state.taskRecords[idx]
}

function persistTaskRecords() {
  const serializable = state.taskRecords
    .filter(task => !task.ephemeral)
    .map(task => {
      const { previewUrl, ...rest } = task
      return rest
    })
  try {
    localStorage.setItem(STORAGE_KEYS.tasks, JSON.stringify(serializable))
  } catch (err) {
    console.error('Failed to persist task records', err)
  }
}

function loadSavedTasks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.tasks)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
  } catch (err) {
    console.error('Failed to parse saved tasks', err)
    return []
  }
}

function restoreTasksFromStorage() {
  const saved = loadSavedTasks()
  state.taskRecords = saved.map(task => ({ ...task, previewUrl: '' }))
  renderResultList()
  state.taskRecords.forEach(task => {
    if (task.status === 'completed' && task.downloadUrl) {
      warmPreview(task)
    } else if (task.status === 'queued' || task.status === 'processing') {
      resumeTaskDownload(task)
    }
  })
}

function renderResultList() {
  if (!resultListEl) return
  if (!state.taskRecords.length) {
    resultPlaceholder?.classList.remove('hidden')
    resultListEl.classList.add('hidden')
    resultListEl.innerHTML = ''
    return
  }
  resultPlaceholder?.classList.add('hidden')
  resultListEl.classList.remove('hidden')
  const fragment = document.createDocumentFragment()
  state.taskRecords.forEach(task => {
    fragment.appendChild(renderResultCard(task))
  })
  resultListEl.replaceChildren(fragment)
}

function renderResultCard(task) {
  const card = document.createElement('article')
  card.className = 'result-card xl:max-w-md'
  card.dataset.taskId = task.taskId

  const summary = formatTaskSummary(task)
  const status = formatResultStatus(task)
  const timeText = formatRelativeTime(task.createdAt)
  const placeholderState = resolvePlaceholderState(task)
  const placeholderText = resolvePlaceholderText(placeholderState)
  const showSpinner = placeholderNeedsSpinner(placeholderState)
  const placeholderAttrs = `${showSpinner ? ' data-loading="true"' : ''}`

  card.innerHTML = `
    <div class="result-thumb">
      <button type="button" class="result-remove" data-action="remove" aria-label="删除结果">
        <i class="fa-solid fa-xmark"></i>
      </button>
      <div class="thumb-placeholder" data-role="thumb-placeholder" data-status="${placeholderState}"${placeholderAttrs}>
        ${showSpinner ? '<span class="thumb-spinner" aria-hidden="true"></span>' : ''}
        <p>${placeholderText}</p>
      </div>
      <img data-role="thumb-image" alt="处理结果">
      <div class="result-meta-badge">${summary}</div>
    </div>
    <div class="result-info">
      <div>
        <p class="font-semibold text-sm">${task.taskId.slice(0, 8)}</p>
        <p class="result-status">${status}</p>
      </div>
      <div class="text-xs text-muted flex items-center gap-1">
        <i class="fa-solid fa-clock"></i>
        <span>${timeText}</span>
      </div>
    </div>
    <div class="result-actions">
      <button type="button" class="btn-ghost" data-action="copy">
        <i class="fa-solid fa-link"></i>
        复制
      </button>
      <a class="btn-primary" data-action="download" target="_blank" rel="noopener">
        <i class="fa-solid fa-download"></i>
        下载
      </a>
    </div>
  `

  const placeholderEl = card.querySelector('[data-role="thumb-placeholder"]')
  const imageEl = card.querySelector('[data-role="thumb-image"]')
  bindResultImage(imageEl, placeholderEl, task.previewUrl)

  const downloadLink = card.querySelector('[data-action="download"]')
  if (downloadLink instanceof HTMLAnchorElement) {
    if (task.downloadUrl) {
      downloadLink.href = task.downloadUrl
      downloadLink.download = task.fileName || 'waifu2x'
      downloadLink.removeAttribute('aria-disabled')
    } else {
      downloadLink.setAttribute('aria-disabled', 'true')
    }
  }

  return card
}

function resolvePlaceholderState(task) {
  if (task.previewUrl) return 'preview'
  if (task.status === 'processing') return 'processing'
  if (task.status === 'failed') return 'failed'
  return 'queue'
}

function resolvePlaceholderText(state) {
  switch (state) {
    case 'preview':
      return '加载预览中…'
    case 'processing':
      return '正在处理中…'
    case 'queue':
      return '正在排队中…'
    case 'failed':
      return '任务失败，稍后重试'
    default:
      return '处理中…'
  }
}

function placeholderNeedsSpinner(state) {
  return state === 'preview' || state === 'processing' || state === 'queue'
}

function bindResultImage(imageEl, placeholderEl, src) {
  if (!(imageEl instanceof HTMLImageElement) || !placeholderEl) return
  imageEl.classList.remove('is-loaded')
  if (!src) {
    placeholderEl.classList.remove('is-hidden')
    imageEl.removeAttribute('src')
    return
  }
  const handleLoad = () => {
    imageEl.classList.add('is-loaded')
    placeholderEl.classList.add('is-hidden')
  }
  imageEl.addEventListener('load', handleLoad, { once: true })
  imageEl.src = src
  if (imageEl.complete && imageEl.naturalWidth > 0) {
    handleLoad()
  } else {
    placeholderEl.classList.remove('is-hidden')
  }
}

function formatTaskSummary(task) {
  const scale = task.params?.scale || '2'
  const noise = task.params?.noise ?? '1'
  const format = (task.params?.format || 'jpg').toUpperCase()
  let summary = `${scale}x · noise${noise} · ${format}`
  if (task.params?.tta) {
    summary += ' · TTA'
  }
  return summary
}

function formatResultStatus(task) {
  if (task.status === 'completed') {
    const sizeLabel = task.size ? formatBytes(task.size) : ''
    return sizeLabel ? `完成 · ${sizeLabel}` : '完成'
  }
  if (task.status === 'failed') {
    return task.error || '任务失败'
  }
  if (task.status === 'processing') {
    return '处理中，稍候可下载'
  }
  return '等待排队'
}

function formatRelativeTime(timestamp) {
  const now = Date.now()
  const diff = Math.max(0, now - timestamp)
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return `${seconds || 1} 秒前`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  return `${days} 天前`
}

function normalizeRemoteStatus(status) {
  if (typeof status !== 'string') return ''
  const value = status.toLowerCase()
  if (['processing', 'running', 'working'].includes(value)) return 'processing'
  if (['queued', 'queue', 'waiting', 'pending'].includes(value)) return 'queued'
  if (['completed', 'done', 'finished', 'success'].includes(value)) return 'completed'
  if (['failed', 'error'].includes(value)) return 'failed'
  return ''
}

function updateTaskStatus(taskId, nextStatus) {
  const normalized = normalizeRemoteStatus(nextStatus)
  if (!normalized) return null
  const existing = state.taskRecords.find(task => task.taskId === taskId)
  if (!existing || existing.status === normalized) return existing
  return updateTaskRecord(taskId, { status: normalized })
}

function applyPollingFeedback(taskId, payload, options = {}) {
  const { silent = false } = options
  const detail = payload?.data?.detail || payload?.detail || payload?.message || ''
  const remoteStatus = normalizeRemoteStatus(payload?.data?.status ?? payload?.status)
  if (remoteStatus) {
    updateTaskStatus(taskId, remoteStatus)
    if (!silent && remoteStatus === 'processing') {
      markStepActive('process', detail || 'waifu2x 运行中...', taskId)
    }
  }
  if (!silent && statusHint) {
    if (detail) {
      statusHint.textContent = detail
    } else if (remoteStatus === 'processing') {
      statusHint.textContent = '任务状态：正在处理中……'
    } else if (remoteStatus === 'queued') {
      statusHint.textContent = '任务状态：正在排队中……'
    } else {
      statusHint.textContent = '任务状态：未知'
    }
  }
}

function initResultListActions() {
  resultListEl?.addEventListener('click', event => {
    if (!(event.target instanceof Element)) return
    const actionTarget = event.target.closest('[data-action]')
    if (!actionTarget) return
    const card = actionTarget.closest('.result-card')
    if (!card) return
    const taskId = card.dataset.taskId
    const task = state.taskRecords.find(item => item.taskId === taskId)
    if (!task) return
    const action = actionTarget.dataset.action
    if (action === 'copy') {
      handleCopyLink(task)
    } else if (action === 'remove') {
      handleRemoveTask(taskId)
    } else if (action === 'download') {
      if (!task.downloadUrl) {
        event.preventDefault()
        notify('error', '结果尚未生成，稍后再试')
      }
    }
  })
}

async function handleCopyLink(task) {
  if (!task.downloadUrl) {
    notify('error', '结果尚未生成')
    return
  }
  try {
    await navigator.clipboard.writeText(normalizeDownloadUrl(task.downloadUrl, task.taskId))
    notify('success', '下载链接已复制')
  } catch (err) {
    console.error(err)
    notify('error', '复制失败，可手动选中地址栏')
  }
}

function handleRemoveTask(taskId) {
  const idx = state.taskRecords.findIndex(task => task.taskId === taskId)
  if (idx === -1) return
  const [removed] = state.taskRecords.splice(idx, 1)
  cleanupPreview(taskId)
  persistTaskRecords()
  renderResultList()
  if (removed?.taskId === state.activeTaskId) {
    resetTimeline()
  }
}

function cleanupPreview(taskId) {
  const previewUrl = state.previewCache.get(taskId)
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl)
    state.previewCache.delete(taskId)
  }
}

async function submitTask() {
  if (!state.file) {
    notify('error', '请选择图片后再提交')
    return
  }
  resetTimeline()
  const button = form?.querySelector('button[type="submit"]')
  if (button) {
    button.classList.add('loading')
    button.disabled = true
  }
  const paramSnapshot = captureCurrentParams()
  const params = buildParams(paramSnapshot)
  if (statusHint) statusHint.textContent = '上传中...'
  try {
    const buffer = await ensureBuffer()
    const res = await fetch(`/api/upscale?${params.toString()}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream'
      },
      body: buffer
    })
    const contentType = res.headers.get('content-type') || ''

    markStepDone('upload', '文件已上传')

    if (res.ok && !contentType.includes('application/json')) {
      const blob = await res.blob()
      const headerTaskId = res.headers.get('x-task-id')?.trim() || ''
      const recordTaskId = headerTaskId || `instant-${Date.now()}`
      const remoteDownloadUrl = headerTaskId ? normalizeDownloadUrl('', recordTaskId) : ''
      state.activeTaskId = recordTaskId
      const record = createTaskRecord(recordTaskId, paramSnapshot, {
        status: 'completed',
        downloadUrl: remoteDownloadUrl,
        ephemeral: !headerTaskId
      })
      registerTaskRecord(record, { persist: Boolean(headerTaskId) })
      await handleTaskBlob(recordTaskId, blob, contentType || 'image/jpeg', {
        remoteUrl: remoteDownloadUrl || undefined,
        silent: true
      })
      notify('success', '已直接返回缓存结果')
      markStepDone('queue', '直出完成', recordTaskId)
      markStepDone('process', '无需排队', recordTaskId)
      markStepDone('download', '结果已生成', recordTaskId)
      if (statusHint) statusHint.textContent = '已返回结果'
      if (taskIdCurrent) taskIdCurrent.textContent = headerTaskId || '即时'
      return
    }

    const payload = await res.json().catch(() => null)
    const data = payload?.data
    if (!res.ok) {
      const message = payload?.error || '提交失败'
      throw new Error(message)
    }
    if (!data?.taskId) {
      throw new Error('未收到任务 ID')
    }

    const taskId = data.taskId
    const downloadUrl = normalizeDownloadUrl(data.downloadUrl, taskId)
    state.activeTaskId = taskId
    if (taskIdCurrent) taskIdCurrent.textContent = taskId
    const initialStatus = data.status === 'completed' ? 'completed' : (data.status || 'queued')
    const record = createTaskRecord(taskId, paramSnapshot, {
      status: initialStatus,
      cached: Boolean(data.cached),
      downloadUrl
    })
    registerTaskRecord(record)

    if (statusHint) {
      statusHint.textContent = record.cached ? '命中缓存，立即拉取' : '已排队，等待下载'
    }
    await waitForTaskResult(record)
  } catch (error) {
    console.error(error)
    notify('error', error instanceof Error ? error.message : '任务失败')
    if (statusHint) statusHint.textContent = '任务失败'
    markStepActive('download', '等待重试', state.activeTaskId || undefined)
    if (state.activeTaskId) {
      updateTaskRecord(state.activeTaskId, {
        status: 'failed',
        error: error instanceof Error ? error.message : '任务失败'
      })
    }
  } finally {
    if (button) {
      button.disabled = false
      button.classList.remove('loading')
    }
  }
}

async function waitForTaskResult(task, options = {}) {
  const { silent = false } = options
  if (!task.downloadUrl) return
  if (!silent) {
    markStepActive('queue', '队列中……', task.taskId)
  }
  const start = Date.now()
  for (let attempt = 0; attempt < 600; attempt++) {
    const res = await fetch(task.downloadUrl, { cache: 'no-store' })
    if (res.status === 200) {
      if (!silent) {
        markStepDone('process', '任务完成', task.taskId)
      }
      const blob = await res.blob()
      await handleTaskBlob(task.taskId, blob, res.headers.get('content-type') || 'image/jpeg', {
        remoteUrl: task.downloadUrl,
        silent
      })
      const duration = ((Date.now() - start) / 1000).toFixed(1)
      if (!silent && statusHint) statusHint.textContent = `下载完成，用时 ${duration}s`
      if (!silent) {
        markStepDone('download', '结果已获取', task.taskId)
        notify('success', '超分完成，已生成下载链接')
      }
      return
    }

    const payload = await res.json().catch(() => null)
    const data = payload?.data || {}
    if (res.status === 202) {
      if (data?.status) {
        if (data.status === 'processing' && !silent) {
          markStepDone('queue', '排队完成', task.taskId)
          markStepActive('process', '超分中...', task.taskId)
        }
      }
      applyPollingFeedback(task.taskId, payload, { silent })
      await wait(1000)
      continue
    }

    let message = '下载失败'
    if (payload?.error) message = payload.error
    throw new Error(message)
  }
  throw new Error('超时，任务仍在进行中，可稍后在日志中查看')
}

async function resumeTaskDownload(task) {
  try {
    await waitForTaskResult(task, { silent: true })
  } catch (err) {
    console.warn('Resume task failed', err)
  }
}

async function warmPreview(task) {
  if (state.previewCache.has(task.taskId) || !task.downloadUrl) return
  try {
    const res = await fetch(task.downloadUrl, { cache: 'force-cache' })
    if (!res.ok) return
    const blob = await res.blob()
    await handleTaskBlob(task.taskId, blob, res.headers.get('content-type') || 'image/jpeg', {
      remoteUrl: task.downloadUrl,
      silent: true
    })
  } catch (err) {
    console.warn('Preview load failed', err)
  }
}

async function handleTaskBlob(taskId, blob, mime, options = {}) {
  const { remoteUrl, silent } = options
  const existing = state.previewCache.get(taskId)
  if (existing) URL.revokeObjectURL(existing)
  const objectUrl = URL.createObjectURL(blob)
  state.previewCache.set(taskId, objectUrl)
  const previous = state.taskRecords.find(task => task.taskId === taskId)
  const updated = updateTaskRecord(taskId, {
    status: 'completed',
    size: blob.size,
    mime,
    downloadUrl: remoteUrl || previous?.downloadUrl || objectUrl,
    previewUrl: objectUrl
  }, { persist: false })
  if (!silent && statusHint) {
    statusHint.textContent = '结果已生成，支持多任务预览'
  }
  if (!updated?.ephemeral) {
    persistTaskRecords()
  }
}

function initNoiseButtons() {
  noiseButtons?.addEventListener('click', event => {
    const target = event.target
    if (!(target instanceof HTMLButtonElement)) return
    const noiseValue = target.dataset.noise
    if (noiseValue == null) return
    noiseHidden.value = noiseValue
    updateNoiseButtons(noiseValue)
    persistParams()
    estimateEta()
  })
  updateNoiseButtons(noiseHidden?.value || '1')
}

function updateNoiseButtons(activeValue) {
  noiseButtons?.querySelectorAll('button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.noise === String(activeValue))
  })
}

function initScaleButtons() {
  scaleGroup?.addEventListener('click', event => {
    if (!(event.target instanceof Element)) return
    const button = event.target.closest('button[data-scale]')
    if (!button) return
    const value = button.dataset.scale
    if (!value || !scaleSelect) return
    scaleSelect.value = value
    updateScaleButtons(value)
    persistParams()
    estimateEta()
  })
  updateScaleButtons(scaleSelect?.value || '2')
}

function updateScaleButtons(activeValue) {
  scaleGroup?.querySelectorAll('button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.scale === String(activeValue))
  })
}

function initFormatButtons() {
  formatGroup?.addEventListener('click', event => {
    if (!(event.target instanceof Element)) return
    const button = event.target.closest('button[data-format]')
    if (!button) return
    const value = button.dataset.format
    if (!value || !formatSelect) return
    formatSelect.value = value
    updateFormatButtons(value)
    persistParams()
  })
  updateFormatButtons(formatSelect?.value || 'jpg')
}

function updateFormatButtons(activeValue) {
  formatGroup?.querySelectorAll('button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.format === String(activeValue))
  })
}

function bindParamPersistence() {
  const inputs = [tileInput, gpuInput, threadsInput]
  inputs.forEach(input => {
    input?.addEventListener('change', persistParams)
  })
  modelRadios.forEach(radio => radio.addEventListener('change', persistParams))
  ttaInput?.addEventListener('change', () => {
    persistParams()
    estimateEta()
  })
  directInput?.addEventListener('change', persistParams)
}

function persistParams() {
  try {
    localStorage.setItem(STORAGE_KEYS.params, JSON.stringify(captureCurrentParams()))
  } catch (err) {
    console.error('Failed to persist params', err)
  }
}

function loadSavedParams() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.params)
    if (!raw) return null
    return JSON.parse(raw)
  } catch (err) {
    console.error('Failed to parse saved params', err)
    return null
  }
}

function applySavedParams(params) {
  if (!params) return
  if (scaleSelect && params.scale) scaleSelect.value = params.scale
  if (noiseHidden && params.noise) noiseHidden.value = params.noise
  updateNoiseButtons(noiseHidden?.value || '1')
  updateScaleButtons(scaleSelect?.value || '2')
  if (formatSelect && params.format) formatSelect.value = params.format
  updateFormatButtons(formatSelect?.value || 'jpg')
  if (tileInput && typeof params.tile === 'string') tileInput.value = params.tile
  if (gpuInput && typeof params.gpu === 'string') gpuInput.value = params.gpu
  if (threadsInput && typeof params.threads === 'string') threadsInput.value = params.threads
  if (ttaInput) ttaInput.checked = Boolean(params.tta)
  if (directInput) directInput.checked = Boolean(params.direct)
  if (params.model) {
    const radio = Array.from(modelRadios).find(el => el.value === params.model)
    if (radio) radio.checked = true
  }
}

function initForm() {
  form?.addEventListener('submit', event => {
    event.preventDefault()
    submitTask()
  })
  resetBtn?.addEventListener('click', () => {
    form?.reset()
    noiseHidden.value = '1'
    updateNoiseButtons('1')
    updateScaleButtons(scaleSelect?.value || '2')
    updateFormatButtons(formatSelect?.value || 'jpg')
    clearSelectedFile()
    state.activeTaskId = ''
    persistParams()
    estimateEta()
    notify('info', '已恢复默认参数')
  })
}

function initThemeToggle() {
  if (!themeToggle) return
  themeToggle.addEventListener('click', () => {
    const hour = new Date().getHours()
    const defaultMode = (hour >= 20 || hour < 8) ? 'dark' : 'light'
    const current = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
    const next = current === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    if (defaultMode !== next) {
      localStorage.setItem('theme', next)
    } else {
      localStorage.removeItem('theme')
    }
  })
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
