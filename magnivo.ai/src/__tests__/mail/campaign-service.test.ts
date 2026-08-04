import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Campaign } from '@/types/campaign'

vi.mock('@/lib/db', () => {
  const queryFn = vi.fn().mockResolvedValue({ rows: [] })
  return { default: { query: queryFn, connect: vi.fn(), end: vi.fn() } }
})

vi.mock('@/lib/campaign-state-machine', () => ({
  canTransition: vi.fn().mockReturnValue({ valid: true, from: 'draft', to: 'paused' }),
}))

vi.mock('@/services/mail/send-dispatcher', () => ({
  assertCampaignMailboxesWarm: vi.fn().mockResolvedValue({ success: true, data: true }),
}))

vi.mock('@/repositories/mail/campaign-repository', () => ({
  findCampaignById: vi.fn().mockResolvedValue(null),
  findCampaignByName: vi.fn().mockResolvedValue(null),
  findCampaignsByOrg: vi.fn().mockResolvedValue([]),
  searchCampaigns: vi.fn().mockResolvedValue({ campaigns: [], total: 0 }),
  updateCampaign: vi.fn().mockResolvedValue(null),
  softDeleteCampaign: vi.fn().mockResolvedValue(false),
  archiveCampaign: vi.fn().mockResolvedValue(false),
  restoreCampaign: vi.fn().mockResolvedValue(false),
  duplicateCampaign: vi.fn().mockResolvedValue(null),
  moveCampaignToFolder: vi.fn().mockResolvedValue(null),
  findTagsByCampaignId: vi.fn().mockResolvedValue([]),
  findLabelsByCampaignId: vi.fn().mockResolvedValue([]),
  attachTagsToCampaign: vi.fn().mockResolvedValue(undefined),
  detachTagsFromCampaign: vi.fn().mockResolvedValue(undefined),
  attachLabelsToCampaign: vi.fn().mockResolvedValue(undefined),
  detachLabelsFromCampaign: vi.fn().mockResolvedValue(undefined),
  bulkUpdateCampaignStatus: vi.fn().mockResolvedValue(undefined),
  bulkArchiveCampaigns: vi.fn().mockResolvedValue(0),
  bulkDeleteCampaigns: vi.fn().mockResolvedValue(0),
  getDashboardStats: vi.fn().mockResolvedValue({
    totalCampaigns: 0, draft: 0, scheduled: 0, running: 0, paused: 0,
    completed: 0, archived: 0, failed: 0, totalSent: 0, totalOpened: 0,
    totalClicked: 0, avgOpenRate: 0, avgClickRate: 0,
  }),
}))

vi.mock('@/repositories/mail/mailbox-pool-repository', () => ({
  findPoolById: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/repositories/mail/campaign-version-repository', () => ({
  findVersionsByCampaignId: vi.fn().mockResolvedValue([]),
  findVersionById: vi.fn().mockResolvedValue(null),
  insertVersion: vi.fn().mockResolvedValue(null),
  updateVersion: vi.fn().mockResolvedValue(null),
  deleteVersion: vi.fn().mockResolvedValue(false),
}))

vi.mock('@/repositories/mail/campaign-history-repository', () => ({
  insertHistory: vi.fn().mockResolvedValue(null),
  findByCampaignId: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/repositories/mail/campaign-event-repository', () => ({
  insertEvent: vi.fn().mockResolvedValue(null),
  findByCampaignId: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/repositories/mail/campaign-tag-repository', () => ({
  findTagsByOrg: vi.fn().mockResolvedValue([]),
  insertTag: vi.fn().mockResolvedValue(null),
  updateTag: vi.fn().mockResolvedValue(null),
  deleteTag: vi.fn().mockResolvedValue(false),
}))

vi.mock('@/repositories/mail/campaign-label-repository', () => ({
  findLabelsByOrg: vi.fn().mockResolvedValue([]),
  insertLabel: vi.fn().mockResolvedValue(null),
  updateLabel: vi.fn().mockResolvedValue(null),
  deleteLabel: vi.fn().mockResolvedValue(false),
}))

import * as campaignRepo from '@/repositories/mail/campaign-repository'
import * as poolRepo from '@/repositories/mail/mailbox-pool-repository'
import * as campaignService from '@/services/mail/campaign-service'
import { canTransition } from '@/lib/campaign-state-machine'
import * as tagRepo from '@/repositories/mail/campaign-tag-repository'
import * as labelRepo from '@/repositories/mail/campaign-label-repository'

const mockActor = { userId: 'user-1', email: 'user@test.com' }
const orgId = 'org-1'

function makeCampaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: 'camp-1',
    organizationId: orgId,
    folderId: null,
    name: 'Test Campaign',
    description: '',
    status: 'draft',
    subject: 'Test Subject',
    bodyHtml: '',
    bodyText: '',
    previewText: '',
    fromName: '',
    fromEmail: '',
    replyTo: '',
    poolId: null,
    timezone: 'UTC',
    triggerType: 'manual',
    ownerId: 'user-1',
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

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(campaignRepo.findCampaignById).mockResolvedValue(null)
  vi.mocked(campaignRepo.findCampaignByName).mockResolvedValue(null)
  vi.mocked(campaignRepo.findTagsByCampaignId).mockResolvedValue([])
  vi.mocked(campaignRepo.findLabelsByCampaignId).mockResolvedValue([])
  vi.mocked(campaignRepo.updateCampaign).mockResolvedValue(null)
  vi.mocked(campaignRepo.softDeleteCampaign).mockResolvedValue(false)
  vi.mocked(campaignRepo.archiveCampaign).mockResolvedValue(false)
  vi.mocked(campaignRepo.duplicateCampaign).mockResolvedValue(null)
  vi.mocked(campaignRepo.searchCampaigns).mockResolvedValue({ campaigns: [], total: 0 })
  vi.mocked(canTransition).mockReturnValue({ valid: true, from: 'draft', to: 'paused' })
  vi.mocked(poolRepo.findPoolById).mockResolvedValue(null)
})

describe('campaign-service', () => {
  describe('createCampaign', () => {
    it('rejects empty name', async () => {
      const result = await campaignService.createCampaign(orgId, { name: '' }, mockActor)
      expect(result.success).toBe(false)
    })

    it('rejects name exceeding 255 chars', async () => {
      const result = await campaignService.createCampaign(orgId, { name: 'a'.repeat(256) }, mockActor)
      expect(result.success).toBe(false)
    })

    it('rejects invalid timezone', async () => {
      const result = await campaignService.createCampaign(
        orgId,
        { name: 'Test', timezone: '' },
        mockActor
      )
      expect(result.success).toBe(false)
    })

    it('rejects when pool not found', async () => {
      vi.mocked(poolRepo.findPoolById).mockResolvedValue(null)
      const result = await campaignService.createCampaign(
        orgId,
        { name: 'Test', poolId: 'pool-1' },
        mockActor
      )
      expect(result.success).toBe(false)
    })

    it('creates campaign with valid input', async () => {
      const created = makeCampaign({ id: 'new-camp', name: 'New Campaign' })

      const mockClient = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [{ id: 'new-camp' }] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] }),
        release: vi.fn(),
      }
      const pool = await import('@/lib/db')
      vi.mocked(pool.default.connect).mockResolvedValue(mockClient as never)

      vi.mocked(campaignRepo.findCampaignById).mockResolvedValue(created)

      const result = await campaignService.createCampaign(
        orgId,
        { name: 'New Campaign' },
        mockActor
      )

      expect(result.success).toBe(true)
    })
  })

  describe('updateCampaign', () => {
    it('rejects when campaign not found', async () => {
      vi.mocked(campaignRepo.findCampaignById).mockResolvedValue(null)
      const result = await campaignService.updateCampaign('camp-1', orgId, { name: 'Updated' }, mockActor)
      expect(result.success).toBe(false)
      expect((result as { success: false; error: string }).error).toContain('not found')
    })

    it('rejects update on running campaign', async () => {
      vi.mocked(campaignRepo.findCampaignById).mockResolvedValue(makeCampaign({ status: 'running' }))
      const result = await campaignService.updateCampaign('camp-1', orgId, { name: 'Updated' }, mockActor)
      expect(result.success).toBe(false)
    })

    it('rejects version conflict', async () => {
      vi.mocked(campaignRepo.findCampaignById).mockResolvedValue(makeCampaign({ version: 3 }))
      const result = await campaignService.updateCampaign('camp-1', orgId, { name: 'Updated', version: 1 }, mockActor)
      expect(result.success).toBe(false)
    })

    it('updates draft campaign successfully', async () => {
      const draft = makeCampaign({ version: 1 })
      const updated = makeCampaign({ name: 'Updated', version: 2 })
      vi.mocked(campaignRepo.findCampaignById)
        .mockResolvedValueOnce(draft)
        .mockResolvedValueOnce(updated)
      vi.mocked(campaignRepo.findCampaignByName).mockResolvedValue(null)
      vi.mocked(campaignRepo.updateCampaign).mockResolvedValue(updated)

      const result = await campaignService.updateCampaign('camp-1', orgId, { name: 'Updated', version: 1 }, mockActor)
      expect(result.success).toBe(true)
    })
  })

  describe('deleteCampaign', () => {
    it('rejects when campaign not found', async () => {
      vi.mocked(campaignRepo.findCampaignById).mockResolvedValue(null)
      const result = await campaignService.deleteCampaign('camp-1', orgId, mockActor)
      expect(result.success).toBe(false)
    })

    it('rejects delete on running campaign', async () => {
      vi.mocked(campaignRepo.findCampaignById).mockResolvedValue(makeCampaign({ status: 'running' }))
      const result = await campaignService.deleteCampaign('camp-1', orgId, mockActor)
      expect(result.success).toBe(false)
    })

    it('deletes draft campaign successfully', async () => {
      vi.mocked(campaignRepo.findCampaignById).mockResolvedValue(makeCampaign())
      vi.mocked(campaignRepo.softDeleteCampaign).mockResolvedValue(true)

      const result = await campaignService.deleteCampaign('camp-1', orgId, mockActor)
      expect(result.success).toBe(true)
    })
  })

  describe('pauseCampaign', () => {
    it('rejects when campaign not found', async () => {
      vi.mocked(campaignRepo.findCampaignById).mockResolvedValue(null)
      const result = await campaignService.pauseCampaign('camp-1', orgId, mockActor)
      expect(result.success).toBe(false)
    })

    it('rejects pause on draft', async () => {
      vi.mocked(campaignRepo.findCampaignById).mockResolvedValue(makeCampaign({ status: 'draft' }))
      const result = await campaignService.pauseCampaign('camp-1', orgId, mockActor)
      expect(result.success).toBe(false)
    })

    it('pauses running campaign', async () => {
      const running = makeCampaign({ status: 'running' })
      const paused = makeCampaign({ status: 'paused' })
      vi.mocked(canTransition).mockReturnValue({ valid: true, from: 'running', to: 'paused' })
      vi.mocked(campaignRepo.findCampaignById)
        .mockResolvedValueOnce(running)
        .mockResolvedValueOnce(paused)
      vi.mocked(campaignRepo.updateCampaign).mockResolvedValue(paused)

      const result = await campaignService.pauseCampaign('camp-1', orgId, mockActor)
      expect(result.success).toBe(true)
    })
  })

  describe('resumeCampaign', () => {
    it('rejects when campaign not found', async () => {
      vi.mocked(campaignRepo.findCampaignById).mockResolvedValue(null)
      const result = await campaignService.resumeCampaign('camp-1', orgId, mockActor)
      expect(result.success).toBe(false)
    })

    it('rejects resume on non-paused', async () => {
      vi.mocked(campaignRepo.findCampaignById).mockResolvedValue(makeCampaign({ status: 'draft' }))
      const result = await campaignService.resumeCampaign('camp-1', orgId, mockActor)
      expect(result.success).toBe(false)
    })

    it('resumes paused campaign', async () => {
      const paused = makeCampaign({ status: 'paused', poolId: 'pool-1' })
      const running = makeCampaign({ status: 'running', poolId: 'pool-1' })
      vi.mocked(canTransition).mockReturnValue({ valid: true, from: 'paused', to: 'running' })
      vi.mocked(campaignRepo.findCampaignById)
        .mockResolvedValueOnce(paused)
        .mockResolvedValueOnce(running)
      vi.mocked(campaignRepo.updateCampaign).mockResolvedValue(running)

      const result = await campaignService.resumeCampaign('camp-1', orgId, mockActor)
      expect(result.success).toBe(true)
    })
  })

  describe('archiveCampaign', () => {
    it('rejects when campaign not found', async () => {
      vi.mocked(campaignRepo.findCampaignById).mockResolvedValue(null)
      const result = await campaignService.archiveCampaign('camp-1', orgId, mockActor)
      expect(result.success).toBe(false)
    })

    it('rejects archive on running', async () => {
      vi.mocked(campaignRepo.findCampaignById).mockResolvedValue(makeCampaign({ status: 'running' }))
      const result = await campaignService.archiveCampaign('camp-1', orgId, mockActor)
      expect(result.success).toBe(false)
    })

    it('archives draft campaign', async () => {
      vi.mocked(campaignRepo.findCampaignById).mockResolvedValue(makeCampaign())
      vi.mocked(campaignRepo.archiveCampaign).mockResolvedValue(true)

      const result = await campaignService.archiveCampaign('camp-1', orgId, mockActor)
      expect(result.success).toBe(true)
    })
  })

  describe('duplicateCampaign', () => {
    it('rejects when campaign not found', async () => {
      vi.mocked(campaignRepo.findCampaignById).mockResolvedValue(null)
      const result = await campaignService.duplicateCampaign('camp-1', orgId, mockActor)
      expect(result.success).toBe(false)
    })

    it('duplicates campaign successfully', async () => {
      const original = makeCampaign()
      const duplicated = makeCampaign({ id: 'new-camp', name: 'Test Campaign (Copy)' })
      vi.mocked(campaignRepo.findCampaignById)
        .mockResolvedValueOnce(original)
        .mockResolvedValueOnce(duplicated)
      vi.mocked(campaignRepo.duplicateCampaign).mockResolvedValue(duplicated)

      const result = await campaignService.duplicateCampaign('camp-1', orgId, mockActor)
      expect(result.success).toBe(true)
    })
  })

  describe('getCampaign', () => {
    it('returns null for missing campaign', async () => {
      vi.mocked(campaignRepo.findCampaignById).mockResolvedValue(null)
      const result = await campaignService.getCampaign('camp-1', orgId)
      expect(result.success).toBe(false)
    })

    it('returns campaign when found', async () => {
      const campaign = makeCampaign()
      vi.mocked(campaignRepo.findCampaignById).mockResolvedValue(campaign)

      const result = await campaignService.getCampaign('camp-1', orgId)
      expect(result.success).toBe(true)
    })
  })

  describe('searchCampaigns', () => {
    it('searches with defaults', async () => {
      vi.mocked(campaignRepo.searchCampaigns).mockResolvedValue({ campaigns: [], total: 0 })

      const result = await campaignService.searchCampaigns(orgId, {})
      expect(result.total).toBe(0)
      expect(result.page).toBe(1)
      expect(result.pageSize).toBe(20)
    })
  })

  describe('bulkOperation', () => {
    it('rejects empty campaign ids', async () => {
      const result = await campaignService.bulkOperation({ operation: 'pause', campaignIds: [] }, orgId, mockActor)
      expect(result.success).toBe(false)
    })
  })

  describe('tag management', () => {
    it('lists tags', async () => {
      vi.mocked(tagRepo.findTagsByOrg).mockResolvedValue([])
      const result = await campaignService.listTags(orgId)
      expect(result).toEqual([])
    })

    it('creates tag', async () => {
      vi.mocked(tagRepo.insertTag).mockResolvedValue({ id: 'tag-1', name: 'Test', color: '#fff', organizationId: orgId, metadata: {}, createdAt: '', updatedAt: '' } as never)
      const result = await campaignService.createTag(orgId, 'Test', '#fff')
      expect(result.id).toBe('tag-1')
    })

    it('lists labels', async () => {
      vi.mocked(labelRepo.findLabelsByOrg).mockResolvedValue([])
      const result = await campaignService.listLabels(orgId)
      expect(result).toEqual([])
    })
  })
})
