import * as postmasterRepo from '@/repositories/mail/postmaster-repository'
import * as gptApi from './google-postmaster-api'
import type { PostmasterDomain, PostmasterMetrics, PostmasterDashboardStats } from '@/types/deliverability'

export async function listPostmasterDomains(orgId: string): Promise<PostmasterDomain[]> {
  return postmasterRepo.findPostmasterDomainsByOrg(orgId)
}

export async function getPostmasterDomain(id: string, orgId: string): Promise<PostmasterDomain | null> {
  return postmasterRepo.findPostmasterDomainById(id, orgId)
}

export async function connectPostmasterDomain(orgId: string, domain: string, domainId?: string): Promise<{ postmasterDomain: PostmasterDomain; error?: string }> {
  const existing = await postmasterRepo.findPostmasterDomainByName(orgId, domain)
  if (existing) return { postmasterDomain: existing, error: 'Domain already connected' }

  const postmasterDomain = await postmasterRepo.insertPostmasterDomain({
    organizationId: orgId,
    domainId,
    postmasterDomain: domain,
  })

  return { postmasterDomain }
}

export async function updatePostmasterDomainTokens(
  id: string,
  orgId: string,
  accessToken: string,
  refreshToken: string,
  expiresAt: string
): Promise<PostmasterDomain | null> {
  return postmasterRepo.updatePostmasterDomain(id, orgId, {
    connectionStatus: 'connected',
    accessToken,
    refreshToken,
    tokenExpiresAt: expiresAt,
  })
}

export async function disconnectPostmasterDomain(id: string, orgId: string): Promise<{ success: boolean; error?: string }> {
  const existing = await postmasterRepo.findPostmasterDomainById(id, orgId)
  if (!existing) return { success: false, error: 'Domain not found' }

  await postmasterRepo.updatePostmasterDomain(id, orgId, {
    connectionStatus: 'disconnected',
    accessToken: null,
    refreshToken: null,
    tokenExpiresAt: null,
  })

  return { success: true }
}

export async function syncPostmasterMetrics(id: string, orgId: string): Promise<{ synced: boolean; error?: string }> {
  const existing = await postmasterRepo.findPostmasterDomainById(id, orgId)
  if (!existing) return { synced: false, error: 'Domain not found' }
  if (existing.connectionStatus !== 'connected') return { synced: false, error: 'Not connected' }
  if (!existing.accessToken || !existing.refreshToken) return { synced: false, error: 'No OAuth tokens' }

  try {
    let accessToken = existing.accessToken

    if (existing.tokenExpiresAt && new Date(existing.tokenExpiresAt) <= new Date()) {
      const refreshResult = await gptApi.refreshAccessToken(existing.refreshToken)
      if ('error' in refreshResult) {
        await postmasterRepo.updatePostmasterDomain(id, orgId, { connectionStatus: 'error' })
        return { synced: false, error: refreshResult.error }
      }
      accessToken = refreshResult.accessToken
      await postmasterRepo.updatePostmasterDomain(id, orgId, {
        accessToken: refreshResult.accessToken,
        tokenExpiresAt: refreshResult.expiresAt,
      })
    }

    const verificationResult = await gptApi.verifyDomainOwnership(accessToken, existing.postmasterDomain)
    if ('error' in verificationResult) {
      return { synced: false, error: verificationResult.error }
    }

    await postmasterRepo.updatePostmasterDomain(id, orgId, {
      domainVerificationStatus: verificationResult.verified ? 'verified' : 'failed',
    })

    const statsResult = await gptApi.getTrafficStats(accessToken, existing.postmasterDomain)
    if ('error' in statsResult) {
      return { synced: false, error: statsResult.error }
    }

    const today = new Date().toISOString().split('T')[0]

    await postmasterRepo.insertMetrics({
      postmasterDomainId: id,
      organizationId: orgId,
      spamComplaintRate: statsResult.spamComplaintRate,
      authenticationSuccess: statsResult.authenticationSuccess,
      dkimSuccessRate: statsResult.dkimSuccessRate,
      spfSuccessRate: statsResult.spfSuccessRate,
      dmarcSuccessRate: statsResult.dmarcSuccessRate,
      userReportedSpam: statsResult.userReportedSpam,
      date: today,
      ipReputation: statsResult.ipReputation ?? undefined,
      domainReputation: statsResult.domainReputation ?? undefined,
    })

    await postmasterRepo.updatePostmasterDomain(id, orgId, {
      lastSyncAt: new Date().toISOString(),
    })

    return { synced: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Sync failed'
    return { synced: false, error: msg }
  }
}

export async function getMetricsHistory(postmasterDomainId: string, limit?: number): Promise<PostmasterMetrics[]> {
  return postmasterRepo.getMetricsHistory(postmasterDomainId, limit)
}

export async function getPostmasterDashboardStats(orgId: string): Promise<PostmasterDashboardStats> {
  return postmasterRepo.getPostmasterDashboardStats(orgId)
}

export async function deletePostmasterDomain(id: string, orgId: string): Promise<{ success: boolean; error?: string }> {
  const existing = await postmasterRepo.findPostmasterDomainById(id, orgId)
  if (!existing) return { success: false, error: 'Domain not found' }

  const deleted = await postmasterRepo.deletePostmasterDomain(id, orgId)
  return { success: deleted }
}
