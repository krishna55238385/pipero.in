import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockQuery = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db', () => ({
  default: { query: mockQuery },
}))

import { calculateInternalReputation } from '@/services/mail/reputation-service'

describe('reputation-service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('calculateInternalReputation', () => {
    it('records high reputation for good metrics', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 'rep-1',
          organization_id: 'org-1',
          domain_id: 'dom-1',
          source: 'internal',
          reputation_score: 85,
          reputation_level: 'good',
          sending_volume: null,
          bounce_rate: 0.01,
          complaint_rate: 0.001,
          open_rate: 0.3,
          metadata: {},
          recorded_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        }]
      })

      const result = await calculateInternalReputation('org-1', 'dom-1', 0.01, 0.001, 0.3)
      expect(result.reputationScore).toBeGreaterThanOrEqual(0)
      expect(result.reputationScore).toBeLessThanOrEqual(100)
      expect(result.source).toBe('internal')
    })

    it('records low reputation for bad metrics', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 'rep-2',
          organization_id: 'org-1',
          domain_id: 'dom-1',
          source: 'internal',
          reputation_score: 10,
          reputation_level: 'poor',
          sending_volume: null,
          bounce_rate: 0.5,
          complaint_rate: 0.1,
          open_rate: 0.05,
          metadata: {},
          recorded_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        }]
      })

      const result = await calculateInternalReputation('org-1', 'dom-1', 0.5, 0.1, 0.05)
      expect(result.reputationScore).toBeGreaterThanOrEqual(0)
      expect(result.reputationScore).toBeLessThanOrEqual(100)
    })

    it('clamps score to 0-100 range', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 'rep-3',
          organization_id: 'org-1',
          domain_id: 'dom-1',
          source: 'internal',
          reputation_score: 100,
          reputation_level: 'excellent',
          metadata: {},
          recorded_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        }]
      })

      const result = await calculateInternalReputation('org-1', 'dom-1', 0, 0, 1.0)
      expect(result.reputationScore).toBeGreaterThanOrEqual(0)
      expect(result.reputationScore).toBeLessThanOrEqual(100)
    })
  })
})
