import * as blacklistRepo from '@/repositories/mail/blacklist-check-repository'
import * as domainRepo from '@/repositories/mail/domain-repository'
import type { BlacklistName, BlacklistStatus, BlacklistOverview, BlacklistDashboardStats } from '@/types/deliverability'

const BLACKLIST_DNS_PREFIXES: Record<BlacklistName, string> = {
  spamhaus: 'zen.spamhaus.org',
  barracuda: 'b.barracudacentral.org',
  uceprotect: 'dnsbl-1.uceprotect.net',
  spamcop: 'bl.spamcop.net',
  surbl: 'multi.surbl.org',
  multirbl: 'dnsbl.dronebl.org',
}

export async function checkBlacklistForDomain(
  orgId: string,
  domainId: string,
  blacklistName: BlacklistName,
  ip?: string
): Promise<{ status: BlacklistStatus; error?: string }> {
  const domain = await domainRepo.findDomainById(domainId, orgId)
  if (!domain) return { status: 'unknown', error: 'Domain not found' }

  const startTime = Date.now()

  try {
    const dns = await import('dns/promises')
    const checkDomain = ip
      ? `${ip.split('.').reverse().join('.')}.${BLACKLIST_DNS_PREFIXES[blacklistName]}`
      : `${domain.domain}.${BLACKLIST_DNS_PREFIXES[blacklistName]}`

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('DNS_TIMEOUT')), 5000)
    )

    try {
      await Promise.race([dns.resolveTxt(checkDomain), timeout])
      const durationMs = Date.now() - startTime

      await blacklistRepo.insertCheck({
        organizationId: orgId,
        domainId,
        blacklistName,
        status: 'listed',
        ip,
        checkResult: 'Listed on blacklist',
        durationMs,
      })

      return { status: 'listed' }
    } catch {
      const durationMs = Date.now() - startTime
      await blacklistRepo.insertCheck({
        organizationId: orgId,
        domainId,
        blacklistName,
        status: 'clean',
        ip,
        checkResult: 'Not listed',
        durationMs,
      })

      return { status: 'clean' }
    }
  } catch (err) {
    const durationMs = Date.now() - startTime
    const msg = err instanceof Error ? err.message : 'Check failed'

    await blacklistRepo.insertCheck({
      organizationId: orgId,
      domainId,
      blacklistName,
      status: 'timeout',
      ip,
      checkResult: msg,
      durationMs,
    })

    return { status: 'timeout', error: msg }
  }
}

export async function checkAllBlacklistsForDomain(
  orgId: string,
  domainId: string,
  ip?: string
): Promise<{ results: { blacklist: BlacklistName; status: BlacklistStatus }[] }> {
  const blacklists: BlacklistName[] = ['spamhaus', 'barracuda', 'uceprotect', 'spamcop', 'surbl', 'multirbl']
  const results: { blacklist: BlacklistName; status: BlacklistStatus }[] = []

  for (const bl of blacklists) {
    const result = await checkBlacklistForDomain(orgId, domainId, bl, ip)
    results.push({ blacklist: bl, status: result.status })
  }

  return { results }
}

export async function getBlacklistOverview(domainId: string): Promise<BlacklistOverview> {
  return blacklistRepo.getBlacklistOverview(domainId)
}

export async function getBlacklistDashboardStats(orgId: string): Promise<BlacklistDashboardStats> {
  return blacklistRepo.getBlacklistDashboardStats(orgId)
}

export async function getBlacklistHistory(domainId: string, _limit: number = 50): Promise<unknown[]> {
  return blacklistRepo.findChecksByDomain(domainId)
}

export async function delistFromBlacklist(
  id: string,
  orgId: string,
  reason?: string
): Promise<{ success: boolean; error?: string }> {
  const check = await blacklistRepo.findLatestCheckByBlacklist(
    (await blacklistRepo.findChecksByOrg(orgId))[0]?.domainId ?? '',
    'spamhaus'
  )
  if (!check) return { success: false, error: 'Check not found' }

  await blacklistRepo.updateCheck(id, {
    status: 'clean',
    delistedAt: new Date().toISOString(),
    checkResult: reason ?? 'Manual delist',
  })

  return { success: true }
}
