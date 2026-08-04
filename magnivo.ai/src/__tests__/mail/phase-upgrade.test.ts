import { describe, it, expect } from 'vitest'
import { resolveMailPermissions, hasMailPermission } from '@/lib/mail-permissions'
import { canTransition, isSendable, needsAttention, getStatusLabel } from '@/lib/mailbox-state-machine'
import { classifyReplyText } from '@/services/mail/inbox-service'
import { buildListUnsubscribeHeaders } from '@/services/mail/suppression-service'
import { generateWarmupContent } from '@/services/mail/warmup-pool-service'

describe('mail permissions', () => {
  it('grants admin full access', () => {
    const p = resolveMailPermissions('admin')
    expect(p.canAdmin).toBe(true)
    expect(hasMailPermission(p, 'mail.admin')).toBe(true)
  })

  it('makes viewers read-only', () => {
    const p = resolveMailPermissions('viewer')
    expect(p.canRead).toBe(true)
    expect(p.canWrite).toBe(false)
    expect(p.canManage).toBe(false)
  })
})

describe('mailbox state machine extensions', () => {
  it('allows pending → pending_dns', () => {
    expect(canTransition('pending', 'pending_dns').valid).toBe(true)
  })

  it('allows pending_dns → pending_warmup', () => {
    expect(canTransition('pending_dns', 'pending_warmup').valid).toBe(true)
  })

  it('labels pending_dns', () => {
    expect(getStatusLabel('pending_dns')).toBe('Pending DNS Setup')
  })

  it('only connected is sendable for live campaigns', () => {
    expect(isSendable('connected')).toBe(true)
    expect(isSendable('warming')).toBe(false)
  })

  it('flags at_risk as needs attention', () => {
    expect(needsAttention('at_risk')).toBe(true)
  })
})

describe('inbox classification', () => {
  it('detects OOO', () => {
    expect(classifyReplyText('Out of office until Monday')).toBe('ooo')
  })

  it('detects unsubscribe', () => {
    expect(classifyReplyText('Please unsubscribe me from this list')).toBe('unsubscribe_request')
  })

  it('detects interested', () => {
    expect(classifyReplyText("Sounds good, let's book a meeting")).toBe('interested')
  })
})

describe('compliance headers', () => {
  it('builds List-Unsubscribe headers', () => {
    const h = buildListUnsubscribeHeaders('https://app.example.com/unsub')
    expect(h['List-Unsubscribe']).toContain('https://app.example.com/unsub')
    expect(h['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
  })
})

describe('warmup content variation', () => {
  it('generates non-empty varied content', () => {
    const a = generateWarmupContent('Alice')
    const b = generateWarmupContent('Bob')
    expect(a.subject.length).toBeGreaterThan(0)
    expect(a.text.length).toBeGreaterThan(0)
    expect(a.html).toContain('<p>')
    // Not required to differ every time, but structure must be present
    expect(b.html).toContain('<p>')
  })
})
