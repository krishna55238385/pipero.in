import * as returnPathRepo from '@/repositories/mail/return-path-repository'
import * as domainRepo from '@/repositories/mail/domain-repository'
import { lookupReturnPath } from '@/lib/dns-resolver'
import type { ReturnPath, CreateReturnPathRequest, UpdateReturnPathRequest, ReturnPathStatus } from '@/types/deliverability'

export async function listReturnPaths(orgId: string): Promise<ReturnPath[]> {
  return returnPathRepo.findReturnPathsByOrg(orgId)
}

export async function listReturnPathsByDomain(domainId: string): Promise<ReturnPath[]> {
  return returnPathRepo.findReturnPathsByDomain(domainId)
}

export async function getReturnPath(id: string, orgId: string): Promise<ReturnPath | null> {
  return returnPathRepo.findReturnPathById(id, orgId)
}

export async function createReturnPath(orgId: string, request: CreateReturnPathRequest): Promise<{ returnPath: ReturnPath; error?: string }> {
  const domain = await domainRepo.findDomainById(request.domainId, orgId)
  if (!domain) return { returnPath: null as unknown as ReturnPath, error: 'Domain not found' }

  const existing = await returnPathRepo.findReturnPathsByDomain(request.domainId)
  const exists = existing.find(rp => rp.returnPathDomain === request.returnPathDomain)
  if (exists) return { returnPath: exists, error: 'Return path already exists' }

  const isDefault = request.isDefault ?? existing.length === 0
  const returnPath = await returnPathRepo.insertReturnPath({
    organizationId: orgId,
    domainId: request.domainId,
    returnPathDomain: request.returnPathDomain,
    cnameTarget: request.cnameTarget,
    isDefault,
  })

  await returnPathRepo.insertAuditEntry({
    returnPathId: returnPath.id,
    organizationId: orgId,
    action: 'created',
    newValue: request.returnPathDomain,
  })

  return { returnPath }
}

export async function updateReturnPath(id: string, orgId: string, request: UpdateReturnPathRequest): Promise<{ returnPath: ReturnPath | null; error?: string }> {
  const existing = await returnPathRepo.findReturnPathById(id, orgId)
  if (!existing) return { returnPath: null, error: 'Return path not found' }

  const updated = await returnPathRepo.updateReturnPath(id, orgId, request)
  if (!updated) return { returnPath: null, error: 'Failed to update' }

  await returnPathRepo.insertAuditEntry({
    returnPathId: id,
    organizationId: orgId,
    action: 'updated',
    previousValue: JSON.stringify(existing),
    newValue: JSON.stringify(request),
  })

  return { returnPath: updated }
}

export async function deleteReturnPath(id: string, orgId: string): Promise<{ success: boolean; error?: string }> {
  const existing = await returnPathRepo.findReturnPathById(id, orgId)
  if (!existing) return { success: false, error: 'Return path not found' }

  await returnPathRepo.insertAuditEntry({
    returnPathId: id,
    organizationId: orgId,
    action: 'deleted',
    previousValue: existing.returnPathDomain,
  })

  const deleted = await returnPathRepo.deleteReturnPath(id, orgId)
  return { success: deleted }
}

export async function verifyReturnPath(id: string, orgId: string): Promise<{ success: boolean; status: ReturnPathStatus; error?: string }> {
  const existing = await returnPathRepo.findReturnPathById(id, orgId)
  if (!existing) return { success: false, status: 'failed', error: 'Return path not found' }

  const domain = await domainRepo.findDomainById(existing.domainId, orgId)
  if (!domain) return { success: false, status: 'failed', error: 'Domain not found' }

  try {
    const result = await lookupReturnPath(domain.domain)
    const newStatus: ReturnPathStatus = result.valid ? 'active' : 'failed'

    await returnPathRepo.updateReturnPath(id, orgId, {
      status: newStatus,
      cnameTarget: result.cnameTarget,
      lastVerifiedAt: new Date().toISOString(),
    })

    await returnPathRepo.insertAuditEntry({
      returnPathId: id,
      organizationId: orgId,
      action: 'verified',
      newValue: newStatus,
    })

    return { success: true, status: newStatus }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Verification failed'
    await returnPathRepo.updateReturnPath(id, orgId, { status: 'failed' })
    return { success: false, status: 'failed', error: msg }
  }
}

export async function setDefaultReturnPath(id: string, domainId: string, orgId: string): Promise<{ success: boolean; error?: string }> {
  const existing = await returnPathRepo.findReturnPathById(id, orgId)
  if (!existing) return { success: false, error: 'Return path not found' }

  await returnPathRepo.updateReturnPath(id, orgId, { isDefault: true })
  return { success: true }
}

export async function rotateReturnPath(domainId: string, orgId: string, newReturnPathDomain: string): Promise<{ returnPath: ReturnPath; error?: string }> {
  const currentDefault = await returnPathRepo.findDefaultReturnPath(domainId)
  if (currentDefault) {
    await returnPathRepo.updateReturnPath(currentDefault.id, orgId, { isDefault: false, status: 'rotating' })
    await returnPathRepo.insertAuditEntry({
      returnPathId: currentDefault.id,
      organizationId: orgId,
      action: 'rotated_out',
      previousValue: currentDefault.returnPathDomain,
    })
  }

  const created = await createReturnPath(orgId, {
    domainId,
    returnPathDomain: newReturnPathDomain,
    isDefault: true,
  })

  if (created.error) return created

  await returnPathRepo.updateReturnPath(created.returnPath.id, orgId, { status: 'active' })

  return created
}

export async function getAuditHistory(returnPathId: string, limit: number = 50): Promise<unknown[]> {
  return returnPathRepo.getAuditHistory(returnPathId, limit)
}
