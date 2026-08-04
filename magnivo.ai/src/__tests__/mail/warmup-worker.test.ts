import { vi } from 'vitest'
import * as worker from '@/services/mail/warmup-worker'
import * as warmupQueue from '@/services/mail/warmup-queue'
import { makeJob } from './warmup-execution-engine-test-helpers'

vi.mock('@/repositories/mail/warmup-job-repository', () => ({
  findJobById: vi.fn().mockResolvedValue(null),
  updateJob: vi.fn(),
  findFailedJobsForRetry: vi.fn().mockResolvedValue([]),
  cancelPendingJobsByConfigId: vi.fn().mockResolvedValue(0),
}))

vi.mock('@/repositories/mail/warmup-repository', () => ({
  findConfigById: vi.fn().mockResolvedValue(null),
  updateConfig: vi.fn(),
}))

vi.mock('@/repositories/mail/warmup-execution-repository', () => ({
  insertExecution: vi.fn(),
  updateExecution: vi.fn(),
}))

vi.mock('@/services/mail/warmup-execution-service', () => ({
  evaluatePauseConditions: vi.fn().mockResolvedValue({ shouldPause: false, reason: null }),
  executeJob: vi.fn().mockResolvedValue({ success: true, completedSends: 10, failedSends: 0, errors: [] }),
}))

vi.mock('@/services/mail/warmup-notification-service', () => ({
  notifyWarmupPaused: vi.fn(),
  recordAuditForAction: vi.fn(),
}))

describe('warmup-worker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    warmupQueue.clear()
    worker.stopWorker()
  })

  describe('isWorkerActive', () => {
    it('returns false when not started', () => {
      expect(worker.isWorkerActive()).toBe(false)
    })
  })

  describe('getActiveWorkerCount', () => {
    it('returns 0 when no workers', () => {
      expect(worker.getActiveWorkerCount()).toBe(0)
    })
  })

  describe('startWorker / stopWorker', () => {
    it('starts and stops worker', async () => {
      await worker.startWorker()
      expect(worker.isWorkerActive()).toBe(true)

      await worker.stopWorker()
      expect(worker.isWorkerActive()).toBe(false)
    })
  })

  describe('getWorkerStats', () => {
    it('returns worker stats', async () => {
      const stats = await worker.getWorkerStats()
      expect(stats).toHaveProperty('active')
      expect(stats).toHaveProperty('activeWorkers')
      expect(stats).toHaveProperty('maxConcurrent')
      expect(stats).toHaveProperty('queueSize')
    })
  })

  describe('processJob', () => {
    it('returns error when job not found', async () => {
      const { findJobById } = await import('@/repositories/mail/warmup-job-repository')
      vi.mocked(findJobById).mockResolvedValue(null)

      const result = await worker.processJob('nonexistent')
      expect(result.success).toBe(false)
    })

    it('cancels job when config not running', async () => {
      const { findJobById, updateJob } = await import('@/repositories/mail/warmup-job-repository')
      vi.mocked(findJobById).mockResolvedValue(makeJob())

      const { findConfigById } = await import('@/repositories/mail/warmup-repository')
      vi.mocked(findConfigById).mockResolvedValue({
        id: 'cfg-1', status: 'paused',
      } as never)

      const result = await worker.processJob('job-1')
      expect(result.success).toBe(false)
      expect(updateJob).toHaveBeenCalledWith('job-1', { status: 'cancelled' })
    })
  })

  describe('cancelJob', () => {
    it('returns error when job not found', async () => {
      const { findJobById } = await import('@/repositories/mail/warmup-job-repository')
      vi.mocked(findJobById).mockResolvedValue(null)

      const result = await worker.cancelJob('nonexistent')
      expect(result.success).toBe(false)
    })

    it('cancels a pending job', async () => {
      const { findJobById, updateJob } = await import('@/repositories/mail/warmup-job-repository')
      vi.mocked(findJobById).mockResolvedValue(makeJob({ status: 'pending' }))
      vi.mocked(updateJob).mockResolvedValue(makeJob({ status: 'cancelled' }))

      const result = await worker.cancelJob('job-1')
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toBe(true)
      }
    })

    it('cannot cancel a running job', async () => {
      const { findJobById } = await import('@/repositories/mail/warmup-job-repository')
      vi.mocked(findJobById).mockResolvedValue(makeJob({ status: 'running' }))

      const result = await worker.cancelJob('job-1')
      expect(result.success).toBe(false)
    })

    it('cannot cancel a completed job', async () => {
      const { findJobById } = await import('@/repositories/mail/warmup-job-repository')
      vi.mocked(findJobById).mockResolvedValue(makeJob({ status: 'completed' }))

      const result = await worker.cancelJob('job-1')
      expect(result.success).toBe(false)
    })
  })

  describe('retryFailedJobs', () => {
    it('returns 0 when no failed jobs', async () => {
      const result = await worker.retryFailedJobs()
      expect(result.success).toBe(true)
      expect('data' in result ? result.data : 0).toBe(0)
    })
  })

  describe('cancelAllPendingJobs', () => {
    it('cancels all pending jobs for a config', async () => {
      const { cancelPendingJobsByConfigId } = await import('@/repositories/mail/warmup-job-repository')
      vi.mocked(cancelPendingJobsByConfigId).mockResolvedValue(3)

      const result = await worker.cancelAllPendingJobs('cfg-1')
      expect(result.success).toBe(true)
      expect('data' in result ? result.data : 0).toBe(3)
    })
  })
})
