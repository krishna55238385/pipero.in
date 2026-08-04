import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPool = vi.hoisted(() => ({
  query: vi.fn(),
  connect: vi.fn(),
}))
const mockClient = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  default: mockPool,
}))

import {
  getHealthStatus,
  getMetrics,
  getWorkerHealth,
} from '@/services/mail/health-metrics'

describe('health-metrics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPool.connect.mockResolvedValue(mockClient)
    mockClient.query.mockReset()
    mockClient.release.mockReset()
  })

  describe('getHealthStatus', () => {
    it('returns healthy status when DB is up', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ 1: 1 }] })
      mockPool.query.mockResolvedValueOnce({ rows: [] })

      const result = await getHealthStatus()
      expect(result.status).toBe('healthy')
      expect(result.database).toBe('connected')
    })

    it('returns degraded when queue has failures', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ 1: 1 }] })
      mockPool.query.mockResolvedValueOnce({
        rows: [{ status: 'failed', count: 5 }],
      })

      const result = await getHealthStatus()
      expect(result.status).toBe('degraded')
      expect(result.database).toBe('connected')
    })

    it('returns unhealthy when DB is down', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('Connection refused'))

      const result = await getHealthStatus()
      expect(result.status).toBe('unhealthy')
      expect(result.database).toBe('disconnected')
    })

    it('includes uptime and version info', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ 1: 1 }] })
      mockPool.query.mockResolvedValueOnce({ rows: [] })

      const result = await getHealthStatus()
      expect(result).toHaveProperty('uptime')
      expect(result).toHaveProperty('version')
      expect(result).toHaveProperty('timestamp')
    })
  })

  describe('getMetrics', () => {
    it('returns Prometheus-formatted output', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ count: 150 }] })
        .mockResolvedValueOnce({ rows: [{ count: 25 }] })
        .mockResolvedValueOnce({ rows: [{ count: 10 }] })
        .mockResolvedValueOnce({ rows: [{ count: 200 }] })
        .mockResolvedValueOnce({ rows: [{ count: 50 }] })

      const result = await getMetrics()
      expect(result).toContain('# HELP')
      expect(result).toContain('# TYPE')
    })

    it('includes histogram metrics for send latency', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ count: 100 }] })
        .mockResolvedValueOnce({ rows: [{ count: 20 }] })
        .mockResolvedValueOnce({ rows: [{ count: 5 }] })
        .mockResolvedValueOnce({ rows: [{ count: 180 }] })
        .mockResolvedValueOnce({ rows: [{ count: 45 }] })

      const result = await getMetrics()
      expect(result).toContain('magnivo_')
    })
  })

  describe('getWorkerHealth', () => {
    it('returns worker statuses', async () => {
      const now = new Date().toISOString()
      mockPool.query.mockResolvedValueOnce({
        rows: [
          { worker_id: 'worker-1', worker_type: 'send', status: 'active', last_heartbeat: now, jobs_processed: 150, uptime_seconds: 3600 },
          { worker_id: 'worker-2', worker_type: 'warmup', status: 'active', last_heartbeat: now, jobs_processed: 80, uptime_seconds: 3600 },
        ],
      })

      const result = await getWorkerHealth()
      expect(result).toHaveLength(2)
      expect(result[0]).toHaveProperty('workerId')
      expect(result[0]).toHaveProperty('workerType')
      expect(result[0]).toHaveProperty('status')
    })

    it('marks workers as stale when heartbeat is old', async () => {
      const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString()
      mockPool.query.mockResolvedValueOnce({
        rows: [
          { worker_id: 'worker-stale', worker_type: 'send', status: 'active', last_heartbeat: stale, jobs_processed: 10, uptime_seconds: 100 },
        ],
      })

      const result = await getWorkerHealth()
      expect(result[0].status).toBe('stale')
    })

    it('returns empty array on error', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('DB error'))
      const result = await getWorkerHealth()
      expect(result).toEqual([])
    })
  })
})
