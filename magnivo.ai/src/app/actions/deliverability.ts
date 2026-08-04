'use server'

import { getSessionUser } from '@/lib/auth'
import * as deliverabilityService from '@/services/mail/deliverability-service'
import * as monitoringService from '@/services/mail/monitoring-service'
import * as returnPathService from '@/services/mail/return-path-service'
import * as dkimService from '@/services/mail/dkim-service'
import * as blacklistService from '@/services/mail/blacklist-service'
import * as reputationService from '@/services/mail/reputation-service'
import * as complaintService from '@/services/mail/complaint-service'
import * as bounceService from '@/services/mail/bounce-service'
import * as postmasterService from '@/services/mail/postmaster-service'
import * as sndsService from '@/services/mail/snds-service'
import * as monitoringSchedulerService from '@/services/mail/monitoring-scheduler-service'
import * as trackingService from '@/services/mail/tracking-service'
import * as trackingDomainService from '@/services/mail/tracking-domain-service'
import { getProviderDnsInstructions, getAllProviders } from '@/services/mail/provider-instructions'
import type {
  CreateDomainRequest,
  VerifyDomainRequest,
  BulkVerifyRequest,
  UpdateDomainRequest,
  DomainVerificationResult,
  DeliverabilityDashboardStats,
  DeliverabilityDomain,
  VerificationHistoryEntry,
  DnsRecord,
  TrackingDomain,
  DeliverabilityApiResult,
  DnsProvider,
  CreateReturnPathRequest,
  UpdateReturnPathRequest,
  CreateDkimSelectorRequest,
  RotateDkimRequest,
  BlacklistName,
  ReturnPath,
  DkimSelector,
  BlacklistCheck,
  DomainReputation,
  MailboxReputation,
  ComplaintRecord,
  BounceRecord,
  PostmasterDomain,
  PostmasterMetrics,
  SndsDomain,
  SndsMetrics,
  MonitoringJob,
  MonitoringConfig,
  TrackingToken,
  TrackingPixelEvent,
  ClickEvent,
  ComplaintDashboardStats,
  BounceDashboardStats,
  PostmasterDashboardStats,
  SndsDashboardStats,
  BlacklistDashboardStats,
  ReputationDashboardStats,
  TrackingDashboardStats,
} from '@/types/deliverability'
import type { MailboxDomainGroup } from '@/repositories/mail/mailbox-repository'

type ActorInfo = { userId: string; email: string }
type AuthContext = { orgId: string; actor: ActorInfo }

async function getAuthContext(): Promise<AuthContext | null> {
  const session = await getSessionUser()
  if (!session?.orgId) return null
  return {
    orgId: session.orgId,
    actor: { userId: session.userId, email: session.email },
  }
}

// ============================================================
// Domain CRUD
// ============================================================

export async function getDeliverabilityDomains(): Promise<DeliverabilityDomain[]> {
  const ctx = await getAuthContext()
  if (!ctx) return []
  try {
    return await deliverabilityService.listDomains(ctx.orgId)
  } catch (err) {
    console.error('[deliverability-actions] getDeliverabilityDomains:', err instanceof Error ? err.message : err)
    return []
  }
}

export async function getDeliverabilityDomain(id: string): Promise<DeliverabilityDomain | null> {
  const ctx = await getAuthContext()
  if (!ctx) return null
  try {
    return await deliverabilityService.getDomain(id, ctx.orgId)
  } catch {
    return null
  }
}

export async function createDeliverabilityDomain(
  input: CreateDomainRequest
): Promise<DeliverabilityApiResult<DeliverabilityDomain>> {
  const ctx = await getAuthContext()
  if (!ctx) return { success: false, error: 'Not authenticated' }
  const result = await deliverabilityService.createDomain(ctx.orgId, input)
  if (result.error) return { success: false, error: result.error }
  return { success: true, data: result.domain }
}

export async function updateDeliverabilityDomain(
  id: string,
  input: UpdateDomainRequest
): Promise<DeliverabilityApiResult<DeliverabilityDomain>> {
  const ctx = await getAuthContext()
  if (!ctx) return { success: false, error: 'Not authenticated' }
  const result = await deliverabilityService.updateDomain(id, ctx.orgId, input)
  if (result.error) return { success: false, error: result.error }
  if (!result.domain) return { success: false, error: 'Domain not found' }
  return { success: true, data: result.domain }
}

export async function deleteDeliverabilityDomain(
  id: string
): Promise<DeliverabilityApiResult<boolean>> {
  const ctx = await getAuthContext()
  if (!ctx) return { success: false, error: 'Not authenticated' }
  const result = await deliverabilityService.deleteDomain(id, ctx.orgId)
  if (result.error) return { success: false, error: result.error }
  return { success: true, data: true }
}

// ============================================================
// Verification
// ============================================================

export async function verifyDomain(
  input: VerifyDomainRequest
): Promise<DeliverabilityApiResult<DomainVerificationResult>> {
  const ctx = await getAuthContext()
  if (!ctx) return { success: false, error: 'Not authenticated' }
  const result = await deliverabilityService.verifyDomain(
    input,
    ctx.orgId,
    ctx.actor.userId,
    ctx.actor.email
  )
  if (result.error) return { success: false, error: result.error }
  if (!result.result) return { success: false, error: 'Verification failed' }
  return { success: true, data: result.result }
}

export async function bulkVerifyDomains(
  input: BulkVerifyRequest
): Promise<DeliverabilityApiResult<{ domainId: string; success: boolean; error?: string }[]>> {
  const ctx = await getAuthContext()
  if (!ctx) return { success: false, error: 'Not authenticated' }
  const result = await deliverabilityService.bulkVerify(
    input,
    ctx.orgId,
    ctx.actor.userId,
    ctx.actor.email
  )
  return { success: true, data: result.results }
}

// ============================================================
// History & Records
// ============================================================

export async function getDomainHistory(
  domainId: string,
  limit?: number,
  offset?: number
): Promise<VerificationHistoryEntry[]> {
  const ctx = await getAuthContext()
  if (!ctx) return []
  return deliverabilityService.getDomainHistory(domainId, ctx.orgId, limit, offset)
}

export async function getDomainDnsRecords(domainId: string): Promise<DnsRecord[]> {
  const ctx = await getAuthContext()
  if (!ctx) return []
  return deliverabilityService.getDomainDnsRecords(domainId, ctx.orgId)
}

export async function getTrackingDomainsForDomain(domainId: string): Promise<TrackingDomain[]> {
  const ctx = await getAuthContext()
  if (!ctx) return []
  return deliverabilityService.getTrackingDomains(domainId, ctx.orgId)
}

// ============================================================
// Dashboard & Notifications
// ============================================================

export async function getDeliverabilityDashboardStats(): Promise<DeliverabilityDashboardStats> {
  const ctx = await getAuthContext()
  if (!ctx) return { totalDomains: 0, healthyDomains: 0, needsAttention: 0, failedDomains: 0, avgHealthScore: 0, unreadNotifications: 0 }
  return deliverabilityService.getDashboardStats(ctx.orgId)
}

// ============================================================
// Monitoring
// ============================================================

export async function runDomainCheck(): Promise<{ checked: number; succeeded: number; failed: number }> {
  return monitoringService.runMonitoringChecks()
}

export async function getDomainFailures(domainId: string): Promise<{ failures: string[]; warnings: string[] }> {
  const ctx = await getAuthContext()
  if (!ctx) return { failures: [], warnings: [] }
  return monitoringService.detectFailures(domainId, ctx.orgId)
}

// ============================================================
// Provider Instructions
// ============================================================

export async function getDnsInstructions(
  domain: string,
  recordType: 'spf' | 'dkim' | 'dmarc' | 'tracking' | 'return_path',
  provider: DnsProvider,
  dkimSelector?: string
) {
  return getProviderDnsInstructions(domain, recordType, provider, dkimSelector)
}

export async function getDnsProviders() {
  return getAllProviders()
}

// ============================================================
// Mailbox-Domain Grouping
// ============================================================

export async function getMailboxDomainGroups(): Promise<MailboxDomainGroup[]> {
  const ctx = await getAuthContext()
  if (!ctx) return []
  try {
    return await deliverabilityService.getMailboxesGroupedByDomain(ctx.orgId)
  } catch (err) {
    console.error('[deliverability-actions] getMailboxDomainGroups:', err instanceof Error ? err.message : err)
    return []
  }
}

export async function getDomainWithMailboxes(): Promise<{
  domains: DeliverabilityDomain[]
  mailboxGroups: MailboxDomainGroup[]
}> {
  const ctx = await getAuthContext()
  if (!ctx) return { domains: [], mailboxGroups: [] }
  try {
    return await deliverabilityService.getDomainWithMailboxes(ctx.orgId)
  } catch (err) {
    console.error('[deliverability-actions] getDomainWithMailboxes:', err instanceof Error ? err.message : err)
    return { domains: [], mailboxGroups: [] }
  }
}

// ============================================================
// Notifications
// ============================================================

export async function getNotifications(unreadOnly?: boolean): Promise<unknown[]> {
  const ctx = await getAuthContext()
  if (!ctx) return []
  return deliverabilityService.getNotifications(ctx.orgId, unreadOnly)
}

export async function markNotificationRead(notificationId: string): Promise<boolean> {
  const ctx = await getAuthContext()
  if (!ctx) return false
  return deliverabilityService.markNotificationRead(notificationId, ctx.orgId)
}

export async function dismissNotification(notificationId: string): Promise<boolean> {
  const ctx = await getAuthContext()
  if (!ctx) return false
  return deliverabilityService.dismissNotification(notificationId, ctx.orgId)
}

// ============================================================
// Return Path Management
// ============================================================

export async function getReturnPaths(domainId?: string): Promise<ReturnPath[]> {
  const ctx = await getAuthContext()
  if (!ctx) return []
  if (domainId) {
    const domain = await deliverabilityService.getDomain(domainId, ctx.orgId)
    if (!domain) return []
    return returnPathService.listReturnPathsByDomain(domainId)
  }
  return returnPathService.listReturnPaths(ctx.orgId)
}

export async function createReturnPath(input: CreateReturnPathRequest): Promise<DeliverabilityApiResult<ReturnPath>> {
  const ctx = await getAuthContext()
  if (!ctx) return { success: false, error: 'Not authenticated' }
  const result = await returnPathService.createReturnPath(ctx.orgId, input)
  if (result.error) return { success: false, error: result.error }
  return { success: true, data: result.returnPath }
}

export async function updateReturnPathAction(id: string, input: UpdateReturnPathRequest): Promise<DeliverabilityApiResult<ReturnPath>> {
  const ctx = await getAuthContext()
  if (!ctx) return { success: false, error: 'Not authenticated' }
  const result = await returnPathService.updateReturnPath(id, ctx.orgId, input)
  if (result.error) return { success: false, error: result.error }
  if (!result.returnPath) return { success: false, error: 'Not found' }
  return { success: true, data: result.returnPath }
}

export async function deleteReturnPathAction(id: string): Promise<DeliverabilityApiResult<boolean>> {
  const ctx = await getAuthContext()
  if (!ctx) return { success: false, error: 'Not authenticated' }
  const result = await returnPathService.deleteReturnPath(id, ctx.orgId)
  if (result.error) return { success: false, error: result.error }
  return { success: true, data: true }
}

export async function verifyReturnPathAction(id: string): Promise<DeliverabilityApiResult<{ status: string }>> {
  const ctx = await getAuthContext()
  if (!ctx) return { success: false, error: 'Not authenticated' }
  const result = await returnPathService.verifyReturnPath(id, ctx.orgId)
  if (result.error) return { success: false, error: result.error }
  return { success: true, data: { status: result.status } }
}

export async function setDefaultReturnPathAction(id: string, domainId: string): Promise<DeliverabilityApiResult<boolean>> {
  const ctx = await getAuthContext()
  if (!ctx) return { success: false, error: 'Not authenticated' }
  const result = await returnPathService.setDefaultReturnPath(id, domainId, ctx.orgId)
  if (result.error) return { success: false, error: result.error }
  return { success: true, data: true }
}

export async function getReturnPathAuditHistory(returnPathId: string): Promise<unknown[]> {
  const ctx = await getAuthContext()
  if (!ctx) return []
  return returnPathService.getAuditHistory(returnPathId)
}

// ============================================================
// DKIM Selector Management
// ============================================================

export async function getDkimSelectors(domainId?: string): Promise<DkimSelector[]> {
  const ctx = await getAuthContext()
  if (!ctx) return []
  if (domainId) {
    const domain = await deliverabilityService.getDomain(domainId, ctx.orgId)
    if (!domain) return []
    return dkimService.listSelectorsByDomain(domainId)
  }
  return dkimService.listSelectors(ctx.orgId)
}

export async function createDkimSelectorAction(input: CreateDkimSelectorRequest): Promise<DeliverabilityApiResult<DkimSelector>> {
  const ctx = await getAuthContext()
  if (!ctx) return { success: false, error: 'Not authenticated' }
  const result = await dkimService.createSelector(ctx.orgId, input.domainId, input.selector)
  if (result.error) return { success: false, error: result.error }
  return { success: true, data: result.selector }
}

export async function verifyDkimSelectorAction(id: string): Promise<DeliverabilityApiResult<{ status: string }>> {
  const ctx = await getAuthContext()
  if (!ctx) return { success: false, error: 'Not authenticated' }
  const result = await dkimService.verifySelector(id, ctx.orgId)
  if (result.error) return { success: false, error: result.error }
  return { success: true, data: { status: result.status } }
}

export async function rotateDkimSelectorAction(input: RotateDkimRequest): Promise<DeliverabilityApiResult<DkimSelector>> {
  const ctx = await getAuthContext()
  if (!ctx) return { success: false, error: 'Not authenticated' }
  const result = await dkimService.rotateSelector(ctx.orgId, input.domainId, input.currentSelectorId, input.newSelector)
  if (result.error) return { success: false, error: result.error }
  return { success: true, data: result.selector }
}

export async function deleteDkimSelectorAction(id: string): Promise<DeliverabilityApiResult<boolean>> {
  const ctx = await getAuthContext()
  if (!ctx) return { success: false, error: 'Not authenticated' }
  const result = await dkimService.deleteSelector(id, ctx.orgId)
  if (result.error) return { success: false, error: result.error }
  return { success: true, data: true }
}

export async function getDkimSelectorHistory(selectorId: string): Promise<unknown[]> {
  const ctx = await getAuthContext()
  if (!ctx) return []
  return dkimService.getSelectorHistory(selectorId)
}

// ============================================================
// Blacklist Monitoring
// ============================================================

export async function checkBlacklist(domainId: string, blacklistName: BlacklistName, ip?: string): Promise<DeliverabilityApiResult<{ status: string }>> {
  const ctx = await getAuthContext()
  if (!ctx) return { success: false, error: 'Not authenticated' }
  const result = await blacklistService.checkBlacklistForDomain(ctx.orgId, domainId, blacklistName, ip)
  if (result.error) return { success: false, error: result.error }
  return { success: true, data: { status: result.status } }
}

export async function checkAllBlacklists(domainId: string, ip?: string): Promise<DeliverabilityApiResult<{ results: { blacklist: BlacklistName; status: string }[] }>> {
  const ctx = await getAuthContext()
  if (!ctx) return { success: false, error: 'Not authenticated' }
  const result = await blacklistService.checkAllBlacklistsForDomain(ctx.orgId, domainId, ip)
  return { success: true, data: result }
}

export async function getBlacklistOverviewAction(domainId: string): Promise<unknown> {
  const ctx = await getAuthContext()
  if (!ctx) return null
  const domain = await deliverabilityService.getDomain(domainId, ctx.orgId)
  if (!domain) return null
  return blacklistService.getBlacklistOverview(domainId)
}

export async function getBlacklistDashboardStatsAction(): Promise<BlacklistDashboardStats> {
  const ctx = await getAuthContext()
  if (!ctx) return { totalDomainsChecked: 0, cleanDomains: 0, listedDomains: 0, unknownDomains: 0, recentListings: [] }
  return blacklistService.getBlacklistDashboardStats(ctx.orgId)
}

export async function getBlacklistHistory(domainId: string): Promise<unknown[]> {
  const ctx = await getAuthContext()
  if (!ctx) return []
  const domain = await deliverabilityService.getDomain(domainId, ctx.orgId)
  if (!domain) return []
  return blacklistService.getBlacklistHistory(domainId)
}

// ============================================================
// Reputation Monitoring
// ============================================================

export async function getReputationDashboard(): Promise<ReputationDashboardStats> {
  const ctx = await getAuthContext()
  if (!ctx) return { domainsTracked: 0, avgReputationScore: 50, improvingDomains: 0, decliningDomains: 0, recentEntries: [] }
  return reputationService.getReputationDashboardStats(ctx.orgId)
}

export async function getDomainReputationsAction(): Promise<DomainReputation[]> {
  const ctx = await getAuthContext()
  if (!ctx) return []
  return reputationService.getDomainReputations(ctx.orgId)
}

export async function getDomainReputationHistoryAction(domainId: string): Promise<DomainReputation[]> {
  const ctx = await getAuthContext()
  if (!ctx) return []
  const domain = await deliverabilityService.getDomain(domainId, ctx.orgId)
  if (!domain) return []
  return reputationService.getDomainReputationHistory(domainId)
}

export async function getDomainReputationTrendAction(domainId: string): Promise<unknown[]> {
  const ctx = await getAuthContext()
  if (!ctx) return []
  const domain = await deliverabilityService.getDomain(domainId, ctx.orgId)
  if (!domain) return []
  return reputationService.getDomainReputationTrend(domainId)
}

export async function getMailboxReputationsAction(domainId?: string): Promise<MailboxReputation[]> {
  const ctx = await getAuthContext()
  if (!ctx) return []
  return reputationService.getMailboxReputations(ctx.orgId, domainId)
}

// ============================================================
// Complaint Monitoring
// ============================================================

export async function getComplaints(limit?: number): Promise<ComplaintRecord[]> {
  const ctx = await getAuthContext()
  if (!ctx) return []
  return complaintService.listComplaints(ctx.orgId, limit)
}

export async function getComplaintDashboard(): Promise<ComplaintDashboardStats> {
  const ctx = await getAuthContext()
  if (!ctx) return { totalComplaints: 0, activeComplaints: 0, resolvedComplaints: 0, autoPausedMailboxes: 0, recentComplaints: [] }
  return complaintService.getComplaintDashboardStats(ctx.orgId)
}

export async function resolveComplaintAction(id: string): Promise<DeliverabilityApiResult<ComplaintRecord>> {
  const ctx = await getAuthContext()
  if (!ctx) return { success: false, error: 'Not authenticated' }
  const result = await complaintService.resolveComplaint(id, ctx.orgId, ctx.actor.userId)
  if (result.error) return { success: false, error: result.error }
  if (!result.complaint) return { success: false, error: 'Not found' }
  return { success: true, data: result.complaint }
}

export async function dismissComplaintAction(id: string): Promise<DeliverabilityApiResult<ComplaintRecord>> {
  const ctx = await getAuthContext()
  if (!ctx) return { success: false, error: 'Not authenticated' }
  const result = await complaintService.dismissComplaint(id, ctx.orgId)
  if (result.error) return { success: false, error: result.error }
  if (!result.complaint) return { success: false, error: 'Not found' }
  return { success: true, data: result.complaint }
}

// ============================================================
// Bounce Intelligence
// ============================================================

export async function getBounces(limit?: number): Promise<BounceRecord[]> {
  const ctx = await getAuthContext()
  if (!ctx) return []
  return bounceService.listBounces(ctx.orgId, limit)
}

export async function getBounceDashboard(): Promise<BounceDashboardStats> {
  const ctx = await getAuthContext()
  if (!ctx) return { totalBounces: 0, hardBounces: 0, softBounces: 0, unknownBounces: 0, suppressionCount: 0, recentBounces: [] }
  return bounceService.getBounceDashboardStats(ctx.orgId)
}

export async function processBounceRetries(): Promise<{ retried: number; suppressed: number }> {
  const ctx = await getAuthContext()
  if (!ctx) return { retried: 0, suppressed: 0 }
  return bounceService.processRetries(ctx.orgId)
}

export async function checkEmailSuppression(email: string): Promise<boolean> {
  const ctx = await getAuthContext()
  if (!ctx) return false
  return bounceService.isEmailSuppressed(ctx.orgId, email)
}

export async function getBounceAnalyticsAction(): Promise<{ hardBounceRate: number; softBounceRate: number; topCategories: { category: string; count: number }[] }> {
  const ctx = await getAuthContext()
  if (!ctx) return { hardBounceRate: 0, softBounceRate: 0, topCategories: [] }
  return bounceService.getBounceAnalytics(ctx.orgId)
}

// ============================================================
// Google Postmaster Integration
// ============================================================

export async function getPostmasterDomains(): Promise<PostmasterDomain[]> {
  const ctx = await getAuthContext()
  if (!ctx) return []
  return postmasterService.listPostmasterDomains(ctx.orgId)
}

export async function connectPostmasterDomainAction(domain: string, domainId?: string): Promise<DeliverabilityApiResult<PostmasterDomain>> {
  const ctx = await getAuthContext()
  if (!ctx) return { success: false, error: 'Not authenticated' }
  const result = await postmasterService.connectPostmasterDomain(ctx.orgId, domain, domainId)
  if (result.error) return { success: false, error: result.error }
  return { success: true, data: result.postmasterDomain }
}

export async function disconnectPostmasterDomainAction(id: string): Promise<DeliverabilityApiResult<boolean>> {
  const ctx = await getAuthContext()
  if (!ctx) return { success: false, error: 'Not authenticated' }
  const result = await postmasterService.disconnectPostmasterDomain(id, ctx.orgId)
  if (result.error) return { success: false, error: result.error }
  return { success: true, data: true }
}

export async function syncPostmasterMetricsAction(id: string): Promise<DeliverabilityApiResult<boolean>> {
  const ctx = await getAuthContext()
  if (!ctx) return { success: false, error: 'Not authenticated' }
  const result = await postmasterService.syncPostmasterMetrics(id, ctx.orgId)
  if (result.error) return { success: false, error: result.error }
  return { success: true, data: true }
}

export async function getPostmasterDashboard(): Promise<PostmasterDashboardStats> {
  const ctx = await getAuthContext()
  if (!ctx) return { domainsConnected: 0, domainsVerified: 0, lastSyncAt: null, avgSpamComplaintRate: 0, avgAuthSuccessRate: 0, domainReputationBreakdown: [] }
  return postmasterService.getPostmasterDashboardStats(ctx.orgId)
}

export async function getPostmasterMetricsHistory(postmasterDomainId: string): Promise<PostmasterMetrics[]> {
  const ctx = await getAuthContext()
  if (!ctx) return []
  return postmasterService.getMetricsHistory(postmasterDomainId)
}

// ============================================================
// Microsoft SNDS Integration
// ============================================================

export async function getSndsDomains(): Promise<SndsDomain[]> {
  const ctx = await getAuthContext()
  if (!ctx) return []
  return sndsService.listSndsDomains(ctx.orgId)
}

export async function connectSndsDomainAction(domain: string, domainId?: string): Promise<DeliverabilityApiResult<SndsDomain>> {
  const ctx = await getAuthContext()
  if (!ctx) return { success: false, error: 'Not authenticated' }
  const result = await sndsService.connectSndsDomain(ctx.orgId, domain, domainId)
  if (result.error) return { success: false, error: result.error }
  return { success: true, data: result.sndsDomain }
}

export async function disconnectSndsDomainAction(id: string): Promise<DeliverabilityApiResult<boolean>> {
  const ctx = await getAuthContext()
  if (!ctx) return { success: false, error: 'Not authenticated' }
  const result = await sndsService.disconnectSndsDomain(id, ctx.orgId)
  if (result.error) return { success: false, error: result.error }
  return { success: true, data: true }
}

export async function syncSndsMetricsAction(id: string): Promise<DeliverabilityApiResult<boolean>> {
  const ctx = await getAuthContext()
  if (!ctx) return { success: false, error: 'Not authenticated' }
  const result = await sndsService.syncSndsMetrics(id, ctx.orgId)
  if (result.error) return { success: false, error: result.error }
  return { success: true, data: true }
}

export async function getSndsDashboard(): Promise<SndsDashboardStats> {
  const ctx = await getAuthContext()
  if (!ctx) return { domainsConnected: 0, lastSyncAt: null, avgComplaintRate: 0, totalTrapHits: 0, recentMetrics: [] }
  return sndsService.getSndsDashboardStats(ctx.orgId)
}

export async function getSndsMetricsHistoryAction(sndsDomainId: string): Promise<SndsMetrics[]> {
  const ctx = await getAuthContext()
  if (!ctx) return []
  return sndsService.getSndsMetricsHistory(sndsDomainId)
}

// ============================================================
// Monitoring Scheduler
// ============================================================

export async function getMonitoringConfigAction(): Promise<MonitoringConfig | null> {
  const ctx = await getAuthContext()
  if (!ctx) return null
  return monitoringSchedulerService.getMonitoringConfig(ctx.orgId)
}

export async function updateMonitoringConfigAction(config: Partial<{
  dnsVerificationEnabled: boolean
  blacklistCheckEnabled: boolean
  reputationMonitoringEnabled: boolean
  postmasterSyncEnabled: boolean
  sndsSyncEnabled: boolean
  dnsCheckIntervalHours: number
  blacklistCheckIntervalHours: number
  reputationCheckIntervalHours: number
  postmasterSyncIntervalHours: number
  sndsSyncIntervalHours: number
}>): Promise<MonitoringConfig> {
  const ctx = await getAuthContext()
  if (!ctx) throw new Error('Not authenticated')
  return monitoringSchedulerService.updateMonitoringConfig(ctx.orgId, config)
}

export async function runDnsVerificationAction(): Promise<{ checked: number; succeeded: number; failed: number }> {
  const ctx = await getAuthContext()
  if (!ctx) return { checked: 0, succeeded: 0, failed: 0 }
  return monitoringSchedulerService.runDnsVerification(ctx.orgId)
}

export async function getMonitoringJobs(limit?: number): Promise<MonitoringJob[]> {
  const ctx = await getAuthContext()
  if (!ctx) return []
  return monitoringSchedulerService.getRecentJobs(ctx.orgId, limit)
}

export async function cancelMonitoringJob(id: string): Promise<DeliverabilityApiResult<boolean>> {
  const ctx = await getAuthContext()
  if (!ctx) return { success: false, error: 'Not authenticated' }
  const result = await monitoringSchedulerService.cancelJob(id, ctx.orgId)
  if (result.error) return { success: false, error: result.error }
  return { success: true, data: true }
}

// ============================================================
// Tracking Infrastructure
// ============================================================

export async function generateTrackingTokenAction(data: {
  campaignId?: string
  mailboxId?: string
  tokenType: 'open' | 'click'
  recipientEmail?: string
}): Promise<TrackingToken> {
  const ctx = await getAuthContext()
  if (!ctx) throw new Error('Not authenticated')
  return trackingService.generateTrackingToken({
    organizationId: ctx.orgId,
    ...data,
  })
}

export async function getTrackingDashboard(): Promise<TrackingDashboardStats> {
  const ctx = await getAuthContext()
  if (!ctx) return { totalOpens: 0, uniqueOpens: 0, totalClicks: 0, uniqueClicks: 0, openRate: 0, clickRate: 0, recentEvents: [] }
  return trackingService.getTrackingDashboardStats(ctx.orgId)
}

export async function getTrackingPixelEventsAction(campaignId: string): Promise<TrackingPixelEvent[]> {
  const ctx = await getAuthContext()
  if (!ctx) return []
  return trackingService.getPixelEvents(campaignId)
}

export async function getClickEventsAction(campaignId: string): Promise<ClickEvent[]> {
  const ctx = await getAuthContext()
  if (!ctx) return []
  return trackingService.getClickEvents(campaignId)
}

export async function getTrackingDomainsAction(): Promise<TrackingDomain[]> {
  const ctx = await getAuthContext()
  if (!ctx) return []
  return trackingDomainService.listTrackingDomains(ctx.orgId)
}

export async function createTrackingDomainAction(domainId: string, trackingDomain: string): Promise<{ success: boolean; error?: string }> {
  const ctx = await getAuthContext()
  if (!ctx) return { success: false, error: 'Unauthorized' }
  const result = await trackingDomainService.createTrackingDomain(ctx.orgId, domainId, trackingDomain)
  return { success: !result.error, error: result.error }
}

export async function deleteTrackingDomainAction(id: string): Promise<{ success: boolean; error?: string }> {
  const ctx = await getAuthContext()
  if (!ctx) return { success: false, error: 'Unauthorized' }
  return trackingDomainService.deleteTrackingDomain(id, ctx.orgId)
}

export async function verifyTrackingDomainAction(id: string): Promise<{ verified: boolean; status: string | undefined; cnameTarget: string | null; error?: string }> {
  const ctx = await getAuthContext()
  if (!ctx) return { verified: false, status: 'failed', cnameTarget: null, error: 'Unauthorized' }
  return trackingDomainService.verifyTrackingDomain(id, ctx.orgId)
}

export async function setDefaultTrackingDomainAction(id: string): Promise<{ success: boolean; error?: string }> {
  const ctx = await getAuthContext()
  if (!ctx) return { success: false, error: 'Unauthorized' }
  return trackingDomainService.setDefaultTrackingDomain(id, ctx.orgId)
}

export async function getDomainAnalyticsAction(domainId: string) {
  const ctx = await getAuthContext()
  if (!ctx) return null
  const { getDomainAnalytics } = await import('@/services/mail/domain-analytics-service')
  return getDomainAnalytics(ctx.orgId, domainId)
}

export async function exportDomainAnalyticsCsvAction(): Promise<string> {
  const ctx = await getAuthContext()
  if (!ctx) return 'domain\n'
  const { exportDomainAnalyticsCsv } = await import('@/services/mail/domain-analytics-service')
  return exportDomainAnalyticsCsv(ctx.orgId)
}

/** Suggest sending domains from connected mailbox emails (PRD §6.2.26). */
export async function suggestDomainsFromMailboxesAction(): Promise<string[]> {
  const ctx = await getAuthContext()
  if (!ctx) return []
  const pool = (await import('@/lib/db')).default
  const existing = await deliverabilityService.listDomains(ctx.orgId).catch(() => [] as DeliverabilityDomain[])
  const existingSet = new Set(existing.map((d) => d.domain.toLowerCase()))
  const r = await pool.query<{ domain: string }>(
    `SELECT DISTINCT LOWER(SPLIT_PART(email, '@', 2)) AS domain
     FROM public.mail_mailboxes
     WHERE organization_id = $1 AND deleted_at IS NULL
     UNION
     SELECT DISTINCT LOWER(SPLIT_PART(email, '@', 2)) AS domain
     FROM public.engage_mailboxes
     WHERE organization_id = $1`,
    [ctx.orgId]
  ).catch(() => ({ rows: [] as { domain: string }[] }))
  return r.rows
    .map((row) => row.domain)
    .filter((d) => d && d.includes('.') && !existingSet.has(d))
    .sort()
}

export async function getDeliverabilityPermissionsAction() {
  const session = await getSessionUser()
  const { resolveMailPermissions } = await import('@/lib/mail-permissions')
  return resolveMailPermissions(session?.role || 'viewer')
}
