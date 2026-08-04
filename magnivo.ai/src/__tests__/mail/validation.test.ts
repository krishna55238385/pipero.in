import {
  validateCreateMailboxRequest,
  validateUpdateMailboxRequest,
  validateCreateMailboxPoolRequest,
  validateUpdateMailboxPoolRequest,
  validateSMTPConfig,
  validateOAuthProvider,
  validateIMAPConfig,
  validateCreateOAuthConfigRequest,
  validateCreateSMTPConfigRequest,
  validateCreateIMAPConfigRequest,
  buildDuplicateMailboxCheck,
  validatePoolOwnership,
} from '@/lib/mail-validation'

describe('mail-validation', () => {
  describe('validateCreateMailboxRequest', () => {
    it('rejects empty input', () => {
      const result = validateCreateMailboxRequest(null)
      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })

    it('rejects missing email', () => {
      const result = validateCreateMailboxRequest({ provider: 'gmail', authType: 'oauth' })
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Email is required')
    })

    it('rejects invalid email format', () => {
      const result = validateCreateMailboxRequest({ email: 'not-an-email', provider: 'gmail', authType: 'oauth' })
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Email format is invalid')
    })

    it('rejects invalid provider', () => {
      const result = validateCreateMailboxRequest({ email: 'test@example.com', provider: 'invalid', authType: 'oauth' })
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('Provider'))).toBe(true)
    })

    it('rejects invalid auth type', () => {
      const result = validateCreateMailboxRequest({ email: 'test@example.com', provider: 'gmail', authType: 'invalid' })
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('Auth type'))).toBe(true)
    })

    it('rejects invalid timezone', () => {
      const result = validateCreateMailboxRequest({
        email: 'test@example.com',
        provider: 'gmail',
        authType: 'oauth',
        timezone: 'Invalid/Zone',
      })
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Timezone is invalid')
    })

    it('rejects daily limit out of range', () => {
      const result = validateCreateMailboxRequest({
        email: 'test@example.com',
        provider: 'gmail',
        authType: 'oauth',
        dailyLimit: 99999,
      })
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('Daily limit'))).toBe(true)
    })

    it('accepts valid input', () => {
      const result = validateCreateMailboxRequest({
        email: 'test@example.com',
        provider: 'gmail',
        authType: 'oauth',
        timezone: 'America/New_York',
        dailyLimit: 100,
      })
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('accepts UTC timezone', () => {
      const result = validateCreateMailboxRequest({
        email: 'test@example.com',
        provider: 'outlook',
        authType: 'smtp',
        timezone: 'UTC',
      })
      expect(result.valid).toBe(true)
    })
  })

  describe('validateUpdateMailboxRequest', () => {
    it('accepts empty input (no-op update)', () => {
      const result = validateUpdateMailboxRequest({})
      expect(result.valid).toBe(true)
    })

    it('rejects invalid timezone', () => {
      const result = validateUpdateMailboxRequest({ timezone: 'bad' })
      expect(result.valid).toBe(false)
    })

    it('rejects out-of-range daily limit', () => {
      const result = validateUpdateMailboxRequest({ dailyLimit: -1 })
      expect(result.valid).toBe(false)
    })

    it('accepts valid partial update', () => {
      const result = validateUpdateMailboxRequest({ displayName: 'New Name', timezone: 'Asia/Tokyo' })
      expect(result.valid).toBe(true)
    })
  })

  describe('validateCreateMailboxPoolRequest', () => {
    it('rejects missing name', () => {
      const result = validateCreateMailboxPoolRequest({})
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Pool name is required')
    })

    it('rejects name exceeding 100 chars', () => {
      const result = validateCreateMailboxPoolRequest({ name: 'a'.repeat(101) })
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('100 characters'))).toBe(true)
    })

    it('rejects out-of-range daily pool limit', () => {
      const result = validateCreateMailboxPoolRequest({ name: 'Test Pool', dailyPoolLimit: 0 })
      expect(result.valid).toBe(false)
    })

    it('accepts valid input', () => {
      const result = validateCreateMailboxPoolRequest({
        name: 'Production Pool',
        description: 'Main pool',
        dailyPoolLimit: 1000,
      })
      expect(result.valid).toBe(true)
    })
  })

  describe('validateUpdateMailboxPoolRequest', () => {
    it('accepts empty input', () => {
      const result = validateUpdateMailboxPoolRequest({})
      expect(result.valid).toBe(true)
    })

    it('rejects invalid status', () => {
      const result = validateUpdateMailboxPoolRequest({ status: 'deleted' })
      expect(result.valid).toBe(false)
    })

    it('accepts valid status change', () => {
      const result = validateUpdateMailboxPoolRequest({ status: 'inactive' })
      expect(result.valid).toBe(true)
    })
  })

  describe('validateSMTPConfig', () => {
    it('rejects missing host', () => {
      const result = validateSMTPConfig({})
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('SMTP host'))).toBe(true)
    })

    it('rejects invalid port', () => {
      const result = validateSMTPConfig({
        smtpHost: 'smtp.example.com',
        smtpPort: 99999,
        username: 'user',
        encryptedPasswordReference: 'ref',
        encryption: 'ssl',
      })
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('SMTP port'))).toBe(true)
    })

    it('accepts valid SMTP config', () => {
      const result = validateSMTPConfig({
        smtpHost: 'smtp.gmail.com',
        smtpPort: 587,
        username: 'user@gmail.com',
        encryptedPasswordReference: 'encrypted-ref-123',
        encryption: 'starttls',
      })
      expect(result.valid).toBe(true)
    })
  })

  describe('validateOAuthProvider', () => {
    it('rejects invalid provider', () => {
      const result = validateOAuthProvider('apple')
      expect(result.valid).toBe(false)
    })

    it('accepts gmail', () => {
      const result = validateOAuthProvider('gmail')
      expect(result.valid).toBe(true)
    })

    it('accepts outlook', () => {
      const result = validateOAuthProvider('outlook')
      expect(result.valid).toBe(true)
    })

    it('accepts zoho', () => {
      const result = validateOAuthProvider('zoho')
      expect(result.valid).toBe(true)
    })
  })

  describe('buildDuplicateMailboxCheck', () => {
    it('builds query without exclude', () => {
      const check = buildDuplicateMailboxCheck('test@example.com', 'org-1')
      expect(check.whereClause).toContain('LOWER(email) = LOWER($1)')
      expect(check.whereClause).toContain('organization_id = $2')
      expect(check.whereClause).not.toContain('id !=')
      expect(check.values).toEqual(['test@example.com', 'org-1'])
    })

    it('builds query with exclude', () => {
      const check = buildDuplicateMailboxCheck('test@example.com', 'org-1', 'mailbox-1')
      expect(check.whereClause).toContain('id != $3')
      expect(check.values).toEqual(['test@example.com', 'org-1', 'mailbox-1'])
    })
  })

  describe('validatePoolOwnership', () => {
    it('rejects mismatched org ids', () => {
      const result = validatePoolOwnership('org-1', 'org-2')
      expect(result.valid).toBe(false)
    })

    it('accepts matching org ids', () => {
      const result = validatePoolOwnership('org-1', 'org-1')
      expect(result.valid).toBe(true)
    })
  })

  describe('validateIMAPConfig', () => {
    it('rejects empty input', () => {
      const result = validateIMAPConfig(null)
      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })

    it('rejects missing host', () => {
      const result = validateIMAPConfig({ port: 993 })
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('IMAP host'))).toBe(true)
    })

    it('rejects invalid port', () => {
      const result = validateIMAPConfig({ host: 'imap.gmail.com', port: 99999 })
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('IMAP port'))).toBe(true)
    })

    it('rejects invalid authentication', () => {
      const result = validateIMAPConfig({
        host: 'imap.gmail.com',
        port: 993,
        authentication: 'ntlm',
      })
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('authentication'))).toBe(true)
    })

    it('accepts valid IMAP config', () => {
      const result = validateIMAPConfig({
        host: 'imap.gmail.com',
        port: 993,
        ssl: true,
        authentication: 'password',
      })
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })
  })

  describe('validateCreateOAuthConfigRequest', () => {
    it('rejects empty input', () => {
      const result = validateCreateOAuthConfigRequest(null)
      expect(result.valid).toBe(false)
    })

    it('rejects missing mailboxId', () => {
      const result = validateCreateOAuthConfigRequest({
        provider: 'gmail',
        providerAccountId: 'acc-123',
      })
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Mailbox ID is required')
    })

    it('rejects missing provider', () => {
      const result = validateCreateOAuthConfigRequest({
        mailboxId: 'mb-1',
        providerAccountId: 'acc-123',
      })
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('OAuth provider is required')
    })

    it('rejects invalid provider', () => {
      const result = validateCreateOAuthConfigRequest({
        mailboxId: 'mb-1',
        provider: 'apple',
        providerAccountId: 'acc-123',
      })
      expect(result.valid).toBe(false)
    })

    it('rejects missing providerAccountId', () => {
      const result = validateCreateOAuthConfigRequest({
        mailboxId: 'mb-1',
        provider: 'gmail',
      })
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Provider account ID is required')
    })

    it('accepts valid input', () => {
      const result = validateCreateOAuthConfigRequest({
        mailboxId: 'mb-1',
        provider: 'gmail',
        providerAccountId: 'acc-123',
      })
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })
  })

  describe('validateCreateSMTPConfigRequest', () => {
    it('rejects empty input', () => {
      const result = validateCreateSMTPConfigRequest(null)
      expect(result.valid).toBe(false)
    })

    it('rejects missing mailboxId', () => {
      const result = validateCreateSMTPConfigRequest({
        smtpHost: 'smtp.gmail.com',
        smtpPort: 587,
        username: 'user@gmail.com',
        encryptedPasswordReference: 'ref',
        encryption: 'starttls',
      })
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Mailbox ID is required')
    })

    it('rejects missing smtpHost', () => {
      const result = validateCreateSMTPConfigRequest({
        mailboxId: 'mb-1',
        smtpPort: 587,
        username: 'user@gmail.com',
        encryptedPasswordReference: 'ref',
        encryption: 'starttls',
      })
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('SMTP host is required')
    })

    it('rejects invalid port', () => {
      const result = validateCreateSMTPConfigRequest({
        mailboxId: 'mb-1',
        smtpHost: 'smtp.gmail.com',
        smtpPort: 99999,
        username: 'user',
        encryptedPasswordReference: 'ref',
        encryption: 'ssl',
      })
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('SMTP port'))).toBe(true)
    })

    it('accepts valid input', () => {
      const result = validateCreateSMTPConfigRequest({
        mailboxId: 'mb-1',
        smtpHost: 'smtp.gmail.com',
        smtpPort: 587,
        username: 'user@gmail.com',
        encryptedPasswordReference: 'encrypted-ref',
        encryption: 'starttls',
      })
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })
  })

  describe('validateCreateIMAPConfigRequest', () => {
    it('rejects empty input', () => {
      const result = validateCreateIMAPConfigRequest(null)
      expect(result.valid).toBe(false)
    })

    it('rejects missing mailboxId', () => {
      const result = validateCreateIMAPConfigRequest({
        host: 'imap.gmail.com',
        port: 993,
        authentication: 'password',
      })
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Mailbox ID is required')
    })

    it('rejects missing host', () => {
      const result = validateCreateIMAPConfigRequest({
        mailboxId: 'mb-1',
        port: 993,
        authentication: 'password',
      })
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('IMAP host is required')
    })

    it('rejects invalid port', () => {
      const result = validateCreateIMAPConfigRequest({
        mailboxId: 'mb-1',
        host: 'imap.gmail.com',
        port: 99999,
        authentication: 'password',
      })
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('IMAP port'))).toBe(true)
    })

    it('accepts valid input', () => {
      const result = validateCreateIMAPConfigRequest({
        mailboxId: 'mb-1',
        host: 'imap.gmail.com',
        port: 993,
        ssl: true,
        authentication: 'password',
      })
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })
  })
})
