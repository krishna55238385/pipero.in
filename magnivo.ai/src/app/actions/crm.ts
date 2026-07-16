'use server'

import pool from '@/lib/db'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'crypto'
import { revalidatePath } from 'next/cache'
import { createNotification, getMockableUser } from '@/app/actions/notifications'
import { executeAutomationFlows } from '@/app/actions/automation'
import { getSessionUser, requireAdmin as requireAdminSession } from '@/lib/auth'
import { logLeadEvent } from '@/app/actions/lead-management'
import { createLeadRecord, type PublicLeadPayload } from '@/lib/create-lead-record'

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getDefaultOrgId(): Promise<string | null> {
  const session = await getSessionUser()
  return session?.orgId ?? null
}

async function requireAdmin() {
  const { isAdmin, user, error } = await requireAdminSession()
  if (!user) return { isAdmin, user: null, error }
  return { isAdmin, user: { id: user.userId, email: user.email, role: user.role }, error }
}

// Minimal shim for imported functions (logLeadEvent, createLeadRecord) that still expect supabase
function createDbShim() {
  function makeTable(tableName: string) {
    let conds: Array<{ col: string; val: any; op: string }> = []
    let limitN: number | null = null
    const tbl: any = {
      select: () => tbl, eq: (col: string, val: any) => { conds.push({ col, val, op: '=' }); return tbl },
      limit: (n: number) => { limitN = n; return tbl },
      order: () => tbl, single: () => tbl, maybeSingle: () => tbl,
      ilike: () => tbl, or: () => tbl, is: () => tbl, gte: () => tbl, in: () => tbl, neq: () => tbl,
      then: async (resolve: any) => {
        try {
          const vals = conds.map(c => c.val)
          const where = conds.length ? `WHERE ${conds.map((c, i) => `"${c.col}" ${c.op} $${i + 1}`).join(' AND ')}` : ''
          const lim = limitN ? `LIMIT ${limitN}` : ''
          const result = await pool.query(`SELECT * FROM public."${tableName}" ${where} ${lim}`.trim(), vals)
          const data = limitN === 1 ? (result.rows[0] ?? null) : result.rows
          resolve({ data, error: null })
        } catch (err: any) { resolve({ data: null, error: { message: err.message } }) }
      },
      insert: async (row: any) => {
        try {
          const items = Array.isArray(row) ? row : [row]
          const rows: any[] = []
          for (const item of items) {
            const keys = Object.keys(item); const vals = Object.values(item)
            const ph = keys.map((_, i) => `$${i + 1}`).join(', ')
            const res = await pool.query(`INSERT INTO public."${tableName}" (${keys.map(k => `"${k}"`).join(', ')}) VALUES (${ph}) RETURNING *`, vals)
            rows.push(res.rows[0])
          }
          const data = rows.length === 1 ? rows[0] : rows
          return { data, error: null, select: () => ({ data, error: null, single: () => ({ data, error: null }) }) }
        } catch (err: any) { return { data: null, error: { message: err.message } } }
      },
      update: (updates: any) => {
        const uq: any = {
          eq: (col: string, val: any) => { conds.push({ col, val, op: '=' }); return uq },
          is: () => uq, gte: () => uq, select: () => uq, single: () => uq,
          then: async (resolve: any) => {
            try {
              const ukeys = Object.keys(updates); const uvals = Object.values(updates)
              const sets = ukeys.map((k, i) => `"${k}" = $${i + 1}`).join(', ')
              const where = conds.length ? `WHERE ${conds.map((c, i) => `"${c.col}" ${c.op} $${ukeys.length + i + 1}`).join(' AND ')}` : ''
              const res = await pool.query(`UPDATE public."${tableName}" SET ${sets} ${where} RETURNING *`.trim(), [...uvals, ...conds.map(c => c.val)])
              resolve({ data: res.rows, error: null })
            } catch (err: any) { resolve({ data: null, error: { message: err.message } }) }
          }
        }
        return uq
      }
    }
    return tbl
  }
  return {
    from: (table: string) => makeTable(table),
    auth: { getUser: async () => { const s = await getSessionUser(); return { data: { user: s ? { id: s.userId, email: s.email } : null }, error: null } } }
  }
}

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface LeadFilters {
  q?: string; temperature?: string; status?: string; source?: string
  subject?: string; campaign?: string; owner_id?: string; dateRange?: string
  dateFrom?: string; dateTo?: string; page?: number; pageSize?: number
}

// ─── getLeads ─────────────────────────────────────────────────────────────────

export async function getLeads(filters: LeadFilters = {}) {
  const orgId = await getDefaultOrgId()
  if (!orgId) return { data: [], count: 0, debug: 'no-org-id' }

  const session = await getSessionUser()
  if (!session) return { data: [], count: 0, debug: 'no-user-prod' }

  const userId: string | null = session.userId
  const isAdmin = session.role === 'admin' || session.role === 'super_admin'

  const values: any[] = [orgId]
  const conditions: string[] = ['l.organization_id = $1']

  if (!isAdmin && userId) {
    values.push(userId)
    conditions.push(`(l.owner_id = $${values.length} OR l.owner_id IS NULL)`)
  }
  if (filters.q) {
    values.push(`%${filters.q}%`); const n = values.length
    conditions.push(`(l.name ILIKE $${n} OR l.contact_person ILIKE $${n})`)
  }
  if (filters.temperature && filters.temperature !== 'all') { values.push(filters.temperature); conditions.push(`l.temperature = $${values.length}`) }
  if (filters.status && filters.status !== 'All Statuses') { values.push(filters.status); conditions.push(`l.status = $${values.length}`) }
  if (filters.source && filters.source !== 'All Sources') { values.push(filters.source); conditions.push(`l.source = $${values.length}`) }
  if (filters.subject && filters.subject !== 'All Subjects') { values.push(filters.subject); conditions.push(`l.subject = $${values.length}`) }
  if (filters.campaign && filters.campaign !== 'All Campaigns') { values.push(filters.campaign); conditions.push(`l.campaign = $${values.length}`) }
  if (filters.owner_id && filters.owner_id !== 'All Owners') { values.push(filters.owner_id); conditions.push(`l.owner_id = $${values.length}`) }
  if (filters.dateRange && filters.dateRange !== 'all') {
    const now = new Date()
    const days = filters.dateRange === '7d' ? 7 : filters.dateRange === '30d' ? 30 : 90
    values.push(new Date(now.setDate(now.getDate() - days)).toISOString())
    conditions.push(`l.created_at >= $${values.length}`)
  }
  if (filters.dateFrom) { values.push(filters.dateFrom); conditions.push(`l.created_at >= $${values.length}`) }
  if (filters.dateTo) {
    const toDate = new Date(filters.dateTo); toDate.setDate(toDate.getDate() + 1)
    values.push(toDate.toISOString()); conditions.push(`l.created_at < $${values.length}`)
  }

  const where = `WHERE ${conditions.join(' AND ')}`
  const countResult = await pool.query(`SELECT COUNT(*) FROM public.leads l ${where}`, values)
  const count = parseInt(countResult.rows[0].count, 10)

  let pagination = ''
  if (filters.page && filters.pageSize) {
    const offset = (filters.page - 1) * filters.pageSize
    values.push(filters.pageSize, offset)
    pagination = `LIMIT $${values.length - 1} OFFSET $${values.length}`
  }

  try {
    const result = await pool.query(`
      SELECT l.*,
        COALESCE((SELECT json_agg(json_build_object('id', d.id, 'value', d.value, 'status', d.status))
          FROM public.deals d WHERE d.lead_id = l.id), '[]'::json) AS deals,
        COALESCE((SELECT json_agg(json_build_object('id', t.id, 'status', t.status))
          FROM public.tasks t WHERE t.lead_id = l.id), '[]'::json) AS tasks
      FROM public.leads l ${where} ORDER BY l.created_at DESC ${pagination}
    `, values)
    return {
      data: result.rows, count,
      debug: `success-count-${result.rows.length}-total-${count}-isAdmin-${isAdmin}-user-${userId || 'mock'}`
    }
  } catch (err: any) {
    console.error('Error fetching leads:', err.message)
    return { data: [], count: 0, debug: `pg-error: ${err.message}` }
  }
}

// ─── getDeals ─────────────────────────────────────────────────────────────────

export async function getDeals(searchQuery?: string) {
  const orgId = await getDefaultOrgId()
  if (!orgId) return []

  const session = await getSessionUser()
  if (!session) return []

  const userId: string | null = session.userId
  const isAdmin = session.role === 'admin' || session.role === 'super_admin'

  const values: any[] = [orgId]
  const conditions: string[] = ['d.organization_id = $1']

  if (!isAdmin && userId) { values.push(userId); conditions.push(`(d.assigned_to = $${values.length} OR d.assigned_to IS NULL)`) }
  if (searchQuery) { values.push(`%${searchQuery}%`); conditions.push(`d.title ILIKE $${values.length}`) }

  try {
    const result = await pool.query(`
      SELECT d.*,
        json_build_object('name', l.name, 'contact_person', l.contact_person, 'owner_id', l.owner_id, 'location', l.location, 'created_at', l.created_at) AS leads,
        json_build_object('id', u.id, 'full_name', u.full_name) AS assigned_user
      FROM public.deals d
      LEFT JOIN public.leads l ON l.id = d.lead_id
      LEFT JOIN public.users u ON u.id = d.assigned_to
      WHERE ${conditions.join(' AND ')} ORDER BY d.created_at DESC
    `, values)
    return result.rows
  } catch (err: any) { console.error('Error fetching deals:', err.message); return [] }
}

// ─── addLead ──────────────────────────────────────────────────────────────────

export async function addLead(formData: FormData) {
  const orgId = await getDefaultOrgId()
  if (!orgId) return { error: 'No organization found' }

  const session = await getSessionUser()
  if (!session) return { error: 'Not authenticated' }

  const payload: PublicLeadPayload = {
    company: (formData.get('company') as string) || '',
    name: (formData.get('name') as string) || '',
    phone: (formData.get('phone') as string) || '',
    location: (formData.get('location') as string) || '',
    temperature: (formData.get('temperature') as string) || 'cold',
    source: (formData.get('source') as string) || 'Direct',
    industry: (formData.get('industry') as string) || '',
    zip_code: (formData.get('zip_code') as string) || '',
    value: formData.get('value') as string | null
  }

  const result = await createLeadRecord(orgId, payload, {
    initialOwnerId: session.userId || null,
    method: 'manual',
    defaultSource: 'Direct',
    performedBy: session.userId || null
  })

  if ('error' in result) return { error: result.error }

  await logActivity(orgId, 'created_lead', `added a new lead: ${result.data.name}`, result.data.id)

  if (result.data.owner_id) {
    const actor = await getMockableUser()
    if (actor?.id !== result.data.owner_id) {
      await createNotification({
        user_id: result.data.owner_id, actor_id: actor?.id, type: 'assigned_lead',
        title: 'New Lead Assigned', content: `You have been assigned a new lead: ${result.data.name}`,
        link_url: `/leads/${result.data.id}`,
      })
    }
  }

  revalidatePath('/leads'); revalidatePath('/')
  executeAutomationFlows('lead_created', 'lead', result.data.id, result.data).catch(console.error)
  return { success: true }
}

// ─── addLeads ─────────────────────────────────────────────────────────────────

export async function addLeads(leadsData: any[]) {
  const orgId = await getDefaultOrgId()
  if (!orgId) return { error: 'No organization found' }

  const { isAdmin, error: authError } = await requireAdmin()
  if (!isAdmin) return { error: authError || 'Unauthorized' }

  const normalize = (row: any) => {
    const out: any = {}
    for (const k of Object.keys(row || {})) {
      const key = String(k).toLowerCase().trim().replace(/\s+/g, '_')
      const val = row[k]
      if (val !== undefined && val !== null && String(val).trim() !== '') out[key] = String(val).trim()
    }
    return out
  }

  const formattedLeads = leadsData.map(raw => {
    const lead = normalize(raw)
    const name = lead.name || lead.contact_person || lead.company || ''
    const contactPerson = lead.contact_person || lead.name || lead.contact || ''
    const phone = lead.phone || lead.phone_number || ''
    const email = lead.email || ''
    const source = lead.utm_source || lead.source || 'Campaign'
    const subject = lead.subject || lead.course || ''
    const campaign = lead.campaign || lead.utm_campaign || ''
    const gradeLevel = lead.grade_level || lead.grade || ''
    const demoDateRaw = lead.demo_date || lead.date || lead.select_date || ''
    const demoTimeSlot = lead.demo_time_slot || lead.time_slot || lead.select_time_slot || ''

    const utmMetadata: Record<string, string> = {}
    if (lead.utm_campaign) utmMetadata.utm_campaign = lead.utm_campaign
    if (lead.utm_medium) utmMetadata.utm_medium = lead.utm_medium
    if (lead.full_url) utmMetadata.full_url = lead.full_url
    if (lead.timestamp) utmMetadata.timestamp = lead.timestamp
    if (gradeLevel) utmMetadata.grade_level = gradeLevel
    if (demoDateRaw) utmMetadata.demo_date = demoDateRaw
    if (demoTimeSlot) utmMetadata.demo_time_slot = demoTimeSlot
    if (subject) utmMetadata.subject = subject
    if (campaign) utmMetadata.campaign = campaign

    let demoDate: string | null = null
    if (demoDateRaw) {
      const parsed = new Date(demoDateRaw)
      if (!Number.isNaN(parsed.getTime())) demoDate = parsed.toISOString().slice(0, 10)
    }

    return {
      organization_id: orgId,
      name: name || 'Unknown Company',
      contact_person: contactPerson || name || '',
      phone_number: phone || '',
      email: email || undefined,
      location: lead.location || lead.city || '',
      temperature: lead.temperature || 'cold',
      status: lead.status || 'New',
      source, subject: subject || null, campaign: campaign || null,
      grade_level: gradeLevel || null, demo_date: demoDate,
      demo_time_slot: demoTimeSlot || null,
      ...(Object.keys(utmMetadata).length > 0 && { utm_metadata: JSON.stringify(utmMetadata) }),
    }
  }).filter(l => l.phone_number)

  if (formattedLeads.length === 0) {
    return { error: 'No valid rows to import. Ensure columns include Name/Email/Phone and at least one row has a phone number.' }
  }

  const client = await pool.connect()
  try {
    const insertedRows: any[] = []
    await client.query('BEGIN')
    for (const lead of formattedLeads) {
      const keys = Object.keys(lead).filter(k => (lead as any)[k] !== undefined)
      const vals = keys.map(k => (lead as any)[k])
      const ph = keys.map((_, i) => `$${i + 1}`).join(', ')
      const res = await client.query(
        `INSERT INTO public.leads (${keys.map(k => `"${k}"`).join(', ')}) VALUES (${ph}) RETURNING *`, vals)
      insertedRows.push(res.rows[0])
    }
    await client.query('COMMIT')

    await logActivity(orgId, 'imported_leads', `imported ${formattedLeads.length} leads`)

    const user = await getMockableUser()
    const shim = createDbShim()
    for (const lead of insertedRows) {
      await logLeadEvent(shim, orgId, {
        lead_id: lead.id, event_type: 'lead_created',
        description: `Lead created via bulk import.`,
        metadata: { source: lead.source, method: 'import' }, performed_by: user?.id
      })
    }

    revalidatePath('/leads'); revalidatePath('/')
    return { success: true, count: insertedRows.length }
  } catch (err: any) {
    await client.query('ROLLBACK')
    console.error('Error adding bulk leads:', err.message)
    return { error: err.message }
  } finally {
    client.release()
  }
}

// ─── bulkDeleteLeads ──────────────────────────────────────────────────────────

export async function bulkDeleteLeads(leadIds: string[]) {
  const orgId = await getDefaultOrgId()
  if (!orgId) return { error: 'No organization found' }

  const { isAdmin, error: authError } = await requireAdmin()
  if (!isAdmin) return { error: authError || 'Unauthorized' }

  try {
    const ph = leadIds.map((_, i) => `$${i + 1}`).join(', ')
    await pool.query(`DELETE FROM public.leads WHERE id IN (${ph})`, leadIds)

    await logActivity(orgId, 'deleted_leads', `deleted ${leadIds.length} leads`)

    const user = await getMockableUser()
    const shim = createDbShim()
    for (const leadId of leadIds) {
      await logLeadEvent(shim, orgId, {
        lead_id: leadId, event_type: 'lead_deleted',
        description: `Lead deleted via bulk action.`, performed_by: user?.id
      })
    }

    revalidatePath('/leads'); revalidatePath('/')
    return { success: true }
  } catch (err: any) { return { error: err.message } }
}

// ─── bulkUpdateLeadStatus ─────────────────────────────────────────────────────

export async function bulkUpdateLeadStatus(leadIds: string[], status: string) {
  const orgId = await getDefaultOrgId()
  if (!orgId) return { error: 'No organization found' }

  const { isAdmin, error: authError } = await requireAdmin()
  if (!isAdmin) return { error: authError || 'Unauthorized' }

  try {
    const ph = leadIds.map((_, i) => `$${i + 2}`).join(', ')
    await pool.query(`UPDATE public.leads SET status = $1 WHERE id IN (${ph})`, [status, ...leadIds])

    await logActivity(orgId, 'updated_leads', `updated status of ${leadIds.length} leads to ${status}`)

    const user = await getMockableUser()
    const shim = createDbShim()
    for (const leadId of leadIds) {
      await logLeadEvent(shim, orgId, {
        lead_id: leadId, event_type: 'status_changed',
        description: `Status updated in bulk to ${status}.`,
        metadata: { new_status: status }, performed_by: user?.id
      })
    }

    revalidatePath('/leads'); revalidatePath('/')
    if (leadIds.length > 0) leadIds.forEach(id => executeAutomationFlows('status_changed', 'lead', id, { status }).catch(console.error))
    return { success: true }
  } catch (err: any) { return { error: err.message } }
}

// ─── bulkAssignLeads ──────────────────────────────────────────────────────────

export async function bulkAssignLeads(leadIds: string[], ownerId: string) {
  const orgId = await getDefaultOrgId()
  if (!orgId) return { error: 'No organization found' }

  const { isAdmin, error: authError } = await requireAdmin()
  if (!isAdmin) return { error: authError || 'Unauthorized' }

  try {
    const ph = leadIds.map((_, i) => `$${i + 2}`).join(', ')
    await pool.query(`UPDATE public.leads SET owner_id = $1 WHERE id IN (${ph})`, [ownerId, ...leadIds])

    await logActivity(orgId, 'updated_leads', `assigned ${leadIds.length} leads to a rep`)

    const actor = await getMockableUser()
    const ownerResult = await pool.query('SELECT full_name FROM public.users WHERE id = $1', [ownerId])
    const owner = ownerResult.rows[0]
    const shim = createDbShim()

    for (const leadId of leadIds) {
      await logLeadEvent(shim, orgId, {
        lead_id: leadId, event_type: 'lead_updated',
        description: `Lead assigned to ${owner?.full_name || 'a rep'} in bulk.`,
        metadata: { owner_id: ownerId }, performed_by: actor?.id
      })
    }

    if (actor?.id !== ownerId) {
      await createNotification({
        user_id: ownerId, actor_id: actor?.id, type: 'assigned_lead',
        title: 'Leads Assigned to You',
        content: `${leadIds.length} lead${leadIds.length > 1 ? 's have' : ' has'} been assigned to you.`,
        link_url: '/leads'
      })
    }

    revalidatePath('/leads'); revalidatePath('/')
    return { success: true }
  } catch (err: any) { return { error: err.message } }
}
// ─── updateLeadField ──────────────────────────────────────────────────────────

export async function updateLeadField(id: string, field: string, value: string | number) {
  const orgId = await getDefaultOrgId()
  if (!orgId) return { error: 'No organization found' }

  const allowedFields = ['name', 'contact_person', 'phone_number', 'company', 'location', 'temperature', 'tags', 'health_score', 'owner_id', 'status']
  if (!allowedFields.includes(field)) return { error: 'Invalid field' }

  try {
    await pool.query(`UPDATE public.leads SET "${field}" = $1 WHERE id = $2`, [value, id])
    await logActivity(orgId, 'updated_lead', `updated ${field} for a lead`)

    const actor = await getMockableUser()
    const shim = createDbShim()
    await logLeadEvent(shim, orgId, {
      lead_id: id,
      event_type: field === 'status' ? 'status_changed' : 'lead_updated',
      description: `Updated field '${field}' to '${value}'.`,
      metadata: { field, new_value: value },
      performed_by: actor?.id
    })

    if (field === 'owner_id' && value) {
      const leadResult = await pool.query('SELECT name FROM public.leads WHERE id = $1', [id])
      const lead = leadResult.rows[0]
      const a = await getMockableUser()
      if (a?.id !== value) {
        await createNotification({
          user_id: String(value), actor_id: a?.id, type: 'assigned_lead',
          title: 'New Lead Assigned',
          content: `You have been assigned a new lead: ${lead?.name}`,
          link_url: `/leads/${id}`
        })
      }
    }

    revalidatePath('/leads'); revalidatePath('/')
    if (field === 'status') executeAutomationFlows('status_changed', 'lead', id, { status: value }).catch(console.error)
    return { success: true }
  } catch (err: any) { return { error: err.message } }
}

// ─── deleteLead ───────────────────────────────────────────────────────────────

export async function deleteLead(id: string) {
  const orgId = await getDefaultOrgId()
  if (!orgId) return { error: 'No organization found' }

  const { isAdmin, error: authError } = await requireAdmin()
  if (!isAdmin) return { error: authError || 'Unauthorized' }

  try {
    const result = await pool.query('DELETE FROM public.leads WHERE id = $1', [id])
    if (result.rowCount === 0) return { error: 'Lead not found', notFound: true }

    await logActivity(orgId, 'deleted_lead', `deleted a lead`)

    const user = await getMockableUser()
    const shim = createDbShim()
    await logLeadEvent(shim, orgId, {
      lead_id: id, event_type: 'lead_deleted',
      description: `Lead deleted manually.`, performed_by: user?.id
    })

    revalidatePath('/leads'); revalidatePath('/')
    return { success: true }
  } catch (err: any) { return { error: err.message } }
}

// ─── addDeal ──────────────────────────────────────────────────────────────────

export async function addDeal(formData: FormData) {
  const orgId = await getDefaultOrgId()
  if (!orgId) return { error: 'No organization found' }

  try {
    const stagesResult = await pool.query(
      'SELECT label FROM public.pipeline_stages WHERE organization_id = $1 ORDER BY sort_order ASC LIMIT 1', [orgId])
    const defaultStage = stagesResult.rows[0]?.label?.toLowerCase() || 'lead'

    const data = {
      organization_id: orgId,
      lead_id: formData.get('lead') as string,
      title: formData.get('title') as string,
      value: parseFloat(formData.get('value') as string) || 0,
      status: (formData.get('stage') as string)?.toLowerCase() || defaultStage
    }

    const result = await pool.query(
      'INSERT INTO public.deals (organization_id, lead_id, title, value, status) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [data.organization_id, data.lead_id, data.title, data.value, data.status])
    const insertedData = result.rows[0]

    await logActivity(orgId, 'created_deal', `created a new deal: ${data.title} for $${data.value}`, data.lead_id, insertedData.id)
    revalidatePath('/deals'); revalidatePath('/')
    return { success: true }
  } catch (err: any) { return { error: err.message } }
}

// ─── getLeadById ──────────────────────────────────────────────────────────────

export async function getLeadById(id: string) {
  const orgId = await getDefaultOrgId()
  if (!orgId) return null

  try {
    const result = await pool.query(`
      SELECT l.*,
        COALESCE((SELECT json_agg(d.*) FROM public.deals d WHERE d.lead_id = l.id), '[]'::json) AS deals
      FROM public.leads l WHERE l.organization_id = $1 AND l.id = $2 LIMIT 1
    `, [orgId, id])
    return result.rows[0] || null
  } catch (err: any) { console.error('Error fetching lead:', err.message); return null }
}

// ─── getLeadFilterOptions ─────────────────────────────────────────────────────

export async function getLeadFilterOptions() {
  const orgId = await getDefaultOrgId()
  if (!orgId) return { subjects: [], campaigns: [], sources: [] }

  try {
    const result = await pool.query('SELECT subject, campaign, source FROM public.leads WHERE organization_id = $1', [orgId])
    const rows = result.rows
    const subjects = [...new Set(rows.map((r: any) => r.subject).filter(Boolean))].sort() as string[]
    const campaigns = [...new Set(rows.map((r: any) => r.campaign).filter(Boolean))].sort() as string[]
    const sources = [...new Set(rows.map((r: any) => r.source).filter(Boolean))].sort() as string[]
    return { subjects, campaigns, sources }
  } catch { return { subjects: [], campaigns: [], sources: [] } }
}

// ─── updateDealStage ──────────────────────────────────────────────────────────

export async function updateDealStage(dealId: string, newStage: string) {
  const orgId = await getDefaultOrgId()
  if (!orgId) return { error: 'No organization found' }

  try {
    const dealResult = await pool.query('SELECT title, value FROM public.deals WHERE id = $1', [dealId])
    const deal = dealResult.rows[0]

    const updates: any = { status: newStage, last_activity_at: new Date().toISOString() }
    if (newStage === 'won' || newStage === 'lost') updates.probability = newStage === 'won' ? 100 : 0

    const keys = Object.keys(updates); const vals = Object.values(updates)
    const sets = keys.map((k, i) => `"${k}" = $${i + 1}`).join(', ')
    await pool.query(
      `UPDATE public.deals SET ${sets} WHERE id = $${keys.length + 1} AND organization_id = $${keys.length + 2}`,
      [...vals, dealId, orgId])

    await logActivity(orgId, 'updated_deal', `moved "${deal?.title || 'deal'}" to ${newStage}`, undefined, dealId)

    if (newStage === 'won') {
      const adminResult = await pool.query('SELECT id FROM public.users WHERE role = $1 LIMIT 1', ['admin'])
      const adminUser = adminResult.rows[0]
      if (adminUser) {
        const actor = await getMockableUser()
        await createNotification({
          user_id: adminUser.id, actor_id: actor?.id, type: 'deal_won',
          title: `Deal Won: ${deal?.title}`,
          content: `This deal was just marked as Won! Value: $${deal?.value || 0}`,
          link_url: '/deals'
        })
      }
    }

    revalidatePath('/deals'); revalidatePath('/')
    if (newStage.toLowerCase() === 'won') executeAutomationFlows('deal_won', 'deal', dealId, { status: newStage }).catch(console.error)
    executeAutomationFlows('stage_changed', 'deal', dealId, { status: newStage }).catch(console.error)
    return { success: true }
  } catch (err: any) { return { error: err.message } }
}

// ─── updateDeal ───────────────────────────────────────────────────────────────

export async function updateDeal(dealId: string, fields: {
  title?: string; value?: number; notes?: string; close_date?: string
  probability?: number; assigned_to?: string | null; status?: string
}) {
  const orgId = await getDefaultOrgId()
  if (!orgId) return { error: 'No organization found' }

  try {
    const updates = { ...fields, last_activity_at: new Date().toISOString() }
    const keys = Object.keys(updates); const vals = Object.values(updates)
    const sets = keys.map((k, i) => `"${k}" = $${i + 1}`).join(', ')
    await pool.query(
      `UPDATE public.deals SET ${sets} WHERE id = $${keys.length + 1} AND organization_id = $${keys.length + 2}`,
      [...vals, dealId, orgId])

    await logActivity(orgId, 'updated_deal', `updated deal details`, undefined, dealId)
    revalidatePath('/deals'); revalidatePath('/')

    if (fields.status) {
      if (fields.status.toLowerCase() === 'won') executeAutomationFlows('deal_won', 'deal', dealId, fields).catch(console.error)
      executeAutomationFlows('stage_changed', 'deal', dealId, fields).catch(console.error)
    }
    return { success: true }
  } catch (err: any) { return { error: err.message } }
}

// ─── deleteDeal ───────────────────────────────────────────────────────────────

export async function deleteDeal(dealId: string) {
  const orgId = await getDefaultOrgId()
  if (!orgId) return { error: 'No organization found' }

  const { isAdmin, error: authError } = await requireAdmin()
  if (!isAdmin) return { error: authError || 'Unauthorized' }

  try {
    const dealResult = await pool.query('SELECT title FROM public.deals WHERE id = $1', [dealId])
    const deal = dealResult.rows[0]
    await pool.query('DELETE FROM public.deals WHERE id = $1 AND organization_id = $2', [dealId, orgId])
    await logActivity(orgId, 'deleted_deal', `deleted deal: "${deal?.title || 'unknown'}"`)
    revalidatePath('/deals'); revalidatePath('/')
    return { success: true }
  } catch (err: any) { return { error: err.message } }
}

// ─── getTasks ─────────────────────────────────────────────────────────────────

export async function getTasks(leadId?: string, repId?: string) {
  const orgId = await getDefaultOrgId()
  if (!orgId) return []

  const user = await getMockableUser()
  let isAdmin = false
  if (user) {
    const r = await pool.query('SELECT role FROM public.users WHERE id = $1', [user.id])
    isAdmin = r.rows[0]?.role === 'admin' || r.rows[0]?.role === 'super_admin'
  }

  const values: any[] = [orgId]
  const conditions: string[] = ['t.organization_id = $1']

  if (leadId) { values.push(leadId); conditions.push(`t.lead_id = $${values.length}`) }
  if (!isAdmin && user) { values.push(user.id); conditions.push(`(t.assigned_to = $${values.length} OR t.assigned_to IS NULL)`) }
  else if (isAdmin && repId) { values.push(repId); conditions.push(`t.assigned_to = $${values.length}`) }

  try {
    const result = await pool.query(`
      SELECT t.*,
        json_build_object('id', l.id, 'name', l.name, 'owner_id', l.owner_id) AS leads,
        json_build_object('title', d.title) AS deals,
        json_build_object('id', u.id, 'full_name', u.full_name, 'role', u.role) AS users
      FROM public.tasks t
      LEFT JOIN public.leads l ON l.id = t.lead_id
      LEFT JOIN public.deals d ON d.id = t.deal_id
      LEFT JOIN public.users u ON u.id = t.assigned_to
      WHERE ${conditions.join(' AND ')} ORDER BY t.due_date ASC
    `, values)
    return result.rows
  } catch (err: any) { console.error('Error fetching tasks:', err.message); return [] }
}

// ─── getOrgMembers ────────────────────────────────────────────────────────────

export async function getOrgMembers() {
  const orgId = await getDefaultOrgId()
  if (!orgId) return []
  try {
    const result = await pool.query(
      'SELECT id, full_name, role FROM public.users WHERE organization_id = $1 AND is_active = true ORDER BY full_name', [orgId])
    return result.rows
  } catch (err: any) { console.error('Error fetching members:', err.message); return [] }
}

type SearchParams = { q?: string }

function logDbError(context: string, error: unknown) {
  const e = error as any
  console.error(context, { message: e?.message, code: e?.code })
}

function isMissingRelation(error: unknown) {
  const e = error as any
  return e?.code === '42P01' || (typeof e?.message === 'string' && e.message.toLowerCase().includes('does not exist'))
}

// ─── getCompanies ─────────────────────────────────────────────────────────────

export async function getCompanies(params: SearchParams = {}) {
  const orgId = await getDefaultOrgId()
  if (!orgId) return []
  try {
    const values: any[] = [orgId]
    let where = 'WHERE organization_id = $1'
    if (params.q) {
      values.push(`%${params.q}%`); const n = values.length
      where += ` AND (name ILIKE $${n} OR email ILIKE $${n} OR phone ILIKE $${n})`
    }
    const result = await pool.query(`SELECT * FROM public.companies ${where} ORDER BY created_at DESC`, values)
    return result.rows
  } catch (err: any) {
    if (isMissingRelation(err)) { logDbError('Companies table missing.', err); return [] }
    logDbError('Error fetching companies:', err); return []
  }
}

// ─── createCompany ────────────────────────────────────────────────────────────

export async function createCompany(formData: FormData) {
  const orgId = await getDefaultOrgId()
  if (!orgId) return { error: 'No organization found' }
  const name = String(formData.get('name') || '').trim()
  if (!name) return { error: 'Company name is required' }
  try {
    await pool.query(
      'INSERT INTO public.companies (organization_id, name, website, industry, phone, email, address, notes, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [orgId, name,
        String(formData.get('website') || '').trim() || null,
        String(formData.get('industry') || '').trim() || null,
        String(formData.get('phone') || '').trim() || null,
        String(formData.get('email') || '').trim() || null,
        String(formData.get('address') || '').trim() || null,
        String(formData.get('notes') || '').trim() || null,
        new Date().toISOString()])
    revalidatePath('/companies'); revalidatePath('/'); return { success: true }
  } catch (err: any) { return { error: err.message } }
}

// ─── updateCompany ────────────────────────────────────────────────────────────

export async function updateCompany(companyId: string, updates: Record<string, unknown>) {
  const orgId = await getDefaultOrgId()
  if (!orgId) return { error: 'No organization found' }
  try {
    const payload = { ...updates, updated_at: new Date().toISOString() }
    const keys = Object.keys(payload); const vals = Object.values(payload)
    const sets = keys.map((k, i) => `"${k}" = $${i + 1}`).join(', ')
    await pool.query(
      `UPDATE public.companies SET ${sets} WHERE id = $${keys.length + 1} AND organization_id = $${keys.length + 2}`,
      [...vals, companyId, orgId])
    revalidatePath('/companies'); revalidatePath('/'); return { success: true }
  } catch (err: any) { return { error: err.message } }
}

// ─── deleteCompany ────────────────────────────────────────────────────────────

export async function deleteCompany(companyId: string) {
  const orgId = await getDefaultOrgId()
  if (!orgId) return { error: 'No organization found' }
  try {
    await pool.query('DELETE FROM public.companies WHERE id = $1 AND organization_id = $2', [companyId, orgId])
    revalidatePath('/companies'); revalidatePath('/'); return { success: true }
  } catch (err: any) { return { error: err.message } }
}

// ─── getContacts ──────────────────────────────────────────────────────────────

export async function getContacts(params: SearchParams = {}) {
  const orgId = await getDefaultOrgId()
  if (!orgId) return []
  try {
    const values: any[] = [orgId]
    let where = 'WHERE c.organization_id = $1'
    if (params.q) {
      values.push(`%${params.q}%`); const n = values.length
      where += ` AND (c.name ILIKE $${n} OR c.email ILIKE $${n} OR c.phone ILIKE $${n})`
    }
    const result = await pool.query(`
      SELECT c.*, json_build_object('id', co.id, 'name', co.name) AS companies
      FROM public.contacts c LEFT JOIN public.companies co ON co.id = c.company_id
      ${where} ORDER BY c.created_at DESC
    `, values)
    return result.rows
  } catch (err: any) {
    if (isMissingRelation(err)) { logDbError('Contacts table missing.', err); return [] }
    logDbError('Error fetching contacts:', err); return []
  }
}

// ─── createContact ────────────────────────────────────────────────────────────

export async function createContact(formData: FormData) {
  const orgId = await getDefaultOrgId()
  if (!orgId) return { error: 'No organization found' }
  const name = String(formData.get('name') || '').trim()
  if (!name) return { error: 'Contact name is required' }
  try {
    await pool.query(
      'INSERT INTO public.contacts (organization_id, company_id, name, email, phone, title, notes, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [orgId,
        String(formData.get('company_id') || '').trim() || null,
        name,
        String(formData.get('email') || '').trim() || null,
        String(formData.get('phone') || '').trim() || null,
        String(formData.get('title') || '').trim() || null,
        String(formData.get('notes') || '').trim() || null,
        new Date().toISOString()])
    revalidatePath('/contacts'); revalidatePath('/'); return { success: true }
  } catch (err: any) { return { error: err.message } }
}
// ─── updateContact ────────────────────────────────────────────────────────────

export async function updateContact(contactId: string, updates: Record<string, unknown>) {
  const orgId = await getDefaultOrgId()
  if (!orgId) return { error: 'No organization found' }
  try {
    const payload = { ...updates, updated_at: new Date().toISOString() }
    const keys = Object.keys(payload); const vals = Object.values(payload)
    const sets = keys.map((k, i) => `"${k}" = $${i + 1}`).join(', ')
    await pool.query(
      `UPDATE public.contacts SET ${sets} WHERE id = $${keys.length + 1} AND organization_id = $${keys.length + 2}`,
      [...vals, contactId, orgId])
    revalidatePath('/contacts'); revalidatePath('/'); return { success: true }
  } catch (err: any) { return { error: err.message } }
}

// ─── deleteContact ────────────────────────────────────────────────────────────

export async function deleteContact(contactId: string) {
  const orgId = await getDefaultOrgId()
  if (!orgId) return { error: 'No organization found' }
  try {
    await pool.query('DELETE FROM public.contacts WHERE id = $1 AND organization_id = $2', [contactId, orgId])
    revalidatePath('/contacts'); revalidatePath('/'); return { success: true }
  } catch (err: any) { return { error: err.message } }
}

// ─── getCustomers ─────────────────────────────────────────────────────────────

export async function getCustomers(params: SearchParams = {}) {
  const orgId = await getDefaultOrgId()
  if (!orgId) return []
  try {
    const values: any[] = [orgId]
    let where = 'WHERE cu.organization_id = $1'
    if (params.q) {
      values.push(`%${params.q}%`); const n = values.length
      where += ` AND (cu.status ILIKE $${n} OR cu.notes ILIKE $${n})`
    }
    const result = await pool.query(`
      SELECT cu.*,
        json_build_object('id', co.id, 'name', co.name) AS companies,
        json_build_object('id', c.id, 'name', c.name, 'email', c.email, 'phone', c.phone) AS contacts,
        json_build_object('id', l.id, 'name', l.name) AS leads
      FROM public.customers cu
      LEFT JOIN public.companies co ON co.id = cu.company_id
      LEFT JOIN public.contacts c ON c.id = cu.contact_id
      LEFT JOIN public.leads l ON l.id = cu.source_lead_id
      ${where} ORDER BY cu.created_at DESC
    `, values)
    return result.rows
  } catch (err: any) { console.error('Error fetching customers:', err.message); return [] }
}

// ─── createCustomer ───────────────────────────────────────────────────────────

export async function createCustomer(formData: FormData) {
  const orgId = await getDefaultOrgId()
  if (!orgId) return { error: 'No organization found' }
  const company_id = String(formData.get('company_id') || '').trim() || null
  const contact_id = String(formData.get('contact_id') || '').trim() || null
  if (!company_id && !contact_id) return { error: 'Customer must have a company or contact' }
  try {
    await pool.query(
      'INSERT INTO public.customers (organization_id, company_id, contact_id, source_lead_id, status, notes, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [orgId, company_id, contact_id,
        String(formData.get('source_lead_id') || '').trim() || null,
        String(formData.get('status') || '').trim() || 'active',
        String(formData.get('notes') || '').trim() || null,
        new Date().toISOString()])
    revalidatePath('/customers'); revalidatePath('/'); return { success: true }
  } catch (err: any) { return { error: err.message } }
}

// ─── updateCustomer ───────────────────────────────────────────────────────────

export async function updateCustomer(customerId: string, updates: Record<string, unknown>) {
  const orgId = await getDefaultOrgId()
  if (!orgId) return { error: 'No organization found' }
  try {
    const payload = { ...updates, updated_at: new Date().toISOString() }
    const keys = Object.keys(payload); const vals = Object.values(payload)
    const sets = keys.map((k, i) => `"${k}" = $${i + 1}`).join(', ')
    await pool.query(
      `UPDATE public.customers SET ${sets} WHERE id = $${keys.length + 1} AND organization_id = $${keys.length + 2}`,
      [...vals, customerId, orgId])
    revalidatePath('/customers'); revalidatePath('/'); return { success: true }
  } catch (err: any) { return { error: err.message } }
}

// ─── deleteCustomer ───────────────────────────────────────────────────────────

export async function deleteCustomer(customerId: string) {
  const orgId = await getDefaultOrgId()
  if (!orgId) return { error: 'No organization found' }
  try {
    await pool.query('DELETE FROM public.customers WHERE id = $1 AND organization_id = $2', [customerId, orgId])
    revalidatePath('/customers'); revalidatePath('/'); return { success: true }
  } catch (err: any) { return { error: err.message } }
}

// ─── getLists ─────────────────────────────────────────────────────────────────

export async function getLists() {
  const orgId = await getDefaultOrgId()
  if (!orgId) return []
  try {
    const result = await pool.query(`
      SELECT l.*, COUNT(lm.id) AS list_members_count
      FROM public.lists l
      LEFT JOIN public.list_members lm ON lm.list_id = l.id
      WHERE l.organization_id = $1
      GROUP BY l.id ORDER BY l.created_at DESC
    `, [orgId])
    return result.rows
  } catch (err: any) { console.error('Error fetching lists:', err.message); return [] }
}

// ─── createList ───────────────────────────────────────────────────────────────

export async function createList(formData: FormData) {
  const orgId = await getDefaultOrgId()
  if (!orgId) return { error: 'No organization found' }
  const name = String(formData.get('name') || '').trim()
  if (!name) return { error: 'List name is required' }
  try {
    await pool.query(
      'INSERT INTO public.lists (organization_id, name, description, updated_at) VALUES ($1,$2,$3,$4)',
      [orgId, name, String(formData.get('description') || '').trim() || null, new Date().toISOString()])
    revalidatePath('/lists'); revalidatePath('/'); return { success: true }
  } catch (err: any) { return { error: err.message } }
}

// ─── updateList ───────────────────────────────────────────────────────────────

export async function updateList(listId: string, updates: Record<string, unknown>) {
  const orgId = await getDefaultOrgId()
  if (!orgId) return { error: 'No organization found' }
  try {
    const payload = { ...updates, updated_at: new Date().toISOString() }
    const keys = Object.keys(payload); const vals = Object.values(payload)
    const sets = keys.map((k, i) => `"${k}" = $${i + 1}`).join(', ')
    await pool.query(
      `UPDATE public.lists SET ${sets} WHERE id = $${keys.length + 1} AND organization_id = $${keys.length + 2}`,
      [...vals, listId, orgId])
    revalidatePath('/lists'); revalidatePath('/'); return { success: true }
  } catch (err: any) { return { error: err.message } }
}

// ─── deleteList ───────────────────────────────────────────────────────────────

export async function deleteList(listId: string) {
  const orgId = await getDefaultOrgId()
  if (!orgId) return { error: 'No organization found' }
  try {
    await pool.query('DELETE FROM public.lists WHERE id = $1 AND organization_id = $2', [listId, orgId])
    revalidatePath('/lists'); revalidatePath('/'); return { success: true }
  } catch (err: any) { return { error: err.message } }
}

// ─── getListMembers ───────────────────────────────────────────────────────────

export async function getListMembers(listId: string) {
  const orgId = await getDefaultOrgId()
  if (!orgId) return []
  try {
    const result = await pool.query(
      'SELECT * FROM public.list_members WHERE organization_id = $1 AND list_id = $2 ORDER BY created_at DESC',
      [orgId, listId])
    return result.rows
  } catch (err: any) { console.error('Error fetching list members:', err.message); return [] }
}

// ─── addListMember ────────────────────────────────────────────────────────────

export async function addListMember(formData: FormData) {
  const orgId = await getDefaultOrgId()
  if (!orgId) return { error: 'No organization found' }
  const listId = String(formData.get('list_id') || '').trim()
  const memberType = String(formData.get('member_type') || '').trim()
  const memberId = String(formData.get('member_id') || '').trim()
  if (!listId || !memberType || !memberId) return { error: 'list_id, member_type and member_id are required' }
  try {
    await pool.query(
      'INSERT INTO public.list_members (organization_id, list_id, member_type, member_id) VALUES ($1,$2,$3,$4)',
      [orgId, listId, memberType, memberId])
    revalidatePath('/lists'); revalidatePath('/'); return { success: true }
  } catch (err: any) { return { error: err.message } }
}

// ─── removeListMember ─────────────────────────────────────────────────────────

export async function removeListMember(memberId: string) {
  const orgId = await getDefaultOrgId()
  if (!orgId) return { error: 'No organization found' }
  try {
    await pool.query('DELETE FROM public.list_members WHERE id = $1 AND organization_id = $2', [memberId, orgId])
    revalidatePath('/lists'); revalidatePath('/'); return { success: true }
  } catch (err: any) { return { error: err.message } }
}

// ─── backfillContactsAndCompaniesFromLeads ────────────────────────────────────

export async function backfillContactsAndCompaniesFromLeads() {
  const orgId = await getDefaultOrgId()
  if (!orgId) return { error: 'No organization found' }

  const { isAdmin, error: authError } = await requireAdmin()
  if (!isAdmin) return { error: authError || 'Unauthorized' }

  try {
    const leadsResult = await pool.query(
      `SELECT id, organization_id, name, contact_person, email, phone_number, company_id, contact_id
       FROM public.leads WHERE organization_id = $1 AND (company_id IS NULL OR contact_id IS NULL)
       ORDER BY created_at DESC`, [orgId])
    const leads = leadsResult.rows
    if (leads.length === 0) return { success: true, updatedLeads: 0, createdCompanies: 0, createdContacts: 0 }

    const companyMap = new Map<string, string>()
    const contactMap = new Map<string, string>()
    let createdCompanies = 0, createdContacts = 0, updatedLeads = 0

    for (const lead of leads) {
      let companyId = lead.company_id as string | null
      let contactId = lead.contact_id as string | null
      const companyName = String(lead.name || '').trim()
      const contactName = String(lead.contact_person || lead.name || '').trim()
      const email = String(lead.email || '').trim()
      const phone = String(lead.phone_number || '').trim()

      if (!companyId && companyName) {
        const key = companyName.toLowerCase()
        if (companyMap.has(key)) { companyId = companyMap.get(key) || null }
        else {
          const ex = await pool.query(
            'SELECT id FROM public.companies WHERE organization_id = $1 AND name ILIKE $2 LIMIT 1', [orgId, companyName])
          if (ex.rows[0]?.id) { companyId = ex.rows[0].id; companyMap.set(key, ex.rows[0].id) }
          else {
            const ins = await pool.query(
              'INSERT INTO public.companies (organization_id, name, phone, email, updated_at) VALUES ($1,$2,$3,$4,$5) RETURNING id',
              [orgId, companyName, phone || null, email || null, new Date().toISOString()])
            if (ins.rows[0]?.id) { companyId = ins.rows[0].id; companyMap.set(key, ins.rows[0].id); createdCompanies++ }
          }
        }
      }

      if (!contactId && (contactName || email || phone)) {
        const key = `${contactName.toLowerCase()}|${email.toLowerCase()}|${phone}`
        if (contactMap.has(key)) { contactId = contactMap.get(key) || null }
        else {
          let existingContact: string | null = null
          if (email) { const r = await pool.query('SELECT id FROM public.contacts WHERE organization_id = $1 AND email = $2 LIMIT 1', [orgId, email]); existingContact = r.rows[0]?.id }
          if (!existingContact && phone) { const r = await pool.query('SELECT id FROM public.contacts WHERE organization_id = $1 AND phone = $2 LIMIT 1', [orgId, phone]); existingContact = r.rows[0]?.id }
          if (!existingContact && contactName) { const r = await pool.query('SELECT id FROM public.contacts WHERE organization_id = $1 AND name ILIKE $2 LIMIT 1', [orgId, contactName]); existingContact = r.rows[0]?.id }

          if (existingContact) { contactId = existingContact; contactMap.set(key, existingContact) }
          else {
            const ins = await pool.query(
              'INSERT INTO public.contacts (organization_id, company_id, name, email, phone, updated_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
              [orgId, companyId, contactName || companyName || 'Unknown Contact', email || null, phone || null, new Date().toISOString()])
            if (ins.rows[0]?.id) { contactId = ins.rows[0].id; contactMap.set(key, ins.rows[0].id); createdContacts++ }
          }
        }
      }

      if (companyId || contactId) {
        const updateFields: any = {}
        if (companyId) updateFields.company_id = companyId
        if (contactId) updateFields.contact_id = contactId
        const keys = Object.keys(updateFields); const vals = Object.values(updateFields)
        const sets = keys.map((k, i) => `"${k}" = $${i + 1}`).join(', ')
        await pool.query(
          `UPDATE public.leads SET ${sets} WHERE id = $${keys.length + 1} AND organization_id = $${keys.length + 2}`,
          [...vals, lead.id, orgId])
        updatedLeads++
      }
    }

    revalidatePath('/leads'); revalidatePath('/contacts'); revalidatePath('/companies'); revalidatePath('/')
    return { success: true, updatedLeads, createdCompanies, createdContacts }
  } catch (err: any) { return { error: err.message } }
}

// ─── addTask ──────────────────────────────────────────────────────────────────

export async function addTask(formData: FormData) {
  const orgId = await getDefaultOrgId()
  if (!orgId) return { error: 'No organization found' }

  const leadId = formData.get('lead_id') as string
  const dealId = formData.get('deal_id') as string
  const assigned_to = (formData.get('assigned_to') as string) || null
  const title = formData.get('title') as string

  try {
    await pool.query(
      'INSERT INTO public.tasks (organization_id, title, description, status, priority, due_date, lead_id, deal_id, assigned_to) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [orgId, title, (formData.get('description') as string) || '', 'pending',
        (formData.get('priority') as string) || 'normal',
        formData.get('due_date') ? new Date(formData.get('due_date') as string).toISOString() : null,
        leadId && leadId !== 'none' ? leadId : null,
        dealId && dealId !== 'none' ? dealId : null,
        assigned_to])

    if (assigned_to) {
      const actor = await getMockableUser()
      if (actor?.id !== assigned_to) {
        await createNotification({
          user_id: assigned_to, actor_id: actor?.id, type: 'task_reminder',
          title: 'New Task Assigned', content: `You were assigned a task: ${title}`,
          link_url: '/tasks'
        })
      }
    }

    revalidatePath('/tasks'); revalidatePath('/'); return { success: true }
  } catch (err: any) { return { error: err.message } }
}

// ─── toggleTaskCompletion ─────────────────────────────────────────────────────

export async function toggleTaskCompletion(taskId: string, isCompleted: boolean) {
  const orgId = await getDefaultOrgId()
  if (!orgId) return { error: 'No organization found' }
  try {
    await pool.query(
      'UPDATE public.tasks SET status = $1 WHERE id = $2 AND organization_id = $3',
      [isCompleted ? 'completed' : 'pending', taskId, orgId])
    revalidatePath('/tasks'); revalidatePath('/'); return { success: true }
  } catch (err: any) { return { error: err.message } }
}

// ─── updateTask ───────────────────────────────────────────────────────────────

export async function updateTask(taskId: string, updates: Record<string, unknown>) {
  const orgId = await getDefaultOrgId()
  if (!orgId) return { error: 'No organization found' }
  try {
    const keys = Object.keys(updates); const vals = Object.values(updates)
    const sets = keys.map((k, i) => `"${k}" = $${i + 1}`).join(', ')
    await pool.query(
      `UPDATE public.tasks SET ${sets} WHERE id = $${keys.length + 1} AND organization_id = $${keys.length + 2}`,
      [...vals, taskId, orgId])
    revalidatePath('/tasks'); revalidatePath('/follow-ups'); revalidatePath('/'); return { success: true }
  } catch (err: any) { return { error: err.message } }
}

// ─── deleteTask ───────────────────────────────────────────────────────────────

export async function deleteTask(taskId: string) {
  const orgId = await getDefaultOrgId()
  if (!orgId) return { error: 'No organization found' }
  try {
    await pool.query('DELETE FROM public.tasks WHERE id = $1 AND organization_id = $2', [taskId, orgId])
    revalidatePath('/tasks'); revalidatePath('/follow-ups'); revalidatePath('/'); return { success: true }
  } catch (err: any) { return { error: err.message } }
}
// ─── logActivity ──────────────────────────────────────────────────────────────
// NOTE: signature changed — removed supabase param. Update any callers.

export async function logActivity(orgId: string, action: string, details: string, leadId?: string, dealId?: string) {
  try {
    await pool.query(
      'INSERT INTO public.activity_logs (organization_id, action, details, lead_id, deal_id) VALUES ($1,$2,$3,$4,$5)',
      [orgId, action, `A team member ${details}`, leadId || null, dealId || null])
  } catch (err: any) { console.error('Failed to log activity:', err.message) }
}

// ─── getActivities ────────────────────────────────────────────────────────────

export async function getActivities(limit = 10, leadId?: string) {
  const orgId = await getDefaultOrgId()
  if (!orgId) return []
  try {
    const values: any[] = [orgId, limit]
    let where = 'WHERE al.organization_id = $1'
    if (leadId) { values.push(leadId); where += ` AND al.lead_id = $${values.length}` }
    const result = await pool.query(`
      SELECT al.id, al.action, al.details, al.created_at,
        json_build_object('name', l.name) AS leads,
        json_build_object('title', d.title) AS deals
      FROM public.activity_logs al
      LEFT JOIN public.leads l ON l.id = al.lead_id
      LEFT JOIN public.deals d ON d.id = al.deal_id
      ${where} ORDER BY al.created_at DESC LIMIT $2
    `, values)
    return result.rows
  } catch (err: any) { console.error('Error fetching activities:', err.message); return [] }
}

// ─── getGlobalActivities ──────────────────────────────────────────────────────

export async function getGlobalActivities(params: {
  limit?: number; offset?: number; type?: string; userId?: string
  search?: string; dateFrom?: string; dateTo?: string; leadId?: string; dealId?: string
} = {}) {
  const orgId = await getDefaultOrgId()
  if (!orgId) return { data: [], total: 0 }

  try {
    const values: any[] = [orgId]
    const conditions: string[] = ['al.organization_id = $1']

    if (params.type && params.type !== 'all') { values.push(params.type); conditions.push(`al.action = $${values.length}`) }
    if (params.userId && params.userId !== 'all') { values.push(params.userId); conditions.push(`al.user_id = $${values.length}`) }
    if (params.search) { values.push(`%${params.search}%`); conditions.push(`al.details::text ILIKE $${values.length}`) }
    if (params.leadId && params.leadId !== 'all') { values.push(params.leadId); conditions.push(`al.lead_id = $${values.length}`) }
    if (params.dealId && params.dealId !== 'all') { values.push(params.dealId); conditions.push(`al.deal_id = $${values.length}`) }
    if (params.dateFrom) { values.push(params.dateFrom); conditions.push(`al.created_at >= $${values.length}`) }
    if (params.dateTo) { values.push(params.dateTo); conditions.push(`al.created_at <= $${values.length}`) }

    const where = `WHERE ${conditions.join(' AND ')}`
    const countResult = await pool.query(`SELECT COUNT(*) FROM public.activity_logs al ${where}`, values)
    const total = parseInt(countResult.rows[0].count, 10)

    const limitVal = params.limit || 50; const offsetVal = params.offset || 0
    values.push(limitVal, offsetVal)

    const result = await pool.query(`
      SELECT al.*,
        json_build_object('name', l.name) AS leads,
        json_build_object('title', d.title) AS deals,
        json_build_object('full_name', u.full_name, 'role', u.role) AS users
      FROM public.activity_logs al
      LEFT JOIN public.leads l ON l.id = al.lead_id
      LEFT JOIN public.deals d ON d.id = al.deal_id
      LEFT JOIN public.users u ON u.id = al.user_id
      ${where} ORDER BY al.created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}
    `, values)

    const normalizedData = result.rows.map(activity => {
      let details = activity.details
      if (details && typeof details === 'object') {
        if (activity.action === 'lead_forwarded') {
          const { lead_name, forwarded_to, note } = details as any
          details = `Forwarded "${lead_name || 'Lead'}" to ${forwarded_to || 'Unknown'}${note ? ` (Note: ${note})` : ''}`
        } else { details = JSON.stringify(details) }
      }
      details = details || ''
      return { ...activity, details }
    })

    return { data: normalizedData, total }
  } catch (err: any) { console.error('Error fetching global activities:', err.message); return { data: [], total: 0 } }
}

// ─── logLeadInteraction ───────────────────────────────────────────────────────

export async function logLeadInteraction(leadId: string, type: string, content: string) {
  const orgId = await getDefaultOrgId()
  if (!orgId) return { error: 'No organization found' }

  await logActivity(orgId, type, content, leadId)

  const user = await getMockableUser()
  const shim = createDbShim()
  await logLeadEvent(shim, orgId, {
    lead_id: leadId, event_type: 'interaction_logged',
    description: `Interaction logged: ${type.replace('_', ' ')}`,
    metadata: { type, content }, performed_by: user?.id
  })

  revalidatePath(`/leads/${leadId}`)
  return { success: true }
}

// ─── getAnalytics ─────────────────────────────────────────────────────────────

export async function getAnalytics(days: number = 30) {
  const orgId = await getDefaultOrgId()
  if (!orgId) return null

  const session = await getSessionUser()
  if (!session) return null

  const userId: string | null = session.userId
  const isAdmin = session.role === 'admin' || session.role === 'super_admin'

  const startDate = new Date(); startDate.setDate(startDate.getDate() - days)

  try {
    const leadsValues: any[] = [orgId]; let leadsWhere = 'WHERE organization_id = $1'
    const dealsValues: any[] = [orgId]; let dealsWhere = 'WHERE organization_id = $1'
    const tasksValues: any[] = [orgId]; let tasksWhere = 'WHERE organization_id = $1'

    if (!isAdmin && userId) {
      leadsValues.push(userId); leadsWhere += ` AND (owner_id = $${leadsValues.length} OR owner_id IS NULL)`
      dealsValues.push(userId); dealsWhere += ` AND (assigned_to = $${dealsValues.length} OR assigned_to IS NULL)`
      tasksValues.push(userId); tasksWhere += ` AND (assigned_to = $${tasksValues.length} OR assigned_to IS NULL)`
    }

    const [leadsRes, dealsRes, tasksRes] = await Promise.all([
      pool.query(`SELECT * FROM public.leads ${leadsWhere}`, leadsValues),
      pool.query(`SELECT * FROM public.deals ${dealsWhere}`, dealsValues),
      pool.query(`SELECT * FROM public.tasks ${tasksWhere}`, tasksValues)
    ])

    const leads = leadsRes.rows; const deals = dealsRes.rows; const tasks = tasksRes.rows
    const wonDeals = deals.filter(d => d.status?.toLowerCase() === 'won')
    const totalRevenue = wonDeals.reduce((sum, d) => sum + Number(d.value || 0), 0)
    const winRate = deals.length > 0 ? (wonDeals.length / deals.length) * 100 : 0
    const avgDealSize = wonDeals.length > 0 ? totalRevenue / wonDeals.length : 0

    const pipelineStates = ['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost']
    const pipelineData = pipelineStates.map(state => ({
      name: state.charAt(0).toUpperCase() + state.slice(1),
      value: deals.filter(d => d.status?.toLowerCase() === state).length
    }))

    const sourceGroups = leads.reduce((acc: any, lead) => {
      const src = lead.source || 'Website'; acc[src] = (acc[src] || 0) + 1; return acc
    }, {})
    const leadsBySource = Object.entries(sourceGroups).map(([name, value]) => ({ name, value }))

    const now = new Date()
    const operationalPulse = {
      completed: tasks.filter(t => t.status === 'completed').length,
      overdue: tasks.filter(t => t.status !== 'completed' && t.due_date && new Date(t.due_date) < now).length,
      pending: tasks.filter(t => t.status !== 'completed').length,
      followups: tasks.filter(t => t.lead_id).length
    }

    return {
      financials: { totalRevenue, winRate: Math.round(winRate), avgDealSize: Math.round(avgDealSize), newLeadsCount: leads.filter(l => new Date(l.created_at) >= startDate).length },
      pipelineData, leadsBySource, operationalPulse,
      summary: { isStrong: winRate > 20, leadIncrease: 15, bottlenecks: deals.filter(d => d.status?.toLowerCase() === 'proposal').length }
    }
  } catch (err: any) { console.error('Error fetching analytics:', err.message); return null }
}

// ─── getNotifications ─────────────────────────────────────────────────────────

export async function getNotifications(limit = 10) {
  const orgId = await getDefaultOrgId()
  if (!orgId) return []
  try {
    const result = await pool.query(
      'SELECT * FROM public.notifications WHERE organization_id = $1 ORDER BY created_at DESC LIMIT $2', [orgId, limit])
    return result.rows
  } catch (err: any) { console.error('Error fetching notifications:', err.message); return [] }
}

// ─── markNotificationRead ─────────────────────────────────────────────────────

export async function markNotificationRead(id: string) {
  const orgId = await getDefaultOrgId()
  if (!orgId) return { error: 'No org found' }
  try {
    await pool.query('UPDATE public.notifications SET is_read = true WHERE id = $1 AND organization_id = $2', [id, orgId])
    revalidatePath('/notifications'); return { success: true }
  } catch (err: any) { return { error: err.message } }
}

// ─── getAttendance ────────────────────────────────────────────────────────────

export async function getAttendance() {
  const orgId = await getDefaultOrgId()
  if (!orgId) return []
  try {
    const result = await pool.query(
      'SELECT * FROM public.attendance WHERE organization_id = $1 ORDER BY check_in_time DESC LIMIT 10', [orgId])
    return result.rows
  } catch (err: any) { console.error('Error fetching attendance:', err.message); return [] }
}

// ─── clockIn ──────────────────────────────────────────────────────────────────

export async function clockIn() {
  const orgId = await getDefaultOrgId()
  if (!orgId) return { error: 'No org' }
  try {
    await pool.query('INSERT INTO public.attendance (organization_id, status) VALUES ($1,$2)', [orgId, 'present'])
    revalidatePath('/attendance'); return { success: true }
  } catch (err: any) { return { error: err.message } }
}

// ─── forwardLead ──────────────────────────────────────────────────────────────

export async function forwardLead(leadId: string, toUserId: string, note?: string) {
  const orgId = await getDefaultOrgId()
  if (!orgId) return { error: 'No organization found' }
  try {
    const fromUserResult = await pool.query('SELECT id, full_name FROM public.users WHERE organization_id = $1 LIMIT 1', [orgId])
    const fromUser = fromUserResult.rows[0]
    const toUserResult = await pool.query('SELECT full_name FROM public.users WHERE id = $1', [toUserId])
    const toUser = toUserResult.rows[0]
    const leadResult = await pool.query('SELECT name FROM public.leads WHERE id = $1', [leadId])
    const lead = leadResult.rows[0]

    await pool.query(
      'INSERT INTO public.forwarded_leads (organization_id, lead_id, from_user_id, to_user_id, status, note) VALUES ($1,$2,$3,$4,$5,$6)',
      [orgId, leadId, fromUser?.id || null, toUserId, 'sent', note || null])

    await pool.query(
      'INSERT INTO public.activity_logs (organization_id, user_id, lead_id, action, details) VALUES ($1,$2,$3,$4,$5)',
      [orgId, fromUser?.id || null, leadId, 'lead_forwarded',
        JSON.stringify({
          lead_name: lead?.name || 'Lead',
          forwarded_to: toUser?.full_name || toUserId,
          note: note || null
        })])

    const shim = createDbShim()
    await logLeadEvent(shim, orgId, {
      lead_id: leadId, event_type: 'lead_forwarded',
      description: `Forwarded lead to ${toUser?.full_name || toUserId}.`,
      metadata: { to_user_id: toUserId, note }, performed_by: fromUser?.id
    })

    await createNotification({
      user_id: toUserId, actor_id: fromUser?.id, type: 'mentions', title: 'New Lead Forwarded',
      content: `${fromUser?.full_name || 'A team member'} forwarded "${lead?.name}" to you.${note ? ` Note: ${note}` : ''}`,
      link_url: '/forwarded'
    })

    revalidatePath('/forwarded'); revalidatePath('/leads'); revalidatePath('/activity-log'); revalidatePath('/notifications')
    return { success: true }
  } catch (err: any) { return { error: err.message } }
}

// ─── getForwardedLeads ────────────────────────────────────────────────────────

export async function getForwardedLeads() {
  const orgId = await getDefaultOrgId()
  if (!orgId) return { received: [], sent: [] }
  try {
    const currentUserResult = await pool.query('SELECT id, full_name, role FROM public.users WHERE organization_id = $1 LIMIT 1', [orgId])
    const currentUser = currentUserResult.rows[0]
    if (!currentUser) return { received: [], sent: [] }

    const [receivedResult, sentResult] = await Promise.all([
      pool.query(`
        SELECT fl.*,
          json_build_object('id', l.id, 'name', l.name, 'phone_number', l.phone_number, 'status', l.status, 'temperature', l.temperature, 'location', l.location, 'contact_person', l.contact_person) AS leads,
          json_build_object('id', u.id, 'full_name', u.full_name, 'role', u.role) AS from_user
        FROM public.forwarded_leads fl
        LEFT JOIN public.leads l ON l.id = fl.lead_id
        LEFT JOIN public.users u ON u.id = fl.from_user_id
        WHERE fl.organization_id = $1 AND fl.to_user_id = $2 ORDER BY fl.created_at DESC
      `, [orgId, currentUser.id]),
      pool.query(`
        SELECT fl.*,
          json_build_object('id', l.id, 'name', l.name, 'phone_number', l.phone_number, 'status', l.status, 'temperature', l.temperature, 'location', l.location, 'contact_person', l.contact_person) AS leads,
          json_build_object('id', u.id, 'full_name', u.full_name, 'role', u.role) AS to_user
        FROM public.forwarded_leads fl
        LEFT JOIN public.leads l ON l.id = fl.lead_id
        LEFT JOIN public.users u ON u.id = fl.to_user_id
        WHERE fl.organization_id = $1 AND fl.from_user_id = $2 ORDER BY fl.created_at DESC
      `, [orgId, currentUser.id])
    ])

    return { received: receivedResult.rows, sent: sentResult.rows, currentUserId: currentUser.id }
  } catch (err: any) { console.error('Error fetching forwarded leads:', err.message); return { received: [], sent: [] } }
}

// ─── updateForwardedLeadStatus ────────────────────────────────────────────────

export async function updateForwardedLeadStatus(forwardId: string, status: 'accepted' | 'rejected') {
  const orgId = await getDefaultOrgId()
  if (!orgId) return { error: 'No org' }
  try {
    await pool.query('UPDATE public.forwarded_leads SET status = $1 WHERE id = $2 AND organization_id = $3', [status, forwardId, orgId])
    revalidatePath('/forwarded'); return { success: true }
  } catch (err: any) { return { error: err.message } }
}

// ─── checkIn ──────────────────────────────────────────────────────────────────

export async function checkIn(location?: { lat: number; lng: number; address?: string }) {
  const orgId = await getDefaultOrgId()
  if (!orgId) return { error: 'No org' }
  const user = await getMockableUser()
  if (!user) return { error: 'No user' }
  try {
    await pool.query(
      'INSERT INTO public.attendance (organization_id, user_id, check_in_time, status, location) VALUES ($1,$2,$3,$4,$5)',
      [orgId, user.id, new Date().toISOString(), 'present', location ? JSON.stringify(location) : null])
    revalidatePath('/attendance'); return { success: true }
  } catch (err: any) { return { error: err.message } }
}

// ─── checkOut ─────────────────────────────────────────────────────────────────

export async function checkOut() {
  const orgId = await getDefaultOrgId()
  if (!orgId) return { error: 'No org' }
  const user = await getMockableUser()
  if (!user) return { error: 'No user' }
  const today = new Date(); today.setHours(0, 0, 0, 0)
  try {
    await pool.query(
      `UPDATE public.attendance SET check_out_time = $1 WHERE user_id = $2 AND organization_id = $3 AND check_out_time IS NULL AND check_in_time >= $4`,
      [new Date().toISOString(), user.id, orgId, today.toISOString()])
    revalidatePath('/attendance'); return { success: true }
  } catch (err: any) { return { error: err.message } }
}

// ─── getAttendanceStatus ──────────────────────────────────────────────────────

export async function getAttendanceStatus() {
  const orgId = await getDefaultOrgId()
  if (!orgId) return null
  const user = await getMockableUser()
  if (!user) return null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  try {
    const attResult = await pool.query(
      'SELECT * FROM public.attendance WHERE user_id = $1 AND organization_id = $2 AND check_in_time >= $3 ORDER BY created_at DESC LIMIT 1',
      [user.id, orgId, today.toISOString()])
    const historyResult = await pool.query(
      'SELECT * FROM public.attendance WHERE user_id = $1 AND organization_id = $2 ORDER BY created_at DESC LIMIT 10', [user.id, orgId])
    return { current: attResult.rows[0] || null, user: { id: user.id, full_name: user.full_name, role: user.role }, history: historyResult.rows }
  } catch (err: any) { console.error('Error fetching attendance status:', err.message); return null }
}

// ─── getTeamPerformance ───────────────────────────────────────────────────────

export async function getTeamPerformance() {
  const orgId = await getDefaultOrgId()
  if (!orgId) return null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  try {
    const [usersRes, attendanceRes, leadsRes, dealsRes, tasksRes] = await Promise.all([
      pool.query('SELECT * FROM public.users WHERE organization_id = $1 AND is_active = true', [orgId]),
      pool.query('SELECT a.*, u.full_name FROM public.attendance a LEFT JOIN public.users u ON u.id = a.user_id WHERE a.organization_id = $1 AND a.check_in_time >= $2', [orgId, today.toISOString()]),
      pool.query('SELECT * FROM public.leads WHERE organization_id = $1 AND created_at >= $2', [orgId, today.toISOString()]),
      pool.query('SELECT * FROM public.deals WHERE organization_id = $1', [orgId]),
      pool.query("SELECT * FROM public.tasks WHERE organization_id = $1 AND status = 'completed'", [orgId])
    ])
    return usersRes.rows.map(user => {
      const userAtt = attendanceRes.rows.find(a => a.user_id === user.id)
      return {
        id: user.id, name: user.full_name, role: user.role,
        status: userAtt ? (userAtt.check_out_time ? 'Checked Out' : 'Online') : 'Offline',
        checkIn: userAtt?.check_in_time, checkOut: userAtt?.check_out_time,
        KPIs: {
          leads: leadsRes.rows.filter(l => l.owner_id === user.id).length,
          deals: dealsRes.rows.filter(d => d.status === 'won').length,
          tasks: tasksRes.rows.filter(t => t.assigned_to === user.id).length
        }
      }
    })
  } catch (err: any) { console.error('Error fetching team performance:', err.message); return null }
}

// ─── getFullAttendanceLogs ────────────────────────────────────────────────────

export async function getFullAttendanceLogs() {
  const orgId = await getDefaultOrgId()
  if (!orgId) return []
  try {
    const result = await pool.query(`
      SELECT a.*, json_build_object('full_name', u.full_name, 'role', u.role) AS users
      FROM public.attendance a LEFT JOIN public.users u ON u.id = a.user_id
      WHERE a.organization_id = $1 ORDER BY a.check_in_time DESC LIMIT 100
    `, [orgId])
    return result.rows
  } catch (err: any) { console.error('Error fetching full logs:', err.message); return [] }
}

// ─── getHistoricalAttendance ──────────────────────────────────────────────────

export async function getHistoricalAttendance(filter: 'weekly' | 'monthly' | 'yearly' | 'all' = 'all', userId?: string) {
  const orgId = await getDefaultOrgId()
  if (!orgId) return []
  try {
    const values: any[] = [orgId]
    const conditions: string[] = ['a.organization_id = $1']
    if (userId && userId !== 'all') { values.push(userId); conditions.push(`a.user_id = $${values.length}`) }
    const now = new Date()
    if (filter === 'weekly') { values.push(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()); conditions.push(`a.check_in_time >= $${values.length}`) }
    else if (filter === 'monthly') { values.push(new Date(now.getFullYear(), now.getMonth() - 1, now.getDate()).toISOString()); conditions.push(`a.check_in_time >= $${values.length}`) }
    else if (filter === 'yearly') { values.push(new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()).toISOString()); conditions.push(`a.check_in_time >= $${values.length}`) }

    const result = await pool.query(`
      SELECT a.*, json_build_object('full_name', u.full_name, 'role', u.role) AS users
      FROM public.attendance a LEFT JOIN public.users u ON u.id = a.user_id
      WHERE ${conditions.join(' AND ')} ORDER BY a.check_in_time DESC
    `, values)
    return result.rows
  } catch (err: any) { console.error('Error fetching historical logs:', err.message); return [] }
}

// ─── getRepPerformanceData ────────────────────────────────────────────────────

export async function getRepPerformanceData() {
  const session = await getSessionUser()
  if (!session?.orgId) return []
  const orgId = session.orgId
  console.log('[RepMonitor] session:', JSON.stringify(session))
  console.log('[RepMonitor] orgId:', orgId)
  const monthYear = new Date().toISOString().substring(0, 7)
  try {
    const [membersRes, leadsRes, dealsRes, tasksRes, targetsRes] = await Promise.all([
      pool.query('SELECT id, full_name, role FROM public.users WHERE organization_id = $1 AND is_active = true', [orgId]),
      pool.query('SELECT id, owner_id, status, created_at FROM public.leads WHERE organization_id = $1', [orgId]),
      pool.query('SELECT id, assigned_to, status, value FROM public.deals WHERE organization_id = $1', [orgId]),
      pool.query('SELECT id, assigned_to, status, due_date FROM public.tasks WHERE organization_id = $1', [orgId]),
      pool.query('SELECT * FROM public.user_targets WHERE organization_id = $1 AND month_year = $2', [orgId, monthYear])
    ])
    console.log('[RepMonitor] members count:', membersRes.rows.length)

    const now = new Date(); const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000)

    return membersRes.rows.map(user => {
      const userLeads = leadsRes.rows.filter(l => l.owner_id === user.id)
      const userDeals = dealsRes.rows.filter(d => d.assigned_to === user.id)
      const userTasks = tasksRes.rows.filter(t => t.assigned_to === user.id)
      const userTarget = targetsRes.rows.find(t => t.user_id === user.id)
      const revenueWon = userDeals.filter(d => d.status === 'won').reduce((sum, d) => sum + (Number(d.value) || 0), 0)
      const tasksCompleted = userTasks.filter(t => t.status === 'completed').length
      const tasksTotal = userTasks.length
      const overdueTasks = userTasks.filter(t => t.status === 'pending' && t.due_date && new Date(t.due_date) < now).length
      const staleLeads = userLeads.filter(l => l.status !== 'converted' && new Date(l.created_at) < threeDaysAgo).length

      return {
        id: user.id, name: user.full_name, role: user.role,
        leads: { total: userLeads.length, new: userLeads.filter(l => new Date(l.created_at) > new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)).length },
        workload: { activeDeals: userDeals.filter(d => d.status === 'open' || d.status === 'negotiation').length, pendingTasks: userTasks.filter(t => t.status === 'pending').length },
        performance: {
          revenue: revenueWon,
          conversionRate: userLeads.length > 0 ? (userDeals.filter(d => d.status === 'won').length / userLeads.length) * 100 : 0,
          taskCompletionRate: tasksTotal > 0 ? (tasksCompleted / tasksTotal) * 100 : 0
        },
        targets: { revenue: userTarget?.revenue_target || 0, leads: userTarget?.leads_target || 0, tasks: userTarget?.tasks_target || 0 },
        barriers: { overdueTasks, staleLeads, count: overdueTasks + staleLeads }
      }
    })
  } catch (err: any) { console.error('Error fetching rep data:', err.message); return [] }
}

// ─── setUserTarget ────────────────────────────────────────────────────────────

export async function setUserTarget(userId: string, targets: { revenue: number; leads: number; tasks: number }) {
  const orgId = await getDefaultOrgId()
  if (!orgId) throw new Error('No organization found')
  const { isAdmin, error: authError } = await requireAdmin()
  if (!isAdmin) throw new Error(authError || 'Unauthorized')
  const monthYear = new Date().toISOString().substring(0, 7)
  try {
    await pool.query(
      `INSERT INTO public.user_targets (organization_id, user_id, month_year, revenue_target, leads_target, tasks_target)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (user_id, month_year) DO UPDATE SET
         revenue_target = EXCLUDED.revenue_target, leads_target = EXCLUDED.leads_target, tasks_target = EXCLUDED.tasks_target`,
      [orgId, userId, monthYear, targets.revenue, targets.leads, targets.tasks])
    return true
  } catch (err: any) { throw new Error(err.message) }
}

// ─── getOrganizationDetails ───────────────────────────────────────────────────

export async function getOrganizationDetails() {
  const orgId = await getDefaultOrgId()
  if (!orgId) return null
  try {
    const result = await pool.query('SELECT * FROM public.organizations WHERE id = $1', [orgId])
    return result.rows[0] || null
  } catch (err: any) { console.error('Error fetching org details:', err.message); return null }
}

// ─── updateOrganization ───────────────────────────────────────────────────────

export async function updateOrganization(data: { name?: string; logo_url?: string; timezone?: string; currency?: string; branding?: any }) {
  const orgId = await getDefaultOrgId()
  if (!orgId) throw new Error('No organization found')
  const { isAdmin, error: authError } = await requireAdmin()
  if (!isAdmin) throw new Error(authError || 'Unauthorized')
  try {
    const keys = Object.keys(data); const vals = Object.values(data)
    const sets = keys.map((k, i) => `"${k}" = $${i + 1}`).join(', ')
    await pool.query(`UPDATE public.organizations SET ${sets} WHERE id = $${keys.length + 1}`, [...vals, orgId])
    revalidatePath('/', 'layout'); return true
  } catch (err: any) { throw new Error(err.message) }
}

// ─── manageTeamMember ─────────────────────────────────────────────────────────

export async function manageTeamMember(userId: string, data: { role?: string; active?: boolean }) {
  const orgId = await getDefaultOrgId()
  if (!orgId) throw new Error('No organization found')
  const { isAdmin, error: authError } = await requireAdmin()
  if (!isAdmin) throw new Error(authError || 'Unauthorized')
  try {
    const keys = Object.keys(data); const vals = Object.values(data)
    const sets = keys.map((k, i) => `"${k}" = $${i + 1}`).join(', ')
    await pool.query(`UPDATE public.users SET ${sets} WHERE id = $${keys.length + 1} AND organization_id = $${keys.length + 2}`, [...vals, userId, orgId])
    return true
  } catch (err: any) { throw new Error(err.message) }
}

// ─── getIntegrations ──────────────────────────────────────────────────────────

export async function getIntegrations() {
  const orgId = await getDefaultOrgId()
  if (!orgId) return []
  try {
    const result = await pool.query('SELECT * FROM public.integrations WHERE organization_id = $1', [orgId])
    return result.rows
  } catch (err: any) { console.error('Error fetching integrations:', err.message); return [] }
}

// ─── saveIntegration ──────────────────────────────────────────────────────────

export async function saveIntegration(provider: string, config: any, isActive: boolean = true) {
  const orgId = await getDefaultOrgId()
  if (!orgId) throw new Error('No organization found')
  const { isAdmin, error: authError } = await requireAdmin()
  if (!isAdmin) throw new Error(authError || 'Unauthorized')
  try {
    await pool.query(
      `INSERT INTO public.integrations (organization_id, provider, config, is_active, updated_at) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (organization_id, provider) DO UPDATE SET config = EXCLUDED.config, is_active = EXCLUDED.is_active, updated_at = EXCLUDED.updated_at`,
      [orgId, provider, JSON.stringify(config), isActive, new Date().toISOString()])
    return true
  } catch (err: any) { throw new Error(err.message) }
}

// ─── getCurrentUser ───────────────────────────────────────────────────────────

export async function getCurrentUser() {
  try {
    const session = await getSessionUser()
    if (!session) return null

    const r = await pool.query('SELECT * FROM public.users WHERE id = $1 LIMIT 1', [session.userId])
    const user = r.rows[0]
    if (!user || !user.is_active) return null

    const roleData = await pool.query('SELECT permissions FROM public.organization_roles WHERE organization_id = $1 AND name = $2 LIMIT 1', [user.organization_id, user.role])
    return { ...user, permissions: roleData.rows[0]?.permissions || null }
  } catch (err: any) { console.error('Error getting current user:', err.message); return null }
}

// ─── updateUserProfile ────────────────────────────────────────────────────────

export async function updateUserProfile(data: {
  full_name?: string; avatar_url?: string; password?: string; email?: string
}) {
  const session = await getSessionUser()
  if (!session) throw new Error('No user found')
  const profileUpdate: Record<string, any> = {}
  if (data.full_name !== undefined) profileUpdate.full_name = data.full_name
  if (data.avatar_url !== undefined) profileUpdate.avatar_url = data.avatar_url
  if (data.email !== undefined) profileUpdate.email = data.email
  if (data.password !== undefined) {
    profileUpdate.password_hash = await bcrypt.hash(data.password, 10)
  }

  try {
    const keys = Object.keys(profileUpdate); const vals = Object.values(profileUpdate)
    if (keys.length === 0) return true
    const sets = keys.map((k, i) => `"${k}" = $${i + 1}`).join(', ')
    await pool.query(`UPDATE public.users SET ${sets} WHERE id = $${keys.length + 1}`, [...vals, session.userId])
    return true
  } catch (err: any) { throw new Error(err.message) }
}

// ─── updateNotificationSettings ───────────────────────────────────────────────

export async function updateNotificationSettings(prefs: any) {
  const session = await getSessionUser()
  if (!session) throw new Error('No user found')
  try {
    await pool.query('UPDATE public.users SET notification_preferences = $1 WHERE id = $2', [JSON.stringify(prefs), session.userId])
    revalidatePath('/settings'); revalidatePath('/'); return true
  } catch (err: any) { throw new Error(err.message) }
}

// ─── updateAppearanceSettings ─────────────────────────────────────────────────

export async function updateAppearanceSettings(settings: any) {
  const session = await getSessionUser()
  if (!session) return false
  try {
    await pool.query('UPDATE public.users SET appearance_settings = $1 WHERE id = $2', [JSON.stringify(settings), session.userId])
    return true
  } catch (err: any) { console.error('[updateAppearanceSettings] failed:', err.message); return false }
}

// ─── getUsersHubData ──────────────────────────────────────────────────────────

export async function getUsersHubData() {
  const orgId = await getDefaultOrgId()
  if (!orgId) return { users: [], invites: [] }
  try {
    const [usersResult, roleDefsResult, leadsResult, dealsResult, invitesResult] = await Promise.all([
      pool.query('SELECT id, full_name, role, is_active, created_at, avatar_url FROM public.users WHERE organization_id = $1 AND is_active = true ORDER BY full_name', [orgId]),
      pool.query('SELECT name FROM public.organization_roles WHERE organization_id = $1', [orgId]),
      pool.query('SELECT owner_id FROM public.leads WHERE organization_id = $1', [orgId]),
      pool.query('SELECT assigned_to FROM public.deals WHERE organization_id = $1', [orgId]),
      pool.query("SELECT * FROM public.organization_invites WHERE organization_id = $1 AND status = 'pending' ORDER BY created_at DESC", [orgId])
    ])

    const normalizeRole = (value: string | null) => (value || '').toLowerCase().replace(/\s+/g, '_')
    const usersWithWorkload = usersResult.rows.map(u => {
      const activeLeads = leadsResult.rows.filter(l => l.owner_id === u.id).length
      const activeDeals = dealsResult.rows.filter(d => d.assigned_to === u.id).length
      const matchingRole = roleDefsResult.rows.find(r => normalizeRole(r.name) === normalizeRole(u.role))
      return { ...u, workload: activeLeads + activeDeals, role_display: matchingRole?.name || u.role }
    })

    return { users: usersWithWorkload, invites: invitesResult.rows }
  } catch (err: any) { console.error('Error fetching users hub data:', err.message); return { users: [], invites: [] } }
}

// ─── inviteUser / createInvite ─────────────────────────────────────────────────

const INVITE_BASE_URL = 'https://magnivo-ai.vercel.app'

export async function inviteUser(formData: FormData) {
  const email = (formData.get('email') as string || '').trim().toLowerCase()
  const rawRole = (formData.get('role') as string || '').trim()
  const role = rawRole === 'admin' || rawRole === 'Admin' ? 'admin' :
               rawRole === 'super_admin' ? 'super_admin' :
               rawRole  // keep custom role names as-is
  const orgId = await getDefaultOrgId()
  if (!orgId) return { error: 'No organization found' }
  if (!email) return { error: 'Email is required' }
  const { isAdmin, user, error: authError } = await requireAdmin()
  if (!isAdmin) return { error: authError || 'Only admins can invite users' }

  try {
    const existingMember = await pool.query(
      'SELECT id FROM public.users WHERE organization_id = $1 AND email = $2 LIMIT 1',
      [orgId, email]
    )
    if (existingMember.rows[0]) return { error: 'This person is already a member of your organization' }

    const limitResult = await pool.query(
      `SELECT
         COALESCE(cs.user_limit, p.max_users) AS effective_limit,
         (SELECT COUNT(*) FROM public.users WHERE organization_id = $1 AND is_active = true)
         + (SELECT COUNT(*) FROM public.organization_invites
              WHERE organization_id = $1 AND status = 'pending' AND expires_at > now()) AS current_count
       FROM public.client_subscriptions cs
       LEFT JOIN public.plans p ON lower(p.name) = lower(cs.plan_name)
       WHERE cs.organization_id = $1`,
      [orgId]
    )
    const limitRow = limitResult.rows[0]
    if (!limitRow) return { error: 'Unable to verify this organization\'s subscription. Contact your account manager before inviting more users.' }
    const { effective_limit: effectiveLimit, current_count: currentCount } = limitRow
    if (effectiveLimit != null && currentCount >= effectiveLimit) {
      return { error: `This organization has reached its user limit of ${effectiveLimit}. Contact your account manager to increase it.` }
    }

    const token = randomUUID()
    const result = await pool.query(
      `INSERT INTO public.organization_invites (organization_id, email, role, invited_by, token)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING token`,
      [orgId, email, role, user?.id, token]
    )

    revalidatePath('/settings')
    return { success: true, token: result.rows[0].token, link: `${INVITE_BASE_URL}/invite/${result.rows[0].token}` }
  } catch (err: any) { return { error: err.message } }
}

// ─── revokeInvite ─────────────────────────────────────────────────────────────

export async function revokeInvite(inviteId: string) {
  const { isAdmin, error: authError } = await requireAdmin()
  if (!isAdmin) return { error: authError || 'Unauthorized' }
  try {
    await pool.query("UPDATE public.organization_invites SET status = 'revoked' WHERE id = $1", [inviteId])
    revalidatePath('/settings'); revalidatePath('/reps'); revalidatePath('/home'); revalidatePath('/'); return { success: true }
  } catch (err: any) { return { error: err.message } }
}

// ─── updateUserRole ───────────────────────────────────────────────────────────

export async function updateUserRole(userId: string, newRole: string) {
  const { isAdmin, error: authError } = await requireAdmin()
  if (!isAdmin) return { error: authError || 'Only admins can change roles' }
  try {
    const roleMap: Record<string, string> = {
      'admin': 'admin',
      'Admin': 'admin',
      'super_admin': 'super_admin',
      'Super Admin': 'super_admin',
      'user': 'user',
      'User': 'user',
      'Sales Rep': 'user',
      'sales rep': 'user',
    }
    const normalizedRole = roleMap[newRole] ?? 'user'
    await pool.query('UPDATE public.users SET role = $1 WHERE id = $2', [normalizedRole, userId])
    revalidatePath('/settings'); revalidatePath('/reps'); revalidatePath('/home'); revalidatePath('/'); return { success: true }
  } catch (err: any) { return { error: err.message } }
}

// ─── toggleUserSuspension ─────────────────────────────────────────────────────

export async function toggleUserSuspension(userId: string, suspend: boolean) {
  const { isAdmin, error: authError } = await requireAdmin()
  if (!isAdmin) return { error: authError || 'Unauthorized' }
  try {
    await pool.query('UPDATE public.users SET is_active = $1 WHERE id = $2', [!suspend, userId])
    revalidatePath('/settings'); revalidatePath('/reps'); revalidatePath('/home'); revalidatePath('/'); return { success: true }
  } catch (err: any) { return { error: err.message } }
}

// ─── removeUser ───────────────────────────────────────────────────────────────

export async function removeUser(userId: string) {
  const { isAdmin, error: authError } = await requireAdmin()
  if (!isAdmin) return { error: authError || 'Unauthorized' }
  try {
    await pool.query('UPDATE public.users SET is_active = false WHERE id = $1', [userId])
    revalidatePath('/settings'); revalidatePath('/reps'); revalidatePath('/home'); revalidatePath('/'); return { success: true }
  } catch (err: any) { return { error: err.message } }
}

// ─── getRoles ─────────────────────────────────────────────────────────────────

export async function getRoles() {
  const orgId = await getDefaultOrgId()
  if (!orgId) return []
  try {
    const result = await pool.query('SELECT * FROM public.organization_roles WHERE organization_id = $1 ORDER BY created_at', [orgId])
    if (!result.rows || result.rows.length === 0) {
      const defaultRoles = [
        { organization_id: orgId, name: 'Admin', is_system: true, description: 'Full access to all modules and settings.', permissions: { global: { manage_billing: true, manage_users: true }, leads: { view_all: true, create: true, edit: true, delete: true }, deals: { view_all: true, create: true, edit: true, delete: true, manage_stages: true }, tasks: { view_all: true, create: true, edit: true, delete: true } } },
        { organization_id: orgId, name: 'Sales Rep', is_system: true, description: 'Standard access for sales representatives.', permissions: { global: { manage_billing: false, manage_users: false }, leads: { view_all: false, create: true, edit: true, delete: false }, deals: { view_all: false, create: true, edit: true, delete: false, manage_stages: false }, tasks: { view_all: false, create: true, edit: true, delete: false } } }
      ]
      const newRoles: any[] = []
      for (const role of defaultRoles) {
        const r = await pool.query(
          'INSERT INTO public.organization_roles (organization_id, name, is_system, description, permissions) VALUES ($1,$2,$3,$4,$5) RETURNING *',
          [role.organization_id, role.name, role.is_system, role.description, JSON.stringify(role.permissions)])
        newRoles.push(r.rows[0])
      }
      return newRoles
    }
    return result.rows
  } catch (err: any) { console.error('getRoles Error:', err.message); return [] }
}

// ─── createRole ───────────────────────────────────────────────────────────────

export async function createRole(name: string, description: string) {
  const orgId = await getDefaultOrgId()
  if (!orgId) return { error: 'No organization found' }
  const { isAdmin, error: authError } = await requireAdmin()
  if (!isAdmin) return { error: authError || 'Unauthorized' }
  const defaultPermissions = {
    leads: { view_all: false, create: false, edit: false, delete: false },
    deals: { view_all: false, create: false, edit: false, delete: false, manage_stages: false },
    tasks: { view_all: false, create: false, edit: false, delete: false },
    global: { manage_users: false, manage_billing: false }
  }
  try {
    await pool.query(
      'INSERT INTO public.organization_roles (organization_id, name, description, permissions) VALUES ($1,$2,$3,$4)',
      [orgId, name, description, JSON.stringify(defaultPermissions)])
    revalidatePath('/settings'); return { success: true }
  } catch (err: any) { return { error: err.message } }
}

// ─── updateRolePermissions ────────────────────────────────────────────────────

export async function updateRolePermissions(roleId: string, permissions: any) {
  const { isAdmin, error: authError } = await requireAdmin()
  if (!isAdmin) return { error: authError || 'Unauthorized' }
  try {
    await pool.query('UPDATE public.organization_roles SET permissions = $1 WHERE id = $2', [JSON.stringify(permissions), roleId])
    revalidatePath('/settings'); revalidatePath('/reps'); revalidatePath('/home'); revalidatePath('/'); return { success: true }
  } catch (err: any) { return { error: err.message } }
}

// ─── deleteRole ───────────────────────────────────────────────────────────────

export async function deleteRole(roleId: string) {
  const { isAdmin, error: authError } = await requireAdmin()
  if (!isAdmin) return { error: authError || 'Unauthorized' }
  try {
    const roleResult = await pool.query('SELECT id, name, is_system FROM public.organization_roles WHERE id = $1', [roleId])
    const role = roleResult.rows[0]
    if (!role) return { error: 'Role not found' }
    if (role.is_system) return { error: 'System roles cannot be deleted' }
    const usersResult = await pool.query('SELECT id FROM public.users WHERE role = $1 LIMIT 1', [role.name])
    if (usersResult.rows.length > 0) return { error: 'This role is currently assigned to users. Change their roles before deleting.' }
    await pool.query('DELETE FROM public.organization_roles WHERE id = $1', [roleId])
    revalidatePath('/settings'); return { success: true }
  } catch (err: any) { return { error: err.message } }
}