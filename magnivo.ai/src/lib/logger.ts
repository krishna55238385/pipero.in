const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

const CURRENT_LEVEL: number =
  LOG_LEVELS[process.env.LOG_LEVEL as LogLevel] ?? LOG_LEVELS.debug

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type LogEntry = {
  timestamp: string
  level: LogLevel
  message: string
  module?: string
  requestId?: string
  error?: { name?: string; message?: string; stack?: string }
  [key: string]: unknown
}

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void
  info(message: string, meta?: Record<string, unknown>): void
  warn(message: string, meta?: Record<string, unknown>): void
  error(message: string, meta?: Record<string, unknown>): void
  withRequestId(requestId: string): Logger
  child(additionalContext: Record<string, unknown>): Logger
}

function write(level: LogLevel, data: string): void {
  if (level === 'error') {
    process.stderr.write(data)
  } else {
    process.stdout.write(data)
  }
}

const CIRCULAR = '[Circular]'

function safeStringify(entry: Record<string, unknown>): string {
  const seen = new WeakSet<object>()
  return JSON.stringify(entry, (_key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return CIRCULAR
      seen.add(value)
    }
    if (value instanceof Error) {
      return { name: value.name, message: value.message, stack: value.stack }
    }
    return value
  })
}

export function createLogger(module?: string, context: Record<string, unknown> = {}): Logger {
  const baseContext = module ? { ...context, module } : context

  function log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (LOG_LEVELS[level] < CURRENT_LEVEL) return

    const entry: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...baseContext,
    }

    if (meta) {
      for (const key of Object.keys(meta)) {
        const val = meta[key]
        if (val instanceof Error) {
          entry[key] = { name: val.name, message: val.message, stack: val.stack }
        } else {
          entry[key] = val
        }
      }
    }

    write(level, safeStringify(entry) + '\n')
  }

  const logger: Logger = {
    debug: (message, meta) => log('debug', message, meta),
    info: (message, meta) => log('info', message, meta),
    warn: (message, meta) => log('warn', message, meta),
    error: (message, meta) => log('error', message, meta),
    withRequestId: (requestId: string) =>
      createLogger(undefined, { ...baseContext, requestId }),
    child: (additionalContext: Record<string, unknown>) =>
      createLogger(undefined, { ...baseContext, ...additionalContext }),
  }

  return logger
}

export const logger = createLogger('root')
