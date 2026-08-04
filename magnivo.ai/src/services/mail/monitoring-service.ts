import * as domainRepo from '@/repositories/mail/domain-repository'
import * as historyRepo from '@/repositories/mail/verification-history-repository'
import { lookupAllRecords } from '@/lib/dns-resolver'
import { calculateOverallHealth, scoreToHealthLevel } from './health-scorer'
import { generateNotificationsForDomain } from './deliverability-service'
import type { DnsRecordStatus } from '@/types/deliverability'

export async function checkDomain(domainId: string, orgId: string, source: 'auto' | 'monitoring' = 'auto'): Promise<{
  success: boolean
  error?: string
  durationMs?: number
}> {
  const startTime = Date.now()

  const domain = await domainRepo.findDomainById(domainId, orgId)
  if (!domain) return { success: false, error: 'Domain not found' }

  try {
    const dns = await lookupAllRecords(domain.domain, domain.dkimSelector)
    const durationMs = Date.now() - startTime
    const { score, level } = calculateOverallHealth(
      dns.spf.valid ? 'valid' : (dns.spf.found ? 'invalid' : 'missing'),
      dns.dkim.valid ? 'valid' : (dns.dkim.found ? 'invalid' : 'missing'),
      dns.dmarc.valid ? 'valid' : (dns.dmarc.found ? 'invalid' : 'missing'),
      dns.tracking.valid ? 'valid' : (dns.tracking.found ? 'invalid' : 'missing')
    )

    const spfStatus: DnsRecordStatus = dns.spf.valid ? 'valid' : (dns.spf.found ? 'invalid' : 'missing')
    const dkimStatus: DnsRecordStatus = dns.dkim.valid ? 'valid' : (dns.dkim.found ? 'invalid' : 'missing')
    const dmarcStatus: DnsRecordStatus = dns.dmarc.valid ? 'valid' : (dns.dmarc.found ? 'invalid' : 'missing')
    const trackingStatus: DnsRecordStatus = dns.tracking.valid ? 'valid' : (dns.tracking.found ? 'invalid' : 'missing')
    const returnPathStatus: DnsRecordStatus = dns.returnPath.valid ? 'valid' : (dns.returnPath.found ? 'invalid' : 'missing')

    // Generate notifications if status changed
    await generateNotificationsForDomain(domainId, orgId, {
      ...domain,
      spfStatus, dkimStatus, dmarcStatus, trackingStatus, returnPathStatus,
      spfRaw: dns.spf.raw,
      dmarcRaw: dns.dmarc.raw,
      dmarcPolicy: dns.dmarc.policy,
      dkimCnameTarget: dns.dkim.record,
      trackingCnameTarget: dns.tracking.cnameTarget,
      returnPathCnameTarget: dns.returnPath.cnameTarget,
      healthScore: score,
      healthStatus: level,
    }, domain)

    await domainRepo.updateDomain(domainId, orgId, {
      healthScore: score,
      healthStatus: level,
      spfStatus,
      dkimStatus,
      dmarcStatus,
      trackingStatus,
      returnPathStatus,
      spfRaw: dns.spf.raw,
      dmarcRaw: dns.dmarc.raw,
      dmarcPolicy: dns.dmarc.policy,
      dkimCnameTarget: dns.dkim.record,
      trackingCnameTarget: dns.tracking.cnameTarget,
      returnPathCnameTarget: dns.returnPath.cnameTarget,
      lastCheckedAt: new Date().toISOString(),
      nextCheckAt: new Date(Date.now() + domain.checkIntervalHours * 60 * 60 * 1000).toISOString(),
    })

    const historyEntries = [
      { type: 'spf', prev: domain.spfStatus, new: spfStatus },
      { type: 'dkim', prev: domain.dkimStatus, new: dkimStatus },
      { type: 'dmarc', prev: domain.dmarcStatus, new: dmarcStatus },
      { type: 'tracking', prev: domain.trackingStatus, new: trackingStatus },
    ]

    for (const entry of historyEntries) {
      if (entry.prev !== entry.new) {
        await historyRepo.insertVerificationHistory({
          domainId,
          organizationId: orgId,
          recordType: entry.type,
          previousStatus: entry.prev,
          newStatus: entry.new,
          previousValue: entry.type === 'spf' ? domain.spfRaw : domain.dmarcRaw,
          newValue: entry.type === 'spf' ? dns.spf.raw : dns.dmarc.raw,
          action: `${entry.type}_status_changed`,
          verifiedBy: source,
          result: 'success',
          durationMs,
        })
      }
    }

    return { success: true, durationMs }
  } catch (err) {
    const durationMs = Date.now() - startTime
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'

    await historyRepo.insertVerificationHistory({
      domainId,
      organizationId: orgId,
      recordType: 'full',
      action: 'verification_failed',
      verifiedBy: source,
      result: 'failure',
      errorMessage,
      durationMs,
    })

    return { success: false, error: errorMessage, durationMs }
  }
}

export async function runMonitoringChecks(): Promise<{
  checked: number
  succeeded: number
  failed: number
}> {
  const domains = await domainRepo.findDomainsDueForCheck()
  let succeeded = 0
  let failed = 0

  const BATCH_SIZE = 5
  for (let i = 0; i < domains.length; i += BATCH_SIZE) {
    const batch = domains.slice(i, i + BATCH_SIZE)
    const results = await Promise.allSettled(
      batch.map(d => checkDomain(d.id, d.organizationId, 'monitoring'))
    )
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.success) {
        succeeded++
      } else {
        failed++
      }
    }
  }

  return { checked: domains.length, succeeded, failed }
}

export async function detectFailures(domainId: string, orgId: string): Promise<{
  failures: string[]
  warnings: string[]
}> {
  const domain = await domainRepo.findDomainById(domainId, orgId)
  if (!domain) return { failures: [], warnings: [] }

  const failures: string[] = []
  const warnings: string[] = []

  if (domain.spfStatus === 'missing') failures.push('SPF record missing — emails may be rejected by recipients')
  if (domain.spfStatus === 'invalid') failures.push('SPF record invalid — check the record syntax')

  if (domain.dkimStatus === 'missing') failures.push('DKIM record missing — emails cannot be authenticated')
  if (domain.dkimStatus === 'invalid') failures.push('DKIM record invalid — key may be expired or wrong selector')

  if (domain.dmarcStatus === 'missing') warnings.push('DMARC record missing — no policy enforcement')
  if (domain.dmarcStatus === 'invalid') warnings.push('DMARC record invalid — check the policy format')

  if (domain.trackingStatus === 'missing') warnings.push('Tracking domain not configured — open/click tracking disabled')
  if (domain.trackingStatus === 'invalid') warnings.push('Tracking CNAME broken — open/click tracking may fail')

  if (domain.healthScore < 50) warnings.push('Domain health is below 50% — multiple issues detected')
  if (domain.healthScore < 30) failures.push('Critical: Domain health below 30% — immediate action required')

  if (domain.lastCheckedAt) {
    const daysSinceCheck = (Date.now() - new Date(domain.lastCheckedAt).getTime()) / (1000 * 60 * 60 * 24)
    if (daysSinceCheck > 7) warnings.push('Domain has not been checked in over 7 days')
  }

  return { failures, warnings }
}
