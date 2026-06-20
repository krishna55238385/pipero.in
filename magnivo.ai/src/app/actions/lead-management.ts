'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

async function getDefaultOrgId(supabase: any) {
    const { cookies } = await import('next/headers')
    const cookieStore = await cookies()
    const isMockAuth = cookieStore.get('sb-mock-auth')?.value === 'true'

    const { data: { user } } = await supabase.auth.getUser()
    
    if (user) {
        const { data: profile } = await supabase
            .from('users')
            .select('organization_id')
            .eq('id', user.id)
            .single()
        
        if (profile?.organization_id) return profile.organization_id
    }

    // Fallback for local dev / mock auth
    const { data: org } = await supabase.from('organizations').select('id').limit(1).single()
    return org?.id
}

/**
 * Helper to ensure the current user has admin/super_admin privileges.
 */
async function requireAdmin(supabase: any) {
    const { cookies } = await import('next/headers')
    const cookieStore = await cookies()
    const isMockAuth = cookieStore.get('sb-mock-auth')?.value === 'true'
    let { data: { user } } = await supabase.auth.getUser()

    if (!user && isMockAuth) {
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

export async function logLeadEvent(supabase: any, orgId: string, event: { lead_id?: string, event_type: string, description: string, metadata?: any, performed_by?: string }) {
    await supabase.from('lead_audit_logs').insert({
        organization_id: orgId,
        lead_id: event.lead_id,
        event_type: event.event_type,
        description: event.description,
        metadata: event.metadata || {},
        performed_by: event.performed_by
    })
}

// Lead Statuses
export async function getLeadStatuses() {
    const supabase = await createClient()
    const orgId = await getDefaultOrgId(supabase)
    if (!orgId) return []

    const { data, error } = await supabase
        .from('lead_statuses')
        .select('*')
        .eq('organization_id', orgId)
        .order('sort_order', { ascending: true })

    if (error) {
        console.error('Error fetching lead statuses:', error)
        return []
    }
    return data
}

export async function addLeadStatus(label: string, color: string) {
    const supabase = await createClient()
    const orgId = await getDefaultOrgId(supabase)
    if (!orgId) return { error: 'No organization found' }

    const { data: currentStatuses } = await supabase
        .from('lead_statuses')
        .select('sort_order')
        .eq('organization_id', orgId)
        .order('sort_order', { ascending: false })
        .limit(1)

    const nextOrder = (currentStatuses?.[0]?.sort_order ?? -1) + 1

    const { error } = await supabase
        .from('lead_statuses')
        .insert({
            organization_id: orgId,
            label,
            color,
            sort_order: nextOrder
        })

    if (error) return { error: error.message }
    revalidatePath('/settings')
    revalidatePath('/leads')
    return { success: true }
}

export async function deleteLeadStatus(id: string) {
    const supabase = await createClient()
    const orgId = await getDefaultOrgId(supabase)
    if (!orgId) return { error: 'No organization found' }

    const { isAdmin, error: authError } = await requireAdmin(supabase)
    if (!isAdmin) return { error: authError || 'Unauthorized' }

    const { error } = await supabase
        .from('lead_statuses')
        .delete()
        .eq('id', id)
        .eq('organization_id', orgId)

    if (error) return { error: error.message }
    revalidatePath('/settings')
    revalidatePath('/leads')
    return { success: true }
}

// Pipeline Stages
export async function getPipelineStages() {
    const supabase = await createClient()
    const orgId = await getDefaultOrgId(supabase)
    if (!orgId) return []

    const { data, error } = await supabase
        .from('pipeline_stages')
        .select('*')
        .eq('organization_id', orgId)
        .order('sort_order', { ascending: true })

    if (error) {
        console.error('Error fetching pipeline stages:', error)
        return []
    }
    return data
}

export async function addPipelineStage(label: string, probability: number) {
    const supabase = await createClient()
    const orgId = await getDefaultOrgId(supabase)
    if (!orgId) return { error: 'No organization found' }

    const { data: currentStages } = await supabase
        .from('pipeline_stages')
        .select('sort_order')
        .eq('organization_id', orgId)
        .order('sort_order', { ascending: false })
        .limit(1)

    const nextOrder = (currentStages?.[0]?.sort_order ?? -1) + 1

    const { error } = await supabase
        .from('pipeline_stages')
        .insert({
            organization_id: orgId,
            label,
            probability,
            sort_order: nextOrder
        })

    if (error) return { error: error.message }
    revalidatePath('/settings')
    revalidatePath('/deals')
    return { success: true }
}

export async function deletePipelineStage(id: string) {
    const supabase = await createClient()
    const orgId = await getDefaultOrgId(supabase)
    if (!orgId) return { error: 'No organization found' }

    const { isAdmin, error: authError } = await requireAdmin(supabase)
    if (!isAdmin) return { error: authError || 'Unauthorized' }

    const { error } = await supabase
        .from('pipeline_stages')
        .delete()
        .eq('id', id)
        .eq('organization_id', orgId)

    if (error) return { error: error.message }
    revalidatePath('/settings')
    revalidatePath('/deals')
    return { success: true }
}

// Routing & Hygiene Settings
export async function getLeadManagementSettings() {
    const supabase = await createClient()
    const orgId = await getDefaultOrgId(supabase)
    if (!orgId) return null

    const [routing, hygiene] = await Promise.all([
        supabase.from('lead_routing_settings').select('*').eq('organization_id', orgId).single(),
        supabase.from('lead_hygiene_settings').select('*').eq('organization_id', orgId).single()
    ])

    return {
        routing: routing.data || { assignment_mode: 'manual', load_balancing_enabled: false, untouched_reassignment_days: 3, untouched_reassignment_minutes: 60 },
        hygiene: hygiene.data || { duplicate_fields: [], merge_strategy: 'manual' }
    }
}

export async function updateLeadRoutingSettings(settings: any) {
    const supabase = await createClient()
    const orgId = await getDefaultOrgId(supabase)
    if (!orgId) return { error: 'No organization found' }

    const { error } = await supabase
        .from('lead_routing_settings')
        .upsert({
            organization_id: orgId,
            ...settings,
            updated_at: new Date().toISOString()
        }, { onConflict: 'organization_id' })

    if (error) return { error: error.message }
    revalidatePath('/settings')
    return { success: true }
}

export async function updateLeadHygieneSettings(settings: any) {
    const supabase = await createClient()
    const orgId = await getDefaultOrgId(supabase)
    if (!orgId) return { error: 'No organization found' }

    const { error } = await supabase
        .from('lead_hygiene_settings')
        .upsert({
            organization_id: orgId,
            ...settings,
            updated_at: new Date().toISOString()
        })

    if (error) return { error: error.message }
    revalidatePath('/settings')
    return { success: true }
}

export async function getLeadRoutingRules() {
    const supabase = await createClient()
    const orgId = await getDefaultOrgId(supabase)
    if (!orgId) return []

    const { data } = await supabase
        .from('lead_routing_rules')
        .select(`
            *,
            assign_to_user:users!lead_routing_rules_assign_to_user_id_fkey(full_name)
        `)
        .eq('organization_id', orgId)
        .order('priority', { ascending: true })

    return data || []
}

export async function addLeadRoutingRule(name: string, conditions: any[], assignTo: string, priority: number = 0) {
    const supabase = await createClient()
    const orgId = await getDefaultOrgId(supabase)
    if (!orgId) return { error: 'No organization found' }

    const { error } = await supabase
        .from('lead_routing_rules')
        .insert({
            organization_id: orgId,
            name,
            conditions,
            assign_to_user_id: assignTo,
            priority
        })

    if (error) return { error: error.message }
    revalidatePath('/settings')
    return { success: true }
}

export async function deleteLeadRoutingRule(id: string) {
    const supabase = await createClient()

    const { isAdmin, error: authError } = await requireAdmin(supabase)
    if (!isAdmin) return { error: authError || 'Unauthorized' }

    const { error } = await supabase
        .from('lead_routing_rules')
        .delete()
        .eq('id', id)

    if (error) return { error: error.message }
    revalidatePath('/settings')
    return { success: true }
}

// Logic: Deduplication
export async function findDuplicateLead(supabase: any, orgId: string, leadData: any) {
    const { data: hygiene } = await supabase
        .from('lead_hygiene_settings')
        .select('duplicate_fields, merge_strategy')
        .eq('organization_id', orgId)
        .single()

    if (!hygiene || !hygiene.duplicate_fields || hygiene.duplicate_fields.length === 0) return null

    // Build the query dynamically based on duplicate_fields
    let query = supabase.from('leads').select('id, name').eq('organization_id', orgId)

    const conditions = hygiene.duplicate_fields.map((field: string) => {
        const val = leadData[field]
        if (val) return `${field}.eq.${val}`
        return null
    }).filter(Boolean)

    if (conditions.length === 0) return null

    // For simplicity in this iteration, we look for EXACT matches on ANY of the fields (OR logic)
    const { data: duplicates } = await query.or(conditions.join(','))

    if (duplicates && duplicates.length > 0) {
        await logLeadEvent(supabase, orgId, {
            lead_id: duplicates[0].id,
            event_type: 'hygiene_duplicate_found',
            description: `Duplicate detected during creation of ${leadData.name}. Strategy: ${hygiene.merge_strategy}`,
            metadata: { duplicate_fields: hygiene.duplicate_fields, match: duplicates[0] }
        })
        return {
            duplicate: duplicates[0],
            strategy: hygiene.merge_strategy
        }
    }

    return null
}

// Duplicate Review Queue (orphan-backed: lead_duplicates)
export async function getLeadDuplicates() {
    const supabase = await createClient()
    const orgId = await getDefaultOrgId(supabase)
    if (!orgId) return []

    const { data, error } = await supabase
        .from('lead_duplicates')
        .select(`
            id,
            similarity_score,
            status,
            created_at,
            original_lead:leads!original_lead_id(id, name, email, phone_number, contact_person),
            duplicate_lead:leads!duplicate_lead_id(id, name, email, phone_number, contact_person)
        `)
        .eq('organization_id', orgId)
        .eq('status', 'pending')
        .order('similarity_score', { ascending: false })
        .order('created_at', { ascending: false })

    if (error) {
        console.error('Error fetching lead duplicates:', error)
        return []
    }
    return data || []
}

export async function dismissLeadDuplicate(id: string) {
    const supabase = await createClient()
    const orgId = await getDefaultOrgId(supabase)
    if (!orgId) return { error: 'No organization found' }

    const { error } = await supabase
        .from('lead_duplicates')
        .update({ status: 'rejected' })
        .eq('id', id)
        .eq('organization_id', orgId)

    if (error) return { error: error.message }

    await logLeadEvent(supabase, orgId, {
        event_type: 'hygiene_duplicate_dismissed',
        description: `Duplicate review entry dismissed (kept as separate leads)`,
        metadata: { duplicate_id: id }
    })

    revalidatePath('/leads')
    return { success: true }
}

// Logic: Lead Intelligence
export async function calculateLeadScore(data: any) {
    let score = 0
    
    // 1. Temperature (Max 40)
    const temp = (data.temperature || 'cold').toLowerCase()
    if (temp === 'hot') score += 40
    else if (temp === 'warm') score += 20
    else score += 5
    
    // 2. Value (Max 40)
    const value = parseFloat(data.lead_value || data.value || 0)
    if (value > 10000) score += 40
    else if (value > 5000) score += 30
    else if (value > 1000) score += 15
    else if (value > 0) score += 5
    
    // 3. Completeness (Max 20)
    if (data.phone_number) score += 10
    if (data.contact_person || data.name) score += 10
    
    return Math.min(score, 100)
}

// Logic: Lead Routing
export async function getAssignedOwner(supabase: any, orgId: string, leadData: any) {
    const { data: settings } = await supabase
        .from('lead_routing_settings')
        .select('*')
        .eq('organization_id', orgId)
        .single()

    if (!settings) return null

    // 1. Rule-based Routing (Geo, Industry, Source, etc.)
    if (settings.assignment_mode === 'rule_based') {
        const { data: rules } = await supabase
            .from('lead_routing_rules')
            .select('*')
            .eq('organization_id', orgId)
            .eq('is_active', true)
            .order('priority', { ascending: true })

        for (const rule of rules || []) {
            if (evaluateConditions(rule.conditions, leadData)) {
                // Check if assignee is available and under capacity
                const { data: user } = await supabase.from('users').select('availability_status').eq('id', rule.assign_to_user_id).single()
                if (user?.availability_status !== false) {
                     return rule.assign_to_user_id
                }
            }
        }
    }

    // Fetch all active/available team members
    const { data: members } = await supabase
        .from('users')
        .select('id, lead_weight, availability_status')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .eq('availability_status', true)
        .order('created_at', { ascending: true })

    if (!members || members.length === 0) return settings.fallback_user_id

    // 2. Load-Based (Capacity-Aware Routing)
    if (settings.assignment_mode === 'load_based' || settings.load_balancing_enabled) {
        // Find member with fewest active items (Leads + Deals)
        let bestMember = null
        let minLoad = Infinity

        for (const member of members) {
            const [{ count: leadCount }, { count: dealCount }] = await Promise.all([
                supabase.from('leads').select('*', { count: 'exact', head: true }).eq('owner_id', member.id).not('status', 'in', '("Won","Lost")'),
                supabase.from('deals').select('*', { count: 'exact', head: true }).eq('owner_id', member.id).not('stage', 'in', '("Won","Lost")')
            ])
            
            const totalLoad = (leadCount || 0) + (dealCount || 0)
            if (totalLoad < minLoad && totalLoad < (settings.max_leads_per_user || 20)) {
                minLoad = totalLoad
                bestMember = member.id
            }
        }
        if (bestMember) return bestMember
    }

    // 3. Weighted Distribution
    if (settings.assignment_mode === 'weighted') {
        const totalWeight = members.reduce((sum: number, m: any) => sum + (m.lead_weight || 100), 0)
        let random = Math.random() * totalWeight
        for (const member of members) {
            random -= (member.lead_weight || 100)
            if (random <= 0) return member.id
        }
    }

    // 4. Default: Round-Robin
    const { data: lastLead } = await supabase
        .from('leads')
        .select('owner_id')
        .eq('organization_id', orgId)
        .not('owner_id', 'is', null)
        .order('created_at', { descending: true })
        .limit(1)
        .single()

    const lastIdx = members.findIndex((m: any) => m.id === lastLead?.owner_id)
    const nextIdx = (lastIdx + 1) % members.length
    const finalOwner = members[nextIdx].id

    await logLeadEvent(supabase, orgId, {
        event_type: 'lead_assigned',
        description: `Lead assigned via ${settings.assignment_mode}`,
        metadata: { mode: settings.assignment_mode, assigned_to: finalOwner }
    })

    return finalOwner
}

function evaluateConditions(conditions: any[], data: any) {
    if (!conditions || conditions.length === 0) return false
    
    // Simple evaluator: all conditions must match (AND logic)
    return conditions.every(cond => {
        const fieldVal = data[cond.field] || ''
        const targetVal = cond.val
        
        switch (cond.op) {
            case 'equals': return String(fieldVal).toLowerCase() == String(targetVal).toLowerCase()
            case 'contains': return String(fieldVal).toLowerCase().includes(String(targetVal).toLowerCase())
            case 'greater_than': return Number(fieldVal) > Number(targetVal)
            case 'starts_with': return String(fieldVal).toLowerCase().startsWith(String(targetVal).toLowerCase())
            case 'in_list': return String(targetVal).split(',').map(s => s.trim().toLowerCase()).includes(String(fieldVal).toLowerCase())
            default: return false
        }
    })
}

export async function auditLeadsSLA() {
    const supabase = await createClient()
    const orgId = await getDefaultOrgId(supabase)
    if (!orgId) return { error: 'No organization found' }

    // Fetch settings for threshold
    const { data: settings } = await supabase
        .from('lead_routing_settings')
        .select('untouched_reassignment_days, untouched_reassignment_minutes, fallback_user_id')
        .eq('organization_id', orgId)
        .single()
    
    // Priority to minutes if specifically requested by user in future? 
    // For now, let's use whichever provides the stricter (shorter) threshold if both set, or just minutes if non-zero.
    const thresholdMinutes = settings?.untouched_reassignment_minutes || (settings?.untouched_reassignment_days || 3) * 1440
    const cutoff = new Date(Date.now() - thresholdMinutes * 60 * 1000).toISOString()

    // Find leads matching SLA breach: Not Won/Lost, Created before cutoff, No last_contacted_at
    const { data: breachingLeads } = await supabase
        .from('leads')
        .select('id, name, owner_id')
        .eq('organization_id', orgId)
        .is('last_contacted_at', null)
        .lt('created_at', cutoff)
        .not('status', 'in', '("Won","Lost")')

    if (!breachingLeads || breachingLeads.length === 0) return { success: true, count: 0 }

    // For each breach, re-assign using Round-Robin (to skip the current owner)
    let reassignedCount = 0
    for (const lead of breachingLeads) {
        const newOwnerId = await getAssignedOwner(supabase, orgId, lead)
        if (newOwnerId && newOwnerId !== lead.owner_id) {
            await supabase.from('leads').update({ owner_id: newOwnerId }).eq('id', lead.id)
            reassignedCount++
        }
    }

    revalidatePath('/leads')
    return { success: true, count: reassignedCount }
}

export async function updateUserRoutingSettings(userId: string, data: { lead_weight?: number, availability_status?: boolean, skills?: string[] }) {
    const supabase = await createClient()
    const { error } = await supabase.from('users').update(data).eq('id', userId)
    if (error) return { error: error.message }
    return { success: true }
}

export async function getLeadAuditLogs(filters?: { 
    event_type?: string, 
    user_id?: string, 
    start_date?: string, 
    end_date?: string 
}) {
    const supabase = await createClient()
    const orgId = await getDefaultOrgId(supabase)
    if (!orgId) return []

    let query = supabase
        .from('lead_audit_logs')
        .select('*')
        .eq('organization_id', orgId)

    if (filters?.event_type && filters.event_type !== 'all') {
        query = query.eq('event_type', filters.event_type)
    }
    if (filters?.user_id && filters.user_id !== 'all') {
        // user_id in logs is target_user_id usually
        query = query.eq('target_user_id', filters.user_id)
    }
    if (filters?.start_date) {
        query = query.gte('created_at', filters.start_date)
    }
    if (filters?.end_date) {
        query = query.lte('created_at', filters.end_date)
    }

    const { data } = await query
        .order('created_at', { ascending: false })
        .limit(200)

    return data || []
}

export async function getLeadAssignmentStats() {
    const supabase = await createClient()
    const orgId = await getDefaultOrgId(supabase)
    if (!orgId) return null

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const [todayTotal, byUser] = await Promise.all([
        supabase.from('leads').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).gte('created_at', today.toISOString()),
        supabase.rpc('get_lead_stats_by_user', { org_id: orgId }) // If we had an RPC, otherwise we fetch and reduce
    ])
    
    // For now simple fetch of all leads today
    const { data: leadsToday } = await supabase.from('leads').select('owner_id, source').eq('organization_id', orgId).gte('created_at', today.toISOString())
    
    return {
        todayTotal: todayTotal.count,
        leadsToday
    }
}
