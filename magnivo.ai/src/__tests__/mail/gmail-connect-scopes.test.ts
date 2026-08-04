import { describe, expect, it } from 'vitest'

/**
 * Scope gate for Gmail OAuth (PRD §6.1.01) — mirrors gmail-connect-service required scopes.
 */
const REQUIRED = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
]

function scopesGranted(scopeStr: string): boolean {
  const granted = new Set(scopeStr.split(/[\s,]+/).filter(Boolean))
  return REQUIRED.every((s) => granted.has(s))
}

describe('gmail oauth scopes (6.1.01)', () => {
  it('accepts PRD minimum scopes', () => {
    expect(
      scopesGranted(
        'openid email profile https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send'
      )
    ).toBe(true)
  })

  it('rejects missing send scope', () => {
    expect(
      scopesGranted('openid email https://www.googleapis.com/auth/gmail.readonly')
    ).toBe(false)
  })

  it('rejects missing readonly scope', () => {
    expect(
      scopesGranted('openid email https://www.googleapis.com/auth/gmail.send')
    ).toBe(false)
  })
})
