import pool from '@/lib/db'
import type { MailApiResult } from '@/types/mail'
import { canEnrollLead, enrollMailLead } from '@/services/mail/lead-service'

export type LeadList = {
  id: string
  organizationId: string
  name: string
  description: string
  memberCount: number
  createdAt: string
  updatedAt: string
}

export type EnrollmentPreview = {
  totalMembers: number
  eligible: number
  excludedInvalid: number
  excludedSuppressed: number
  excludedDuplicate: number
  excludedOther: number
}

async function refreshMemberCount(listId: string, orgId: string): Promise<void> {
  await pool.query(
    `UPDATE public.mail_lead_lists l
     SET member_count = (
       SELECT COUNT(*)::int FROM public.mail_lead_list_members m
       WHERE m.list_id = l.id AND m.organization_id = $2
     ),
     updated_at = NOW()
     WHERE l.id = $1 AND l.organization_id = $2`,
    [listId, orgId]
  )
}

function mapList(row: {
  id: string
  organization_id: string
  name: string
  description: string
  member_count: number
  created_at: string
  updated_at: string
}): LeadList {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    description: row.description || '',
    memberCount: row.member_count || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function listLeadLists(
  orgId: string,
  opts?: { search?: string; page?: number; pageSize?: number }
): Promise<{ lists: LeadList[]; total: number; page: number; pageSize: number; totalPages: number }> {
  const page = Math.max(1, opts?.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, opts?.pageSize ?? 20))
  const offset = (page - 1) * pageSize
  const params: unknown[] = [orgId]
  let where = 'organization_id = $1'
  if (opts?.search) {
    params.push(`%${opts.search.toLowerCase()}%`)
    where += ` AND LOWER(name) LIKE $${params.length}`
  }
  const countResult = await pool.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM public.mail_lead_lists WHERE ${where}`,
    params
  )
  const total = countResult.rows[0]?.count ?? 0
  params.push(pageSize, offset)
  const result = await pool.query(
    `SELECT * FROM public.mail_lead_lists
     WHERE ${where}
     ORDER BY updated_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  )
  return {
    lists: result.rows.map(mapList),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  }
}

export async function createLeadList(
  orgId: string,
  input: { name: string; description?: string }
): Promise<MailApiResult<LeadList>> {
  const name = input.name.trim()
  if (!name) return { success: false, error: 'List name is required' }
  try {
    const result = await pool.query(
      `INSERT INTO public.mail_lead_lists (organization_id, name, description)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [orgId, name, input.description?.trim() || '']
    )
    return { success: true, data: mapList(result.rows[0]) }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create list'
    if (/unique/i.test(message)) return { success: false, error: 'A list with this name already exists' }
    return { success: false, error: message }
  }
}

export async function updateLeadList(
  id: string,
  orgId: string,
  input: { name?: string; description?: string }
): Promise<MailApiResult<LeadList>> {
  const sets: string[] = []
  const values: unknown[] = []
  let i = 1
  if (input.name !== undefined) {
    sets.push(`name = $${i++}`)
    values.push(input.name.trim())
  }
  if (input.description !== undefined) {
    sets.push(`description = $${i++}`)
    values.push(input.description)
  }
  if (sets.length === 0) {
    const existing = await pool.query(`SELECT * FROM public.mail_lead_lists WHERE id = $1 AND organization_id = $2`, [id, orgId])
    if (!existing.rows[0]) return { success: false, error: 'List not found' }
    return { success: true, data: mapList(existing.rows[0]) }
  }
  sets.push('updated_at = NOW()')
  values.push(id, orgId)
  try {
    const result = await pool.query(
      `UPDATE public.mail_lead_lists SET ${sets.join(', ')}
       WHERE id = $${i++} AND organization_id = $${i}
       RETURNING *`,
      values
    )
    if (!result.rows[0]) return { success: false, error: 'List not found' }
    return { success: true, data: mapList(result.rows[0]) }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Update failed' }
  }
}

export async function deleteLeadList(id: string, orgId: string): Promise<MailApiResult<boolean>> {
  const result = await pool.query(
    `DELETE FROM public.mail_lead_lists WHERE id = $1 AND organization_id = $2`,
    [id, orgId]
  )
  return { success: true, data: (result.rowCount ?? 0) > 0 }
}

export async function addLeadsToList(
  listId: string,
  orgId: string,
  leadIds: string[]
): Promise<MailApiResult<{ added: number }>> {
  const unique = [...new Set(leadIds.filter(Boolean))]
  if (unique.length === 0) return { success: false, error: 'No leads provided' }
  const list = await pool.query(`SELECT id FROM public.mail_lead_lists WHERE id = $1 AND organization_id = $2`, [listId, orgId])
  if (!list.rows[0]) return { success: false, error: 'List not found' }

  let added = 0
  for (const leadId of unique) {
    const lead = await pool.query(
      `SELECT id FROM public.mail_leads WHERE id = $1 AND organization_id = $2`,
      [leadId, orgId]
    )
    if (!lead.rows[0]) continue
    const inserted = await pool.query(
      `INSERT INTO public.mail_lead_list_members (organization_id, list_id, lead_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (list_id, lead_id) DO NOTHING`,
      [orgId, listId, leadId]
    )
    if ((inserted.rowCount ?? 0) > 0) added++
  }
  await refreshMemberCount(listId, orgId)
  return { success: true, data: { added } }
}

export async function removeLeadFromList(
  listId: string,
  orgId: string,
  leadId: string
): Promise<MailApiResult<boolean>> {
  const result = await pool.query(
    `DELETE FROM public.mail_lead_list_members
     WHERE list_id = $1 AND lead_id = $2 AND organization_id = $3`,
    [listId, leadId, orgId]
  )
  await refreshMemberCount(listId, orgId)
  return { success: true, data: (result.rowCount ?? 0) > 0 }
}

export async function listLeadListMembers(
  listId: string,
  orgId: string,
  opts?: { page?: number; pageSize?: number; search?: string }
): Promise<{
  members: Array<{ leadId: string; email: string; name: string; verifiedStatus: string; suppressed: boolean }>
  total: number
  page: number
  pageSize: number
}> {
  const page = Math.max(1, opts?.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, opts?.pageSize ?? 25))
  const offset = (page - 1) * pageSize
  const params: unknown[] = [listId, orgId]
  let where = 'm.list_id = $1 AND m.organization_id = $2'
  if (opts?.search) {
    params.push(`%${opts.search.toLowerCase()}%`)
    where += ` AND (LOWER(l.email) LIKE $${params.length} OR LOWER(l.name) LIKE $${params.length})`
  }
  const countResult = await pool.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
     FROM public.mail_lead_list_members m
     JOIN public.mail_leads l ON l.id = m.lead_id
     WHERE ${where}`,
    params
  )
  params.push(pageSize, offset)
  const result = await pool.query(
    `SELECT l.id AS lead_id, l.email, l.name, l.verified_status, l.suppressed
     FROM public.mail_lead_list_members m
     JOIN public.mail_leads l ON l.id = m.lead_id
     WHERE ${where}
     ORDER BY l.email ASC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  )
  return {
    members: result.rows.map((r) => ({
      leadId: r.lead_id,
      email: r.email,
      name: r.name,
      verifiedStatus: r.verified_status,
      suppressed: Boolean(r.suppressed),
    })),
    total: countResult.rows[0]?.count ?? 0,
    page,
    pageSize,
  }
}

export async function previewListEnrollment(
  orgId: string,
  campaignId: string,
  listId: string
): Promise<MailApiResult<EnrollmentPreview>> {
  const members = await pool.query<{ lead_id: string }>(
    `SELECT lead_id FROM public.mail_lead_list_members
     WHERE list_id = $1 AND organization_id = $2`,
    [listId, orgId]
  )
  const preview: EnrollmentPreview = {
    totalMembers: members.rows.length,
    eligible: 0,
    excludedInvalid: 0,
    excludedSuppressed: 0,
    excludedDuplicate: 0,
    excludedOther: 0,
  }
  for (const row of members.rows) {
    const check = await canEnrollLead(orgId, row.lead_id, campaignId)
    if (check.allowed) {
      preview.eligible++
      continue
    }
    const reason = (check.reason || '').toLowerCase()
    if (reason.includes('undeliverable') || reason.includes('invalid')) preview.excludedInvalid++
    else if (reason.includes('suppress')) preview.excludedSuppressed++
    else if (reason.includes('already enrolled') || reason.includes('duplicate')) preview.excludedDuplicate++
    else preview.excludedOther++
  }
  return { success: true, data: preview }
}

export async function enrollListIntoCampaign(
  orgId: string,
  campaignId: string,
  listId: string
): Promise<MailApiResult<{ enrolled: number; skipped: number; preview: EnrollmentPreview }>> {
  const previewResult = await previewListEnrollment(orgId, campaignId, listId)
  if (!previewResult.success) {
    return { success: false, error: previewResult.error || 'Preview failed' }
  }
  if (!previewResult.data) {
    return { success: false, error: 'Preview failed' }
  }
  const members = await pool.query<{ lead_id: string }>(
    `SELECT lead_id FROM public.mail_lead_list_members
     WHERE list_id = $1 AND organization_id = $2`,
    [listId, orgId]
  )
  let enrolled = 0
  let skipped = 0
  for (const row of members.rows) {
    const result = await enrollMailLead(orgId, campaignId, row.lead_id)
    if (result.success) enrolled++
    else skipped++
  }

  await pool.query(
    `UPDATE public.campaigns
     SET lead_list_id = $3, recipient_count = COALESCE(recipient_count, 0) + $4, updated_at = NOW()
     WHERE id = $1 AND organization_id = $2`,
    [campaignId, orgId, listId, enrolled]
  ).catch(async () => {
    // lead_list_id column may not exist until migration applied
    await pool.query(
      `UPDATE public.campaigns
       SET recipient_count = COALESCE(recipient_count, 0) + $3, updated_at = NOW()
       WHERE id = $1 AND organization_id = $2`,
      [campaignId, orgId, enrolled]
    ).catch(() => {})
  })

  return {
    success: true,
    data: {
      enrolled,
      skipped,
      preview: previewResult.data,
    },
  }
}
