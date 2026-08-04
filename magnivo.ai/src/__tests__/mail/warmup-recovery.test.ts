import * as recoveryService from '@/services/mail/warmup-recovery-service'
import { vi } from 'vitest'

vi.mock('@/repositories/mail/warmup-repository', () => ({
  findConfigById: vi.fn().mockResolvedValue(null),
  insertEvent: vi.fn().mockResolvedValue({ id: 'evt-1' }),
}))

vi.mock('@/repositories/mail/warmup-job-repository', () => ({
  findStuckJobs: vi.fn().mockResolvedValue([]),
  findRunnableJobs: vi.fn().mockResolvedValue([]),
  updateJob: vi.fn(),
  findJobsByConfigId: vi.fn().mockResolvedValue([]),
  findJobsByOrg: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/repositories/mail/warmup-execution-repository', () => ({
  findExecutionsByJobId: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/services/mail/warmup-queue', () => ({
  removeJob: vi.fn().mockReturnValue(true),
}))

vi.mock('@/services/mail/warmup-notification-service', () => ({
  notifyExecutionFailed: vi.fn(),
  recordAuditForAction: vi.fn(),
}))

describe('warmup-recovery-service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('recoverStuckJobs', () => {
    it('returns 0 when no stuck jobs', async () => {
      const recovered = await recoveryService.recoverStuckJobs()
      expect(recovered).toBe(0)
    })

    it('recovers stuck jobs with retries remaining', async () => {
      const { findStuckJobs, updateJob } = await import('@/repositories/mail/warmup-job-repository')
      vi.mocked(findStuckJobs).mockResolvedValue([
        {
          id: 'job-1', configId: 'cfg-1', organizationId: 'org-1',
          status: 'running', scheduledAt: '2026-07-22T12:00:00Z',
          startedAt: '2026-07-22T12:00:00Z', completedAt: null,
          retryCount: 0, maxRetries: 3, nextRetryAt: null,
          lastError: null, errorCategory: null, targetSends: 10,
          completedSends: 5, failedSends: 0, mailboxId: 'mb-1',
          poolId: null, metadata: {}, createdAt: '2026-07-22T12:00:00Z',
          updatedAt: '2026-07-22T12:00:00Z',
        },
      ] as never)

      const recovered = await recoveryService.recoverStuckJobs()
      expect(recovered).toBe(1)
      expect(updateJob).toHaveBeenCalledWith('job-1', expect.objectContaining({
        status: 'retrying',
        retryCount: 1,
      }))
    })

    it('marks jobs as failed when max retries exceeded', async () => {
      const { findStuckJobs, updateJob } = await import('@/repositories/mail/warmup-job-repository')
      vi.mocked(findStuckJobs).mockResolvedValue([
        {
          id: 'job-1', configId: 'cfg-1', organizationId: 'org-1',
          status: 'running', scheduledAt: '2026-07-22T12:00:00Z',
          startedAt: '2026-07-22T12:00:00Z', completedAt: null,
          retryCount: 3, maxRetries: 3, nextRetryAt: null,
          lastError: null, errorCategory: null, targetSends: 10,
          completedSends: 5, failedSends: 0, mailboxId: 'mb-1',
          poolId: null, metadata: {}, createdAt: '2026-07-22T12:00:00Z',
          updatedAt: '2026-07-22T12:00:00Z',
        },
      ] as never)

      const recovered = await recoveryService.recoverStuckJobs()
      expect(recovered).toBe(1)
      expect(updateJob).toHaveBeenCalledWith('job-1', expect.objectContaining({
        status: 'failed',
      }))
    })
  })

  describe('canRecoverConfig', () => {
    it('returns recoverable for healthy config', async () => {
      const { findJobsByConfigId } = await import('@/repositories/mail/warmup-job-repository')
      vi.mocked(findJobsByConfigId).mockResolvedValue([])

      const result = await recoveryService.canRecoverConfig({
        id: 'cfg-1', status: 'running', health: 'healthy',
        organizationId: 'org-1', mailboxId: 'mb-1',
      } as never)
      expect(result.recoverable).toBe(true)
    })

    it('returns not recoverable for failed config', async () => {
      const { findJobsByConfigId } = await import('@/repositories/mail/warmup-job-repository')
      vi.mocked(findJobsByConfigId).mockResolvedValue([])

      const result = await recoveryService.canRecoverConfig({
        id: 'cfg-1', status: 'failed', health: 'healthy',
        organizationId: 'org-1', mailboxId: 'mb-1',
      } as never)
      expect(result.recoverable).toBe(false)
    })
  })

  describe('clearStalePendingJobs', () => {
    it('returns 0 when no stale jobs', async () => {
      const { findRunnableJobs } = await import('@/repositories/mail/warmup-job-repository')
      vi.mocked(findRunnableJobs).mockResolvedValue([])

      const cleared = await recoveryService.clearStalePendingJobs()
      expect(cleared).toBe(0)
    })
  })
})
