import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ConnectionTestInput } from '@/services/mail/connection-tester'

vi.mock('@/services/mail/smtp-validator', () => ({
  testSMTPConnection: vi.fn(),
  sendTestEmail: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock('@/services/mail/imap-validator', () => ({
  testIMAPConnection: vi.fn(),
  verifyInboxReadAccess: vi.fn().mockResolvedValue({ success: true }),
}))

import { testConnection, testOAuthConnection } from '@/services/mail/connection-tester'
import { testSMTPConnection, sendTestEmail } from '@/services/mail/smtp-validator'
import { testIMAPConnection, verifyInboxReadAccess } from '@/services/mail/imap-validator'

const mockedSMTP = vi.mocked(testSMTPConnection)
const mockedIMAP = vi.mocked(testIMAPConnection)
const mockedSend = vi.mocked(sendTestEmail)
const mockedRead = vi.mocked(verifyInboxReadAccess)

function baseInput(overrides?: Partial<ConnectionTestInput>): ConnectionTestInput {
  return {
    provider: 'custom',
    email: 'test@example.com',
    smtp: {
      smtpHost: 'smtp.example.com',
      smtpPort: '587',
      smtpUsername: 'test@example.com',
      smtpPassword: 'password123',
      encryption: 'starttls' as const,
      authenticationType: 'password' as const,
    },
    imap: {
      imapHost: 'imap.example.com',
      imapPort: '993',
      imapUsername: '',
      imapPassword: '',
      imapSsl: true,
    },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedSend.mockResolvedValue({ success: true })
  mockedRead.mockResolvedValue({ success: true })
})

describe('testConnection', () => {
  it('returns success when SMTP + IMAP + send/read pass', async () => {
    mockedSMTP.mockResolvedValue({ success: true })
    mockedIMAP.mockResolvedValue({ success: true })

    const result = await testConnection(baseInput())
    expect(result.status).toBe('success')
    expect(result.message).toMatch(/SMTP/)
  })

  it('returns failure when SMTP fails', async () => {
    mockedSMTP.mockResolvedValue({
      success: false,
      error: { category: 'authentication', message: 'Bad credentials' },
    })

    const result = await testConnection(baseInput())
    expect(result.status).toBe('failure')
    expect(result.message).toContain('Bad credentials')
  })

  it('returns failure when IMAP fails but SMTP passes', async () => {
    mockedSMTP.mockResolvedValue({ success: true })
    mockedIMAP.mockResolvedValue({
      success: false,
      error: { category: 'network', message: 'Cannot reach IMAP' },
    })

    const result = await testConnection(baseInput())
    expect(result.status).toBe('failure')
    expect(result.message).toContain('Cannot reach IMAP')
  })

  it('fails full verification when IMAP host missing and cannot be derived', async () => {
    mockedSMTP.mockResolvedValue({ success: true })
    const result = await testConnection(
      baseInput({
        fullVerification: true,
        smtp: {
          smtpHost: '',
          smtpPort: '587',
          smtpUsername: 'test@example.com',
          smtpPassword: 'password123',
          encryption: 'starttls',
          authenticationType: 'password',
        },
        imap: {
          imapHost: '',
          imapPort: '993',
          imapUsername: '',
          imapPassword: '',
          imapSsl: true,
        },
      })
    )
    expect(result.status).toBe('failure')
  })

  it('uses email as username for oauth providers when smtpUsername is empty', async () => {
    mockedSMTP.mockResolvedValue({ success: true })
    mockedIMAP.mockResolvedValue({ success: true })

    const input = baseInput({ provider: 'gmail' })
    input.smtp.smtpUsername = ''
    input.smtp.smtpPassword = 'oauth-token'

    await testConnection(input)
    expect(mockedSMTP).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'test@example.com' })
    )
  })
})

describe('testOAuthConnection', () => {
  it('returns success for OAuth providers', async () => {
    const result = await testOAuthConnection('gmail', 'user@gmail.com')
    expect(result.status).toBe('success')
    expect(result.message).toContain('OAuth')
  })
})
