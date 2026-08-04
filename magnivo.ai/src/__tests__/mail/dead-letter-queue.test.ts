import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPool = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
}))
const mockClient = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  default: mockPool,
}))

import {
  moveToDeadLetter,
  listDeadLetterJobs,
  replayDeadLetterJob,
  replayAllDeadLetterJobs,
  getDeadLetterStats,
  purgeDeadLetterJobs,
} from '@/services/mail/dead-letter-queue-service'

describe('dead-letter-queue-service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPool.connect.mockResolvedValue(mockClient)
    mockClient.query.mockReturnValue(Promise.resolve({ rows: [], rowCount: 0 }))
    mockClient.release.mockImplementation(() => undefined)
  })

  describe('moveToDeadLetter', () => {
    it('moves a failed job to DLQ', async () => {
      const job = {
        id: 'job-1',
        organization_id: 'org-1',
        mailbox_id: 'mb-1',
        to_email: 'fail@example.com',
        subject: 'Test',
        last_error: '550 User unknown',
        attempts: 3,
        max_attempts: 5,
        created_at: '2026-07-22T12:00:00Z',
      }
      const dlqRow = {
        id: 'dlq-1',
        original_job_id: 'job-1',
        organization_id: 'org-1',
        mailbox_id: 'mb-1',
        to_email: 'fail@example.com',
        subject: 'Test',
        last_error: '550 User unknown',
        attempts: 3,
        max_attempts: 5,
        moved_to_dlq_at: '2026-07-22T12:00:00Z',
        reviewed_at: null,
        reviewed_by: null,
        replayed_at: null,
        notes: 'permanent_failure',
        created_at: '2026-07-22T12:00:00Z',
      }

      let callCount = 0
      mockClient.query.mockImplementation((sql: string) => {
        callCount++
        if (sql === 'BEGIN') return Promise.resolve({ rows: [], rowCount: 0 })
        if (sql.includes('FROM public.mail_send_jobs')) return Promise.resolve({ rows: [job], rowCount: 1 })
        if (sql.includes('INSERT INTO public.mail_send_jobs_dlq')) return Promise.resolve({ rows: [dlqRow], rowCount: 1 })
        if (sql.includes('UPDATE public.mail_send_jobs')) return Promise.resolve({ rowCount: 1 })
        if (sql.includes('INSERT INTO public.mailbox_audit_log')) return Promise.resolve({ rowCount: 1 })
        if (sql === 'COMMIT') return Promise.resolve({ rowCount: 1 })
        return Promise.resolve({ rows: [], rowCount: 0 })
      })

      const result = await moveToDeadLetter('job-1', 'permanent_failure')
      expect(result.success).toBe(true)
      expect(result.data).toBeDefined()
      expect(result.data?.id).toBe('dlq-1')
      expect(result.data?.originalJobId).toBe('job-1')
    })

    it('returns error when job not found', async () => {
      mockClient.query.mockImplementation((sql: string) => {
        if (sql === 'BEGIN') return Promise.resolve({ rows: [], rowCount: 0 })
        if (sql.includes('FROM public.mail_send_jobs')) return Promise.resolve({ rows: [] })
        return Promise.resolve({ rows: [], rowCount: 0 })
      })

      const result = await moveToDeadLetter('nonexistent', 'reason')
      expect(result.success).toBe(false)
      expect(result.error).toBe('Send job not found')
    })

    it('returns error on db failure', async () => {
      mockClient.query.mockRejectedValueOnce(new Error('DB error'))

      const result = await moveToDeadLetter('job-1', 'reason')
      expect(result.success).toBe(false)
      expect(result.error).toBe('DB error')
    })
  })

  describe('listDeadLetterJobs', () => {
    it('lists DLQ entries with default pagination', async () => {
      const rows = [
        { id: 'dlq-1', original_job_id: 'job-1', organization_id: 'org-1', mailbox_id: 'mb-1', to_email: 'a@b.com', subject: 'S1', last_error: 'err1', attempts: 1, max_attempts: 5, moved_to_dlq_at: '2026-07-22T12:00:00Z', reviewed_at: null, reviewed_by: null, replayed_at: null, notes: null, created_at: '2026-07-22T12:00:00Z' },
      ]
      mockPool.query.mockResolvedValueOnce({ rows })

      const result = await listDeadLetterJobs('org-1')
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('dlq-1')
    })

    it('filters unreplayed only', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] })
      await listDeadLetterJobs('org-1', { unreplayedOnly: true })
      expect(mockPool.query.mock.calls[0][0]).toContain('replayed_at IS NULL')
    })

    it('filters by date range', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] })
      await listDeadLetterJobs('org-1', { dateFrom: '2026-07-01', dateTo: '2026-07-31' })
      const sql = mockPool.query.mock.calls[0][0]
      expect(sql).toContain('moved_to_dlq_at >= ')
      expect(sql).toContain('moved_to_dlq_at <= ')
    })

    it('filters by search term', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] })
      await listDeadLetterJobs('org-1', { search: 'error' })
      const sql = mockPool.query.mock.calls[0][0]
      expect(sql).toContain('ILIKE')
    })
  })

  describe('replayDeadLetterJob', () => {
    it('resets original job to pending', async () => {
      const dlqRow = {
        id: 'dlq-1',
        original_job_id: 'job-1',
        organization_id: 'org-1',
        mailbox_id: 'mb-1',
        to_email: 'retry@example.com',
        subject: 'Retry',
        last_error: 'timeout',
        attempts: 3,
        max_attempts: 5,
        moved_to_dlq_at: '2026-07-22T12:00:00Z',
        reviewed_at: null,
        reviewed_by: null,
        replayed_at: null,
        notes: null,
        created_at: '2026-07-22T12:00:00Z',
      }

      mockClient.query.mockImplementation((sql: string) => {
        if (sql === 'BEGIN') return Promise.resolve({ rows: [], rowCount: 0 })
        if (sql.includes('FROM public.mail_send_jobs_dlq')) return Promise.resolve({ rows: [dlqRow], rowCount: 1 })
        if (sql.includes('UPDATE public.mail_send_jobs')) return Promise.resolve({ rowCount: 1 })
        if (sql.includes('UPDATE public.mail_send_jobs_dlq')) return Promise.resolve({ rowCount: 1 })
        if (sql.includes('INSERT INTO public.mailbox_audit_log')) return Promise.resolve({ rowCount: 1 })
        if (sql === 'COMMIT') return Promise.resolve({ rowCount: 1 })
        return Promise.resolve({ rows: [], rowCount: 0 })
      })

      const result = await replayDeadLetterJob('dlq-1', 'org-1')
      expect(result.success).toBe(true)
      expect(result.data).toBe(true)
    })

    it('returns error when DLQ job not found', async () => {
      mockClient.query.mockImplementation((sql: string) => {
        if (sql === 'BEGIN') return Promise.resolve({ rows: [], rowCount: 0 })
        if (sql.includes('FROM public.mail_send_jobs_dlq')) return Promise.resolve({ rows: [] })
        return Promise.resolve({ rows: [], rowCount: 0 })
      })

      const result = await replayDeadLetterJob('nonexistent', 'org-1')
      expect(result.success).toBe(false)
      expect(result.error).toBe('Dead-letter job not found')
    })

    it('returns error if already replayed', async () => {
      mockClient.query.mockImplementation((sql: string) => {
        if (sql === 'BEGIN') return Promise.resolve({ rows: [], rowCount: 0 })
        if (sql.includes('FROM public.mail_send_jobs_dlq')) return Promise.resolve({
          rows: [{ id: 'dlq-1', original_job_id: 'job-1', organization_id: 'org-1', replayed_at: '2026-07-23T12:00:00Z' }],
          rowCount: 1,
        })
        return Promise.resolve({ rows: [], rowCount: 0 })
      })

      const result = await replayDeadLetterJob('dlq-1', 'org-1')
      expect(result.success).toBe(false)
      expect(result.error).toBe('Dead-letter job has already been replayed')
    })
  })

  describe('replayAllDeadLetterJobs', () => {
    it('replays all unreplayed entries', async () => {
      const dlqRows = [
        { id: 'dlq-1', original_job_id: 'job-1', organization_id: 'org-1', mailbox_id: 'mb-1', to_email: 'a@b.com', subject: 'S1', last_error: 'err', attempts: 2, max_attempts: 5, moved_to_dlq_at: '2026-07-22T12:00:00Z', created_at: '2026-07-22T12:00:00Z' },
        { id: 'dlq-2', original_job_id: 'job-2', organization_id: 'org-1', mailbox_id: 'mb-1', to_email: 'c@d.com', subject: 'S2', last_error: 'err', attempts: 1, max_attempts: 5, moved_to_dlq_at: '2026-07-22T12:00:00Z', created_at: '2026-07-22T12:00:00Z' },
      ]
      let callN = 0
      mockClient.query.mockImplementation((sql: string) => {
        callN++
        if (callN === 1 && sql === 'BEGIN') return Promise.resolve({ rows: [], rowCount: 0 })
        if (callN === 2) return Promise.resolve({ rows: dlqRows, rowCount: 2 })
        return Promise.resolve({ rowCount: 1 })
      })

      const result = await replayAllDeadLetterJobs('org-1')
      expect(result.success).toBe(true)
      expect(result.data?.replayed).toBe(2)
    })

    it('returns zero when no unreplayed entries', async () => {
      mockClient.query.mockImplementation(() => {
        return Promise.resolve({ rows: [], rowCount: 0 })
      })

      const result = await replayAllDeadLetterJobs('org-1')
      expect(result.success).toBe(true)
      expect(result.data?.replayed).toBe(0)
    })
  })

  describe('getDeadLetterStats', () => {
    it('returns correct counts', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ total: 10, unreplayed: 7, replayed: 3, oldest: '2026-07-01T12:00:00Z' }],
      })
      const stats = await getDeadLetterStats('org-1')
      expect(stats.total).toBe(10)
      expect(stats.unreplayed).toBe(7)
      expect(stats.replayed).toBe(3)
      expect(stats.oldestEntryDays).toBeGreaterThan(0)
    })

    it('handles null oldest', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ total: 0, unreplayed: 0, replayed: 0, oldest: null }],
      })
      const stats = await getDeadLetterStats('org-1')
      expect(stats.oldestEntryDays).toBeNull()
    })
  })

  describe('purgeDeadLetterJobs', () => {
    it('removes old entries', async () => {
      let callN = 0
      mockClient.query.mockImplementation((sql: string) => {
        callN++
        if (callN === 1 && sql === 'BEGIN') return Promise.resolve({ rows: [], rowCount: 0 })
        if (callN === 2) return Promise.resolve({ rows: [], rowCount: 0 })
        if (callN === 3) return Promise.resolve({ rowCount: 5 })
        return Promise.resolve({ rowCount: 1 })
      })

      const result = await purgeDeadLetterJobs(30)
      expect(result.success).toBe(true)
      expect(result.data?.purged).toBe(5)
    })

    it('returns error on failure', async () => {
      mockClient.query.mockRejectedValueOnce(new Error('Purge failed'))

      const result = await purgeDeadLetterJobs(30)
      expect(result.success).toBe(false)
    })
  })
})
