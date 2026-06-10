'use server'

/**
 * Dialer data access — reads/writes the `call_logs` table and the dialer lead
 * list (from the GTM `leads_raw` prospect table). Everything is scoped to the
 * CRM's organization. RLS is disabled in this project, so org isolation is
 * enforced here in the server-action layer (same convention as crm.ts / gtm.ts).
 */

import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import type { CallLog, DialerCallSummary } from '@/components/dialer/storage'
import type { DialerLead } from '@/components/dialer/types'

async function getDefaultOrgId(supabase: any): Promise<string | undefined> {
  const { data } = await supabase.from('organizations').select('id').limit(1).single()
  return data?.id
}

// Per-request memoized org lookup — avoids re-querying `organizations` on every
// dialer action during a single server render.
const cachedOrgId = cache(async (): Promise<string | undefined> => {
  const supabase = await createClient()
  if (!supabase) return undefined
  return getDefaultOrgId(supabase)
})

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
  const supabase = await createClient()
  if (!supabase) return { leads: [] }

  const org = await cachedOrgId()
  if (!org) return { leads: [] }

  const { data: rows } = await supabase
    .from('leads_raw')
    .select('id, contact_name, company_name, contact_title, company_phone, score_tier, icp_score')
    .eq('organization_id', org)
    .order('icp_score', { ascending: false, nullsFirst: false })
    .limit(100)

  if (!rows?.length) return { leads: [] }

  const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
  const toTemperature = (tier: string | null): DialerLead['status'] => {
    const t = (tier || '').toLowerCase()
    if (t === 'hot') return 'Hot'
    if (t === 'warm') return 'Warm'
    return 'Cold'
  }

  return {
    leads: rows.map((r: any) => ({
      id: String(r.id),
      name: r.contact_name || r.company_name || 'Unknown',
      company: r.company_name || '-',
      phone: r.company_phone || '',
      status: toTemperature(r.score_tier),
      title: r.contact_title || titleCase(r.score_tier || ''),
    })),
  }
}

// --------------------------------------------------------------------------- //
// Call logs
// --------------------------------------------------------------------------- //
export async function listCallLogs(): Promise<CallLog[]> {
  const supabase = await createClient()
  if (!supabase) return []

  const org = await cachedOrgId()
  if (!org) return []

  const { data: rows } = await supabase
    .from('call_logs')
    .select('*')
    .eq('organization_id', org)
    .order('started_at', { ascending: false, nullsFirst: false })

  if (!rows?.length) return []
  return rows.map(mapRow)
}

export async function getCallLog(id: string): Promise<CallLog | null> {
  const supabase = await createClient()
  if (!supabase) return null

  const org = await cachedOrgId()
  if (!org) return null

  const { data: row } = await supabase
    .from('call_logs')
    .select('*')
    .eq('id', id)
    .eq('organization_id', org)
    .single()

  if (!row) return null
  return mapRow(row)
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
  const supabase = await createClient()
  if (!supabase) throw new Error('Supabase client unavailable')

  const org = await cachedOrgId()
  if (!org) throw new Error('No organization found')

  const { data: row, error } = await supabase
    .from('call_logs')
    .insert({
      organization_id: org,
      lead_ref: input.lead_id,
      lead_name: input.lead_name,
      company: input.company,
      phone: input.phone,
      direction: input.direction,
      status: input.outcome,
      started_at: input.started_at,
      ended_at: input.ended_at,
      duration_seconds: input.duration_seconds,
      notes: input.notes ?? null,
      transcript: input.transcript ?? null,
      recording_url: input.recording_url ?? null,
    })
    .select()
    .single()

  if (error) throw error
  return mapRow(row)
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
  const supabase = await createClient()
  if (!supabase) throw new Error('Supabase client unavailable')

  const org = await cachedOrgId()
  if (!org) throw new Error('No organization found')

  // Map client-shape patch keys to DB column names. `summary` → `ai_summary`.
  const dbPatch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if ('notes' in patch) dbPatch.notes = patch.notes
  if ('transcript' in patch) dbPatch.transcript = patch.transcript
  if ('summary' in patch) dbPatch.ai_summary = patch.summary
  if ('ai_generated_at' in patch) dbPatch.ai_generated_at = patch.ai_generated_at
  if ('tags' in patch) dbPatch.tags = patch.tags
  if ('scorecard' in patch) dbPatch.scorecard = patch.scorecard
  if ('recording_url' in patch) dbPatch.recording_url = patch.recording_url

  const { data: row, error } = await supabase
    .from('call_logs')
    .update(dbPatch)
    .eq('id', id)
    .eq('organization_id', org)
    .select()
    .single()

  if (error) throw error
  return mapRow(row)
}
