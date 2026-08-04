import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPool = vi.hoisted(() => ({
  query: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  default: mockPool,
}))

vi.mock('@/lib/encryption', () => ({
  decrypt: vi.fn().mockReturnValue('decrypted-token'),
}))

const mockIngestInboundMessage = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('@/services/mail/inbox-service', () => ({
  ingestInboundMessage: mockIngestInboundMessage,
}))

const originalFetch = globalThis.fetch

import {
  subscribeToGraphNotifications,
  renewGraphSubscription,
  processGraphNotification,
  deleteGraphSubscription,
  renewAllExpiringSubscriptions,
} from '@/services/mail/graph-webhook-service'

describe('graph-webhook-service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    globalThis.fetch = originalFetch
    process.env.APP_URL = 'https://app.magnivo.ai'
  })

  describe('subscribeToGraphNotifications', () => {
    it('creates subscription when none exists', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rowCount: 1 })

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          id: 'sub-1',
          expirationDateTime: '2026-07-23T12:00:00Z',
          clientState: 'client-state-123',
        }),
      })

      const result = await subscribeToGraphNotifications('org-1', 'mb-1', 'access-token', 'user@example.com')

      expect(result.success).toBe(true)
      expect(result.data?.subscriptionId).toBe('sub-1')
    })

    it('returns existing subscription when already subscribed', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          id: 1,
          organization_id: 'org-1',
          mailbox_id: 'mb-1',
          email: 'user@example.com',
          subscription_id: 'existing-sub',
          client_state: 'cs',
          resource: 'users/...',
          expiration_date_time: '2026-07-23T12:00:00Z',
          status: 'active',
          last_notification_at: null,
          last_error: null,
          created_at: '2026-07-22T12:00:00Z',
          updated_at: '2026-07-22T12:00:00Z',
        }],
      })

      const result = await subscribeToGraphNotifications('org-1', 'mb-1', 'access-token', 'user@example.com')
      expect(result.success).toBe(true)
      expect(result.data?.subscriptionId).toBe('existing-sub')
    })

    it('returns error when APP_URL not configured', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] })
      delete process.env.APP_URL
      delete process.env.NEXT_PUBLIC_APP_URL

      const result = await subscribeToGraphNotifications('org-1', 'mb-1', 'token', 'user@example.com')
      expect(result.success).toBe(false)
      expect(result.error).toContain('APP_URL')
    })
  })

  describe('renewGraphSubscription', () => {
    it('renews expiring subscription', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          expirationDateTime: '2026-07-24T12:00:00Z',
        }),
      })
      mockPool.query.mockResolvedValueOnce({ rowCount: 1 })

      const result = await renewGraphSubscription('sub-1', 'access-token')
      expect(result.success).toBe(true)
      expect(result.data?.expirationDateTime).toBeTruthy()
    })

    it('returns error on API failure', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: vi.fn().mockResolvedValue({ error: 'Forbidden' }),
      })

      const result = await renewGraphSubscription('sub-1', 'access-token')
      expect(result.success).toBe(false)
    })
  })

  describe('processGraphNotification', () => {
    it('returns validation token when present', async () => {
      const result = await processGraphNotification('validation-token-123')
      expect(result).toEqual({ validationToken: 'validation-token-123' })
    })

    it('returns ok for empty notifications', async () => {
      const result = await processGraphNotification(undefined, [])
      expect(result).toEqual({ ok: true })
    })

    it('processes valid notifications', async () => {
      const subRow = {
        id: 'sub-db-1',
        organization_id: 'org-1',
        mailbox_id: 'mb-1',
        email: 'user@example.com',
        subscription_id: 'sub-1',
        client_state: 'client-state-123',
        resource: 'users/user@example.com/mailFolders/Inbox/messages',
        status: 'active',
      }

      mockPool.query
        .mockResolvedValueOnce({ rows: [subRow] })
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({
          rows: [{ encrypted_access_token: 'encrypted' }],
        })

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          id: 'msg-1',
          subject: 'Hello',
          body: { contentType: 'text', content: 'World' },
          from: { emailAddress: { address: 'sender@example.com' } },
          toRecipients: [{ emailAddress: { address: 'user@example.com' } }],
          conversationId: 'conv-1',
        }),
      })

      const result = await processGraphNotification(undefined, [
        {
          subscriptionId: 'sub-1',
          clientState: 'client-state-123',
          resource: 'users/user@example.com/mailFolders/Inbox/messages/msg-1',
        },
      ])

      expect(result).toEqual({ ok: true })
      expect(mockIngestInboundMessage).toHaveBeenCalled()
    })

    it('skips unknown subscriptions', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] })
      const result = await processGraphNotification(undefined, [
        { subscriptionId: 'unknown', clientState: 'cs', resource: 'r' },
      ])
      expect(result).toEqual({ ok: true })
    })

    it('skips notifications with clientState mismatch', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          id: 'sub-db-1',
          organization_id: 'org-1',
          subscription_id: 'sub-1',
          client_state: 'expected-state',
          resource: 'r',
          status: 'active',
        }],
      })

      const result = await processGraphNotification(undefined, [
        { subscriptionId: 'sub-1', clientState: 'wrong-state', resource: 'r' },
      ])
      expect(result).toEqual({ ok: true })
    })
  })

  describe('deleteGraphSubscription', () => {
    it('deletes subscription and marks revoked', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: vi.fn().mockResolvedValue(null),
      })
      mockPool.query.mockResolvedValueOnce({ rowCount: 1 })

      const result = await deleteGraphSubscription('sub-1', 'access-token')
      expect(result.success).toBe(true)
      expect(result.data).toBe(true)
    })

    it('handles 404 as success (already gone)', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: vi.fn().mockResolvedValue({ error: 'Subscription not found' }),
      })
      mockPool.query.mockResolvedValueOnce({ rowCount: 1 })

      const result = await deleteGraphSubscription('sub-1', 'token')
      expect(result.success).toBe(true)
    })
  })

  describe('renewAllExpiringSubscriptions', () => {
    it('renews due subscriptions', async () => {
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{
            id: 'sub-db-1',
            organization_id: 'org-1',
            mailbox_id: 'mb-1',
            email: 'user@example.com',
            subscription_id: 'sub-1',
            client_state: 'cs',
            resource: 'r',
            status: 'active',
            expiration_date_time: '2026-07-22T12:00:00Z',
          }],
        })
        .mockResolvedValueOnce({
          rows: [{ encrypted_access_token: 'encrypted', encrypted_refresh_token: null, provider_account_id: 'acc-1' }],
        })

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ id: 'sub-1' }),
      })

      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ id: 'sub-1' }),
      }).mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ expirationDateTime: '2026-07-24T12:00:00Z' }),
      })
      mockPool.query.mockResolvedValueOnce({ rowCount: 1 })

      const result = await renewAllExpiringSubscriptions()
      expect(result.renewed).toBeGreaterThanOrEqual(0)
      expect(result.failed).toBeGreaterThanOrEqual(0)
    })

    it('handles no expiring subscriptions', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] })
      const result = await renewAllExpiringSubscriptions()
      expect(result.renewed).toBe(0)
      expect(result.failed).toBe(0)
    })
  })
})
