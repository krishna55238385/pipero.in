import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPool = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }))
vi.mock('@/lib/db', () => ({ default: mockPool }))

vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: vi.fn().mockResolvedValue({ messageId: 'mock-msg-id' }),
      close: vi.fn(),
    })),
  },
}))

vi.mock('@/lib/encryption', () => ({ decryptAsync: vi.fn().mockResolvedValue('decrypted') }))
vi.mock('@/lib/gmail', () => ({ sendEmail: vi.fn().mockResolvedValue({ id: 'gmail-msg-id' }) }))

vi.mock('@/lib/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
    withRequestId: vi.fn(), child: vi.fn(),
  })),
}))

const mockMailboxRepo = vi.hoisted(() => ({
  findMailboxWithConfigs: vi.fn(),
  findMailboxById: vi.fn(),
  findMailboxesByOrg: vi.fn(),
}))
vi.mock('@/repositories/mail/mailbox-repository', () => mockMailboxRepo)

vi.mock('@/lib/mailbox-state-machine', () => ({ isSendable: vi.fn().mockReturnValue(true) }))

const mockSuppression = vi.hoisted(() => ({
  isSuppressed: vi.fn(),
  createUnsubscribeToken: vi.fn(),
  buildListUnsubscribeHeaders: vi.fn(),
  suppressEmail: vi.fn(),
}))
vi.mock('@/services/mail/suppression-service', () => mockSuppression)

const mockAnalytics = vi.hoisted(() => ({ incrementMailboxUsage: vi.fn() }))
vi.mock('@/services/mail/analytics-service', () => mockAnalytics)

vi.mock('@/services/mail/oauth', () => ({
  getOAuthService: vi.fn().mockReturnValue({
    refreshToken: vi.fn().mockResolvedValue({ accessToken: 'mock-token' }),
  }),
}))

const mockDLQ = vi.hoisted(() => ({ moveToDeadLetter: vi.fn() }))
vi.mock('@/services/mail/dead-letter-queue-service', () => mockDLQ)

const mockNotificationService = vi.hoisted(() => ({
  handleOAuthSendFailure: vi.fn(),
  notifyMailboxReconnectRequired: vi.fn(),
}))
vi.mock('@/services/mail/mailbox-notification-service', () => mockNotificationService)

const mockOpsService = vi.hoisted(() => ({
  getQueuePauseState: vi.fn(),
  resumeSendQueue: vi.fn(),
}))
vi.mock('@/services/mail/operations-service', () => mockOpsService)

import { processSendQueue } from '@/services/mail/send-dispatcher'

function makeMailbox(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mb-1', organizationId: 'org-1', poolId: null, provider: 'gmail', authType: 'oauth',
    email: 'sender@example.com', displayName: 'Sender', senderName: 'Sender', timezone: 'UTC',
    dailyLimit: 50, currentDailyUsage: 0, healthScore: 80, healthStatus: 'good',
    mailboxStatus: 'connected', verificationStatus: 'verified', warmupStatus: 'completed',
    hourlySendLimit: null,
    oauthConfig: { provider: 'gmail', encryptedRefreshToken: 'enc-refresh', encryptedAccessToken: 'enc-access' },
    smtpConfig: null, metadata: { respectBusinessHours: false }, deletedAt: null,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeJobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1', organization_id: 'org-1', enrollment_id: null, campaign_id: null,
    mailbox_id: 'mb-1', lead_id: null, to_email: 'recipient@example.com',
    subject: 'Test Subject', body_html: '<p>Hello</p>', body_text: 'Hello',
    status: 'pending', attempts: 0, max_attempts: 5, last_error: null,
    scheduled_for: new Date().toISOString(), next_attempt_at: new Date().toISOString(),
    sent_at: null, provider_message_id: null, metadata: {},
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

let nextIdx = 1
const responses: Record<number, unknown> = {}

function mockNext(val: unknown) {
  const c = nextIdx
  nextIdx++
  responses[c] = val
}

function mockQuery() {
  let callCount = 0
  mockPool.query.mockImplementation(() => {
    callCount++
    const r = responses[callCount] as
      | { success?: boolean; error?: string; rows?: unknown[]; rowCount?: number }
      | undefined
    if (r) {
      if (r.success === false) return Promise.reject(new Error(r.error || 'mock error'))
      return Promise.resolve(r)
    }
    return Promise.resolve({ rows: [], rowCount: 0 })
  })
}

describe('send-dispatcher rate limits', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    nextIdx = 1
    Object.keys(responses).forEach(k => delete responses[k as unknown as number])
    mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 })

    mockOpsService.getQueuePauseState.mockResolvedValue({ paused: false, pausedAt: null, pausedBy: null, resumeAt: null })
    mockOpsService.resumeSendQueue.mockResolvedValue(undefined)
    mockSuppression.isSuppressed.mockResolvedValue(false)
    mockSuppression.createUnsubscribeToken.mockResolvedValue('unsub-token')
    mockSuppression.buildListUnsubscribeHeaders.mockReturnValue({})
    mockSuppression.suppressEmail.mockResolvedValue(undefined)
    mockAnalytics.incrementMailboxUsage.mockResolvedValue(undefined)
    mockDLQ.moveToDeadLetter.mockResolvedValue({ success: true, data: {} })
    mockNotificationService.handleOAuthSendFailure.mockResolvedValue(undefined)
    mockNotificationService.notifyMailboxReconnectRequired.mockResolvedValue(undefined)
  })

  describe('Per-mailbox hourly rate limiting', () => {
    it('defers jobs when hourly send count exceeds limit', async () => {
      mockQuery()
      mockNext({ rows: [makeJobRow({ mailbox_id: 'mb-1', attempts: 0 })] })
      mockNext({ rowCount: 1 })
      mockNext({ rows: [{ c: 3 }] })

      mockMailboxRepo.findMailboxWithConfigs.mockResolvedValue(
        makeMailbox({ id: 'mb-1', hourlySendLimit: 10, currentDailyUsage: 5, dailyLimit: 50, poolId: null })
      )

      mockNext({ rows: [{ c: 10 }] })
      mockNext({ rows: [{ c: 0 }] })
      mockNext({ rows: [] })
      mockNext({ rows: [{ require_consent: 'false' }] })
      mockNext({ rows: [{ physical_address: '', company_name: '' }] })
      mockNext({ rows: [{ metadata: {} }] })

      const result = await processSendQueue('org-1')
      expect(result.processed).toBe(1)
      expect(result.sent).toBe(0)
    })

    it('sends job when hourly count is under limit', async () => {
      mockQuery()
      mockNext({ rows: [makeJobRow({ mailbox_id: 'mb-1' })] })
      mockNext({ rowCount: 1 })
      mockNext({ rows: [{ c: 3 }] })

      mockMailboxRepo.findMailboxWithConfigs.mockResolvedValue(
        makeMailbox({ id: 'mb-1', hourlySendLimit: 10, currentDailyUsage: 5, dailyLimit: 50 })
      )

      mockNext({ rows: [{ c: 5 }] })
      mockNext({ rows: [{ c: 0 }] })
      mockNext({ rows: [1] })
      mockNext({ rows: [{ require_consent: 'false' }] })
      mockNext({ rows: [{ physical_address: '123 Street', company_name: 'Test Inc' }] })
      mockNext({ rows: [{ metadata: {} }] })
      mockNext({ rowCount: 1 })
      mockNext({ rowCount: 1 })

      const result = await processSendQueue('org-1')
      expect(result.processed).toBe(1)
      expect(result.sent).toBe(1)
    })
  })

  describe('Per-domain hourly rate limiting', () => {
    it('defers jobs when domain hourly limit is reached', async () => {
      mockQuery()
      mockNext({ rows: [makeJobRow({ mailbox_id: 'mb-1' })] })
      mockNext({ rowCount: 1 })
      mockNext({ rows: [{ c: 3 }] })

      mockMailboxRepo.findMailboxWithConfigs.mockResolvedValue(
        makeMailbox({ id: 'mb-1', hourlySendLimit: 10, currentDailyUsage: 5, dailyLimit: 50, poolId: null })
      )

      mockNext({ rows: [{ c: 5 }] })
      mockNext({ rows: [{ c: 50 }] })
      mockNext({ rows: [] })
      mockNext({ rows: [{ require_consent: 'false' }] })
      mockNext({ rows: [{ physical_address: '', company_name: '' }] })
      mockNext({ rows: [{ metadata: {} }] })

      const result = await processSendQueue('org-1')
      expect(result.processed).toBe(1)
      expect(result.sent).toBe(0)
    })
  })

  describe('Per-workspace hourly rate limiting', () => {
    it('defers jobs when workspace-level cap is exceeded', async () => {
      mockQuery()
      mockNext({ rows: [makeJobRow({ mailbox_id: 'mb-1' })] })
      mockNext({ rowCount: 1 })
      mockNext({ rows: [{ c: 5000 }] })

      const result = await processSendQueue('org-1')
      expect(result.processed).toBe(1)
      expect(result.sent).toBe(0)
    })
  })

  describe('Pool daily cap enforcement', () => {
    it('defers job when pool used >= daily pool limit', async () => {
      mockQuery()
      mockNext({ rows: [makeJobRow({ mailbox_id: 'mb-1' })] })
      mockNext({ rowCount: 1 })
      mockNext({ rows: [{ c: 3 }] })

      mockMailboxRepo.findMailboxWithConfigs.mockResolvedValue(
        makeMailbox({ id: 'mb-1', hourlySendLimit: 50, currentDailyUsage: 5, dailyLimit: 50, poolId: 'pool-1' })
      )

      mockNext({ rows: [{ c: 5 }] })
      mockNext({ rows: [{ c: 0 }] })
      mockNext({ rows: [{ daily_pool_limit: 100 }] })
      mockNext({ rows: [{ used: 100 }] })

      const result = await processSendQueue('org-1')
      expect(result.processed).toBe(1)
      expect(result.sent).toBe(0)
    })
  })

  describe('Business hours deferral', () => {
    it('defers job when outside business hours', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))

      mockQuery()
      mockNext({ rows: [makeJobRow({ mailbox_id: 'mb-1' })] })
      mockNext({ rowCount: 1 })
      mockNext({ rows: [{ c: 2 }] })

      mockMailboxRepo.findMailboxWithConfigs.mockResolvedValue(
        makeMailbox({
          id: 'mb-1', hourlySendLimit: 50, currentDailyUsage: 5, dailyLimit: 50,
          timezone: 'Pacific/Midway',
          metadata: { businessHoursStart: 23, businessHoursEnd: 1, respectBusinessHours: true },
        })
      )

      mockNext({ rowCount: 1 })

      const result = await processSendQueue('org-1')
      expect(result.processed).toBe(1)
      expect(result.sent).toBe(0)

      vi.useRealTimers()
    })
  })

  describe('Queue pause/resume', () => {
    it('stops processing when queue is paused', async () => {
      mockOpsService.getQueuePauseState.mockResolvedValue({
        paused: true, pausedAt: new Date().toISOString(), pausedBy: 'test', resumeAt: null,
      })

      mockQuery()
      mockNext({ rows: [makeJobRow()] })
      mockNext({ rowCount: 1 })

      const result = await processSendQueue('org-1')
      expect(result.processed).toBe(0)
    })
  })

  describe('Dead-letter integration on permanent failure', () => {
    it('moves to dead-letter on permanent failure (5xx)', async () => {
      mockQuery()
      mockNext({ rows: [makeJobRow()] })
      mockNext({ rowCount: 1 })
      mockNext({ rows: [{ c: 2 }] })

      mockMailboxRepo.findMailboxWithConfigs.mockRejectedValue(new Error('550 Mailbox unavailable'))
      mockMailboxRepo.findMailboxById.mockResolvedValue(makeMailbox({ id: 'mb-1' }))

      mockNext({ rows: [{ consecutive_send_failures: 1, email: 'sender@example.com' }] })

      const result = await processSendQueue('org-1')
      expect(result.processed).toBe(1)
      expect(result.failed).toBe(1)
    })

    it('moves to dead-letter on max attempts exceeded', async () => {
      mockQuery()
      mockNext({ rows: [makeJobRow({ attempts: 5, max_attempts: 5 })] })
      mockNext({ rowCount: 1 })
      mockNext({ rows: [{ c: 2 }] })

      mockMailboxRepo.findMailboxWithConfigs.mockRejectedValue(new Error('Connection timeout'))
      mockMailboxRepo.findMailboxById.mockResolvedValue(makeMailbox({ id: 'mb-1' }))

      mockNext({ rows: [{ consecutive_send_failures: 1, email: 'sender@example.com' }] })

      const result = await processSendQueue('org-1')
      expect(result.processed).toBe(1)
      expect(result.failed).toBe(1)
    })
  })
})
