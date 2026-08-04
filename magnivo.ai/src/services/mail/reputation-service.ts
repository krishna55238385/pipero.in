import * as reputationRepo from '@/repositories/mail/reputation-repository'
import type { DomainReputation, MailboxReputation, ReputationLevel, ReputationSource, ReputationDashboardStats, ReputationTrend } from '@/types/deliverability'

function scoreToLevel(score: number): ReputationLevel {
  if (score >= 80) return 'excellent'
  if (score >= 60) return 'good'
  if (score >= 40) return 'fair'
  if (score > 0) return 'poor'
  return 'unknown'
}

export async function getDomainReputations(orgId: string): Promise<DomainReputation[]> {
  return reputationRepo.findDomainReputationsByOrg(orgId)
}

export async function getDomainReputationHistory(domainId: string, limit: number = 30): Promise<DomainReputation[]> {
  return reputationRepo.findDomainReputationHistory(domainId, limit)
}

export async function getDomainReputationTrend(domainId: string): Promise<ReputationTrend[]> {
  const history = await reputationRepo.findDomainReputationHistory(domainId, 30)
  return history.map(h => ({
    date: h.recordedAt,
    score: h.reputationScore,
    level: h.reputationLevel,
  })).reverse()
}

export async function getMailboxReputations(orgId: string, domainId?: string): Promise<MailboxReputation[]> {
  return reputationRepo.findMailboxReputations(orgId, domainId)
}

export async function recordDomainReputation(data: {
  organizationId: string
  domainId: string
  source: ReputationSource
  reputationScore: number
  sendingVolume?: number
  bounceRate?: number
  complaintRate?: number
  openRate?: number
}): Promise<DomainReputation> {
  const level = scoreToLevel(data.reputationScore)
  return reputationRepo.insertDomainReputation({
    ...data,
    reputationLevel: level,
  })
}

export async function recordMailboxReputation(data: {
  organizationId: string
  mailboxId: string
  domainId: string
  source: ReputationSource
  reputationScore: number
  sendingVolume?: number
  bounceRate?: number
  complaintRate?: number
}): Promise<MailboxReputation> {
  const level = scoreToLevel(data.reputationScore)
  return reputationRepo.insertMailboxReputation({
    ...data,
    reputationLevel: level,
  })
}

export async function getReputationDashboardStats(orgId: string): Promise<ReputationDashboardStats> {
  return reputationRepo.getReputationDashboardStats(orgId)
}

export async function calculateInternalReputation(
  orgId: string,
  domainId: string,
  bounceRate: number,
  complaintRate: number,
  openRate: number
): Promise<DomainReputation> {
  let score = 100
  score -= bounceRate * 500
  score -= complaintRate * 1000
  score += openRate * 20
  score = Math.max(0, Math.min(100, Math.round(score)))

  return recordDomainReputation({
    organizationId: orgId,
    domainId,
    source: 'internal',
    reputationScore: score,
    bounceRate,
    complaintRate,
    openRate,
  })
}
