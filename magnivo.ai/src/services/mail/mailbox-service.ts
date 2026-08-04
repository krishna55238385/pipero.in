import type {
  Mailbox,
  MailboxPool,
  CreateMailboxRequest,
  UpdateMailboxRequest,
  CreateMailboxPoolRequest,
  UpdateMailboxPoolRequest,
  MailboxPoolResponse,
  MailApiResult,
  OAuthConfig,
  SMTPConfig,
  IMAPConfig,
  CreateOAuthConfigRequest,
  CreateSMTPConfigRequest,
  CreateIMAPConfigRequest,
  OAuthConfigResponse,
  SMTPConfigResponse,
  IMAPConfigResponse,
  SMTPEncryption,
  SMTPAuthenticationType,
  WizardSMTPValues,
  WizardIMAPValues,
  MailboxStatus,
  MailboxProvider,
  MailboxHealth,
  WarmupStatus,
  MailboxActionResult,
  MailboxVerificationResult,
  MailboxReconnectResult,
  MailboxAuditAction,
} from '@/types/mail'
import {
  validateCreateMailboxRequest,
  validateUpdateMailboxRequest,
  validateCreateMailboxPoolRequest,
  validateUpdateMailboxPoolRequest,
  validateCreateOAuthConfigRequest,
  validateCreateSMTPConfigRequest,
  validateCreateIMAPConfigRequest,
  validateOAuthProvider,
} from '@/lib/mail-validation'
import { encrypt, encryptAsync } from '@/lib/encryption'
import pool from '@/lib/db'
import * as mailboxRepo from '@/repositories/mail/mailbox-repository'
import * as poolRepo from '@/repositories/mail/mailbox-pool-repository'
import * as oauthRepo from '@/repositories/mail/oauth-config-repository'
import * as smtpRepo from '@/repositories/mail/smtp-config-repository'
import * as imapRepo from '@/repositories/mail/imap-config-repository'
import * as auditRepo from '@/repositories/mail/mailbox-audit-repository'
import { canTransition } from '@/lib/mailbox-state-machine'
import { decrypt } from '@/lib/encryption'
import { getOAuthService } from './oauth'

// ============================================================
// Mailbox Service
// ============================================================

export async function listMailboxes(orgId: string): Promise<Mailbox[]> {
  return mailboxRepo.findMailboxesByOrg(orgId)
}

export async function getMailbox(id: string, orgId: string): Promise<Mailbox | null> {
  return mailboxRepo.findMailboxById(id, orgId)
}

export async function createMailbox(
  orgId: string,
  input: CreateMailboxRequest
): Promise<MailApiResult<Mailbox>> {
  const validation = validateCreateMailboxRequest(input)
  if (!validation.valid) {
    return { success: false, error: validation.errors.join('; ') }
  }

  const exists = await mailboxRepo.checkDuplicateMailbox(input.email, orgId)
  if (exists) {
    return { success: false, error: 'A mailbox with this email already exists in this workspace' }
  }

  const { assertCanAddMailbox } = await import('./plan-limits-service')
  const limitCheck = await assertCanAddMailbox(orgId)
  if (!limitCheck.success) {
    return { success: false, error: limitCheck.error || 'Mailbox plan limit reached' }
  }

  try {
    const mailbox = await mailboxRepo.insertMailbox(orgId, {
      email: input.email.trim().toLowerCase(),
      displayName: input.displayName ?? '',
      senderName: input.senderName ?? '',
      provider: input.provider,
      authType: input.authType,
      timezone: input.timezone ?? 'UTC',
      dailyLimit: input.dailyLimit ?? 50,
      poolId: input.poolId ?? null,
      providerAccountId: input.providerAccountId ?? null,
      metadata: input.metadata ?? {},
    })
    return { success: true, data: mailbox }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create mailbox'
    console.error('[mail-service] createMailbox:', message)
    return { success: false, error: message }
  }
}

export async function updateMailbox(
  id: string,
  orgId: string,
  input: UpdateMailboxRequest
): Promise<MailApiResult<Mailbox>> {
  const existing = await mailboxRepo.findMailboxById(id, orgId)
  if (!existing) {
    return { success: false, error: 'Mailbox not found' }
  }

  const validation = validateUpdateMailboxRequest({ ...input, provider: existing.provider })
  if (!validation.valid) {
    return { success: false, error: validation.errors.join('; ') }
  }

  if (input.dailyLimit !== undefined) {
    const { getProviderDailyCap } = await import('@/lib/mail-validation')
    const cap = getProviderDailyCap(existing.provider)
    if (input.dailyLimit > cap) {
      return {
        success: false,
        error: `Daily limit cannot exceed ${cap} for ${existing.provider} (provider maximum)`,
      }
    }
  }

  try {
    const updated = await mailboxRepo.updateMailbox(id, orgId, {
      displayName: input.displayName,
      senderName: input.senderName,
      timezone: input.timezone,
      dailyLimit: input.dailyLimit,
      poolId: input.poolId,
      metadata: input.metadata,
    })
    if (!updated) {
      return { success: false, error: 'Failed to update mailbox' }
    }
    return { success: true, data: updated }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update mailbox'
    console.error('[mail-service] updateMailbox:', message)
    return { success: false, error: message }
  }
}

export async function deleteMailbox(
  id: string,
  orgId: string
): Promise<MailApiResult<boolean>> {
  const existing = await mailboxRepo.findMailboxById(id, orgId)
  if (!existing) {
    return { success: false, error: 'Mailbox not found' }
  }

  try {
    const { cancelWarmupForMailbox } = await import('./warmup-service')
    await cancelWarmupForMailbox(id, orgId, 'mailbox_deleted')
    const deleted = await mailboxRepo.deleteMailbox(id, orgId)
    return { success: true, data: deleted }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete mailbox'
    console.error('[mail-service] deleteMailbox:', message)
    return { success: false, error: message }
  }
}

export async function countMailboxes(orgId: string): Promise<number> {
  return mailboxRepo.countMailboxesByOrg(orgId)
}

// ============================================================
// Dashboard Service
// ============================================================

export type PaginatedMailboxesResult = {
  mailboxes: mailboxRepo.PaginatedMailboxRow[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export async function listMailboxesPaginated(input: {
  orgId: string
  search?: string
  status?: string
  provider?: string
  health?: string
  poolId?: string
  warmupStatus?: string
  sortBy?: string
  sortDirection?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}): Promise<PaginatedMailboxesResult> {
  const page = Math.max(1, input.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 25))
  const offset = (page - 1) * pageSize

  const [mailboxes, total] = await Promise.all([
    mailboxRepo.findMailboxesPaginated({
      orgId: input.orgId,
      search: input.search,
      status: input.status as MailboxStatus | 'all',
      provider: input.provider as MailboxProvider | 'all',
      health: input.health as MailboxHealth | 'all',
      poolId: input.poolId,
      warmupStatus: input.warmupStatus as WarmupStatus | 'all',
      sortBy: input.sortBy,
      sortDirection: input.sortDirection,
      offset,
      limit: pageSize,
    }),
    mailboxRepo.countMailboxesFiltered({
      orgId: input.orgId,
      search: input.search,
      status: input.status as MailboxStatus | 'all',
      provider: input.provider as MailboxProvider | 'all',
      health: input.health as MailboxHealth | 'all',
      poolId: input.poolId,
      warmupStatus: input.warmupStatus as WarmupStatus | 'all',
    }),
  ])

  return {
    mailboxes,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  }
}

export async function getDashboardStats(orgId: string) {
  const row = await mailboxRepo.getDashboardStats(orgId)
  return {
    total: row.total,
    connected: row.connected,
    needsAttention: row.needs_attention,
    oauthExpired: row.oauth_expired,
    smtpErrors: row.smtp_errors,
    dailyCapacity: row.daily_capacity,
  }
}

export async function bulkUpdateMailboxStatus(
  ids: string[],
  orgId: string,
  status: string
): Promise<MailApiResult<number>> {
  try {
    const count = await mailboxRepo.updateMailboxesStatus(ids, orgId, status as MailboxStatus)
    return { success: true, data: count }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update mailboxes'
    console.error('[mail-service] bulkUpdateMailboxStatus:', message)
    return { success: false, error: message }
  }
}

export async function bulkAssignPool(
  ids: string[],
  poolId: string | null,
  orgId: string
): Promise<MailApiResult<number>> {
  try {
    const count = await mailboxRepo.assignMailboxesToPool(ids, poolId, orgId)
    return { success: true, data: count }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to assign pool'
    console.error('[mail-service] bulkAssignPool:', message)
    return { success: false, error: message }
  }
}

export async function bulkArchiveMailboxes(
  ids: string[],
  orgId: string
): Promise<MailApiResult<number>> {
  try {
    const count = await mailboxRepo.archiveMailboxes(ids, orgId)
    return { success: true, data: count }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to archive mailboxes'
    console.error('[mail-service] bulkArchiveMailboxes:', message)
    return { success: false, error: message }
  }
}

export async function bulkDeleteMailboxes(
  ids: string[],
  orgId: string
): Promise<MailApiResult<number>> {
  try {
    const count = await mailboxRepo.softDeleteMailboxes(ids, orgId)
    return { success: true, data: count }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete mailboxes'
    console.error('[mail-service] bulkDeleteMailboxes:', message)
    return { success: false, error: message }
  }
}

// ============================================================
// Mailbox Lifecycle Service
// ============================================================

type ActorInfo = {
  userId: string
  email: string
}

async function logAuditAndTransition(
  orgId: string,
  mailboxId: string,
  actor: ActorInfo,
  action: MailboxAuditAction,
  targetStatus: MailboxStatus,
  extra?: { archivedAt?: string }
): Promise<MailboxActionResult> {
  const mailbox = await mailboxRepo.findMailboxById(mailboxId, orgId)
  if (!mailbox) {
    return { mailboxId, success: false, previousStatus: null, newStatus: null, error: 'Mailbox not found' }
  }

  const transition = canTransition(mailbox.mailboxStatus, targetStatus)
  if (!transition.valid) {
    return { mailboxId, success: false, previousStatus: mailbox.mailboxStatus, newStatus: null, error: transition.reason }
  }

  const { previousStatus, updated } = await mailboxRepo.transitionMailboxStatus(mailboxId, orgId, targetStatus, extra)

  if (updated) {
    await auditRepo.insertAuditEvent({
      organizationId: orgId,
      mailboxId,
      actorUserId: actor.userId,
      actorEmail: actor.email,
      action,
      previousStatus,
      newStatus: targetStatus,
    })
  }

  return { mailboxId, success: updated, previousStatus, newStatus: updated ? targetStatus : previousStatus }
}

export async function enableMailbox(
  id: string,
  orgId: string,
  actor: ActorInfo
): Promise<MailApiResult<MailboxActionResult>> {
  try {
    const result = await logAuditAndTransition(orgId, id, actor, 'enabled', 'connected')
    if (!result.success && result.error) {
      return { success: false, error: result.error }
    }
    return { success: true, data: result }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to enable mailbox'
    console.error('[mail-service] enableMailbox:', message)
    return { success: false, error: message }
  }
}

export async function disableMailbox(
  id: string,
  orgId: string,
  actor: ActorInfo
): Promise<MailApiResult<MailboxActionResult>> {
  try {
    const { cancelWarmupForMailbox } = await import('./warmup-service')
    await cancelWarmupForMailbox(id, orgId, 'mailbox_disabled')
    const result = await logAuditAndTransition(orgId, id, actor, 'disabled', 'disabled')
    if (!result.success && result.error) {
      return { success: false, error: result.error }
    }
    return { success: true, data: result }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to disable mailbox'
    console.error('[mail-service] disableMailbox:', message)
    return { success: false, error: message }
  }
}

export async function archiveMailbox(
  id: string,
  orgId: string,
  actor: ActorInfo
): Promise<MailApiResult<MailboxActionResult>> {
  try {
    const result = await logAuditAndTransition(orgId, id, actor, 'archived', 'archived', { archivedAt: new Date().toISOString() })
    if (!result.success && result.error) {
      return { success: false, error: result.error }
    }
    return { success: true, data: result }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to archive mailbox'
    console.error('[mail-service] archiveMailbox:', message)
    return { success: false, error: message }
  }
}

export async function restoreMailbox(
  id: string,
  orgId: string,
  actor: ActorInfo
): Promise<MailApiResult<MailboxActionResult>> {
  try {
    const result = await logAuditAndTransition(orgId, id, actor, 'restored', 'connected')
    if (!result.success && result.error) {
      return { success: false, error: result.error }
    }
    return { success: true, data: result }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to restore mailbox'
    console.error('[mail-service] restoreMailbox:', message)
    return { success: false, error: message }
  }
}

export async function softDeleteMailbox(
  id: string,
  orgId: string,
  actor: ActorInfo
): Promise<MailApiResult<MailboxActionResult>> {
  try {
    const { cancelWarmupForMailbox } = await import('./warmup-service')
    await cancelWarmupForMailbox(id, orgId, 'mailbox_disconnected')
    const result = await logAuditAndTransition(orgId, id, actor, 'soft_deleted', 'deleted')
    if (!result.success && result.error) {
      return { success: false, error: result.error }
    }
    return { success: true, data: result }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete mailbox'
    console.error('[mail-service] softDeleteMailbox:', message)
    return { success: false, error: message }
  }
}

// ============================================================
// Verify Connection
// ============================================================

export async function verifyMailboxConnection(
  id: string,
  orgId: string,
  actor: ActorInfo
): Promise<MailApiResult<MailboxVerificationResult>> {
  try {
    const mailbox = await mailboxRepo.findMailboxWithConfigs(id, orgId)
    if (!mailbox) return { success: false, error: 'Mailbox not found' }

    const startTime = Date.now()
    let oauthValid: boolean | null = null
    let smtpValid: boolean | null = null
    let imapValid: boolean | null = null
    let oauthError: string | null = null
    let smtpError: string | null = null
    let imapError: string | null = null

    // Test OAuth if present
    if (mailbox.oauthConfig && mailbox.authType === 'oauth') {
      try {
        if (mailbox.oauthConfig.encryptedRefreshToken) {
          const refreshToken = decrypt(mailbox.oauthConfig.encryptedRefreshToken)
          const service = getOAuthService(mailbox.oauthConfig.provider)
          const tokenResult = await service.refreshToken(refreshToken)
          await oauthRepo.updateOAuthConfig(mailbox.oauthConfig.id, orgId, {
            encryptedAccessToken: encrypt(tokenResult.accessToken),
            encryptedRefreshToken: tokenResult.refreshToken ? encrypt(tokenResult.refreshToken) : null,
            tokenExpiresAt: tokenResult.expiresAt.toISOString(),
          })
          oauthValid = true
        } else {
          oauthError = 'No refresh token available'
          oauthValid = false
        }
      } catch (err) {
        oauthValid = false
        oauthError = err instanceof Error ? err.message : 'OAuth verification failed'
      }
    }

    // Test SMTP if present
    if (mailbox.smtpConfig) {
      try {
        const { testSMTPConnection } = await import('./smtp-validator')
        const password = decrypt(mailbox.smtpConfig.encryptedPasswordReference)
        const result = await testSMTPConnection({
          host: mailbox.smtpConfig.smtpHost,
          port: mailbox.smtpConfig.smtpPort,
          encryption: mailbox.smtpConfig.encryption,
          username: mailbox.smtpConfig.username,
          password,
        })
        smtpValid = result.success
        if (!result.success && result.error) {
          smtpError = result.error.message
        }
        // Update validation status
        await smtpRepo.updateSMTPConfig(mailbox.smtpConfig.id, orgId, {
          validationStatus: result.success ? 'valid' : 'invalid',
        })
      } catch (err) {
        smtpValid = false
        smtpError = err instanceof Error ? err.message : 'SMTP verification failed'
      }
    }

    // Test IMAP if present
    if (mailbox.imapConfig) {
      try {
        const { testIMAPConnection } = await import('./imap-validator')
        const result = await testIMAPConnection({
          host: mailbox.imapConfig.host,
          port: mailbox.imapConfig.port,
          ssl: mailbox.imapConfig.ssl,
          username: mailbox.smtpConfig?.username || mailbox.email,
          password: mailbox.smtpConfig ? decrypt(mailbox.smtpConfig.encryptedPasswordReference) : '',
        })
        imapValid = result.success
        if (!result.success && result.error) {
          imapError = result.error.message
        }
        // Update validation status
        await imapRepo.updateIMAPConfig(mailbox.imapConfig.id, orgId, {
          validationStatus: result.success ? 'valid' : 'invalid',
        })
      } catch (err) {
        imapValid = false
        imapError = err instanceof Error ? err.message : 'IMAP verification failed'
      }
    }

    const durationMs = Date.now() - startTime
    const allValid = [oauthValid, smtpValid, imapValid].every(v => v === null || v === true)
    const anyValid = [oauthValid, smtpValid, imapValid].some(v => v === true)

    const verificationStatus = allValid ? 'verified' : anyValid ? 'failed' : 'failed'
    const verificationResult = allValid ? 'All connections verified successfully' : 'One or more connections failed verification'

    await mailboxRepo.updateMailboxVerificationInfo(id, orgId, {
      verificationStatus,
      lastVerifiedAt: new Date().toISOString(),
      lastVerificationDurationMs: durationMs,
      lastVerificationResult: verificationResult,
    })

    // Determine new mailbox status based on results
    if (allValid) {
      await logAuditAndTransition(orgId, id, actor, 'verified', mailbox.mailboxStatus === 'connected' ? 'connected' : 'connected')
    } else {
      let failStatus: MailboxStatus = 'verification_failed'
      if (smtpValid === false && imapValid !== false) failStatus = 'smtp_failed'
      if (imapValid === false && smtpValid !== false) failStatus = 'imap_failed'
      if (oauthValid === false) failStatus = 'oauth_expired'
      await logAuditAndTransition(orgId, id, actor, 'verification_failed', failStatus)
    }

    return {
      success: true,
      data: {
        valid: allValid,
        oauthValid,
        smtpValid,
        imapValid,
        oauthError,
        smtpError,
        imapError,
        verifiedAt: new Date().toISOString(),
        durationMs,
      },
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to verify mailbox'
    console.error('[mail-service] verifyMailboxConnection:', message)
    return { success: false, error: message }
  }
}

// ============================================================
// Reconnect Mailbox
// ============================================================

export async function reconnectMailbox(
  id: string,
  orgId: string,
  actor: ActorInfo
): Promise<MailApiResult<MailboxReconnectResult>> {
  try {
    const mailbox = await mailboxRepo.findMailboxWithConfigs(id, orgId)
    if (!mailbox) return { success: false, error: 'Mailbox not found' }

    // Provider-specific reconnect logic
    if (mailbox.authType === 'oauth' && mailbox.oauthConfig) {
      // OAuth: need to redirect user to re-authorize
      const service = getOAuthService(mailbox.oauthConfig.provider)
      const state = `${orgId}:${id}:${Date.now()}`
      const oauthRedirectUrl = service.getAuthorizationUrl(state)

      await logAuditAndTransition(orgId, id, actor, 'reconnect_attempted', 'reconnect_required')

      return {
        success: true,
        data: {
          success: true,
          newStatus: 'reconnect_required',
          oauthRedirectUrl,
        },
      }
    }

    if (mailbox.smtpConfig) {
      // SMTP: re-test the connection
      try {
        const { testSMTPConnection } = await import('./smtp-validator')
        const password = decrypt(mailbox.smtpConfig.encryptedPasswordReference)
        const result = await testSMTPConnection({
          host: mailbox.smtpConfig.smtpHost,
          port: mailbox.smtpConfig.smtpPort,
          encryption: mailbox.smtpConfig.encryption,
          username: mailbox.smtpConfig.username,
          password,
        })

        if (result.success) {
          await smtpRepo.updateSMTPConfig(mailbox.smtpConfig.id, orgId, { validationStatus: 'valid' })
          const transitionResult = await logAuditAndTransition(orgId, id, actor, 'reconnect_succeeded', 'connected')
          return {
            success: true,
            data: {
              success: true,
              newStatus: transitionResult.newStatus ?? 'connected',
            },
          }
        } else {
          await smtpRepo.updateSMTPConfig(mailbox.smtpConfig.id, orgId, { validationStatus: 'invalid' })
          await logAuditAndTransition(orgId, id, actor, 'reconnect_failed', 'smtp_failed')
          return {
            success: true,
            data: {
              success: false,
              newStatus: 'smtp_failed',
              error: result.error?.message ?? 'SMTP reconnection failed',
            },
          }
        }
      } catch (err) {
        await logAuditAndTransition(orgId, id, actor, 'reconnect_failed', 'smtp_failed')
        return {
          success: true,
          data: {
            success: false,
            newStatus: 'smtp_failed',
            error: err instanceof Error ? err.message : 'SMTP reconnection failed',
          },
        }
      }
    }

    // No config to reconnect with
    return { success: false, error: 'No OAuth or SMTP configuration found for this mailbox' }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to reconnect mailbox'
    console.error('[mail-service] reconnectMailbox:', message)
    return { success: false, error: message }
  }
}

// ============================================================
// Bulk Lifecycle Operations with Per-Mailbox Results
// ============================================================

export async function bulkEnableMailboxes(
  ids: string[],
  orgId: string,
  actor: ActorInfo
): Promise<MailApiResult<MailboxActionResult[]>> {
  const results: MailboxActionResult[] = []
  for (const id of ids) {
    const result = await enableMailbox(id, orgId, actor)
    if (result.success && result.data) {
      results.push(result.data)
    } else if (!result.success) {
      results.push({ mailboxId: id, success: false, previousStatus: null, newStatus: null, error: result.error })
    }
  }
  return { success: true, data: results }
}

export async function bulkDisableMailboxes(
  ids: string[],
  orgId: string,
  actor: ActorInfo
): Promise<MailApiResult<MailboxActionResult[]>> {
  const results: MailboxActionResult[] = []
  for (const id of ids) {
    const result = await disableMailbox(id, orgId, actor)
    if (result.success && result.data) {
      results.push(result.data)
    } else if (!result.success) {
      results.push({ mailboxId: id, success: false, previousStatus: null, newStatus: null, error: result.error })
    }
  }
  return { success: true, data: results }
}

export async function bulkArchiveMailboxesLifecycle(
  ids: string[],
  orgId: string,
  actor: ActorInfo
): Promise<MailApiResult<MailboxActionResult[]>> {
  const results: MailboxActionResult[] = []
  for (const id of ids) {
    const result = await archiveMailbox(id, orgId, actor)
    if (result.success && result.data) {
      results.push(result.data)
    } else if (!result.success) {
      results.push({ mailboxId: id, success: false, previousStatus: null, newStatus: null, error: result.error })
    }
  }
  return { success: true, data: results }
}

export async function bulkDeleteMailboxesLifecycle(
  ids: string[],
  orgId: string,
  actor: ActorInfo
): Promise<MailApiResult<MailboxActionResult[]>> {
  const results: MailboxActionResult[] = []
  for (const id of ids) {
    const result = await softDeleteMailbox(id, orgId, actor)
    if (result.success && result.data) {
      results.push(result.data)
    } else if (!result.success) {
      results.push({ mailboxId: id, success: false, previousStatus: null, newStatus: null, error: result.error })
    }
  }
  return { success: true, data: results }
}

export async function bulkRestoreMailboxes(
  ids: string[],
  orgId: string,
  actor: ActorInfo
): Promise<MailApiResult<MailboxActionResult[]>> {
  const results: MailboxActionResult[] = []
  for (const id of ids) {
    const result = await restoreMailbox(id, orgId, actor)
    if (result.success && result.data) {
      results.push(result.data)
    } else if (!result.success) {
      results.push({ mailboxId: id, success: false, previousStatus: null, newStatus: null, error: result.error })
    }
  }
  return { success: true, data: results }
}

// ============================================================
// Bulk Verify + Reconnect
// ============================================================

export async function bulkVerifyMailboxes(
  ids: string[],
  orgId: string,
  actor: ActorInfo
): Promise<MailApiResult<MailboxActionResult[]>> {
  const results: MailboxActionResult[] = []
  for (const id of ids) {
    const verification = await verifyMailboxConnection(id, orgId, actor)
    if (verification.success && verification.data) {
      results.push({
        mailboxId: id,
        success: verification.data.valid,
        previousStatus: null,
        newStatus: verification.data.valid ? 'connected' : 'verification_failed',
        error: verification.data.valid ? undefined : 'One or more connections failed',
      })
    } else if (!verification.success) {
      results.push({ mailboxId: id, success: false, previousStatus: null, newStatus: null, error: verification.error })
    }
  }

  await auditRepo.insertAuditEvent({
    organizationId: orgId,
    mailboxId: ids[0] ?? '',
    actorUserId: actor.userId,
    actorEmail: actor.email,
    action: 'bulk_action',
    previousStatus: null,
    newStatus: null,
    metadata: { bulkType: 'verify', count: ids.length, results: results.map(r => ({ id: r.mailboxId, success: r.success })) },
  })

  return { success: true, data: results }
}

export async function bulkReconnectMailboxes(
  ids: string[],
  orgId: string,
  actor: ActorInfo
): Promise<MailApiResult<MailboxActionResult[]>> {
  const results: MailboxActionResult[] = []
  for (const id of ids) {
    const reconnect = await reconnectMailbox(id, orgId, actor)
    if (reconnect.success && reconnect.data) {
      results.push({
        mailboxId: id,
        success: reconnect.data.success,
        previousStatus: null,
        newStatus: reconnect.data.newStatus,
        error: reconnect.data.error,
      })
    } else if (!reconnect.success) {
      results.push({ mailboxId: id, success: false, previousStatus: null, newStatus: null, error: reconnect.error })
    }
  }

  await auditRepo.insertAuditEvent({
    organizationId: orgId,
    mailboxId: ids[0] ?? '',
    actorUserId: actor.userId,
    actorEmail: actor.email,
    action: 'bulk_action',
    previousStatus: null,
    newStatus: null,
    metadata: { bulkType: 'reconnect', count: ids.length, results: results.map(r => ({ id: r.mailboxId, success: r.success })) },
  })

  return { success: true, data: results }
}

// ============================================================
// Audit Log Service
// ============================================================

export async function getMailboxAuditLogs(
  mailboxId: string,
  orgId: string,
  limit?: number,
  offset?: number
) {
  return auditRepo.findAuditEventsByMailbox(mailboxId, orgId, limit, offset)
}

export async function getOrgAuditLogs(
  orgId: string,
  limit?: number,
  offset?: number
) {
  return auditRepo.findAuditEventsByOrg(orgId, limit, offset)
}

// ============================================================
// Mailbox Pool Service
// ============================================================

function toPoolResponse(pool: MailboxPool): MailboxPoolResponse {
  return {
    id: pool.id,
    organizationId: pool.organizationId,
    name: pool.name,
    description: pool.description,
    status: pool.status,
    dailyPoolLimit: pool.dailyPoolLimit,
    sendingStrategy: pool.sendingStrategy,
    rotationStrategy: pool.rotationStrategy,
    maxConcurrentSends: pool.maxConcurrentSends,
    timezone: pool.timezone,
    memberCount: pool.healthAggregation?.totalMailboxes ?? 0,
    healthAggregation: pool.healthAggregation,
    metadata: pool.metadata,
    createdAt: pool.createdAt,
    updatedAt: pool.updatedAt,
  }
}

export async function listPools(orgId: string): Promise<MailboxPoolResponse[]> {
  const pools = await poolRepo.findPoolsByOrg(orgId)
  return pools.map(toPoolResponse)
}

export async function getPool(id: string, orgId: string): Promise<MailboxPool | null> {
  return poolRepo.findPoolById(id, orgId)
}

export async function createPool(
  orgId: string,
  input: CreateMailboxPoolRequest
): Promise<MailApiResult<MailboxPoolResponse>> {
  const validation = validateCreateMailboxPoolRequest(input)
  if (!validation.valid) {
    return { success: false, error: validation.errors.join('; ') }
  }

  const exists = await poolRepo.checkDuplicatePool(input.name.trim(), orgId)
  if (exists) {
    return { success: false, error: 'A pool with this name already exists in this workspace' }
  }

  try {
    const pool = await poolRepo.insertPool(orgId, {
      name: input.name.trim(),
      description: input.description ?? '',
      dailyPoolLimit: input.dailyPoolLimit ?? 500,
      sendingStrategy: input.sendingStrategy,
      rotationStrategy: input.rotationStrategy,
      maxConcurrentSends: input.maxConcurrentSends,
      timezone: input.timezone,
      metadata: input.metadata ?? {},
    })
    return { success: true, data: toPoolResponse(pool) }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create pool'
    console.error('[mail-service] createPool:', message)
    return { success: false, error: message }
  }
}

export async function updatePool(
  id: string,
  orgId: string,
  input: UpdateMailboxPoolRequest
): Promise<MailApiResult<MailboxPoolResponse>> {
  const validation = validateUpdateMailboxPoolRequest(input)
  if (!validation.valid) {
    return { success: false, error: validation.errors.join('; ') }
  }

  const existing = await poolRepo.findPoolById(id, orgId)
  if (!existing) {
    return { success: false, error: 'Pool not found' }
  }

  try {
    const updated = await poolRepo.updatePool(id, orgId, {
      name: input.name,
      description: input.description,
      status: input.status,
      dailyPoolLimit: input.dailyPoolLimit,
      sendingStrategy: input.sendingStrategy,
      rotationStrategy: input.rotationStrategy,
      maxConcurrentSends: input.maxConcurrentSends,
      timezone: input.timezone,
      metadata: input.metadata,
    })
    if (!updated) {
      return { success: false, error: 'Failed to update pool' }
    }
    return { success: true, data: toPoolResponse(updated) }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update pool'
    console.error('[mail-service] updatePool:', message)
    return { success: false, error: message }
  }
}

export async function deletePool(
  id: string,
  orgId: string
): Promise<MailApiResult<boolean>> {
  const existing = await poolRepo.findPoolById(id, orgId)
  if (!existing) {
    return { success: false, error: 'Pool not found' }
  }

  try {
    const deleted = await poolRepo.deletePool(id, orgId)
    return { success: true, data: deleted }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete pool'
    console.error('[mail-service] deletePool:', message)
    return { success: false, error: message }
  }
}

export async function addMailboxToPool(
  poolId: string,
  mailboxId: string,
  orgId: string
): Promise<MailApiResult<boolean>> {
  const pool = await poolRepo.findPoolById(poolId, orgId)
  if (!pool) {
    return { success: false, error: 'Pool not found' }
  }

  const mailbox = await mailboxRepo.findMailboxById(mailboxId, orgId)
  if (!mailbox) {
    return { success: false, error: 'Mailbox not found' }
  }

  try {
    const added = await poolRepo.addMailboxToPool(poolId, mailboxId)
    return { success: true, data: added }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to add mailbox to pool'
    console.error('[mail-service] addMailboxToPool:', message)
    return { success: false, error: message }
  }
}

export async function removeMailboxFromPool(
  poolId: string,
  mailboxId: string,
  orgId: string
): Promise<MailApiResult<boolean>> {
  const pool = await poolRepo.findPoolById(poolId, orgId)
  if (!pool) {
    return { success: false, error: 'Pool not found' }
  }

  try {
    const removed = await poolRepo.removeMailboxFromPool(poolId, mailboxId)
    return { success: true, data: removed }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to remove mailbox from pool'
    console.error('[mail-service] removeMailboxFromPool:', message)
    return { success: false, error: message }
  }
}

export async function countPools(orgId: string): Promise<number> {
  return poolRepo.countPoolsByOrg(orgId)
}

export async function getPoolMembers(poolId: string, orgId: string) {
  const pool = await poolRepo.findPoolById(poolId, orgId)
  if (!pool) return []
  return poolRepo.findPoolMembersWithDetails(poolId)
}

export async function getAvailableMailboxesForPool(orgId: string) {
  return poolRepo.findAvailableMailboxes(orgId)
}

export async function addMailboxToPoolWithRole(
  poolId: string,
  mailboxId: string,
  orgId: string,
  role: import('@/types/mail').PoolMembershipRole = 'primary'
): Promise<MailApiResult<boolean>> {
  const pool = await poolRepo.findPoolById(poolId, orgId)
  if (!pool) return { success: false, error: 'Pool not found' }

  const mailbox = await mailboxRepo.findMailboxById(mailboxId, orgId)
  if (!mailbox) return { success: false, error: 'Mailbox not found' }

  try {
    const added = await poolRepo.addMailboxToPool(poolId, mailboxId, role)
    return { success: true, data: added }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to add mailbox to pool'
    console.error('[mail-service] addMailboxToPoolWithRole:', message)
    return { success: false, error: message }
  }
}

export async function updatePoolMemberRole(
  poolId: string,
  mailboxId: string,
  orgId: string,
  role: import('@/types/mail').PoolMembershipRole
): Promise<MailApiResult<boolean>> {
  const pool = await poolRepo.findPoolById(poolId, orgId)
  if (!pool) return { success: false, error: 'Pool not found' }

  try {
    const updated = await poolRepo.updateMailboxPoolRole(poolId, mailboxId, role)
    return { success: true, data: updated }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update member role'
    console.error('[mail-service] updatePoolMemberRole:', message)
    return { success: false, error: message }
  }
}

export async function bulkAssignMailboxesToPool(
  poolId: string,
  mailboxIds: string[],
  orgId: string,
  role: import('@/types/mail').PoolMembershipRole = 'primary'
): Promise<MailApiResult<number>> {
  const pool = await poolRepo.findPoolById(poolId, orgId)
  if (!pool) return { success: false, error: 'Pool not found' }

  let count = 0
  for (const mailboxId of mailboxIds) {
    try {
      await poolRepo.addMailboxToPool(poolId, mailboxId, role)
      count++
    } catch {
      // skip individual failures
    }
  }
  return { success: true, data: count }
}

export async function removeBulkMailboxesFromPool(
  poolId: string,
  mailboxIds: string[],
  orgId: string
): Promise<MailApiResult<number>> {
  const pool = await poolRepo.findPoolById(poolId, orgId)
  if (!pool) return { success: false, error: 'Pool not found' }

  let count = 0
  for (const mailboxId of mailboxIds) {
    try {
      const removed = await poolRepo.removeMailboxFromPool(poolId, mailboxId)
      if (removed) count++
    } catch {
      // skip individual failures
    }
  }
  return { success: true, data: count }
}

// ============================================================
// Config Response Mappers
// ============================================================

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
    username: config.username || '',
    authentication: config.authentication,
    validationStatus: config.validationStatus,
    lastValidatedAt: config.lastValidatedAt,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  }
}

// ============================================================
// Mailbox with Configs
// ============================================================

export async function getMailboxWithConfigs(
  id: string,
  orgId: string
): Promise<Mailbox | null> {
  return mailboxRepo.findMailboxWithConfigs(id, orgId)
}

// ============================================================
// OAuth Config Service
// ============================================================

export async function getOAuthConfig(
  mailboxId: string,
  orgId: string
): Promise<OAuthConfig | null> {
  const mailbox = await mailboxRepo.findMailboxById(mailboxId, orgId)
  if (!mailbox) return null
  return oauthRepo.findOAuthConfigByMailboxId(mailboxId)
}

export async function createOAuthConfig(
  orgId: string,
  input: CreateOAuthConfigRequest
): Promise<MailApiResult<OAuthConfigResponse>> {
  const validation = validateCreateOAuthConfigRequest(input)
  if (!validation.valid) {
    return { success: false, error: validation.errors.join('; ') }
  }

  const mailbox = await mailboxRepo.findMailboxById(input.mailboxId, orgId)
  if (!mailbox) {
    return { success: false, error: 'Mailbox not found' }
  }

  const providerValidation = validateOAuthProvider(input.provider)
  if (!providerValidation.valid) {
    return { success: false, error: providerValidation.errors.join('; ') }
  }

  const existing = await oauthRepo.findOAuthConfigByMailboxAndProvider(
    input.mailboxId,
    input.provider
  )
  if (existing) {
    return { success: false, error: 'OAuth configuration already exists for this provider' }
  }

  try {
    const config = await oauthRepo.insertOAuthConfig(orgId, {
      mailboxId: input.mailboxId,
      provider: input.provider,
      providerAccountId: input.providerAccountId,
      encryptedRefreshToken: input.encryptedRefreshToken ?? null,
      encryptedAccessToken: input.encryptedAccessToken ?? null,
      tokenExpiresAt: input.tokenExpiresAt ?? null,
      scope: input.scope ?? '',
    })
    return { success: true, data: toOAuthConfigResponse(config) }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create OAuth config'
    console.error('[mail-service] createOAuthConfig:', message)
    return { success: false, error: message }
  }
}

export async function updateOAuthConfig(
  id: string,
  orgId: string,
  data: {
    encryptedRefreshToken?: string | null
    encryptedAccessToken?: string | null
    tokenExpiresAt?: string | null
    scope?: string
  }
): Promise<MailApiResult<OAuthConfigResponse>> {
  const existing = await oauthRepo.findOAuthConfigById(id, orgId)
  if (!existing) {
    return { success: false, error: 'OAuth config not found' }
  }

  try {
    const updated = await oauthRepo.updateOAuthConfig(id, orgId, data)
    if (!updated) {
      return { success: false, error: 'Failed to update OAuth config' }
    }
    return { success: true, data: toOAuthConfigResponse(updated) }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update OAuth config'
    console.error('[mail-service] updateOAuthConfig:', message)
    return { success: false, error: message }
  }
}

export async function deleteOAuthConfig(
  id: string,
  orgId: string
): Promise<MailApiResult<boolean>> {
  const existing = await oauthRepo.findOAuthConfigById(id, orgId)
  if (!existing) {
    return { success: false, error: 'OAuth config not found' }
  }

  try {
    const deleted = await oauthRepo.deleteOAuthConfig(id, orgId)
    return { success: true, data: deleted }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete OAuth config'
    console.error('[mail-service] deleteOAuthConfig:', message)
    return { success: false, error: message }
  }
}

// ============================================================
// SMTP Config Service
// ============================================================

export async function getSMTPConfig(
  mailboxId: string,
  orgId: string
): Promise<SMTPConfig | null> {
  const mailbox = await mailboxRepo.findMailboxById(mailboxId, orgId)
  if (!mailbox) return null
  return smtpRepo.findSMTPConfigByMailboxId(mailboxId)
}

export async function createSMTPConfig(
  orgId: string,
  input: CreateSMTPConfigRequest
): Promise<MailApiResult<SMTPConfigResponse>> {
  const validation = validateCreateSMTPConfigRequest(input)
  if (!validation.valid) {
    return { success: false, error: validation.errors.join('; ') }
  }

  const mailbox = await mailboxRepo.findMailboxById(input.mailboxId, orgId)
  if (!mailbox) {
    return { success: false, error: 'Mailbox not found' }
  }

  const existing = await smtpRepo.findSMTPConfigByMailboxId(input.mailboxId)
  if (existing) {
    return { success: false, error: 'SMTP configuration already exists for this mailbox' }
  }

  try {
    const config = await smtpRepo.insertSMTPConfig(orgId, {
      mailboxId: input.mailboxId,
      smtpHost: input.smtpHost,
      smtpPort: input.smtpPort,
      encryption: input.encryption,
      username: input.username,
      encryptedPasswordReference: input.encryptedPasswordReference,
      authenticationType: input.authenticationType ?? 'password',
    })
    return { success: true, data: toSMTPConfigResponse(config) }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create SMTP config'
    console.error('[mail-service] createSMTPConfig:', message)
    return { success: false, error: message }
  }
}

export async function updateSMTPConfig(
  id: string,
  orgId: string,
  data: {
    smtpHost?: string
    smtpPort?: number
    encryption?: SMTPEncryption
    username?: string
    encryptedPasswordReference?: string
    authenticationType?: SMTPAuthenticationType
  }
): Promise<MailApiResult<SMTPConfigResponse>> {
  const existing = await smtpRepo.findSMTPConfigById(id, orgId)
  if (!existing) {
    return { success: false, error: 'SMTP config not found' }
  }

  try {
    const updated = await smtpRepo.updateSMTPConfig(id, orgId, data)
    if (!updated) {
      return { success: false, error: 'Failed to update SMTP config' }
    }
    return { success: true, data: toSMTPConfigResponse(updated) }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update SMTP config'
    console.error('[mail-service] updateSMTPConfig:', message)
    return { success: false, error: message }
  }
}

export async function deleteSMTPConfig(
  id: string,
  orgId: string
): Promise<MailApiResult<boolean>> {
  const existing = await smtpRepo.findSMTPConfigById(id, orgId)
  if (!existing) {
    return { success: false, error: 'SMTP config not found' }
  }

  try {
    const deleted = await smtpRepo.deleteSMTPConfig(id, orgId)
    return { success: true, data: deleted }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete SMTP config'
    console.error('[mail-service] deleteSMTPConfig:', message)
    return { success: false, error: message }
  }
}

// ============================================================
// IMAP Config Service
// ============================================================

export async function getIMAPConfig(
  mailboxId: string,
  orgId: string
): Promise<IMAPConfig | null> {
  const mailbox = await mailboxRepo.findMailboxById(mailboxId, orgId)
  if (!mailbox) return null
  return imapRepo.findIMAPConfigByMailboxId(mailboxId)
}

export async function createIMAPConfig(
  orgId: string,
  input: CreateIMAPConfigRequest
): Promise<MailApiResult<IMAPConfigResponse>> {
  const validation = validateCreateIMAPConfigRequest(input)
  if (!validation.valid) {
    return { success: false, error: validation.errors.join('; ') }
  }

  const mailbox = await mailboxRepo.findMailboxById(input.mailboxId, orgId)
  if (!mailbox) {
    return { success: false, error: 'Mailbox not found' }
  }

  const existing = await imapRepo.findIMAPConfigByMailboxId(input.mailboxId)
  if (existing) {
    return { success: false, error: 'IMAP configuration already exists for this mailbox' }
  }

  try {
    const config = await imapRepo.insertIMAPConfig(orgId, {
      mailboxId: input.mailboxId,
      host: input.host,
      port: input.port,
      ssl: input.ssl ?? true,
      authentication: input.authentication,
      username: input.username ?? '',
      encryptedPasswordReference: input.password ? encrypt(input.password) : null,
    })
    return { success: true, data: toIMAPConfigResponse(config) }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create IMAP config'
    console.error('[mail-service] createIMAPConfig:', message)
    return { success: false, error: message }
  }
}

export async function updateIMAPConfig(
  id: string,
  orgId: string,
  data: {
    host?: string
    port?: number
    ssl?: boolean
    authentication?: 'password' | 'oauth2'
  }
): Promise<MailApiResult<IMAPConfigResponse>> {
  const existing = await imapRepo.findIMAPConfigById(id, orgId)
  if (!existing) {
    return { success: false, error: 'IMAP config not found' }
  }

  try {
    const updated = await imapRepo.updateIMAPConfig(id, orgId, data)
    if (!updated) {
      return { success: false, error: 'Failed to update IMAP config' }
    }
    return { success: true, data: toIMAPConfigResponse(updated) }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update IMAP config'
    console.error('[mail-service] updateIMAPConfig:', message)
    return { success: false, error: message }
  }
}

export async function deleteIMAPConfig(
  id: string,
  orgId: string
): Promise<MailApiResult<boolean>> {
  const existing = await imapRepo.findIMAPConfigById(id, orgId)
  if (!existing) {
    return { success: false, error: 'IMAP config not found' }
  }

  try {
    const deleted = await imapRepo.deleteIMAPConfig(id, orgId)
    return { success: true, data: deleted }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete IMAP config'
    console.error('[mail-service] deleteIMAPConfig:', message)
    return { success: false, error: message }
  }
}

// ============================================================
// Transactional Mailbox + Config Creation
// ============================================================

type CreateMailboxFullInput = {
  orgId: string
  email: string
  displayName: string
  senderName: string
  provider: string
  authType: string
  timezone: string
  dailyLimit: number
  poolId?: string | null
  providerAccountId?: string | null
  actorUserId?: string | null
  actorEmail?: string | null
  smtp?: WizardSMTPValues | null
  imap?: WizardIMAPValues | null
  oauthTokens?: {
    accessToken?: string | null
    refreshToken?: string | null
    expiresAt?: Date | null
    scope?: string
    providerAccountId?: string
  } | null
}

export async function createMailboxTransactional(
  input: CreateMailboxFullInput
): Promise<MailApiResult<Mailbox>> {
  const validation = validateCreateMailboxRequest({
    email: input.email,
    provider: input.provider,
    authType: input.authType,
    timezone: input.timezone,
    dailyLimit: input.dailyLimit,
  })
  if (!validation.valid) {
    return { success: false, error: validation.errors.join('; ') }
  }

  const exists = await mailboxRepo.checkDuplicateMailbox(input.email, input.orgId)
  if (exists) {
    return {
      success: false,
      error: `A mailbox for ${input.email.trim().toLowerCase()} is already connected in this workspace. Open Accounts to manage or reconnect it — duplicates in the same workspace are blocked.`,
    }
  }

  // Cross-org duplicate → allow but flag for abuse review (PRD §15)
  try {
    const crossOrg = await pool.query(
      `SELECT organization_id, id FROM public.mail_mailboxes
       WHERE LOWER(email) = $1 AND organization_id != $2 AND deleted_at IS NULL
       LIMIT 5`,
      [input.email.trim().toLowerCase(), input.orgId]
    )
    for (const row of crossOrg.rows) {
      await pool.query(
        `INSERT INTO public.mail_abuse_review_events
          (email, organization_id, other_organization_id, mailbox_id, event_type, metadata)
         VALUES ($1, $2, $3, $4, 'cross_org_duplicate', $5::jsonb)`,
        [
          input.email.trim().toLowerCase(),
          input.orgId,
          row.organization_id,
          row.id,
          JSON.stringify({ source: 'create_mailbox' }),
        ]
      )
    }
  } catch (err) {
    console.error('[mail-service] abuse review log failed:', err instanceof Error ? err.message : err)
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const initialStatus = 'pending_dns'
    const mailboxResult = await client.query(
      `INSERT INTO public.mail_mailboxes
        (organization_id, pool_id, provider, auth_type, email, display_name, sender_name,
         provider_account_id, timezone, daily_limit, mailbox_status, verification_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending')
       RETURNING *`,
      [
        input.orgId,
        input.poolId ?? null,
        input.provider,
        input.authType,
        input.email.trim().toLowerCase(),
        input.displayName || '',
        input.senderName || '',
        input.providerAccountId ?? null,
        input.timezone || 'UTC',
        input.dailyLimit || 50,
        initialStatus,
      ]
    )
    const mailboxId = mailboxResult.rows[0].id

    if (input.authType === 'oauth' && input.oauthTokens) {
      const encryptedRefresh = input.oauthTokens.refreshToken
        ? await encryptAsync(input.oauthTokens.refreshToken)
        : null
      const encryptedAccess = input.oauthTokens.accessToken
        ? await encryptAsync(input.oauthTokens.accessToken)
        : null
      await client.query(
        `INSERT INTO public.mailbox_oauth_configs
          (mailbox_id, organization_id, provider, provider_account_id,
           encrypted_refresh_token, encrypted_access_token, token_expires_at, scope)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          mailboxId,
          input.orgId,
          input.provider,
          input.oauthTokens.providerAccountId ?? '',
          encryptedRefresh,
          encryptedAccess,
          input.oauthTokens.expiresAt?.toISOString() ?? null,
          input.oauthTokens.scope ?? '',
        ]
      )
    }

    if (input.smtp) {
      const encryptedPassword = await encryptAsync(input.smtp.smtpPassword)
      await client.query(
        `INSERT INTO public.mailbox_smtp_configs
          (mailbox_id, organization_id, smtp_host, smtp_port, encryption, username,
           encrypted_password_reference, authentication_type, validation_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'valid')`,
        [
          mailboxId,
          input.orgId,
          input.smtp.smtpHost,
          Number(input.smtp.smtpPort) || 587,
          input.smtp.encryption,
          input.smtp.smtpUsername || input.email,
          encryptedPassword,
          input.smtp.authenticationType || 'password',
        ]
      )
    }

    if (input.imap && input.imap.imapHost) {
      const imapPassword = input.imap.imapPassword || input.smtp?.smtpPassword || ''
      const encryptedImapPassword = imapPassword ? encrypt(imapPassword) : null
      await client.query(
        `INSERT INTO public.mailbox_imap_configs
          (mailbox_id, organization_id, host, port, ssl, authentication, username,
           encrypted_password_reference, validation_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'valid')`,
        [
          mailboxId,
          input.orgId,
          input.imap.imapHost,
          Number(input.imap.imapPort) || 993,
          input.imap.imapSsl,
          'password',
          input.imap.imapUsername || input.smtp?.smtpUsername || input.email,
          encryptedImapPassword,
        ]
      )
    }

    await client.query(
      `INSERT INTO public.mailbox_audit_log
        (organization_id, mailbox_id, actor_user_id, actor_email, action, previous_status, new_status, metadata)
       VALUES ($1, $2, $3, $4, 'created', NULL, $5, $6::jsonb)`,
      [
        input.orgId,
        mailboxId,
        input.actorUserId || '00000000-0000-0000-0000-000000000000',
        input.actorEmail || 'system@magnivo.ai',
        initialStatus,
        JSON.stringify({ message: 'Mailbox created — pending DNS setup' }),
      ]
    ).catch(() => {
      // non-fatal if audit insert fails
    })

    await client.query('COMMIT')

    const mailbox = await mailboxRepo.findMailboxWithConfigs(mailboxId, input.orgId)
    if (!mailbox) {
      return { success: false, error: 'Failed to retrieve created mailbox' }
    }
    return { success: true, data: mailbox }
  } catch (err) {
    await client.query('ROLLBACK')
    const message = err instanceof Error ? err.message : 'Failed to create mailbox'
    console.error('[mail-service] createMailboxTransactional:', message)
    return { success: false, error: message }
  } finally {
    client.release()
  }
}

// ============================================================
// OAuth Code Exchange + Mailbox Creation
// ============================================================

type CreateMailboxWithOAuthInput = {
  orgId: string
  email: string
  displayName: string
  senderName: string
  provider: string
  timezone: string
  dailyLimit: number
  poolId?: string | null
  oauthCode: string
  /** When set with syncToEngage, also upsert public.engage_mailboxes for Accounts UI */
  userId?: string
  syncToEngage?: boolean
}

export async function createMailboxWithOAuth(
  input: CreateMailboxWithOAuthInput
): Promise<MailApiResult<Mailbox>> {
  try {
    const { getOAuthService } = await import('./oauth')
    const oauthService = getOAuthService(input.provider as 'gmail' | 'outlook' | 'zoho')

    const tokenResult = await oauthService.exchangeCode(input.oauthCode)
    const profile = await oauthService.getProfile(tokenResult.accessToken)
    const email = profile.email || input.email

    const created = await createMailboxTransactional({
      orgId: input.orgId,
      email,
      displayName: profile.displayName || input.displayName,
      senderName: input.senderName,
      provider: input.provider,
      authType: 'oauth',
      timezone: input.timezone,
      dailyLimit: input.dailyLimit,
      poolId: input.poolId,
      providerAccountId: profile.providerAccountId,
      oauthTokens: {
        accessToken: tokenResult.accessToken,
        refreshToken: tokenResult.refreshToken,
        expiresAt: tokenResult.expiresAt,
        scope: tokenResult.scope,
        providerAccountId: profile.providerAccountId,
      },
    })

    if (created.success && input.syncToEngage && input.userId) {
      await syncEngageMailboxFromOAuth({
        userId: input.userId,
        orgId: input.orgId,
        provider: mapMailProviderToEngage(input.provider),
        email,
        accessToken: tokenResult.accessToken,
        refreshToken: tokenResult.refreshToken ?? undefined,
        scope: tokenResult.scope,
        expiresAt: tokenResult.expiresAt,
      }).catch((err) => {
        console.error(
          '[mail-service] engage dual-write failed:',
          err instanceof Error ? err.message : err
        )
      })
    }

    return created
  } catch (err) {
    const message = err instanceof Error ? err.message : 'OAuth exchange failed'
    console.error('[mail-service] createMailboxWithOAuth:', message)
    return { success: false, error: message }
  }
}

function mapMailProviderToEngage(provider: string): 'gmail' | 'microsoft' | 'zoho' {
  if (provider === 'outlook') return 'microsoft'
  if (provider === 'zoho') return 'zoho'
  return 'gmail'
}

async function syncEngageMailboxFromOAuth(input: {
  userId: string
  orgId: string
  provider: 'gmail' | 'microsoft' | 'zoho'
  email: string
  accessToken: string
  refreshToken?: string
  scope?: string
  expiresAt?: Date
}): Promise<void> {
  const { encrypt } = await import('@/lib/encryption')
  const now = new Date().toISOString()
  const expiresAt = input.expiresAt ? input.expiresAt.toISOString() : null
  let encryptedAccess: string | null = null
  let encryptedRefresh: string | null = null
  try {
    encryptedAccess = encrypt(input.accessToken)
    encryptedRefresh = input.refreshToken ? encrypt(input.refreshToken) : null
  } catch {
    encryptedAccess = null
  }

  if (encryptedAccess) {
    try {
      await pool.query(
        `INSERT INTO public.engage_mailboxes
         (user_id, organization_id, provider, email, access_token, refresh_token, token_type, scope, expires_at,
          encrypted_access_token, encrypted_refresh_token, tokens_encrypted_at, status, updated_at, connected_at)
         VALUES ($1,$2,$3,$4,'',$5,'Bearer',$6,$7,$8,$9,$10,'active',$11,$12)
         ON CONFLICT (user_id, provider, email) DO UPDATE SET
           encrypted_access_token = COALESCE(EXCLUDED.encrypted_access_token, engage_mailboxes.encrypted_access_token),
           encrypted_refresh_token = COALESCE(EXCLUDED.encrypted_refresh_token, engage_mailboxes.encrypted_refresh_token),
           tokens_encrypted_at = COALESCE(EXCLUDED.tokens_encrypted_at, engage_mailboxes.tokens_encrypted_at),
           scope = EXCLUDED.scope,
           expires_at = EXCLUDED.expires_at,
           status = 'active',
           updated_at = EXCLUDED.updated_at,
           connected_at = EXCLUDED.connected_at`,
        [
          input.userId,
          input.orgId,
          input.provider,
          input.email.trim().toLowerCase(),
          encryptedRefresh ? '' : (input.refreshToken ?? null),
          input.scope ?? null,
          expiresAt,
          encryptedAccess,
          encryptedRefresh,
          now,
          now,
          now,
        ]
      )
      return
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (!/encrypted_access_token|encrypted_refresh_token|tokens_encrypted_at|engage_mailboxes_provider_check/i.test(message)) {
        throw err
      }
      if (/engage_mailboxes_provider_check/i.test(message)) {
        console.error('[mail-service] engage provider constraint blocks', input.provider, '— apply DBA_APPLY_AS_OWNER.sql')
        return
      }
    }
  }

  await pool.query(
    `INSERT INTO public.engage_mailboxes
     (user_id, organization_id, provider, email, access_token, refresh_token, token_type, scope, expires_at, status, updated_at, connected_at)
     VALUES ($1,$2,$3,$4,$5,$6,'Bearer',$7,$8,'active',$9,$10)
     ON CONFLICT (user_id, provider, email) DO UPDATE SET
       access_token = EXCLUDED.access_token,
       refresh_token = EXCLUDED.refresh_token,
       scope = EXCLUDED.scope,
       expires_at = EXCLUDED.expires_at,
       status = 'active',
       updated_at = EXCLUDED.updated_at,
       connected_at = EXCLUDED.connected_at`,
    [
      input.userId,
      input.orgId,
      input.provider,
      input.email.trim().toLowerCase(),
      input.accessToken,
      input.refreshToken ?? null,
      input.scope ?? null,
      expiresAt,
      now,
      now,
    ]
  )
}
