import { vi } from 'vitest'
import * as scheduler from '@/services/mail/warmup-scheduler'
import * as warmupQueue from '@/services/mail/warmup-queue'

vi.mock('@/repositories/mail/warmup-repository', () => ({
  findConfigsByStatus: vi.fn().mockResolvedValue([]),
  findConfigById: vi.fn().mockResolvedValue(null),
  updateConfig: vi.fn(),
  insertEvent: vi.fn().mockResolvedValue({ id: 'evt-1' }),
  findTodayStats: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/repositories/mail/warmup-job-repository', () => ({
  findJobById: vi.fn().mockResolvedValue(null),
  insertJob: vi.fn(),
  updateJob: vi.fn(),
  findRunnableJobs: vi.fn().mockResolvedValue([]),
  findStuckJobs: vi.fn().mockResolvedValue([]),
  findFailedJobsForRetry: vi.fn().mockResolvedValue([]),
  countJobsByOrg: vi.fn().mockResolvedValue({}),
}))

vi.mock('@/repositories/mail/warmup-execution-repository', () => ({
  getTodayExecutionStats: vi.fn().mockResolvedValue({ total: 0, successful: 0, failed: 0, bounced: 0, pending: 0 }),
  getAvgExecutionDuration: vi.fn().mockResolvedValue(0),
  findExecutionsByOrg: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/repositories/mail/mailbox-repository', () => ({
  findMailboxById: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/services/mail/warmup-execution-service', () => ({
  evaluatePauseConditions: vi.fn().mockResolvedValue({ shouldPause: false, reason: null }),
  calculateTargetSends: vi.fn().mockResolvedValue({
    todayAllowed: 10, alreadyCompleted: 0, remaining: 10,
    shouldExecute: true, skipReason: null,
  }),
  createJobForConfig: vi.fn().mockResolvedValue({ id: 'job-1', targetSends: 10 }),
  executeJob: vi.fn().mockResolvedValue({ success: true, completedSends: 10, failedSends: 0, errors: [] }),
}))

vi.mock('@/services/mail/warmup-recovery-service', () => ({
  recoverOnRestart: vi.fn().mockResolvedValue({ stuckJobs: 0, interruptedJobs: 0, staleJobs: 0 }),
  recoverStuckJobs: vi.fn().mockResolvedValue(0),
}))

vi.mock('@/services/mail/warmup-notification-service', () => ({
  notifyWarmupPaused: vi.fn(),
  notifyExecutionFailed: vi.fn(),
  recordAuditForAction: vi.fn(),
}))

vi.mock('@/services/mail/warmup-metrics-service', () => ({
  getSchedulerState: vi.fn().mockResolvedValue({
    status: 'stopped',
    lastHeartbeat: null,
    lastRunAt: null,
    lastRunDurationMs: null,
    configsProcessed: 0,
    jobsCreated: 0,
    errorsCount: 0,
  }),
  updateSchedulerState: vi.fn(),
  recordHeartbeat: vi.fn(),
  incrementConfigsProcessed: vi.fn(),
  incrementJobsCreated: vi.fn(),
  incrementErrorsCount: vi.fn(),
  getMetrics: vi.fn().mockResolvedValue({
    executionsToday: 0, successRate: 100, failureRate: 0,
    avgExecutionDurationMs: 0, mailboxUtilization: 0, poolUtilization: 0,
    schedulerStatus: 'stopped', lastHeartbeat: null,
    queuedJobs: 0, runningJobs: 0, failedJobs: 0, totalJobsToday: 0,
  }),
  recordAuditLog: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  default: {
    query: vi.fn().mockResolvedValue({ rows: [] }),
  },
}))

describe('warmup-scheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    warmupQueue.clear()
  })

  describe('getSchedulerStatus', () => {
    it('returns stopped by default', () => {
      expect(scheduler.getSchedulerStatus()).toBe('stopped')
    })
  })

  describe('isSchedulerRunning', () => {
    it('returns false by default', () => {
      expect(scheduler.isSchedulerRunning()).toBe(false)
    })
  })

  describe('getSchedulerHealth', () => {
    it('returns scheduler health', async () => {
      const health = await scheduler.getSchedulerHealth()
      expect(health).toHaveProperty('status')
      expect(health).toHaveProperty('lastHeartbeat')
      expect(health).toHaveProperty('uptime')
      expect(health).toHaveProperty('lastRunAt')
      expect(health).toHaveProperty('configsProcessed')
      expect(health).toHaveProperty('jobsCreated')
      expect(health).toHaveProperty('errorsCount')
    })
  })

  describe('stopScheduler', () => {
    it('stops the scheduler', async () => {
      const result = await scheduler.stopScheduler()
      expect(result.success).toBe(true)
    })
  })

  describe('runSchedulerOnce', () => {
    it('runs one cycle', async () => {
      const result = await scheduler.runSchedulerOnce()
      expect(result).toHaveProperty('configsProcessed')
      expect(result).toHaveProperty('jobsCreated')
      expect(result).toHaveProperty('errors')
      expect(result).toHaveProperty('durationMs')
    })
  })

  describe('pauseScheduler', () => {
    it('pauses the scheduler', async () => {
      const result = await scheduler.pauseScheduler()
      expect(result.success).toBe(true)
    })
  })
})
