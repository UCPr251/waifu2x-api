import { API_NAME, config } from './config.js'
import { Chalk } from 'chalk'
import log4js from 'log4js'

function myCustomAppender(_, layout) {
  return function (logEvent) {
    if (logger.logout.length === 0) return
    const formattedMessage = layout(logEvent)
    logger.logout.forEach(fnc => fnc(formattedMessage))
  }
}

myCustomAppender.configure = function (config, layouts) {
  return myCustomAppender(config, layouts.layout(config.layout.type, config.layout))
}

void function () {
  log4js.configure({
    appenders: {
      console: {
        type: 'console',
        layout: {
          type: 'pattern',
          pattern: `%[[${API_NAME}][%d{hh:mm:ss.SSS}][%4.4p]%] %m`
        }
      },
      custom: {
        type: myCustomAppender,
        layout: {
          type: 'pattern',
          pattern: '%[[%d{hh:mm:ss.SSS}][%4.4p]%] %m',
          tokens: {
            color: true
          }
        }
      },
      message: {
        type: 'dateFile',
        filename: 'logs/message',
        pattern: 'yyyy-MM-dd.log',
        numBackups: config.logging.numBackups || 30,
        alwaysIncludePattern: true,
        layout: {
          type: 'pattern',
          pattern: '[%d{hh:mm:ss.SSS}][%4.4p] %m'
        }
      },
      error: {
        type: 'file',
        filename: 'logs/error.log',
        alwaysIncludePattern: true,
        layout: {
          type: 'pattern',
          pattern: '[%d{yyyy-MM-dd hh:mm:ss.SSS}][%4.4p] %m'
        }
      }
    },
    categories: {
      default: { appenders: ['console', 'custom', 'message'], level: config.logging.level || 'info' },
      message: { appenders: ['console', 'custom', 'message'], level: 'mark' },
      error: { appenders: ['console', 'custom', 'message', 'error'], level: 'warn' },
    }
  })

  const defaultLogger = log4js.getLogger('default')
  const messageLogger = log4js.getLogger('message')
  const errorLogger = log4js.getLogger('error')

  const decoder = (...logs) => {
    return logs.reduce((pre, cur) => {
      if (cur instanceof Error) {
        pre.push(cur.message)
        cur.stack && pre.push(decodeURI(cur.stack))
      } else {
        pre.push(cur)
      }
      return pre
    }, [])
  }
  const chalk = new Chalk({ level: 3 })
  global.logger = {
    get level() {
      return defaultLogger.level.levelStr
    },
    set level(level) {
      defaultLogger.level = level
    },
    logout: [],
    chalk: chalk,
    red: chalk.rgb(251, 50, 50),
    blue: chalk.rgb(0, 155, 255),
    yellow: chalk.rgb(255, 220, 20),
    magenta: chalk.rgb(180, 110, 255),
    orange: chalk.rgb(255, 165, 0),
    green: chalk.green,
    gray: chalk.gray,
    white: chalk.white,
    trace() {
      defaultLogger.trace(...arguments)
    },
    debug() {
      defaultLogger.debug(...arguments)
    },
    info() {
      defaultLogger.info(...arguments)
    },
    warn() {
      errorLogger.warn(...decoder(...arguments))
    },
    error() {
      errorLogger.error(...decoder(...arguments))
    },
    mark() {
      messageLogger.mark(...arguments)
    }
  }

}()
