import { describe, expect, it } from 'vitest'
import {
  redactSecrets,
  safeLogMessage,
  toPublicEngageMailbox,
  toPublicMailboxWithConfigs,
} from '@/lib/credential-safety'

describe('credential-safety', () => {
  it('redacts sensitive object keys', () => {
    const out = redactSecrets({
      email: 'a@b.com',
      access_token: 'ya29.secret-token-value',
      nested: { refresh_token: '1//refresh', ok: true },
    }) as Record<string, unknown>
    expect(out.email).toBe('a@b.com')
    expect(out.access_token).toBe('[REDACTED]')
    expect((out.nested as Record<string, unknown>).refresh_token).toBe('[REDACTED]')
    expect((out.nested as Record<string, unknown>).ok).toBe(true)
  })

  it('safeLogMessage strips bearer tokens from strings', () => {
    const msg = safeLogMessage(new Error('failed Bearer ya29.ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'))
    expect(msg).not.toMatch(/ya29/)
    expect(msg).toContain('[REDACTED]')
  })

  it('toPublicEngageMailbox strips credential columns', () => {
    const pub = toPublicEngageMailbox({
      id: '1',
      email: 'x@y.com',
      access_token: 'plain',
      refresh_token: 'plain2',
      encrypted_access_token: 'enc',
      encrypted_refresh_token: 'enc2',
      status: 'active',
    })
    expect(pub).not.toHaveProperty('access_token')
    expect(pub).not.toHaveProperty('refresh_token')
    expect(pub).not.toHaveProperty('encrypted_access_token')
    expect(pub).not.toHaveProperty('encrypted_refresh_token')
    expect(pub?.hasCredentials).toBe(true)
    expect(pub?.tokensEncrypted).toBe(true)
    expect(pub?.email).toBe('x@y.com')
  })

  it('toPublicMailboxWithConfigs strips encrypted secrets', () => {
    const pub = toPublicMailboxWithConfigs({
      id: 'mb',
      oauthConfig: {
        id: 'o',
        encryptedAccessToken: 'secret-a',
        encryptedRefreshToken: 'secret-r',
        provider: 'gmail',
      },
      smtpConfig: {
        id: 's',
        encryptedPasswordReference: 'secret-p',
        smtpHost: 'smtp.example.com',
      },
      imapConfig: null,
    })
    expect(pub.oauthConfig).not.toHaveProperty('encryptedAccessToken')
    expect(pub.oauthConfig).not.toHaveProperty('encryptedRefreshToken')
    expect((pub.oauthConfig as { hasRefreshToken?: boolean }).hasRefreshToken).toBe(true)
    expect(pub.smtpConfig).not.toHaveProperty('encryptedPasswordReference')
    expect((pub.smtpConfig as { smtpHost?: string }).smtpHost).toBe('smtp.example.com')
  })
})
