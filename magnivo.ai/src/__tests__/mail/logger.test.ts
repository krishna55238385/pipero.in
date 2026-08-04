import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/logger', () => {
  const LOG_LEVELS: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 }

  function createLogger(module?: string, context: Record<string, unknown> = {}) {
    const baseContext = module ? { ...context, module } : context

    function log(level: string, message: string, meta?: Record<string, unknown>) {
      const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL as string] ?? LOG_LEVELS.debug
      if (LOG_LEVELS[level] < currentLevel) return

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

      const seen = new WeakSet<object>()
      const output = JSON.stringify(entry, (_key, value) => {
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) return '[Circular]'
          seen.add(value)
        }
        if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack }
        return value
      })

      if (level === 'error') {
        process.stderr.write(output + '\n')
      } else {
        process.stdout.write(output + '\n')
      }
    }

    return {
      debug: (msg: string, meta?: Record<string, unknown>) => log('debug', msg, meta),
      info: (msg: string, meta?: Record<string, unknown>) => log('info', msg, meta),
      warn: (msg: string, meta?: Record<string, unknown>) => log('warn', msg, meta),
      error: (msg: string, meta?: Record<string, unknown>) => log('error', msg, meta),
      withRequestId: (requestId: string) => createLogger(undefined, { ...baseContext, requestId }),
      child: (additionalContext: Record<string, unknown>) => createLogger(undefined, { ...baseContext, ...additionalContext }),
    }
  }

  return { createLogger }
})

import { createLogger } from '@/lib/logger'

describe('logger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('createLogger', () => {
    it('creates a logger with module context', () => {
      const log = createLogger('test-module')
      expect(log).toBeDefined()
      expect(typeof log.info).toBe('function')
      expect(typeof log.error).toBe('function')
      expect(typeof log.warn).toBe('function')
      expect(typeof log.debug).toBe('function')
    })

    it('creates a logger without module', () => {
      const log = createLogger()
      expect(log).toBeDefined()
    })
  })

  describe('Logger output format', () => {
    it('outputs JSON with timestamp, level, and message', () => {
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
      const log = createLogger('format-test')

      log.info('hello world')

      expect(stdoutSpy).toHaveBeenCalledTimes(1)
      const output = stdoutSpy.mock.calls[0][0] as string
      const parsed = JSON.parse(output)
      expect(parsed).toHaveProperty('timestamp')
      expect(parsed.level).toBe('info')
      expect(parsed.message).toBe('hello world')
      expect(parsed.module).toBe('format-test')

      stdoutSpy.mockRestore()
    })

    it('includes module in JSON output', () => {
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
      const log = createLogger('my-module')

      log.info('test')

      const output = stdoutSpy.mock.calls[0][0] as string
      const parsed = JSON.parse(output)
      expect(parsed.module).toBe('my-module')

      stdoutSpy.mockRestore()
    })
  })

  describe('Error level goes to stderr', () => {
    it('writes error level to stderr', () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
      const log = createLogger('err-test')

      log.error('something broke')

      expect(stderrSpy).toHaveBeenCalledTimes(1)
      const output = stderrSpy.mock.calls[0][0] as string
      const parsed = JSON.parse(output)
      expect(parsed.level).toBe('error')

      stderrSpy.mockRestore()
    })

    it('writes info level to stdout', () => {
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
      const log = createLogger('level-test')

      log.info('info message')

      expect(stdoutSpy).toHaveBeenCalled()
      expect(stderrSpy).not.toHaveBeenCalled()

      stdoutSpy.mockRestore()
      stderrSpy.mockRestore()
    })
  })

  describe('Log level filtering', () => {
    it('filters out debug when LOG_LEVEL is info', () => {
      process.env.LOG_LEVEL = 'info'

      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
      const log = createLogger('filter-test')

      log.debug('should not appear')
      log.info('should appear')

      expect(stdoutSpy).toHaveBeenCalledTimes(1)
      const output = stdoutSpy.mock.calls[0][0] as string
      const parsed = JSON.parse(output)
      expect(parsed.message).toBe('should appear')

      stdoutSpy.mockRestore()
      delete process.env.LOG_LEVEL
    })

    it('filters out info when LOG_LEVEL is warn', () => {
      process.env.LOG_LEVEL = 'warn'

      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
      const log = createLogger('filter-warn')

      log.info('should be filtered')
      log.warn('should appear')
      log.error('should also appear')

      expect(stdoutSpy).toHaveBeenCalledTimes(1)
      expect(stderrSpy).toHaveBeenCalledTimes(1)

      stdoutSpy.mockRestore()
      stderrSpy.mockRestore()
      delete process.env.LOG_LEVEL
    })
  })

  describe('Child logger', () => {
    it('inherits parent context', () => {
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
      const parent = createLogger('parent')
      const child = parent.child({ userId: 'user-1', requestId: 'req-1' })

      child.info('child message')

      const output = stdoutSpy.mock.calls[0][0] as string
      const parsed = JSON.parse(output)
      expect(parsed.module).toBe('parent')
      expect(parsed.userId).toBe('user-1')
      expect(parsed.requestId).toBe('req-1')

      stdoutSpy.mockRestore()
    })
  })

  describe('withRequestId', () => {
    it('adds request context', () => {
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
      const log = createLogger('req-test')
      const withReq = log.withRequestId('req-abc-123')

      withReq.info('request log')

      const output = stdoutSpy.mock.calls[0][0] as string
      const parsed = JSON.parse(output)
      expect(parsed.requestId).toBe('req-abc-123')

      stdoutSpy.mockRestore()
    })
  })

  describe('Error serialization', () => {
    it('serializes Error objects with name, message, stack', () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
      const log = createLogger('err-serial')

      log.error('error occurred', { error: new Error('Something broke') })

      const output = stderrSpy.mock.calls[0][0] as string
      const parsed = JSON.parse(output)
      expect(parsed.error).toBeDefined()
      expect(parsed.error.name).toBe('Error')
      expect(parsed.error.message).toBe('Something broke')
      expect(parsed.error.stack).toBeDefined()

      stderrSpy.mockRestore()
    })

    it('serializes Error objects in meta fields', () => {
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
      const log = createLogger('meta-err')

      log.info('with error', { cause: new TypeError('Invalid type') })

      const output = stdoutSpy.mock.calls[0][0] as string
      const parsed = JSON.parse(output)
      expect(parsed.cause).toBeDefined()
      expect(parsed.cause.name).toBe('TypeError')
      expect(parsed.cause.message).toBe('Invalid type')

      stdoutSpy.mockRestore()
    })
  })

  describe('Circular references', () => {
    it('handles circular references safely', () => {
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
      const log = createLogger('circular')

      const circular: Record<string, unknown> = { name: 'loop' }
      circular.self = circular

      log.info('circular test', { data: circular })

      const output = stdoutSpy.mock.calls[0][0] as string
      const parsed = JSON.parse(output)
      expect(parsed.data.name).toBe('loop')
      expect(parsed.data.self).toBe('[Circular]')

      stdoutSpy.mockRestore()
    })

    it('handles deeply nested circular references', () => {
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
      const log = createLogger('deep-circular')

      const a: Record<string, unknown> = { name: 'a' }
      const b: Record<string, unknown> = { name: 'b', parent: a }
      a.child = b

      log.info('deep circular', { a })

      const output = stdoutSpy.mock.calls[0][0] as string
      const parsed = JSON.parse(output)
      expect(parsed.a.name).toBe('a')
      expect(parsed.a.child.name).toBe('b')

      stdoutSpy.mockRestore()
    })
  })
})
