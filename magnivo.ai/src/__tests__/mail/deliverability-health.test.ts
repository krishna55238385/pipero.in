import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DnsRecordStatus, DomainHealthLevel } from '@/types/deliverability'

vi.mock('@/lib/db', () => ({
  default: { query: vi.fn() },
}))

vi.mock('@/lib/dns-resolver', () => ({
  lookupReturnPath: vi.fn(),
  lookupDkim: vi.fn(),
}))

import { calculateOverallHealth, calculateHealthBreakdown, scoreToHealthLevel } from '@/services/mail/health-scorer'

describe('deliverability health scoring', () => {
  describe('calculateHealthBreakdown', () => {
    it('returns 100 for all valid records', () => {
      const breakdown = calculateHealthBreakdown('valid', 'valid', 'valid', 'valid')
      expect(breakdown.spf).toBe(100)
      expect(breakdown.dkim).toBe(100)
      expect(breakdown.dmarc).toBe(100)
      expect(breakdown.tracking).toBe(100)
      expect(breakdown.overall).toBe(100)
    })

    it('returns 0 for all missing records', () => {
      const breakdown = calculateHealthBreakdown('missing', 'missing', 'missing', 'missing')
      expect(breakdown.overall).toBe(0)
    })

    it('gives SPF and DKIM more weight than tracking', () => {
      const spfValid = calculateHealthBreakdown('valid', 'missing', 'missing', 'missing')
      const trackingValid = calculateHealthBreakdown('missing', 'missing', 'missing', 'valid')
      expect(spfValid.overall).toBeGreaterThan(trackingValid.overall)
    })

    it('handles mixed statuses', () => {
      const breakdown = calculateHealthBreakdown('valid', 'valid', 'invalid', 'missing')
      expect(breakdown.overall).toBeGreaterThan(0)
      expect(breakdown.overall).toBeLessThan(100)
    })

    it('unverified status gets partial credit', () => {
      const unverified = calculateHealthBreakdown('unverified', 'unverified', 'unverified', 'unverified')
      const missing = calculateHealthBreakdown('missing', 'missing', 'missing', 'missing')
      expect(unverified.overall).toBeGreaterThan(missing.overall)
    })
  })

  describe('scoreToHealthLevel', () => {
    it('returns excellent for 90-100', () => {
      expect(scoreToHealthLevel(100)).toBe('excellent')
      expect(scoreToHealthLevel(90)).toBe('excellent')
      expect(scoreToHealthLevel(95)).toBe('excellent')
    })

    it('returns good for 70-89', () => {
      expect(scoreToHealthLevel(70)).toBe('good')
      expect(scoreToHealthLevel(89)).toBe('good')
      expect(scoreToHealthLevel(75)).toBe('good')
    })

    it('returns fair for 50-69', () => {
      expect(scoreToHealthLevel(50)).toBe('fair')
      expect(scoreToHealthLevel(69)).toBe('fair')
    })

    it('returns poor for 1-49', () => {
      expect(scoreToHealthLevel(1)).toBe('poor')
      expect(scoreToHealthLevel(49)).toBe('poor')
    })

    it('returns unknown for 0', () => {
      expect(scoreToHealthLevel(0)).toBe('unknown')
    })
  })

  describe('calculateOverallHealth', () => {
    it('returns excellent for all valid', () => {
      const result = calculateOverallHealth('valid', 'valid', 'valid', 'valid')
      expect(result.score).toBe(100)
      expect(result.level).toBe('excellent')
    })

    it('returns unknown for all missing', () => {
      const result = calculateOverallHealth('missing', 'missing', 'missing', 'missing')
      expect(result.score).toBe(0)
      expect(result.level).toBe('unknown')
    })

    it('SPF valid only gives poor health', () => {
      const result = calculateOverallHealth('valid', 'missing', 'missing', 'missing')
      expect(result.score).toBe(30)
      expect(result.level).toBe('poor')
    })

    it('SPF and DKIM valid gives fair health', () => {
      const result = calculateOverallHealth('valid', 'valid', 'missing', 'missing')
      expect(result.score).toBe(60)
      expect(result.level).toBe('fair')
    })

    it('SPF, DKIM, and DMARC valid gives good health', () => {
      const result = calculateOverallHealth('valid', 'valid', 'valid', 'missing')
      expect(result.score).toBe(85)
      expect(result.level).toBe('good')
    })
  })
})
