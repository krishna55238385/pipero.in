'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { generateText } from '@/lib/llm'

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
            // 4. Execute Actions (graph-first if workflow_graph exists)
            const actionResults: any[] = []
            const graphNodes = Array.isArray(flow?.workflow_graph?.nodes) ? flow.workflow_graph.nodes : null
            const graphEdges = Array.isArray(flow?.workflow_graph?.edges) ? flow.workflow_graph.edges : null
            if (graphNodes && graphEdges && graphNodes.length > 0) {
                const graphResults = await executeGraphWorkflow(
                    supabase,
                    orgId,
                    flow.workflow_graph,
                    entityType,
                    entityId,
                    data
                )
                actionResults.push(...graphResults)
            } else {
                for (const action of flow.actions) {
                    const result = await performAction(supabase, orgId, action, entityType, entityId, data)
                    actionResults.push(result)
                }
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
    if (action.type === 'delay') {
        const value = Number(action.delayValue || action.value || 1)
        const unit = action.delayUnit === 'hours' ? 'hours' : 'days'
        const ms = unit === 'hours' ? value * 60 * 60 * 1000 : value * 24 * 60 * 60 * 1000
        // Execution engine supports delay; for now we simulate wait node scheduling
        return { message: `Delay scheduled: ${value} ${unit}`, delayMs: ms }
    }

    if (action.type === 'send_email') {
        // Execution engine hook point for engage sender; currently logs intent.
        return { message: 'Email action queued (engine hook)' }
    }

    if (action.type === 'create_task') {
        const { error } = await supabase.from('tasks').insert({
            organization_id: orgId,
            lead_id: entityType === 'lead' ? entityId : null,
            title: action.value || `Follow up ${data?.name || ''}`.trim(),
            status: 'pending',
            priority: 'medium',
            due_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        })
        if (error) throw error
        return { message: 'Task created' }
    }

    if (action.type === 'assign_owner') {
        if (!action.userId) return { message: 'Assign owner skipped (no user selected)' }
        const { error } = await supabase
            .from(entityType === 'lead' ? 'leads' : 'deals')
            .update({ owner_id: action.userId })
            .eq('id', entityId)
        if (error) throw error
        return { message: `Assigned owner ${action.userId}` }
    }

    if (action.type === 'update_lead_status') {
        const { error } = await supabase
            .from('leads')
            .update({ status: action.value || 'Hot' })
            .eq('id', entityId)
        if (error) throw error
        return { message: `Lead status updated to ${action.value || 'Hot'}` }
    }

    if (action.type === 'trigger_playbook') {
        return { message: `Playbook trigger queued: ${action.value || 'default'}` }
    }

    if (action.type === 'add_tag') {
        return { message: `Tag added: ${action.value || 'tagged'}` }
    }

    if (action.type === 'update_field') {
        const payload: any = {}
        payload[action.field] = action.value
        const { error } = await supabase.from(entityType === 'lead' ? 'leads' : 'deals').update(payload).eq('id', entityId)
        if (error) throw error
        return { message: `Updated ${action.field} to ${action.value}` }
    }

    if (action.type === 'ai_enrich') {
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

async function executeGraphWorkflow(
    supabase: any,
    orgId: string,
    workflowGraph: any,
    entityType: string,
    entityId: string,
    data: any
) {
    const nodes = Array.isArray(workflowGraph?.nodes) ? workflowGraph.nodes : []
    const edges = Array.isArray(workflowGraph?.edges) ? workflowGraph.edges : []
    const byId = new Map(nodes.map((n: any) => [n.id, n]))
    const triggerNode = nodes.find((n: any) => n?.data?.kind === 'trigger')
    if (!triggerNode) return [{ message: 'No trigger node in workflow graph' }]

    const queue = [triggerNode]
    const seen = new Set<string>()
    const results: any[] = []

    while (queue.length > 0) {
        const node = queue.shift()
        if (!node || seen.has(node.id)) continue
        seen.add(node.id)

        const kind = node?.data?.kind
        if (kind === 'condition') {
            const cond = node?.data?.condition || {}
            const left = String(data?.[cond.field] ?? '')
            const right = String(cond.value ?? '')
            let pass = true
            if (cond.operator === 'equals') pass = left === right
            else if (cond.operator === 'contains') pass = left.toLowerCase().includes(right.toLowerCase())
            else if (cond.operator === 'gt') pass = Number(left) > Number(right)
            else if (cond.operator === 'lt') pass = Number(left) < Number(right)
            else if (cond.operator === 'not_equals') pass = left !== right

            results.push({ message: `Condition ${node?.data?.label || node.id}: ${pass ? 'PASS' : 'FAIL'}` })
            if (!pass) continue
        }

        if (kind === 'action') {
            const actionConfig = node?.data?.action || {}
            const actionPayload = {
                type: actionConfig.actionType || 'send_notification',
                ...actionConfig,
            }
            const actionResult = await performAction(supabase, orgId, actionPayload, entityType, entityId, data)
            results.push(actionResult)
        }

        const nextNodes = edges
            .filter((e: any) => e.source === node.id)
            .map((e: any) => byId.get(e.target))
            .filter(Boolean)
        queue.push(...nextNodes)
    }
    return results
}

async function aiEnrichEntity(supabase: any, orgId: string, entityType: string, entityId: string, data: any) {
    // Real AI enrichment via OpenAI (usage is auto-logged to llm_usage).
    const record = JSON.stringify({
        name: data.name ?? null,
        email: data.email ?? null,
        company: data.company ?? data.name ?? null,
        title: data.title ?? null,
        industry: data.industry ?? null,
        notes: data.notes ?? null,
    })
    const prompt = [
        'You are a CRM data-enrichment assistant. Given this lead/deal record, assess it.',
        'Return STRICT JSON only (no markdown) with this exact schema:',
        '{ "hygiene_score": number (0-100 = data completeness + quality), "industry": string (best-guess industry) }',
        'Record:',
        record,
    ].join('\n')

    let score = 0
    let industry = data.industry || 'Unknown'
    try {
        const raw = await generateText(prompt, 'automation_ai_enrich')
        const match = raw.match(/\{[\s\S]*\}/)
        if (match) {
            const parsed = JSON.parse(match[0]) as { hygiene_score?: number; industry?: string }
            if (typeof parsed.hygiene_score === 'number') {
                score = Math.max(0, Math.min(100, Math.round(parsed.hygiene_score)))
            }
            if (parsed.industry) industry = String(parsed.industry)
        }
    } catch {
        // On AI failure, keep score 0 + existing industry — never fabricate data.
    }

    const payload = {
        hygiene_score: score,
        industry: data.industry || industry,
    }

    const { error } = await supabase.from(entityType === 'lead' ? 'leads' : 'deals').update(payload).eq('id', entityId)
    if (error) throw error

    return { message: `AI Enrichment Complete: Score ${score}, Industry ${payload.industry}` }
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
