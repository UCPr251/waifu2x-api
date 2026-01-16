const logContainer = document.getElementById('log-container')
const totalCountDisplay = document.getElementById('total-count')
const currentTimeDisplay = document.getElementById('current-time')
const LOG_TYPES = ['DEBU', 'INFO', 'MARK', 'WARN', 'ERRO']
const logTypeInputs = Array.from(document.querySelectorAll('input[data-log-type]'))
const retainSelect = document.getElementById('retain-count')
const mobileRetainSelect = document.getElementById('mobile-retain-count')
const fontSizeSelect = document.getElementById('font-size')
const mobileFontSizeSelect = document.getElementById('mobile-font-size')
const lineHeightSelect = document.getElementById('line-height')
const mobileLineHeightSelect = document.getElementById('mobile-line-height')
const scrollIndicator = document.getElementById('scroll-indicator')
const clearBtn = document.getElementById('clear-btn')
const mobileClearBtn = document.getElementById('mobile-clear-btn')
const mobileMenuBtn = document.getElementById('mobile-menu-btn')
const closeMenuBtn = document.getElementById('close-menu-btn')
const mobileMenu = document.getElementById('mobile-menu')
const includeRegexInput = document.getElementById('include-regex-input')
const excludeRegexInput = document.getElementById('exclude-regex-input')
const includeRegexListEl = document.getElementById('include-regex-list')
const excludeRegexListEl = document.getElementById('exclude-regex-list')
const addIncludeRegexBtn = document.getElementById('add-include-regex')
const addExcludeRegexBtn = document.getElementById('add-exclude-regex')

let logData = []
let nextBatchLogdata = []
let totalLogCount = 0
let infoCount = 0
let autoScroll = true
let retainLimit = 200
let selectedLogTypes = new Set(LOG_TYPES)
let includeRegexPatterns = []
let excludeRegexPatterns = []
let includeRegexObjects = []
let excludeRegexObjects = []
const renderInterval = 100

const ansiUp = new AnsiUp()

function updateCurrentTime() {
  const now = new Date()
  currentTimeDisplay.textContent = now.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

let renderTimer = null
function processLogEvent(data) {
  const logType = data.slice(20, 24)
  const convertedHtml = ansiUp.ansi_to_html(data)
  const logdata = { type: logType, html: convertedHtml, raw: data }
  logData.push(logdata)
  totalLogCount++
  totalCountDisplay.textContent = `日志数：${totalLogCount}`
  if (logType === 'INFO') infoCount++
  if (retainLimit > 0) {
    const max = Math.max(2000, retainLimit) // 至少保留最近2000条日志可随时查看
    if (logData.length > max) {
      logData.splice(0, logData.length - max)
    }
  }
  if (shouldDisplayLog(logdata)) {
    nextBatchLogdata.push(logdata)
  }
  if (!renderTimer) {
    renderTimer = setTimeout(() => {
      requestAnimationFrame(renderLogs)
      renderTimer = null
    }, renderInterval)
  }
}

function shouldDisplayLog(log) {
  if (!selectedLogTypes.size || !selectedLogTypes.has(log.type)) return false
  const content = log.raw ?? ''
  if (includeRegexObjects.length && !includeRegexObjects.some(regex => regex.test(content))) return false
  if (excludeRegexObjects.length && excludeRegexObjects.some(regex => regex.test(content))) return false
  return true
}

// 将日志按批次渲染
const batchSize = 300

function renderLogs() {
  if (!nextBatchLogdata.length) return
  if (logContainer.firstElementChild?.classList.contains('italic')) {
    logContainer.innerHTML = ''
  }
  // 获取最后一个batch容器
  const lastBatch = logContainer.lastElementChild?.classList.contains('log-batch-container')
    ? logContainer.lastElementChild
    : null
  let remainingLogs = [...nextBatchLogdata] // 剩余待处理的日志
  // 如果存在最后一个batch且未满，先填充它
  if (lastBatch) {
    const currentCount = lastBatch.childElementCount
    const availableSpace = batchSize - currentCount
    if (availableSpace > 0) {
      // 计算可填充的日志数量
      const fillCount = Math.min(availableSpace, remainingLogs.length)
      const fillLogs = remainingLogs.splice(0, fillCount)
      // 创建文档片段填充到最后一个batch
      const fragment = document.createDocumentFragment()
      fillLogs.forEach(log => {
        const el = document.createElement('div')
        el.className = 'log-line'
        el.innerHTML = log.html
        fragment.appendChild(el)
      })
      lastBatch.appendChild(fragment)
    }
  }

  // 处理剩余的日志，按batchSize创建新容器
  if (remainingLogs.length > 0) {
    for (let i = 0; i < remainingLogs.length; i += batchSize) {
      const batch = remainingLogs.slice(i, i + batchSize)
      const fragment = document.createDocumentFragment()
      batch.forEach(log => {
        const el = document.createElement('div')
        el.className = 'log-line'
        el.innerHTML = log.html
        fragment.appendChild(el)
      })
      const batchContainer = document.createElement('div')
      batchContainer.className = 'log-batch-container'
      batchContainer.appendChild(fragment)
      logContainer.appendChild(batchContainer)
    }
  }
  nextBatchLogdata = []
  // 处理日志行数限制
  if (retainLimit > 0) {
    // 计算所有batch容器的总日志数
    let totalLines = 0
    for (const batch of logContainer.children) {
      totalLines += batch.childElementCount
    }
    console.log('Total log lines in DOM:', totalLines)
    // 如果超出限制，移除最前面的日志
    let extra = totalLines - retainLimit
    if (extra > 0) {
      while (extra > 0) {
        const firstBatch = logContainer.firstElementChild
        if (!firstBatch) break
        const batchLines = firstBatch.childElementCount
        if (batchLines <= extra) {
          // 移除整个batch
          logContainer.removeChild(firstBatch)
          extra -= batchLines
        } else {
          // 只移除部分日志
          while (extra > 0) {
            firstBatch.removeChild(firstBatch.firstElementChild)
            extra--
          }
        }
      }
    }
  }
  if (autoScroll) scrollToBottom()
}

function rerenderLogs() {
  logContainer.innerHTML = ''
  let logsToShow = []
  if (!retainLimit) {
    logsToShow = logData.filter(shouldDisplayLog)
  } else {
    const limited = []
    for (let i = logData.length - 1; i >= 0; i--) {
      const log = logData[i]
      if (shouldDisplayLog(log)) {
        limited.push(log)
        if (limited.length >= retainLimit) break
      }
    }
    logsToShow = limited.reverse()
  }
  if (logsToShow.length === 0) {
    const emptyMsg = document.createElement('div')
    emptyMsg.className = 'text-gray-500 italic log-line text-center py-10'
    emptyMsg.textContent = '暂无日志……'
    logContainer.appendChild(emptyMsg)
    return
  }
  for (let i = 0; i < logsToShow.length; i += batchSize) {
    const batch = logsToShow.slice(i, i + batchSize)
    const fragment = document.createDocumentFragment()
    batch.forEach(log => {
      const el = document.createElement('div')
      el.className = 'log-line'
      el.innerHTML = log.html
      fragment.appendChild(el)
    })
    const batchContainer = document.createElement('div')
    batchContainer.className = 'log-batch-container'
    batchContainer.appendChild(fragment)
    logContainer.appendChild(batchContainer)
  }
  if (autoScroll) scrollToBottom()
}

function scrollToBottom() {
  logContainer.scrollTop = logContainer.scrollHeight
}

function adjustRetainLimit(limit) {
  if (!limit) return
  localStorage.setItem('retainLimit', limit)
  retainLimit = parseInt(limit)
  retainSelect.value = limit
  mobileRetainSelect.value = limit
  rerenderLogs()
}

function adjustFontSize(size) {
  if (!size) return
  localStorage.setItem('fontSize', size)
  logContainer.style.fontSize = `${size}px`
  fontSizeSelect.value = size
  mobileFontSizeSelect.value = size
}

function adjustLineHeight(height) {
  if (!height) return
  localStorage.setItem('lineHeight', height)
  logContainer.style.lineHeight = height
  lineHeightSelect.value = height
  mobileLineHeightSelect.value = height
}

function saveLogTypeSelection() {
  localStorage.setItem('logTypes', JSON.stringify(Array.from(selectedLogTypes)))
}

function syncLogTypeInputs() {
  logTypeInputs.forEach(input => {
    const type = input.dataset.logType
    if (!type) return
    input.checked = selectedLogTypes.has(type)
  })
}

function handleLogTypeChange(type, checked) {
  if (!type || !LOG_TYPES.includes(type)) return
  if (checked) {
    selectedLogTypes.add(type)
  } else {
    selectedLogTypes.delete(type)
  }
  saveLogTypeSelection()
  syncLogTypeInputs()
  rerenderLogs()
}

function restoreLogTypeSelection() {
  let applied = false
  try {
    const stored = localStorage.getItem('logTypes')
    if (stored) {
      const parsed = JSON.parse(stored)
      if (Array.isArray(parsed)) {
        const valid = parsed.filter(type => LOG_TYPES.includes(type))
        selectedLogTypes = new Set(valid)
        applied = true
      }
    }
  } catch {
    applied = false
  }
  if (!applied) {
    selectedLogTypes = new Set(LOG_TYPES)
  }
  syncLogTypeInputs()
}

function createRegexFromString(raw) {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  let pattern = trimmed
  let flags = ''
  if (pattern.startsWith('/') && pattern.lastIndexOf('/') > 0) {
    const lastSlash = pattern.lastIndexOf('/')
    const maybeFlags = pattern.slice(lastSlash + 1)
    if (/^[a-z]*$/i.test(maybeFlags)) {
      pattern = pattern.slice(1, lastSlash)
      flags = maybeFlags
    }
  }
  try {
    return new RegExp(pattern, flags)
  } catch {
    return null
  }
}

function rebuildRegexObjects() {
  includeRegexObjects = includeRegexPatterns
    .map(pattern => createRegexFromString(pattern))
    .filter(Boolean)
  excludeRegexObjects = excludeRegexPatterns
    .map(pattern => createRegexFromString(pattern))
    .filter(Boolean)
}

function renderRegexList(type) {
  const list = type === 'include' ? includeRegexPatterns : excludeRegexPatterns
  const container = type === 'include' ? includeRegexListEl : excludeRegexListEl
  if (!container) return
  container.innerHTML = ''
  if (!list.length) {
    const placeholder = document.createElement('span')
    placeholder.className = 'text-gray-500 text-xs'
    placeholder.textContent = '未添加规则'
    container.appendChild(placeholder)
    return
  }
  list.forEach((pattern, index) => {
    const chip = document.createElement('span')
    chip.className = 'flex items-center gap-2 bg-gray-800 border border-gray-700 rounded px-2 py-1'
    const text = document.createElement('span')
    text.textContent = pattern
    text.className = 'text-gray-200'
    const removeBtn = document.createElement('button')
    removeBtn.type = 'button'
    removeBtn.className = 'text-gray-400 hover:text-red-400 transition-colors text-xs'
    removeBtn.dataset.regexIndex = String(index)
    removeBtn.dataset.regexType = type
    removeBtn.setAttribute('data-remove-regex', 'true')
    removeBtn.textContent = '×'
    chip.appendChild(text)
    chip.appendChild(removeBtn)
    container.appendChild(chip)
  })
}

function handleRegexAdd(type) {
  const input = type === 'include' ? includeRegexInput : excludeRegexInput
  if (!input) return
  const value = input.value.trim()
  if (!value) return
  const regex = createRegexFromString(value)
  if (!regex) {
    alert('无效的正则表达式')
    return
  }
  const targetList = type === 'include' ? includeRegexPatterns : excludeRegexPatterns
  targetList.push(value)
  input.value = ''
  rebuildRegexObjects()
  renderRegexList(type)
  saveRegexList(type)
  rerenderLogs()
}

function handleRegexRemove(type, index) {
  const targetList = type === 'include' ? includeRegexPatterns : excludeRegexPatterns
  if (index < 0 || index >= targetList.length) return
  targetList.splice(index, 1)
  rebuildRegexObjects()
  renderRegexList(type)
  saveRegexList(type)
  rerenderLogs()
}

function saveRegexList(type) {
  const key = type === 'include' ? 'includeRegexFilters' : 'excludeRegexFilters'
  const list = type === 'include' ? includeRegexPatterns : excludeRegexPatterns
  localStorage.setItem(key, JSON.stringify(list))
}

function loadRegexFilters() {
  includeRegexPatterns = readRegexListFromStorage('includeRegexFilters')
  excludeRegexPatterns = readRegexListFromStorage('excludeRegexFilters')
  rebuildRegexObjects()
  renderRegexList('include')
  renderRegexList('exclude')
}

function readRegexListFromStorage(key) {
  try {
    const stored = JSON.parse(localStorage.getItem(key) || '[]')
    if (Array.isArray(stored)) {
      return stored.filter(item => typeof item === 'string' && item.trim())
    }
  } catch {
    // ignore
  }
  return []
}

logTypeInputs.forEach(input => {
  input.addEventListener('change', () => handleLogTypeChange(input.dataset.logType, input.checked))
})
retainSelect.addEventListener('change', e => adjustRetainLimit(e.target.value))
mobileRetainSelect.addEventListener('change', e => adjustRetainLimit(e.target.value))
fontSizeSelect.addEventListener('change', e => adjustFontSize(e.target.value))
mobileFontSizeSelect.addEventListener('change', e => adjustFontSize(e.target.value))
lineHeightSelect.addEventListener('change', e => adjustLineHeight(e.target.value))
mobileLineHeightSelect.addEventListener('change', e => adjustLineHeight(e.target.value))
if (addIncludeRegexBtn) addIncludeRegexBtn.addEventListener('click', () => handleRegexAdd('include'))
if (addExcludeRegexBtn) addExcludeRegexBtn.addEventListener('click', () => handleRegexAdd('exclude'))
if (includeRegexInput) {
  includeRegexInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleRegexAdd('include')
    }
  })
}
if (excludeRegexInput) {
  excludeRegexInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleRegexAdd('exclude')
    }
  })
}
if (includeRegexListEl) {
  includeRegexListEl.addEventListener('click', e => {
    const target = e.target.closest('[data-remove-regex]')
    if (!target) return
    e.stopPropagation()
    const index = Number(target.dataset.regexIndex)
    if (Number.isNaN(index)) return
    handleRegexRemove('include', index)
  })
}
if (excludeRegexListEl) {
  excludeRegexListEl.addEventListener('click', e => {
    const target = e.target.closest('[data-remove-regex]')
    if (!target) return
    e.stopPropagation()
    const index = Number(target.dataset.regexIndex)
    if (Number.isNaN(index)) return
    handleRegexRemove('exclude', index)
  })
}

clearBtn.addEventListener('click', clearLogs)
mobileClearBtn.addEventListener('click', () => { clearLogs(); mobileMenu.classList.remove('show') })

function clearLogs() {
  logData = []
  nextBatchLogdata = []
  totalLogCount = 0
  infoCount = 0
  totalCountDisplay.textContent = '日志数：0'
  logContainer.innerHTML = '<div class="text-gray-500 italic log-line text-center py-10">日志已清空，等待接收新日志...</div>'
}

logContainer.addEventListener('scroll', () => {
  const threshold = 50
  const isNearBottom = logContainer.scrollHeight - logContainer.scrollTop - logContainer.clientHeight < threshold
  if (!isNearBottom && autoScroll) {
    autoScroll = false
    scrollIndicator.classList.remove('hidden')
  } else if (isNearBottom && !autoScroll) {
    autoScroll = true
    scrollIndicator.classList.add('hidden')
  }
})

scrollIndicator.addEventListener('click', () => {
  autoScroll = true
  scrollToBottom()
  scrollIndicator.classList.add('hidden')
})

mobileMenuBtn.addEventListener('click', () => mobileMenu.classList.add('show'))
closeMenuBtn.addEventListener('click', () => mobileMenu.classList.remove('show'))
document.addEventListener('click', e => {
  if (!mobileMenu.contains(e.target) && !mobileMenuBtn.contains(e.target)) {
    mobileMenu.classList.remove('show')
  }
})

function loadSettings() {
  restoreLogTypeSelection()
  loadRegexFilters()
  adjustRetainLimit(localStorage.getItem('retainLimit'))
  adjustFontSize(localStorage.getItem('fontSize'))
  adjustLineHeight(localStorage.getItem('lineHeight'))
}

function initEventSource() {
  const logToken = new URLSearchParams(window.location.search).get('token') ?? localStorage.getItem('logToken') ?? ''
  localStorage.setItem('logToken', logToken)
  const es = new EventSource(`/api/logstream?token=${logToken}`)
  es.onmessage = e => processLogEvent(e.data)
}

function initInterval() {
  setInterval(() => {
    updateCurrentTime()
  }, 1000)
}

loadSettings()
initEventSource()
updateCurrentTime()
initInterval()
