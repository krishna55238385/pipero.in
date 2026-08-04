import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockQuery = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db', () => ({
  default: { query: mockQuery },
}))

import { listComplaints, recordComplaint, resolveComplaint, getComplaintDashboardStats } from '@/services/mail/complaint-service'

describe('complaint-service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('recordComplaint', () => {
    it('records a complaint', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 'comp-1',
          organization_id: 'org-1',
          domain_id: 'dom-1',
          mailbox_id: null,
          campaign_id: null,
          complaint_type: 'spam',
          source: 'postmaster',
          status: 'new',
          auto_paused_mailbox: false,
          notified_workspace: false,
          resolved_at: null,
          resolved_by: null,
          metadata: {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }]
      })

      const result = await recordComplaint({
        organizationId: 'org-1',
        domainId: 'dom-1',
        complaintType: 'spam',
        source: 'postmaster',
      })

      expect(result.complaintType).toBe('spam')
      expect(result.status).toBe('new')
      expect(result.autoPausedMailbox).toBe(false)
    })

    it('records complaint with auto-paused mailbox', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{
            id: 'comp-2',
            organization_id: 'org-1',
            domain_id: 'dom-1',
            mailbox_id: 'mb-1',
            complaint_type: 'spam',
            source: 'postmaster',
            status: 'new',
            auto_paused_mailbox: true,
            notified_workspace: false,
            metadata: {},
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }]
        })
        .mockResolvedValueOnce({ rows: [] }) // pause mailbox

      const result = await recordComplaint({
        organizationId: 'org-1',
        domainId: 'dom-1',
        mailboxId: 'mb-1',
        complaintType: 'spam',
        source: 'postmaster',
        autoPausedMailbox: true,
      })

      expect(result.autoPausedMailbox).toBe(true)
    })
  })

  describe('resolveComplaint', () => {
    it('resolves an existing complaint', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{
            id: 'comp-3',
            status: 'new',
          }]
        })
        .mockResolvedValueOnce({
          rows: [{
            id: 'comp-3',
            status: 'resolved',
            resolved_at: new Date().toISOString(),
            resolved_by: 'user-1',
          }]
        })

      const result = await resolveComplaint('comp-3', 'org-1', 'user-1')
      expect(result.complaint).toBeTruthy()
      expect(result.error).toBeUndefined()
    })

    it('returns error for non-existent complaint', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] })
      const result = await resolveComplaint('non-existent', 'org-1', 'user-1')
      expect(result.error).toBe('Complaint not found')
    })
  })
})
