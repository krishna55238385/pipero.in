'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { createNotification, getMockableUser } from '@/app/actions/notifications'
import { cookies } from 'next/headers'
import { executeAutomationFlows } from '@/app/actions/automation'

// Utility to get the default org for local dev (bypassing auth)
async function getDefaultOrgId(supabase: any) {
  const { data } = await supabase.from('organizations').select('id').limit(1).single()
  return data?.id
}

/**
 * Helper to ensure the current user has admin/super_admin privileges.
 * Returns { isAdmin: boolean, user: any, error?: string }
 */
async function requireAdmin(supabase: any) {
    const cookieStore = await cookies()
    const isMockAuth = cookieStore.get('sb-mock-auth')?.value === 'true'
    let { data: { user } } = await supabase.auth.getUser()

    if (!user && isMockAuth) {
        // Fallback to first user for mock auth
        const { data: firstUser } = await supabase.from('users').select('*').limit(1).single()
        if (firstUser) user = firstUser as any
        return { isAdmin: true, user }
    }

    if (!user) return { isAdmin: false, user: null, error: 'Authentication required' }

    const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
    const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin'

    if (!isAdmin) return { isAdmin: false, user, error: 'Admin privileges required' }
    
    return { isAdmin: true, user }
}

interface LeadFilters {
  q?: string;
  temperature?: string;
  status?: string;
  source?: string;
  subject?: string;
  campaign?: string;
  owner_id?: string;
  dateRange?: string; // e.g. '7d', '30d', 'all'
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

export async function getLeads(filters: LeadFilters = {}) {
  const supabase = await createClient()
  const orgId = await getDefaultOrgId(supabase)
  
  if (!orgId) return { data: [], count: 0, debug: 'no-org-id' }

  const cookieStore = await cookies()
  const isMockAuth = cookieStore.get('sb-mock-auth')?.value === 'true'

  let { data: { user } } = await supabase.auth.getUser()
  
  let isAdmin = false

  if (!user && isMockAuth) {
    isAdmin = true // Allow mock admin view
  } else if (!user && !isMockAuth) {
    return { data: [], count: 0, debug: 'no-user-prod' }
  } else if (user) {
    const { data: userData } = await supabase.from('users').select('role').eq('id', user.id).single()
    isAdmin = userData?.role === 'admin' || userData?.role === 'super_admin'
  }
  
  let query = supabase
    .from('leads')
    .select('*, deals(id, value, status), tasks(id, status)', { count: 'exact' })
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })

  // Non-admins only see leads they own, or leads with no owner
  if (!isAdmin && user) {
      query = query.or(`owner_id.eq.${user.id},owner_id.is.null`)
  }

  if (filters.q) {
    query = query.or(`name.ilike.%${filters.q}%,contact_person.ilike.%${filters.q}%`)
  }
  if (filters.temperature && filters.temperature !== 'all') {
    query = query.eq('temperature', filters.temperature)
  }
  if (filters.status && filters.status !== 'All Statuses') {
    query = query.eq('status', filters.status)
  }
  if (filters.source && filters.source !== 'All Sources') {
    query = query.eq('source', filters.source)
  }
  if (filters.subject && filters.subject !== 'All Subjects') {
    query = query.eq('subject', filters.subject)
  }
  if (filters.campaign && filters.campaign !== 'All Campaigns') {
    query = query.eq('campaign', filters.campaign)
  }
  if (filters.owner_id && filters.owner_id !== 'All Owners') {
    query = query.eq('owner_id', filters.owner_id)
  }
  if (filters.dateRange && filters.dateRange !== 'all') {
    const now = new Date()
    if (filters.dateRange === '7d') {
        const d = new Date(now.setDate(now.getDate() - 7))
        query = query.gte('created_at', d.toISOString())
    } else if (filters.dateRange === '30d') {
        const d = new Date(now.setDate(now.getDate() - 30))
        query = query.gte('created_at', d.toISOString())
    } else if (filters.dateRange === '90d') {
        const d = new Date(now.setDate(now.getDate() - 90))
        query = query.gte('created_at', d.toISOString())
    }
  }

  if (filters.dateFrom) {
    query = query.gte('created_at', filters.dateFrom)
  }
  if (filters.dateTo) {
    const toDate = new Date(filters.dateTo)
    toDate.setDate(toDate.getDate() + 1)
    query = query.lt('created_at', toDate.toISOString())
  }
    
  if (filters.page && filters.pageSize) {
    const from = (filters.page - 1) * filters.pageSize
    const to = from + filters.pageSize - 1
    query = query.range(from, to)
  }
    
  const { data, count, error } = await query
    
  if (error) {
    console.error('Error fetching leads:', error.message, error.details)
    return { data: [], count: 0, debug: `supabase-error: ${error.message}` }
  }
  return { 
    data: data || [], 
    count: count || 0,
    debug: `success-count-${data?.length}-total-${count}-isAdmin-${isAdmin}-user-${user?.id || 'mock'}` 
  }
}

export async function getDeals(searchQuery?: string) {
  const supabase = await createClient()
  const orgId = await getDefaultOrgId(supabase)
  if (!orgId) return []
  
  const cookieStore = await cookies()
  const isMockAuth = cookieStore.get('sb-mock-auth')?.value === 'true'

  let { data: { user } } = await supabase.auth.getUser()
  
  let isAdmin = false

  if (!user && isMockAuth) {
    isAdmin = true
  } else if (!user && !isMockAuth) {
    return []
  } else if (user) {
    const { data: userData } = await supabase.from('users').select('role').eq('id', user.id).single()
    isAdmin = userData?.role === 'admin' || userData?.role === 'super_admin'
  }

  let query = supabase
    .from('deals')
    .select('*, leads!inner(name, contact_person, owner_id, location, created_at), assigned_user:users!deals_assigned_to_fkey(id, full_name)')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })

  if (!isAdmin && user) {
      // Non-admins see deals assigned to them, or deals on leads they own, or unassigned deals
      query = query.or(`assigned_to.eq.${user.id},assigned_to.is.null,leads.owner_id.eq.${user.id}`)
  }

  if (searchQuery) {
    query = query.ilike('title', `%${searchQuery}%`)
  }
    
  const { data, error } = await query
    
  if (error) {
    console.error('Error fetching deals:', error)
    return []
  }
  return data
}

import { logLeadEvent } from '@/app/actions/lead-management'
import {
  createLeadRecord,
  type PublicLeadPayload,
} from '@/lib/create-lead-record'

export async function addLead(formData: FormData) {
  const supabase = await createClient()
  const orgId = await getDefaultOrgId(supabase)
  
  const cookieStore = await cookies()
  const isMockAuth = cookieStore.get('sb-mock-auth')?.value === 'true'
  
  let { data: { user } } = await supabase.auth.getUser()
  
  if (!user && !isMockAuth) {
    return { error: 'Not authenticated' }
  }

  const payload: PublicLeadPayload = {
    company: (formData.get('company') as string) || '',
    name: (formData.get('name') as string) || '',
    phone: (formData.get('phone') as string) || '',
    location: (formData.get('location') as string) || '',
    temperature: (formData.get('temperature') as string) || 'cold',
    source: ((formData.get('source') as string) || 'Direct'),
    industry: (formData.get('industry') as string) || '',
    zip_code: (formData.get('zip_code') as string) || '',
    value: formData.get('value') as string | null
  }

  const result = await createLeadRecord(supabase, orgId, payload, {
    initialOwnerId: user?.id || null,
    method: 'manual',
    defaultSource: 'Direct',
    performedBy: user?.id || null
  })

  if ('error' in result) {
    return { error: result.error }
  }

  await logActivity(
    supabase,
    orgId,
    'created_lead',
    `added a new lead: ${result.data.name}`,
    result.data.id
  )

  if (result.data.owner_id) {
    const actor = await getMockableUser()
    if (actor?.id !== result.data.owner_id) {
      await createNotification({
        user_id: result.data.owner_id,
        actor_id: actor?.id,
        type: 'assigned_lead',
        title: 'New Lead Assigned',
        content: `You have been assigned a new lead: ${result.data.name}`,
        link_url: `/leads/${result.data.id}`,
      })
    }
  }

  revalidatePath('/leads')
  revalidatePath('/')
  
  executeAutomationFlows('lead_created', 'lead', result.data.id, result.data).catch(console.error)

  return { success: true }
}

export async function addLeads(leadsData: any[]) {
  const supabase = await createClient()
  const orgId = await getDefaultOrgId(supabase)

  if (!orgId) return { error: 'No organization found' }

  const { isAdmin, error: authError } = await requireAdmin(supabase)
  if (!isAdmin) return { error: authError || 'Unauthorized' }

  // Normalize keys: lowercase, trim (supports CSV/Google Sheet headers)
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
    // Google Sheet / Multiple add Campaigns columns: Timestamp, Name, Email, Phone, UTM_Source, UTM_Campaign, UTM_Medium, Full_URL
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

    // Try to normalize demo date to YYYY-MM-DD if it parses cleanly
    let demoDate: string | null = null
    if (demoDateRaw) {
      const parsed = new Date(demoDateRaw)
      if (!Number.isNaN(parsed.getTime())) {
        demoDate = parsed.toISOString().slice(0, 10)
      }
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
      source,
      subject: subject || null,
      campaign: campaign || null,
      grade_level: gradeLevel || null,
      demo_date: demoDate,
      demo_time_slot: demoTimeSlot || null,
      ...(Object.keys(utmMetadata).length > 0 && { utm_metadata: utmMetadata }),
    }
  }).filter(l => l.phone_number) // require at least phone for CRM

  if (formattedLeads.length === 0) {
    return { error: 'No valid rows to import. Ensure columns include Name/Email/Phone (or Phone) and at least one row has a phone number.' }
  }

  const { data: insertedData, error } = await supabase.from('leads').insert(formattedLeads).select()

  if (error) {
    console.error('Error adding bulk leads:', error)
    return { error: error.message }
  }

  await logActivity(supabase, orgId, 'imported_leads', `imported ${formattedLeads.length} leads`)

  if (insertedData && insertedData.length > 0) {
      const user = await getMockableUser()
      for (const lead of insertedData) {
          await logLeadEvent(supabase, orgId, {
              lead_id: lead.id,
              event_type: 'lead_created',
              description: `Lead created via bulk import.`,
              metadata: { source: lead.source, method: 'import' },
              performed_by: user?.id
          })
      }
  }

  revalidatePath('/leads')
  revalidatePath('/')
  return { success: true, count: insertedData?.length ?? formattedLeads.length }
}

export async function bulkDeleteLeads(leadIds: string[]) {
  const supabase = await createClient()
  const orgId = await getDefaultOrgId(supabase)
  if (!orgId) return { error: 'No organization found' }

  const { isAdmin, error: authError } = await requireAdmin(supabase)
  if (!isAdmin) return { error: authError || 'Unauthorized' }

  const { error } = await supabase.from('leads').delete().in('id', leadIds)

  if (error) {
    console.error('Error deleting bulk leads:', error)
    return { error: error.message }
  }

  await logActivity(supabase, orgId, 'deleted_leads', `deleted ${leadIds.length} leads`)

  const user = await getMockableUser()
  for (const leadId of leadIds) {
      await logLeadEvent(supabase, orgId, {
          lead_id: leadId,
          event_type: 'lead_deleted',
          description: `Lead deleted via bulk action.`,
          performed_by: user?.id
      })
  }

  revalidatePath('/leads')
  revalidatePath('/')
  return { success: true }
}

export async function bulkUpdateLeadStatus(leadIds: string[], status: string) {
  const supabase = await createClient()
  const orgId = await getDefaultOrgId(supabase)
  
  if (!orgId) return { error: 'No organization found' }

  const { isAdmin, error: authError } = await requireAdmin(supabase)
  if (!isAdmin) return { error: authError || 'Unauthorized' }

  const { error } = await supabase.from('leads').update({ status }).in('id', leadIds)

  if (error) {
    console.error('Error updating bulk leads:', error)
    return { error: error.message }
  }

  await logActivity(supabase, orgId, 'updated_leads', `updated status of ${leadIds.length} leads to ${status}`)

  const user = await getMockableUser()
  for (const leadId of leadIds) {
      await logLeadEvent(supabase, orgId, {
          lead_id: leadId,
          event_type: 'status_changed',
          description: `Status updated in bulk to ${status}.`,
          metadata: { new_status: status },
          performed_by: user?.id
      })
  }

  revalidatePath('/leads')
  revalidatePath('/')

  // Trigger Automation: status_changed for each lead
  if (leadIds && leadIds.length > 0) {
    leadIds.forEach(id => {
        executeAutomationFlows('status_changed', 'lead', id, { status }).catch(console.error)
    })
  }

  return { success: true }
}

export async function bulkAssignLeads(leadIds: string[], ownerId: string) {
  const supabase = await createClient()
  const orgId = await getDefaultOrgId(supabase)
  if (!orgId) return { error: 'No organization found' }

  const { isAdmin, error: authError } = await requireAdmin(supabase)
  if (!isAdmin) return { error: authError || 'Unauthorized' }

  const { error } = await supabase
    .from('leads')
    .update({ owner_id: ownerId })
    .in('id', leadIds)

  if (error) {
    console.error('Error bulk assigning leads:', error)
    return { error: error.message }
  }

  await logActivity(supabase, orgId, 'updated_leads', `assigned ${leadIds.length} leads to a rep`)

  const actor = await getMockableUser()
  const { data: owner } = await supabase.from('users').select('full_name').eq('id', ownerId).single()

  for (const leadId of leadIds) {
    await logLeadEvent(supabase, orgId, {
      lead_id: leadId,
      event_type: 'lead_updated',
      description: `Lead assigned to ${owner?.full_name || 'a rep'} in bulk.`,
      metadata: { owner_id: ownerId },
      performed_by: actor?.id
    })
  }

  if (actor?.id !== ownerId) {
    await createNotification({
      user_id: ownerId,
      actor_id: actor?.id,
      type: 'assigned_lead',
      title: 'Leads Assigned to You',
      content: `${leadIds.length} lead${leadIds.length > 1 ? 's have' : ' has'} been assigned to you.`,
      link_url: '/leads'
    })
  }

  revalidatePath('/leads')
  revalidatePath('/')
  return { success: true }
}

export async function updateLeadField(id: string, field: string, value: string | number) {
  const supabase = await createClient()
  const orgId = await getDefaultOrgId(supabase)
  
  if (!orgId) return { error: 'No organization found' }

  // Restrict fields that can be inline edited to prevent security issues
  const allowedFields = ['name', 'contact_person', 'phone_number', 'company', 'location', 'temperature', 'tags', 'health_score', 'owner_id', 'status']
  if (!allowedFields.includes(field)) {
      return { error: 'Invalid field' }
  }

  const { error } = await supabase.from('leads').update({ [field]: value }).eq('id', id)

  if (error) {
    console.error(`Error updating lead ${field}:`, error)
    return { error: error.message }
  }

  await logActivity(supabase, orgId, 'updated_lead', `updated ${field} for a lead`)
  
  const actor = await getMockableUser()
  await logLeadEvent(supabase, orgId, {
      lead_id: id,
      event_type: field === 'status' ? 'status_changed' : 'lead_updated',
      description: `Updated field '${field}' to '${value}'.`,
      metadata: { field, new_value: value },
      performed_by: actor?.id
  })

  if (field === 'owner_id' && value) {
      const { data: lead } = await supabase.from('leads').select('name').eq('id', id).single()
      const actor = await getMockableUser()
      if (actor?.id !== value) {
          await createNotification({
              user_id: String(value),
              actor_id: actor?.id,
              type: 'assigned_lead',
              title: 'New Lead Assigned',
              content: `You have been assigned a new lead: ${lead?.name}`,
              link_url: `/leads/${id}`
          })
      }
  }

  revalidatePath('/leads')
  revalidatePath('/')

  // Trigger Automation: status_changed or field_updated
  if (field === 'status') {
      executeAutomationFlows('status_changed', 'lead', id, { status: value }).catch(console.error)
  }

  return { success: true }
}

export async function deleteLead(id: string) {
  const supabase = await createClient()
  const orgId = await getDefaultOrgId(supabase)
  if (!orgId) return { error: 'No organization found' }

  const { isAdmin, error: authError } = await requireAdmin(supabase)
  if (!isAdmin) return { error: authError || 'Unauthorized' }

  // We should also delete associated tasks and deals, but for now just the lead. 
  // RLS or cascading deletes in DB should ideally handle this.
  const { error } = await supabase.from('leads').delete().eq('id', id)

  if (error) {
    console.error('Error deleting lead:', error)
    return { error: error.message }
  }

  await logActivity(supabase, orgId, 'deleted_lead', `deleted a lead`)
  
  const user = await getMockableUser()
  await logLeadEvent(supabase, orgId, {
      lead_id: id,
      event_type: 'lead_deleted',
      description: `Lead deleted manually.`,
      performed_by: user?.id
  })

  revalidatePath('/leads')
  revalidatePath('/')
  return { success: true }
}

export async function addDeal(formData: FormData) {
  const supabase = await createClient()
  const orgId = await getDefaultOrgId(supabase)
  
  if (!orgId) return { error: 'No organization found' }

  // Fetch dynamic default stage
  const { data: stages } = await supabase.from('pipeline_stages')
    .select('label')
    .eq('organization_id', orgId)
    .order('sort_order', { ascending: true })
    .limit(1)
  
  const defaultStage = stages?.[0]?.label.toLowerCase() || 'lead'

  const data = {
    organization_id: orgId,
    lead_id: formData.get('lead') as string,
    title: formData.get('title') as string,
    value: parseFloat(formData.get('value') as string) || 0,
    status: (formData.get('stage') as string)?.toLowerCase() || defaultStage
  }

  const { data: insertedData, error } = await supabase.from('deals').insert(data).select().single()
  
  if (error) {
    console.error('Error adding deal:', error)
    return { error: error.message }
  }

  await logActivity(supabase, orgId, 'created_deal', `created a new deal: ${data.title} for $${data.value}`, data.lead_id, insertedData.id)

  revalidatePath('/deals')
  revalidatePath('/')
  return { success: true }
}

export async function getLeadById(id: string) {
  const supabase = await createClient()
  const orgId = await getDefaultOrgId(supabase)
  if (!orgId) return null
  
  const { data, error } = await supabase
    .from('leads')
    .select('*, deals(*)')
    .eq('organization_id', orgId)
    .eq('id', id)
    .single()
    
  if (error) {
    console.error('Error fetching lead:', error)
    return null
  }
  return data
}

/** Distinct subject, campaign, and source values for the org (for dynamic filter dropdowns). */
export async function getLeadFilterOptions() {
  const supabase = await createClient()
  const orgId = await getDefaultOrgId(supabase)
  if (!orgId) return { subjects: [], campaigns: [], sources: [] }

  const { data, error } = await supabase
    .from('leads')
    .select('subject, campaign, source')
    .eq('organization_id', orgId)

  if (error) return { subjects: [], campaigns: [], sources: [] }

  const rows = (data || []) as Array<{
    subject: string | null
    campaign: string | null
    source: string | null
  }>

  const subjects = [...new Set(rows.map(r => r.subject).filter(Boolean))].sort() as string[]
  const campaigns = [...new Set(rows.map(r => r.campaign).filter(Boolean))].sort() as string[]
  const sources = [...new Set(rows.map(r => r.source).filter(Boolean))].sort() as string[]

  return { subjects, campaigns, sources }
}

export async function updateDealStage(dealId: string, newStage: string) {
  const supabase = await createClient()
  const orgId = await getDefaultOrgId(supabase)
  
  if (!orgId) return { error: 'No organization found' }

  const { data: deal } = await supabase.from('deals').select('title, value').eq('id', dealId).single()

  const updatePayload: any = { status: newStage, last_activity_at: new Date().toISOString() }
  if (newStage === 'won' || newStage === 'lost') {
    updatePayload.probability = newStage === 'won' ? 100 : 0
  }

  const { error } = await supabase
    .from('deals')
    .update(updatePayload)
    .eq('id', dealId)
    .eq('organization_id', orgId)
    
  if (error) {
    console.error('Error updating deal:', error)
    return { error: error.message }
  }

  await logActivity(supabase, orgId, 'updated_deal', `moved "${deal?.title || 'deal'}" to ${newStage}`, undefined, dealId)

  if (newStage === 'won') {
      const { data: adminUser } = await supabase.from('users').select('id').eq('role', 'admin').limit(1).single()
      if (adminUser) {
          const actor = await getMockableUser()
          await createNotification({
              user_id: adminUser.id,
              actor_id: actor?.id,
              type: 'deal_won',
              title: `Deal Won: ${deal?.title}`,
              content: `This deal was just marked as Won! Value: $${deal?.value || 0}`,
              link_url: '/deals'
          })
      }
  }

  
  revalidatePath('/deals')
  revalidatePath('/')

  // Trigger Automation: deal_won / stage_changed
  if (newStage.toLowerCase() === 'won') {
      executeAutomationFlows('deal_won', 'deal', dealId, { status: newStage }).catch(console.error)
  }
  executeAutomationFlows('stage_changed', 'deal', dealId, { status: newStage }).catch(console.error)

  return { success: true }
}

export async function updateDeal(dealId: string, fields: {
  title?: string
  value?: number
  notes?: string
  close_date?: string
  probability?: number
  assigned_to?: string | null
  status?: string
}) {
  const supabase = await createClient()
  const orgId = await getDefaultOrgId(supabase)
  if (!orgId) return { error: 'No organization found' }

  const { error } = await supabase
    .from('deals')
    .update({ ...fields, last_activity_at: new Date().toISOString() })
    .eq('id', dealId)
    .eq('organization_id', orgId)

  if (error) {
    console.error('Error updating deal fields:', error)
    return { error: error.message }
  }

  await logActivity(supabase, orgId, 'updated_deal', `updated deal details`, undefined, dealId)

  revalidatePath('/deals')
  revalidatePath('/')

  // Trigger Automation: field_updated / status_changed
  if (fields.status) {
      if (fields.status.toLowerCase() === 'won') {
          executeAutomationFlows('deal_won', 'deal', dealId, fields).catch(console.error)
      }
      executeAutomationFlows('stage_changed', 'deal', dealId, fields).catch(console.error)
  }

  return { success: true }
}

export async function deleteDeal(dealId: string) {
  const supabase = await createClient()
  const orgId = await getDefaultOrgId(supabase)
  if (!orgId) return { error: 'No organization found' }

  const { isAdmin, error: authError } = await requireAdmin(supabase)
  if (!isAdmin) return { error: authError || 'Unauthorized' }

  const { data: deal } = await supabase.from('deals').select('title').eq('id', dealId).single()

  const { error } = await supabase
    .from('deals')
    .delete()
    .eq('id', dealId)
    .eq('organization_id', orgId)

  if (error) {
    console.error('Error deleting deal:', error)
    return { error: error.message }
  }

  await logActivity(supabase, orgId, 'deleted_deal', `deleted deal: "${deal?.title || 'unknown'}"`)

  revalidatePath('/deals')
  revalidatePath('/')
  return { success: true }
}


export async function getTasks(leadId?: string, repId?: string) {
  const supabase = await createClient()
  const orgId = await getDefaultOrgId(supabase)
  if (!orgId) return []
  
  const user = await getMockableUser()
  let isAdmin = false

  if (user) {
      const { data: userData } = await supabase.from('users').select('role').eq('id', user.id).single()
      isAdmin = userData?.role === 'admin' || userData?.role === 'super_admin'
  }

  let query = supabase
    .from('tasks')
    .select('*, leads(id, name, owner_id), deals(title), users!tasks_assigned_to_fkey(id, full_name, role)')
    .eq('organization_id', orgId)
    .order('due_date', { ascending: true })
    
  if (leadId) {
    query = query.eq('lead_id', leadId)
  }

  // Role-based visibility logic
  if (!isAdmin && user) {
     const userId = user.id
     // Reps see tasks assigned to them, or unassigned team tasks
     query = query.or(`assigned_to.eq.${userId},assigned_to.is.null`)
  } else if (isAdmin && repId) {
     query = query.eq('assigned_to', repId)
  }

  const { data, error } = await query
    
  if (error) {
    console.error('Error fetching tasks:', error)
    return []
  }
  return data
}

export async function getOrgMembers() {
  const supabase = await createClient()
  const orgId = await getDefaultOrgId(supabase)
  if (!orgId) return []

  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, role')
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .order('full_name')

  if (error) {
    console.error('Error fetching members:', error)
    return []
  }
  return data
}

export async function addTask(formData: FormData) {
  const supabase = await createClient()
  const orgId = await getDefaultOrgId(supabase)
  
  if (!orgId) return { error: 'No organization found' }

  const leadId = formData.get('lead_id') as string;
  const dealId = formData.get('deal_id') as string;

  const data = {
    organization_id: orgId,
    title: formData.get('title') as string,
    description: formData.get('description') as string || '',
    status: 'pending',
    priority: formData.get('priority') as string || 'normal',
    due_date: formData.get('due_date') ? new Date(formData.get('due_date') as string).toISOString() : null,
    lead_id: leadId && leadId !== 'none' ? leadId : null,
    deal_id: dealId && dealId !== 'none' ? dealId : null,
    assigned_to: (formData.get('assigned_to') as string) || null,
  }

  const { error } = await supabase.from('tasks').insert(data)
  
  if (error) {
    console.error('Error adding task:', error)
    return { error: error.message }
  }

  if (data.assigned_to) {
      const actor = await getMockableUser()
      if (actor?.id !== data.assigned_to) {
          await createNotification({
              user_id: data.assigned_to,
              actor_id: actor?.id,
              type: 'task_reminder',
              title: `New Task Assigned`,
              content: `You were assigned a task: ${data.title}`,
              link_url: '/tasks'
          })
      }
  }

  revalidatePath('/tasks')
  revalidatePath('/')
  return { success: true }
}

export async function toggleTaskCompletion(taskId: string, isCompleted: boolean) {
  const supabase = await createClient()
  const orgId = await getDefaultOrgId(supabase)
  
  if (!orgId) return { error: 'No organization found' }

  const { error } = await supabase
    .from('tasks')
    .update({ status: isCompleted ? 'completed' : 'pending' })
    .eq('id', taskId)
    .eq('organization_id', orgId)
    
  if (error) {
    console.error('Error toggling task:', error)
    return { error: error.message }
  }

  revalidatePath('/tasks')
  revalidatePath('/')
  return { success: true }
}

export async function logActivity(supabase: any, orgId: string, action: string, details: string, leadId?: string, dealId?: string) {
  // Use a default user since we are bypassing Auth
  const userText = "A team member" 
  
  const { error } = await supabase.from('activity_logs').insert({
    organization_id: orgId,
    action,
    details: `${userText} ${details}`,
    lead_id: leadId || null,
    deal_id: dealId || null,
  })

  if (error) {
    console.error("Failed to log activity:", error)
  }
}

export async function getActivities(limit = 10, leadId?: string) {
  const supabase = await createClient()
  const orgId = await getDefaultOrgId(supabase)
  if (!orgId) return []

  let query = supabase
    .from('activity_logs')
    .select('id, action, details, created_at, leads(name), deals(title)')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (leadId) {
    query = query.eq('lead_id', leadId)
  }

  const { data, error } = await query
  
  if (error) {
    console.error('Error fetching activities:', error)
    return []
  }
  return data || []
}

export async function getGlobalActivities(params: {
  limit?: number
  offset?: number
  type?: string
  userId?: string
  search?: string
  dateFrom?: string
  dateTo?: string
  leadId?: string
  dealId?: string
} = {}) {
  const supabase = await createClient()
  const orgId = await getDefaultOrgId(supabase)
  if (!orgId) return { data: [], total: 0 }

  let query = supabase
    .from('activity_logs')
    .select('*, leads(name), deals(title), users(full_name, role)', { count: 'exact' })
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })

  if (params.limit) query = query.limit(params.limit)
  if (params.offset) query = query.range(params.offset, params.offset + (params.limit || 50) - 1)
  if (params.type && params.type !== 'all') query = query.eq('action', params.type)
  if (params.userId && params.userId !== 'all') query = query.eq('actor_id', params.userId)
  if (params.search) query = query.ilike('details', `%${params.search}%`)
  if (params.leadId && params.leadId !== 'all') query = query.eq('lead_id', params.leadId)
  if (params.dealId && params.dealId !== 'all') query = query.eq('deal_id', params.dealId)
  
  if (params.dateFrom) query = query.gte('created_at', params.dateFrom)
  if (params.dateTo) query = query.lte('created_at', params.dateTo)

  const { data, error, count } = await query

  if (error) {
    console.error('Error fetching global activities:', error)
    return { data: [], total: 0 }
  }

  // Normalize details (some might be objects from old bugs or specific actions)
  const normalizedData = (data || []).map(activity => {
    let details = activity.details
    if (details && typeof details === 'object') {
       if (activity.action === 'lead_forwarded') {
          const { lead_name, forwarded_to, note } = details as any
          details = `Forwarded "${lead_name || 'Lead'}" to ${forwarded_to || 'Unknown'}${note ? ` (Note: ${note})` : ''}`
       } else {
          details = JSON.stringify(details)
       }
    }
    return { ...activity, details: details || '' }
  })

  return { data: normalizedData, total: count || 0 }
}

export async function logLeadInteraction(leadId: string, type: string, content: string) {
  const supabase = await createClient()
  const orgId = await getDefaultOrgId(supabase)
  
  if (!orgId) return { error: 'No organization found' }

  await logActivity(supabase, orgId, type, content, leadId)
  
  const user = await getMockableUser()
  await logLeadEvent(supabase, orgId, {
      lead_id: leadId,
      event_type: 'interaction_logged',
      description: `Interaction logged: ${type.replace('_', ' ')}`,
      metadata: { type, content },
      performed_by: user?.id
  })

  revalidatePath(`/leads/${leadId}`)
  return { success: true }
}

export async function getAnalytics(days: number = 30) {
  const supabase = await createClient()
  const orgId = await getDefaultOrgId(supabase)
  if (!orgId) return null

  const cookieStore = await cookies()
  const isMockAuth = cookieStore.get('sb-mock-auth')?.value === 'true'
  let { data: { user } } = await supabase.auth.getUser()
  
  let isAdmin = false
  if (!user && isMockAuth) {
    isAdmin = true
  } else if (user) {
    const { data: userData } = await supabase.from('users').select('role').eq('id', user.id).single()
    isAdmin = userData?.role === 'admin' || userData?.role === 'super_admin'
  }

  const startDate = new Date()
  startDate.setDate(startDate.getDate() - days)
  const startDateStr = startDate.toISOString()

  let leadsQuery = supabase.from('leads').select('*').eq('organization_id', orgId)
  let dealsQuery = supabase.from('deals').select('*, leads!inner(name, contact_person, owner_id)').eq('organization_id', orgId)
  let tasksQuery = supabase.from('tasks').select('*').eq('organization_id', orgId)

  // Apply Role-based filtering
  if (!isAdmin && user) {
    leadsQuery = leadsQuery.or(`owner_id.eq.${user.id},owner_id.is.null`)
    dealsQuery = dealsQuery.or(`assigned_to.eq.${user.id},assigned_to.is.null,leads.owner_id.eq.${user.id}`)
    tasksQuery = tasksQuery.or(`assigned_to.eq.${user.id},assigned_to.is.null`)
  }

  const [leadsRes, dealsRes, tasksRes] = await Promise.all([
    leadsQuery,
    dealsQuery,
    tasksQuery
  ])

  const leads = leadsRes.data || []
  const deals = dealsRes.data || []
  const tasks = tasksRes.data || []

  // 1. Financials
  const wonDeals = deals.filter(d => d.status.toLowerCase() === 'won')
  const totalRevenue = wonDeals.reduce((sum, d) => sum + Number(d.value || 0), 0)
  const winRate = deals.length > 0 ? (wonDeals.length / deals.length) * 100 : 0
  const avgDealSize = wonDeals.length > 0 ? totalRevenue / wonDeals.length : 0

  // 2. Pipeline Snapshot (Deals by Stage)
  const pipelineStates = ['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost']
  const pipelineData = pipelineStates.map(state => ({
    name: state.charAt(0).toUpperCase() + state.slice(1),
    value: deals.filter(d => d.status.toLowerCase() === state).length
  }))

  // 3. Marketing Insights (Leads by Source)
  const sourceGroups = leads.reduce((acc: any, lead) => {
    const src = lead.source || 'Website'
    acc[src] = (acc[src] || 0) + 1
    return acc
  }, {})
  const leadsBySource = Object.entries(sourceGroups).map(([name, value]) => ({ name, value }))

  // 4. Operational Pulse
  const now = new Date()
  const operationalPulse = {
    completed: tasks.filter(t => t.status === 'completed').length,
    overdue: tasks.filter(t => t.status !== 'completed' && t.due_date && new Date(t.due_date) < now).length,
    pending: tasks.filter(t => t.status !== 'completed').length,
    followups: tasks.filter(t => t.lead_id).length
  }

  // 5. New Leads (Recent)
  const newLeadsCount = leads.filter(l => new Date(l.created_at) >= startDate).length

  return {
    financials: {
      totalRevenue,
      winRate: Math.round(winRate),
      avgDealSize: Math.round(avgDealSize),
      newLeadsCount
    },
    pipelineData,
    leadsBySource,
    operationalPulse,
    summary: {
      isStrong: winRate > 20,
      leadIncrease: 15, // Mocked for now
      bottlenecks: deals.filter(d => d.status.toLowerCase() === 'proposal').length
    }
  }
}

export async function getNotifications(limit = 10) {
  const supabase = await createClient()
  const orgId = await getDefaultOrgId(supabase)
  if (!orgId) return []

  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('Error fetching notifications:', error)
    return []
  }
  return data
}

export async function markNotificationRead(id: string) {
  const supabase = await createClient()
  const orgId = await getDefaultOrgId(supabase)
  if (!orgId) return { error: 'No org found' }

  await supabase.from('notifications').update({ is_read: true }).eq('id', id).eq('organization_id', orgId)
  revalidatePath('/notifications')
  return { success: true }
}

export async function getAttendance() {
  const supabase = await createClient()
  const orgId = await getDefaultOrgId(supabase)
  if (!orgId) return []

  const { data, error } = await supabase
    .from('attendance')
    .select('*')
    .eq('organization_id', orgId)
    .order('check_in_time', { ascending: false })
    .limit(10)

  if (error) {
    console.error('Error fetching attendance:', error)
    return []
  }
  return data
}

export async function clockIn() {
  const supabase = await createClient()
  const orgId = await getDefaultOrgId(supabase)
  if (!orgId) return { error: 'No org' }

  const { error } = await supabase.from('attendance').insert({
    organization_id: orgId,
    status: 'present'
  })

  if (error) {
    console.error('Error clocking in:', error)
    return { error: error.message }
  }
  revalidatePath('/attendance')
  return { success: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// FORWARDED LEADS
// ─────────────────────────────────────────────────────────────────────────────

export async function forwardLead(leadId: string, toUserId: string, note?: string) {
  const supabase = await createClient()
  const orgId = await getDefaultOrgId(supabase)
  if (!orgId) return { error: 'No organization found' }

  // Get the first user in org to use as "from" (fallback for mock auth)
  const { data: fromUser } = await supabase
    .from('users')
    .select('id, full_name')
    .eq('organization_id', orgId)
    .limit(1)
    .single()

  const { data: toUser } = await supabase
    .from('users')
    .select('full_name')
    .eq('id', toUserId)
    .single()

  const { data: lead } = await supabase
    .from('leads')
    .select('name')
    .eq('id', leadId)
    .single()

  const { error } = await supabase.from('forwarded_leads').insert({
    organization_id: orgId,
    lead_id: leadId,
    from_user_id: fromUser?.id || null,
    to_user_id: toUserId,
    status: 'sent',
    note: note || null,
  })

  if (error) {
    console.error('Error forwarding lead:', error)
    return { error: error.message }
  }

  // Log activity
  await supabase.from('activity_logs').insert({
    organization_id: orgId,
    user_id: fromUser?.id || null,
    lead_id: leadId,
    action: 'lead_forwarded',
    details: `Forwarded "${lead?.name || 'Lead'}" to ${toUser?.full_name || toUserId}${note ? ` (Note: ${note})` : ''}`,
  })
  
  await logLeadEvent(supabase, orgId, {
      lead_id: leadId,
      event_type: 'lead_forwarded',
      description: `Forwarded lead to ${toUser?.full_name || toUserId}.`,
      metadata: { to_user_id: toUserId, note },
      performed_by: fromUser?.id
  })

  // Create notification for recipient
  await createNotification({
    user_id: toUserId,
    actor_id: fromUser?.id,
    type: 'mentions', 
    title: 'New Lead Forwarded',
    content: `${fromUser?.full_name || 'A team member'} forwarded "${lead?.name}" to you.${note ? ` Note: ${note}` : ''}`,
    link_url: '/forwarded'
  })

  revalidatePath('/forwarded')
  revalidatePath('/leads')
  revalidatePath('/activity-log')
  revalidatePath('/notifications')
  return { success: true }
}

export async function getForwardedLeads() {
  const supabase = await createClient()
  const orgId = await getDefaultOrgId(supabase)
  if (!orgId) return { received: [], sent: [] }

  // Get the first user as "current user" for mock auth
  const { data: currentUser } = await supabase
    .from('users')
    .select('id, full_name, role')
    .eq('organization_id', orgId)
    .limit(1)
    .single()

  if (!currentUser) return { received: [], sent: [] }

  const [receivedRes, sentRes] = await Promise.all([
    // Leads forwarded TO me
    supabase
      .from('forwarded_leads')
      .select('*, leads(id, name, phone_number, status, temperature, location, contact_person), from_user:users!forwarded_leads_from_user_id_fkey(id, full_name, role)')
      .eq('organization_id', orgId)
      .eq('to_user_id', currentUser.id)
      .order('created_at', { ascending: false }),
    // Leads forwarded BY me
    supabase
      .from('forwarded_leads')
      .select('*, leads(id, name, phone_number, status, temperature, location, contact_person), to_user:users!forwarded_leads_to_user_id_fkey(id, full_name, role)')
      .eq('organization_id', orgId)
      .eq('from_user_id', currentUser.id)
      .order('created_at', { ascending: false }),
  ])

  return {
    received: receivedRes.data || [],
    sent: sentRes.data || [],
    currentUserId: currentUser.id,
  }
}

export async function updateForwardedLeadStatus(forwardId: string, status: 'accepted' | 'rejected') {
  const supabase = await createClient()
  const orgId = await getDefaultOrgId(supabase)
  if (!orgId) return { error: 'No org' }

  const { error } = await supabase
    .from('forwarded_leads')
    .update({ status })
    .eq('id', forwardId)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }

  revalidatePath('/forwarded')
  return { success: true }
}

export async function checkIn(location?: { lat: number, lng: number, address?: string }) {
  const supabase = await createClient()
  const orgId = await getDefaultOrgId(supabase)
  if (!orgId) return { error: 'No org' }

  const user = await getMockableUser()
  if (!user) return { error: 'No user' }

  const { error } = await supabase.from('attendance').insert({
    organization_id: orgId,
    user_id: user.id,
    check_in_time: new Date().toISOString(),
    status: 'present',
    location: location || null
  })

  if (error) return { error: error.message }
  
  revalidatePath('/attendance')
  return { success: true }
}

export async function checkOut() {
  const supabase = await createClient()
  const orgId = await getDefaultOrgId(supabase)
  if (!orgId) return { error: 'No org' }

  const user = await getMockableUser()
  if (!user) return { error: 'No user' }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const { error } = await supabase
    .from('attendance')
    .update({ check_out_time: new Date().toISOString() })
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .is('check_out_time', null)
    .gte('check_in_time', today.toISOString())

  if (error) return { error: error.message }
  
  revalidatePath('/attendance')
  return { success: true }
}

export async function getAttendanceStatus() {
  const supabase = await createClient()
  const orgId = await getDefaultOrgId(supabase)
  if (!orgId) return null

  const user = await getMockableUser()
  if (!user) return null

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const { data: att } = await supabase
    .from('attendance')
    .select('*')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .gte('check_in_time', today.toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: history } = await supabase
    .from('attendance')
    .select('*')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .limit(10)

  return { 
    current: att, 
    user: { id: user.id, full_name: user.full_name, role: user.role },
    history: history || []
  }
}

export async function getTeamPerformance() {
  const supabase = await createClient()
  const orgId = await getDefaultOrgId(supabase)
  if (!orgId) return null

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const [usersRes, attendanceRes, leadsRes, dealsRes, tasksRes] = await Promise.all([
    supabase.from('users').select('*').eq('organization_id', orgId).eq('is_active', true),
    supabase.from('attendance').select('*, users(full_name)').eq('organization_id', orgId).gte('check_in_time', today.toISOString()),
    supabase.from('leads').select('*').eq('organization_id', orgId).gte('created_at', today.toISOString()),
    supabase.from('deals').select('*').eq('organization_id', orgId).gte('updated_at', today.toISOString()),
    supabase.from('tasks').select('*').eq('organization_id', orgId).gte('updated_at', today.toISOString()).eq('status', 'completed')
  ])

  const users = usersRes.data || []
  const attendance = attendanceRes.data || []
  const leads = leadsRes.data || []
  const deals = dealsRes.data || []
  const tasks = tasksRes.data || []

  const teamData = users.map(user => {
    const userAtt = attendance.find(a => a.user_id === user.id)
    return {
      id: user.id,
      name: user.full_name,
      role: user.role,
      status: userAtt ? (userAtt.check_out_time ? 'Checked Out' : 'Online') : 'Offline',
      checkIn: userAtt?.check_in_time,
      checkOut: userAtt?.check_out_time,
      KPIs: {
        leads: leads.filter(l => l.owner_id === user.id).length,
        deals: deals.filter(d => d.status === 'won').length,
        tasks: tasks.filter(t => t.assigned_to === user.id).length
      }
    }
  })

  return teamData
}

export async function getFullAttendanceLogs() {
  const supabase = await createClient()
  const orgId = await getDefaultOrgId(supabase)
  if (!orgId) return []

  const { data, error } = await supabase
    .from('attendance')
    .select('*, users(full_name, role)')
    .eq('organization_id', orgId)
    .order('check_in_time', { ascending: false })
    .limit(100)

  if (error) {
    console.error('Error fetching full logs:', error)
    return []
  }

  return data || []
}

export async function getHistoricalAttendance(filter: 'weekly' | 'monthly' | 'yearly' | 'all' = 'all', userId?: string) {
  const supabase = await createClient()
  const orgId = await getDefaultOrgId(supabase)
  if (!orgId) return []

  let query = supabase
    .from('attendance')
    .select('*, users(full_name, role)')
    .eq('organization_id', orgId)
    .order('check_in_time', { ascending: false })

  if (userId && userId !== 'all') {
    query = query.eq('user_id', userId)
  }

  const now = new Date()
  if (filter === 'weekly') {
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    query = query.gte('check_in_time', weekAgo.toISOString())
  } else if (filter === 'monthly') {
    const monthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate())
    query = query.gte('check_in_time', monthAgo.toISOString())
  } else if (filter === 'yearly') {
    const yearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate())
    query = query.gte('check_in_time', yearAgo.toISOString())
  }

  const { data, error } = await query

  if (error) {
    console.error('Error fetching historical logs:', error)
    return []
  }

  return data || []
}

export async function getRepPerformanceData() {
  const supabase = await createClient()
  const orgId = await getDefaultOrgId(supabase)
  if (!orgId) return []

  const monthYear = new Date().toISOString().substring(0, 7) // 'YYYY-MM'

  // Fetch all members (active only), leads, deals, tasks and targets in parallel for efficiency
  const [membersRes, leadsRes, dealsRes, tasksRes, targetsRes] = await Promise.all([
    supabase.from('users').select('id, full_name, role').eq('organization_id', orgId).eq('is_active', true),
    supabase.from('leads').select('id, owner_id, status, created_at').eq('organization_id', orgId),
    supabase.from('deals').select('id, user_id, status, value').eq('organization_id', orgId),
    supabase.from('tasks').select('id, assigned_to, status, due_date').eq('organization_id', orgId),
    supabase.from('user_targets').select('*').eq('organization_id', orgId).eq('month_year', monthYear)
  ])

  if (membersRes.error) {
    console.error('Error fetching rep data:', membersRes.error)
    return []
  }

  const members = membersRes.data || []
  const allLeads = leadsRes.data || []
  const allDeals = dealsRes.data || []
  const allTasks = tasksRes.data || []
  const allTargets = targetsRes.data || []

  const now = new Date()
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000)

  return members.map(user => {
    const userLeads = allLeads.filter(l => l.owner_id === user.id)
    const userDeals = allDeals.filter(d => d.user_id === user.id)
    const userTasks = allTasks.filter(t => t.assigned_to === user.id)
    const userTarget = allTargets.find(t => t.user_id === user.id)

    const revenueWon = userDeals
      .filter(d => d.status === 'won')
      .reduce((sum, d) => sum + (Number(d.value) || 0), 0)

    const tasksCompleted = userTasks.filter(t => t.status === 'completed').length
    const tasksTotal = userTasks.length
    
    // Barrier Logic: Overdue tasks or leads with no activity (mocked by created_at for now)
    const overdueTasks = userTasks.filter(t => 
      t.status === 'pending' && t.due_date && new Date(t.due_date) < now
    ).length

    const staleLeads = userLeads.filter(l => 
      l.status !== 'converted' && new Date(l.created_at) < threeDaysAgo
    ).length

    return {
      id: user.id,
      name: user.full_name,
      role: user.role,
      leads: {
        total: userLeads.length,
        new: userLeads.filter(l => new Date(l.created_at) > new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)).length
      },
      workload: {
        activeDeals: userDeals.filter(d => d.status === 'open' || d.status === 'negotiation').length,
        pendingTasks: userTasks.filter(t => t.status === 'pending').length
      },
      performance: {
        revenue: revenueWon,
        conversionRate: userLeads.length > 0 ? (userDeals.filter(d => d.status === 'won').length / userLeads.length) * 100 : 0,
        taskCompletionRate: tasksTotal > 0 ? (tasksCompleted / tasksTotal) * 100 : 0
      },
      targets: {
        revenue: userTarget?.revenue_target || 0,
        leads: userTarget?.leads_target || 0,
        tasks: userTarget?.tasks_target || 0
      },
      barriers: {
        overdueTasks,
        staleLeads,
        count: overdueTasks + staleLeads
      }
    }
  })
}

export async function setUserTarget(userId: string, targets: { revenue: number, leads: number, tasks: number }) {
  const supabase = await createClient()
  const orgId = await getDefaultOrgId(supabase)
  if (!orgId) throw new Error('No organization found')

  const { isAdmin, error: authError } = await requireAdmin(supabase)
  if (!isAdmin) throw new Error(authError || 'Unauthorized')

  const monthYear = new Date().toISOString().substring(0, 7)

  const { error } = await supabase
    .from('user_targets')
    .upsert({
      organization_id: orgId,
      user_id: userId,
      month_year: monthYear,
      revenue_target: targets.revenue,
      leads_target: targets.leads,
      tasks_target: targets.tasks
    }, { onConflict: 'user_id,month_year' })

  if (error) throw error
  return true
}

export async function getOrganizationDetails() {
  const supabase = await createClient()
  const orgId = await getDefaultOrgId(supabase)
  if (!orgId) return null

  const { data, error } = await supabase
    .from('organizations')
    .select('*')
    .eq('id', orgId)
    .single()

  if (error) {
    console.error('Error fetching org details:', error)
    return null
  }

  return data
}

export async function updateOrganization(data: { name?: string, logo_url?: string, timezone?: string, currency?: string, branding?: any }) {
  const supabase = await createClient()
  const orgId = await getDefaultOrgId(supabase)
  if (!orgId) throw new Error('No organization found')

  const { isAdmin, error: authError } = await requireAdmin(supabase)
  if (!isAdmin) throw new Error(authError || 'Unauthorized')

  const { error } = await supabase
    .from('organizations')
    .update(data)
    .eq('id', orgId)

  if (error) throw error

  revalidatePath('/', 'layout')
  return true
}

export async function manageTeamMember(userId: string, data: { role?: string, active?: boolean }) {
  const supabase = await createClient()
  const orgId = await getDefaultOrgId(supabase)
  if (!orgId) throw new Error('No organization found')

  const { isAdmin, error: authError } = await requireAdmin(supabase)
  if (!isAdmin) throw new Error(authError || 'Unauthorized')

  const { error } = await supabase
    .from('users')
    .update(data)
    .eq('id', userId)
    .eq('organization_id', orgId)

  if (error) throw error
  return true
}

export async function getIntegrations() {
  const supabase = await createClient()
  const orgId = await getDefaultOrgId(supabase)
  if (!orgId) return []

  const { data, error } = await supabase
    .from('integrations')
    .select('*')
    .eq('organization_id', orgId)

  if (error) {
    console.error('Error fetching integrations:', error.message, error.details, error.hint)
    return []
  }

  return data || []
}

export async function saveIntegration(provider: string, config: any, isActive: boolean = true) {
  const supabase = await createClient()
  const orgId = await getDefaultOrgId(supabase)
  if (!orgId) throw new Error('No organization found')

  const { isAdmin, error: authError } = await requireAdmin(supabase)
  if (!isAdmin) throw new Error(authError || 'Unauthorized')

  const { error } = await supabase
    .from('integrations')
    .upsert({
      organization_id: orgId,
      provider,
      config,
      is_active: isActive,
      updated_at: new Date().toISOString()
    }, { onConflict: 'organization_id,provider' })

  if (error) throw error
  return true
}

export async function getCurrentUser() {
  const supabase = await createClient()
  if (!supabase) return null
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    const cookieStore = await cookies()
    if (cookieStore.get('sb-mock-auth')?.value === 'true') {
      // Mock auth: get any active user (admin or super admin) so dashboard always loads
      const { data } = await supabase.from('users').select('*').eq('is_active', true).limit(1).single()
      if (data) {
        const { data: roleData } = await supabase
            .from('organization_roles')
            .select('permissions')
            .eq('organization_id', data.organization_id)
            .eq('name', data.role)
            .single()
        return { ...data, permissions: roleData?.permissions || null }
      }
      const fallback = await supabase.from('users').select('*').limit(1).single()
      if (fallback.data) {
        const { data: roleData } = await supabase
            .from('organization_roles')
            .select('permissions')
            .eq('organization_id', fallback.data.organization_id)
            .eq('name', fallback.data.role)
            .single()
        return { ...fallback.data, permissions: roleData?.permissions || null }
      }
      return fallback.data
    }
    return null
  }

  let { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single()

  if (error) return null

  // For the current user, always keep full_name in sync with sign-in email
  // (derive from email prefix and update if we have an email).
  if (user.email) {
    try {
      const emailPrefix = user.email.split('@')[0] || ''
      const derivedName = emailPrefix
        .replace(/[._-]+/g, ' ')
        .split(' ')
        .filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ')

      if (derivedName) {
        const { data: updated, error: updateErr } = await supabase
          .from('users')
          .update({ full_name: derivedName })
          .eq('id', user.id)
          .select('*')
          .single()

        if (!updateErr && updated) {
          data = updated
        }
      }
    } catch (e) {
      console.error('Failed to derive full_name from email', e)
    }
  }

  const { data: roleData } = await supabase
    .from('organization_roles')
    .select('permissions')
    .eq('organization_id', data.organization_id)
    .eq('name', data.role)
    .single()

  return { ...data, email: user.email, permissions: roleData?.permissions || null }
}

export async function updateUserProfile(data: { 
  full_name?: string
  avatar_url?: string
  password?: string
  email?: string
  designation?: string
  phone?: string
  bio?: string
  department?: string
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  const profileUpdate = {
    full_name: data.full_name,
    avatar_url: data.avatar_url,
    designation: data.designation,
    phone: data.phone,
    bio: data.bio,
    department: data.department,
  }

  const userId = user?.id
  if (!userId) {
     const { data: mockUser } = await supabase.from('users').select('id').eq('role', 'admin').limit(1).single()
     if (mockUser) {
        await supabase.from('users').update(profileUpdate).eq('id', mockUser.id)
        return true
     }
     throw new Error('No user found')
  }

  const { error } = await supabase
    .from('users')
    .update(profileUpdate)
    .eq('id', userId)

  if (error) throw error

  if (data.password || data.email) {
    const updateData: any = {}
    if (data.password) updateData.password = data.password
    if (data.email) updateData.email = data.email
    
    const { error: authError } = await supabase.auth.updateUser(updateData)
    if (authError) throw authError
  }

  return true
}

export async function updateNotificationSettings(prefs: any) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  const userId = user?.id || (await supabase.from('users').select('id').eq('role', 'admin').limit(1).single()).data?.id
  if (!userId) throw new Error('No user found')

  const { error } = await supabase
    .from('users')
    .update({ notification_preferences: prefs })
    .eq('id', userId)

  if (error) throw error
  
  revalidatePath('/settings')
  revalidatePath('/')
  return true
}

export async function updateAppearanceSettings(settings: any) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  const userId = user?.id || (await supabase.from('users').select('id').eq('role', 'admin').limit(1).single()).data?.id
  if (!userId) throw new Error('No user found')

  const { error } = await supabase
    .from('users')
    .update({ appearance_settings: settings })
    .eq('id', userId)

  if (error) throw error
  return true
}

// ── Users & Roles Actions ────────────────────────────────────────────────────

export async function getUsersHubData() {
  const supabase = await createClient()
  const orgId = await getDefaultOrgId(supabase)
  if (!orgId) return { users: [], invites: [] }

  // 1. Get all users for the org
  const { data: usersData, error: usersErr } = await supabase
    .from('users')
    .select('id, full_name, role, is_active, created_at, avatar_url')
    .eq('organization_id', orgId)
    .eq('is_active', true) // only show active users in settings hub
    .order('full_name')

  if (usersErr) throw usersErr

  // Also load role definitions so we can align display names
  const { data: roleDefs } = await supabase
    .from('organization_roles')
    .select('name')
    .eq('organization_id', orgId)

  // Get active leads and deals count to calculate workload
  const { data: leadsData } = await supabase
    .from('leads')
    .select('owner_id')
    .eq('organization_id', orgId)

  const { data: dealsData } = await supabase
    .from('deals')
    .select('assigned_to')
    .eq('organization_id', orgId)

  const normalizeRole = (value: string | null) =>
    (value || '').toLowerCase().replace(/\s+/g, '_')

  const usersWithWorkload = usersData.map(u => {
    const activeLeads = leadsData?.filter(l => l.owner_id === u.id).length || 0
    const activeDeals = dealsData?.filter(d => d.assigned_to === u.id).length || 0

    const matchingRole = roleDefs?.find(r =>
      normalizeRole(r.name) === normalizeRole(u.role)
    )

    return {
      ...u,
      workload: activeLeads + activeDeals,
      role_display: matchingRole?.name || u.role
    }
  })

  // 2. Get pending invites
  const { data: invitesData, error: invitesErr } = await supabase
    .from('organization_invites')
    .select('*')
    .eq('organization_id', orgId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })

  if (invitesErr) throw invitesErr

  return {
    users: usersWithWorkload,
    invites: invitesData
  }
}

export async function inviteUser(formData: FormData) {
  const supabase = await createClient()
  const email = formData.get('email') as string
  const role = formData.get('role') as string

  const orgId = await getDefaultOrgId(supabase)
  if (!orgId) return { error: 'No organization found' }

  const { isAdmin, user, error: authError } = await requireAdmin(supabase)
  if (!isAdmin) return { error: authError || 'Only admins can invite users' }
  const currentUserId = user.id

  const { error } = await supabase
    .from('organization_invites')
    .insert({
      organization_id: orgId,
      email,
      role,
      invited_by: currentUserId
    })

  if (error) return { error: error.message }
  
  revalidatePath('/settings')
  return { success: true }
}

export async function revokeInvite(inviteId: string) {
  const supabase = await createClient()
  
  const { isAdmin, error: authError } = await requireAdmin(supabase)
  if (!isAdmin) return { error: authError || 'Unauthorized' }

  const { error } = await supabase
    .from('organization_invites')
    .update({ status: 'revoked' })
    .eq('id', inviteId)

  if (error) return { error: error.message }

  revalidatePath('/settings')
  revalidatePath('/reps')
  revalidatePath('/home')
  revalidatePath('/')
  return { success: true }
}

export async function updateUserRole(userId: string, newRole: string) {
  const supabase = await createClient()
  
  const { isAdmin, error: authError } = await requireAdmin(supabase)
  if (!isAdmin) return { error: authError || 'Only admins can change roles' }

  const { error } = await supabase
    .from('users')
    .update({ role: newRole })
    .eq('id', userId)

  if (error) return { error: error.message }

  revalidatePath('/settings')
  revalidatePath('/reps')
  revalidatePath('/home')
  revalidatePath('/')
  return { success: true }
}

export async function toggleUserSuspension(userId: string, suspend: boolean) {
  const supabase = await createClient()

  const { isAdmin, error: authError } = await requireAdmin(supabase)
  if (!isAdmin) return { error: authError || 'Unauthorized' }
  
  const { error } = await supabase
    .from('users')
    .update({ is_active: !suspend })
    .eq('id', userId)

  if (error) return { error: error.message }
  
  revalidatePath('/settings')
  revalidatePath('/reps')
  revalidatePath('/home')
  revalidatePath('/')
  return { success: true }
}

export async function removeUser(userId: string) {
  const supabase = await createClient()
  
  const { isAdmin, error: authError } = await requireAdmin(supabase)
  if (!isAdmin) return { error: authError || 'Unauthorized' }

  // Hard-deleting users breaks foreign key constraints (attendance, leads, tasks, etc.).
  // Instead, we soft-delete by marking the user as inactive so all history remains intact.
  const { error } = await supabase
    .from('users')
    .update({ is_active: false })
    .eq('id', userId)

  if (error) return { error: error.message }
  
  revalidatePath('/settings')
  revalidatePath('/reps')
  revalidatePath('/home')
  revalidatePath('/')
  return { success: true }
}

// ── Advanced Roles & Permissions ─────────────────────────────────────────────

export async function getRoles() {
  const supabase = await createClient()
  const orgId = await getDefaultOrgId(supabase)
  if (!orgId) return []

  const { data, error } = await supabase
    .from('organization_roles')
    .select('*')
    .eq('organization_id', orgId)
    .order('created_at')

  if (error) {
    console.error('getRoles Error:', error)
    return []
  }

  // Ensure 'admin' and 'user' exist, if not, create default
  if (!data || data.length === 0) {
      const defaultRoles = [
          { organization_id: orgId, name: 'Admin', is_system: true, description: 'Full access to all modules and settings.', permissions: { global: { manage_billing: true, manage_users: true }, leads: { view_all: true, create: true, edit: true, delete: true }, deals: { view_all: true, create: true, edit: true, delete: true, manage_stages: true }, tasks: { view_all: true, create: true, edit: true, delete: true } } },
          { organization_id: orgId, name: 'Sales Rep', is_system: true, description: 'Standard access for sales representatives.', permissions: { global: { manage_billing: false, manage_users: false }, leads: { view_all: false, create: true, edit: true, delete: false }, deals: { view_all: false, create: true, edit: true, delete: false, manage_stages: false }, tasks: { view_all: false, create: true, edit: true, delete: false } } }
      ]
      
      const { data: newRoles, error: insertErr } = await supabase
        .from('organization_roles')
        .insert(defaultRoles)
        .select()
        
      if(insertErr) {
          console.error("Failed to seed default roles", insertErr)
          return []
      }
      return newRoles || []
  }

  return data
}

export async function createRole(name: string, description: string) {
  const supabase = await createClient()
  const orgId = await getDefaultOrgId(supabase)
  if (!orgId) return { error: 'No organization found' }

  const { isAdmin, error: authError } = await requireAdmin(supabase)
  if (!isAdmin) return { error: authError || 'Unauthorized' }

  const defaultPermissions = {
      leads: { view_all: false, create: false, edit: false, delete: false },
      deals: { view_all: false, create: false, edit: false, delete: false, manage_stages: false },
      tasks: { view_all: false, create: false, edit: false, delete: false },
      global: { manage_users: false, manage_billing: false }
  }

  const { error } = await supabase
    .from('organization_roles')
    .insert({
      organization_id: orgId,
      name,
      description,
      permissions: defaultPermissions
    })

  if (error) return { error: error.message }
  
  revalidatePath('/settings')
  return { success: true }
}

export async function updateRolePermissions(roleId: string, permissions: any) {
  const supabase = await createClient()

  const { isAdmin, error: authError } = await requireAdmin(supabase)
  if (!isAdmin) return { error: authError || 'Unauthorized' }

  const { error } = await supabase
    .from('organization_roles')
    .update({ permissions })
    .eq('id', roleId)

  if (error) return { error: error.message }

  revalidatePath('/settings')
  revalidatePath('/reps')
  revalidatePath('/home')
  revalidatePath('/')
  return { success: true }
}

export async function deleteRole(roleId: string) {
  const supabase = await createClient()

  const { isAdmin, error: authError } = await requireAdmin(supabase)
  if (!isAdmin) return { error: authError || 'Unauthorized' }

  const { data: role, error: roleErr } = await supabase
    .from('organization_roles')
    .select('id, name, is_system')
    .eq('id', roleId)
    .single()

  if (roleErr || !role) {
    return { error: roleErr?.message || 'Role not found' }
  }

  if (role.is_system) {
    return { error: 'System roles cannot be deleted' }
  }

  const { data: usersUsingRole, error: usersErr } = await supabase
    .from('users')
    .select('id')
    .eq('role', role.name)
    .limit(1)

  if (usersErr) {
    return { error: usersErr.message }
  }

  if (usersUsingRole && usersUsingRole.length > 0) {
    return { error: 'This role is currently assigned to users. Change their roles before deleting.' }
  }

  const { error } = await supabase
    .from('organization_roles')
    .delete()
    .eq('id', roleId)

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/settings')
  return { success: true }
}


