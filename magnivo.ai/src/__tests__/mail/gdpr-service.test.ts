import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPool = vi.hoisted(() => ({
  query: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  default: mockPool,
}))

vi.mock('@/services/mail/suppression-service', () => ({
  suppressEmail: vi.fn().mockResolvedValue(undefined),
}))

import {
  createDsrRequest,
  listDsrRequests,
  processAccessRequest,
  processErasureRequest,
  recordConsent,
  hasConsent,
  getComplianceAuditLog,
} from '@/services/mail/gdpr-service'

const responses: Record<number, unknown> = {}
let nextIdx = 1

function mockNext(val: unknown) {
  const c = nextIdx
  nextIdx++
  responses[c] = val
}

function mockQuery() {
  let callCount = 0
  mockPool.query.mockImplementation(() => {
    callCount++
    const r = responses[callCount] as
      | { success?: boolean; error?: string; rows?: unknown[]; rowCount?: number }
      | undefined
    if (r) {
      if (r.success === false) return Promise.reject(new Error(r.error || 'mock error'))
      return Promise.resolve(r)
    }
    return Promise.resolve({ rows: [], rowCount: 0 })
  })
}

describe('gdpr-service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    nextIdx = 1
    Object.keys(responses).forEach(k => delete responses[k as unknown as number])
    mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 })
  })

  describe('createDsrRequest', () => {
    it('creates a new DSR request', async () => {
      mockQuery()
      mockNext({
        rows: [{
          id: 'dsr-1',
          organization_id: 'org-1',
          request_type: 'access',
          requester_email: 'user@example.com',
          requester_name: 'John',
          status: 'pending',
          details: 'Please send my data',
          completed_at: null,
          rejection_reason: null,
          data_export_url: null,
          created_at: '2026-07-22T12:00:00Z',
        }],
      })

      const result = await createDsrRequest({
        organizationId: 'org-1',
        requestType: 'access',
        requesterEmail: 'user@example.com',
        requesterName: 'John',
        details: 'Please send my data',
      })

      expect(result.success).toBe(true)
      expect(result.data?.status).toBe('pending')
      expect(result.data?.requestType).toBe('access')
      expect(result.data?.requesterEmail).toBe('user@example.com')
    })

    it('normalizes email to lowercase', async () => {
      mockQuery()
      mockNext({
        rows: [{
          id: 'dsr-2',
          organization_id: 'org-1',
          request_type: 'erasure',
          requester_email: 'User@Example.com',
          requester_name: null,
          status: 'pending',
          details: null,
          completed_at: null,
          rejection_reason: null,
          data_export_url: null,
          created_at: '2026-07-22T12:00:00Z',
        }],
      })

      await createDsrRequest({
        organizationId: 'org-1',
        requestType: 'erasure',
        requesterEmail: 'User@Example.com',
      })

      expect(mockPool.query.mock.calls[0][1][2]).toBe('user@example.com')
    })

    it('returns error on db failure', async () => {
      mockQuery()
      mockNext({ success: false, error: 'Insert failed' })

      const result = await createDsrRequest({
        organizationId: 'org-1',
        requestType: 'access',
        requesterEmail: 'test@test.com',
      })
      expect(result.success).toBe(false)
      expect(result.error).toBe('Insert failed')
    })
  })

  describe('listDsrRequests', () => {
    it('lists requests with default limit', async () => {
      mockQuery()
      mockNext({
        rows: [{
          id: 'dsr-1',
          organization_id: 'org-1',
          request_type: 'access',
          requester_email: 'user@example.com',
          requester_name: null,
          status: 'pending',
          details: null,
          completed_at: null,
          rejection_reason: null,
          data_export_url: null,
          created_at: '2026-07-22T12:00:00Z',
        }],
      })

      const result = await listDsrRequests('org-1')
      expect(result).toHaveLength(1)
      expect(mockPool.query.mock.calls[0][1][1]).toBe(100)
    })

    it('respects custom limit', async () => {
      mockQuery()
      mockNext({ rows: [] })
      await listDsrRequests('org-1', 10)
      expect(mockPool.query.mock.calls[0][1][1]).toBe(10)
    })

    it('returns empty array on error', async () => {
      mockQuery()
      mockNext({ success: false, error: 'DB error' })
      const result = await listDsrRequests('org-1')
      expect(result).toEqual([])
    })
  })

  describe('processAccessRequest', () => {
    it('exports user data and marks request completed', async () => {
      mockQuery()
      mockNext({ rows: [{ id: 'dsr-1', organization_id: 'org-1', requester_email: 'user@example.com', request_type: 'access', status: 'pending', created_at: '2026-07-22T12:00:00Z' }] })
      mockNext({ rowCount: 1 })
      mockNext({ rows: [{ id: 'consent-1', consent_type: 'marketing', status: 'granted' }] })
      mockNext({ rows: [] })
      mockNext({ rows: [{ id: 'lead-1', email: 'user@example.com' }] })
      mockNext({ rowCount: 1 })
      mockNext({ rowCount: 1 })

      const result = await processAccessRequest('dsr-1')
      expect(result.success).toBe(true)
      expect(result.data?.downloadUrl).toContain('/api/gdpr/export/')
    })

    it('returns error when request not found', async () => {
      mockQuery()
      mockNext({ rows: [] })
      const result = await processAccessRequest('nonexistent')
      expect(result.success).toBe(false)
      expect(result.error).toBe('DSR request not found')
    })
  })

  describe('processErasureRequest', () => {
    it('deletes user data and returns deleted count', async () => {
      mockQuery()
      mockNext({ rows: [{ id: 'dsr-2', organization_id: 'org-1', requester_email: 'delete@example.com', request_type: 'erasure', status: 'pending', created_at: '2026-07-22T12:00:00Z' }] })
      mockNext({ rowCount: 1 })
      mockNext({ rowCount: 2 })
      mockNext({ rowCount: 1 })
      mockNext({ rowCount: 1 })
      mockNext({ rowCount: 1 })
      mockNext({ rowCount: 1 })

      const result = await processErasureRequest('dsr-2')
      expect(result.success).toBe(true)
      expect(result.data?.deletedRecords).toBeGreaterThan(0)
    })

    it('returns error when request not found', async () => {
      mockQuery()
      mockNext({ rows: [] })
      const result = await processErasureRequest('nonexistent')
      expect(result.success).toBe(false)
      expect(result.error).toBe('DSR request not found')
    })
  })

  describe('recordConsent', () => {
    it('records granted consent', async () => {
      mockQuery()
      mockNext({ rows: [] })
      mockNext({
        rows: [{
          id: 'consent-1',
          organization_id: 'org-1',
          email: 'user@example.com',
          consent_type: 'marketing',
          status: 'granted',
          ip_address: '1.2.3.4',
          user_agent: 'Chrome',
          granted_at: '2026-07-22T12:00:00Z',
          withdrawn_at: null,
        }],
      })
      mockNext({ rowCount: 1 })

      const result = await recordConsent({
        organizationId: 'org-1',
        email: 'user@example.com',
        consentType: 'marketing',
        status: 'granted',
        ipAddress: '1.2.3.4',
        userAgent: 'Chrome',
      })

      expect(result.success).toBe(true)
      expect(result.data?.status).toBe('granted')
    })

    it('withdraws existing consent', async () => {
      mockQuery()
      mockNext({
        rows: [{
          id: 'consent-1',
          organization_id: 'org-1',
          email: 'user@example.com',
          consent_type: 'marketing',
          status: 'withdrawn',
          withdrawn_at: '2026-07-23T12:00:00Z',
          granted_at: '2026-07-22T12:00:00Z',
        }],
      })
      mockNext({ rowCount: 1 })

      const result = await recordConsent({
        organizationId: 'org-1',
        email: 'user@example.com',
        consentType: 'marketing',
        status: 'withdrawn',
      })

      expect(result.success).toBe(true)
    })

    it('returns error withdrawing non-existent consent', async () => {
      mockQuery()
      mockNext({ rows: [] })

      const result = await recordConsent({
        organizationId: 'org-1',
        email: 'unknown@example.com',
        consentType: 'marketing',
        status: 'withdrawn',
      })
      expect(result.success).toBe(false)
      expect(result.error).toContain('No active consent')
    })
  })

  describe('hasConsent', () => {
    it('returns true when consent exists', async () => {
      mockQuery()
      mockNext({ rows: [1] })
      const result = await hasConsent('org-1', 'user@example.com', 'marketing')
      expect(result).toBe(true)
    })

    it('returns false when no consent', async () => {
      mockQuery()
      mockNext({ rows: [] })
      const result = await hasConsent('org-1', 'user@example.com', 'tracking')
      expect(result).toBe(false)
    })

    it('returns false on db error', async () => {
      mockQuery()
      mockNext({ success: false, error: 'DB error' })
      const result = await hasConsent('org-1', 'user@example.com', 'marketing')
      expect(result).toBe(false)
    })
  })

  describe('getComplianceAuditLog', () => {
    it('returns audit entries', async () => {
      mockQuery()
      mockNext({
        rows: [
          { id: 'audit-1', organization_id: 'org-1', event_type: 'consent_granted', target_email: 'a@b.com', description: 'Consent granted', metadata: {}, created_at: '2026-07-22T12:00:00Z' },
          { id: 'audit-2', organization_id: 'org-1', event_type: 'access_exported', target_email: 'c@d.com', description: 'Access exported', metadata: {}, created_at: '2026-07-22T13:00:00Z' },
        ],
      })

      const result = await getComplianceAuditLog('org-1')
      expect(result).toHaveLength(2)
    })

    it('returns empty array on error', async () => {
      mockQuery()
      mockNext({ success: false, error: 'DB error' })
      const result = await getComplianceAuditLog('org-1')
      expect(result).toEqual([])
    })
  })
})
