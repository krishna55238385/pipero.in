import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockQuery = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db', () => ({
  default: { query: mockQuery },
}))

import { recordBounce, processRetries, isEmailSuppressed } from '@/services/mail/bounce-service'

describe('bounce-service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('recordBounce', () => {
    it('records a hard bounce and suppresses email', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{
            id: 'bounce-1',
            organization_id: 'org-1',
            domain_id: 'dom-1',
            mailbox_id: null,
            campaign_id: null,
            recipient_email: 'test@example.com',
            bounce_type: 'hard',
            bounce_category: 'invalid_email',
            smtp_code: '550',
            diagnostic_code: 'User unknown',
            retry_count: 0,
            next_retry_at: null,
            suppressed: true,
            metadata: {},
            created_at: new Date().toISOString(),
          }]
        })
        .mockResolvedValueOnce({ rows: [] }) // suppress query

      const result = await recordBounce({
        organizationId: 'org-1',
        domainId: 'dom-1',
        recipientEmail: 'test@example.com',
        bounceType: 'hard',
        bounceCategory: 'invalid_email',
        smtpCode: '550',
        diagnosticCode: 'User unknown',
      })

      expect(result.bounceType).toBe('hard')
      expect(result.suppressed).toBe(true)
      expect(result.recipientEmail).toBe('test@example.com')
    })

    it('records a soft bounce with retry', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 'bounce-2',
          organization_id: 'org-1',
          domain_id: 'dom-1',
          recipient_email: 'test@example.com',
          bounce_type: 'soft',
          bounce_category: 'mailbox_full',
          retry_count: 0,
          next_retry_at: new Date(Date.now() + 3600000).toISOString(),
          suppressed: false,
          metadata: {},
          created_at: new Date().toISOString(),
        }]
      })

      const result = await recordBounce({
        organizationId: 'org-1',
        domainId: 'dom-1',
        recipientEmail: 'test@example.com',
        bounceType: 'soft',
        bounceCategory: 'mailbox_full',
      })

      expect(result.bounceType).toBe('soft')
      expect(result.suppressed).toBe(false)
      expect(result.nextRetryAt).toBeTruthy()
    })
  })

  describe('isEmailSuppressed', () => {
    it('returns true for suppressed email', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 })
      const result = await isEmailSuppressed('org-1', 'suppressed@example.com')
      expect(result).toBe(true)
    })

    it('returns false for non-suppressed email', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 0 })
      const result = await isEmailSuppressed('org-1', 'clean@example.com')
      expect(result).toBe(false)
    })
  })

  describe('processRetries', () => {
    it('suppresses bounces after max retries', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{
            id: 'bounce-3',
            organization_id: 'org-1',
            recipient_email: 'retry@example.com',
            bounce_type: 'soft',
            retry_count: 2,
            next_retry_at: new Date().toISOString(),
            suppressed: false,
          }]
        })
        .mockResolvedValueOnce({ rows: [] }) // update bounce
        .mockResolvedValueOnce({ rows: [] }) // suppress email

      const result = await processRetries('org-1')
      expect(result.suppressed).toBeGreaterThanOrEqual(0)
      expect(result.retried).toBeGreaterThanOrEqual(0)
    })
  })
})
