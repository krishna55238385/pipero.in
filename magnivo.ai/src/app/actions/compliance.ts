'use server'

import { getSessionUser } from '@/lib/auth'
import * as gdprService from '@/services/mail/gdpr-service'
import type { MailApiResult } from '@/types/mail'
import type { DsrRequest, ConsentRecord } from '@/services/mail/gdpr-service'

type ActorInfo = { userId: string; email: string }
type AuthContext = { orgId: string; actor: ActorInfo }

async function getAuthContext(): Promise<AuthContext | null> {
  const session = await getSessionUser()
  if (!session?.orgId) return null
  return {
    orgId: session.orgId,
    actor: { userId: session.userId, email: session.email },
  }
}

export async function createDsrRequestAction(input: {
  requestType: DsrRequest['requestType']
  requesterEmail: string
  requesterName?: string
  details?: string
}): Promise<MailApiResult<DsrRequest>> {
  const ctx = await getAuthContext()
  if (!ctx) return { success: false, error: 'Not authenticated' }
  return gdprService.createDsrRequest({ ...input, organizationId: ctx.orgId })
}

export async function listDsrRequestsAction(limit?: number): Promise<DsrRequest[]> {
  const ctx = await getAuthContext()
  if (!ctx) return []
  try {
    return await gdprService.listDsrRequests(ctx.orgId, limit)
  } catch (err) {
    console.error('[compliance-actions] listDsrRequestsAction:', err instanceof Error ? err.message : err)
    return []
  }
}

export async function processAccessRequestAction(requestId: string): Promise<MailApiResult<{ downloadUrl: string }>> {
  const ctx = await getAuthContext()
  if (!ctx) return { success: false, error: 'Not authenticated' }
  return gdprService.processAccessRequest(requestId)
}

export async function processErasureRequestAction(requestId: string): Promise<MailApiResult<{ deletedRecords: number }>> {
  const ctx = await getAuthContext()
  if (!ctx) return { success: false, error: 'Not authenticated' }
  return gdprService.processErasureRequest(requestId)
}

export async function rejectDsrRequestAction(requestId: string, reason: string): Promise<MailApiResult<DsrRequest>> {
  const ctx = await getAuthContext()
  if (!ctx) return { success: false, error: 'Not authenticated' }
  return gdprService.rejectDsrRequest(requestId, reason)
}

export async function recordConsentAction(input: {
  email: string
  consentType: ConsentRecord['consentType']
  status: ConsentRecord['status']
  ipAddress?: string
  userAgent?: string
}): Promise<MailApiResult<ConsentRecord>> {
  const ctx = await getAuthContext()
  if (!ctx) return { success: false, error: 'Not authenticated' }
  return gdprService.recordConsent({ ...input, organizationId: ctx.orgId })
}

export async function getConsentHistoryAction(email: string): Promise<ConsentRecord[]> {
  const ctx = await getAuthContext()
  if (!ctx) return []
  try {
    return await gdprService.getConsentHistory(ctx.orgId, email)
  } catch (err) {
    console.error('[compliance-actions] getConsentHistoryAction:', err instanceof Error ? err.message : err)
    return []
  }
}

export async function hasConsentAction(
  email: string,
  consentType: ConsentRecord['consentType']
): Promise<boolean> {
  const ctx = await getAuthContext()
  if (!ctx) return false
  try {
    return await gdprService.hasConsent(ctx.orgId, email, consentType)
  } catch {
    return false
  }
}

export async function getComplianceAuditLogAction(limit?: number): Promise<any[]> {
  const ctx = await getAuthContext()
  if (!ctx) return []
  try {
    return await gdprService.getComplianceAuditLog(ctx.orgId, limit)
  } catch (err) {
    console.error('[compliance-actions] getComplianceAuditLogAction:', err instanceof Error ? err.message : err)
    return []
  }
}
