import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MailboxAuditLogEntry } from '@/types/mail'

vi.mock('@/lib/db', () => ({ default: { query: vi.fn(), connect: vi.fn() } }))
vi.mock('@/services/mail/warmup-service', () => ({
  cancelWarmupForMailbox: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/repositories/mail/mailbox-repository', () => ({
  findMailboxById: vi.fn(),
  findMailboxWithConfigs: vi.fn(),
  transitionMailboxStatus: vi.fn(),
  updateMailboxVerificationInfo: vi.fn(),
  findMailboxesByOrg: vi.fn(),
  countMailboxesByOrg: vi.fn(),
  findMailboxesPaginated: vi.fn(),
  countMailboxesFiltered: vi.fn(),
  getDashboardStats: vi.fn(),
  checkDuplicateMailbox: vi.fn(),
  insertMailbox: vi.fn(),
  updateMailbox: vi.fn(),
  deleteMailbox: vi.fn(),
  updateMailboxesStatus: vi.fn(),
  assignMailboxesToPool: vi.fn(),
  archiveMailboxes: vi.fn(),
  softDeleteMailboxes: vi.fn(),
  restoreMailboxes: vi.fn(),
}))
vi.mock('@/repositories/mail/mailbox-pool-repository', () => ({
  findPoolsByOrg: vi.fn(),
  findPoolById: vi.fn(),
  checkDuplicatePool: vi.fn(),
  insertPool: vi.fn(),
  updatePool: vi.fn(),
  deletePool: vi.fn(),
  addMailboxToPool: vi.fn(),
  removeMailboxFromPool: vi.fn(),
  countPoolsByOrg: vi.fn(),
}))
vi.mock('@/repositories/mail/oauth-config-repository', () => ({
  findOAuthConfigByMailboxId: vi.fn(),
  findOAuthConfigById: vi.fn(),
  findOAuthConfigByMailboxAndProvider: vi.fn(),
  insertOAuthConfig: vi.fn(),
  updateOAuthConfig: vi.fn(),
  deleteOAuthConfig: vi.fn(),
}))
vi.mock('@/repositories/mail/smtp-config-repository', () => ({
  findSMTPConfigByMailboxId: vi.fn(),
  findSMTPConfigById: vi.fn(),
  insertSMTPConfig: vi.fn(),
  updateSMTPConfig: vi.fn(),
  deleteSMTPConfig: vi.fn(),
}))
vi.mock('@/repositories/mail/imap-config-repository', () => ({
  findIMAPConfigByMailboxId: vi.fn(),
  findIMAPConfigById: vi.fn(),
  insertIMAPConfig: vi.fn(),
  updateIMAPConfig: vi.fn(),
  deleteIMAPConfig: vi.fn(),
}))
vi.mock('@/repositories/mail/mailbox-audit-repository', () => ({
  insertAuditEvent: vi.fn(),
  findAuditEventsByMailbox: vi.fn(),
  findAuditEventsByOrg: vi.fn(),
  countAuditEventsByMailbox: vi.fn(),
}))
vi.mock('@/lib/encryption', () => ({
  encrypt: vi.fn((v: string) => `encrypted:${v}`),
  decrypt: vi.fn((v: string) => v.replace('encrypted:', '')),
}))
vi.mock('@/lib/mail-validation', () => ({
  validateCreateMailboxRequest: vi.fn(() => ({ valid: true, errors: [] })),
  validateUpdateMailboxRequest: vi.fn(() => ({ valid: true, errors: [] })),
  validateCreateMailboxPoolRequest: vi.fn(() => ({ valid: true, errors: [] })),
  validateUpdateMailboxPoolRequest: vi.fn(() => ({ valid: true, errors: [] })),
  validateCreateOAuthConfigRequest: vi.fn(() => ({ valid: true, errors: [] })),
  validateCreateSMTPConfigRequest: vi.fn(() => ({ valid: true, errors: [] })),
  validateCreateIMAPConfigRequest: vi.fn(() => ({ valid: true, errors: [] })),
  validateOAuthProvider: vi.fn(() => ({ valid: true, errors: [] })),
}))

import * as mailboxRepo from '@/repositories/mail/mailbox-repository'
import * as auditRepo from '@/repositories/mail/mailbox-audit-repository'
import * as mailboxService from '@/services/mail/mailbox-service'

const mockActor = { userId: 'user-1', email: 'test@example.com' }

const mockAuditEntry: MailboxAuditLogEntry = {
  id: 'audit-1',
  organizationId: 'org-1',
  mailboxId: 'mb-1',
  actorUserId: 'user-1',
  actorEmail: 'test@example.com',
  action: 'enabled',
  previousStatus: null,
  newStatus: null,
  metadata: {},
  createdAt: '2025-01-01T00:00:00Z',
}

function mockMailbox(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mb-1',
    organizationId: 'org-1',
    poolId: null,
    provider: 'gmail' as const,
    authType: 'oauth' as const,
    email: 'test@gmail.com',
    displayName: 'Test',
    senderName: 'Test',
    providerAccountId: null,
    timezone: 'UTC',
    dailyLimit: 50,
    currentDailyUsage: 0,
    healthScore: 100,
    healthStatus: 'excellent' as const,
    mailboxStatus: 'connected' as const,
    verificationStatus: 'verified' as const,
    warmupStatus: 'idle' as const,
    lastVerifiedAt: null,
    lastVerificationDurationMs: null,
    lastVerificationResult: null,
    deletedAt: null,
    archivedAt: null,
    oauthConfig: null,
    smtpConfig: null,
    imapConfig: null,
    metadata: {},
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('mailbox-service lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('enableMailbox', () => {
    it('transitions from disabled to connected', async () => {
      const mailbox = mockMailbox({ mailboxStatus: 'disabled' })
      vi.mocked(mailboxRepo.findMailboxById).mockResolvedValue(mailbox)
      vi.mocked(mailboxRepo.transitionMailboxStatus).mockResolvedValue({ previousStatus: 'disabled', updated: true })
      vi.mocked(auditRepo.insertAuditEvent).mockResolvedValue(mockAuditEntry)

      const result = await mailboxService.enableMailbox('mb-1', 'org-1', mockActor)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.newStatus).toBe('connected')
        expect(result.data.previousStatus).toBe('disabled')
      }
      expect(auditRepo.insertAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'enabled' }))
    })

    it('fails when mailbox not found', async () => {
      vi.mocked(mailboxRepo.findMailboxById).mockResolvedValue(null)
      const result = await mailboxService.enableMailbox('mb-1', 'org-1', mockActor)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBe('Mailbox not found')
      }
    })

    it('fails on invalid transition', async () => {
      const mailbox = mockMailbox({ mailboxStatus: 'deleted' })
      vi.mocked(mailboxRepo.findMailboxById).mockResolvedValue(mailbox)
      const result = await mailboxService.enableMailbox('mb-1', 'org-1', mockActor)
      expect(result.success).toBe(false)
    })
  })

  describe('disableMailbox', () => {
    it('transitions from connected to disabled', async () => {
      const mailbox = mockMailbox({ mailboxStatus: 'connected' })
      vi.mocked(mailboxRepo.findMailboxById).mockResolvedValue(mailbox)
      vi.mocked(mailboxRepo.transitionMailboxStatus).mockResolvedValue({ previousStatus: 'connected', updated: true })
      vi.mocked(auditRepo.insertAuditEvent).mockResolvedValue(mockAuditEntry)

      const result = await mailboxService.disableMailbox('mb-1', 'org-1', mockActor)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.newStatus).toBe('disabled')
      }
      expect(auditRepo.insertAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'disabled' }))
    })
  })

  describe('archiveMailbox', () => {
    it('transitions from connected to archived', async () => {
      const mailbox = mockMailbox({ mailboxStatus: 'connected' })
      vi.mocked(mailboxRepo.findMailboxById).mockResolvedValue(mailbox)
      vi.mocked(mailboxRepo.transitionMailboxStatus).mockResolvedValue({ previousStatus: 'connected', updated: true })
      vi.mocked(auditRepo.insertAuditEvent).mockResolvedValue(mockAuditEntry)

      const result = await mailboxService.archiveMailbox('mb-1', 'org-1', mockActor)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.newStatus).toBe('archived')
      }
      expect(auditRepo.insertAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'archived' }))
    })
  })

  describe('restoreMailbox', () => {
    it('transitions from archived to connected', async () => {
      const mailbox = mockMailbox({ mailboxStatus: 'archived' })
      vi.mocked(mailboxRepo.findMailboxById).mockResolvedValue(mailbox)
      vi.mocked(mailboxRepo.transitionMailboxStatus).mockResolvedValue({ previousStatus: 'archived', updated: true })
      vi.mocked(auditRepo.insertAuditEvent).mockResolvedValue(mockAuditEntry)

      const result = await mailboxService.restoreMailbox('mb-1', 'org-1', mockActor)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.newStatus).toBe('connected')
      }
      expect(auditRepo.insertAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'restored' }))
    })

    it('fails when mailbox not found', async () => {
      vi.mocked(mailboxRepo.findMailboxById).mockResolvedValue(null)
      const result = await mailboxService.restoreMailbox('mb-1', 'org-1', mockActor)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBe('Mailbox not found')
      }
    })
  })

  describe('softDeleteMailbox', () => {
    it('transitions to deleted', async () => {
      const mailbox = mockMailbox({ mailboxStatus: 'connected' })
      vi.mocked(mailboxRepo.findMailboxById).mockResolvedValue(mailbox)
      vi.mocked(mailboxRepo.transitionMailboxStatus).mockResolvedValue({ previousStatus: 'connected', updated: true })
      vi.mocked(auditRepo.insertAuditEvent).mockResolvedValue(mockAuditEntry)

      const result = await mailboxService.softDeleteMailbox('mb-1', 'org-1', mockActor)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.newStatus).toBe('deleted')
      }
      expect(auditRepo.insertAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'soft_deleted' }))
    })

    it('succeeds even when already deleted (no-op)', async () => {
      const mailbox = mockMailbox({ mailboxStatus: 'deleted' })
      vi.mocked(mailboxRepo.findMailboxById).mockResolvedValue(mailbox)
      vi.mocked(mailboxRepo.transitionMailboxStatus).mockResolvedValue({ previousStatus: 'deleted', updated: true })
      vi.mocked(auditRepo.insertAuditEvent).mockResolvedValue(mockAuditEntry)

      const result = await mailboxService.softDeleteMailbox('mb-1', 'org-1', mockActor)
      expect(result.success).toBe(true)
    })
  })
})

describe('bulk operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('bulkEnableMailboxes processes all IDs', async () => {
    const mailbox1 = mockMailbox({ id: 'mb-1', mailboxStatus: 'disabled' })
    const mailbox2 = mockMailbox({ id: 'mb-2', mailboxStatus: 'disabled' })
    vi.mocked(mailboxRepo.findMailboxById)
      .mockResolvedValueOnce(mailbox1)
      .mockResolvedValueOnce(mailbox2)
    vi.mocked(mailboxRepo.transitionMailboxStatus)
      .mockResolvedValueOnce({ previousStatus: 'disabled', updated: true })
      .mockResolvedValueOnce({ previousStatus: 'disabled', updated: true })
    vi.mocked(auditRepo.insertAuditEvent).mockResolvedValue(mockAuditEntry)

    const result = await mailboxService.bulkEnableMailboxes(['mb-1', 'mb-2'], 'org-1', mockActor)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toHaveLength(2)
      expect(result.data.every(r => r.success)).toBe(true)
    }
  })

  it('bulkDisableMailboxes processes all IDs', async () => {
    const mailbox = mockMailbox({ mailboxStatus: 'connected' })
    vi.mocked(mailboxRepo.findMailboxById).mockResolvedValue(mailbox)
    vi.mocked(mailboxRepo.transitionMailboxStatus).mockResolvedValue({ previousStatus: 'connected', updated: true })
    vi.mocked(auditRepo.insertAuditEvent).mockResolvedValue(mockAuditEntry)

    const result = await mailboxService.bulkDisableMailboxes(['mb-1'], 'org-1', mockActor)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toHaveLength(1)
      expect(result.data[0].success).toBe(true)
    }
  })

  it('bulkArchiveMailboxesLifecycle processes all IDs', async () => {
    const mailbox = mockMailbox({ mailboxStatus: 'connected' })
    vi.mocked(mailboxRepo.findMailboxById).mockResolvedValue(mailbox)
    vi.mocked(mailboxRepo.transitionMailboxStatus).mockResolvedValue({ previousStatus: 'connected', updated: true })
    vi.mocked(auditRepo.insertAuditEvent).mockResolvedValue(mockAuditEntry)

    const result = await mailboxService.bulkArchiveMailboxesLifecycle(['mb-1'], 'org-1', mockActor)
    expect(result.success).toBe(true)
  })

  it('bulkDeleteMailboxesLifecycle processes all IDs', async () => {
    const mailbox = mockMailbox({ mailboxStatus: 'connected' })
    vi.mocked(mailboxRepo.findMailboxById).mockResolvedValue(mailbox)
    vi.mocked(mailboxRepo.transitionMailboxStatus).mockResolvedValue({ previousStatus: 'connected', updated: true })
    vi.mocked(auditRepo.insertAuditEvent).mockResolvedValue(mockAuditEntry)

    const result = await mailboxService.bulkDeleteMailboxesLifecycle(['mb-1'], 'org-1', mockActor)
    expect(result.success).toBe(true)
  })

  it('bulkRestoreMailboxes processes all IDs', async () => {
    const mailbox = mockMailbox({ mailboxStatus: 'archived' })
    vi.mocked(mailboxRepo.findMailboxById).mockResolvedValue(mailbox)
    vi.mocked(mailboxRepo.transitionMailboxStatus).mockResolvedValue({ previousStatus: 'archived', updated: true })
    vi.mocked(auditRepo.insertAuditEvent).mockResolvedValue(mockAuditEntry)

    const result = await mailboxService.bulkRestoreMailboxes(['mb-1'], 'org-1', mockActor)
    expect(result.success).toBe(true)
  })

  it('returns per-mailbox errors for failed operations', async () => {
    vi.mocked(mailboxRepo.findMailboxById)
      .mockResolvedValueOnce(mockMailbox({ id: 'mb-1', mailboxStatus: 'connected' }))
      .mockResolvedValueOnce(null)
    vi.mocked(mailboxRepo.transitionMailboxStatus).mockResolvedValue({ previousStatus: 'connected', updated: true })
    vi.mocked(auditRepo.insertAuditEvent).mockResolvedValue(mockAuditEntry)

    const result = await mailboxService.bulkEnableMailboxes(['mb-1', 'mb-missing'], 'org-1', mockActor)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toHaveLength(2)
      expect(result.data[0].success).toBe(true)
      expect(result.data[1].success).toBe(false)
      expect(result.data[1].error).toBe('Mailbox not found')
    }
  })
})

describe('audit logging', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('logs audit event on enable', async () => {
    const mailbox = mockMailbox({ mailboxStatus: 'disabled' })
    vi.mocked(mailboxRepo.findMailboxById).mockResolvedValue(mailbox)
    vi.mocked(mailboxRepo.transitionMailboxStatus).mockResolvedValue({ previousStatus: 'disabled', updated: true })
    vi.mocked(auditRepo.insertAuditEvent).mockResolvedValue(mockAuditEntry)

    await mailboxService.enableMailbox('mb-1', 'org-1', mockActor)
    expect(auditRepo.insertAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        mailboxId: 'mb-1',
        actorUserId: 'user-1',
        actorEmail: 'test@example.com',
        action: 'enabled',
        previousStatus: 'disabled',
        newStatus: 'connected',
      })
    )
  })

  it('logs audit event on disable', async () => {
    const mailbox = mockMailbox({ mailboxStatus: 'connected' })
    vi.mocked(mailboxRepo.findMailboxById).mockResolvedValue(mailbox)
    vi.mocked(mailboxRepo.transitionMailboxStatus).mockResolvedValue({ previousStatus: 'connected', updated: true })
    vi.mocked(auditRepo.insertAuditEvent).mockResolvedValue(mockAuditEntry)

    await mailboxService.disableMailbox('mb-1', 'org-1', mockActor)
    expect(auditRepo.insertAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'disabled' })
    )
  })

  it('logs audit event on archive', async () => {
    const mailbox = mockMailbox({ mailboxStatus: 'connected' })
    vi.mocked(mailboxRepo.findMailboxById).mockResolvedValue(mailbox)
    vi.mocked(mailboxRepo.transitionMailboxStatus).mockResolvedValue({ previousStatus: 'connected', updated: true })
    vi.mocked(auditRepo.insertAuditEvent).mockResolvedValue(mockAuditEntry)

    await mailboxService.archiveMailbox('mb-1', 'org-1', mockActor)
    expect(auditRepo.insertAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'archived' })
    )
  })

  it('logs audit event on restore', async () => {
    const mailbox = mockMailbox({ mailboxStatus: 'archived' })
    vi.mocked(mailboxRepo.findMailboxById).mockResolvedValue(mailbox)
    vi.mocked(mailboxRepo.transitionMailboxStatus).mockResolvedValue({ previousStatus: 'archived', updated: true })
    vi.mocked(auditRepo.insertAuditEvent).mockResolvedValue(mockAuditEntry)

    await mailboxService.restoreMailbox('mb-1', 'org-1', mockActor)
    expect(auditRepo.insertAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'restored' })
    )
  })

  it('logs audit event on soft delete', async () => {
    const mailbox = mockMailbox({ mailboxStatus: 'connected' })
    vi.mocked(mailboxRepo.findMailboxById).mockResolvedValue(mailbox)
    vi.mocked(mailboxRepo.transitionMailboxStatus).mockResolvedValue({ previousStatus: 'connected', updated: true })
    vi.mocked(auditRepo.insertAuditEvent).mockResolvedValue(mockAuditEntry)

    await mailboxService.softDeleteMailbox('mb-1', 'org-1', mockActor)
    expect(auditRepo.insertAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'soft_deleted' })
    )
  })

  it('does not log audit when transition fails', async () => {
    const mailbox = mockMailbox({ mailboxStatus: 'deleted' })
    vi.mocked(mailboxRepo.findMailboxById).mockResolvedValue(mailbox)

    await mailboxService.enableMailbox('mb-1', 'org-1', mockActor)
    expect(auditRepo.insertAuditEvent).not.toHaveBeenCalled()
  })
})
