import * as dkimSelectorRepo from '@/repositories/mail/dkim-selector-repository'
import * as domainRepo from '@/repositories/mail/domain-repository'
import { lookupDkim } from '@/lib/dns-resolver'
import type { DkimSelector, DkimSelectorStatus } from '@/types/deliverability'

export async function listSelectors(orgId: string): Promise<DkimSelector[]> {
  return dkimSelectorRepo.findSelectorsByOrg(orgId)
}

export async function listSelectorsByDomain(domainId: string): Promise<DkimSelector[]> {
  return dkimSelectorRepo.findSelectorsByDomain(domainId)
}

export async function getActiveSelector(domainId: string): Promise<DkimSelector | null> {
  return dkimSelectorRepo.findActiveSelector(domainId)
}

export async function getSelector(id: string, orgId: string): Promise<DkimSelector | null> {
  return dkimSelectorRepo.findSelectorById(id, orgId)
}

export async function createSelector(orgId: string, domainId: string, selector: string): Promise<{ selector: DkimSelector; error?: string }> {
  const domain = await domainRepo.findDomainById(domainId, orgId)
  if (!domain) return { selector: null as unknown as DkimSelector, error: 'Domain not found' }

  const existing = await dkimSelectorRepo.findSelectorByName(domainId, selector)
  if (existing) return { selector: existing, error: 'Selector already exists' }

  const inserted = await dkimSelectorRepo.insertSelector({
    organizationId: orgId,
    domainId,
    selector,
  })

  await dkimSelectorRepo.insertSelectorHistory({
    selectorId: inserted.id,
    domainId,
    organizationId: orgId,
    action: 'created',
    newSelector: selector,
  })

  return { selector: inserted }
}

export async function verifySelector(id: string, orgId: string): Promise<{ success: boolean; status: DkimSelectorStatus; error?: string }> {
  const existing = await dkimSelectorRepo.findSelectorById(id, orgId)
  if (!existing) return { success: false, status: 'failed', error: 'Selector not found' }

  const domain = await domainRepo.findDomainById(existing.domainId, orgId)
  if (!domain) return { success: false, status: 'failed', error: 'Domain not found' }

  try {
    const result = await lookupDkim(domain.domain, existing.selector)
    const newStatus: DkimSelectorStatus = result.valid ? 'active' : (result.found ? 'failed' : 'inactive')

    await dkimSelectorRepo.updateSelector(id, orgId, {
      status: newStatus,
      publicKey: result.record,
      keyLength: result.keyLength ?? undefined,
      lastVerifiedAt: new Date().toISOString(),
    })

    await dkimSelectorRepo.insertSelectorHistory({
      selectorId: id,
      domainId: existing.domainId,
      organizationId: orgId,
      action: 'verified',
      newSelector: newStatus,
      keyLength: result.keyLength ?? undefined,
    })

    return { success: true, status: newStatus }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Verification failed'
    await dkimSelectorRepo.updateSelector(id, orgId, { status: 'failed' })
    return { success: false, status: 'failed', error: msg }
  }
}

export async function rotateSelector(orgId: string, domainId: string, currentSelectorId: string, newSelector: string): Promise<{ selector: DkimSelector; error?: string }> {
  const current = await dkimSelectorRepo.findSelectorById(currentSelectorId, orgId)
  if (!current) return { selector: null as unknown as DkimSelector, error: 'Current selector not found' }

  await dkimSelectorRepo.updateSelector(currentSelectorId, orgId, { status: 'inactive', rotatedAt: new Date().toISOString() })
  await dkimSelectorRepo.insertSelectorHistory({
    selectorId: currentSelectorId,
    domainId,
    organizationId: orgId,
    action: 'rotated_out',
    previousSelector: current.selector,
  })

  const created = await createSelector(orgId, domainId, newSelector)
  if (created.error) return created

  await dkimSelectorRepo.updateSelector(created.selector.id, orgId, { status: 'active' })
  await dkimSelectorRepo.insertSelectorHistory({
    selectorId: created.selector.id,
    domainId,
    organizationId: orgId,
    action: 'activated',
    newSelector,
  })

  return created
}

export async function deleteSelector(id: string, orgId: string): Promise<{ success: boolean; error?: string }> {
  const existing = await dkimSelectorRepo.findSelectorById(id, orgId)
  if (!existing) return { success: false, error: 'Selector not found' }
  if (existing.status === 'active') return { success: false, error: 'Cannot delete active selector. Rotate first.' }

  const deleted = await dkimSelectorRepo.deleteSelector(id, orgId)
  return { success: deleted }
}

export async function getSelectorHistory(selectorId: string, limit: number = 50): Promise<unknown[]> {
  return dkimSelectorRepo.getSelectorHistory(selectorId, limit)
}
