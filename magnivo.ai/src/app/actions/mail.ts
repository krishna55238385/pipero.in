'use server'

import { getSessionUser } from '@/lib/auth'
import * as mailboxService from '@/services/mail/mailbox-service'
import * as warmupService from '@/services/mail/warmup-service'
import { testConnection, testOAuthConnection } from '@/services/mail/connection-tester'
import { getOAuthService } from '@/services/mail/oauth'
import { resolveMailPermissions, hasMailPermission } from '@/lib/mail-permissions'
import type {
  Mailbox,
  MailboxPool,
  Campaign,
  Lead,
  WarmupConfig,
  WarmupStatus,
  Sequence,
  AnalyticsOverview,
  MailSettings,
  CreateMailboxRequest,
  UpdateMailboxRequest,
  CreateMailboxPoolRequest,
  UpdateMailboxPoolRequest,
  MailboxPoolResponse,
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
  MailApiResult,
  WizardTestResult,
  WizardSMTPValues,
  WizardIMAPValues,
  MailboxProvider,
  MailboxActionResult,
  MailboxVerificationResult,
  MailboxReconnectResult,
  MailboxAuditLogEntry,
  MailUserPermissions,
  MailPermissionType,
  CreateWarmupConfigRequest,
  UpdateWarmupConfigRequest,
  WarmupConfigResponse,
  WarmupConfigWithStats,
  WarmupBulkRequest,
  WarmupBulkResult,
  WarmupDashboardStats,
  WarmupConfigStatus,
} from '@/types/mail'
import { getMailErrorMessage } from '@/types/mail'

type ActorInfo = { userId: string; email: string }

type AuthContext = {
  orgId: string
  actor: ActorInfo
  permissions: MailUserPermissions
}

async function getOrgIdAndActor(): Promise<AuthContext | null> {
  const session = await getSessionUser()
  if (!session?.orgId) return null
  const base = resolveMailPermissions(session.role)
  let permissions = base
  try {
    const { resolveEffectiveMailPermissions } = await import(
      '@/services/mail/workspace-governance-service'
    )
    const effective = await resolveEffectiveMailPermissions(
      session.orgId,
      session.userId,
      session.role
    )
    permissions = {
      canRead: effective.canRead,
      canWrite: effective.canWrite,
      canManage: effective.canManage,
      canAdmin: effective.canAdmin,
    }
  } catch {
    // fall back to org role matrix
  }
  return {
    orgId: session.orgId,
    actor: { userId: session.userId, email: session.email },
    permissions,
  }
}

function requirePermission(ctx: AuthContext | null, action: MailPermissionType): MailApiResult<never> | null {
  if (!ctx) return { success: false, error: 'Organization not found' }
  if (!hasMailPermission(ctx.permissions, action)) {
    return { success: false, error: getMailErrorMessage('permission denied') }
  }
  return null
}

// ============================================================
// Mailbox Actions
// ============================================================

export async function getMailboxes(): Promise<Mailbox[]> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return []
  try {
    return await mailboxService.listMailboxes(ctx.orgId)
  } catch (err) {
    console.error('[mail-actions] getMailboxes:', err instanceof Error ? err.message : err)
    return []
  }
}

export async function getMailbox(id: string): Promise<Mailbox | null> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return null
  try {
    return await mailboxService.getMailbox(id, ctx.orgId)
  } catch (err) {
    console.error('[mail-actions] getMailbox:', err instanceof Error ? err.message : err)
    return null
  }
}

export async function createMailbox(
  input: CreateMailboxRequest
): Promise<MailApiResult<Mailbox>> {
  const ctx = await getOrgIdAndActor()
  const denied = requirePermission(ctx, 'mail.write')
  if (denied) return denied
  return mailboxService.createMailbox(ctx!.orgId, input)
}

export async function updateMailbox(
  id: string,
  input: UpdateMailboxRequest
): Promise<MailApiResult<Mailbox>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  return mailboxService.updateMailbox(id, ctx.orgId, input)
}

export async function deleteMailbox(
  id: string
): Promise<MailApiResult<boolean>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  return mailboxService.deleteMailbox(id, ctx.orgId)
}

// ============================================================
// Mailbox Pool Actions
// ============================================================

export async function getMailboxPools(): Promise<MailboxPoolResponse[]> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return []
  try {
    return await mailboxService.listPools(ctx.orgId)
  } catch (err) {
    console.error('[mail-actions] getMailboxPools:', err instanceof Error ? err.message : err)
    return []
  }
}

export async function getMailboxPool(id: string): Promise<MailboxPool | null> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return null
  try {
    return await mailboxService.getPool(id, ctx.orgId)
  } catch (err) {
    console.error('[mail-actions] getMailboxPool:', err instanceof Error ? err.message : err)
    return null
  }
}

export async function createMailboxPool(
  input: CreateMailboxPoolRequest
): Promise<MailApiResult<MailboxPoolResponse>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  return mailboxService.createPool(ctx.orgId, input)
}

export async function updateMailboxPool(
  id: string,
  input: UpdateMailboxPoolRequest
): Promise<MailApiResult<MailboxPoolResponse>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  return mailboxService.updatePool(id, ctx.orgId, input)
}

export async function deleteMailboxPool(
  id: string
): Promise<MailApiResult<boolean>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  return mailboxService.deletePool(id, ctx.orgId)
}

export async function addMailboxToPool(
  poolId: string,
  mailboxId: string
): Promise<MailApiResult<boolean>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  return mailboxService.addMailboxToPool(poolId, mailboxId, ctx.orgId)
}

export async function removeMailboxFromPool(
  poolId: string,
  mailboxId: string
): Promise<MailApiResult<boolean>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  return mailboxService.removeMailboxFromPool(poolId, mailboxId, ctx.orgId)
}

export async function removeMailboxFromPoolAction(
  poolId: string,
  mailboxId: string
): Promise<MailApiResult<boolean>> {
  return removeMailboxFromPool(poolId, mailboxId)
}

export async function getPoolMembersList(
  poolId: string
) {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return []
  return mailboxService.getPoolMembers(poolId, ctx.orgId)
}

export async function getAvailableMailboxesForPoolAssignment() {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return []
  return mailboxService.getAvailableMailboxesForPool(ctx.orgId)
}

export async function addMailboxToPoolWithMemberRole(
  poolId: string,
  mailboxId: string,
  role: import('@/types/mail').PoolMembershipRole = 'primary'
): Promise<MailApiResult<boolean>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  return mailboxService.addMailboxToPoolWithRole(poolId, mailboxId, ctx.orgId, role)
}

export async function updatePoolMemberRoleAction(
  poolId: string,
  mailboxId: string,
  role: import('@/types/mail').PoolMembershipRole
): Promise<MailApiResult<boolean>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  return mailboxService.updatePoolMemberRole(poolId, mailboxId, ctx.orgId, role)
}

export async function bulkAddMailboxesToPool(
  poolId: string,
  mailboxIds: string[],
  role: import('@/types/mail').PoolMembershipRole = 'primary'
): Promise<MailApiResult<number>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  return mailboxService.bulkAssignMailboxesToPool(poolId, mailboxIds, ctx.orgId, role)
}

export async function bulkRemoveMailboxesFromPool(
  poolId: string,
  mailboxIds: string[]
): Promise<MailApiResult<number>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  return mailboxService.removeBulkMailboxesFromPool(poolId, mailboxIds, ctx.orgId)
}

// ============================================================
// Mailbox Config Actions
// ============================================================

export async function getMailboxWithConfigs(id: string): Promise<Mailbox | null> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return null
  try {
    const mailbox = await mailboxService.getMailboxWithConfigs(id, ctx.orgId)
    if (!mailbox) return null
    const { toPublicMailboxWithConfigs } = await import('@/lib/credential-safety')
    return toPublicMailboxWithConfigs(mailbox) as Mailbox
  } catch (err) {
    console.error('[mail-actions] getMailboxWithConfigs:', err instanceof Error ? err.message : err)
    return null
  }
}

// ============================================================
// OAuth Config Actions
// ============================================================

export async function getOAuthConfig(
  mailboxId: string
): Promise<OAuthConfigResponse | null> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return null
  try {
    const config = await mailboxService.getOAuthConfig(mailboxId, ctx.orgId)
    if (!config) return null
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
  } catch (err) {
    console.error('[mail-actions] getOAuthConfig:', err instanceof Error ? err.message : err)
    return null
  }
}

export async function createOAuthConfig(
  input: CreateOAuthConfigRequest
): Promise<MailApiResult<OAuthConfigResponse>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  return mailboxService.createOAuthConfig(ctx.orgId, input)
}

export async function updateOAuthConfig(
  id: string,
  data: {
    encryptedRefreshToken?: string | null
    encryptedAccessToken?: string | null
    tokenExpiresAt?: string | null
    scope?: string
  }
): Promise<MailApiResult<OAuthConfigResponse>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  return mailboxService.updateOAuthConfig(id, ctx.orgId, data)
}

export async function deleteOAuthConfig(
  id: string
): Promise<MailApiResult<boolean>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  return mailboxService.deleteOAuthConfig(id, ctx.orgId)
}

// ============================================================
// SMTP Config Actions
// ============================================================

export async function getSMTPConfig(
  mailboxId: string
): Promise<SMTPConfig | null> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return null
  try {
    return await mailboxService.getSMTPConfig(mailboxId, ctx.orgId)
  } catch (err) {
    console.error('[mail-actions] getSMTPConfig:', err instanceof Error ? err.message : err)
    return null
  }
}

export async function createSMTPConfig(
  input: CreateSMTPConfigRequest
): Promise<MailApiResult<SMTPConfigResponse>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  return mailboxService.createSMTPConfig(ctx.orgId, input)
}

export async function updateSMTPConfig(
  id: string,
  data: {
    smtpHost?: string
    smtpPort?: number
    encryption?: string
    username?: string
    encryptedPasswordReference?: string
    authenticationType?: string
  }
): Promise<MailApiResult<SMTPConfigResponse>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  return mailboxService.updateSMTPConfig(id, ctx.orgId, {
    smtpHost: data.smtpHost,
    smtpPort: data.smtpPort,
    encryption: data.encryption as SMTPEncryption | undefined,
    username: data.username,
    encryptedPasswordReference: data.encryptedPasswordReference,
    authenticationType: data.authenticationType as SMTPAuthenticationType | undefined,
  })
}

export async function deleteSMTPConfig(
  id: string
): Promise<MailApiResult<boolean>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  return mailboxService.deleteSMTPConfig(id, ctx.orgId)
}

// ============================================================
// IMAP Config Actions
// ============================================================

export async function getIMAPConfig(
  mailboxId: string
): Promise<IMAPConfig | null> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return null
  try {
    return await mailboxService.getIMAPConfig(mailboxId, ctx.orgId)
  } catch (err) {
    console.error('[mail-actions] getIMAPConfig:', err instanceof Error ? err.message : err)
    return null
  }
}

export async function createIMAPConfig(
  input: CreateIMAPConfigRequest
): Promise<MailApiResult<IMAPConfigResponse>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  return mailboxService.createIMAPConfig(ctx.orgId, input)
}

export async function updateIMAPConfig(
  id: string,
  data: {
    host?: string
    port?: number
    ssl?: boolean
    authentication?: string
  }
): Promise<MailApiResult<IMAPConfigResponse>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  return mailboxService.updateIMAPConfig(id, ctx.orgId, {
    host: data.host,
    port: data.port,
    ssl: data.ssl,
    authentication: data.authentication as 'password' | 'oauth2' | undefined,
  })
}

export async function deleteIMAPConfig(
  id: string
): Promise<MailApiResult<boolean>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  return mailboxService.deleteIMAPConfig(id, ctx.orgId)
}

// ============================================================
// Connection Test Actions
// ============================================================

export async function testMailboxConnection(input: {
  provider: MailboxProvider
  email: string
  smtp: WizardSMTPValues
  imap: WizardIMAPValues
}): Promise<WizardTestResult> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { status: 'failure', errorType: 'unknown', message: 'Organization not found' }

  if (input.provider !== 'custom' && !input.smtp.smtpPassword) {
    return testOAuthConnection(input.provider, input.email)
  }

  return testConnection(input)
}

// ============================================================
// OAuth Flow Actions
// ============================================================

export async function getOAuthAuthorizationUrl(
  provider: MailboxProvider,
  state: string
): Promise<string | null> {
  try {
    const service = getOAuthService(provider as 'gmail' | 'outlook' | 'zoho')
    return service.getAuthorizationUrl(state)
  } catch (err) {
    console.error('[mail-actions] getOAuthAuthorizationUrl:', err instanceof Error ? err.message : err)
    return null
  }
}

export async function completeOAuthMailboxCreation(input: {
  provider: MailboxProvider
  code: string
  email: string
  displayName: string
  senderName: string
  timezone: string
  dailyLimit: number
  poolId?: string | null
}): Promise<MailApiResult<Mailbox>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }

  return mailboxService.createMailboxWithOAuth({
    orgId: ctx.orgId,
    email: input.email,
    displayName: input.displayName,
    senderName: input.senderName,
    provider: input.provider,
    timezone: input.timezone,
    dailyLimit: input.dailyLimit,
    poolId: input.poolId,
    oauthCode: input.code,
  })
}

// ============================================================
// Transactional Mailbox Creation (SMTP/IMAP)
// ============================================================

export async function createMailboxWithConnection(input: {
  email: string
  displayName: string
  senderName: string
  provider: MailboxProvider
  authType: string
  timezone: string
  dailyLimit: number
  poolId?: string | null
  smtp?: WizardSMTPValues | null
  imap?: WizardIMAPValues | null
}): Promise<MailApiResult<Mailbox>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }

  return mailboxService.createMailboxTransactional({
    orgId: ctx.orgId,
    email: input.email,
    displayName: input.displayName,
    senderName: input.senderName,
    provider: input.provider,
    authType: input.authType,
    timezone: input.timezone,
    dailyLimit: input.dailyLimit,
    poolId: input.poolId,
    smtp: input.smtp,
    imap: input.imap,
  })
}

// ============================================================
// Dashboard Actions
// ============================================================

export type PaginatedMailboxesResult = {
  mailboxes: {
    id: string
    email: string
    display_name: string
    provider: MailboxProvider
    pool_id: string | null
    pool_name: string | null
    health_score: number | null
    health_status: string
    mailbox_status: string
    verification_status: string
    warmup_status: string
    daily_limit: number
    current_daily_usage: number
    auth_type: string
    created_at: string
  }[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export async function getMailboxesPaginated(input: {
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
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { mailboxes: [], total: 0, page: 1, pageSize: 25, totalPages: 0 }
  try {
    return await mailboxService.listMailboxesPaginated({ orgId: ctx.orgId, ...input })
  } catch (err) {
    console.error('[mail-actions] getMailboxesPaginated:', err instanceof Error ? err.message : err)
    return { mailboxes: [], total: 0, page: 1, pageSize: 25, totalPages: 0 }
  }
}

export type DashboardStatsResult = {
  total: number
  connected: number
  needsAttention: number
  oauthExpired: number
  smtpErrors: number
  dailyCapacity: number
}

export async function getMailboxDashboardStats(): Promise<DashboardStatsResult> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { total: 0, connected: 0, needsAttention: 0, oauthExpired: 0, smtpErrors: 0, dailyCapacity: 0 }
  try {
    return await mailboxService.getDashboardStats(ctx.orgId)
  } catch (err) {
    console.error('[mail-actions] getMailboxDashboardStats:', err instanceof Error ? err.message : err)
    return { total: 0, connected: 0, needsAttention: 0, oauthExpired: 0, smtpErrors: 0, dailyCapacity: 0 }
  }
}

// ============================================================
// Lifecycle Actions (real backend operations with audit)
// ============================================================

export async function enableMailboxAction(
  id: string
): Promise<MailApiResult<MailboxActionResult>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'mail.manage')
  if (perm) return perm
  return mailboxService.enableMailbox(id, ctx.orgId, ctx.actor)
}

export async function disableMailboxAction(
  id: string
): Promise<MailApiResult<MailboxActionResult>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'mail.manage')
  if (perm) return perm
  return mailboxService.disableMailbox(id, ctx.orgId, ctx.actor)
}

export async function archiveMailboxAction(
  id: string
): Promise<MailApiResult<MailboxActionResult>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'mail.manage')
  if (perm) return perm
  return mailboxService.archiveMailbox(id, ctx.orgId, ctx.actor)
}

export async function restoreMailboxAction(
  id: string
): Promise<MailApiResult<MailboxActionResult>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'mail.manage')
  if (perm) return perm
  return mailboxService.restoreMailbox(id, ctx.orgId, ctx.actor)
}

export async function softDeleteMailboxAction(
  id: string
): Promise<MailApiResult<MailboxActionResult>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'mail.admin')
  if (perm) return perm
  return mailboxService.softDeleteMailbox(id, ctx.orgId, ctx.actor)
}

export async function verifyMailboxConnectionAction(
  id: string
): Promise<MailApiResult<MailboxVerificationResult>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'mail.manage')
  if (perm) return perm
  return mailboxService.verifyMailboxConnection(id, ctx.orgId, ctx.actor)
}

export async function reconnectMailboxAction(
  id: string
): Promise<MailApiResult<MailboxReconnectResult>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'mail.manage')
  if (perm) return perm
  return mailboxService.reconnectMailbox(id, ctx.orgId, ctx.actor)
}

// ============================================================
// Bulk Lifecycle Actions (with per-mailbox results)
// ============================================================

export async function bulkEnableMailboxesAction(
  ids: string[]
): Promise<MailApiResult<MailboxActionResult[]>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'mail.manage')
  if (perm) return perm
  return mailboxService.bulkEnableMailboxes(ids, ctx.orgId, ctx.actor)
}

export async function bulkDisableMailboxesAction(
  ids: string[]
): Promise<MailApiResult<MailboxActionResult[]>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'mail.manage')
  if (perm) return perm
  return mailboxService.bulkDisableMailboxes(ids, ctx.orgId, ctx.actor)
}

export async function bulkArchiveMailboxesAction(
  ids: string[]
): Promise<MailApiResult<MailboxActionResult[]>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'mail.manage')
  if (perm) return perm
  return mailboxService.bulkArchiveMailboxesLifecycle(ids, ctx.orgId, ctx.actor)
}

export async function bulkDeleteMailboxesAction(
  ids: string[]
): Promise<MailApiResult<MailboxActionResult[]>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'mail.admin')
  if (perm) return perm
  return mailboxService.bulkDeleteMailboxesLifecycle(ids, ctx.orgId, ctx.actor)
}

export async function bulkRestoreMailboxesAction(
  ids: string[]
): Promise<MailApiResult<MailboxActionResult[]>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  return mailboxService.bulkRestoreMailboxes(ids, ctx.orgId, ctx.actor)
}

export async function bulkVerifyMailboxesAction(
  ids: string[]
): Promise<MailApiResult<MailboxActionResult[]>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  return mailboxService.bulkVerifyMailboxes(ids, ctx.orgId, ctx.actor)
}

export async function bulkReconnectMailboxesAction(
  ids: string[]
): Promise<MailApiResult<MailboxActionResult[]>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  return mailboxService.bulkReconnectMailboxes(ids, ctx.orgId, ctx.actor)
}

// ============================================================
// Audit Log Actions
// ============================================================

export async function getMailboxAuditLogs(
  mailboxId: string,
  limit?: number,
  offset?: number
): Promise<MailboxAuditLogEntry[]> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return []
  try {
    return await mailboxService.getMailboxAuditLogs(mailboxId, ctx.orgId, limit, offset)
  } catch (err) {
    console.error('[mail-actions] getMailboxAuditLogs:', err instanceof Error ? err.message : err)
    return []
  }
}

export async function getOrgAuditLogs(
  limit?: number,
  offset?: number
): Promise<MailboxAuditLogEntry[]> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return []
  try {
    return await mailboxService.getOrgAuditLogs(ctx.orgId, limit, offset)
  } catch (err) {
    console.error('[mail-actions] getOrgAuditLogs:', err instanceof Error ? err.message : err)
    return []
  }
}

// ============================================================
// Warmup Engine Actions
// ============================================================

export async function createWarmupAction(
  input: CreateWarmupConfigRequest
): Promise<MailApiResult<WarmupConfigResponse>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'mail.manage')
  if (perm) return perm
  return warmupService.createWarmup(ctx.orgId, input, ctx.actor)
}

export async function startWarmupAction(
  configId: string
): Promise<MailApiResult<WarmupConfigResponse>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'mail.manage')
  if (perm) return perm
  return warmupService.startWarmup(configId, ctx.orgId, ctx.actor)
}

export async function pauseWarmupAction(
  configId: string,
  reason: string
): Promise<MailApiResult<WarmupConfigResponse>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'mail.manage')
  if (perm) return perm
  return warmupService.pauseWarmup(configId, ctx.orgId, reason, ctx.actor)
}

export async function resumeWarmupAction(
  configId: string
): Promise<MailApiResult<WarmupConfigResponse>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'mail.manage')
  if (perm) return perm
  return warmupService.resumeWarmup(configId, ctx.orgId, ctx.actor)
}

export async function restartWarmupAction(
  configId: string
): Promise<MailApiResult<WarmupConfigResponse>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'mail.manage')
  if (perm) return perm
  return warmupService.restartWarmup(configId, ctx.orgId, ctx.actor)
}

export async function graduateWarmupAction(
  configId: string,
  force?: boolean
): Promise<MailApiResult<WarmupConfigResponse>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, force ? 'mail.admin' : 'mail.manage')
  if (perm) return perm
  return warmupService.graduateWarmup(configId, ctx.orgId, ctx.actor, { force: force === true })
}

export async function getWarmupPlacementSeriesAction(days = 30) {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return []
  const { getWarmupPlacementSeries } = await import('@/services/mail/warmup-analytics-service')
  return getWarmupPlacementSeries(ctx.orgId, days)
}

export async function getWarmupSimulationSnapshotAction() {
  const ctx = await getOrgIdAndActor()
  if (!ctx) {
    return {
      partnersActive: 0,
      partnersExcluded: 0,
      spamRescues24h: 0,
      opens24h: 0,
      replies24h: 0,
      sends24h: 0,
      avgOpenRate24h: 0,
      contentVariantsLast24h: 0,
    }
  }
  const { getWarmupSimulationSnapshot } = await import('@/services/mail/warmup-analytics-service')
  return getWarmupSimulationSnapshot(ctx.orgId)
}

export async function exportWarmupReportCsvAction(): Promise<string> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return 'id\n'
  const { exportWarmupReportCsv } = await import('@/services/mail/warmup-analytics-service')
  return exportWarmupReportCsv(ctx.orgId)
}

export async function getWarmupPermissionsAction() {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { canRead: false, canWrite: false, canManage: false, canAdmin: false }
  return ctx.permissions
}

export async function deleteWarmupAction(
  configId: string
): Promise<MailApiResult<boolean>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'mail.admin')
  if (perm) return perm
  return warmupService.deleteWarmup(configId, ctx.orgId, ctx.actor)
}

export async function updateWarmupConfigAction(
  configId: string,
  input: UpdateWarmupConfigRequest
): Promise<MailApiResult<WarmupConfigResponse>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'mail.manage')
  if (perm) return perm
  return warmupService.updateWarmupConfig(configId, ctx.orgId, input, ctx.actor)
}

export async function getWarmupAction(
  configId: string
): Promise<MailApiResult<WarmupConfigWithStats>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  return warmupService.getWarmupDetails(configId, ctx.orgId)
}

export async function listWarmupsAction(params: {
  status?: string
  search?: string
  sortBy?: string
  sortDirection?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}): Promise<{
  configs: WarmupConfigResponse[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { configs: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }
  try {
    return await warmupService.listWarmups(ctx.orgId, params)
  } catch (err) {
    console.error('[mail-actions] listWarmupsAction:', err instanceof Error ? err.message : err)
    return { configs: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }
  }
}

export async function getWarmupDashboardAction(): Promise<WarmupDashboardStats> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { totalConfigs: 0, running: 0, paused: 0, graduated: 0, totalMailboxesWarming: 0, avgHealthScore: 0, graduationRate: 0 }
  try {
    return await warmupService.getWarmupDashboard(ctx.orgId)
  } catch (err) {
    console.error('[mail-actions] getWarmupDashboardAction:', err instanceof Error ? err.message : err)
    return { totalConfigs: 0, running: 0, paused: 0, graduated: 0, totalMailboxesWarming: 0, avgHealthScore: 0, graduationRate: 0 }
  }
}

export async function bulkWarmupOperationAction(
  request: WarmupBulkRequest
): Promise<MailApiResult<WarmupBulkResult[]>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'mail.manage')
  if (perm) return perm
  return warmupService.bulkOperation(request, ctx.orgId, ctx.actor)
}

export async function listWarmupTemplatesAction() {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return []
  try {
    return await warmupService.getWarmupTemplates(ctx.orgId)
  } catch (err) {
    console.error('[mail-actions] listWarmupTemplatesAction:', err instanceof Error ? err.message : err)
    return []
  }
}

// ============================================================
// Legacy Actions (kept for backward compatibility)
// ============================================================

export async function bulkUpdateMailboxStatus(
  ids: string[],
  status: string
): Promise<MailApiResult<number>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  return mailboxService.bulkUpdateMailboxStatus(ids, ctx.orgId, status)
}

export async function bulkAssignMailboxPool(
  ids: string[],
  poolId: string | null
): Promise<MailApiResult<number>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  return mailboxService.bulkAssignPool(ids, poolId, ctx.orgId)
}

export async function bulkArchiveMailboxes(
  ids: string[]
): Promise<MailApiResult<number>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  return mailboxService.bulkArchiveMailboxes(ids, ctx.orgId)
}

export async function bulkDeleteMailboxes(
  ids: string[]
): Promise<MailApiResult<number>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  return mailboxService.bulkDeleteMailboxes(ids, ctx.orgId)
}

export async function reconnectMailbox(
  id: string
): Promise<MailApiResult<boolean>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  try {
    const updated = await mailboxService.updateMailbox(id, ctx.orgId, {
      metadata: { lastReconnectAttempt: new Date().toISOString() },
    })
    return { success: true, data: !!updated }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to reconnect mailbox'
    return { success: false, error: message }
  }
}

export async function verifyMailboxConnection(
  id: string
): Promise<MailApiResult<boolean>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  try {
    const mailbox = await mailboxService.getMailboxWithConfigs(id, ctx.orgId)
    if (!mailbox) return { success: false, error: 'Mailbox not found' }
    return { success: true, data: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to verify mailbox'
    return { success: false, error: message }
  }
}

export async function archiveMailbox(
  id: string
): Promise<MailApiResult<boolean>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  return mailboxService.bulkUpdateMailboxStatus([id], ctx.orgId, 'suspended').then(r =>
    r.success ? { success: true as const, data: (r.data ?? 0) > 0 } : r
  )
}

export async function disableMailbox(
  id: string
): Promise<MailApiResult<boolean>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  return mailboxService.bulkUpdateMailboxStatus([id], ctx.orgId, 'disconnected').then(r =>
    r.success ? { success: true as const, data: (r.data ?? 0) > 0 } : r
  )
}

export async function enableMailbox(
  id: string
): Promise<MailApiResult<boolean>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  return mailboxService.bulkUpdateMailboxStatus([id], ctx.orgId, 'connected').then(r =>
    r.success ? { success: true as const, data: (r.data ?? 0) > 0 } : r
  )
}

// ============================================================
// Campaign Actions — delegate to campaigns module
// ============================================================

export async function getCampaigns(): Promise<Campaign[]> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return []
  try {
    const { listCampaigns } = await import('@/services/mail/campaign-service')
    return listCampaigns(ctx.orgId) as unknown as Campaign[]
  } catch (err) {
    console.error('[mail-actions] getCampaigns:', err instanceof Error ? err.message : err)
    return []
  }
}

export async function getCampaign(id: string): Promise<Campaign | null> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return null
  try {
    const { getCampaign: getCamp } = await import('@/services/mail/campaign-service')
    const result = await getCamp(id, ctx.orgId)
    return result.success && result.data ? result.data as unknown as Campaign : null
  } catch (err) {
    console.error('[mail-actions] getCampaign:', err instanceof Error ? err.message : err)
    return null
  }
}

export async function createCampaign(
  input?: import('@/types/campaign').CreateCampaignRequest
): Promise<Campaign | null> {
  const ctx = await getOrgIdAndActor()
  if (!ctx || !input) return null
  try {
    const { createCampaign: createCamp } = await import('@/services/mail/campaign-service')
    const result = await createCamp(ctx.orgId, input, ctx.actor)
    return result.success && result.data ? result.data as unknown as Campaign : null
  } catch (err) {
    console.error('[mail-actions] createCampaign:', err instanceof Error ? err.message : err)
    return null
  }
}

export async function updateCampaign(
  id?: string,
  input?: import('@/types/campaign').UpdateCampaignRequest
): Promise<Campaign | null> {
  const ctx = await getOrgIdAndActor()
  if (!ctx || !id || !input) return null
  try {
    const { updateCampaign: updateCamp } = await import('@/services/mail/campaign-service')
    const result = await updateCamp(id, ctx.orgId, input, ctx.actor)
    return result.success && result.data ? result.data as unknown as Campaign : null
  } catch (err) {
    console.error('[mail-actions] updateCampaign:', err instanceof Error ? err.message : err)
    return null
  }
}

export async function deleteCampaign(id?: string): Promise<boolean> {
  const ctx = await getOrgIdAndActor()
  if (!ctx || !id) return false
  try {
    const { deleteCampaign: deleteCamp } = await import('@/services/mail/campaign-service')
    const result = await deleteCamp(id, ctx.orgId, ctx.actor)
    return result.success && typeof result.data === 'boolean' ? result.data : false
  } catch (err) {
    console.error('[mail-actions] deleteCampaign:', err instanceof Error ? err.message : err)
    return false
  }
}

export async function getMailLeads(): Promise<Lead[]> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return []
  const perm = requirePermission(ctx, 'mail.read')
  if (perm) return []
  try {
    const { listMailLeads } = await import('@/services/mail/lead-service')
    return await listMailLeads(ctx.orgId)
  } catch (err) {
    console.error('[mail-actions] getMailLeads:', err instanceof Error ? err.message : err)
    return []
  }
}

export async function exportMailLeadsCsvAction(): Promise<string> {
  const leads = await getMailLeads()
  const header = ['email', 'name', 'company', 'job_title', 'status', 'verified_status', 'source', 'created_at']
  const rows = [header]
  for (const l of leads) {
    rows.push([
      l.email,
      l.name || '',
      l.company || '',
      l.jobTitle || '',
      l.status || '',
      (l as { verifiedStatus?: string }).verifiedStatus || '',
      l.source || '',
      l.createdAt || '',
    ])
  }
  return rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
}

export async function bulkDeleteMailLeadsAction(ids: string[]): Promise<{ deleted: number }> {
  let deleted = 0
  for (const id of ids) {
    const ok = await deleteMailLead(id)
    if (ok) deleted++
  }
  return { deleted }
}

export async function bulkSuppressMailLeadsAction(ids: string[]): Promise<{ suppressed: number }> {
  const leads = await getMailLeads()
  const byId = new Map(leads.map((l) => [l.id, l]))
  let suppressed = 0
  for (const id of ids) {
    const lead = byId.get(id)
    if (!lead) continue
    const r = await addSuppressionAction(lead.email, 'manual_bulk')
    if (r && 'success' in r ? r.success : Boolean(r)) suppressed++
  }
  return { suppressed }
}

export async function getMailLead(id: string): Promise<Lead | null> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return null
  try {
    const { getMailLeadById } = await import('@/services/mail/lead-service')
    return await getMailLeadById(id, ctx.orgId)
  } catch (err) {
    console.error('[mail-actions] getMailLead:', err instanceof Error ? err.message : err)
    return null
  }
}

export async function createMailLead(
  input?: { email: string; name?: string; company?: string; jobTitle?: string; source?: string }
): Promise<Lead | null> {
  const ctx = await getOrgIdAndActor()
  if (!ctx || !input) return null
  const perm = requirePermission(ctx, 'mail.write')
  if (perm) return null
  try {
    const { createMailLeadRecord } = await import('@/services/mail/lead-service')
    const result = await createMailLeadRecord(ctx.orgId, input)
    return result.success ? result.data ?? null : null
  } catch (err) {
    console.error('[mail-actions] createMailLead:', err instanceof Error ? err.message : err)
    return null
  }
}

export async function updateMailLead(
  id?: string,
  input?: Partial<{ name: string; company: string; jobTitle: string; status: string }>
): Promise<Lead | null> {
  const ctx = await getOrgIdAndActor()
  if (!ctx || !id || !input) return null
  const perm = requirePermission(ctx, 'mail.write')
  if (perm) return null
  try {
    const { updateMailLeadRecord } = await import('@/services/mail/lead-service')
    const result = await updateMailLeadRecord(id, ctx.orgId, input)
    return result.success ? result.data ?? null : null
  } catch (err) {
    console.error('[mail-actions] updateMailLead:', err instanceof Error ? err.message : err)
    return null
  }
}

export async function deleteMailLead(id?: string): Promise<boolean> {
  const ctx = await getOrgIdAndActor()
  if (!ctx || !id) return false
  const perm = requirePermission(ctx, 'mail.manage')
  if (perm) return false
  try {
    const { deleteMailLeadRecord } = await import('@/services/mail/lead-service')
    const result = await deleteMailLeadRecord(id, ctx.orgId)
    return result.success === true
  } catch (err) {
    console.error('[mail-actions] deleteMailLead:', err instanceof Error ? err.message : err)
    return false
  }
}

export async function reverifyMailLeadAction(id: string): Promise<MailApiResult<Lead>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'mail.write')
  if (perm) return perm
  try {
    const { reverifyLeadRecord } = await import('@/services/mail/lead-service')
    return await reverifyLeadRecord(id, ctx.orgId)
  } catch (err) {
    console.error('[mail-actions] reverifyMailLeadAction:', err instanceof Error ? err.message : err)
    return { success: false, error: 'Verification failed' }
  }
}

export async function getLeadVerificationStatsAction(): Promise<{
  total: number
  valid: number
  risky: number
  invalid: number
  unverified: number
  suppressed: number
}> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { total: 0, valid: 0, risky: 0, invalid: 0, unverified: 0, suppressed: 0 }
  try {
    const { getLeadVerificationStats } = await import('@/services/mail/lead-service')
    return await getLeadVerificationStats(ctx.orgId)
  } catch {
    return { total: 0, valid: 0, risky: 0, invalid: 0, unverified: 0, suppressed: 0 }
  }
}

export async function importMailLeadsAction(
  rows: Record<string, string>[],
  mapping: { email: string; name?: string; company?: string; jobTitle?: string }
): Promise<MailApiResult<import('@/services/mail/lead-service').CsvImportResult>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'mail.write')
  if (perm) return perm
  const { importMailLeadsFromCsv } = await import('@/services/mail/lead-service')
  return importMailLeadsFromCsv(ctx.orgId, rows, mapping)
}

export async function previewMailLeadsImportAction(
  rows: Record<string, string>[],
  mapping: { email: string; name?: string; company?: string; jobTitle?: string }
): Promise<MailApiResult<import('@/services/mail/lead-service').CsvImportPreview>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'mail.read')
  if (perm) return perm
  const { previewMailLeadsCsvImport } = await import('@/services/mail/lead-service')
  return previewMailLeadsCsvImport(ctx.orgId, rows, mapping)
}

export async function listSuppressionsAction(search?: string): Promise<
  import('@/services/mail/suppression-service').SuppressionEntry[]
> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return []
  const perm = requirePermission(ctx, 'mail.read')
  if (perm) return []
  const { listSuppressions } = await import('@/services/mail/suppression-service')
  return listSuppressions(ctx.orgId, { search })
}

export async function addSuppressionAction(email: string, reason = 'manual'): Promise<MailApiResult<boolean>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'mail.write')
  if (perm) return perm
  const { suppressEmail } = await import('@/services/mail/suppression-service')
  await suppressEmail(ctx.orgId, email, reason, 'manual')
  return { success: true, data: true }
}

export async function removeSuppressionAction(email: string): Promise<MailApiResult<boolean>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'mail.manage')
  if (perm) return perm
  const { removeSuppression } = await import('@/services/mail/suppression-service')
  const removed = await removeSuppression(ctx.orgId, email)
  return { success: true, data: removed }
}

export async function overrideMailboxDnsRiskAction(
  mailboxId: string
): Promise<MailApiResult<Mailbox>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'mail.manage')
  if (perm) return perm
  const { overrideDmarcRisk } = await import('@/services/mail/dns-gate-service')
  return overrideDmarcRisk(mailboxId, ctx.orgId, ctx.actor)
}

export async function applyMailboxDnsGateAction(
  mailboxId: string
): Promise<MailApiResult<{ status: string; message: string }>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const { applyDnsGateStatus } = await import('@/services/mail/dns-gate-service')
  return applyDnsGateStatus(mailboxId, ctx.orgId)
}

export async function listInboxThreadsAction(opts?: {
  mailboxId?: string
  campaignId?: string
  classification?: string
  search?: string
}) {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return []
  const { listInboxThreads } = await import('@/services/mail/inbox-service')
  return listInboxThreads(ctx.orgId, opts)
}

export async function getInboxThreadAction(threadId: string) {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { thread: null, messages: [] }
  const { getInboxThread } = await import('@/services/mail/inbox-service')
  return getInboxThread(threadId, ctx.orgId)
}

export async function regenerateInboxSuggestionAction(threadId: string) {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false as const, error: 'Organization not found' }
  const { regenerateSuggestedReply } = await import('@/services/mail/inbox-service')
  return regenerateSuggestedReply(threadId, ctx.orgId)
}

export async function sendInboxReplyAction(threadId: string, bodyText: string) {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false as const, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'mail.write')
  if (perm) return perm
  const { sendInboxReply } = await import('@/services/mail/inbox-service')
  return sendInboxReply(threadId, ctx.orgId, bodyText)
}

export async function updateInboxClassificationAction(threadId: string, classification: string) {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false as const, error: 'Organization not found' }
  const { updateThreadClassification } = await import('@/services/mail/inbox-service')
  return updateThreadClassification(threadId, ctx.orgId, classification)
}

export async function bulkInboxAction(
  threadIds: string[],
  action: 'mark_reviewed' | 'archive' | 'suppress'
) {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false as const, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'mail.write')
  if (perm) return perm
  const { bulkUpdateThreads } = await import('@/services/mail/inbox-service')
  return bulkUpdateThreads(ctx.orgId, threadIds, action)
}

export async function exportAnalyticsCsvAction(days = 30): Promise<string> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return ''
  const perm = requirePermission(ctx, 'mail.read')
  if (perm) return ''
  const { exportAnalyticsCsv } = await import('@/services/mail/analytics-service')
  return exportAnalyticsCsv(ctx.orgId, days)
}

export async function exportRawAnalyticsEventsAction(days = 30): Promise<string> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return 'source,event_type\n'
  const perm = requirePermission(ctx, 'mail.read')
  if (perm) return 'source,event_type\n'
  const { exportRawAnalyticsEventsCsv } = await import('@/services/mail/analytics-service')
  return exportRawAnalyticsEventsCsv(ctx.orgId, days)
}

export async function getMailPermissionsAction() {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { canRead: false, canWrite: false, canManage: false, canAdmin: false }
  return ctx.permissions
}

export async function getMailAnalyticsDashboardAction(days = 30) {
  const ctx = await getOrgIdAndActor()
  if (!ctx) {
    return {
      overview: {
        totalSent: 0,
        totalDelivered: 0,
        totalOpened: 0,
        totalClicked: 0,
        totalReplied: 0,
        totalBounced: 0,
        totalUnsubscribed: 0,
        openRate: 0,
        clickRate: 0,
        replyRate: 0,
        bounceRate: 0,
        deliveryRate: 0,
        timeSeries: [],
      },
      campaigns: [],
      mailboxes: [],
      mailboxHealth: [],
      placement: [],
      periodDays: days,
      riskScore: 0,
      recommendations: ['Connect mailboxes and launch campaigns to populate analytics.'],
    }
  }
  const perm = requirePermission(ctx, 'mail.read')
  if (perm) {
    return {
      overview: {
        totalSent: 0,
        totalDelivered: 0,
        totalOpened: 0,
        totalClicked: 0,
        totalReplied: 0,
        totalBounced: 0,
        totalUnsubscribed: 0,
        openRate: 0,
        clickRate: 0,
        replyRate: 0,
        bounceRate: 0,
        deliveryRate: 0,
        timeSeries: [],
      },
      campaigns: [],
      mailboxes: [],
      mailboxHealth: [],
      placement: [],
      periodDays: days,
      riskScore: 0,
      recommendations: ['You need mail.read permission to view analytics.'],
    }
  }
  const { getMailAnalyticsDashboard } = await import('@/services/mail/analytics-service')
  return getMailAnalyticsDashboard(ctx.orgId, days)
}

export async function reconcileAllCampaignsAction(): Promise<{
  checked: number
  balanced: number
  mismatched: number
} | null> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return null
  const perm = requirePermission(ctx, 'mail.manage')
  if (perm) return null
  const { listCampaignAnalytics, reconcileCampaignEvents } = await import(
    '@/services/mail/analytics-service'
  )
  const campaigns = await listCampaignAnalytics(ctx.orgId)
  let balanced = 0
  let mismatched = 0
  for (const c of campaigns.slice(0, 50)) {
    const r = await reconcileCampaignEvents(ctx.orgId, c.campaignId)
    if (r.balanced) balanced++
    else mismatched++
  }
  return { checked: Math.min(campaigns.length, 50), balanced, mismatched }
}

export async function listScheduledReportsAction() {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return []
  const perm = requirePermission(ctx, 'mail.read')
  if (perm) return []
  const { listScheduledReports } = await import('@/services/mail/scheduled-reports-service')
  return listScheduledReports(ctx.orgId)
}

export async function createScheduledReportAction(input: {
  name: string
  reportType: 'campaigns' | 'mailboxes' | 'leads' | 'analytics_raw' | 'placement' | 'usage'
  cadence: 'daily' | 'weekly' | 'monthly'
  recipients: string[]
}) {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false as const, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'mail.manage')
  if (perm) return perm
  if (!input.name.trim()) return { success: false as const, error: 'Name is required' }
  const { createScheduledReport } = await import('@/services/mail/scheduled-reports-service')
  const report = await createScheduledReport({
    organizationId: ctx.orgId,
    name: input.name,
    reportType: input.reportType,
    cadence: input.cadence,
    recipients: input.recipients.filter(Boolean),
    createdBy: ctx.actor.userId,
  })
  return { success: true as const, data: report }
}

export async function updateScheduledReportAction(
  id: string,
  patch: Partial<{
    name: string
    cadence: 'daily' | 'weekly' | 'monthly'
    recipients: string[]
    isActive: boolean
    reportType: 'campaigns' | 'mailboxes' | 'leads' | 'analytics_raw' | 'placement' | 'usage'
  }>
) {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false as const, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'mail.manage')
  if (perm) return perm
  const { updateScheduledReport } = await import('@/services/mail/scheduled-reports-service')
  const report = await updateScheduledReport(id, ctx.orgId, patch)
  if (!report) return { success: false as const, error: 'Report not found' }
  return { success: true as const, data: report }
}

export async function deleteScheduledReportAction(id: string) {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false as const, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'mail.manage')
  if (perm) return perm
  const { deleteScheduledReport } = await import('@/services/mail/scheduled-reports-service')
  const ok = await deleteScheduledReport(id, ctx.orgId)
  return ok ? { success: true as const } : { success: false as const, error: 'Report not found' }
}

export async function listSubAccountsAction() {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return []
  const { listSubAccounts } = await import('@/services/mail/workspace-service')
  return listSubAccounts(ctx.orgId)
}

export async function createSubAccountAction(name: string) {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false as const, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'mail.admin')
  if (perm) return perm
  const { createSubAccount } = await import('@/services/mail/workspace-service')
  return createSubAccount(ctx.orgId, name)
}

export async function getOrgUsageSummaryAction() {
  const ctx = await getOrgIdAndActor()
  if (!ctx) {
    return {
      sends: 0,
      opens: 0,
      clicks: 0,
      replies: 0,
      bounces: 0,
      unsubscribes: 0,
      warmupSends: 0,
    }
  }
  const { getOrgUsageSummary } = await import('@/services/mail/analytics-service')
  return getOrgUsageSummary(ctx.orgId)
}

export async function getWarmupConfigs(): Promise<WarmupConfig[]> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return []
  try {
    const result = await warmupService.listWarmups(ctx.orgId, { page: 1, pageSize: 100 })
    return result.configs.map((c) => {
      let status: WarmupStatus = 'idle'
      if (c.status === 'running') status = 'warming'
      else if (c.status === 'paused') status = 'paused'
      else if (c.status === 'completed' || c.status === 'graduated') status = 'completed'
      else if (c.status === 'failed') status = 'error'
      return {
        id: c.id,
        mailboxId: c.mailboxId,
        status,
        dailyLimit: c.currentDailyTarget,
        currentDay: c.currentDay,
        totalDays: c.totalDays,
        healthScore: null,
        spamScore: null,
        startedAt: c.startDate,
        createdAt: c.createdAt,
      }
    })
  } catch (err) {
    console.error('[mail-actions] getWarmupConfigs:', err instanceof Error ? err.message : err)
    return []
  }
}

export async function getWarmupConfig(id: string): Promise<WarmupConfig | null> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return null
  try {
    const result = await warmupService.getWarmupDetails(id, ctx.orgId)
    if (!result.success || !result.data) return null
    const c = result.data
    return {
      id: c.id,
      mailboxId: c.mailboxId,
      status: c.status === 'running' ? 'warming' : c.status === 'paused' ? 'paused' : 'idle',
      dailyLimit: c.currentDailyTarget,
      currentDay: c.currentDay,
      totalDays: c.totalDays,
      healthScore: null,
      spamScore: null,
      startedAt: c.startDate,
      createdAt: c.createdAt,
    }
  } catch (err) {
    console.error('[mail-actions] getWarmupConfig:', err instanceof Error ? err.message : err)
    return null
  }
}

export async function updateWarmupConfig(
  id?: string,
  input?: UpdateWarmupConfigRequest
): Promise<WarmupConfig | null> {
  const ctx = await getOrgIdAndActor()
  if (!ctx || !id || !input) return null
  const perm = requirePermission(ctx, 'mail.manage')
  if (perm) return null
  const result = await warmupService.updateWarmupConfig(id, ctx.orgId, input, ctx.actor)
  if (!result.success || !result.data) return null
  return getWarmupConfig(id)
}

export async function getSequences(): Promise<Sequence[]> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return []
  try {
    const { listOrgSequences } = await import('@/services/mail/campaign-sequence-service')
    return (await listOrgSequences(ctx.orgId)) as unknown as Sequence[]
  } catch (err) {
    console.error('[mail-actions] getSequences:', err instanceof Error ? err.message : err)
    return []
  }
}

export async function getSequence(id: string): Promise<Sequence | null> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return null
  try {
    const { getSequence: getSeq } = await import('@/services/mail/campaign-sequence-service')
    return (await getSeq(id, ctx.orgId)) as unknown as Sequence | null
  } catch (err) {
    console.error('[mail-actions] getSequence:', err instanceof Error ? err.message : err)
    return null
  }
}

export async function createSequence(
  input?: { name: string; campaignId: string; description?: string }
): Promise<Sequence | null> {
  const ctx = await getOrgIdAndActor()
  if (!ctx || !input?.campaignId) return null
  const perm = requirePermission(ctx, 'mail.write')
  if (perm) return null
  try {
    const { createSequence: createSeq } = await import('@/services/mail/campaign-sequence-service')
    const result = await createSeq(input.campaignId, ctx.orgId, {
      name: input.name,
      description: input.description,
    })
    return result.success && result.data ? (result.data as unknown as Sequence) : null
  } catch (err) {
    console.error('[mail-actions] createSequence:', err instanceof Error ? err.message : err)
    return null
  }
}

export async function updateSequence(
  id?: string,
  input?: { name?: string; description?: string; status?: string }
): Promise<Sequence | null> {
  const ctx = await getOrgIdAndActor()
  if (!ctx || !id || !input) return null
  const perm = requirePermission(ctx, 'mail.write')
  if (perm) return null
  try {
    const { updateSequence: updateSeq } = await import('@/services/mail/campaign-sequence-service')
    const result = await updateSeq(id, ctx.orgId, input)
    return result.success && result.data ? (result.data as unknown as Sequence) : null
  } catch (err) {
    console.error('[mail-actions] updateSequence:', err instanceof Error ? err.message : err)
    return null
  }
}

export async function deleteSequence(id?: string): Promise<boolean> {
  const ctx = await getOrgIdAndActor()
  if (!ctx || !id) return false
  const perm = requirePermission(ctx, 'mail.manage')
  if (perm) return false
  try {
    const { deleteSequence: deleteSeq } = await import('@/services/mail/campaign-sequence-service')
    const result = await deleteSeq(id, ctx.orgId)
    return result.success === true && result.data === true
  } catch (err) {
    console.error('[mail-actions] deleteSequence:', err instanceof Error ? err.message : err)
    return false
  }
}

export async function getMailAnalytics(): Promise<AnalyticsOverview> {
  const empty: AnalyticsOverview = {
    totalSent: 0,
    totalDelivered: 0,
    totalOpened: 0,
    totalClicked: 0,
    totalReplied: 0,
    totalBounced: 0,
    totalUnsubscribed: 0,
    openRate: 0,
    clickRate: 0,
    replyRate: 0,
    bounceRate: 0,
    deliveryRate: 0,
    timeSeries: [],
  }
  const ctx = await getOrgIdAndActor()
  if (!ctx) return empty
  try {
    const { getMailAnalyticsOverview } = await import('@/services/mail/analytics-service')
    return await getMailAnalyticsOverview(ctx.orgId)
  } catch (err) {
    console.error('[mail-actions] getMailAnalytics:', err instanceof Error ? err.message : err)
    return empty
  }
}

export async function getMailSettings(): Promise<MailSettings | null> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return null
  try {
    const { getOrgMailSettings } = await import('@/services/mail/settings-service')
    return await getOrgMailSettings(ctx.orgId)
  } catch (err) {
    console.error('[mail-actions] getMailSettings:', err instanceof Error ? err.message : err)
    return null
  }
}

export async function updateMailSettings(
  input?: Partial<MailSettings>
): Promise<MailSettings | null> {
  const ctx = await getOrgIdAndActor()
  if (!ctx || !input) return null
  const perm = requirePermission(ctx, 'mail.manage')
  if (perm) return null
  try {
    const { updateOrgMailSettings } = await import('@/services/mail/settings-service')
    return await updateOrgMailSettings(ctx.orgId, input, ctx.actor)
  } catch (err) {
    console.error('[mail-actions] updateMailSettings:', err instanceof Error ? err.message : err)
    return null
  }
}

// ============================================================
// Operations Center — queue / API keys / webhooks
// ============================================================

export async function getSendQueueStatsAction() {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { pending: 0, processing: 0, deferred: 0, failed: 0, sent: 0, cancelled: 0 }
  try {
    const { getSendQueueStats } = await import('@/services/mail/operations-service')
    return await getSendQueueStats(ctx.orgId)
  } catch {
    return { pending: 0, processing: 0, deferred: 0, failed: 0, sent: 0, cancelled: 0 }
  }
}

export async function listSendQueueJobsAction(status?: string) {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return []
  try {
    const { listSendQueueJobs } = await import('@/services/mail/operations-service')
    return await listSendQueueJobs(ctx.orgId, { status, limit: 75 })
  } catch {
    return []
  }
}

export async function retrySendJobAction(jobId: string): Promise<MailApiResult<boolean>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'mail.manage')
  if (perm) return perm
  const { retryFailedSendJob } = await import('@/services/mail/operations-service')
  return retryFailedSendJob(jobId, ctx.orgId)
}

export async function cancelSendJobAction(jobId: string): Promise<MailApiResult<boolean>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'mail.manage')
  if (perm) return perm
  const { cancelSendJob } = await import('@/services/mail/operations-service')
  return cancelSendJob(jobId, ctx.orgId)
}

export async function listApiKeysAction() {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return []
  try {
    const { listApiKeys } = await import('@/services/mail/operations-service')
    return await listApiKeys(ctx.orgId)
  } catch {
    return []
  }
}

export async function createApiKeyAction(name: string, scopes: string[] = ['mail.read', 'mail.write']) {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false as const, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'mail.manage')
  if (perm) return perm
  const { createApiKey } = await import('@/services/mail/operations-service')
  return createApiKey(ctx.orgId, name, scopes, ctx.actor.userId)
}

export async function revokeApiKeyAction(id: string): Promise<MailApiResult<boolean>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'mail.manage')
  if (perm) return perm
  const { revokeApiKey } = await import('@/services/mail/operations-service')
  return revokeApiKey(id, ctx.orgId)
}

export async function listWebhooksAction() {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return []
  try {
    const { listWebhooks } = await import('@/services/mail/operations-service')
    return await listWebhooks(ctx.orgId)
  } catch {
    return []
  }
}

export async function createWebhookAction(input: { name: string; url: string }) {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false as const, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'mail.manage')
  if (perm) return perm
  const { createWebhook } = await import('@/services/mail/operations-service')
  return createWebhook(ctx.orgId, input)
}

export async function deleteWebhookAction(id: string): Promise<MailApiResult<boolean>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'mail.manage')
  if (perm) return perm
  const { deleteWebhook } = await import('@/services/mail/operations-service')
  return deleteWebhook(id, ctx.orgId)
}

export async function toggleWebhookAction(id: string, isActive: boolean): Promise<MailApiResult<boolean>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'mail.manage')
  if (perm) return perm
  const { toggleWebhook } = await import('@/services/mail/operations-service')
  return toggleWebhook(id, ctx.orgId, isActive)
}

export async function listWebhookLogsAction() {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return []
  try {
    const { listWebhookLogs } = await import('@/services/mail/operations-service')
    return await listWebhookLogs(ctx.orgId, 50)
  } catch {
    return []
  }
}

export async function getEngageOverviewAction() {
  const ctx = await getOrgIdAndActor()
  if (!ctx) {
    return null
  }
  try {
    const { getEngageOverviewSnapshot } = await import('@/services/mail/engage-product-service')
    return await getEngageOverviewSnapshot(ctx.orgId)
  } catch {
    return null
  }
}

export async function exportEngageReportAction(
  report: 'campaigns' | 'mailboxes' | 'leads'
): Promise<{ csv: string; filename: string } | null> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return null
  try {
    const svc = await import('@/services/mail/engage-product-service')
    const rows =
      report === 'campaigns'
        ? await svc.buildCampaignPerformanceReport(ctx.orgId)
        : report === 'mailboxes'
          ? await svc.buildMailboxHealthReport(ctx.orgId)
          : await svc.buildLeadHygieneReport(ctx.orgId)
    return {
      csv: svc.rowsToCsv(rows),
      filename: `engage-${report}-${new Date().toISOString().slice(0, 10)}.csv`,
    }
  } catch {
    return null
  }
}

// ============================================================
// Lead lists & campaign enrollment (PRD §6.5 / §13.D)
// ============================================================

export async function listLeadListsAction(params?: { search?: string; page?: number; pageSize?: number }) {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { lists: [], total: 0, page: 1, pageSize: 20, totalPages: 1 }
  try {
    const { listLeadLists } = await import('@/services/mail/lead-list-service')
    return await listLeadLists(ctx.orgId, params)
  } catch {
    return { lists: [], total: 0, page: 1, pageSize: 20, totalPages: 1 }
  }
}

export async function createLeadListAction(input: { name: string; description?: string }) {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false as const, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'mail.write')
  if (perm) return perm
  const { createLeadList } = await import('@/services/mail/lead-list-service')
  return createLeadList(ctx.orgId, input)
}

export async function updateLeadListAction(id: string, input: { name?: string; description?: string }) {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false as const, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'mail.write')
  if (perm) return perm
  const { updateLeadList } = await import('@/services/mail/lead-list-service')
  return updateLeadList(id, ctx.orgId, input)
}

export async function deleteLeadListAction(id: string) {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false as const, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'mail.manage')
  if (perm) return perm
  const { deleteLeadList } = await import('@/services/mail/lead-list-service')
  return deleteLeadList(id, ctx.orgId)
}

export async function addLeadsToListAction(listId: string, leadIds: string[]) {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false as const, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'mail.write')
  if (perm) return perm
  const { addLeadsToList } = await import('@/services/mail/lead-list-service')
  return addLeadsToList(listId, ctx.orgId, leadIds)
}

export async function removeLeadFromListAction(listId: string, leadId: string) {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false as const, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'mail.write')
  if (perm) return perm
  const { removeLeadFromList } = await import('@/services/mail/lead-list-service')
  return removeLeadFromList(listId, ctx.orgId, leadId)
}

export async function listLeadListMembersAction(
  listId: string,
  opts?: { page?: number; pageSize?: number; search?: string }
) {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { members: [], total: 0, page: 1, pageSize: 25 }
  try {
    const { listLeadListMembers } = await import('@/services/mail/lead-list-service')
    return await listLeadListMembers(listId, ctx.orgId, opts)
  } catch {
    return { members: [], total: 0, page: 1, pageSize: 25 }
  }
}

export async function previewListEnrollmentAction(campaignId: string, listId: string) {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false as const, error: 'Organization not found' }
  const { previewListEnrollment } = await import('@/services/mail/lead-list-service')
  return previewListEnrollment(ctx.orgId, campaignId, listId)
}

export async function enrollListIntoCampaignAction(campaignId: string, listId: string) {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false as const, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'mail.write')
  if (perm) return perm
  const { enrollListIntoCampaign } = await import('@/services/mail/lead-list-service')
  return enrollListIntoCampaign(ctx.orgId, campaignId, listId)
}


// ============================================================
// Workspace governance (PRD §6.8)
// ============================================================

export async function listWorkspaceMembersAction() {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return []
  const perm = requirePermission(ctx, 'mail.read')
  if (perm) return []
  const { listWorkspaceMembers } = await import('@/services/mail/workspace-governance-service')
  return listWorkspaceMembers(ctx.orgId)
}

export async function listOrgMembersForMailInviteAction() {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return []
  const perm = requirePermission(ctx, 'mail.manage')
  if (perm) return []
  const { listOrgMembersForInvite } = await import('@/services/mail/workspace-governance-service')
  return listOrgMembersForInvite(ctx.orgId)
}

export async function upsertWorkspaceMemberAction(input: {
  userId: string
  email: string
  displayName?: string
  mailRole: 'viewer' | 'member' | 'manager' | 'admin'
  canLaunchCampaigns?: boolean
}) {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false as const, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'mail.admin')
  if (perm) return perm
  const { upsertWorkspaceMember } = await import('@/services/mail/workspace-governance-service')
  return upsertWorkspaceMember({
    organizationId: ctx.orgId,
    userId: input.userId,
    email: input.email,
    displayName: input.displayName,
    mailRole: input.mailRole,
    canLaunchCampaigns: input.canLaunchCampaigns,
    invitedBy: ctx.actor.userId,
  })
}

export async function removeWorkspaceMemberAction(userId: string) {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false as const, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'mail.admin')
  if (perm) return perm
  const { removeWorkspaceMember } = await import('@/services/mail/workspace-governance-service')
  return removeWorkspaceMember(ctx.orgId, userId)
}

export async function getWorkspaceLifecycleAction() {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return null
  const { getWorkspaceLifecycle } = await import('@/services/mail/workspace-governance-service')
  return getWorkspaceLifecycle(ctx.orgId)
}

export async function startWorkspaceGraceAction(days = 30, reason = 'downgrade') {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false as const, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'mail.admin')
  if (perm) return perm
  const { startWorkspaceGracePeriod } = await import('@/services/mail/workspace-governance-service')
  const data = await startWorkspaceGracePeriod(ctx.orgId, days, reason)
  return { success: true as const, data }
}

export async function restoreWorkspaceAction() {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false as const, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'mail.admin')
  if (perm) return perm
  const { restoreWorkspaceActive } = await import('@/services/mail/workspace-governance-service')
  const data = await restoreWorkspaceActive(ctx.orgId)
  return { success: true as const, data }
}

export async function listUnifiedAuditEventsAction(opts?: { limit?: number; entityType?: string; search?: string }) {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return []
  const perm = requirePermission(ctx, 'mail.read')
  if (perm) return []
  const { listAuditEvents } = await import('@/services/mail/workspace-governance-service')
  return listAuditEvents(ctx.orgId, opts)
}

export async function getBillingUsageSnapshotAction() {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return null
  const perm = requirePermission(ctx, 'mail.read')
  if (perm) return null
  const { getBillingUsageSnapshot } = await import('@/services/mail/workspace-governance-service')
  return getBillingUsageSnapshot(ctx.orgId)
}

export async function assignMailboxToSubAccountAction(mailboxId: string, subAccountId: string | null) {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false as const, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'mail.manage')
  if (perm) return perm
  const { assignMailboxToSubAccount } = await import('@/services/mail/workspace-service')
  const result = await assignMailboxToSubAccount(mailboxId, ctx.orgId, subAccountId)
  if (result.success) {
    const { recordAuditEvent } = await import('@/services/mail/workspace-governance-service')
    await recordAuditEvent({
      organizationId: ctx.orgId,
      actorUserId: ctx.actor.userId,
      actorEmail: ctx.actor.email,
      entityType: 'mailbox',
      entityId: mailboxId,
      action: 'sub_account_assign',
      summary: subAccountId ? `Assigned mailbox to sub-account ${subAccountId}` : 'Cleared sub-account assignment',
    })
  }
  return result
}

export async function getPlanLimitsAction() {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return null
  const { getOrgPlanLimits } = await import('@/services/mail/plan-limits-service')
  return getOrgPlanLimits(ctx.orgId)
}
