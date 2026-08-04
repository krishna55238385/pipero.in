import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDomainRepo = vi.hoisted(() => ({
  findDomainById: vi.fn(),
}))

const mockBlacklistRepo = vi.hoisted(() => ({
  insertCheck: vi.fn(),
  getBlacklistDashboardStats: vi.fn(),
}))

vi.mock('@/repositories/mail/domain-repository', () => mockDomainRepo)
vi.mock('@/repositories/mail/blacklist-check-repository', () => mockBlacklistRepo)

import {
  checkBlacklistForDomain,
  getBlacklistDashboardStats,
} from '@/services/mail/blacklist-service'

describe('blacklist-service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('checkBlacklistForDomain', () => {
    it('returns error when domain not found', async () => {
      mockDomainRepo.findDomainById.mockResolvedValue(null)

      const result = await checkBlacklistForDomain('org-1', 'non-existent', 'spamhaus')
      expect(result.status).toBe('unknown')
      expect(result.error).toBe('Domain not found')
    })

    it('checks a domain against a blacklist', async () => {
      mockDomainRepo.findDomainById.mockResolvedValue({
        id: 'dom-1',
        domain: 'example.com',
        organizationId: 'org-1',
      })
      mockBlacklistRepo.insertCheck.mockResolvedValue({
        id: 'check-1',
        organizationId: 'org-1',
        domainId: 'dom-1',
        blacklistName: 'spamhaus',
        status: 'clean',
        checkResult: 'Not listed',
        createdAt: new Date().toISOString(),
      })

      const result = await checkBlacklistForDomain('org-1', 'dom-1', 'spamhaus')
      expect(result.status).toMatch(/clean|timeout/)
    })
  })

  describe('getBlacklistDashboardStats', () => {
    it('returns dashboard stats', async () => {
      mockBlacklistRepo.getBlacklistDashboardStats.mockResolvedValue({
        totalDomainsChecked: 5,
        cleanDomains: 4,
        listedDomains: 1,
        unknownDomains: 0,
        recentListings: [],
      })

      const stats = await getBlacklistDashboardStats('org-1')
      expect(stats.totalDomainsChecked).toBe(5)
      expect(stats.listedDomains).toBe(1)
      expect(stats.unknownDomains).toBe(0)
      expect(stats.recentListings).toEqual([])
    })

    it('returns zeros when no data', async () => {
      mockBlacklistRepo.getBlacklistDashboardStats.mockResolvedValue({
        totalDomainsChecked: 0,
        cleanDomains: 0,
        listedDomains: 0,
        unknownDomains: 0,
        recentListings: [],
      })

      const stats = await getBlacklistDashboardStats('org-1')
      expect(stats.totalDomainsChecked).toBe(0)
      expect(stats.cleanDomains).toBe(0)
    })
  })
})
