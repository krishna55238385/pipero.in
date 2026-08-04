import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPool = vi.hoisted(() => ({
  query: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  default: mockPool,
}))

vi.mock('@/lib/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}))

import {
  recoverStuckProcessingJobs,
  recoverStuckWarmupJobs,
  cancelStalePendingJobs,
  recoverOnRestart,
} from '@/services/mail/queue-recovery-service'

describe('queue-recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('recoverStuckProcessingJobs', () => {
    it('finds and resets stuck jobs beyond timeout', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 2 })

      const result = await recoverStuckProcessingJobs()
      expect(result.recovered).toBe(2)
    })

    it('returns 0 when no stuck jobs', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 0 })

      const result = await recoverStuckProcessingJobs()
      expect(result.recovered).toBe(0)
    })

    it('handles db errors gracefully', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('DB error'))

      await expect(recoverStuckProcessingJobs()).rejects.toThrow('DB error')
    })
  })

  describe('recoverStuckWarmupJobs', () => {
    it('finds and resets stuck warmup jobs', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 1 })

      const result = await recoverStuckWarmupJobs()
      expect(result.recovered).toBe(1)
    })

    it('returns 0 when no stuck warmup jobs', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 0 })

      const result = await recoverStuckWarmupJobs()
      expect(result.recovered).toBe(0)
    })
  })

  describe('cancelStalePendingJobs', () => {
    it('cancels old pending jobs beyond staleness threshold', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 3 })

      const result = await cancelStalePendingJobs(24)
      expect(result.cancelled).toBe(3)
    })

    it('cancels with default staleness', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 0 })

      const result = await cancelStalePendingJobs()
      expect(result.cancelled).toBe(0)
    })
  })

  describe('recoverOnRestart', () => {
    it('runs all recovery strategies and returns summary', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rowCount: 2 })

      const result = await recoverOnRestart()
      expect(result).toHaveProperty('processingRecovered')
      expect(result).toHaveProperty('warmupRecovered')
      expect(result).toHaveProperty('staleCancelled')
      expect(result.processingRecovered).toBe(1)
      expect(result.warmupRecovered).toBe(1)
      expect(result.staleCancelled).toBe(2)
    })
  })
})
