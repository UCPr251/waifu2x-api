import userConfig from '../../config.json' with { type: 'json' }
import chokidar from 'chokidar'
import fs from 'fs'

export const API_NAME = 'Waifu'

if (!fs.existsSync('config.json')) {
  fs.copyFileSync('config.example.json', 'config.json')
}

const defaultConfig = JSON.parse(fs.readFileSync('config.example.json', 'utf-8'))

function mergeConfigs(defaults: any, overrides: any): any {
  const result: any = { ...defaults }
  for (const key in overrides) {
    if (overrides[key] && typeof overrides[key] === 'object' && !Array.isArray(overrides[key])) {
      result[key] = mergeConfigs(defaults[key] || {}, overrides[key])
    } else {
      result[key] = overrides[key]
    }
  }
  return result
}

type Config = typeof userConfig & { save: () => void }

declare global {
  var config: Config
}

function createConfigProxy(configObj: any): Config {
  return new Proxy(configObj, {
    get(target, prop) {
      if (prop === 'save') {
        return () => {
          fs.writeFileSync('config.json', JSON.stringify(target, null, 2), 'utf-8')
        }
      }
      const value = target[prop as keyof typeof target]
      return value
    }
  })
}

let config = createConfigProxy(mergeConfigs(defaultConfig, userConfig))

chokidar.watch('config.json').on('change', () => {
  try {
    const updatedConfig = JSON.parse(fs.readFileSync('config.json', 'utf-8')) as Config
    if (updatedConfig.logging.level && global.logger && logger.level !== updatedConfig.logging.level.toUpperCase()) {
      logger.level = updatedConfig.logging.level
      logger.info(`日志级别已更改为：${logger.level}`)
    }
    global.config = config = createConfigProxy(mergeConfigs(defaultConfig, updatedConfig));
    (global.logger || console).info('配置已重载')
  } catch (err) {
    (global.logger || console).error('重新配置失败', err)
  }
})

global.config = config

export { config }