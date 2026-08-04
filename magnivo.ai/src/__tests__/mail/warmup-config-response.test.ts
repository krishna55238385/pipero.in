import { toWarmupConfigResponse } from '@/services/mail/warmup-configuration-service'
import type { WarmupConfigModel, Mailbox } from '@/types/mail'

function makeConfig(overrides: Partial<WarmupConfigModel> = {}): WarmupConfigModel {
  return {
    id: 'config-1',
    organizationId: 'org-1',
    mailboxId: 'mailbox-1',
    status: 'running',
    stage: 'learning',
    health: 'healthy',
    startDate: '2026-07-01T00:00:00Z',
    endDate: null,
    pausedAt: null,
    resumedAt: null,
    graduatedAt: null,
    currentDay: 5,
    totalDays: 30,
    initialSends: 5,
    maxDailySends: 40,
    dailyIncrease: 2,
    currentDailyTarget: 15,
    weekendSending: false,
    businessHoursStart: 8,
    businessHoursEnd: 18,
    timezone: 'UTC',
    minDelayMs: 60000,
    maxDelayMs: 300000,
    randomizationFactor: 0.3,
    replySimulation: true,
    readSimulation: true,
    spamRescue: true,
    openSimulation: true,
    clickSimulation: false,
    targetHealthScore: 80,
    graduationThreshold: 85,
    pauseThreshold: 30,
    resumeThreshold: 50,
    pauseReason: null,
    failureReason: null,
    metadata: {},
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-05T00:00:00Z',
    ...overrides,
  }
}

function makeMailbox(overrides: Partial<Mailbox> = {}): Mailbox {
  return {
    id: 'mailbox-1',
    organizationId: 'org-1',
    poolId: null,
    provider: 'gmail',
    authType: 'oauth',
    email: 'test@example.com',
    displayName: 'Test Mailbox',
    senderName: 'Test',
    providerAccountId: null,
    timezone: 'UTC',
    dailyLimit: 100,
    currentDailyUsage: 0,
    healthScore: 80,
    healthStatus: 'good',
    mailboxStatus: 'connected',
    verificationStatus: 'verified',
    warmupStatus: 'warming',
    lastVerifiedAt: null,
    lastVerificationDurationMs: null,
    lastVerificationResult: null,
    deletedAt: null,
    archivedAt: null,
    oauthConfig: null,
    smtpConfig: null,
    imapConfig: null,
    metadata: {},
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-05T00:00:00Z',
    ...overrides,
  }
}

describe('warmup-configuration-service', () => {
  describe('toWarmupConfigResponse', () => {
    it('maps all core fields correctly', () => {
      const config = makeConfig()
      const mailbox = makeMailbox()
      const response = toWarmupConfigResponse(config, mailbox)

      expect(response.id).toBe('config-1')
      expect(response.organizationId).toBe('org-1')
      expect(response.mailboxId).toBe('mailbox-1')
      expect(response.mailboxEmail).toBe('test@example.com')
      expect(response.mailboxProvider).toBe('gmail')
      expect(response.status).toBe('running')
      expect(response.stage).toBe('learning')
      expect(response.health).toBe('healthy')
    })

    it('maps date fields correctly', () => {
      const config = makeConfig({
        startDate: '2026-07-01T00:00:00Z',
        endDate: null,
      })
      const response = toWarmupConfigResponse(config, makeMailbox())

      expect(response.startDate).toBe('2026-07-01T00:00:00Z')
      expect(response.endDate).toBeNull()
    })

    it('maps numeric fields correctly', () => {
      const config = makeConfig({
        currentDay: 10,
        totalDays: 30,
        initialSends: 5,
        maxDailySends: 40,
        dailyIncrease: 2,
        currentDailyTarget: 25,
      })
      const response = toWarmupConfigResponse(config, makeMailbox())

      expect(response.currentDay).toBe(10)
      expect(response.totalDays).toBe(30)
      expect(response.initialSends).toBe(5)
      expect(response.maxDailySends).toBe(40)
      expect(response.dailyIncrease).toBe(2)
      expect(response.currentDailyTarget).toBe(25)
    })

    it('maps business hours fields', () => {
      const config = makeConfig({
        businessHoursStart: 9,
        businessHoursEnd: 17,
        weekendSending: true,
      })
      const response = toWarmupConfigResponse(config, makeMailbox())

      expect(response.businessHoursStart).toBe(9)
      expect(response.businessHoursEnd).toBe(17)
      expect(response.weekendSending).toBe(true)
    })

    it('maps simulation fields', () => {
      const config = makeConfig({
        replySimulation: true,
        readSimulation: false,
        spamRescue: true,
        openSimulation: true,
        clickSimulation: false,
      })
      const response = toWarmupConfigResponse(config, makeMailbox())

      expect(response.replySimulation).toBe(true)
      expect(response.readSimulation).toBe(false)
      expect(response.spamRescue).toBe(true)
      expect(response.openSimulation).toBe(true)
      expect(response.clickSimulation).toBe(false)
    })

    it('maps threshold fields', () => {
      const config = makeConfig({
        targetHealthScore: 80,
        graduationThreshold: 85,
        pauseThreshold: 30,
        resumeThreshold: 50,
      })
      const response = toWarmupConfigResponse(config, makeMailbox())

      expect(response.targetHealthScore).toBe(80)
      expect(response.graduationThreshold).toBe(85)
      expect(response.pauseThreshold).toBe(30)
      expect(response.resumeThreshold).toBe(50)
    })

    it('maps delay and randomization fields', () => {
      const config = makeConfig({
        minDelayMs: 60000,
        maxDelayMs: 300000,
        randomizationFactor: 0.3,
      })
      const response = toWarmupConfigResponse(config, makeMailbox())

      expect(response.minDelayMs).toBe(60000)
      expect(response.maxDelayMs).toBe(300000)
      expect(response.randomizationFactor).toBe(0.3)
    })

    it('maps pause/failure reasons', () => {
      const config = makeConfig({
        pauseReason: 'Low health score',
        failureReason: null,
      })
      const response = toWarmupConfigResponse(config, makeMailbox())

      expect(response.pauseReason).toBe('Low health score')
      expect(response.failureReason).toBeNull()
    })

    it('maps metadata and timestamps', () => {
      const meta = { key: 'value' }
      const config = makeConfig({
        metadata: meta,
        createdAt: '2026-07-01T00:00:00Z',
        updatedAt: '2026-07-05T12:00:00Z',
      })
      const response = toWarmupConfigResponse(config, makeMailbox())

      expect(response.metadata).toEqual(meta)
      expect(response.createdAt).toBe('2026-07-01T00:00:00Z')
      expect(response.updatedAt).toBe('2026-07-05T12:00:00Z')
    })

    it('uses mailbox email and provider', () => {
      const mailbox = makeMailbox({
        email: 'sender@company.com',
        provider: 'outlook',
      })
      const response = toWarmupConfigResponse(makeConfig(), mailbox)

      expect(response.mailboxEmail).toBe('sender@company.com')
      expect(response.mailboxProvider).toBe('outlook')
    })

    it('handles graduated config state', () => {
      const config = makeConfig({
        status: 'graduated',
        stage: 'graduated',
        health: 'excellent',
        graduatedAt: '2026-07-30T00:00:00Z',
      })
      const response = toWarmupConfigResponse(config, makeMailbox())

      expect(response.status).toBe('graduated')
      expect(response.stage).toBe('graduated')
      expect(response.health).toBe('excellent')
    })

    it('handles failed config with failure reason', () => {
      const config = makeConfig({
        status: 'failed',
        failureReason: 'DNS verification failed',
      })
      const response = toWarmupConfigResponse(config, makeMailbox())

      expect(response.status).toBe('failed')
      expect(response.failureReason).toBe('DNS verification failed')
    })
  })
})
