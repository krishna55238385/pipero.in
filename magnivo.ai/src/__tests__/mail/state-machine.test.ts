import { describe, it, expect } from 'vitest'
import {
  canTransition,
  getTargetStatusForAction,
  getStatusLabel,
  isSendable,
  needsAttention,
  isHidden,
} from '@/lib/mailbox-state-machine'
import type { MailboxStatus, MailboxAuditAction } from '@/types/mail'

describe('mailbox-state-machine', () => {
  describe('canTransition', () => {
    it('allows same-status transition (no-op)', () => {
      const result = canTransition('connected', 'connected')
      expect(result.valid).toBe(true)
      expect(result.from).toBe('connected')
      expect(result.to).toBe('connected')
    })

    it('allows valid transition: connected → disabled', () => {
      const result = canTransition('connected', 'disabled')
      expect(result.valid).toBe(true)
    })

    it('allows valid transition: connected → archived', () => {
      const result = canTransition('connected', 'archived')
      expect(result.valid).toBe(true)
    })

    it('allows valid transition: archived → connected (restore)', () => {
      const result = canTransition('archived', 'connected')
      expect(result.valid).toBe(true)
    })

    it('rejects invalid transition: deleted → connected', () => {
      const result = canTransition('deleted', 'connected')
      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.reason).toContain('Cannot transition')
      }
    })

    it('rejects invalid transition: connected → deleted via archived', () => {
      // connected → archived is valid, but connected → deleted is also valid
      const result = canTransition('connected', 'deleted')
      expect(result.valid).toBe(true)
    })

    it('rejects invalid transition: error → warming', () => {
      const result = canTransition('error', 'warming')
      expect(result.valid).toBe(false)
    })

    it('allows oauth_expired → reconnect_required', () => {
      const result = canTransition('oauth_expired', 'reconnect_required')
      expect(result.valid).toBe(true)
    })

    it('allows smtp_failed → connected', () => {
      const result = canTransition('smtp_failed', 'connected')
      expect(result.valid).toBe(true)
    })

    it('allows imap_failed → testing', () => {
      const result = canTransition('imap_failed', 'testing')
      expect(result.valid).toBe(true)
    })

    it('allows verification_failed → disabled', () => {
      const result = canTransition('verification_failed', 'disabled')
      expect(result.valid).toBe(true)
    })

    it('allows testing → connected', () => {
      const result = canTransition('testing', 'connected')
      expect(result.valid).toBe(true)
    })

    it('allows pending → connected', () => {
      const result = canTransition('pending', 'connected')
      expect(result.valid).toBe(true)
    })

    it('allows warming → connected', () => {
      const result = canTransition('warming', 'connected')
      expect(result.valid).toBe(true)
    })

    it('allows disconnected → reconnect_required', () => {
      const result = canTransition('disconnected', 'reconnect_required')
      expect(result.valid).toBe(true)
    })

    it('allows suspended → connected', () => {
      const result = canTransition('suspended', 'connected')
      expect(result.valid).toBe(true)
    })
  })

  describe('getTargetStatusForAction', () => {
    it('returns connected for enabled action', () => {
      expect(getTargetStatusForAction('enabled', 'disabled')).toBe('connected')
    })

    it('returns disabled for disabled action', () => {
      expect(getTargetStatusForAction('disabled', 'connected')).toBe('disabled')
    })

    it('returns archived for archived action', () => {
      expect(getTargetStatusForAction('archived', 'connected')).toBe('archived')
    })

    it('returns connected for restored action', () => {
      expect(getTargetStatusForAction('restored', 'archived')).toBe('connected')
    })

    it('returns deleted for soft_deleted action', () => {
      expect(getTargetStatusForAction('soft_deleted', 'connected')).toBe('deleted')
    })

    it('returns reconnect_required for reconnect_attempted action', () => {
      expect(getTargetStatusForAction('reconnect_attempted', 'error')).toBe('reconnect_required')
    })

    it('returns connected for verified action when current is connected', () => {
      expect(getTargetStatusForAction('verified', 'connected')).toBe('connected')
    })

    it('returns testing for verified action when current is not connected', () => {
      expect(getTargetStatusForAction('verified', 'disconnected')).toBe('testing')
    })

    it('returns verification_failed for verification_failed action', () => {
      expect(getTargetStatusForAction('verification_failed', 'connected')).toBe('verification_failed')
    })

    it('returns null for unknown action', () => {
      expect(getTargetStatusForAction('created' as MailboxAuditAction, 'connected')).toBe(null)
    })
  })

  describe('getStatusLabel', () => {
    it('returns correct labels for all statuses', () => {
      expect(getStatusLabel('connected')).toBe('Connected')
      expect(getStatusLabel('disconnected')).toBe('Disconnected')
      expect(getStatusLabel('warming')).toBe('Warming')
      expect(getStatusLabel('error')).toBe('Error')
      expect(getStatusLabel('suspended')).toBe('Suspended')
      expect(getStatusLabel('pending')).toBe('Pending')
      expect(getStatusLabel('testing')).toBe('Testing')
      expect(getStatusLabel('disabled')).toBe('Disabled')
      expect(getStatusLabel('archived')).toBe('Archived')
      expect(getStatusLabel('deleted')).toBe('Deleted')
      expect(getStatusLabel('reconnect_required')).toBe('Reconnect Required')
      expect(getStatusLabel('oauth_expired')).toBe('OAuth Expired')
      expect(getStatusLabel('smtp_failed')).toBe('SMTP Failed')
      expect(getStatusLabel('imap_failed')).toBe('IMAP Failed')
      expect(getStatusLabel('verification_failed')).toBe('Verification Failed')
    })
  })

  describe('isSendable', () => {
    it('returns true for connected', () => {
      expect(isSendable('connected')).toBe(true)
    })

    it('returns false for warming (warmup-only; live campaigns require connected)', () => {
      expect(isSendable('warming')).toBe(false)
    })

    it('returns false for disconnected', () => {
      expect(isSendable('disconnected')).toBe(false)
    })

    it('returns false for archived', () => {
      expect(isSendable('archived')).toBe(false)
    })

    it('returns false for deleted', () => {
      expect(isSendable('deleted')).toBe(false)
    })
  })

  describe('needsAttention', () => {
    it('returns true for error', () => {
      expect(needsAttention('error')).toBe(true)
    })

    it('returns true for reconnect_required', () => {
      expect(needsAttention('reconnect_required')).toBe(true)
    })

    it('returns true for oauth_expired', () => {
      expect(needsAttention('oauth_expired')).toBe(true)
    })

    it('returns true for smtp_failed', () => {
      expect(needsAttention('smtp_failed')).toBe(true)
    })

    it('returns true for imap_failed', () => {
      expect(needsAttention('imap_failed')).toBe(true)
    })

    it('returns true for verification_failed', () => {
      expect(needsAttention('verification_failed')).toBe(true)
    })

    it('returns false for connected', () => {
      expect(needsAttention('connected')).toBe(false)
    })

    it('returns false for disabled', () => {
      expect(needsAttention('disabled')).toBe(false)
    })
  })

  describe('isHidden', () => {
    it('returns true for archived', () => {
      expect(isHidden('archived')).toBe(true)
    })

    it('returns true for deleted', () => {
      expect(isHidden('deleted')).toBe(true)
    })

    it('returns false for connected', () => {
      expect(isHidden('connected')).toBe(false)
    })

    it('returns false for disabled', () => {
      expect(isHidden('disabled')).toBe(false)
    })
  })
})
