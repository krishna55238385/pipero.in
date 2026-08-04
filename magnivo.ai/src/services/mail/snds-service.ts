import * as sndsRepo from '@/repositories/mail/snds-repository'
import * as sndsApi from './snds-api-client'
import type { SndsDomain, SndsMetrics, SndsDashboardStats } from '@/types/deliverability'

export async function listSndsDomains(orgId: string): Promise<SndsDomain[]> {
  return sndsRepo.findSndsDomainsByOrg(orgId)
}

export async function getSndsDomain(id: string, orgId: string): Promise<SndsDomain | null> {
  return sndsRepo.findSndsDomainById(id, orgId)
}

export async function connectSndsDomain(orgId: string, domain: string, domainId?: string): Promise<{ sndsDomain: SndsDomain; error?: string }> {
  const existing = await sndsRepo.findSndsDomainByName(orgId, domain)
  if (existing) return { sndsDomain: existing, error: 'Domain already connected' }

  const sndsDomain = await sndsRepo.insertSndsDomain({
    organizationId: orgId,
    domainId,
    sndsDomain: domain,
  })

  return { sndsDomain }
}

export async function updateSndsDomainTokens(
  id: string,
  orgId: string,
  accessToken: string,
  refreshToken: string,
  expiresAt: string
): Promise<SndsDomain | null> {
  return sndsRepo.updateSndsDomain(id, orgId, {
    connectionStatus: 'connected',
    accessToken,
    refreshToken,
    tokenExpiresAt: expiresAt,
  })
}

export async function disconnectSndsDomain(id: string, orgId: string): Promise<{ success: boolean; error?: string }> {
  const existing = await sndsRepo.findSndsDomainById(id, orgId)
  if (!existing) return { success: false, error: 'Domain not found' }

  await sndsRepo.updateSndsDomain(id, orgId, {
    connectionStatus: 'disconnected',
    accessToken: null,
    refreshToken: null,
    tokenExpiresAt: null,
  })

  return { success: true }
}

export async function syncSndsMetrics(id: string, orgId: string): Promise<{ synced: boolean; error?: string }> {
  const existing = await sndsRepo.findSndsDomainById(id, orgId)
  if (!existing) return { synced: false, error: 'Domain not found' }
  if (existing.connectionStatus !== 'connected') return { synced: false, error: 'Not connected' }
  if (!existing.accessToken || !existing.refreshToken) return { synced: false, error: 'No OAuth tokens' }

  try {
    let accessToken = existing.accessToken

    if (existing.tokenExpiresAt && new Date(existing.tokenExpiresAt) <= new Date()) {
      const refreshResult = await sndsApi.refreshSndsToken(existing.refreshToken)
      if ('error' in refreshResult) {
        await sndsRepo.updateSndsDomain(id, orgId, { connectionStatus: 'error' })
        return { synced: false, error: refreshResult.error }
      }
      accessToken = refreshResult.accessToken
      await sndsRepo.updateSndsDomain(id, orgId, {
        accessToken: refreshResult.accessToken,
        tokenExpiresAt: refreshResult.expiresAt,
      })
    }

    const domainParts = existing.sndsDomain.split('.')
    const domainIps = await resolveDomainIps(existing.sndsDomain)

    let latestData: sndsApi.SndsDailyData | null = null
    for (const ip of domainIps) {
      const result = await sndsApi.getSndsLatestData(accessToken, ip)
      if (!('error' in result)) {
        latestData = result
        break
      }
    }

    const today = new Date().toISOString().split('T')[0]

    if (latestData) {
      await sndsRepo.insertSndsMetrics({
        sndsDomainId: id,
        organizationId: orgId,
        spamComplaintRate: latestData.spamComplaintRate,
        trapHits: latestData.trapHits,
        ipReputation: latestData.ipReputation ?? undefined,
        malwareCount: latestData.malwareCount,
        networkSpamCount: latestData.networkSpamCount,
        date: latestData.date || today,
      })
    } else {
      await sndsRepo.insertSndsMetrics({
        sndsDomainId: id,
        organizationId: orgId,
        spamComplaintRate: 0,
        trapHits: 0,
        malwareCount: 0,
        networkSpamCount: 0,
        date: today,
      })
    }

    await sndsRepo.updateSndsDomain(id, orgId, {
      lastSyncAt: new Date().toISOString(),
    })

    return { synced: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Sync failed'
    return { synced: false, error: msg }
  }
}

async function resolveDomainIps(domain: string): Promise<string[]> {
  try {
    const dns = await import('dns/promises')
    const aRecords = await dns.resolve4(domain)
    return aRecords
  } catch {
    return []
  }
}

export async function getSndsMetricsHistory(sndsDomainId: string, limit?: number): Promise<SndsMetrics[]> {
  return sndsRepo.getSndsMetricsHistory(sndsDomainId, limit)
}

export async function getSndsDashboardStats(orgId: string): Promise<SndsDashboardStats> {
  return sndsRepo.getSndsDashboardStats(orgId)
}

export async function deleteSndsDomain(id: string, orgId: string): Promise<{ success: boolean; error?: string }> {
  const existing = await sndsRepo.findSndsDomainById(id, orgId)
  if (!existing) return { success: false, error: 'Domain not found' }

  const deleted = await sndsRepo.deleteSndsDomain(id, orgId)
  return { success: deleted }
}
