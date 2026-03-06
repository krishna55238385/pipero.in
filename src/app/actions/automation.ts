'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

// Internal Helper for Org ID
async function getOrgId(supabase: any) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null
    const { data: profile } = await supabase.from('users').select('organization_id').eq('id', user.id).single()
    return profile?.organization_id
}

/**
 * Core Automation Engine
 * This function is called whenever a triggerable event occurs (Lead Created, etc.)
 */
export async function executeAutomationFlows(triggerType: string, entityType: 'lead' | 'deal', entityId: string, data: any) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'Not authenticated' }

    const { data: profile } = await supabase.from('users').select('organization_id').eq('id', user.id).single()
    const orgId = profile?.organization_id
    if (!orgId) return { error: 'No organization' }

    // 1. Fetch active flows for this trigger
    const { data: flows } = await supabase
        .from('automation_flows')
        .select('*')
        .eq('organization_id', orgId)
        .eq('trigger_type', triggerType)
        .eq('is_active', true)

    if (!flows || flows.length === 0) return { success: true, count: 0 }

    let runCount = 0

    for (const flow of flows) {
        // 2. Check Conditions (JSON filtering)
        const match = checkConditions(flow.conditions, data)
        if (!match) continue

        // 3. Create Automation Run Log
        const { data: run } = await supabase
            .from('automation_runs')
            .insert({
                organization_id: orgId,
                flow_id: flow.id,
                entity_id: entityId,
                entity_type: entityType,
                status: 'running',
                logs: [{ message: `Started flow: ${flow.name}`, timestamp: new Date().toISOString() }]
            })
            .select()
            .single()

        try {
            // 4. Execute Actions
            const actionResults: any[] = []
            for (const action of flow.actions) {
                const result = await performAction(supabase, orgId, action, entityType, entityId, data)
                actionResults.push(result)
            }

            // 5. Update Run Log to Success
            await supabase.from('automation_runs')
                .update({ 
                    status: 'success', 
                    completed_at: new Date().toISOString(),
                    logs: [...run.logs, { message: 'All actions completed', results: actionResults }]
                })
                .eq('id', run.id)

            runCount++
        } catch (error: any) {
            // 6. Update Run Log to Failed
            await supabase.from('automation_runs')
                .update({ 
                    status: 'failed', 
                    completed_at: new Date().toISOString(),
                    logs: [...run.logs, { message: 'Flow failed', error: error.message }]
                })
                .eq('id', run.id)
        }
    }

    return { success: true, flowsExecuted: runCount }
}

function checkConditions(conditions: any[], data: any) {
    if (!conditions || conditions.length === 0) return true
    
    // Simple AND logic for conditions
    return conditions.every(cond => {
        const val = data[cond.field]
        if (cond.op === 'equals') return val == cond.val
        if (cond.op === 'contains') return String(val).toLowerCase().includes(String(cond.val).toLowerCase())
        if (cond.op === 'is_not_null') return !!val
        return true
    })
}

async function performAction(supabase: any, orgId: string, action: any, entityType: string, entityId: string, data: any) {
    if (action.type === 'update_field') {
        const payload: any = {}
        payload[action.field] = action.value
        const { error } = await supabase.from(entityType === 'lead' ? 'leads' : 'deals').update(payload).eq('id', entityId)
        if (error) throw error
        return { message: `Updated ${action.field} to ${action.value}` }
    }

    if (action.type === 'ai_enrich') {
        // AI Enrichment Logic (Mock for now, can integrate Gemini later)
        return await aiEnrichEntity(supabase, orgId, entityType, entityId, data)
    }

    if (action.type === 'send_notification') {
        // Send internal notification
        await supabase.from('notifications').insert({
            organization_id: orgId,
            user_id: data.owner_id || data.created_by,
            title: 'Automation Alert',
            message: action.message || `Automation triggered for ${data.name}`,
            type: 'system'
        })
        return { message: 'Sent notification' }
    }

    return { message: 'Action not implemented' }
}

async function aiEnrichEntity(supabase: any, orgId: string, entityType: string, entityId: string, data: any) {
    // This is where we would call an AI model
    // For now, let's simulate a "Score" and "Industry Prediction"
    const score = Math.floor(Math.random() * 100)
    const industry = (data.email?.includes('.edu')) ? 'Education' : (data.email?.includes('.org')) ? 'Non-Profit' : 'Enterprise'
    
    const payload = {
        hygiene_score: score,
        industry: data.industry || industry
    }
    
    const { error } = await supabase.from(entityType === 'lead' ? 'leads' : 'deals').update(payload).eq('id', entityId)
    if (error) throw error
    
    return { message: `AI Enrichment Complete: Score ${score}, Industry ${industry}` }
}

// Management Actions for the UI
export async function getFlows() {
    const supabase = await createClient()
    const orgId = await getOrgId(supabase)
    if (!orgId) return []
    const { data } = await supabase.from('automation_flows').select('*').eq('organization_id', orgId).order('created_at', { ascending: false })
    return data || []
}

export async function addFlow(flow: any) {
    const supabase = await createClient()
    const orgId = await getOrgId(supabase)
    if (!orgId) return { error: 'No organization' }
    const { error } = await supabase.from('automation_flows').insert({ ...flow, organization_id: orgId })
    if (error) return { error: error.message }
    revalidatePath('/settings')
    return { success: true }
}

export async function deleteFlow(id: string) {
    const supabase = await createClient()
    const { error } = await supabase.from('automation_flows').delete().eq('id', id)
    if (error) return { error: error.message }
    revalidatePath('/settings')
    return { success: true }
}

export async function getAutomationRuns(flowId?: string) {
    const supabase = await createClient()
    const orgId = await getOrgId(supabase)
    if (!orgId) return []
    let query = supabase.from('automation_runs').select('*').eq('organization_id', orgId).order('started_at', { ascending: false }).limit(50)
    if (flowId) query = query.eq('flow_id', flowId)
    const { data } = await query
    return data || []
}
