'use server'

/**
 * Dialer data access — reads/writes the `call_logs` table and the dialer lead
 * list (from the GTM `leads_raw` prospect table). Everything is scoped to the
 * CRM's organization. RLS is disabled in this project, so org isolation is
 * enforced here in the server-action layer (same convention as crm.ts / gtm.ts).
 */

import pool from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import type { CallLog, DialerCallSummary } from '@/components/dialer/storage'
import type { DialerLead } from '@/components/dialer/types'

async function getDefaultOrgId(): Promise<string | undefined> {
  const session = await getSessionUser()
  return session?.orgId ?? undefined
}

// --------------------------------------------------------------------------- //
// Row → client-shape mapping
// --------------------------------------------------------------------------- //
function mapRow(r: any): CallLog {
  const outcome = (r.status ?? 'no_answer') as CallLog['outcome']
  return {
    id: String(r.id),
    leadId: r.lead_ref ?? null,
    leadName: r.lead_name ?? 'Unknown',
    company: r.company ?? '-',
    phone: r.phone ?? '',
    direction: (r.direction ?? 'outbound') as CallLog['direction'],
    startedAt: r.started_at ?? r.created_at ?? new Date().toISOString(),
    endedAt: r.ended_at ?? r.started_at ?? r.created_at ?? new Date().toISOString(),
    durationSeconds: typeof r.duration_seconds === 'number' ? r.duration_seconds : 0,
    outcome,
    hasRecording: Boolean(r.recording_url),
    recordingUrl: r.recording_url ?? null,
    notes: r.notes ?? undefined,
    transcript: r.transcript ?? undefined,
    summary: (r.ai_summary as DialerCallSummary | null) ?? undefined,
    ai_generated_at: r.ai_generated_at ?? undefined,
    tags: Array.isArray(r.tags) ? r.tags : undefined,
    scorecard: (r.scorecard as CallLog['scorecard']) ?? undefined,
  }
}

// --------------------------------------------------------------------------- //
// Leads for the dialer lead-selection list (GTM prospects)
// --------------------------------------------------------------------------- //
export async function listLeadsForDialer(): Promise<{ leads: DialerLead[] }> {
  try {
    const org = await getDefaultOrgId()
    if (!org) return { leads: [] }

    const r = await pool.query(
      'SELECT id, contact_name, company_name, contact_title, company_phone, score_tier, icp_score FROM public.leads_raw WHERE organization_id = $1 ORDER BY icp_score DESC NULLS LAST LIMIT 100',
      [org])

    if (!r.rows.length) return { leads: [] }

    const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
    const toTemperature = (tier: string | null): DialerLead['status'] => {
      const t = (tier || '').toLowerCase()
      if (t === 'hot') return 'Hot'
      if (t === 'warm') return 'Warm'
      return 'Cold'
    }

    return {
      leads: r.rows.map((row: any) => ({
        id: String(row.id),
        name: row.contact_name || row.company_name || 'Unknown',
        company: row.company_name || '-',
        phone: row.company_phone || '',
        status: toTemperature(row.score_tier),
        title: row.contact_title || titleCase(row.score_tier || ''),
      })),
    }
  } catch (err: any) { console.error('listLeadsForDialer error:', err.message); return { leads: [] } }
}

// --------------------------------------------------------------------------- //
// Call logs
// --------------------------------------------------------------------------- //
export async function listCallLogs(): Promise<CallLog[]> {
  try {
    const org = await getDefaultOrgId()
    if (!org) return []

    const r = await pool.query(
      'SELECT * FROM public.call_logs WHERE organization_id = $1 ORDER BY started_at DESC NULLS LAST', [org])
    return r.rows.map(mapRow)
  } catch (err: any) { console.error('listCallLogs error:', err.message); return [] }
}

export async function getCallLog(id: string): Promise<CallLog | null> {
  try {
    const org = await getDefaultOrgId()
    if (!org) return null

    const r = await pool.query(
      'SELECT * FROM public.call_logs WHERE id = $1 AND organization_id = $2 LIMIT 1', [id, org])
    if (!r.rows[0]) return null
    return mapRow(r.rows[0])
  } catch (err: any) { console.error('getCallLog error:', err.message); return null }
}

export async function createCallLog(input: {
  lead_id: string | null
  lead_name: string
  company: string
  phone: string
  direction: 'outbound' | 'inbound'
  started_at: string
  ended_at: string
  duration_seconds: number
  outcome: 'connected' | 'no_answer' | 'voicemail' | 'failed'
  notes?: string
  transcript?: string | null
  recording_url?: string | null
}): Promise<CallLog> {
  const org = await getDefaultOrgId()
  if (!org) throw new Error('No organization found')

  const r = await pool.query(
    `INSERT INTO public.call_logs
     (organization_id, lead_ref, lead_name, company, phone, direction, status, started_at, ended_at, duration_seconds, notes, transcript, recording_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [org, input.lead_id, input.lead_name, input.company, input.phone, input.direction, input.outcome,
     input.started_at, input.ended_at, input.duration_seconds,
     input.notes ?? null, input.transcript ?? null, input.recording_url ?? null])

  return mapRow(r.rows[0])
}

export async function updateCallLog(
  id: string,
  patch: Partial<{
    notes: string | null
    transcript: string | null
    summary: DialerCallSummary | null
    ai_generated_at: string | null
    tags: string[] | null
    scorecard: Record<string, unknown> | null
    recording_url: string | null
  }>
): Promise<CallLog> {
  const org = await getDefaultOrgId()
  if (!org) throw new Error('No organization found')

  const dbPatch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if ('notes' in patch) dbPatch.notes = patch.notes
  if ('transcript' in patch) dbPatch.transcript = patch.transcript
  if ('summary' in patch) dbPatch.ai_summary = patch.summary
  if ('ai_generated_at' in patch) dbPatch.ai_generated_at = patch.ai_generated_at
  if ('tags' in patch) dbPatch.tags = patch.tags
  if ('scorecard' in patch) dbPatch.scorecard = patch.scorecard
  if ('recording_url' in patch) dbPatch.recording_url = patch.recording_url

  const keys = Object.keys(dbPatch); const vals = Object.values(dbPatch)
  const sets = keys.map((k, i) => `"${k}" = $${i + 1}`).join(', ')

  const r = await pool.query(
    `UPDATE public.call_logs SET ${sets} WHERE id = $${keys.length + 1} AND organization_id = $${keys.length + 2} RETURNING *`,
    [...vals, id, org])

  if (!r.rows[0]) throw new Error('Call log not found')
  return mapRow(r.rows[0])
}
