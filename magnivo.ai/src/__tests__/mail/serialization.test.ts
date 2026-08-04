import type {
  OAuthConfig,
  SMTPConfig,
  IMAPConfig,
  MailboxPool,
  Mailbox,
} from '@/types/mail'

type OAuthConfigResponse = {
  id: string
  mailboxId: string
  provider: string
  providerAccountId: string
  scope: string
  tokenExpiresAt: string | null
  lastRotatedAt: string | null
  createdAt: string
  updatedAt: string
}

type SMTPConfigResponse = {
  id: string
  mailboxId: string
  smtpHost: string
  smtpPort: number
  encryption: string
  username: string
  authenticationType: string
  validationStatus: string
  lastValidatedAt: string | null
  createdAt: string
  updatedAt: string
}

type IMAPConfigResponse = {
  id: string
  mailboxId: string
  host: string
  port: number
  ssl: boolean
  username: string
  authentication: string
  validationStatus: string
  lastValidatedAt: string | null
  createdAt: string
  updatedAt: string
}

type MailboxPoolResponse = {
  id: string
  organizationId: string
  name: string
  description: string
  status: string
  dailyPoolLimit: number
  memberCount: number
  healthAggregation: {
    avgHealthScore: number | null
    totalMailboxes: number
    connectedCount: number
    warmingCount: number
    errorCount: number
  } | null
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

function toOAuthConfigResponse(config: OAuthConfig): OAuthConfigResponse {
  return {
    id: config.id,
    mailboxId: config.mailboxId,
    provider: config.provider,
    providerAccountId: config.providerAccountId,
    scope: config.scope,
    tokenExpiresAt: config.tokenExpiresAt,
    lastRotatedAt: config.lastRotatedAt,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  }
}

function toSMTPConfigResponse(config: SMTPConfig): SMTPConfigResponse {
  return {
    id: config.id,
    mailboxId: config.mailboxId,
    smtpHost: config.smtpHost,
    smtpPort: config.smtpPort,
    encryption: config.encryption,
    username: config.username,
    authenticationType: config.authenticationType,
    validationStatus: config.validationStatus,
    lastValidatedAt: config.lastValidatedAt,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  }
}

function toIMAPConfigResponse(config: IMAPConfig): IMAPConfigResponse {
  return {
    id: config.id,
    mailboxId: config.mailboxId,
    host: config.host,
    port: config.port,
    ssl: config.ssl,
    username: config.username,
    authentication: config.authentication,
    validationStatus: config.validationStatus,
    lastValidatedAt: config.lastValidatedAt,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  }
}

function toPoolResponse(pool: MailboxPool): MailboxPoolResponse {
  return {
    id: pool.id,
    organizationId: pool.organizationId,
    name: pool.name,
    description: pool.description,
    status: pool.status,
    dailyPoolLimit: pool.dailyPoolLimit,
    memberCount: pool.healthAggregation?.totalMailboxes ?? 0,
    healthAggregation: pool.healthAggregation,
    metadata: pool.metadata,
    createdAt: pool.createdAt,
    updatedAt: pool.updatedAt,
  }
}

function toMailboxResponse(mailbox: Mailbox) {
  return {
    id: mailbox.id,
    organizationId: mailbox.organizationId,
    poolId: mailbox.poolId,
    provider: mailbox.provider,
    authType: mailbox.authType,
    email: mailbox.email,
    displayName: mailbox.displayName,
    senderName: mailbox.senderName,
    providerAccountId: mailbox.providerAccountId,
    timezone: mailbox.timezone,
    dailyLimit: mailbox.dailyLimit,
    currentDailyUsage: mailbox.currentDailyUsage,
    healthScore: mailbox.healthScore,
    healthStatus: mailbox.healthStatus,
    mailboxStatus: mailbox.mailboxStatus,
    verificationStatus: mailbox.verificationStatus,
    warmupStatus: mailbox.warmupStatus,
    metadata: mailbox.metadata,
    createdAt: mailbox.createdAt,
    updatedAt: mailbox.updatedAt,
  }
}

describe('mail DTO serialization', () => {
  describe('toOAuthConfigResponse', () => {
    it('strips sensitive token fields', () => {
      const config: OAuthConfig = {
        id: 'oauth-1',
        mailboxId: 'mb-1',
        organizationId: 'org-1',
        provider: 'gmail',
        providerAccountId: 'google-acc-1',
        encryptedRefreshToken: 'secret-refresh-token',
        encryptedAccessToken: 'secret-access-token',
        tokenExpiresAt: '2026-08-01T00:00:00Z',
        scope: 'email https://mail.google.com',
        lastRotatedAt: null,
        createdAt: '2026-07-01T00:00:00Z',
        updatedAt: '2026-07-01T00:00:00Z',
      }

      const response = toOAuthConfigResponse(config)

      expect(response.id).toBe('oauth-1')
      expect(response.mailboxId).toBe('mb-1')
      expect(response.provider).toBe('gmail')
      expect(response.providerAccountId).toBe('google-acc-1')
      expect(response.scope).toBe('email https://mail.google.com')
      expect(response.tokenExpiresAt).toBe('2026-08-01T00:00:00Z')
      expect(response).not.toHaveProperty('encryptedRefreshToken')
      expect(response).not.toHaveProperty('encryptedAccessToken')
      expect(response).not.toHaveProperty('organizationId')
    })

    it('handles null token expiry', () => {
      const config: OAuthConfig = {
        id: 'oauth-2',
        mailboxId: 'mb-1',
        organizationId: 'org-1',
        provider: 'outlook',
        providerAccountId: 'ms-acc-1',
        encryptedRefreshToken: null,
        encryptedAccessToken: null,
        tokenExpiresAt: null,
        scope: 'offline_access',
        lastRotatedAt: null,
        createdAt: '2026-07-01T00:00:00Z',
        updatedAt: '2026-07-01T00:00:00Z',
      }

      const response = toOAuthConfigResponse(config)
      expect(response.tokenExpiresAt).toBeNull()
    })
  })

  describe('toSMTPConfigResponse', () => {
    it('strips password reference', () => {
      const config: SMTPConfig = {
        id: 'smtp-1',
        mailboxId: 'mb-1',
        organizationId: 'org-1',
        smtpHost: 'smtp.gmail.com',
        smtpPort: 587,
        encryption: 'starttls',
        username: 'user@gmail.com',
        encryptedPasswordReference: 'encrypted-secret',
        authenticationType: 'password',
        validationStatus: 'valid',
        lastValidatedAt: '2026-07-01T00:00:00Z',
        createdAt: '2026-07-01T00:00:00Z',
        updatedAt: '2026-07-01T00:00:00Z',
      }

      const response = toSMTPConfigResponse(config)

      expect(response.id).toBe('smtp-1')
      expect(response.smtpHost).toBe('smtp.gmail.com')
      expect(response.smtpPort).toBe(587)
      expect(response.encryption).toBe('starttls')
      expect(response.username).toBe('user@gmail.com')
      expect(response.validationStatus).toBe('valid')
      expect(response).not.toHaveProperty('encryptedPasswordReference')
      expect(response).not.toHaveProperty('organizationId')
    })
  })

  describe('toIMAPConfigResponse', () => {
    it('preserves all non-sensitive fields', () => {
      const config: IMAPConfig = {
        id: 'imap-1',
        mailboxId: 'mb-1',
        organizationId: 'org-1',
        host: 'imap.gmail.com',
        port: 993,
        ssl: true,
        username: 'user@gmail.com',
        encryptedPasswordReference: 'enc-secret',
        authentication: 'password',
        validationStatus: 'valid',
        lastValidatedAt: '2026-07-01T00:00:00Z',
        createdAt: '2026-07-01T00:00:00Z',
        updatedAt: '2026-07-01T00:00:00Z',
      }

      const response = toIMAPConfigResponse(config)

      expect(response.id).toBe('imap-1')
      expect(response.host).toBe('imap.gmail.com')
      expect(response.port).toBe(993)
      expect(response.ssl).toBe(true)
      expect(response.authentication).toBe('password')
      expect(response.validationStatus).toBe('valid')
      expect(response).not.toHaveProperty('organizationId')
    })
  })

  describe('toPoolResponse', () => {
    it('maps member count from health aggregation', () => {
      const pool: MailboxPool = {
        id: 'pool-1',
        organizationId: 'org-1',
        name: 'Production Pool',
        description: 'Main sending pool',
        status: 'active',
        dailyPoolLimit: 1000,
        sendingStrategy: 'standard',
        rotationStrategy: 'round_robin',
        maxConcurrentSends: 5,
        timezone: 'UTC',
        memberMailboxes: [],
        healthAggregation: {
          avgHealthScore: 85,
          totalMailboxes: 10,
          connectedCount: 8,
          warmingCount: 1,
          errorCount: 1,
          totalDailyCapacity: 5000,
          usedToday: 1200,
          warnings: [],
        },
        metadata: {},
        createdAt: '2026-07-01T00:00:00Z',
        updatedAt: '2026-07-01T00:00:00Z',
      }

      const response = toPoolResponse(pool)

      expect(response.memberCount).toBe(10)
      expect(response.healthAggregation).toEqual(pool.healthAggregation)
      expect(response).not.toHaveProperty('memberMailboxes')
    })

    it('defaults member count to 0 when no health aggregation', () => {
      const pool: MailboxPool = {
        id: 'pool-2',
        organizationId: 'org-1',
        name: 'Empty Pool',
        description: '',
        status: 'active',
        dailyPoolLimit: 500,
        sendingStrategy: 'standard',
        rotationStrategy: 'round_robin',
        maxConcurrentSends: 5,
        timezone: 'UTC',
        memberMailboxes: [],
        healthAggregation: null,
        metadata: {},
        createdAt: '2026-07-01T00:00:00Z',
        updatedAt: '2026-07-01T00:00:00Z',
      }

      const response = toPoolResponse(pool)
      expect(response.memberCount).toBe(0)
    })
  })

  describe('toMailboxResponse', () => {
    it('excludes config objects from response', () => {
      const mailbox: Mailbox = {
        id: 'mb-1',
        organizationId: 'org-1',
        poolId: 'pool-1',
        provider: 'gmail',
        authType: 'oauth',
        email: 'user@gmail.com',
        displayName: 'User',
        senderName: 'User',
        providerAccountId: 'google-1',
        timezone: 'America/New_York',
        dailyLimit: 100,
        currentDailyUsage: 42,
        healthScore: 85,
        healthStatus: 'good',
        mailboxStatus: 'connected',
        verificationStatus: 'verified',
        warmupStatus: 'completed',
        lastVerifiedAt: null,
        lastVerificationDurationMs: null,
        lastVerificationResult: null,
        deletedAt: null,
        archivedAt: null,
        oauthConfig: {
          id: 'oauth-1',
          mailboxId: 'mb-1',
          organizationId: 'org-1',
          provider: 'gmail',
          providerAccountId: 'google-1',
          encryptedRefreshToken: 'secret',
          encryptedAccessToken: 'secret',
          tokenExpiresAt: null,
          scope: 'email',
          lastRotatedAt: null,
          createdAt: '',
          updatedAt: '',
        },
        smtpConfig: null,
        imapConfig: null,
        metadata: { key: 'value' },
        createdAt: '2026-07-01T00:00:00Z',
        updatedAt: '2026-07-01T00:00:00Z',
      }

      const response = toMailboxResponse(mailbox)

      expect(response.id).toBe('mb-1')
      expect(response.email).toBe('user@gmail.com')
      expect(response.healthStatus).toBe('good')
      expect(response).not.toHaveProperty('oauthConfig')
      expect(response).not.toHaveProperty('smtpConfig')
      expect(response).not.toHaveProperty('imapConfig')
    })
  })

  describe('row-to-model mapping (snake_case to camelCase)', () => {
    it('maps OAuth config row correctly', () => {
      const row = {
        id: 'oauth-1',
        mailbox_id: 'mb-1',
        organization_id: 'org-1',
        provider: 'gmail' as const,
        provider_account_id: 'google-1',
        encrypted_refresh_token: null,
        encrypted_access_token: null,
        token_expires_at: null,
        scope: 'email',
        last_rotated_at: null,
        created_at: '2026-07-01T00:00:00Z',
        updated_at: '2026-07-01T00:00:00Z',
      }

      const result = {
        id: row.id,
        mailboxId: row.mailbox_id,
        organizationId: row.organization_id,
        provider: row.provider,
        providerAccountId: row.provider_account_id,
        encryptedRefreshToken: row.encrypted_refresh_token,
        encryptedAccessToken: row.encrypted_access_token,
        tokenExpiresAt: row.token_expires_at,
        scope: row.scope,
        lastRotatedAt: row.last_rotated_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }

      expect(result.mailboxId).toBe('mb-1')
      expect(result.organizationId).toBe('org-1')
      expect(result.providerAccountId).toBe('google-1')
      expect(result.encryptedRefreshToken).toBeNull()
      expect(result.tokenExpiresAt).toBeNull()
    })

    it('maps SMTP config row correctly', () => {
      const row = {
        id: 'smtp-1',
        mailbox_id: 'mb-1',
        organization_id: 'org-1',
        smtp_host: 'smtp.gmail.com',
        smtp_port: 587,
        encryption: 'starttls' as const,
        username: 'user@gmail.com',
        encrypted_password_reference: 'encrypted-ref',
        authentication_type: 'password' as const,
        validation_status: 'valid' as const,
        last_validated_at: '2026-07-01T00:00:00Z',
        created_at: '2026-07-01T00:00:00Z',
        updated_at: '2026-07-01T00:00:00Z',
      }

      const result = {
        id: row.id,
        mailboxId: row.mailbox_id,
        organizationId: row.organization_id,
        smtpHost: row.smtp_host,
        smtpPort: row.smtp_port,
        encryption: row.encryption,
        username: row.username,
        encryptedPasswordReference: row.encrypted_password_reference,
        authenticationType: row.authentication_type,
        validationStatus: row.validation_status,
        lastValidatedAt: row.last_validated_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }

      expect(result.smtpHost).toBe('smtp.gmail.com')
      expect(result.smtpPort).toBe(587)
      expect(result.encryptedPasswordReference).toBe('encrypted-ref')
      expect(result.authenticationType).toBe('password')
    })

    it('maps IMAP config row correctly', () => {
      const row = {
        id: 'imap-1',
        mailbox_id: 'mb-1',
        organization_id: 'org-1',
        host: 'imap.gmail.com',
        port: 993,
        ssl: true,
        authentication: 'password' as const,
        validation_status: 'valid' as const,
        last_validated_at: null,
        created_at: '2026-07-01T00:00:00Z',
        updated_at: '2026-07-01T00:00:00Z',
      }

      const result = {
        id: row.id,
        mailboxId: row.mailbox_id,
        organizationId: row.organization_id,
        host: row.host,
        port: row.port,
        ssl: row.ssl,
        authentication: row.authentication,
        validationStatus: row.validation_status,
        lastValidatedAt: row.last_validated_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }

      expect(result.host).toBe('imap.gmail.com')
      expect(result.port).toBe(993)
      expect(result.ssl).toBe(true)
      expect(result.validationStatus).toBe('valid')
    })
  })
})
