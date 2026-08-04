import pool from '@/lib/db'
import type { Lead, LeadStatus, MailApiResult } from '@/types/mail'
import { isSuppressed } from '@/services/mail/suppression-service'
import { verifyEmailAddress } from '@/services/mail/email-verification-service'

type MailLeadRow = {
  id: string
  organization_id: string
  email: string
  name: string
  company: string
  job_title: string
  status: string
  source: string
  verified_status: string
  suppressed: boolean
  last_contacted_at: string | null
  created_at: string
  updated_at: string
}

function mapLead(row: MailLeadRow): Lead {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    company: row.company,
    jobTitle: row.job_title,
    status: row.status as LeadStatus,
    source: row.source,
    verifiedStatus: (row.verified_status as Lead['verifiedStatus']) || 'unverified',
    suppressed: Boolean(row.suppressed),
    lastContactedAt: row.last_contacted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    organizationId: row.organization_id,
  }
}

export async function listMailLeads(
  orgId: string,
  opts?: { search?: string; status?: string; limit?: number; offset?: number }
): Promise<Lead[]> {
  const limit = opts?.limit ?? 100
  const offset = opts?.offset ?? 0
  const params: unknown[] = [orgId]
  let where = 'organization_id = $1'
  if (opts?.search) {
    params.push(`%${opts.search.toLowerCase()}%`)
    where += ` AND (LOWER(email) LIKE $${params.length} OR LOWER(name) LIKE $${params.length} OR LOWER(company) LIKE $${params.length})`
  }
  if (opts?.status && opts.status !== 'all') {
    params.push(opts.status)
    where += ` AND status = $${params.length}`
  }
  params.push(limit, offset)
  const result = await pool.query<MailLeadRow>(
    `SELECT * FROM public.mail_leads
     WHERE ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  )
  return result.rows.map(mapLead)
}

export async function getMailLeadById(id: string, orgId: string): Promise<Lead | null> {
  const result = await pool.query<MailLeadRow>(
    `SELECT * FROM public.mail_leads WHERE id = $1 AND organization_id = $2`,
    [id, orgId]
  )
  return result.rows[0] ? mapLead(result.rows[0]) : null
}

export async function createMailLeadRecord(
  orgId: string,
  input: { email: string; name?: string; company?: string; jobTitle?: string; source?: string }
): Promise<MailApiResult<Lead>> {
  const email = input.email.trim().toLowerCase()
  if (!email || !email.includes('@')) {
    return { success: false, error: 'Valid email is required' }
  }

  if (await isSuppressed(orgId, email)) {
    return { success: false, error: 'Email is on the suppression list' }
  }

  const existing = await pool.query(
    `SELECT id FROM public.mail_leads WHERE organization_id = $1 AND email = $2`,
    [orgId, email]
  )
  if (existing.rows[0]) {
    return { success: false, error: 'Lead with this email already exists' }
  }

  const verification = await verifyEmailAddress(email)
  if (verification.status === 'invalid' || verification.status === 'no_mx') {
    return { success: false, error: `Email failed verification: ${verification.status}` }
  }

  try {
    const result = await pool.query<MailLeadRow>(
      `INSERT INTO public.mail_leads
        (organization_id, email, name, company, job_title, source, verified_status, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        orgId,
        email,
        input.name ?? '',
        input.company ?? '',
        input.jobTitle ?? '',
        input.source ?? 'manual',
        verification.status,
        verification.status === 'risky' || verification.status === 'catch_all' ? 'new' : 'new',
      ]
    )
    return { success: true, data: mapLead(result.rows[0]) }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create lead'
    return { success: false, error: message }
  }
}

export async function updateMailLeadRecord(
  id: string,
  orgId: string,
  input: Partial<{ name: string; company: string; jobTitle: string; status: string }>
): Promise<MailApiResult<Lead>> {
  const sets: string[] = []
  const values: unknown[] = []
  let i = 1
  if (input.name !== undefined) {
    sets.push(`name = $${i++}`)
    values.push(input.name)
  }
  if (input.company !== undefined) {
    sets.push(`company = $${i++}`)
    values.push(input.company)
  }
  if (input.jobTitle !== undefined) {
    sets.push(`job_title = $${i++}`)
    values.push(input.jobTitle)
  }
  if (input.status !== undefined) {
    sets.push(`status = $${i++}`)
    values.push(input.status)
  }
  if (sets.length === 0) {
    const existing = await getMailLeadById(id, orgId)
    return existing ? { success: true, data: existing } : { success: false, error: 'Lead not found' }
  }
  sets.push('updated_at = NOW()')
  values.push(id, orgId)
  const result = await pool.query<MailLeadRow>(
    `UPDATE public.mail_leads SET ${sets.join(', ')}
     WHERE id = $${i++} AND organization_id = $${i}
     RETURNING *`,
    values
  )
  if (!result.rows[0]) return { success: false, error: 'Lead not found' }
  return { success: true, data: mapLead(result.rows[0]) }
}

export async function deleteMailLeadRecord(id: string, orgId: string): Promise<MailApiResult<boolean>> {
  const result = await pool.query(
    `DELETE FROM public.mail_leads WHERE id = $1 AND organization_id = $2`,
    [id, orgId]
  )
  return { success: true, data: (result.rowCount ?? 0) > 0 }
}

export type CsvImportRow = Record<string, string>

export type CsvImportResult = {
  valid: number
  risky: number
  invalid: number
  duplicates: number
  suppressed: number
  imported: number
  errors: string[]
}

export async function importMailLeadsFromCsv(
  orgId: string,
  rows: CsvImportRow[],
  mapping: { email: string; name?: string; company?: string; jobTitle?: string }
): Promise<MailApiResult<CsvImportResult>> {
  const summary: CsvImportResult = {
    valid: 0,
    risky: 0,
    invalid: 0,
    duplicates: 0,
    suppressed: 0,
    imported: 0,
    errors: [],
  }

  for (const row of rows) {
    const email = (row[mapping.email] || '').trim().toLowerCase()
    if (!email) {
      summary.invalid++
      continue
    }

    if (await isSuppressed(orgId, email)) {
      summary.suppressed++
      continue
    }

    const dup = await pool.query(
      `SELECT id FROM public.mail_leads WHERE organization_id = $1 AND email = $2`,
      [orgId, email]
    )
    if (dup.rows[0]) {
      summary.duplicates++
      continue
    }

    const verification = await verifyEmailAddress(email)
    if (verification.status === 'invalid' || verification.status === 'no_mx') {
      summary.invalid++
      continue
    }
    if (verification.status === 'risky' || verification.status === 'catch_all') {
      summary.risky++
    } else {
      summary.valid++
    }

    try {
      await pool.query(
        `INSERT INTO public.mail_leads
          (organization_id, email, name, company, job_title, source, verified_status)
         VALUES ($1,$2,$3,$4,$5,'csv',$6)
         ON CONFLICT (organization_id, email) DO NOTHING`,
        [
          orgId,
          email,
          mapping.name ? row[mapping.name] || '' : '',
          mapping.company ? row[mapping.company] || '' : '',
          mapping.jobTitle ? row[mapping.jobTitle] || '' : '',
          verification.status,
        ]
      )
      summary.imported++
    } catch (err) {
      summary.errors.push(err instanceof Error ? err.message : 'Import row failed')
    }
  }

  return { success: true, data: summary }
}

export type CsvImportPreview = CsvImportResult

export async function previewMailLeadsCsvImport(
  orgId: string,
  rows: CsvImportRow[],
  mapping: { email: string; name?: string; company?: string; jobTitle?: string }
): Promise<MailApiResult<CsvImportPreview>> {
  const summary: CsvImportPreview = {
    valid: 0,
    risky: 0,
    invalid: 0,
    duplicates: 0,
    suppressed: 0,
    imported: 0,
    errors: [],
  }

  for (const row of rows) {
    const email = (row[mapping.email] || '').trim().toLowerCase()
    if (!email) {
      summary.invalid++
      continue
    }

    if (await isSuppressed(orgId, email)) {
      summary.suppressed++
      continue
    }

    const dup = await pool.query(
      `SELECT id FROM public.mail_leads WHERE organization_id = $1 AND email = $2`,
      [orgId, email]
    )
    if (dup.rows[0]) {
      summary.duplicates++
      continue
    }

    const verification = await verifyEmailAddress(email)
    if (verification.status === 'invalid' || verification.status === 'no_mx') {
      summary.invalid++
      continue
    }
    if (verification.status === 'risky' || verification.status === 'catch_all') {
      summary.risky++
    } else {
      summary.valid++
    }
  }

  summary.imported = summary.valid + summary.risky
  return { success: true, data: summary }
}

export async function enrollMailLead(
  orgId: string,
  campaignId: string,
  leadId: string
): Promise<MailApiResult<{ enrollmentId: string }>> {
  const check = await canEnrollLead(orgId, leadId, campaignId)
  if (!check.allowed) {
    return { success: false, error: check.reason || 'Lead cannot be enrolled' }
  }

  try {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO public.mail_enrollments
        (organization_id, campaign_id, lead_id, status, next_send_at)
       VALUES ($1, $2, $3, 'active', NOW())
       RETURNING id`,
      [orgId, campaignId, leadId]
    )
    return { success: true, data: { enrollmentId: result.rows[0].id } }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Enrollment failed'
    return { success: false, error: message }
  }
}

export async function canEnrollLead(orgId: string, leadId: string, campaignId: string): Promise<{
  allowed: boolean
  reason?: string
}> {
  const lead = await pool.query<MailLeadRow>(
    `SELECT * FROM public.mail_leads WHERE id = $1 AND organization_id = $2`,
    [leadId, orgId]
  )
  const row = lead.rows[0]
  if (!row) return { allowed: false, reason: 'Lead not found' }
  if (row.suppressed) return { allowed: false, reason: 'Lead is suppressed' }
  if (await isSuppressed(orgId, row.email)) return { allowed: false, reason: 'Email is suppressed' }
  if (row.verified_status === 'invalid' || row.verified_status === 'no_mx') {
    return { allowed: false, reason: 'Lead email is undeliverable' }
  }
  const existing = await pool.query(
    `SELECT id FROM public.mail_enrollments WHERE campaign_id = $1 AND lead_id = $2`,
    [campaignId, leadId]
  )
  if (existing.rows[0]) return { allowed: false, reason: 'Lead already enrolled in this campaign' }

  const { assertCanEnrollLeads } = await import('./plan-limits-service')
  const planCheck = await assertCanEnrollLeads(orgId)
  if (!planCheck.success) return { allowed: false, reason: planCheck.error }

  return { allowed: true }
}

export async function reverifyLeadRecord(id: string, orgId: string): Promise<MailApiResult<Lead>> {
  const existing = await getMailLeadById(id, orgId)
  if (!existing) return { success: false, error: 'Lead not found' }

  const verification = await verifyEmailAddress(existing.email)
  const result = await pool.query<MailLeadRow>(
    `UPDATE public.mail_leads
     SET verified_status = $3,
         status = CASE
           WHEN $3 IN ('invalid', 'no_mx') THEN 'invalid'
           ELSE status
         END,
         updated_at = NOW()
     WHERE id = $1 AND organization_id = $2
     RETURNING *`,
    [id, orgId, verification.status]
  )
  if (!result.rows[0]) return { success: false, error: 'Lead not found' }
  return { success: true, data: mapLead(result.rows[0]) }
}

export async function getLeadVerificationStats(orgId: string): Promise<{
  total: number
  valid: number
  risky: number
  invalid: number
  unverified: number
  suppressed: number
}> {
  const result = await pool.query<{
    total: number
    valid: number
    risky: number
    invalid: number
    unverified: number
    suppressed: number
  }>(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE verified_status = 'valid')::int AS valid,
       COUNT(*) FILTER (WHERE verified_status IN ('risky', 'catch_all'))::int AS risky,
       COUNT(*) FILTER (WHERE verified_status IN ('invalid', 'no_mx'))::int AS invalid,
       COUNT(*) FILTER (WHERE verified_status = 'unverified')::int AS unverified,
       COUNT(*) FILTER (WHERE suppressed = TRUE)::int AS suppressed
     FROM public.mail_leads
     WHERE organization_id = $1`,
    [orgId]
  )
  return result.rows[0] || { total: 0, valid: 0, risky: 0, invalid: 0, unverified: 0, suppressed: 0 }
}

