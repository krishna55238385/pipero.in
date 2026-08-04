import { describe, it, expect } from 'vitest'
import {
  validateCampaignName,
  validateCampaignNameUnique,
  validateCanUpdateCampaign,
  validateCanDeleteCampaign,
  validateCanArchiveCampaign,
  validateCanPauseCampaign,
  validateCanResumeCampaign,
  validateCanDuplicateCampaign,
  validatePoolAssignment,
  validateTimezone,
  validateVersionConflict,
  validateBulkOperation,
} from '@/services/mail/campaign-validation-service'
import type { Campaign } from '@/types/campaign'

function makeCampaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: 'camp-1',
    organizationId: 'org-1',
    folderId: null,
    name: 'Test Campaign',
    description: '',
    status: 'draft',
    subject: 'Test Subject',
    bodyHtml: '<p>Hello</p>',
    bodyText: 'Hello',
    previewText: '',
    fromName: 'Test',
    fromEmail: 'test@example.com',
    replyTo: '',
    poolId: null,
    timezone: 'UTC',
    triggerType: 'manual',
    ownerId: null,
    version: 1,
    isDeleted: false,
    deletedAt: null,
    archivedAt: null,
    scheduledAt: null,
    startedAt: null,
    stoppedAt: null,
    completedAt: null,
    lastPausedAt: null,
    recipientCount: 0,
    sentCount: 0,
    openCount: 0,
    clickCount: 0,
    replyCount: 0,
    bounceCount: 0,
    unsubscribeCount: 0,
    metadata: {},
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('campaign-validation-service', () => {
  describe('validateCampaignName', () => {
    it('rejects empty name', () => {
      const result = validateCampaignName('')
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Campaign name is required')
    })

    it('rejects whitespace-only name', () => {
      const result = validateCampaignName('   ')
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Campaign name is required')
    })

    it('rejects name exceeding 255 chars', () => {
      const result = validateCampaignName('a'.repeat(256))
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('255'))).toBe(true)
    })

    it('accepts valid name', () => {
      const result = validateCampaignName('My Campaign')
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })
  })

  describe('validateCanUpdateCampaign', () => {
    it('allows update on draft', () => {
      const result = validateCanUpdateCampaign(makeCampaign({ status: 'draft' }))
      expect(result.valid).toBe(true)
    })

    it('allows update on scheduled', () => {
      const result = validateCanUpdateCampaign(makeCampaign({ status: 'scheduled' }))
      expect(result.valid).toBe(true)
    })

    it('allows update on paused', () => {
      const result = validateCanUpdateCampaign(makeCampaign({ status: 'paused' }))
      expect(result.valid).toBe(true)
    })

    it('rejects update on running', () => {
      const result = validateCanUpdateCampaign(makeCampaign({ status: 'running' }))
      expect(result.valid).toBe(false)
    })

    it('rejects update on completed', () => {
      const result = validateCanUpdateCampaign(makeCampaign({ status: 'completed' }))
      expect(result.valid).toBe(false)
    })

    it('rejects update on archived', () => {
      const result = validateCanUpdateCampaign(makeCampaign({ status: 'archived' }))
      expect(result.valid).toBe(false)
    })
  })

  describe('validateCanDeleteCampaign', () => {
    it('allows delete on draft', () => {
      const result = validateCanDeleteCampaign(makeCampaign({ status: 'draft' }))
      expect(result.valid).toBe(true)
    })

    it('rejects delete on running', () => {
      const result = validateCanDeleteCampaign(makeCampaign({ status: 'running' }))
      expect(result.valid).toBe(false)
    })

    it('rejects delete on scheduled', () => {
      const result = validateCanDeleteCampaign(makeCampaign({ status: 'scheduled' }))
      expect(result.valid).toBe(false)
    })

    it('allows delete on paused', () => {
      const result = validateCanDeleteCampaign(makeCampaign({ status: 'paused' }))
      expect(result.valid).toBe(true)
    })
  })

  describe('validateCanArchiveCampaign', () => {
    it('allows archive on draft', () => {
      const result = validateCanArchiveCampaign(makeCampaign({ status: 'draft' }))
      expect(result.valid).toBe(true)
    })

    it('rejects archive on running', () => {
      const result = validateCanArchiveCampaign(makeCampaign({ status: 'running' }))
      expect(result.valid).toBe(false)
    })

    it('rejects archive on deleted campaign', () => {
      const result = validateCanArchiveCampaign(makeCampaign({ isDeleted: true }))
      expect(result.valid).toBe(false)
    })
  })

  describe('validateCanPauseCampaign', () => {
    it('allows pause on running', () => {
      const result = validateCanPauseCampaign(makeCampaign({ status: 'running' }))
      expect(result.valid).toBe(true)
    })

    it('allows pause on scheduled', () => {
      const result = validateCanPauseCampaign(makeCampaign({ status: 'scheduled' }))
      expect(result.valid).toBe(true)
    })

    it('rejects pause on draft', () => {
      const result = validateCanPauseCampaign(makeCampaign({ status: 'draft' }))
      expect(result.valid).toBe(false)
    })

    it('rejects pause on paused', () => {
      const result = validateCanPauseCampaign(makeCampaign({ status: 'paused' }))
      expect(result.valid).toBe(false)
    })
  })

  describe('validateCanResumeCampaign', () => {
    it('allows resume on paused', () => {
      const result = validateCanResumeCampaign(makeCampaign({ status: 'paused' }))
      expect(result.valid).toBe(true)
    })

    it('rejects resume on running', () => {
      const result = validateCanResumeCampaign(makeCampaign({ status: 'running' }))
      expect(result.valid).toBe(false)
    })

    it('rejects resume on draft', () => {
      const result = validateCanResumeCampaign(makeCampaign({ status: 'draft' }))
      expect(result.valid).toBe(false)
    })
  })

  describe('validateCanDuplicateCampaign', () => {
    it('always allows duplication', () => {
      const result = validateCanDuplicateCampaign(makeCampaign({ status: 'running' }))
      expect(result.valid).toBe(true)
    })
  })

  describe('validateTimezone', () => {
    it('rejects empty timezone', () => {
      const result = validateTimezone('')
      expect(result.valid).toBe(false)
    })

    it('accepts valid timezone', () => {
      const result = validateTimezone('UTC')
      expect(result.valid).toBe(true)
    })
  })

  describe('validateVersionConflict', () => {
    it('allows when no provided version', () => {
      const result = validateVersionConflict(5)
      expect(result.valid).toBe(true)
    })

    it('allows when versions match', () => {
      const result = validateVersionConflict(5, 5)
      expect(result.valid).toBe(true)
    })

    it('rejects when versions mismatch', () => {
      const result = validateVersionConflict(5, 3)
      expect(result.valid).toBe(false)
    })
  })

  describe('validateBulkOperation', () => {
    it('rejects empty campaigns', () => {
      const result = validateBulkOperation([], 'pause')
      expect(result.valid).toBe(false)
    })

    it('validates pause on non-pausable campaigns', () => {
      const campaigns = [
        makeCampaign({ status: 'draft' }),
        makeCampaign({ status: 'completed' }),
      ]
      const result = validateBulkOperation(campaigns, 'pause')
      expect(result.valid).toBe(false)
    })

    it('validates resume on non-resumable campaigns', () => {
      const campaigns = [
        makeCampaign({ status: 'running' }),
      ]
      const result = validateBulkOperation(campaigns, 'resume')
      expect(result.valid).toBe(false)
    })

    it('validates archive on running campaigns', () => {
      const campaigns = [
        makeCampaign({ status: 'running' }),
      ]
      const result = validateBulkOperation(campaigns, 'archive')
      expect(result.valid).toBe(false)
    })

    it('validates delete on running campaigns', () => {
      const campaigns = [
        makeCampaign({ status: 'running' }),
      ]
      const result = validateBulkOperation(campaigns, 'delete')
      expect(result.valid).toBe(false)
    })

    it('rejects unknown operation', () => {
      const campaigns = [makeCampaign()]
      const result = validateBulkOperation(campaigns, 'unknown')
      expect(result.valid).toBe(false)
    })

    it('passes for valid pause operation', () => {
      const campaigns = [
        makeCampaign({ status: 'running' }),
        makeCampaign({ status: 'scheduled' }),
      ]
      const result = validateBulkOperation(campaigns, 'pause')
      expect(result.valid).toBe(true)
    })

    it('passes for valid resume operation', () => {
      const campaigns = [
        makeCampaign({ status: 'paused' }),
      ]
      const result = validateBulkOperation(campaigns, 'resume')
      expect(result.valid).toBe(true)
    })
  })
})
