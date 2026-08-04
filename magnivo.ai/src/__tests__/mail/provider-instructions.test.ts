import { describe, it, expect } from 'vitest'
import { getProviderDnsInstructions, getAllProviders, detectDnsProvider } from '@/services/mail/provider-instructions'

describe('provider-instructions', () => {
  describe('getProviderDnsInstructions', () => {
    it('returns SPF instructions for Cloudflare', () => {
      const instructions = getProviderDnsInstructions('company.com', 'spf', 'cloudflare')
      expect(instructions.length).toBe(1)
      expect(instructions[0].recordType).toBe('TXT')
      expect(instructions[0].host).toBe('company.com')
      expect(instructions[0].value).toContain('v=spf1')
      expect(instructions[0].steps.length).toBeGreaterThan(0)
      expect(instructions[0].providerName).toBe('Cloudflare')
    })

    it('returns DKIM instructions with custom selector', () => {
      const instructions = getProviderDnsInstructions('company.com', 'dkim', 'route53', 'google')
      expect(instructions[0].host).toBe('google._domainkey.company.com')
      expect(instructions[0].value).toContain('v=DKIM1')
      expect(instructions[0].providerName).toBe('AWS Route 53')
    })

    it('returns DMARC instructions', () => {
      const instructions = getProviderDnsInstructions('company.com', 'dmarc', 'godaddy')
      expect(instructions[0].host).toBe('_dmarc.company.com')
      expect(instructions[0].value).toContain('v=DMARC1')
      expect(instructions[0].steps.length).toBeGreaterThan(0)
    })

    it('returns tracking CNAME instructions', () => {
      const instructions = getProviderDnsInstructions('company.com', 'tracking', 'namecheap')
      expect(instructions[0].recordType).toBe('CNAME')
      expect(instructions[0].host).toBe('track.company.com')
      expect(instructions[0].value).toBe('track.magnivo.ai')
    })

    it('returns return path CNAME instructions', () => {
      const instructions = getProviderDnsInstructions('company.com', 'return_path', 'google')
      expect(instructions[0].recordType).toBe('CNAME')
      expect(instructions[0].host).toBe('bounce.company.com')
      expect(instructions[0].value).toBe('bounce.magnivo.ai')
    })

    it('falls back to other provider for unknown provider', () => {
      const instructions = getProviderDnsInstructions('company.com', 'spf', 'other')
      expect(instructions[0].providerName).toBe('Other Provider')
      expect(instructions[0].steps).toContain('Log in to your DNS provider\'s dashboard.')
    })
  })

  describe('getAllProviders', () => {
    it('returns all 8 providers', () => {
      const providers = getAllProviders()
      expect(providers.length).toBe(8)
      expect(providers.map(p => p.id)).toContain('cloudflare')
      expect(providers.map(p => p.id)).toContain('route53')
      expect(providers.map(p => p.id)).toContain('godaddy')
      expect(providers.map(p => p.id)).toContain('namecheap')
      expect(providers.map(p => p.id)).toContain('squarespace')
      expect(providers.map(p => p.id)).toContain('zoho')
      expect(providers.map(p => p.id)).toContain('google')
      expect(providers.map(p => p.id)).toContain('other')
    })
  })

  describe('detectDnsProvider', () => {
    it('returns other for generic domains', () => {
      expect(detectDnsProvider('company.com')).toBe('other')
    })
  })
})
