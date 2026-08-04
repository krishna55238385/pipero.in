import type { DnsRecordStatus, DomainHealthLevel, DomainHealthBreakdown } from '@/types/deliverability'

const WEIGHTS = { spf: 30, dkim: 30, dmarc: 25, tracking: 15 }

function statusToScore(status: DnsRecordStatus): number {
  switch (status) {
    case 'valid': return 100
    case 'missing': return 0
    case 'invalid': return 20
    case 'unverified': return 30
    default: return 0
  }
}

export function calculateHealthBreakdown(
  spfStatus: DnsRecordStatus,
  dkimStatus: DnsRecordStatus,
  dmarcStatus: DnsRecordStatus,
  trackingStatus: DnsRecordStatus
): DomainHealthBreakdown {
  const spf = statusToScore(spfStatus)
  const dkim = statusToScore(dkimStatus)
  const dmarc = statusToScore(dmarcStatus)
  const tracking = statusToScore(trackingStatus)

  const overall = Math.round(
    (spf * WEIGHTS.spf + dkim * WEIGHTS.dkim + dmarc * WEIGHTS.dmarc + tracking * WEIGHTS.tracking) / 100
  )

  return { spf, dkim, dmarc, tracking, overall }
}

export function scoreToHealthLevel(score: number): DomainHealthLevel {
  if (score >= 90) return 'excellent'
  if (score >= 70) return 'good'
  if (score >= 50) return 'fair'
  if (score > 0) return 'poor'
  return 'unknown'
}

export function calculateOverallHealth(
  spfStatus: DnsRecordStatus,
  dkimStatus: DnsRecordStatus,
  dmarcStatus: DnsRecordStatus,
  trackingStatus: DnsRecordStatus
): { score: number; level: DomainHealthLevel } {
  const { overall } = calculateHealthBreakdown(spfStatus, dkimStatus, dmarcStatus, trackingStatus)
  return { score: overall, level: scoreToHealthLevel(overall) }
}
