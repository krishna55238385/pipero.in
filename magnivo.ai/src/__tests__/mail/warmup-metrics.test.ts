import * as metricsService from '@/services/mail/warmup-metrics-service'
import { vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  default: {
    query: vi.fn().mockImplementation((sql: string) => {
      if (sql.includes('warmup_scheduler_state')) {
        return Promise.resolve({
          rows: [{
            id: 'singleton',
            status: 'stopped',
            last_heartbeat: null,
            last_run_at: null,
            last_run_duration_ms: null,
            configs_processed: 0,
            jobs_created: 0,
            errors_count: 0,
          }],
        })
      }
      if (sql.includes('COUNT')) {
        return Promise.resolve({ rows: [{ count: 0, total: 0, successful: 0, failed: 0, bounced: 0, pending: 0 }] })
      }
      if (sql.includes('AVG')) {
        return Promise.resolve({ rows: [{ avg_duration: 0 }] })
      }
      if (sql.includes('GROUP BY')) {
        return Promise.resolve({ rows: [] })
      }
      return Promise.resolve({ rows: [], rowCount: 0 })
    }),
  },
}))

vi.mock('@/repositories/mail/warmup-job-repository', () => ({
  countJobsByOrg: vi.fn().mockResolvedValue({}),
}))

vi.mock('@/repositories/mail/warmup-execution-repository', () => ({
  getTodayExecutionStats: vi.fn().mockResolvedValue({
    total: 10, successful: 8, failed: 1, bounced: 1, pending: 0,
  }),
  getAvgExecutionDuration: vi.fn().mockResolvedValue(250),
}))

describe('warmup-metrics-service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getSchedulerState', () => {
    it('returns scheduler state', async () => {
      const state = await metricsService.getSchedulerState()
      expect(state).toHaveProperty('status')
      expect(state).toHaveProperty('lastHeartbeat')
      expect(state).toHaveProperty('configsProcessed')
      expect(state).toHaveProperty('jobsCreated')
      expect(state).toHaveProperty('errorsCount')
    })
  })

  describe('getMetrics', () => {
    it('returns warmup metrics', async () => {
      const metrics = await metricsService.getMetrics('org-1')
      expect(metrics).toHaveProperty('executionsToday')
      expect(metrics).toHaveProperty('successRate')
      expect(metrics).toHaveProperty('failureRate')
      expect(metrics).toHaveProperty('avgExecutionDurationMs')
      expect(metrics).toHaveProperty('schedulerStatus')
      expect(metrics).toHaveProperty('queuedJobs')
      expect(metrics).toHaveProperty('runningJobs')
      expect(metrics).toHaveProperty('failedJobs')
      expect(metrics).toHaveProperty('totalJobsToday')
    })

    it('calculates success rate correctly', async () => {
      const metrics = await metricsService.getMetrics('org-1')
      expect(metrics.executionsToday).toBe(10)
      expect(metrics.successRate).toBe(80)
      expect(metrics.failureRate).toBe(10)
    })
  })

  describe('recordAuditLog', () => {
    it('records an audit log entry', async () => {
      await expect(
        metricsService.recordAuditLog({
          organizationId: 'org-1',
          action: 'scheduler_started',
          message: 'Scheduler started',
        })
      ).resolves.not.toThrow()
    })
  })

  describe('getAuditLog', () => {
    it('returns audit log entries', async () => {
      const entries = await metricsService.getAuditLog('org-1')
      expect(Array.isArray(entries)).toBe(true)
    })
  })

  describe('recordHeartbeat', () => {
    it('records heartbeat', async () => {
      await expect(metricsService.recordHeartbeat()).resolves.not.toThrow()
    })
  })
})
