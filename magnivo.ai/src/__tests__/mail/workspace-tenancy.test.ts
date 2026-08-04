import { describe, expect, it } from 'vitest'
import { assertOrgMatch } from '@/services/mail/workspace-governance-service'
import { resolveMailPermissions } from '@/lib/mail-permissions'

describe('workspace tenancy helpers (PRD §6.8.01 / §6.8.14)', () => {
  it('rejects cross-tenant org id mismatches', () => {
    expect(assertOrgMatch('org-a', 'org-a')).toBe(true)
    expect(assertOrgMatch('org-a', 'org-b')).toBe(false)
    expect(assertOrgMatch(null, 'org-a')).toBe(false)
    expect(assertOrgMatch(undefined, 'org-a')).toBe(false)
  })

  it('maps viewer to read-only (no launch)', () => {
    const p = resolveMailPermissions('viewer')
    expect(p.canRead).toBe(true)
    expect(p.canWrite).toBe(false)
    expect(p.canManage).toBe(false)
  })

  it('maps member to write without manage', () => {
    const p = resolveMailPermissions('member')
    expect(p.canWrite).toBe(true)
    expect(p.canManage).toBe(false)
  })
})
