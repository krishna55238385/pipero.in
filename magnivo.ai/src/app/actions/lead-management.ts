'use server'

import pool from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { currentUser } from '@clerk/nextjs/server'

async function getDefaultOrgId(): Promise<string | null> {
  try {
    const r = await pool.query('SELECT id FROM public.organizations LIMIT 1')
    return r.rows[0]?.id ?? null
  } catch { return null }
}

async function getOrCreateUser(clerkUser: { id: string, email: string | null, firstName?: string | null, lastName?: string | null }) {
  // Try to find existing user
  const existing = await pool.query(
    'SELECT * FROM public.users WHERE clerk_id = $1 LIMIT 1',
    [clerkUser.id]
  )

  if (existing.rows[0]) {
    // Update email if missing
    if (!existing.rows[0].email && clerkUser.email) {
      await pool.query(
        'UPDATE public.users SET email = $1 WHERE clerk_id = $2',
        [clerkUser.email, clerkUser.id]
      )
    }
    return existing.rows[0]
  }

  // Auto-create new user
  const orgResult = await pool.query('SELECT id FROM public.organizations LIMIT 1')
  const orgId = orgResult.rows[0]?.id
  if (!orgId) return null

  const fullName = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ') || clerkUser.email || 'New User'

  const newUser = await pool.query(
    `INSERT INTO public.users (clerk_id, organization_id, email, full_name, role)
     VALUES ($1, $2, $3, $4, 'user')
     RETURNING *`,
    [clerkUser.id, orgId, clerkUser.email, fullName]
  )

  return newUser.rows[0]
}

async function requireAdmin() {
  const cookieStore = await cookies()
  const isMockAuth = cookieStore.get('sb-mock-auth')?.value === 'true'
  const clerkUser = await currentUser()

  if (!clerkUser && isMockAuth) {
    const r = await pool.query('SELECT * FROM public.users LIMIT 1')
    const firstUser = r.rows[0]
    if (firstUser) return { isAdmin: true, user: firstUser }
    return { isAdmin: false, user: null, error: 'No users found' }
  }
  if (!clerkUser) return { isAdmin: false, user: null, error: 'Authentication required' }

  const dbRow = await getOrCreateUser({
    id: clerkUser.id,
    email: clerkUser.emailAddresses?.[0]?.emailAddress ?? null,
    firstName: clerkUser.firstName,
    lastName: clerkUser.lastName,
  })
  const role = dbRow?.role
  const isAdmin = role === 'admin' || role === 'super_admin'
  if (!isAdmin) return { isAdmin: false, user: clerkUser, error: 'Admin privileges required' }
  return { isAdmin: true, user: clerkUser }
}

// Signature preserved for backward-compat callers in crm.ts (supabase param ignored).
export async function logLeadEvent(_supabase: any, orgId: string, event: {
  lead_id?: string
  event_type: string
  description: string
  metadata?: any
  performed_by?: string
}) {
  try {
    await pool.query(
      'INSERT INTO public.lead_audit_logs (organization_id, lead_id, event_type, description, metadata, performed_by) VALUES ($1,$2,$3,$4,$5,$6)',
      [orgId, event.lead_id ?? null, event.event_type, event.description, event.metadata ? JSON.stringify(event.metadata) : '{}', event.performed_by ?? null]
    )
  } catch (err: any) { console.error('logLeadEvent error:', err.message) }
}

// ─── Lead Statuses ─────────────────────────────────────────────────────────────

export async function getLeadStatuses() {
  try {
    const orgId = await getDefaultOrgId()
    if (!orgId) return []
    const r = await pool.query(
      'SELECT * FROM public.lead_statuses WHERE organization_id = $1 ORDER BY sort_order ASC', [orgId])
    return r.rows
  } catch (err: any) { console.error('Error fetching lead statuses:', err.message); return [] }
}

export async function addLeadStatus(label: string, color: string) {
  try {
    const orgId = await getDefaultOrgId()
    if (!orgId) return { error: 'No organization found' }
    const r = await pool.query(
      'SELECT sort_order FROM public.lead_statuses WHERE organization_id = $1 ORDER BY sort_order DESC LIMIT 1', [orgId])
    const nextOrder = (r.rows[0]?.sort_order ?? -1) + 1
    await pool.query(
      'INSERT INTO public.lead_statuses (organization_id, label, color, sort_order) VALUES ($1,$2,$3,$4)',
      [orgId, label, color, nextOrder])
    revalidatePath('/settings'); revalidatePath('/leads')
    return { success: true }
  } catch (err: any) { return { error: err.message } }
}

export async function deleteLeadStatus(id: string) {
  try {
    const orgId = await getDefaultOrgId()
    if (!orgId) return { error: 'No organization found' }
    const { isAdmin, error: authError } = await requireAdmin()
    if (!isAdmin) return { error: authError || 'Unauthorized' }
    await pool.query('DELETE FROM public.lead_statuses WHERE id = $1 AND organization_id = $2', [id, orgId])
    revalidatePath('/settings'); revalidatePath('/leads')
    return { success: true }
  } catch (err: any) { return { error: err.message } }
}

// ─── Pipeline Stages ───────────────────────────────────────────────────────────

export async function getPipelineStages() {
  try {
    const orgId = await getDefaultOrgId()
    if (!orgId) return []
    const r = await pool.query(
      'SELECT * FROM public.pipeline_stages WHERE organization_id = $1 ORDER BY sort_order ASC', [orgId])
    return r.rows
  } catch (err: any) { console.error('Error fetching pipeline stages:', err.message); return [] }
}

export async function addPipelineStage(label: string, probability: number) {
  try {
    const orgId = await getDefaultOrgId()
    if (!orgId) return { error: 'No organization found' }
    const r = await pool.query(
      'SELECT sort_order FROM public.pipeline_stages WHERE organization_id = $1 ORDER BY sort_order DESC LIMIT 1', [orgId])
    const nextOrder = (r.rows[0]?.sort_order ?? -1) + 1
    await pool.query(
      'INSERT INTO public.pipeline_stages (organization_id, label, probability, sort_order) VALUES ($1,$2,$3,$4)',
      [orgId, label, probability, nextOrder])
    revalidatePath('/settings'); revalidatePath('/deals')
    return { success: true }
  } catch (err: any) { return { error: err.message } }
}

export async function deletePipelineStage(id: string) {
  try {
    const orgId = await getDefaultOrgId()
    if (!orgId) return { error: 'No organization found' }
    const { isAdmin, error: authError } = await requireAdmin()
    if (!isAdmin) return { error: authError || 'Unauthorized' }
    await pool.query('DELETE FROM public.pipeline_stages WHERE id = $1 AND organization_id = $2', [id, orgId])
    revalidatePath('/settings'); revalidatePath('/deals')
    return { success: true }
  } catch (err: any) { return { error: err.message } }
}

// ─── Routing & Hygiene Settings ────────────────────────────────────────────────

export async function getLeadManagementSettings() {
  try {
    const orgId = await getDefaultOrgId()
    if (!orgId) return null
    const [routingRes, hygieneRes] = await Promise.all([
      pool.query('SELECT * FROM public.lead_routing_settings WHERE organization_id = $1 LIMIT 1', [orgId]),
      pool.query('SELECT * FROM public.lead_hygiene_settings WHERE organization_id = $1 LIMIT 1', [orgId])
    ])
    return {
      routing: routingRes.rows[0] || { assignment_mode: 'manual', load_balancing_enabled: false, untouched_reassignment_days: 3, untouched_reassignment_minutes: 60 },
      hygiene: hygieneRes.rows[0] || { duplicate_fields: [], merge_strategy: 'manual' }
    }
  } catch (err: any) { console.error('Error fetching lead management settings:', err.message); return null }
}

export async function updateLeadRoutingSettings(settings: any) {
  try {
    const orgId = await getDefaultOrgId()
    if (!orgId) return { error: 'No organization found' }
    const payload = { organization_id: orgId, ...settings, updated_at: new Date().toISOString() }
    const keys = Object.keys(payload); const vals = Object.values(payload)
    const ph = keys.map((_, i) => `$${i + 1}`).join(', ')
    const sets = keys.filter(k => k !== 'organization_id').map(k => `"${k}" = EXCLUDED."${k}"`).join(', ')
    await pool.query(
      `INSERT INTO public.lead_routing_settings (${keys.map(k => `"${k}"`).join(', ')}) VALUES (${ph})
       ON CONFLICT (organization_id) DO UPDATE SET ${sets}`, vals)
    revalidatePath('/settings')
    return { success: true }
  } catch (err: any) { return { error: err.message } }
}

export async function updateLeadHygieneSettings(settings: any) {
  try {
    const orgId = await getDefaultOrgId()
    if (!orgId) return { error: 'No organization found' }
    const payload = { organization_id: orgId, ...settings, updated_at: new Date().toISOString() }
    const keys = Object.keys(payload); const vals = Object.values(payload)
    const ph = keys.map((_, i) => `$${i + 1}`).join(', ')
    const sets = keys.filter(k => k !== 'organization_id').map(k => `"${k}" = EXCLUDED."${k}"`).join(', ')
    await pool.query(
      `INSERT INTO public.lead_hygiene_settings (${keys.map(k => `"${k}"`).join(', ')}) VALUES (${ph})
       ON CONFLICT (organization_id) DO UPDATE SET ${sets}`, vals)
    revalidatePath('/settings')
    return { success: true }
  } catch (err: any) { return { error: err.message } }
}

export async function getLeadRoutingRules() {
  try {
    const orgId = await getDefaultOrgId()
    if (!orgId) return []
    const r = await pool.query(`
      SELECT rr.*, json_build_object('full_name', u.full_name) AS assign_to_user
      FROM public.lead_routing_rules rr
      LEFT JOIN public.users u ON u.id = rr.assign_to_user_id
      WHERE rr.organization_id = $1
      ORDER BY rr.priority ASC
    `, [orgId])
    return r.rows
  } catch (err: any) { console.error('Error fetching routing rules:', err.message); return [] }
}

export async function addLeadRoutingRule(name: string, conditions: any[], assignTo: string, priority: number = 0) {
  try {
    const orgId = await getDefaultOrgId()
    if (!orgId) return { error: 'No organization found' }
    await pool.query(
      'INSERT INTO public.lead_routing_rules (organization_id, name, conditions, assign_to_user_id, priority) VALUES ($1,$2,$3,$4,$5)',
      [orgId, name, JSON.stringify(conditions), assignTo, priority])
    revalidatePath('/settings')
    return { success: true }
  } catch (err: any) { return { error: err.message } }
}

export async function deleteLeadRoutingRule(id: string) {
  try {
    const { isAdmin, error: authError } = await requireAdmin()
    if (!isAdmin) return { error: authError || 'Unauthorized' }
    await pool.query('DELETE FROM public.lead_routing_rules WHERE id = $1', [id])
    revalidatePath('/settings')
    return { success: true }
  } catch (err: any) { return { error: err.message } }
}

// ─── Deduplication ─────────────────────────────────────────────────────────────

// Signature preserved for backward-compat (supabase param ignored).
export async function findDuplicateLead(_supabase: any, orgId: string, leadData: any) {
  try {
    const hygieneRes = await pool.query(
      'SELECT duplicate_fields, merge_strategy FROM public.lead_hygiene_settings WHERE organization_id = $1 LIMIT 1', [orgId])
    const hygiene = hygieneRes.rows[0]
    if (!hygiene?.duplicate_fields?.length) return null

    const conditions: string[] = ['organization_id = $1']
    const vals: any[] = [orgId]
    const orClauses: string[] = []

    for (const field of hygiene.duplicate_fields) {
      const val = leadData[field]
      if (val) { vals.push(val); orClauses.push(`"${field}" = $${vals.length}`) }
    }

    if (orClauses.length === 0) return null

    const r = await pool.query(
      `SELECT id, name FROM public.leads WHERE ${conditions.join(' AND ')} AND (${orClauses.join(' OR ')}) LIMIT 1`, vals)
    const duplicate = r.rows[0]
    if (!duplicate) return null

    await logLeadEvent(null, orgId, {
      lead_id: duplicate.id,
      event_type: 'hygiene_duplicate_found',
      description: `Duplicate detected during creation of ${leadData.name}. Strategy: ${hygiene.merge_strategy}`,
      metadata: { duplicate_fields: hygiene.duplicate_fields, match: duplicate }
    })

    return { duplicate, strategy: hygiene.merge_strategy }
  } catch (err: any) { console.error('findDuplicateLead error:', err.message); return null }
}

export async function getLeadDuplicates() {
  try {
    const orgId = await getDefaultOrgId()
    if (!orgId) return []
    const r = await pool.query(`
      SELECT ld.id, ld.similarity_score, ld.status, ld.created_at,
        json_build_object('id', ol.id, 'name', ol.name, 'email', ol.email, 'phone_number', ol.phone_number, 'contact_person', ol.contact_person) AS original_lead,
        json_build_object('id', dl.id, 'name', dl.name, 'email', dl.email, 'phone_number', dl.phone_number, 'contact_person', dl.contact_person) AS duplicate_lead
      FROM public.lead_duplicates ld
      LEFT JOIN public.leads ol ON ol.id = ld.original_lead_id
      LEFT JOIN public.leads dl ON dl.id = ld.duplicate_lead_id
      WHERE ld.organization_id = $1 AND ld.status = 'pending'
      ORDER BY ld.similarity_score DESC, ld.created_at DESC
    `, [orgId])
    return r.rows
  } catch (err: any) { console.error('Error fetching lead duplicates:', err.message); return [] }
}

export async function dismissLeadDuplicate(id: string) {
  try {
    const orgId = await getDefaultOrgId()
    if (!orgId) return { error: 'No organization found' }
    await pool.query(
      "UPDATE public.lead_duplicates SET status = 'rejected' WHERE id = $1 AND organization_id = $2", [id, orgId])
    await logLeadEvent(null, orgId, {
      event_type: 'hygiene_duplicate_dismissed',
      description: 'Duplicate review entry dismissed (kept as separate leads)',
      metadata: { duplicate_id: id }
    })
    revalidatePath('/leads')
    return { success: true }
  } catch (err: any) { return { error: err.message } }
}

// ─── Lead Intelligence ─────────────────────────────────────────────────────────

export async function calculateLeadScore(data: any) {
  let score = 0
  const temp = (data.temperature || 'cold').toLowerCase()
  if (temp === 'hot') score += 40
  else if (temp === 'warm') score += 20
  else score += 5
  const value = parseFloat(data.lead_value || data.value || 0)
  if (value > 10000) score += 40
  else if (value > 5000) score += 30
  else if (value > 1000) score += 15
  else if (value > 0) score += 5
  if (data.phone_number) score += 10
  if (data.contact_person || data.name) score += 10
  return Math.min(score, 100)
}

// ─── Lead Routing ──────────────────────────────────────────────────────────────

// Signature preserved for backward-compat (supabase param ignored).
export async function getAssignedOwner(_supabase: any, orgId: string, leadData: any) {
  try {
    const settingsRes = await pool.query(
      'SELECT * FROM public.lead_routing_settings WHERE organization_id = $1 LIMIT 1', [orgId])
    const settings = settingsRes.rows[0]
    if (!settings) return null

    if (settings.assignment_mode === 'rule_based') {
      const rulesRes = await pool.query(
        "SELECT * FROM public.lead_routing_rules WHERE organization_id = $1 AND is_active = true ORDER BY priority ASC", [orgId])
      for (const rule of rulesRes.rows) {
        if (evaluateConditions(rule.conditions, leadData)) {
          const userRes = await pool.query('SELECT availability_status FROM public.users WHERE id = $1 LIMIT 1', [rule.assign_to_user_id])
          if (userRes.rows[0]?.availability_status !== false) return rule.assign_to_user_id
        }
      }
    }

    const membersRes = await pool.query(
      "SELECT id, lead_weight, availability_status FROM public.users WHERE organization_id = $1 AND is_active = true AND availability_status = true ORDER BY created_at ASC",
      [orgId])
    const members = membersRes.rows
    if (!members.length) return settings.fallback_user_id

    if (settings.assignment_mode === 'load_based' || settings.load_balancing_enabled) {
      let bestMember = null; let minLoad = Infinity
      for (const member of members) {
        const [leadRes, dealRes] = await Promise.all([
          pool.query("SELECT COUNT(*) FROM public.leads WHERE owner_id = $1 AND status NOT IN ('Won','Lost')", [member.id]),
          pool.query("SELECT COUNT(*) FROM public.deals WHERE assigned_to = $1 AND status NOT IN ('Won','Lost')", [member.id])
        ])
        const totalLoad = parseInt(leadRes.rows[0].count, 10) + parseInt(dealRes.rows[0].count, 10)
        if (totalLoad < minLoad && totalLoad < (settings.max_leads_per_user || 20)) {
          minLoad = totalLoad; bestMember = member.id
        }
      }
      if (bestMember) return bestMember
    }

    if (settings.assignment_mode === 'weighted') {
      const totalWeight = members.reduce((sum: number, m: any) => sum + (m.lead_weight || 100), 0)
      let random = Math.random() * totalWeight
      for (const member of members) {
        random -= (member.lead_weight || 100)
        if (random <= 0) return member.id
      }
    }

    const lastLeadRes = await pool.query(
      'SELECT owner_id FROM public.leads WHERE organization_id = $1 AND owner_id IS NOT NULL ORDER BY created_at DESC LIMIT 1',
      [orgId])
    const lastOwnerId = lastLeadRes.rows[0]?.owner_id
    const lastIdx = members.findIndex((m: any) => m.id === lastOwnerId)
    const nextIdx = (lastIdx + 1) % members.length
    const finalOwner = members[nextIdx].id

    await logLeadEvent(null, orgId, {
      event_type: 'lead_assigned',
      description: `Lead assigned via ${settings.assignment_mode}`,
      metadata: { mode: settings.assignment_mode, assigned_to: finalOwner }
    })

    return finalOwner
  } catch (err: any) { console.error('getAssignedOwner error:', err.message); return null }
}

function evaluateConditions(conditions: any[], data: any) {
  if (!conditions || conditions.length === 0) return false
  return conditions.every(cond => {
    const fieldVal = data[cond.field] || ''
    const targetVal = cond.val
    switch (cond.op) {
      case 'equals': return String(fieldVal).toLowerCase() == String(targetVal).toLowerCase()
      case 'contains': return String(fieldVal).toLowerCase().includes(String(targetVal).toLowerCase())
      case 'greater_than': return Number(fieldVal) > Number(targetVal)
      case 'starts_with': return String(fieldVal).toLowerCase().startsWith(String(targetVal).toLowerCase())
      case 'in_list': return String(targetVal).split(',').map((s: string) => s.trim().toLowerCase()).includes(String(fieldVal).toLowerCase())
      default: return false
    }
  })
}

export async function auditLeadsSLA() {
  try {
    const orgId = await getDefaultOrgId()
    if (!orgId) return { error: 'No organization found' }

    const settingsRes = await pool.query(
      'SELECT untouched_reassignment_days, untouched_reassignment_minutes, fallback_user_id FROM public.lead_routing_settings WHERE organization_id = $1 LIMIT 1',
      [orgId])
    const settings = settingsRes.rows[0]
    const thresholdMinutes = settings?.untouched_reassignment_minutes || (settings?.untouched_reassignment_days || 3) * 1440
    const cutoff = new Date(Date.now() - thresholdMinutes * 60 * 1000).toISOString()

    const breachRes = await pool.query(
      "SELECT id, name, owner_id FROM public.leads WHERE organization_id = $1 AND last_contacted_at IS NULL AND created_at < $2 AND status NOT IN ('Won','Lost')",
      [orgId, cutoff])
    const breachingLeads = breachRes.rows
    if (!breachingLeads.length) return { success: true, count: 0 }

    let reassignedCount = 0
    for (const lead of breachingLeads) {
      const newOwnerId = await getAssignedOwner(null, orgId, lead)
      if (newOwnerId && newOwnerId !== lead.owner_id) {
        await pool.query('UPDATE public.leads SET owner_id = $1 WHERE id = $2', [newOwnerId, lead.id])
        reassignedCount++
      }
    }

    revalidatePath('/leads')
    return { success: true, count: reassignedCount }
  } catch (err: any) { return { error: err.message } }
}

export async function updateUserRoutingSettings(userId: string, data: { lead_weight?: number; availability_status?: boolean; skills?: string[] }) {
  try {
    const keys = Object.keys(data); const vals = Object.values(data)
    const sets = keys.map((k, i) => `"${k}" = $${i + 1}`).join(', ')
    await pool.query(`UPDATE public.users SET ${sets} WHERE id = $${keys.length + 1}`, [...vals, userId])
    return { success: true }
  } catch (err: any) { return { error: err.message } }
}

export async function getLeadAuditLogs(filters?: {
  event_type?: string; user_id?: string; start_date?: string; end_date?: string
}) {
  try {
    const orgId = await getDefaultOrgId()
    if (!orgId) return []

    const values: any[] = [orgId]
    const conditions: string[] = ['organization_id = $1']

    if (filters?.event_type && filters.event_type !== 'all') { values.push(filters.event_type); conditions.push(`event_type = $${values.length}`) }
    if (filters?.user_id && filters.user_id !== 'all') { values.push(filters.user_id); conditions.push(`target_user_id = $${values.length}`) }
    if (filters?.start_date) { values.push(filters.start_date); conditions.push(`created_at >= $${values.length}`) }
    if (filters?.end_date) { values.push(filters.end_date); conditions.push(`created_at <= $${values.length}`) }

    const r = await pool.query(
      `SELECT * FROM public.lead_audit_logs WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT 200`, values)
    return r.rows
  } catch (err: any) { console.error('Error fetching lead audit logs:', err.message); return [] }
}

export async function getLeadAssignmentStats() {
  try {
    const orgId = await getDefaultOrgId()
    if (!orgId) return null
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const [countRes, leadsRes] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM public.leads WHERE organization_id = $1 AND created_at >= $2', [orgId, today.toISOString()]),
      pool.query('SELECT owner_id, source FROM public.leads WHERE organization_id = $1 AND created_at >= $2', [orgId, today.toISOString()])
    ])
    return {
      todayTotal: parseInt(countRes.rows[0].count, 10),
      leadsToday: leadsRes.rows
    }
  } catch (err: any) { console.error('getLeadAssignmentStats error:', err.message); return null }
}
