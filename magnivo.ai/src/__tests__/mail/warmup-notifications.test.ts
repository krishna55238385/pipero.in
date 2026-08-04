import * as notificationService from '@/services/mail/warmup-notification-service'
import { vi } from 'vitest'

vi.mock('@/repositories/mail/warmup-repository', () => ({
  insertNotification: vi.fn().mockResolvedValue({ id: 'notif-1' }),
}))

vi.mock('@/services/mail/warmup-metrics-service', () => ({
  recordAuditLog: vi.fn(),
}))

describe('warmup-notification-service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('sendNotification', () => {
    it('sends a notification', async () => {
      const { insertNotification } = await import('@/repositories/mail/warmup-repository')
      vi.mocked(insertNotification).mockResolvedValue({ id: 'notif-1' } as never)

      await notificationService.sendNotification({
        configId: 'cfg-1',
        organizationId: 'org-1',
        eventType: 'warmup_completed',
        title: 'Test',
        message: 'Test message',
        severity: 'info',
      })

      expect(insertNotification).toHaveBeenCalledWith(expect.objectContaining({
        configId: 'cfg-1',
        severity: 'info',
      }))
    })
  })

  describe('notifyWarmupCompleted', () => {
    it('sends completion notification', async () => {
      const { insertNotification } = await import('@/repositories/mail/warmup-repository')
      vi.mocked(insertNotification).mockResolvedValue({ id: 'notif-1' } as never)

      await notificationService.notifyWarmupCompleted('cfg-1', 'org-1', {
        totalSends: 100,
        successRate: 95,
      })

      expect(insertNotification).toHaveBeenCalled()
    })
  })

  describe('notifyWarmupGraduated', () => {
    it('sends graduation notification', async () => {
      const { insertNotification } = await import('@/repositories/mail/warmup-repository')
      vi.mocked(insertNotification).mockResolvedValue({ id: 'notif-1' } as never)

      await notificationService.notifyWarmupGraduated('cfg-1', 'org-1', 85)

      expect(insertNotification).toHaveBeenCalled()
    })
  })

  describe('notifyWarmupPaused', () => {
    it('sends pause notification', async () => {
      const { insertNotification } = await import('@/repositories/mail/warmup-repository')
      vi.mocked(insertNotification).mockResolvedValue({ id: 'notif-1' } as never)

      await notificationService.notifyWarmupPaused('cfg-1', 'org-1', 'Health critical')

      expect(insertNotification).toHaveBeenCalled()
    })
  })

  describe('notifyHealthDegraded', () => {
    it('sends health warning notification', async () => {
      const { insertNotification } = await import('@/repositories/mail/warmup-repository')
      vi.mocked(insertNotification).mockResolvedValue({ id: 'notif-1' } as never)

      await notificationService.notifyHealthDegraded('cfg-1', 'org-1', 'warning', 45)

      expect(insertNotification).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'warning' })
      )
    })

    it('sends critical notification for very low scores', async () => {
      const { insertNotification } = await import('@/repositories/mail/warmup-repository')
      vi.mocked(insertNotification).mockResolvedValue({ id: 'notif-1' } as never)

      await notificationService.notifyHealthDegraded('cfg-1', 'org-1', 'critical', 20)

      expect(insertNotification).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'critical' })
      )
    })
  })

  describe('notifyOAuthExpired', () => {
    it('sends oauth expired notification', async () => {
      const { insertNotification } = await import('@/repositories/mail/warmup-repository')
      vi.mocked(insertNotification).mockResolvedValue({ id: 'notif-1' } as never)

      await notificationService.notifyOAuthExpired('cfg-1', 'org-1')

      expect(insertNotification).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'critical' })
      )
    })
  })

  describe('notifyDnsFailure', () => {
    it('sends dns failure notification', async () => {
      const { insertNotification } = await import('@/repositories/mail/warmup-repository')
      vi.mocked(insertNotification).mockResolvedValue({ id: 'notif-1' } as never)

      await notificationService.notifyDnsFailure('cfg-1', 'org-1')

      expect(insertNotification).toHaveBeenCalled()
    })
  })

  describe('notifyExecutionFailed', () => {
    it('sends execution failed notification', async () => {
      const { insertNotification } = await import('@/repositories/mail/warmup-repository')
      vi.mocked(insertNotification).mockResolvedValue({ id: 'notif-1' } as never)

      await notificationService.notifyExecutionFailed('cfg-1', 'org-1', 'SMTP error')

      expect(insertNotification).toHaveBeenCalled()
    })
  })

  describe('notifyMailboxDisconnected', () => {
    it('sends mailbox disconnected notification', async () => {
      const { insertNotification } = await import('@/repositories/mail/warmup-repository')
      vi.mocked(insertNotification).mockResolvedValue({ id: 'notif-1' } as never)

      await notificationService.notifyMailboxDisconnected('cfg-1', 'org-1')

      expect(insertNotification).toHaveBeenCalled()
    })
  })

  describe('recordAuditForAction', () => {
    it('records audit', async () => {
      const { recordAuditLog } = await import('@/services/mail/warmup-metrics-service')
      vi.mocked(recordAuditLog).mockResolvedValue(undefined)

      await notificationService.recordAuditForAction({
        organizationId: 'org-1',
        action: 'scheduler_started',
        message: 'Test',
      })

      expect(recordAuditLog).toHaveBeenCalled()
    })
  })
})
