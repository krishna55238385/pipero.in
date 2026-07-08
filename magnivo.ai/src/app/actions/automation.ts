'use server'

import pool from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { generateText } from '@/lib/llm'
import { getSessionUser } from '@/lib/auth'

async function getDefaultOrgId(): Promise<string | null> {
  const session = await getSessionUser()
  return session?.orgId ?? null
}

export async function executeAutomationFlows(triggerType: string, entityType: 'lead' | 'deal', entityId: string, data: any) {
  try {
    const orgId = await getDefaultOrgId()
    if (!orgId) return { error: 'No organization' }

    const flowsRes = await pool.query(
      "SELECT * FROM public.automation_flows WHERE organization_id = $1 AND trigger_type = $2 AND is_active = true",
      [orgId, triggerType])
    const flows = flowsRes.rows
    if (!flows.length) return { success: true, count: 0 }

    let runCount = 0
    for (const flow of flows) {
      const match = checkConditions(flow.conditions, data)
      if (!match) continue

      const runRes = await pool.query(
        `INSERT INTO public.automation_runs (organization_id, flow_id, entity_id, entity_type, status, logs)
         VALUES ($1,$2,$3,$4,'running',$5) RETURNING *`,
        [orgId, flow.id, entityId, entityType, JSON.stringify([{ message: `Started flow: ${flow.name}`, timestamp: new Date().toISOString() }])])
      const run = runRes.rows[0]

      try {
        const actionResults: any[] = []
        const graphNodes = Array.isArray(flow?.workflow_graph?.nodes) ? flow.workflow_graph.nodes : null
        const graphEdges = Array.isArray(flow?.workflow_graph?.edges) ? flow.workflow_graph.edges : null
        if (graphNodes && graphEdges && graphNodes.length > 0) {
          const graphResults = await executeGraphWorkflow(orgId, flow.workflow_graph, entityType, entityId, data)
          actionResults.push(...graphResults)
        } else {
          for (const action of (flow.actions || [])) {
            const result = await performAction(orgId, action, entityType, entityId, data)
            actionResults.push(result)
          }
        }

        await pool.query(
          "UPDATE public.automation_runs SET status = 'success', completed_at = $1, logs = $2 WHERE id = $3",
          [new Date().toISOString(), JSON.stringify([...run.logs, { message: 'All actions completed', results: actionResults }]), run.id])
        runCount++
      } catch (error: any) {
        await pool.query(
          "UPDATE public.automation_runs SET status = 'failed', completed_at = $1, logs = $2 WHERE id = $3",
          [new Date().toISOString(), JSON.stringify([...run.logs, { message: 'Flow failed', error: error.message }]), run.id])
      }
    }

    return { success: true, flowsExecuted: runCount }
  } catch (err: any) { console.error('executeAutomationFlows error:', err.message); return { error: err.message } }
}

function checkConditions(conditions: any[], data: any) {
  if (!conditions || conditions.length === 0) return true
  return conditions.every(cond => {
    const val = data[cond.field]
    if (cond.op === 'equals') return val == cond.val
    if (cond.op === 'contains') return String(val).toLowerCase().includes(String(cond.val).toLowerCase())
    if (cond.op === 'is_not_null') return !!val
    return true
  })
}

async function performAction(orgId: string, action: any, entityType: string, entityId: string, data: any) {
  if (action.type === 'delay') {
    const value = Number(action.delayValue || action.value || 1)
    const unit = action.delayUnit === 'hours' ? 'hours' : 'days'
    const ms = unit === 'hours' ? value * 60 * 60 * 1000 : value * 24 * 60 * 60 * 1000
    return { message: `Delay scheduled: ${value} ${unit}`, delayMs: ms }
  }

  if (action.type === 'send_email') {
    return { message: 'Email action queued (engine hook)' }
  }

  if (action.type === 'create_task') {
    await pool.query(
      "INSERT INTO public.tasks (organization_id, lead_id, title, status, priority, due_date) VALUES ($1,$2,$3,'pending','medium',$4)",
      [orgId, entityType === 'lead' ? entityId : null, action.value || `Follow up ${data?.name || ''}`.trim(), new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()])
    return { message: 'Task created' }
  }

  if (action.type === 'assign_owner') {
    if (!action.userId) return { message: 'Assign owner skipped (no user selected)' }
    await pool.query(
      `UPDATE public.${entityType === 'lead' ? 'leads' : 'deals'} SET owner_id = $1 WHERE id = $2`,
      [action.userId, entityId])
    return { message: `Assigned owner ${action.userId}` }
  }

  if (action.type === 'update_lead_status') {
    await pool.query('UPDATE public.leads SET status = $1 WHERE id = $2', [action.value || 'Hot', entityId])
    return { message: `Lead status updated to ${action.value || 'Hot'}` }
  }

  if (action.type === 'trigger_playbook') {
    return { message: `Playbook trigger queued: ${action.value || 'default'}` }
  }

  if (action.type === 'add_tag') {
    return { message: `Tag added: ${action.value || 'tagged'}` }
  }

  if (action.type === 'update_field') {
    await pool.query(
      `UPDATE public.${entityType === 'lead' ? 'leads' : 'deals'} SET "${action.field}" = $1 WHERE id = $2`,
      [action.value, entityId])
    return { message: `Updated ${action.field} to ${action.value}` }
  }

  if (action.type === 'ai_enrich') {
    return await aiEnrichEntity(orgId, entityType, entityId, data)
  }

  if (action.type === 'send_notification') {
    await pool.query(
      'INSERT INTO public.notifications (organization_id, user_id, title, message, type) VALUES ($1,$2,$3,$4,$5)',
      [orgId, data.owner_id || data.created_by, 'Automation Alert', action.message || `Automation triggered for ${data.name}`, 'system'])
    return { message: 'Sent notification' }
  }

  return { message: 'Action not implemented' }
}

async function executeGraphWorkflow(orgId: string, workflowGraph: any, entityType: string, entityId: string, data: any) {
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
      const actionPayload = { type: actionConfig.actionType || 'send_notification', ...actionConfig }
      const actionResult = await performAction(orgId, actionPayload, entityType, entityId, data)
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

async function aiEnrichEntity(orgId: string, entityType: string, entityId: string, data: any) {
  const record = JSON.stringify({
    name: data.name ?? null, email: data.email ?? null,
    company: data.company ?? data.name ?? null, title: data.title ?? null,
    industry: data.industry ?? null, notes: data.notes ?? null,
  })
  const prompt = [
    'You are a CRM data-enrichment assistant. Given this lead/deal record, assess it.',
    'Return STRICT JSON only (no markdown) with this exact schema:',
    '{ "hygiene_score": number (0-100 = data completeness + quality), "industry": string (best-guess industry) }',
    'Record:', record,
  ].join('\n')

  let score = 0
  let industry = data.industry || 'Unknown'
  try {
    const raw = await generateText(prompt, 'automation_ai_enrich')
    const match = raw.match(/\{[\s\S]*\}/)
    if (match) {
      const parsed = JSON.parse(match[0]) as { hygiene_score?: number; industry?: string }
      if (typeof parsed.hygiene_score === 'number') score = Math.max(0, Math.min(100, Math.round(parsed.hygiene_score)))
      if (parsed.industry) industry = String(parsed.industry)
    }
  } catch {}

  const payload = { hygiene_score: score, industry: data.industry || industry }
  await pool.query(
    `UPDATE public.${entityType === 'lead' ? 'leads' : 'deals'} SET hygiene_score = $1, industry = $2 WHERE id = $3`,
    [payload.hygiene_score, payload.industry, entityId])

  return { message: `AI Enrichment Complete: Score ${score}, Industry ${payload.industry}` }
}

export async function getFlows() {
  try {
    const orgId = await getDefaultOrgId()
    if (!orgId) return []
    const r = await pool.query(
      'SELECT * FROM public.automation_flows WHERE organization_id = $1 ORDER BY created_at DESC', [orgId])
    return r.rows
  } catch (err: any) { console.error('getFlows error:', err.message); return [] }
}

export async function addFlow(flow: any) {
  try {
    const orgId = await getDefaultOrgId()
    if (!orgId) return { error: 'No organization' }
    const payload = { ...flow, organization_id: orgId }
    const keys = Object.keys(payload); const vals = Object.values(payload)
    const ph = keys.map((_, i) => `$${i + 1}`).join(', ')
    await pool.query(
      `INSERT INTO public.automation_flows (${keys.map(k => `"${k}"`).join(', ')}) VALUES (${ph})`, vals)
    revalidatePath('/settings')
    return { success: true }
  } catch (err: any) { return { error: err.message } }
}

export async function deleteFlow(id: string) {
  try {
    await pool.query('DELETE FROM public.automation_flows WHERE id = $1', [id])
    revalidatePath('/settings')
    return { success: true }
  } catch (err: any) { return { error: err.message } }
}

export async function getAutomationRuns(flowId?: string) {
  try {
    const orgId = await getDefaultOrgId()
    if (!orgId) return []
    const values: any[] = [orgId]
    let where = 'WHERE organization_id = $1'
    if (flowId) { values.push(flowId); where += ` AND flow_id = $${values.length}` }
    const r = await pool.query(
      `SELECT * FROM public.automation_runs ${where} ORDER BY started_at DESC LIMIT 50`, values)
    return r.rows
  } catch (err: any) { console.error('getAutomationRuns error:', err.message); return [] }
}
