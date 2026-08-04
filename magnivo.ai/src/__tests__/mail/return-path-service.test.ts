import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDomainRepo = vi.hoisted(() => ({
  findDomainById: vi.fn(),
}))

const mockReturnPathRepo = vi.hoisted(() => ({
  findReturnPathsByOrg: vi.fn(),
  findReturnPathsByDomain: vi.fn(),
  findReturnPathById: vi.fn(),
  insertReturnPath: vi.fn(),
  insertAuditEntry: vi.fn(),
}))

vi.mock('@/repositories/mail/domain-repository', () => mockDomainRepo)
vi.mock('@/repositories/mail/return-path-repository', () => mockReturnPathRepo)

import {
  listReturnPaths,
  createReturnPath,
  verifyReturnPath,
} from '@/services/mail/return-path-service'

describe('return-path-service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('createReturnPath', () => {
    it('creates a return path successfully', async () => {
      mockDomainRepo.findDomainById.mockResolvedValue({
        id: 'dom-1',
        domain: 'example.com',
        organizationId: 'org-1',
      })
      mockReturnPathRepo.findReturnPathsByDomain.mockResolvedValue([])
      mockReturnPathRepo.insertReturnPath.mockResolvedValue({
        id: 'rp-1',
        organizationId: 'org-1',
        domainId: 'dom-1',
        returnPathDomain: 'bounce.example.com',
        cnameTarget: null,
        status: 'pending',
        isDefault: true,
        lastVerifiedAt: null,
        expiresAt: null,
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      mockReturnPathRepo.insertAuditEntry.mockResolvedValue(undefined)

      const result = await createReturnPath('org-1', {
        domainId: 'dom-1',
        returnPathDomain: 'bounce.example.com',
      })

      expect(result.error).toBeUndefined()
      expect(result.returnPath).toBeTruthy()
      expect(result.returnPath?.returnPathDomain).toBe('bounce.example.com')
    })

    it('returns error when domain not found', async () => {
      mockDomainRepo.findDomainById.mockResolvedValue(null)

      const result = await createReturnPath('org-1', {
        domainId: 'non-existent',
        returnPathDomain: 'bounce.example.com',
      })

      expect(result.error).toBe('Domain not found')
    })

    it('returns error when return path already exists', async () => {
      mockDomainRepo.findDomainById.mockResolvedValue({
        id: 'dom-1',
        domain: 'example.com',
      })
      mockReturnPathRepo.findReturnPathsByDomain.mockResolvedValue([{
        id: 'rp-existing',
        returnPathDomain: 'bounce.example.com',
      }])

      const result = await createReturnPath('org-1', {
        domainId: 'dom-1',
        returnPathDomain: 'bounce.example.com',
      })

      expect(result.error).toBe('Return path already exists')
    })
  })

  describe('verifyReturnPath', () => {
    it('returns error when return path not found', async () => {
      mockReturnPathRepo.findReturnPathById.mockResolvedValue(null)

      const result = await verifyReturnPath('non-existent', 'org-1')
      expect(result.success).toBe(false)
      expect(result.error).toBe('Return path not found')
    })
  })
})
