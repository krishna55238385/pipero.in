import { describe, it, expect } from 'vitest'
import { lookupSpf, lookupDkim, lookupDmarc, lookupAllRecords } from '@/lib/dns-resolver'

describe('dns-resolver', () => {
  describe('lookupSpf', () => {
    it('returns error for non-existent domain', async () => {
      const result = await lookupSpf('this-domain-does-not-exist-xyz123.com')
      expect(result.found).toBe(false)
      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })

    it('handles domains without SPF', async () => {
      const result = await lookupSpf('google.com')
      expect(result.found).toBe(true)
      expect(result.raw).toContain('v=spf1')
    })
  })

  describe('lookupDkim', () => {
    it('returns error for non-existent selector', async () => {
      const result = await lookupDkim('this-domain-does-not-exist-xyz123.com', 'default')
      expect(result.found).toBe(false)
      expect(result.valid).toBe(false)
    })
  })

  describe('lookupDmarc', () => {
    it('returns error for non-existent domain', async () => {
      const result = await lookupDmarc('this-domain-does-not-exist-xyz123.com')
      expect(result.found).toBe(false)
      expect(result.valid).toBe(false)
    })

    it('finds DMARC record for google.com', async () => {
      const result = await lookupDmarc('google.com')
      expect(result.found).toBe(true)
      expect(result.raw?.toLowerCase()).toContain('v=dmarc1')
    })
  })

  describe('lookupAllRecords', () => {
    it('returns all record types for a domain', async () => {
      const result = await lookupAllRecords('this-domain-does-not-exist-xyz123.com', 'default')
      expect(result).toHaveProperty('spf')
      expect(result).toHaveProperty('dkim')
      expect(result).toHaveProperty('dmarc')
      expect(result).toHaveProperty('tracking')
      expect(result).toHaveProperty('returnPath')
    })
  })
})
