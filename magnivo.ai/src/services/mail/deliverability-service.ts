import * as domainRepo from '@/repositories/mail/domain-repository'
import * as historyRepo from '@/repositories/mail/verification-history-repository'
import * as dnsRecordRepo from '@/repositories/mail/dns-record-repository'
import * as trackingRepo from '@/repositories/mail/tracking-domain-repository'
import { findMailboxesGroupedByDomain, type MailboxDomainGroup } from '@/repositories/mail/mailbox-repository'
import { lookupAllRecords } from '@/lib/dns-resolver'
import { calculateOverallHealth } from './health-scorer'
import type {
  CreateDomainRequest,
  VerifyDomainRequest,
  BulkVerifyRequest,
  UpdateDomainRequest,
  DomainVerificationResult,
  DeliverabilityDashboardStats,
  DeliverabilityDomain,
  DnsRecordStatus,
  VerificationHistoryEntry,
  DnsRecord,
  TrackingDomain,
  NotificationType,
  NotificationSeverity,
} from '@/types/deliverability'

export async function listDomains(orgId: string): Promise<DeliverabilityDomain[]> {
  return domainRepo.findDomainsByOrg(orgId)
}

export async function getDomain(id: string, orgId: string): Promise<DeliverabilityDomain | null> {
  return domainRepo.findDomainById(id, orgId)
}

export async function getDomainByName(domain: string, orgId: string): Promise<DeliverabilityDomain | null> {
  return domainRepo.findDomainByName(domain, orgId)
}

export async function createDomain(orgId: string, request: CreateDomainRequest): Promise<{ domain: DeliverabilityDomain; error?: string }> {
  const existing = await domainRepo.findDomainByName(request.domain, orgId)
  if (existing) {
    return { domain: existing, error: 'Domain already exists' }
  }

  const domain = await domainRepo.insertDomain({
    organizationId: orgId,
    domain: request.domain,
    dkimSelector: request.dkimSelector,
    checkIntervalHours: request.checkIntervalHours,
    purpose: request.purpose,
    tags: request.tags,
    notes: request.notes,
    dnsProvider: request.dnsProvider,
  })

  // Auto-verify the domain immediately after creation
  try {
    await verifyDomain({ domainId: domain.id, source: 'auto' }, orgId)
    const updated = await domainRepo.findDomainById(domain.id, orgId)
    if (updated) return { domain: updated }
  } catch {
    // Auto-verification failure is non-fatal; domain still created
  }

  return { domain }
}

export async function updateDomain(id: string, orgId: string, request: UpdateDomainRequest): Promise<{ domain: DeliverabilityDomain | null; error?: string }> {
  const existing = await domainRepo.findDomainById(id, orgId)
  if (!existing) return { domain: null, error: 'Domain not found' }

  const domain = await domainRepo.updateDomain(id, orgId, {
    dkimSelector: request.dkimSelector,
    checkIntervalHours: request.checkIntervalHours,
    trackingDomain: request.trackingDomain,
    returnPathDomain: request.returnPathDomain,
    purpose: request.purpose,
    tags: request.tags,
    notes: request.notes,
    dnsProvider: request.dnsProvider,
    ownershipVerified: request.ownershipVerified,
    ownershipVerifiedAt: request.ownershipVerified ? new Date().toISOString() : undefined,
    bimiSelector: request.bimiSelector,
    bimiSvgUrl: request.bimiSvgUrl,
    bimiVmcUrl: request.bimiVmcUrl,
  })

  return { domain }
}

export async function deleteDomain(id: string, orgId: string): Promise<{ success: boolean; error?: string }> {
  const existing = await domainRepo.findDomainById(id, orgId)
  if (!existing) return { success: false, error: 'Domain not found' }

  await domainRepo.deleteDomain(id, orgId)
  return { success: true }
}

export async function verifyDomain(
  request: VerifyDomainRequest,
  orgId: string,
  actorUserId?: string,
  actorEmail?: string
): Promise<{ result: DomainVerificationResult | null; error?: string }> {
  const domain = await domainRepo.findDomainById(request.domainId, orgId)
  if (!domain) return { result: null, error: 'Domain not found' }

  const startTime = Date.now()
  const source = request.source ?? 'manual'

  try {
    const dns = await lookupAllRecords(domain.domain, domain.dkimSelector)
    const durationMs = Date.now() - startTime

    const spfStatus: DnsRecordStatus = dns.spf.valid ? 'valid' : (dns.spf.found ? 'invalid' : 'missing')
    const dkimStatus: DnsRecordStatus = dns.dkim.valid ? 'valid' : (dns.dkim.found ? 'invalid' : 'missing')
    const dmarcStatus: DnsRecordStatus = dns.dmarc.valid ? 'valid' : (dns.dmarc.found ? 'invalid' : 'missing')
    const trackingStatus: DnsRecordStatus = dns.tracking.valid ? 'valid' : (dns.tracking.found ? 'invalid' : 'missing')
    const returnPathStatus: DnsRecordStatus = dns.returnPath.valid ? 'valid' : (dns.returnPath.found ? 'invalid' : 'missing')
    const mxStatus: DnsRecordStatus = dns.mx.valid ? 'valid' : (dns.mx.found ? 'invalid' : 'missing')
    const bimiStatus: DnsRecordStatus | 'not_configured' = dns.bimi.found
      ? dns.bimi.valid
        ? 'valid'
        : 'invalid'
      : 'not_configured'

    const { score, level } = calculateOverallHealth(spfStatus, dkimStatus, dmarcStatus, trackingStatus)

    await domainRepo.updateDomain(domain.id, orgId, {
      healthScore: score,
      healthStatus: level,
      spfStatus,
      dkimStatus,
      dmarcStatus,
      trackingStatus,
      returnPathStatus,
      mxStatus,
      bimiStatus,
      spfRaw: dns.spf.raw,
      dmarcRaw: dns.dmarc.raw,
      dmarcPolicy: dns.dmarc.policy,
      dkimCnameTarget: dns.dkim.record,
      trackingCnameTarget: dns.tracking.cnameTarget,
      returnPathCnameTarget: dns.returnPath.cnameTarget,
      lastCheckedAt: new Date().toISOString(),
      nextCheckAt: new Date(Date.now() + domain.checkIntervalHours * 60 * 60 * 1000).toISOString(),
    })

    if (dns.spf.raw) {
      await dnsRecordRepo.upsertDnsRecord({
        domainId: domain.id,
        recordType: 'TXT',
        recordName: domain.domain,
        recordValue: dns.spf.raw,
      })
    }

    if (dns.dkim.record) {
      await dnsRecordRepo.upsertDnsRecord({
        domainId: domain.id,
        recordType: 'TXT',
        recordName: `${domain.dkimSelector}._domainkey.${domain.domain}`,
        recordValue: dns.dkim.record,
      })
    }

    if (dns.dmarc.raw) {
      await dnsRecordRepo.upsertDnsRecord({
        domainId: domain.id,
        recordType: 'TXT',
        recordName: `_dmarc.${domain.domain}`,
        recordValue: dns.dmarc.raw,
      })
    }

    const historyEntries = [
      { type: 'spf', prev: domain.spfStatus, new: spfStatus, val: dns.spf.raw },
      { type: 'dkim', prev: domain.dkimStatus, new: dkimStatus, val: dns.dkim.record },
      { type: 'dmarc', prev: domain.dmarcStatus, new: dmarcStatus, val: dns.dmarc.raw },
      { type: 'tracking', prev: domain.trackingStatus, new: trackingStatus, val: dns.tracking.cnameTarget },
    ]

    for (const entry of historyEntries) {
      if (entry.prev !== entry.new) {
        await historyRepo.insertVerificationHistory({
          domainId: domain.id,
          organizationId: orgId,
          recordType: entry.type,
          previousStatus: entry.prev,
          newStatus: entry.new,
          newValue: entry.val,
          action: `${entry.type}_verified`,
          actorUserId,
          actorEmail,
          verifiedBy: source,
          result: 'success',
          durationMs,
        })
      }
    }

    const verificationResult: DomainVerificationResult = {
      domain: domain.domain,
      spf: dns.spf,
      dkim: dns.dkim,
      dmarc: dns.dmarc,
      tracking: dns.tracking,
      returnPath: dns.returnPath,
      healthScore: score,
      healthStatus: level,
      verifiedAt: new Date().toISOString(),
      durationMs,
    }

    return { result: verificationResult }
  } catch (err) {
    const durationMs = Date.now() - startTime
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'

    await historyRepo.insertVerificationHistory({
      domainId: domain.id,
      organizationId: orgId,
      recordType: 'full',
      action: 'verification_failed',
      actorUserId,
      actorEmail,
      verifiedBy: source,
      result: 'failure',
      errorMessage,
      durationMs,
    })

    return { result: null, error: errorMessage }
  }
}

export async function bulkVerify(
  request: BulkVerifyRequest,
  orgId: string,
  actorUserId: string,
  actorEmail: string
): Promise<{ results: { domainId: string; success: boolean; error?: string }[] }> {
  const results: { domainId: string; success: boolean; error?: string }[] = []

  const BATCH_SIZE = 5
  for (let i = 0; i < request.domainIds.length; i += BATCH_SIZE) {
    const batch = request.domainIds.slice(i, i + BATCH_SIZE)
    const batchResults = await Promise.all(
      batch.map(async (domainId) => {
        const result = await verifyDomain(
          { domainId, source: 'bulk' },
          orgId,
          actorUserId,
          actorEmail
        )
        return {
          domainId,
          success: result.result !== null,
          error: result.error,
        }
      })
    )
    results.push(...batchResults)
  }

  return { results }
}

export async function getDomainHistory(
  domainId: string,
  orgId: string,
  limit: number = 50,
  offset: number = 0
): Promise<VerificationHistoryEntry[]> {
  const domain = await domainRepo.findDomainById(domainId, orgId)
  if (!domain) return []
  return historyRepo.findHistoryByDomain(domainId, limit, offset)
}

export async function getDomainDnsRecords(domainId: string, orgId: string): Promise<DnsRecord[]> {
  const domain = await domainRepo.findDomainById(domainId, orgId)
  if (!domain) return []
  return dnsRecordRepo.findDnsRecordsByDomain(domainId)
}

export async function getTrackingDomains(domainId: string, orgId: string): Promise<TrackingDomain[]> {
  return trackingRepo.findTrackingDomainsByDomain(domainId)
}

export async function getDashboardStats(orgId: string): Promise<DeliverabilityDashboardStats> {
  const counts = await domainRepo.countDomainsByOrg(orgId)

  let unreadNotifications = 0
  try {
    const pool = (await import('@/lib/db')).default
    const result = await pool.query(
      `SELECT COUNT(*)::int AS count FROM public.mail_deliverability_notifications
       WHERE organization_id = $1 AND is_read = FALSE AND is_dismissed = FALSE`,
      [orgId]
    )
    unreadNotifications = result.rows[0]?.count ?? 0
  } catch {
    unreadNotifications = 0
  }

  return {
    totalDomains: counts.total,
    healthyDomains: counts.healthy,
    needsAttention: counts.needsAttention,
    failedDomains: counts.failed,
    avgHealthScore: counts.avgHealth,
    unreadNotifications,
  }
}

export async function markNotificationRead(notificationId: string, orgId: string): Promise<boolean> {
  const pool = (await import('@/lib/db')).default
  const result = await pool.query(
    `UPDATE public.mail_deliverability_notifications
     SET is_read = TRUE
     WHERE id = $1 AND organization_id = $2`,
    [notificationId, orgId]
  )
  return (result.rowCount ?? 0) > 0
}

export async function dismissNotification(notificationId: string, orgId: string): Promise<boolean> {
  const pool = (await import('@/lib/db')).default
  const result = await pool.query(
    `UPDATE public.mail_deliverability_notifications
     SET is_dismissed = TRUE, is_read = TRUE
     WHERE id = $1 AND organization_id = $2`,
    [notificationId, orgId]
  )
  return (result.rowCount ?? 0) > 0
}

export async function getNotifications(orgId: string, unreadOnly: boolean = false): Promise<unknown[]> {
  const pool = (await import('@/lib/db')).default
  const query = unreadOnly
    ? `SELECT * FROM public.mail_deliverability_notifications
       WHERE organization_id = $1 AND is_read = FALSE AND is_dismissed = FALSE
       ORDER BY created_at DESC LIMIT 50`
    : `SELECT * FROM public.mail_deliverability_notifications
       WHERE organization_id = $1 AND is_dismissed = FALSE
       ORDER BY created_at DESC LIMIT 50`
  const result = await pool.query(query, [orgId])
  return result.rows
}

// ============================================================
// Mailbox-Domain Grouping
// ============================================================

export async function getMailboxesGroupedByDomain(orgId: string): Promise<MailboxDomainGroup[]> {
  return findMailboxesGroupedByDomain(orgId)
}

export async function getDomainWithMailboxes(orgId: string): Promise<{
  domains: DeliverabilityDomain[]
  mailboxGroups: MailboxDomainGroup[]
}> {
  const [domains, mailboxGroups] = await Promise.all([
    listDomains(orgId),
    findMailboxesGroupedByDomain(orgId),
  ])
  return { domains, mailboxGroups }
}

// ============================================================
// Notification Creation
// ============================================================

async function createNotification(data: {
  orgId: string
  domainId: string
  type: NotificationType
  title: string
  message: string
  severity: NotificationSeverity
  previousValue?: string | null
  newValue?: string | null
}): Promise<void> {
  const pool = (await import('@/lib/db')).default
  try {
    await pool.query(
      `INSERT INTO public.mail_deliverability_notifications
        (organization_id, domain_id, notification_type, title, message, severity, previous_value, new_value)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [data.orgId, data.domainId, data.type, data.title, data.message, data.severity, data.previousValue ?? null, data.newValue ?? null]
    )
  } catch {
    console.error('[deliverability] Failed to create notification')
  }
}

export async function generateNotificationsForDomain(
  domainId: string,
  orgId: string,
  domain: DeliverabilityDomain,
  prevDomain: DeliverabilityDomain
): Promise<void> {
  if (prevDomain.spfStatus === 'valid' && domain.spfStatus !== 'valid') {
    await createNotification({
      orgId, domainId, type: 'spf_break',
      title: `SPF record broken for ${domain.domain}`,
      message: `SPF changed from ${prevDomain.spfStatus} to ${domain.spfStatus}. Emails may be rejected.`,
      severity: 'critical',
      previousValue: prevDomain.spfRaw,
      newValue: domain.spfRaw,
    })
  }

  if (prevDomain.dkimStatus === 'valid' && domain.dkimStatus !== 'valid') {
    await createNotification({
      orgId, domainId, type: 'dkim_expired',
      title: `DKIM record invalid for ${domain.domain}`,
      message: `DKIM changed from ${prevDomain.dkimStatus} to ${domain.dkimStatus}. Emails cannot be authenticated.`,
      severity: 'critical',
      previousValue: prevDomain.dkimCnameTarget,
      newValue: domain.dkimCnameTarget,
    })
  }

  if (prevDomain.dmarcStatus === 'valid' && domain.dmarcStatus !== 'valid') {
    await createNotification({
      orgId, domainId, type: 'dmarc_removed',
      title: `DMARC policy issue for ${domain.domain}`,
      message: `DMARC changed from ${prevDomain.dmarcStatus} to ${domain.dmarcStatus}.`,
      severity: 'warning',
      previousValue: prevDomain.dmarcRaw,
      newValue: domain.dmarcRaw,
    })
  }

  if (prevDomain.trackingStatus === 'valid' && domain.trackingStatus !== 'valid') {
    await createNotification({
      orgId, domainId, type: 'tracking_stopped',
      title: `Tracking domain broken for ${domain.domain}`,
      message: `Tracking changed from ${prevDomain.trackingStatus} to ${domain.trackingStatus}. Open/click tracking disabled.`,
      severity: 'warning',
      previousValue: prevDomain.trackingCnameTarget,
      newValue: domain.trackingCnameTarget,
    })
  }

  if (prevDomain.healthScore >= 50 && domain.healthScore < 50) {
    await createNotification({
      orgId, domainId, type: 'health_degraded',
      title: `Health degraded for ${domain.domain}`,
      message: `Domain health dropped from ${prevDomain.healthScore}% to ${domain.healthScore}%.`,
      severity: domain.healthScore < 30 ? 'critical' : 'warning',
    })
  }
}
