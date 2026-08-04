import { describe, it, expect } from 'vitest'
import {
  getMailErrorMessage,
  hasMailPermission,
  canPerformBulkAction,
  canPerformAdminAction,
  MAIL_ERROR_MESSAGES,
} from '@/types/mail'
import type { MailUserPermissions, MailErrorCode } from '@/types/mail'

describe('mail error messages', () => {
  it('returns original error when no pattern matches', () => {
    expect(getMailErrorMessage('something unexpected')).toBe('something unexpected')
  })

  it('maps "not found" to MAILBOX_NOT_FOUND', () => {
    expect(getMailErrorMessage('Mailbox not found')).toBe(MAIL_ERROR_MESSAGES.MAILBOX_NOT_FOUND)
  })

  it('maps "already disabled"', () => {
    expect(getMailErrorMessage('Mailbox already disabled')).toBe(MAIL_ERROR_MESSAGES.MAILBOX_ALREADY_DISABLED)
  })

  it('maps "already archived"', () => {
    expect(getMailErrorMessage('Mailbox already archived')).toBe(MAIL_ERROR_MESSAGES.MAILBOX_ALREADY_ARCHIVED)
  })

  it('maps "already deleted"', () => {
    expect(getMailErrorMessage('Mailbox already deleted')).toBe(MAIL_ERROR_MESSAGES.MAILBOX_ALREADY_DELETED)
  })

  it('maps "not archived"', () => {
    expect(getMailErrorMessage('Mailbox not archived')).toBe(MAIL_ERROR_MESSAGES.MAILBOX_NOT_ARCHIVED)
  })

  it('maps oauth expired', () => {
    expect(getMailErrorMessage('OAuth token expired')).toBe(MAIL_ERROR_MESSAGES.OAUTH_EXPIRED)
  })

  it('maps smtp auth failed', () => {
    expect(getMailErrorMessage('SMTP authentication failed')).toBe(MAIL_ERROR_MESSAGES.SMTP_AUTH_FAILED)
  })

  it('maps imap unavailable', () => {
    expect(getMailErrorMessage('IMAP server is unavailable')).toBe(MAIL_ERROR_MESSAGES.IMAP_UNAVAILABLE)
  })

  it('maps workspace mismatch', () => {
    expect(getMailErrorMessage('Workspace mismatch')).toBe(MAIL_ERROR_MESSAGES.WORKSPACE_MISMATCH)
  })

  it('maps permission denied', () => {
    expect(getMailErrorMessage('Permission denied')).toBe(MAIL_ERROR_MESSAGES.PERMISSION_DENIED)
  })

  it('maps timeout', () => {
    expect(getMailErrorMessage('Connection timeout')).toBe(MAIL_ERROR_MESSAGES.NETWORK_TIMEOUT)
  })

  it('maps database error', () => {
    expect(getMailErrorMessage('Database failure occurred')).toBe(MAIL_ERROR_MESSAGES.DATABASE_FAILURE)
  })

  it('maps transition error', () => {
    expect(getMailErrorMessage('Invalid transition')).toBe(MAIL_ERROR_MESSAGES.INVALID_TRANSITION)
  })

  it('maps validation error', () => {
    expect(getMailErrorMessage('Validation failed')).toBe(MAIL_ERROR_MESSAGES.VALIDATION_FAILED)
  })

  it('maps pool not found', () => {
    expect(getMailErrorMessage('Pool not found')).toBe(MAIL_ERROR_MESSAGES.POOL_NOT_FOUND)
  })

  it('maps config not found', () => {
    expect(getMailErrorMessage('Config not found')).toBe(MAIL_ERROR_MESSAGES.CONFIG_NOT_FOUND)
  })

  it('maps duplicate mailbox', () => {
    expect(getMailErrorMessage('Duplicate mailbox already exists')).toBe(MAIL_ERROR_MESSAGES.DUPLICATE_MAILBOX)
  })

  it('maps no config found', () => {
    expect(getMailErrorMessage('No OAuth configuration')).toBe(MAIL_ERROR_MESSAGES.NO_CONFIG_FOUND)
  })

  it('provides messages for all error codes', () => {
    const codes: MailErrorCode[] = [
      'MAILBOX_NOT_FOUND', 'MAILBOX_ALREADY_DISABLED', 'MAILBOX_ALREADY_ARCHIVED',
      'MAILBOX_ALREADY_DELETED', 'MAILBOX_NOT_ARCHIVED', 'OAUTH_EXPIRED',
      'SMTP_AUTH_FAILED', 'IMAP_UNAVAILABLE', 'WORKSPACE_MISMATCH',
      'PERMISSION_DENIED', 'NETWORK_TIMEOUT', 'DATABASE_FAILURE',
      'INVALID_TRANSITION', 'VALIDATION_FAILED', 'POOL_NOT_FOUND',
      'CONFIG_NOT_FOUND', 'DUPLICATE_MAILBOX', 'NO_CONFIG_FOUND',
    ]
    for (const code of codes) {
      expect(MAIL_ERROR_MESSAGES[code]).toBeTruthy()
      expect(typeof MAIL_ERROR_MESSAGES[code]).toBe('string')
    }
  })
})

describe('mail permissions', () => {
  const fullPermissions: MailUserPermissions = {
    canRead: true,
    canWrite: true,
    canManage: true,
    canAdmin: true,
  }

  const readOnlyPermissions: MailUserPermissions = {
    canRead: true,
    canWrite: false,
    canManage: false,
    canAdmin: false,
  }

  const writePermissions: MailUserPermissions = {
    canRead: true,
    canWrite: true,
    canManage: false,
    canAdmin: false,
  }

  it('grants all permissions with full access', () => {
    expect(hasMailPermission(fullPermissions, 'mail.read')).toBe(true)
    expect(hasMailPermission(fullPermissions, 'mail.write')).toBe(true)
    expect(hasMailPermission(fullPermissions, 'mail.manage')).toBe(true)
    expect(hasMailPermission(fullPermissions, 'mail.admin')).toBe(true)
  })

  it('restricts read-only users', () => {
    expect(hasMailPermission(readOnlyPermissions, 'mail.read')).toBe(true)
    expect(hasMailPermission(readOnlyPermissions, 'mail.write')).toBe(false)
    expect(hasMailPermission(readOnlyPermissions, 'mail.manage')).toBe(false)
    expect(hasMailPermission(readOnlyPermissions, 'mail.admin')).toBe(false)
  })

  it('restricts write-only users', () => {
    expect(hasMailPermission(writePermissions, 'mail.read')).toBe(true)
    expect(hasMailPermission(writePermissions, 'mail.write')).toBe(true)
    expect(hasMailPermission(writePermissions, 'mail.manage')).toBe(false)
    expect(hasMailPermission(writePermissions, 'mail.admin')).toBe(false)
  })

  it('denies all when permissions is null', () => {
    expect(hasMailPermission(null, 'mail.read')).toBe(false)
    expect(hasMailPermission(null, 'mail.write')).toBe(false)
    expect(hasMailPermission(null, 'mail.manage')).toBe(false)
    expect(hasMailPermission(null, 'mail.admin')).toBe(false)
  })

  it('canPerformBulkAction requires mail.manage', () => {
    expect(canPerformBulkAction(fullPermissions)).toBe(true)
    expect(canPerformBulkAction(readOnlyPermissions)).toBe(false)
    expect(canPerformBulkAction(writePermissions)).toBe(false)
    expect(canPerformBulkAction(null)).toBe(false)
  })

  it('canPerformAdminAction requires mail.admin', () => {
    expect(canPerformAdminAction(fullPermissions)).toBe(true)
    expect(canPerformAdminAction(readOnlyPermissions)).toBe(false)
    expect(canPerformAdminAction(writePermissions)).toBe(false)
    expect(canPerformAdminAction(null)).toBe(false)
  })
})
