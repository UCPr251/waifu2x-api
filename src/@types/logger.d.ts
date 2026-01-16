import type chalk from 'chalk'
import type config from '../../config.example.json' with { type: 'json' }

declare global {
  var logger: {
    logout: ((log: string) => void)[]
    get level(): string
    set level(level: string)
    chalk: typeof chalk
    red: typeof chalk
    yellow: typeof chalk
    blue: typeof chalk
    magenta: typeof chalk
    orange: typeof chalk
    green: typeof chalk
    gray: typeof chalk
    white: typeof chalk
    trace: (...args: any[]) => void
    info: (...args: any[]) => void
    debug: (...args: any[]) => void
    warn: (...args: any[]) => void
    error: (...args: any[]) => void
    mark: (...args: any[]) => void
  }
}
