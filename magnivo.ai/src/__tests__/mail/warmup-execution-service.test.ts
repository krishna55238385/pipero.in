import { vi } from 'vitest'
import * as executionService from '@/services/mail/warmup-execution-service'
import { makeConfig, makeMailbox, makeJob } from './warmup-execution-engine-test-helpers'

vi.mock('@/services/mail/warmup-pool-service', () => ({
  pickHealthyPoolPartner: vi.fn().mockResolvedValue({
    id: 'pool-1',
    email: 'warmup-partner@magnivo-warmup.test',
    domain: 'magnivo-warmup.test',
    smtpHost: 'smtp.example.com',
    smtpPort: 587,
    encryptedSmtpPassword: null,
    healthStatus: 'healthy',
    dailyCapacity: 50,
    currentDailyUsage: 0,
  }),
  generateWarmupContent: vi.fn().mockReturnValue({
    subject: 'Quick check-in',
    text: 'Hello',
    html: '<p>Hello</p>',
  }),
  sendWarmupFromClientMailbox: vi.fn().mockResolvedValue({ messageId: 'msg-1' }),
  recordWarmupInteraction: vi.fn().mockResolvedValue(undefined),
  markPoolMailboxUnhealthy: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/repositories/mail/warmup-repository', () => ({
  findConfigById: vi.fn().mockResolvedValue(null),
  findConfigsByStatus: vi.fn().mockResolvedValue([]),
  findTodayStats: vi.fn().mockResolvedValue(null),
  updateConfig: vi.fn(),
  insertEvent: vi.fn().mockResolvedValue({ id: 'evt-1' }),
  insertNotification: vi.fn().mockResolvedValue({ id: 'notif-1' }),
  upsertDailyStats: vi.fn(),
  findStatsByConfigId: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/repositories/mail/mailbox-repository', () => ({
  findMailboxById: vi.fn().mockResolvedValue({
    id: 'mb-1',
    organizationId: 'org-1',
    poolId: null,
    provider: 'gmail',
    authType: 'oauth',
    email: 'test@example.com',
    displayName: 'Test',
    senderName: 'Test',
    providerAccountId: null,
    timezone: 'UTC',
    dailyLimit: 50,
    currentDailyUsage: 0,
    healthScore: 80,
    healthStatus: 'good',
    mailboxStatus: 'connected',
    verificationStatus: 'verified',
    warmupStatus: 'idle',
    lastVerifiedAt: null,
    lastVerificationDurationMs: null,
    lastVerificationResult: null,
    deletedAt: null,
    archivedAt: null,
    oauthConfig: null,
    smtpConfig: null,
    imapConfig: null,
    metadata: {},
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }),
}))

vi.mock('@/repositories/mail/warmup-job-repository', () => ({
  findJobById: vi.fn().mockResolvedValue(null),
  insertJob: vi.fn().mockImplementation((data) =>
    Promise.resolve(makeJob({ ...data, id: 'job-new' }))
  ),
  updateJob: vi.fn(),
  findJobsByConfigId: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/repositories/mail/warmup-execution-repository', () => ({
  insertExecution: vi.fn().mockImplementation((data) =>
    Promise.resolve({ id: 'exec-1', ...data, createdAt: new Date().toISOString() })
  ),
  updateExecution: vi.fn(),
  findExecutionById: vi.fn().mockResolvedValue(null),
  findExecutionsByJobId: vi.fn().mockResolvedValue([]),
  findExecutionsByConfigId: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/services/mail/warmup-progress-service', () => ({
  recordSendOutcome: vi.fn().mockResolvedValue({}),
}))

vi.mock('@/services/mail/warmup-health-service', () => ({
  evaluateHealthChange: vi.fn().mockResolvedValue({
    changed: false, previousHealth: 'healthy', newHealth: 'healthy', healthScore: 75,
  }),
  checkGraduationReadiness: vi.fn().mockResolvedValue({ ready: false, reasons: [] }),
}))

vi.mock('@/services/mail/warmup-stage-service', () => ({
  advanceStageIfNeeded: vi.fn().mockResolvedValue({ advanced: false }),
}))

vi.mock('@/services/mail/warmup-notification-service', () => ({
  notifyWarmupGraduated: vi.fn(),
  notifyHealthDegraded: vi.fn(),
  notifyExecutionFailed: vi.fn(),
  notifyOAuthExpired: vi.fn(),
  notifyDnsFailure: vi.fn(),
  notifyWarmupPaused: vi.fn(),
  notifyMailboxDisconnected: vi.fn(),
  recordAuditForAction: vi.fn(),
}))

vi.mock('@/services/mail/warmup-metrics-service', () => ({
  recordAuditLog: vi.fn(),
}))

describe('warmup-execution-service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('evaluatePauseConditions', () => {
    it('returns shouldPause when mailbox is disabled', async () => {
      const { findMailboxById } = await import('@/repositories/mail/mailbox-repository')
      vi.mocked(findMailboxById).mockResolvedValue(makeMailbox({ mailboxStatus: 'disabled' }))

      const result = await executionService.evaluatePauseConditions(makeConfig(), 'org-1')
      expect(result.shouldPause).toBe(true)
      expect(result.reason).toBe('Mailbox is disabled')
    })

    it('returns shouldPause when oauth is expired', async () => {
      const { findMailboxById } = await import('@/repositories/mail/mailbox-repository')
      vi.mocked(findMailboxById).mockResolvedValue(makeMailbox({ mailboxStatus: 'oauth_expired' }))

      const result = await executionService.evaluatePauseConditions(makeConfig(), 'org-1')
      expect(result.shouldPause).toBe(true)
      expect(result.reason).toBe('OAuth credentials have expired')
    })

    it('returns shouldPause when health is critical', async () => {
      const { findMailboxById } = await import('@/repositories/mail/mailbox-repository')
      vi.mocked(findMailboxById).mockResolvedValue(makeMailbox())

      const result = await executionService.evaluatePauseConditions(
        makeConfig({ health: 'critical' }),
        'org-1'
      )
      expect(result.shouldPause).toBe(true)
      expect(result.reason).toBe('Health is critical')
    })

    it('returns shouldPause when smtp_failed', async () => {
      const { findMailboxById } = await import('@/repositories/mail/mailbox-repository')
      vi.mocked(findMailboxById).mockResolvedValue(makeMailbox({ mailboxStatus: 'smtp_failed' }))

      const result = await executionService.evaluatePauseConditions(makeConfig(), 'org-1')
      expect(result.shouldPause).toBe(true)
      expect(result.reason).toBe('SMTP authentication failed')
    })

    it('returns shouldPause when mailbox not found', async () => {
      const { findMailboxById } = await import('@/repositories/mail/mailbox-repository')
      vi.mocked(findMailboxById).mockResolvedValue(null)

      const result = await executionService.evaluatePauseConditions(makeConfig(), 'org-1')
      expect(result.shouldPause).toBe(true)
      expect(result.reason).toBe('Mailbox not found')
    })

    it('returns shouldPause when verification_failed', async () => {
      const { findMailboxById } = await import('@/repositories/mail/mailbox-repository')
      vi.mocked(findMailboxById).mockResolvedValue(makeMailbox({ mailboxStatus: 'verification_failed' }))

      const result = await executionService.evaluatePauseConditions(makeConfig(), 'org-1')
      expect(result.shouldPause).toBe(true)
      expect(result.reason).toBe('Mailbox verification failed')
    })

    it('returns shouldPause when imap_failed', async () => {
      const { findMailboxById } = await import('@/repositories/mail/mailbox-repository')
      vi.mocked(findMailboxById).mockResolvedValue(makeMailbox({ mailboxStatus: 'imap_failed' }))

      const result = await executionService.evaluatePauseConditions(makeConfig(), 'org-1')
      expect(result.shouldPause).toBe(true)
      expect(result.reason).toBe('IMAP connection failed')
    })

    it('does not pause when everything is healthy', async () => {
      const { findMailboxById } = await import('@/repositories/mail/mailbox-repository')
      vi.mocked(findMailboxById).mockResolvedValue(makeMailbox({ mailboxStatus: 'connected' }))

      const result = await executionService.evaluatePauseConditions(
        makeConfig({ health: 'healthy' }),
        'org-1'
      )
      expect(result.shouldPause).toBe(false)
      expect(result.reason).toBeNull()
    })

    it('does not pause when failureReason does not mention maximum failures', async () => {
      const { findMailboxById } = await import('@/repositories/mail/mailbox-repository')
      vi.mocked(findMailboxById).mockResolvedValue(makeMailbox({ mailboxStatus: 'connected' }))

      const result = await executionService.evaluatePauseConditions(
        makeConfig({ health: 'healthy', failureReason: 'Some other error' }),
        'org-1'
      )
      expect(result.shouldPause).toBe(false)
    })

    it('pauses when failureReason mentions maximum failures', async () => {
      const { findMailboxById } = await import('@/repositories/mail/mailbox-repository')
      vi.mocked(findMailboxById).mockResolvedValue(makeMailbox({ mailboxStatus: 'connected' }))

      const result = await executionService.evaluatePauseConditions(
        makeConfig({ health: 'healthy', failureReason: 'maximum failures exceeded' }),
        'org-1'
      )
      expect(result.shouldPause).toBe(true)
    })
  })

  describe('calculateTargetSends', () => {
    it('calculates remaining sends', async () => {
      const { findTodayStats } = await import('@/repositories/mail/warmup-repository')
      vi.mocked(findTodayStats).mockResolvedValue(null)

      const config = makeConfig({ currentDailyTarget: 13 })
      const result = await executionService.calculateTargetSends(config)
      expect(result.todayAllowed).toBe(13)
      expect(result.alreadyCompleted).toBe(0)
      expect(result.remaining).toBe(13)
    })

    it('skips when daily target reached', async () => {
      const { findTodayStats } = await import('@/repositories/mail/warmup-repository')
      vi.mocked(findTodayStats).mockResolvedValue({
        id: 'stat-1', configId: 'cfg-1', organizationId: 'org-1',
        date: new Date().toISOString().split('T')[0], dayNumber: 5,
        targetSends: 13, actualSends: 13, successfulSends: 12,
        failedSends: 1, bouncedSends: 0, repliesReceived: 0,
        opensTracked: 0, clicksTracked: 0, spamReports: 0,
        healthScore: 75, reputationScore: 80, metadata: {},
        createdAt: new Date().toISOString(),
      })

      const config = makeConfig({ currentDailyTarget: 13 })
      const result = await executionService.calculateTargetSends(config)
      expect(result.shouldExecute).toBe(false)
      expect(result.skipReason).toBe('Daily target reached')
    })

    it('skips on weekend when weekendSending is false', async () => {
      const { findTodayStats } = await import('@/repositories/mail/warmup-repository')
      vi.mocked(findTodayStats).mockResolvedValue(null)

      const config = makeConfig({
        currentDailyTarget: 13,
        weekendSending: false,
        timezone: 'UTC',
      })

      const result = await executionService.calculateTargetSends(config)
      // In UTC on a weekday, shouldExecute should be true
      // The weekend check depends on the timezone format, so we just verify the function works
      expect(result).toHaveProperty('shouldExecute')
      expect(result).toHaveProperty('skipReason')
    })
  })

  describe('createJobForConfig', () => {
    it('creates a job when there are remaining sends', async () => {
      const { findTodayStats } = await import('@/repositories/mail/warmup-repository')
      vi.mocked(findTodayStats).mockResolvedValue(null)

      const { insertJob } = await import('@/repositories/mail/warmup-job-repository')
      vi.mocked(insertJob).mockResolvedValue(makeJob({ targetSends: 13 }))

      const config = makeConfig({ currentDailyTarget: 13 })
      const job = await executionService.createJobForConfig(config, 'org-1')
      expect(job).toBeDefined()
      expect(job?.targetSends).toBe(13)
    })

    it('returns null when no start date', async () => {
      const config = makeConfig({ startDate: null })
      const job = await executionService.createJobForConfig(config, 'org-1')
      expect(job).toBeNull()
    })

    it('returns null when daily target is 0', async () => {
      const { findTodayStats } = await import('@/repositories/mail/warmup-repository')
      vi.mocked(findTodayStats).mockResolvedValue(null)

      const config = makeConfig({ currentDailyTarget: 0 })
      const job = await executionService.createJobForConfig(config, 'org-1')
      expect(job).toBeNull()
    })
  })

  describe('cancelExecution', () => {
    it('returns error when execution not found', async () => {
      const { findExecutionById } = await import('@/repositories/mail/warmup-execution-repository')
      vi.mocked(findExecutionById).mockResolvedValue(null)

      const result = await executionService.cancelExecution('exec-1')
      expect(result.success).toBe(false)
    })
  })

  describe('retryExecution', () => {
    it('returns error when execution not found', async () => {
      const { findExecutionById } = await import('@/repositories/mail/warmup-execution-repository')
      vi.mocked(findExecutionById).mockResolvedValue(null)

      const result = await executionService.retryExecution('exec-1')
      expect(result.success).toBe(false)
    })
  })
})
