import pool from '@/lib/db'
import { suppressEmail } from './suppression-service'
import type { MailApiResult } from '@/types/mail'

export type DsrRequest = {
  id: string
  organizationId: string
  requestType: 'access' | 'erasure' | 'portability' | 'rectification' | 'restrict_processing'
  requesterEmail: string
  requesterName?: string
  status: 'pending' | 'processing' | 'completed' | 'rejected'
  details?: string
  completedAt?: string
  rejectionReason?: string
  dataExportUrl?: string
  createdAt: string
}

export type ConsentRecord = {
  id: string
  organizationId: string
  email: string
  consentType: 'marketing' | 'outreach' | 'tracking'
  status: 'granted' | 'withdrawn'
  ipAddress?: string
  userAgent?: string
  grantedAt: string
  withdrawnAt?: string
}

function toDsrRequest(row: Record<string, unknown>): DsrRequest {
  return {
    id: row.id as string,
    organizationId: row.organization_id as string,
    requestType: row.request_type as DsrRequest['requestType'],
    requesterEmail: row.requester_email as string,
    requesterName: row.requester_name as string | undefined,
    status: row.status as DsrRequest['status'],
    details: row.details as string | undefined,
    completedAt: (row.completed_at as string) ?? undefined,
    rejectionReason: row.rejection_reason as string | undefined,
    dataExportUrl: row.data_export_url as string | undefined,
    createdAt: row.created_at as string,
  }
}

function toConsentRecord(row: Record<string, unknown>): ConsentRecord {
  return {
    id: row.id as string,
    organizationId: row.organization_id as string,
    email: row.email as string,
    consentType: row.consent_type as ConsentRecord['consentType'],
    status: row.status as ConsentRecord['status'],
    ipAddress: row.ip_address as string | undefined,
    userAgent: row.user_agent as string | undefined,
    grantedAt: row.granted_at as string,
    withdrawnAt: row.withdrawn_at as string | undefined,
  }
}

export async function createDsrRequest(input: {
  organizationId: string
  requestType: DsrRequest['requestType']
  requesterEmail: string
  requesterName?: string
  details?: string
}): Promise<MailApiResult<DsrRequest>> {
  try {
    const result = await pool.query(
      `INSERT INTO public.mail_dsr_requests
        (organization_id, request_type, requester_email, requester_name, details)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        input.organizationId,
        input.requestType,
        input.requesterEmail.trim().toLowerCase(),
        input.requesterName ?? null,
        input.details ?? null,
      ]
    )
    return { success: true, data: toDsrRequest(result.rows[0] as Record<string, unknown>) }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create DSR request'
    return { success: false, error: message }
  }
}

export async function listDsrRequests(orgId: string, limit?: number): Promise<DsrRequest[]> {
  try {
    const result = await pool.query(
      `SELECT * FROM public.mail_dsr_requests
       WHERE organization_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [orgId, limit ?? 100]
    )
    return result.rows.map((r) => toDsrRequest(r as Record<string, unknown>))
  } catch {
    return []
  }
}

export async function processAccessRequest(requestId: string): Promise<MailApiResult<{ downloadUrl: string }>> {
  try {
    const req = await pool.query(
      `SELECT * FROM public.mail_dsr_requests WHERE id = $1`,
      [requestId]
    )
    if (!req.rows[0]) return { success: false, error: 'DSR request not found' }

    const orgId = req.rows[0].organization_id as string
    const email = req.rows[0].requester_email as string

    await pool.query(
      `UPDATE public.mail_dsr_requests
       SET status = 'processing', updated_at = NOW()
       WHERE id = $1`,
      [requestId]
    )

    const exportData = {
      dsrRequest: req.rows[0],
      consentRecords: (await pool.query(
        `SELECT * FROM public.mail_consent_records
         WHERE organization_id = $1 AND email = $2
         ORDER BY granted_at DESC`,
        [orgId, email]
      )).rows,
      suppressions: (await pool.query(
        `SELECT * FROM public.mail_email_suppressions
         WHERE organization_id = $1 AND LOWER(email) = $2`,
        [orgId, email.toLowerCase()]
      )).rows,
      leads: (await pool.query(
        `SELECT id, email, name, company, status, source, suppressed, created_at, updated_at
         FROM public.mail_leads
         WHERE organization_id = $1 AND LOWER(email) = $2`,
        [orgId, email.toLowerCase()]
      )).rows,
      exportedAt: new Date().toISOString(),
    }

    const downloadUrl = `/api/gdpr/export/${requestId}`

    await pool.query(
      `UPDATE public.mail_dsr_requests
       SET status = 'completed', data_export_url = $2, completed_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [requestId, downloadUrl]
    )

    await logComplianceEvent(orgId, 'access_exported', email, `Access request ${requestId} processed`)

    return { success: true, data: { downloadUrl } }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to process access request'
    return { success: false, error: message }
  }
}

export async function processErasureRequest(requestId: string): Promise<MailApiResult<{ deletedRecords: number }>> {
  try {
    const req = await pool.query(
      `SELECT * FROM public.mail_dsr_requests WHERE id = $1`,
      [requestId]
    )
    if (!req.rows[0]) return { success: false, error: 'DSR request not found' }

    const orgId = req.rows[0].organization_id as string
    const email = req.rows[0].requester_email as string

    await pool.query(
      `UPDATE public.mail_dsr_requests
       SET status = 'processing', updated_at = NOW()
       WHERE id = $1`,
      [requestId]
    )

    let deletedRecords = 0

    const consentDel = await pool.query(
      `DELETE FROM public.mail_consent_records
       WHERE organization_id = $1 AND email = $2`,
      [orgId, email]
    )
    deletedRecords += consentDel.rowCount ?? 0

    const supDel = await pool.query(
      `DELETE FROM public.mail_email_suppressions
       WHERE organization_id = $1 AND LOWER(email) = $2`,
      [orgId, email.toLowerCase()]
    )
    deletedRecords += supDel.rowCount ?? 0

    const leadResult = await pool.query(
      `UPDATE public.mail_leads
       SET email = 'redacted-' || id || '@redacted.in',
           name = 'REDACTED',
           company = 'REDACTED',
           suppressed = TRUE,
           suppression_reason = 'GDPR erasure',
           updated_at = NOW()
       WHERE organization_id = $1 AND LOWER(email) = $2
       RETURNING id`,
      [orgId, email.toLowerCase()]
    )
    deletedRecords += leadResult.rowCount ?? 0

    await pool.query(
      `UPDATE public.mail_dsr_requests
       SET status = 'completed', completed_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [requestId]
    )

    await enforceSuppressionForDsr(orgId, email)
    await logComplianceEvent(orgId, 'erasure_completed', email, `Erasure request ${requestId} processed: ${deletedRecords} records affected`)

    return { success: true, data: { deletedRecords } }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to process erasure request'
    return { success: false, error: message }
  }
}

export async function processPortabilityRequest(requestId: string): Promise<MailApiResult<{ downloadUrl: string }>> {
  try {
    const req = await pool.query(
      `SELECT * FROM public.mail_dsr_requests WHERE id = $1`,
      [requestId]
    )
    if (!req.rows[0]) return { success: false, error: 'DSR request not found' }

    const orgId = req.rows[0].organization_id as string
    const email = req.rows[0].requester_email as string

    await pool.query(
      `UPDATE public.mail_dsr_requests
       SET status = 'processing', updated_at = NOW()
       WHERE id = $1`,
      [requestId]
    )

    const consentRecords = (await pool.query(
      `SELECT consent_type, status, granted_at, withdrawn_at
       FROM public.mail_consent_records
       WHERE organization_id = $1 AND email = $2
       ORDER BY granted_at DESC`,
      [orgId, email]
    )).rows

    const leads = (await pool.query(
      `SELECT id, email, name, company, status, source, created_at, updated_at
       FROM public.mail_leads
       WHERE organization_id = $1 AND LOWER(email) = $2`,
      [orgId, email.toLowerCase()]
    )).rows

    const portabilityData = {
      schema: 'https://schema.gdpr.mail/v1',
      exportedAt: new Date().toISOString(),
      data: {
        personalInformation: { email },
        consentRecords,
        leadData: leads,
      },
    }

    const downloadUrl = `/api/gdpr/export/${requestId}?format=json`

    await pool.query(
      `UPDATE public.mail_dsr_requests
       SET status = 'completed', data_export_url = $2, completed_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [requestId, downloadUrl]
    )

    await logComplianceEvent(orgId, 'portability_exported', email, `Portability request ${requestId} processed`)

    return { success: true, data: { downloadUrl } }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to process portability request'
    return { success: false, error: message }
  }
}

export async function rejectDsrRequest(requestId: string, reason: string): Promise<MailApiResult<DsrRequest>> {
  try {
    const result = await pool.query(
      `UPDATE public.mail_dsr_requests
       SET status = 'rejected', rejection_reason = $2, completed_at = NOW(), updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [requestId, reason]
    )
    if (!result.rows[0]) return { success: false, error: 'DSR request not found' }

    const req = result.rows[0] as Record<string, unknown>
    const orgId = req.organization_id as string
    const email = req.requester_email as string
    await logComplianceEvent(orgId, 'dsr_rejected', email, `DSR request ${requestId} rejected: ${reason}`)

    return { success: true, data: toDsrRequest(req) }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to reject DSR request'
    return { success: false, error: message }
  }
}

export async function recordConsent(input: {
  organizationId: string
  email: string
  consentType: ConsentRecord['consentType']
  status: ConsentRecord['status']
  ipAddress?: string
  userAgent?: string
}): Promise<MailApiResult<ConsentRecord>> {
  try {
    const normalizedEmail = input.email.trim().toLowerCase()

    if (input.status === 'withdrawn') {
      const result = await pool.query(
        `UPDATE public.mail_consent_records
         SET status = 'withdrawn', withdrawn_at = NOW(), user_agent = COALESCE($4, user_agent)
         WHERE organization_id = $1 AND email = $2 AND consent_type = $3 AND status = 'granted'
         RETURNING *`,
        [input.organizationId, normalizedEmail, input.consentType, input.userAgent ?? null]
      )
      if (result.rows[0]) {
        await logComplianceEvent(input.organizationId, 'consent_withdrawn', normalizedEmail, `Consent ${input.consentType} withdrawn`)
        return { success: true, data: toConsentRecord(result.rows[0] as Record<string, unknown>) }
      }
      return { success: false, error: 'No active consent record found to withdraw' }
    }

    const existing = await pool.query(
      `SELECT * FROM public.mail_consent_records
       WHERE organization_id = $1 AND email = $2 AND consent_type = $3 AND status = 'granted'`,
      [input.organizationId, normalizedEmail, input.consentType]
    )

    if (existing.rows[0]) {
      return { success: true, data: toConsentRecord(existing.rows[0] as Record<string, unknown>) }
    }

    const result = await pool.query(
      `INSERT INTO public.mail_consent_records
        (organization_id, email, consent_type, status, ip_address, user_agent)
       VALUES ($1, $2, $3, 'granted', $4, $5)
       RETURNING *`,
      [
        input.organizationId,
        normalizedEmail,
        input.consentType,
        input.ipAddress ?? null,
        input.userAgent ?? null,
      ]
    )

    await logComplianceEvent(input.organizationId, 'consent_granted', normalizedEmail, `Consent ${input.consentType} granted`)

    return { success: true, data: toConsentRecord(result.rows[0] as Record<string, unknown>) }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to record consent'
    return { success: false, error: message }
  }
}

export async function hasConsent(
  orgId: string,
  email: string,
  consentType: ConsentRecord['consentType']
): Promise<boolean> {
  try {
    const result = await pool.query(
      `SELECT 1 FROM public.mail_consent_records
       WHERE organization_id = $1
         AND LOWER(email) = $2
         AND consent_type = $3
         AND status = 'granted'
       LIMIT 1`,
      [orgId, email.trim().toLowerCase(), consentType]
    )
    return result.rows.length > 0
  } catch {
    return false
  }
}

export async function withdrawConsent(
  orgId: string,
  email: string,
  consentType: ConsentRecord['consentType']
): Promise<MailApiResult<boolean>> {
  try {
    const result = await pool.query(
      `UPDATE public.mail_consent_records
       SET status = 'withdrawn', withdrawn_at = NOW()
       WHERE organization_id = $1
         AND LOWER(email) = $2
         AND consent_type = $3
         AND status = 'granted'`,
      [orgId, email.trim().toLowerCase(), consentType]
    )

    if ((result.rowCount ?? 0) === 0) {
      return { success: false, error: 'No active consent found for the given email and type' }
    }

    await logComplianceEvent(orgId, 'consent_withdrawn', email.trim().toLowerCase(), `Consent ${consentType} withdrawn via withdrawConsent`)
    return { success: true, data: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to withdraw consent'
    return { success: false, error: message }
  }
}

export async function getConsentHistory(orgId: string, email: string): Promise<ConsentRecord[]> {
  try {
    const result = await pool.query(
      `SELECT * FROM public.mail_consent_records
       WHERE organization_id = $1 AND LOWER(email) = $2
       ORDER BY granted_at DESC`,
      [orgId, email.trim().toLowerCase()]
    )
    return result.rows.map((r) => toConsentRecord(r as Record<string, unknown>))
  } catch {
    return []
  }
}

export async function enforceSuppressionForDsr(orgId: string, email: string): Promise<void> {
  try {
    await suppressEmail(orgId, email, 'GDPR compliance erasure', 'gdpr_dsr')
  } catch {
    console.error('[gdpr] Failed to enforce suppression for DSR:', email)
  }
}

export async function getComplianceAuditLog(orgId: string, limit?: number): Promise<any[]> {
  try {
    const result = await pool.query(
      `SELECT * FROM public.mail_compliance_audit_log
       WHERE organization_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [orgId, limit ?? 100]
    )
    return result.rows
  } catch {
    return []
  }
}

async function logComplianceEvent(
  orgId: string,
  eventType: string,
  targetEmail: string,
  description: string,
  actorEmail?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO public.mail_compliance_audit_log
        (organization_id, event_type, actor_email, target_email, description, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        orgId,
        eventType,
        actorEmail ?? null,
        targetEmail,
        description,
        metadata ? JSON.stringify(metadata) : '{}',
      ]
    )
  } catch {
    console.error('[gdpr] Failed to log compliance event')
  }
}
