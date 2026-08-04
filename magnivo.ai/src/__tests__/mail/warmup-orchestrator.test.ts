import * as warmupService from '@/services/mail/warmup-service'
import { vi } from 'vitest'
import type {
  WarmupConfigModel,
  WarmupConfigStatus,
  Mailbox,
} from '@/types/mail'

const mockActor = { userId: 'user-1', email: 'user@example.com' }

vi.mock('@/repositories/mail/warmup-repository', () => ({
  findConfigById: vi.fn(),
  findConfigsByOrg: vi.fn().mockResolvedValue([]),
  findConfigsByStatus: vi.fn().mockResolvedValue([]),
  findConfigsByStatusPaginated: vi.fn().mockResolvedValue({ configs: [], total: 0 }),
  findActiveConfigByMailboxId: vi.fn().mockResolvedValue(null),
  insertConfig: vi.fn(),
  updateConfig: vi.fn(),
  deleteConfig: vi.fn(),
  insertEvent: vi.fn().mockResolvedValue({ id: 'evt-1' }),
  insertHistory: vi.fn().mockResolvedValue({ id: 'hist-1' }),
  insertNotification: vi.fn().mockResolvedValue({ id: 'notif-1' }),
  getDashboardStats: vi.fn().mockResolvedValue({
    totalConfigs: 0, running: 0, paused: 0, graduated: 0,
    totalMailboxesWarming: 0, avgHealthScore: 0, graduationRate: 0,
  }),
  findStagesByConfigId: vi.fn().mockResolvedValue([]),
  findStageByConfigAndDay: vi.fn().mockResolvedValue(null),
  insertStage: vi.fn(),
  updateStage: vi.fn(),
  findTodayStats: vi.fn().mockResolvedValue(null),
  upsertDailyStats: vi.fn(),
  findStatsByConfigId: vi.fn().mockResolvedValue([]),
  insertGraduation: vi.fn(),
  findGraduationsByOrg: vi.fn().mockResolvedValue([]),
  findEventsByConfigId: vi.fn().mockResolvedValue([]),
  findUnreadNotifications: vi.fn().mockResolvedValue([]),
  countUnreadNotifications: vi.fn().mockResolvedValue(0),
  findTemplatesByOrg: vi.fn().mockResolvedValue([]),
  findTemplateById: vi.fn().mockResolvedValue(null),
  findDefaultTemplate: vi.fn().mockResolvedValue(null),
  insertTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
}))

vi.mock('@/repositories/mail/mailbox-repository', () => ({
  findMailboxById: vi.fn(),
  transitionMailboxStatus: vi.fn().mockResolvedValue({ previousStatus: 'pending_warmup', updated: true }),
}))

function makeConfig(overrides: Partial<WarmupConfigModel> = {}): WarmupConfigModel {
  return {
    id: 'cfg-1',
    organizationId: 'org-1',
    mailboxId: 'mb-1',
    status: 'draft',
    stage: 'initial',
    health: 'healthy',
    startDate: null,
    endDate: null,
    pausedAt: null,
    resumedAt: null,
    graduatedAt: null,
    currentDay: 0,
    totalDays: 30,
    initialSends: 5,
    maxDailySends: 50,
    dailyIncrease: 2,
    currentDailyTarget: 0,
    weekendSending: false,
    businessHoursStart: 9,
    businessHoursEnd: 17,
    timezone: 'UTC',
    minDelayMs: 30000,
    maxDelayMs: 120000,
    randomizationFactor: 0.3,
    replySimulation: true,
    readSimulation: true,
    spamRescue: true,
    openSimulation: true,
    clickSimulation: false,
    targetHealthScore: 80,
    graduationThreshold: 75,
    pauseThreshold: 30,
    resumeThreshold: 50,
    pauseReason: null,
    failureReason: null,
    metadata: {},
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeMailbox(overrides: Partial<Mailbox> = {}): Mailbox {
  return {
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
    ...overrides,
  }
}

describe('warmup-service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('startWarmup', () => {
    it('returns error if config not found', async () => {
      const { findConfigById } = await import('@/repositories/mail/warmup-repository')
      vi.mocked(findConfigById).mockResolvedValue(null)

      const result = await warmupService.startWarmup('cfg-1', 'org-1', mockActor)
      expect(result.success).toBe(false)
    })

    it('starts a draft config', async () => {
      const { findConfigById, updateConfig } = await import('@/repositories/mail/warmup-repository')
      vi.mocked(findConfigById).mockResolvedValue(makeConfig({ status: 'draft' }))
      vi.mocked(updateConfig).mockResolvedValue(makeConfig({ status: 'running', startDate: '2026-01-01T00:00:00Z' }))

      const { findMailboxById } = await import('@/repositories/mail/mailbox-repository')
      vi.mocked(findMailboxById).mockResolvedValue(makeMailbox({ mailboxStatus: 'pending_warmup' }))

      const result = await warmupService.startWarmup('cfg-1', 'org-1', mockActor)
      expect(result.success).toBe(true)
      expect(updateConfig).toHaveBeenCalledWith('cfg-1', 'org-1', expect.objectContaining({ status: 'running' }))
    })

    it('rejects starting a running config', async () => {
      const { findConfigById } = await import('@/repositories/mail/warmup-repository')
      vi.mocked(findConfigById).mockResolvedValue(makeConfig({ status: 'running' }))

      const result = await warmupService.startWarmup('cfg-1', 'org-1', mockActor)
      expect(result.success).toBe(false)
    })
  })

  describe('pauseWarmup', () => {
    it('pauses a running config', async () => {
      const { findConfigById, updateConfig } = await import('@/repositories/mail/warmup-repository')
      vi.mocked(findConfigById).mockResolvedValue(makeConfig({ status: 'running' }))
      vi.mocked(updateConfig).mockResolvedValue(makeConfig({ status: 'paused' }))

      const { findMailboxById } = await import('@/repositories/mail/mailbox-repository')
      vi.mocked(findMailboxById).mockResolvedValue(makeMailbox())

      const result = await warmupService.pauseWarmup('cfg-1', 'org-1', 'test reason', mockActor)
      expect(result.success).toBe(true)
      expect(updateConfig).toHaveBeenCalledWith('cfg-1', 'org-1', expect.objectContaining({ status: 'paused' }))
    })

    it('rejects pausing a draft config', async () => {
      const { findConfigById } = await import('@/repositories/mail/warmup-repository')
      vi.mocked(findConfigById).mockResolvedValue(makeConfig({ status: 'draft' }))

      const result = await warmupService.pauseWarmup('cfg-1', 'org-1', 'reason', mockActor)
      expect(result.success).toBe(false)
    })
  })

  describe('resumeWarmup', () => {
    it('resumes a paused config', async () => {
      const { findConfigById, updateConfig } = await import('@/repositories/mail/warmup-repository')
      vi.mocked(findConfigById).mockResolvedValue(makeConfig({ status: 'paused' }))
      vi.mocked(updateConfig).mockResolvedValue(makeConfig({ status: 'running' }))

      const { findMailboxById } = await import('@/repositories/mail/mailbox-repository')
      vi.mocked(findMailboxById).mockResolvedValue(makeMailbox())

      const result = await warmupService.resumeWarmup('cfg-1', 'org-1', mockActor)
      expect(result.success).toBe(true)
    })

    it('rejects resuming a running config', async () => {
      const { findConfigById } = await import('@/repositories/mail/warmup-repository')
      vi.mocked(findConfigById).mockResolvedValue(makeConfig({ status: 'running' }))

      const result = await warmupService.resumeWarmup('cfg-1', 'org-1', mockActor)
      expect(result.success).toBe(false)
    })
  })

  describe('deleteWarmup', () => {
    it('deletes a draft config', async () => {
      const { findConfigById, deleteConfig } = await import('@/repositories/mail/warmup-repository')
      vi.mocked(findConfigById).mockResolvedValue(makeConfig({ status: 'draft' }))
      vi.mocked(deleteConfig).mockResolvedValue(true)

      const result = await warmupService.deleteWarmup('cfg-1', 'org-1', mockActor)
      expect(result.success).toBe(true)
      expect(deleteConfig).toHaveBeenCalledWith('cfg-1', 'org-1')
    })

    it('rejects deleting a running config', async () => {
      const { findConfigById } = await import('@/repositories/mail/warmup-repository')
      vi.mocked(findConfigById).mockResolvedValue(makeConfig({ status: 'running' }))

      const result = await warmupService.deleteWarmup('cfg-1', 'org-1', mockActor)
      expect(result.success).toBe(false)
    })
  })

  describe('updateWarmupConfig', () => {
    it('updates a draft config', async () => {
      const { findConfigById, updateConfig } = await import('@/repositories/mail/warmup-repository')
      vi.mocked(findConfigById).mockResolvedValue(makeConfig({ status: 'draft' }))
      vi.mocked(updateConfig).mockResolvedValue(makeConfig({ status: 'draft', maxDailySends: 100 }))

      const { findMailboxById } = await import('@/repositories/mail/mailbox-repository')
      vi.mocked(findMailboxById).mockResolvedValue(makeMailbox())

      const result = await warmupService.updateWarmupConfig('cfg-1', 'org-1', { maxDailySends: 100 }, mockActor)
      expect(result.success).toBe(true)
    })

    it('rejects updating a running config', async () => {
      const { findConfigById } = await import('@/repositories/mail/warmup-repository')
      vi.mocked(findConfigById).mockResolvedValue(makeConfig({ status: 'running' }))

      const result = await warmupService.updateWarmupConfig('cfg-1', 'org-1', { maxDailySends: 100 }, mockActor)
      expect(result.success).toBe(false)
    })
  })

  describe('getWarmupDashboard', () => {
    it('returns dashboard stats', async () => {
      const result = await warmupService.getWarmupDashboard('org-1')
      expect(result).toHaveProperty('totalConfigs')
      expect(result).toHaveProperty('running')
      expect(result).toHaveProperty('paused')
      expect(result).toHaveProperty('graduated')
    })
  })
})
