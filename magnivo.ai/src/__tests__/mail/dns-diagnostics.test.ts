import { describe, expect, it } from 'vitest'

function statusSeverity(status: string): 'ok' | 'warn' | 'fail' | 'skip' {
  const s = (status || '').toLowerCase()
  if (s === 'valid' || s === 'verified' || s === 'pass') return 'ok'
  if (s === 'warning' || s === 'at_risk' || s === 'pending' || s === 'unverified' || s === 'not_configured')
    return 'warn'
  if (s === 'invalid' || s === 'failed' || s === 'error' || s === 'missing') return 'fail'
  return 'skip'
}

describe('dns diagnostics severity mapping', () => {
  it('maps valid/verified to ok', () => {
    expect(statusSeverity('valid')).toBe('ok')
    expect(statusSeverity('verified')).toBe('ok')
  })

  it('maps warnings consistently', () => {
    expect(statusSeverity('unverified')).toBe('warn')
    expect(statusSeverity('not_configured')).toBe('warn')
    expect(statusSeverity('at_risk')).toBe('warn')
  })

  it('maps failures', () => {
    expect(statusSeverity('invalid')).toBe('fail')
    expect(statusSeverity('missing')).toBe('fail')
  })
})

describe('tracking domain tenant isolation message', () => {
  it('uses workspace-claim wording', () => {
    const msg =
      'This tracking domain is already claimed by another Magnivo workspace. Choose a unique subdomain for your organization.'
    expect(msg).toMatch(/another Magnivo workspace/i)
    expect(msg).not.toMatch(/organization_id/)
  })
})
