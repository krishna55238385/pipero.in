import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPool = vi.hoisted(() => ({
  query: vi.fn(),
}))
const mockTrackingRepo = vi.hoisted(() => ({
  findTrackingToken: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  default: mockPool,
}))

vi.mock('@/repositories/mail/tracking-repository', () => mockTrackingRepo)

import {
  isKnownBot,
  shouldFilterOpen,
  shouldFilterClick,
  isRateLimited,
  recordFilteredEvent,
} from '@/services/mail/tracking-bot-filter'

describe('tracking-bot-filter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('isKnownBot', () => {
    it('returns true for Googlebot', () => {
      expect(isKnownBot('Mozilla/5.0 Googlebot/2.1')).toBe(true)
    })

    it('returns true for Bingbot', () => {
      expect(isKnownBot('Mozilla/5.0 Bingbot/2.0')).toBe(true)
    })

    it('returns true for Slackbot', () => {
      expect(isKnownBot('Slackbot-LinkExpanding 1.0')).toBe(true)
    })

    it('returns true for AppleBot', () => {
      expect(isKnownBot('Mozilla/5.0 Applebot/0.1')).toBe(true)
    })

    it('returns true for curl', () => {
      expect(isKnownBot('curl/7.68.0')).toBe(true)
    })

    it('returns true for python-requests', () => {
      expect(isKnownBot('python-requests/2.25.0')).toBe(true)
    })

    it('returns true for generic bot pattern', () => {
      expect(isKnownBot('SomeRandomBot/1.0')).toBe(true)
    })

    it('returns false for normal browser user agents', () => {
      expect(isKnownBot('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36')).toBe(false)
    })

    it('returns false for null', () => {
      expect(isKnownBot(null)).toBe(false)
    })

    it('returns false for undefined', () => {
      expect(isKnownBot(undefined)).toBe(false)
    })

    it('returns false for empty string', () => {
      expect(isKnownBot('')).toBe(false)
    })
  })

  describe('shouldFilterOpen', () => {
    it('filters Apple Mail Privacy Protection', async () => {
      const result = await shouldFilterOpen('token-1', {
        userAgent: 'Mac OS X Mail/16.0 Apple Mail Privacy Protection',
      })
      expect(result.filtered).toBe(true)
      expect(result.reason).toContain('Apple Mail')
    })

    it('filters Outlook SafeLinks', async () => {
      const result = await shouldFilterOpen('token-1', {
        userAgent: 'Microsoft Office Outlook Safelink',
      })
      expect(result.filtered).toBe(true)
      expect(result.reason).toContain('SafeLinks')
    })

    it('filters known bots', async () => {
      const result = await shouldFilterOpen('token-1', {
        userAgent: 'Googlebot/2.1',
      })
      expect(result.filtered).toBe(true)
      expect(result.reason).toContain('bot')
    })

    it('filters invalid token', async () => {
      mockTrackingRepo.findTrackingToken.mockResolvedValue(null)
      const result = await shouldFilterOpen('invalid-token', {
        userAgent: 'Mozilla/5.0 normal browser',
      })
      expect(result.filtered).toBe(true)
      expect(result.reason).toContain('Invalid')
    })

    it('filters already-used token (deduplicates)', async () => {
      mockTrackingRepo.findTrackingToken.mockResolvedValue({
        id: 'token-1',
        usedAt: '2026-07-22T12:00:00Z',
      })
      const result = await shouldFilterOpen('token-1', {
        userAgent: 'Mozilla/5.0 normal browser',
      })
      expect(result.filtered).toBe(true)
      expect(result.reason).toContain('Duplicate')
    })

    it('returns not filtered for valid first open from normal user agent', async () => {
      mockTrackingRepo.findTrackingToken.mockResolvedValue({
        id: 'token-1',
        usedAt: null,
      })
      const result = await shouldFilterOpen('token-1', {
        userAgent: 'Mozilla/5.0 normal browser',
        ipAddress: '1.2.3.4',
      })
      expect(result.filtered).toBe(false)
    })
  })

  describe('shouldFilterClick', () => {
    it('filters Outlook SafeLinks', async () => {
      const result = await shouldFilterClick('token-1', {
        userAgent: 'Microsoft Office Outlook Safelink',
      })
      expect(result.filtered).toBe(true)
      expect(result.reason).toContain('SafeLinks')
    })

    it('filters known bots', async () => {
      const result = await shouldFilterClick('token-1', {
        userAgent: 'Twitterbot/1.0',
      })
      expect(result.filtered).toBe(true)
      expect(result.reason).toContain('bot')
    })

    it('filters invalid token', async () => {
      mockTrackingRepo.findTrackingToken.mockResolvedValue(null)
      const result = await shouldFilterClick('invalid', {
        userAgent: 'Mozilla/5.0 normal browser',
      })
      expect(result.filtered).toBe(true)
    })

    it('returns not filtered for valid click', async () => {
      mockTrackingRepo.findTrackingToken.mockResolvedValue({
        id: 'token-1',
        usedAt: null,
      })
      const result = await shouldFilterClick('token-1', {
        userAgent: 'Mozilla/5.0 normal browser',
        ipAddress: '1.2.3.4',
      })
      expect(result.filtered).toBe(false)
    })
  })

  describe('isRateLimited', () => {
    it('allows first request from an IP', async () => {
      const limited = await isRateLimited('10.0.0.1')
      expect(limited).toBe(false)
    })

    it('allows requests under the limit', async () => {
      for (let i = 0; i < 99; i++) {
        await isRateLimited('10.0.0.2')
      }
      const limited = await isRateLimited('10.0.0.2')
      expect(limited).toBe(false)
    })

    it('limits requests at the threshold', async () => {
      for (let i = 0; i < 100; i++) {
        await isRateLimited('10.0.0.3')
      }
      const limited = await isRateLimited('10.0.0.3')
      expect(limited).toBe(true)
    })

    it('resets after window expires', async () => {
      const limited = await isRateLimited('10.0.0.4')
      expect(limited).toBe(false)
    })
  })

  describe('shouldFilterOpen with rate limiting', () => {
    it('filters when IP is rate limited', async () => {
      mockTrackingRepo.findTrackingToken.mockResolvedValue({
        id: 'token-1',
        usedAt: null,
      })
      for (let i = 0; i < 100; i++) {
        await isRateLimited('10.0.0.99')
      }
      const result = await shouldFilterOpen('token-1', {
        userAgent: 'Mozilla/5.0 normal browser',
        ipAddress: '10.0.0.99',
      })
      expect(result.filtered).toBe(true)
      expect(result.reason).toContain('rate limited')
    })
  })

  describe('recordFilteredEvent', () => {
    it('inserts a filtered event record', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 1 })
      await recordFilteredEvent({
        organizationId: 'org-1',
        tokenId: 'token-1',
        eventType: 'open',
        reason: 'bot',
        userAgent: 'Googlebot',
        ipAddress: '1.2.3.4',
      })
      expect(mockPool.query).toHaveBeenCalledOnce()
    })

    it('handles missing optional fields', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 1 })
      await recordFilteredEvent({
        organizationId: 'org-1',
        tokenId: 'token-1',
        eventType: 'click',
        reason: 'test',
      })
      expect(mockPool.query).toHaveBeenCalledOnce()
    })
  })
})
