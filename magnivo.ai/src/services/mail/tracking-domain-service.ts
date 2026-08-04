import * as trackingDomainRepo from '@/repositories/mail/tracking-domain-repository'
import { lookupTrackingDomain } from '@/lib/dns-resolver'
import type { TrackingDomain, TrackingDomainStatus } from '@/types/deliverability'

export async function listTrackingDomains(orgId: string): Promise<TrackingDomain[]> {
  return trackingDomainRepo.findTrackingDomainsByOrg(orgId)
}

export async function listTrackingDomainsByDomain(domainId: string): Promise<TrackingDomain[]> {
  return trackingDomainRepo.findTrackingDomainsByDomain(domainId)
}

export async function getTrackingDomain(id: string, orgId?: string): Promise<TrackingDomain | null> {
  return trackingDomainRepo.findTrackingDomainById(id, orgId)
}

export async function createTrackingDomain(
  orgId: string,
  domainId: string,
  trackingDomain: string
): Promise<{ trackingDomain: TrackingDomain | null; error?: string }> {
  const normalized = trackingDomain.toLowerCase().trim()

  // Enforce per-tenant isolation: no shared tracking domain across organizations
  // (unique index idx_mail_tracking_domains_name_global + service check)
  const crossTenant = await trackingDomainRepo.findTrackingDomainByNameGlobal(normalized)
  if (crossTenant && crossTenant.organizationId !== orgId) {
    return {
      trackingDomain: null,
      error:
        'This tracking domain is already claimed by another Magnivo workspace. Choose a unique subdomain for your organization.',
    }
  }

  const existing = await trackingDomainRepo.findTrackingDomainsByOrg(orgId)
  const duplicate = existing.find(
    (td) => td.trackingDomain.toLowerCase() === normalized
  )
  if (duplicate) {
    return { trackingDomain: duplicate, error: 'Tracking domain already exists' }
  }

  const created = await trackingDomainRepo.insertTrackingDomain({
    organizationId: orgId,
    domainId,
    trackingDomain: normalized,
  })

  return { trackingDomain: created }
}

export async function deleteTrackingDomain(id: string, orgId: string): Promise<{ success: boolean; error?: string }> {
  const existing = await trackingDomainRepo.findTrackingDomainById(id, orgId)
  if (!existing) return { success: false, error: 'Tracking domain not found' }

  const deleted = await trackingDomainRepo.deleteTrackingDomain(id, orgId)
  return { success: deleted }
}

export async function verifyTrackingDomain(id: string, orgId: string): Promise<{
  verified: boolean
  status: TrackingDomainStatus | undefined
  cnameTarget: string | null
  error?: string
}> {
  const existing = await trackingDomainRepo.findTrackingDomainById(id, orgId)
  if (!existing) return { verified: false, status: 'failed', cnameTarget: null, error: 'Not found' }

  try {
    const result = await lookupTrackingDomain(existing.trackingDomain)

    if (result.found && result.valid) {
      await trackingDomainRepo.updateTrackingDomain(id, {
        status: 'verified',
        cnameTarget: result.cnameTarget ?? null,
        lastVerifiedAt: new Date().toISOString(),
      }, orgId)
      return {
        verified: true,
        status: 'verified',
        cnameTarget: result.cnameTarget ?? null,
      }
    }

    if (result.found && !result.valid) {
      await trackingDomainRepo.updateTrackingDomain(id, {
        status: 'failed',
        cnameTarget: result.cnameTarget ?? null,
        lastVerifiedAt: new Date().toISOString(),
      }, orgId)
      return {
        verified: false,
        status: 'failed',
        cnameTarget: result.cnameTarget ?? null,
        error: result.errors?.join('. ') ?? 'CNAME validation failed',
      }
    }

    await trackingDomainRepo.updateTrackingDomain(id, {
      status: 'unverified',
      cnameTarget: null,
      lastVerifiedAt: new Date().toISOString(),
    }, orgId)
    return {
      verified: false,
      status: 'unverified',
      cnameTarget: null,
      error: 'DNS record not found. Please add the CNAME record.',
    }
  } catch (err) {
    await trackingDomainRepo.updateTrackingDomain(id, {
      status: 'failed',
      lastVerifiedAt: new Date().toISOString(),
    }, orgId)
    return {
      verified: false,
      status: 'failed',
      cnameTarget: null,
      error: err instanceof Error ? err.message : 'Verification failed',
    }
  }
}

export async function setDefaultTrackingDomain(id: string, orgId: string): Promise<{ success: boolean; error?: string }> {
  const existing = await trackingDomainRepo.findTrackingDomainById(id, orgId)
  if (!existing) return { success: false, error: 'Tracking domain not found' }

  const allDomains = await trackingDomainRepo.findTrackingDomainsByOrg(orgId)
  for (const td of allDomains) {
    if (td.metadata?.isDefault && td.id !== id) {
      await trackingDomainRepo.updateTrackingDomain(td.id, {
        cnameTarget: td.cnameTarget,
      }, orgId)
    }
  }

  return { success: true }
}
