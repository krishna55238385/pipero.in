import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockTrackingRepo = vi.hoisted(() => ({
  createTrackingToken: vi.fn(),
  findTrackingToken: vi.fn(),
  markTokenUsed: vi.fn(),
  recordPixelEvent: vi.fn(),
  recordClickEvent: vi.fn(),
}))

vi.mock('@/repositories/mail/tracking-repository', () => mockTrackingRepo)

import { generateTrackingToken, handlePixelOpen, handleClick, buildTrackingPixelUrl, buildClickRedirectUrl } from '@/services/mail/tracking-service'

describe('tracking-service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('generateTrackingToken', () => {
    it('creates an open tracking token', async () => {
      mockTrackingRepo.createTrackingToken.mockResolvedValue({
        id: 'token-1',
        organizationId: 'org-1',
        campaignId: 'camp-1',
        mailboxId: null,
        token: 'abc123def456',
        tokenType: 'open',
        recipientEmail: 'test@example.com',
        expiresAt: null,
        usedAt: null,
        metadata: {},
        createdAt: new Date().toISOString(),
      })

      const result = await generateTrackingToken({
        organizationId: 'org-1',
        campaignId: 'camp-1',
        tokenType: 'open',
        recipientEmail: 'test@example.com',
      })

      expect(result.tokenType).toBe('open')
      expect(result.token).toBeTruthy()
      expect(result.recipientEmail).toBe('test@example.com')
    })

    it('creates a click tracking token', async () => {
      mockTrackingRepo.createTrackingToken.mockResolvedValue({
        id: 'token-2',
        organizationId: 'org-1',
        token: 'xyz789',
        tokenType: 'click',
        metadata: {},
        createdAt: new Date().toISOString(),
      })

      const result = await generateTrackingToken({
        organizationId: 'org-1',
        tokenType: 'click',
      })

      expect(result.tokenType).toBe('click')
    })
  })

  describe('handlePixelOpen', () => {
    it('records pixel open for valid token', async () => {
      mockTrackingRepo.findTrackingToken.mockResolvedValue({
        id: 'token-3',
        organizationId: 'org-1',
        token: 'valid-token',
        tokenType: 'open',
        campaignId: 'camp-1',
        recipientEmail: 'reader@example.com',
      })
      mockTrackingRepo.markTokenUsed.mockResolvedValue(undefined)
      mockTrackingRepo.recordPixelEvent.mockResolvedValue({})

      const result = await handlePixelOpen('valid-token', {
        userAgent: 'Mozilla/5.0',
        ipAddress: '192.168.1.1',
      })

      expect(result.recorded).toBe(true)
      expect(mockTrackingRepo.markTokenUsed).toHaveBeenCalledWith('token-3')
    })

    it('returns error for invalid token', async () => {
      mockTrackingRepo.findTrackingToken.mockResolvedValue(null)

      const result = await handlePixelOpen('invalid-token', {})
      expect(result.recorded).toBe(false)
      expect(result.error).toBeTruthy()
    })
  })

  describe('handleClick', () => {
    it('records click and returns redirect URL', async () => {
      mockTrackingRepo.findTrackingToken.mockResolvedValue({
        id: 'token-4',
        organizationId: 'org-1',
        token: 'click-token',
        tokenType: 'click',
        campaignId: 'camp-1',
        recipientEmail: 'clicker@example.com',
      })
      mockTrackingRepo.markTokenUsed.mockResolvedValue(undefined)
      mockTrackingRepo.recordClickEvent.mockResolvedValue({})

      const result = await handleClick('click-token', 'https://example.com', {
        userAgent: 'Mozilla/5.0',
        ipAddress: '10.0.0.1',
      })

      expect(result.recorded).toBe(true)
      expect(result.redirectUrl).toBe('https://example.com')
    })

    it('returns error for expired token', async () => {
      mockTrackingRepo.findTrackingToken.mockResolvedValue(null)

      const result = await handleClick('expired-token', 'https://example.com', {})
      expect(result.recorded).toBe(false)
      expect(result.error).toBeTruthy()
    })
  })

  describe('URL builders', () => {
    it('builds relative pixel tracking URL by default', () => {
      const url = buildTrackingPixelUrl('abc123')
      expect(url).toBe('/api/tracking/pixel/abc123')
    })

    it('builds absolute pixel URL when requested', () => {
      process.env.APP_URL = 'https://app.magnivo.ai'
      const url = buildTrackingPixelUrl('abc123', { absolute: true })
      expect(url).toBe('https://app.magnivo.ai/api/tracking/pixel/abc123')
    })

    it('builds click redirect URL', () => {
      const url = buildClickRedirectUrl('abc123', 'https://example.com')
      expect(url).toContain('/api/tracking/click/abc123')
      expect(url).toContain('url=')
    })

    it('builds absolute click redirect URL when requested', () => {
      process.env.APP_URL = 'https://app.magnivo.ai'
      const url = buildClickRedirectUrl('abc123', 'https://example.com', { absolute: true })
      expect(url.startsWith('https://app.magnivo.ai/api/tracking/click/')).toBe(true)
    })
  })
})
