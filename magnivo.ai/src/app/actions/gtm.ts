'use server'

/**
 * GTM pipeline data access — reads the phase1/2/3 Supabase tables and triggers
 * the Python pipelines (via the gtm_service FastAPI host). Everything is scoped
 * to the CRM's organization. RLS is disabled in this project, so org isolation
 * is enforced here in the server-action layer (same convention as crm.ts).
 */
import { cache } from 'react'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { ensureAutoCampaignForRun } from '@/app/actions/engage'
import {
  intentFromScore,
  intentFromTier,
  signalLabel,
  type AccountIntel,
  type BuyingSignalRow,
  type CompetitorIntel,
  type Ga4Connection,
  type GtmBrief,
  type Icp,
  type IntentScore,
  type MarketSegment,
  type OutreachBundle,
  type PhaseRun,
  type ProspectLeadRow,
  type RunResult,
  type SignalTypeSummary,
  type StakeholderMap,
  type StakeholderRow,
  type VisitorSignalRow,
} from '@/types/gtm'

async function getDefaultOrgId(supabase: any): Promise<string | undefined> {
  const { data } = await supabase.from('organizations').select('id').limit(1).single()
  return data?.id
}

// Per-request memoized org lookup — avoids re-querying `organizations` on every
// GTM action call during a single server render (cuts round-trips to the DB).
const cachedOrgId = cache(async (): Promise<string | undefined> => {
  const supabase = await createClient()
  if (!supabase) return undefined
  return getDefaultOrgId(supabase)
})

function sanitize(q: string): string {
  // strip PostgREST `or()` delimiters so user input can't break the filter
  return q.replace(/[,()*]/g, ' ').trim()
}

// --------------------------------------------------------------------------- //
// ICPs
// --------------------------------------------------------------------------- //
export async function getIcps(): Promise<Icp[]> {
  const supabase = await createClient()
  if (!supabase) return []
  const org = await cachedOrgId()
  if (!org) return []

  const { data: icps } = await supabase
    .from('icp_profiles')
    .select('*')
    .eq('organization_id', org)
    .order('created_at', { ascending: false })
  if (!icps?.length) return []

  // lead + hot counts per ICP
  const { data: leadRows } = await supabase
    .from('leads_raw')
    .select('icp_id, score_tier')
    .eq('organization_id', org)
  const counts = new Map<number, { total: number; hot: number }>()
  for (const r of leadRows || []) {
    const c = counts.get(r.icp_id) || { total: 0, hot: 0 }
    c.total += 1
    if (r.score_tier === 'hot') c.hot += 1
    counts.set(r.icp_id, c)
  }

  return icps.map((i: any) => ({
    ...i,
    leadCount: counts.get(i.id)?.total || 0,
    hotCount: counts.get(i.id)?.hot || 0,
  }))
}

// --------------------------------------------------------------------------- //
// Prospect leads (leads_raw)
// --------------------------------------------------------------------------- //
export async function getProspectLeads(opts: {
  icpId?: number
  tier?: string
  q?: string
  verifiedOnly?: boolean
  includeIncomplete?: boolean
  page?: number
  pageSize?: number
} = {}): Promise<{ data: ProspectLeadRow[]; count: number }> {
  const supabase = await createClient()
  if (!supabase) return { data: [], count: 0 }
  const org = await cachedOrgId()
  if (!org) return { data: [], count: 0 }

  const page = opts.page || 1
  const pageSize = opts.pageSize || 25
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  let query = supabase
    .from('leads_raw')
    .select('*', { count: 'exact' })
    .eq('organization_id', org)

  if (opts.icpId) query = query.eq('icp_id', opts.icpId)
  if (opts.tier) query = query.eq('score_tier', opts.tier)
  if (opts.verifiedOnly) query = query.eq('verified', true)
  // Discard incomplete leads: a lead with no contact email can't be emailed, so
  // hide it from the prospect list by default (pass includeIncomplete to see all).
  if (!opts.includeIncomplete) query = query.not('contact_email', 'is', null)
  if (opts.q) {
    const q = sanitize(opts.q)
    if (q) {
      query = query.or(
        `company_name.ilike.%${q}%,contact_name.ilike.%${q}%,contact_email.ilike.%${q}%,company_industry.ilike.%${q}%`
      )
    }
  }

  const { data: rows, count } = await query
    .order('icp_score', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .range(from, to)

  const leads = rows || []
  const ids = leads.map((r: any) => r.id)

  // signals count + top type per lead, and promoted flag — run in parallel.
  const signalsByLead = new Map<number, { count: number; top: string | null; topW: number }>()
  const promoted = new Map<number, string>()
  if (ids.length) {
    const [sigRes, crmRes] = await Promise.all([
      supabase.from('buying_signals').select('lead_id, signal_type, weight').in('lead_id', ids),
      supabase.from('leads').select('id, leads_raw_id').eq('organization_id', org).in('leads_raw_id', ids),
    ])
    for (const s of sigRes.data || []) {
      const cur = signalsByLead.get(s.lead_id) || { count: 0, top: null, topW: -1 }
      cur.count += 1
      if ((s.weight ?? 0) > cur.topW) {
        cur.topW = s.weight ?? 0
        cur.top = s.signal_type
      }
      signalsByLead.set(s.lead_id, cur)
    }
    for (const l of crmRes.data || []) promoted.set(l.leads_raw_id, l.id)
  }

  const data: ProspectLeadRow[] = leads.map((r: any) => {
    const loc = [r.company_city, r.company_state, r.company_country].filter(Boolean).join(', ')
    const sc = signalsByLead.get(r.id)
    return {
      id: r.id,
      company: r.company_name,
      contactName: r.contact_name,
      title: r.contact_title,
      email: r.contact_email,
      verified: !!r.verified,
      bounceStatus: r.bounce_status,
      location: loc || null,
      industry: r.company_industry,
      companySize: r.company_size,
      domain: r.company_domain,
      linkedin: r.contact_linkedin_url || r.company_linkedin_url,
      icpId: r.icp_id,
      icpScore: r.icp_score,
      scoreTier: r.score_tier,
      intentScore: r.score_tier ? intentFromTier(r.score_tier) : intentFromScore(r.icp_score),
      signalsCount: sc?.count || 0,
      topSignalType: sc?.top || null,
      promoted: promoted.has(r.id),
      crmLeadId: promoted.get(r.id) || null,
      createdAt: r.created_at,
    }
  })

  return { data, count: count || 0 }
}

/** Full leads_raw row for the prospect-lead detail view (enrichment + score). */
export async function getProspectLeadById(id: number) {
  const supabase = await createClient()
  if (!supabase) return null
  const org = await cachedOrgId()
  if (!org) return null
  const { data: r } = await supabase
    .from('leads_raw')
    .select('*')
    .eq('organization_id', org)
    .eq('id', id)
    .maybeSingle()
  if (!r) return null
  const location = [r.company_city, r.company_state, r.company_country].filter(Boolean).join(', ')
  return {
    id: r.id as number,
    company: (r.company_name as string) || null,
    domain: (r.company_domain as string) || null,
    website: (r.company_website as string) || null,
    contactName: (r.contact_name as string) || null,
    title: (r.contact_title as string) || null,
    email: (r.contact_email as string) || null,
    verified: !!r.verified,
    bounceStatus: (r.bounce_status as string) || null,
    phone: (r.company_phone as string) || null,
    address: (r.company_address as string) || null,
    location: location || null,
    industry: (r.company_industry as string) || null,
    companySize: (r.company_size as string) || null,
    linkedin: (r.contact_linkedin_url as string) || (r.company_linkedin_url as string) || null,
    companyLinkedin: (r.company_linkedin_url as string) || null,
    icpId: (r.icp_id as number) ?? null,
    icpScore: (r.icp_score as number) ?? null,
    scoreTier: (r.score_tier as string) || null,
    scoreReasoning: (r.score_reasoning as string) || null,
    createdAt: (r.created_at as string) || null,
  }
}

// --------------------------------------------------------------------------- //
// Buying signals
// --------------------------------------------------------------------------- //
export async function getSignalSummary(icpId?: number): Promise<SignalTypeSummary[]> {
  const supabase = await createClient()
  if (!supabase) return []
  const org = await cachedOrgId()
  if (!org) return []

  let q = supabase
    .from('buying_signals')
    .select('signal_type, buying_intent, detected_at, lead_id')
    .eq('organization_id', org)
  // optional ICP scope via leads_raw join is heavier; signals are already org-scoped
  const { data } = await q
  const map = new Map<string, SignalTypeSummary>()
  for (const s of data || []) {
    const cur = map.get(s.signal_type) || {
      type: s.signal_type,
      label: signalLabel(s.signal_type),
      count: 0,
      highIntent: 0,
      lastDetected: null,
    }
    cur.count += 1
    if (s.buying_intent === 'high') cur.highIntent += 1
    if (!cur.lastDetected || s.detected_at > cur.lastDetected) cur.lastDetected = s.detected_at
    map.set(s.signal_type, cur)
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count)
}

export async function getRecentSignals(limit = 50): Promise<BuyingSignalRow[]> {
  const supabase = await createClient()
  if (!supabase) return []
  const org = await cachedOrgId()
  if (!org) return []
  const { data } = await supabase
    .from('buying_signals')
    .select('id, lead_id, signal_type, weight, signal_text, signal_summary, signal_source_url, buying_intent, detected_at, leads_raw(company_name)')
    .eq('organization_id', org)
    .order('detected_at', { ascending: false })
    .limit(limit)
  return (data || []).map(mapSignal)
}

export async function getSignalsForLead(leadId: number): Promise<BuyingSignalRow[]> {
  const supabase = await createClient()
  if (!supabase) return []
  const { data } = await supabase
    .from('buying_signals')
    .select('id, lead_id, signal_type, weight, signal_text, signal_summary, signal_source_url, buying_intent, detected_at')
    .eq('lead_id', leadId)
    .order('detected_at', { ascending: false })
  return (data || []).map(mapSignal)
}

function mapSignal(s: any): BuyingSignalRow {
  return {
    id: s.id,
    leadId: s.lead_id,
    company: s.leads_raw?.company_name || null,
    signalType: s.signal_type,
    weight: s.weight,
    text: s.signal_text,
    summary: s.signal_summary,
    sourceUrl: s.signal_source_url,
    intent: s.buying_intent,
    detectedAt: s.detected_at,
  }
}

// --------------------------------------------------------------------------- //
// GA4 / visitor signals
// --------------------------------------------------------------------------- //
export async function getVisitorSignals(opts: { strength?: string; limit?: number } = {}): Promise<VisitorSignalRow[]> {
  const supabase = await createClient()
  if (!supabase) return []
  const org = await cachedOrgId()
  if (!org) return []
  let q = supabase
    .from('website_visitor_signals')
    .select('*')
    .eq('organization_id', org)
  if (opts.strength) q = q.eq('signal_strength', opts.strength)
  const { data } = await q.order('last_seen_at', { ascending: false }).limit(opts.limit || 100)
  return (data || []).map((r: any) => ({
    id: r.id,
    company: r.company_name,
    domain: r.company_domain,
    dimensionValue: r.dimension_value,
    channel: r.channel,
    country: r.country,
    sessions: r.sessions || 0,
    engagedSessions: r.engaged_sessions || 0,
    pageViews: r.page_views || 0,
    avgEngagementSeconds: Number(r.avg_engagement_seconds || 0),
    topPages: r.top_pages || [],
    visitorScore: r.visitor_score || 0,
    strength: r.signal_strength || 'low',
    intentScore: r.signal_strength === 'high' ? 'High' : r.signal_strength === 'medium' ? 'Medium' : 'Low',
    matchedCompanyId: r.matched_company_id,
    matchedLeadId: r.matched_lead_id,
    lastSeenAt: r.last_seen_at,
  }))
}

export async function getGa4Connections(): Promise<Ga4Connection[]> {
  const supabase = await createClient()
  if (!supabase) return []
  const org = await cachedOrgId()
  if (!org) return []
  const { data } = await supabase
    .from('ga4_connections')
    .select('*')
    .eq('organization_id', org)
    .order('created_at', { ascending: false })
  return data || []
}

export async function addGa4Connection(input: {
  propertyId: string
  measurementId?: string
  websiteUrl?: string
  lookbackDays?: number
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  if (!supabase) return { ok: false, error: 'no client' }
  const org = await cachedOrgId()
  if (!org) return { ok: false, error: 'no organization' }
  const { error } = await supabase.from('ga4_connections').upsert(
    {
      organization_id: org,
      property_id: input.propertyId,
      measurement_id: input.measurementId || null,
      website_url: input.websiteUrl || null,
      lookback_days: input.lookbackDays || 7,
      status: 'connected',
    },
    { onConflict: 'organization_id,property_id' }
  )
  if (error) return { ok: false, error: error.message }
  revalidatePath('/prospects/visitors')
  return { ok: true }
}

// --------------------------------------------------------------------------- //
// Market sizing + competitors
// --------------------------------------------------------------------------- //
export async function getMarketSizing(icpId?: number): Promise<MarketSegment[]> {
  const supabase = await createClient()
  if (!supabase) return []
  const org = await cachedOrgId()
  if (!org) return []
  let q = supabase.from('market_segment_intel').select('*').eq('organization_id', org)
  if (icpId) q = q.eq('icp_id', icpId)
  const { data } = await q.order('week_of', { ascending: false }).order('priority_rank', { ascending: true })
  return (data || []).map((r: any) => ({
    id: r.id,
    icpId: r.icp_id,
    weekOf: r.week_of,
    segmentName: r.segment_name,
    leadTotal: r.lead_total || 0,
    leadHot: r.lead_hot || 0,
    leadWarm: r.lead_warm || 0,
    leadCold: r.lead_cold || 0,
    tamEstimate: r.tam_estimate,
    samEstimate: r.sam_estimate,
    somThisMonth: r.som_this_month,
    priorityRank: r.priority_rank ?? 3,
    priorityRationale: r.priority_rationale,
    recommendedVolume: r.recommended_volume || 0,
  }))
}

export async function getCompetitors(icpId: number): Promise<CompetitorIntel[]> {
  const supabase = await createClient()
  if (!supabase) return []
  const { data } = await supabase
    .from('competitor_intel')
    .select('*')
    .eq('icp_id', icpId)
    .order('threat_level', { ascending: true })
  return (data || []).map((r: any) => ({
    id: r.id,
    competitorName: r.competitor_name,
    competitorDomain: r.competitor_domain,
    summary: r.summary,
    complaintCategories: r.complaint_categories || [],
    biggestWeakness: r.biggest_weakness,
    talkTracks: r.talk_tracks || [],
    threatLevel: r.threat_level || 'medium',
    whoLovesThem: r.who_loves_them ?? null,
    whoHatesThem: r.who_hates_them ?? null,
    sources: r.sources || [],
  }))
}

// --------------------------------------------------------------------------- //
// Per-lead deep data (account intel, stakeholders, brief, outreach)
// --------------------------------------------------------------------------- //
export async function getLeadGtmData(leadsRawId: number): Promise<{
  intel: AccountIntel | null
  stakeholders: StakeholderRow[]
  map: StakeholderMap | null
  brief: GtmBrief | null
  outreach: OutreachBundle
}> {
  const supabase = await createClient()
  if (!supabase) {
    return { intel: null, stakeholders: [], map: null, brief: null, outreach: emptyOutreach() }
  }

  const [intelRes, stkRes, mapRes, briefRes, persRes, seqRes, planRes, logRes] = await Promise.all([
    supabase.from('account_intelligence').select('*').eq('lead_id', leadsRawId).maybeSingle(),
    supabase.from('account_stakeholders').select('*').eq('lead_id', leadsRawId).order('rank', { ascending: true }),
    supabase.from('stakeholder_maps').select('*').eq('lead_id', leadsRawId).maybeSingle(),
    supabase.from('gtm_insights').select('*').eq('lead_id', leadsRawId).order('brief_date', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('outreach_personalisations').select('*').eq('lead_id', leadsRawId).maybeSingle(),
    supabase.from('outreach_sequences').select('*').eq('lead_id', leadsRawId).maybeSingle(),
    supabase.from('outreach_channel_plans').select('*').eq('lead_id', leadsRawId).maybeSingle(),
    supabase.from('outreach_log').select('*').eq('lead_id', leadsRawId).order('created_at', { ascending: false }).limit(25),
  ])

  return {
    intel: intelRes.data ? mapIntel(intelRes.data) : null,
    stakeholders: (stkRes.data || []).map(mapStakeholder),
    map: mapRes.data ? mapStakeholderMap(mapRes.data) : null,
    brief: briefRes.data ? mapBrief(briefRes.data) : null,
    outreach: {
      personalisation: persRes.data
        ? { angles: persRes.data.angles || [], qualityScore: persRes.data.quality_score || 0, status: persRes.data.status }
        : null,
      sequence: seqRes.data
        ? { persona: seqRes.data.persona, cta: seqRes.data.cta, steps: seqRes.data.steps || [], qualityScore: seqRes.data.sequence_quality_score || 0 }
        : null,
      channelPlan: planRes.data
        ? {
            primaryChannel: planRes.data.primary_channel,
            secondaryChannel: planRes.data.secondary_channel,
            sendWindowStartHour: planRes.data.send_window_start_hour,
            sendWindowEndHour: planRes.data.send_window_end_hour,
            touchesPerWeek: planRes.data.touches_per_week,
            rationale: planRes.data.rationale,
          }
        : null,
      log: (logRes.data || []).map((r: any) => ({
        id: r.id,
        channel: r.channel,
        stepNumber: r.step_number,
        variantSubject: r.variant_subject,
        status: r.status,
        sentAt: r.sent_at,
        error: r.error,
      })),
    },
  }
}

/** Resolve the AI lead behind a CRM company (via a promoted lead) and load its data. */
export async function getCompanyGtmData(companyId: string) {
  const supabase = await createClient()
  if (!supabase) return null
  const org = await cachedOrgId()
  if (!org) return null
  const { data } = await supabase
    .from('leads')
    .select('leads_raw_id')
    .eq('organization_id', org)
    .eq('company_id', companyId)
    .not('leads_raw_id', 'is', null)
    .limit(1)
  const leadsRawId = data?.[0]?.leads_raw_id
  if (!leadsRawId) return null
  const bundle = await getLeadGtmData(leadsRawId)
  const competitors = bundle.brief?.id || bundle.intel
    ? await getCompetitorsForLead(leadsRawId)
    : []
  return { leadsRawId, ...bundle, competitors }
}

async function getCompetitorsForLead(leadsRawId: number): Promise<CompetitorIntel[]> {
  const supabase = await createClient()
  if (!supabase) return []
  const { data: lr } = await supabase.from('leads_raw').select('icp_id').eq('id', leadsRawId).maybeSingle()
  if (!lr?.icp_id) return []
  return getCompetitors(lr.icp_id)
}

function emptyOutreach(): OutreachBundle {
  return { personalisation: null, sequence: null, channelPlan: null, log: [] }
}
function mapIntel(r: any): AccountIntel {
  return {
    id: r.id,
    leadId: r.lead_id,
    companyName: r.company_name,
    companyDomain: r.company_domain,
    whatTheyDo: r.what_they_do,
    businessModel: r.business_model,
    growthTrajectory: r.growth_trajectory,
    competitivePosition: r.competitive_position,
    recentMoves: r.recent_moves || [],
    likelyPainPoints: r.likely_pain_points || [],
    instabilityFlags: r.instability_flags || [],
    keySignalsForOutreach: r.key_signals_for_outreach || [],
    briefQualityScore: r.brief_quality_score || 0,
    status: r.status,
    refreshedAt: r.refreshed_at,
  }
}
function mapStakeholder(r: any): StakeholderRow {
  return {
    id: r.id,
    fullName: r.full_name,
    jobTitle: r.job_title,
    roleType: r.role_type,
    seniority: r.seniority,
    functionArea: r.function_area,
    linkedinUrl: r.linkedin_url,
    email: r.email,
    emailConfidence: r.email_confidence,
    reportsTo: r.reports_to,
    rank: r.rank ?? 99,
  }
}
function mapStakeholderMap(r: any): StakeholderMap {
  return {
    entryPointFullName: r.entry_point_full_name,
    entryPointRoleType: r.entry_point_role_type,
    multiThreadingStatus: r.multi_threading_status,
    coverageStatus: r.coverage_status,
    missingRoles: r.missing_roles || [],
    championBudgetFlag: !!r.champion_budget_flag,
  }
}
function mapBrief(r: any): GtmBrief {
  return {
    id: r.id,
    leadId: r.lead_id,
    companyName: r.company_name,
    briefDate: r.brief_date,
    executiveSummary: r.executive_summary,
    whoToTarget: r.who_to_target || {},
    whatToSay: r.what_to_say || {},
    whichChannel: r.which_channel || {},
    urgencySignal: r.urgency_signal,
    nextActions: r.next_actions || [],
    flagsAndContradictions: r.flags_and_contradictions || [],
    reviewStatus: r.review_status,
    reviewedBy: r.reviewed_by,
    reviewedAt: r.reviewed_at,
  }
}

// --------------------------------------------------------------------------- //
// GTM brief review queue
// --------------------------------------------------------------------------- //
export async function getBriefsForReview(status = 'pending_review'): Promise<GtmBrief[]> {
  const supabase = await createClient()
  if (!supabase) return []
  const org = await cachedOrgId()
  if (!org) return []
  const { data } = await supabase
    .from('gtm_insights')
    .select('*')
    .eq('organization_id', org)
    .eq('review_status', status)
    .order('brief_date', { ascending: false })
    .limit(100)
  return (data || []).map(mapBrief)
}

export async function approveGtmBrief(briefId: number, reviewedBy = 'crm-user'): Promise<{ ok: boolean; error?: string }> {
  return setBriefStatus(briefId, 'approved', reviewedBy)
}
export async function rejectGtmBrief(briefId: number, reviewedBy = 'crm-user'): Promise<{ ok: boolean; error?: string }> {
  return setBriefStatus(briefId, 'rejected', reviewedBy)
}
async function setBriefStatus(briefId: number, status: string, reviewedBy: string) {
  const supabase = await createClient()
  if (!supabase) return { ok: false, error: 'no client' }
  const { error } = await supabase
    .from('gtm_insights')
    .update({ review_status: status, reviewed_by: reviewedBy, reviewed_at: new Date().toISOString() })
    .eq('id', briefId)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/prospects')
  return { ok: true }
}

// --------------------------------------------------------------------------- //
// Promote leads_raw -> CRM lead/company/contact (manual; auto for hot via trigger)
// --------------------------------------------------------------------------- //
export async function promoteLead(leadsRawId: number): Promise<{ ok: boolean; crmLeadId?: string; error?: string }> {
  const supabase = await createClient()
  if (!supabase) return { ok: false, error: 'no client' }
  const org = await cachedOrgId()
  if (!org) return { ok: false, error: 'no organization' }
  const { data, error } = await supabase.rpc('gtm_promote_lead', { p_lead_id: leadsRawId, p_org: org })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/prospects/leads')
  revalidatePath('/leads')
  return { ok: true, crmLeadId: data as string }
}

// --------------------------------------------------------------------------- //
// LLM usage (cost) summary
// --------------------------------------------------------------------------- //
export async function getLlmUsageSummary(): Promise<{
  totalCost: number
  totalCalls: number
  totalTokens: number
  byAgent: Array<{ agent: string; cost: number; calls: number }>
  byPhase: Array<{ phase: string; cost: number; calls: number }>
}> {
  const supabase = await createClient()
  const empty = { totalCost: 0, totalCalls: 0, totalTokens: 0, byAgent: [], byPhase: [] }
  if (!supabase) return empty
  const org = await cachedOrgId()
  if (!org) return empty
  const { data } = await supabase
    .from('llm_usage')
    .select('agent, phase, estimated_cost_usd, total_tokens')
    .eq('organization_id', org)
  const rows = data || []
  const agent = new Map<string, { cost: number; calls: number }>()
  const phase = new Map<string, { cost: number; calls: number }>()
  let totalCost = 0
  let totalTokens = 0
  for (const r of rows) {
    const cost = Number(r.estimated_cost_usd || 0)
    totalCost += cost
    totalTokens += r.total_tokens || 0
    const a = agent.get(r.agent) || { cost: 0, calls: 0 }
    a.cost += cost
    a.calls += 1
    agent.set(r.agent, a)
    const p = phase.get(r.phase || 'unknown') || { cost: 0, calls: 0 }
    p.cost += cost
    p.calls += 1
    phase.set(r.phase || 'unknown', p)
  }
  return {
    totalCost,
    totalCalls: rows.length,
    totalTokens,
    byAgent: Array.from(agent.entries()).map(([k, v]) => ({ agent: k, ...v })).sort((a, b) => b.cost - a.cost),
    byPhase: Array.from(phase.entries()).map(([k, v]) => ({ phase: k, ...v })).sort((a, b) => b.cost - a.cost),
  }
}

// --------------------------------------------------------------------------- //
// Phase run triggers (-> gtm_service FastAPI)
// --------------------------------------------------------------------------- //
async function callService(path: string, body: Record<string, unknown>): Promise<RunResult> {
  const url = process.env.GTM_SERVICE_URL
  const token = process.env.GTM_SERVICE_TOKEN
  if (!url || !token) {
    return { ok: false, error: 'GTM service not configured (set GTM_SERVICE_URL & GTM_SERVICE_TOKEN)' }
  }
  const supabase = await createClient()
  const org = supabase ? await cachedOrgId() : undefined
  try {
    const res = await fetch(`${url}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ organization_id: org, ...body }),
      cache: 'no-store',
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: json.detail || `service returned ${res.status}` }
    return { ok: true, runId: json.run_id, status: json.status }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'service unreachable' }
  }
}

export async function runPhase1Search(prompt: string, max = 20): Promise<RunResult> {
  const r = await callService('/run/phase1', { prompt, max })
  revalidatePath('/prospects/leads')
  return r
}
export async function runPhase1ForIcp(icpId: number, limit = 50): Promise<RunResult> {
  return callService('/run/phase1', { icp_id: icpId, limit })
}
export async function runPhase2(icpId: number, limit?: number): Promise<RunResult> {
  return callService('/run/phase2', { icp_id: icpId, limit })
}

// "Find leads" (manual): the full prep for one ICP — find → enrich → score →
// understand → personalize → copywrite → channel plan (agents 1–13). No send;
// the generated sequences sit in the DB until "Send now" dispatches them.
export async function runFindAndPrepare(icpId: number, limit?: number): Promise<RunResult> {
  return callService('/run/prepare', { icp_id: icpId, limit })
}

// "Generate signals": (re)detect buying signals. Omit icpId to refresh signals
// for ALL leads org-wide; pass one to scope to a single ICP.
export async function runGenerateSignals(icpId?: number, limit = 200): Promise<RunResult> {
  return callService('/run/signals', icpId ? { icp_id: icpId, limit } : { limit })
}
export async function runPhase3(icpId: number, opts: { dryRun?: boolean; sender?: string; limit?: number } = {}): Promise<RunResult> {
  return callService('/run/phase3', {
    icp_id: icpId,
    limit: opts.limit,
    dry_run: opts.dryRun ?? false,
    sender: opts.sender || 'gmail',
  })
}
// On-demand outreach. Creates an auto-tagged campaign, then runs phase 3 in
// dry-run to GENERATE each lead's personalized 5-step sequence (no blasting).
// The CRM campaign worker then drips those steps over their delay days and
// auto-stops a lead's remaining steps the moment they reply (stop-on-reply).
// So "Send now" returns fast; step 1 goes out on the next worker tick (~1 min),
// and follow-ups are scheduled — not all sent synchronously up front.
export async function runPhase3Send(icpId: number, opts: { sender?: string } = {}): Promise<RunResult> {
  const { id } = await ensureAutoCampaignForRun(icpId)
  return callService('/run/phase3', {
    icp_id: icpId,
    dry_run: true,
    sender: opts.sender || 'gmail',
    campaign_id: id,
  })
}
export async function syncGa4(): Promise<RunResult> {
  return callService('/ga4/sync', {})
}

export async function getPhaseRuns(limit = 20): Promise<PhaseRun[]> {
  const supabase = await createClient()
  if (!supabase) return []
  const org = await cachedOrgId()
  if (!org) return []
  const { data } = await supabase
    .from('phase_runs')
    .select('id, phase, command, status, icp_id, error, started_at, completed_at, created_at')
    .eq('organization_id', org)
    .order('created_at', { ascending: false })
    .limit(limit)
  return (data || []) as PhaseRun[]
}

export async function getPhaseRun(runId: string): Promise<PhaseRun | null> {
  const supabase = await createClient()
  if (!supabase) return null
  const { data } = await supabase.from('phase_runs').select('*').eq('id', runId).maybeSingle()
  return (data || null) as PhaseRun | null
}

// --------------------------------------------------------------------------- //
// Company-centric prospect view (distinct companies from leads_raw)
// --------------------------------------------------------------------------- //
export interface ProspectCompanyRow {
  company: string
  domain: string | null
  industry: string | null
  location: string | null
  size: string | null
  icpId: number | null
  contactsCount: number
  bestScore: number | null
  bestTier: string | null
  intentScore: IntentScore
  signalsCount: number
  promoted: boolean
  leadIds: number[]
}

export async function getProspectCompanies(opts: { q?: string; icpId?: number } = {}): Promise<ProspectCompanyRow[]> {
  const supabase = await createClient()
  if (!supabase) return []
  const org = await cachedOrgId()
  if (!org) return []

  let query = supabase.from('leads_raw').select('*').eq('organization_id', org)
  if (opts.icpId) query = query.eq('icp_id', opts.icpId)
  if (opts.q) {
    const q = sanitize(opts.q)
    if (q) query = query.or(`company_name.ilike.%${q}%,company_industry.ilike.%${q}%`)
  }
  const { data: rows } = await query.limit(2000)
  const leads = rows || []
  const ids = leads.map((r: any) => r.id)

  const signalsByLead = new Map<number, number>()
  const promotedLeads = new Set<number>()
  if (ids.length) {
    const { data: sig } = await supabase.from('buying_signals').select('lead_id').in('lead_id', ids)
    for (const s of sig || []) signalsByLead.set(s.lead_id, (signalsByLead.get(s.lead_id) || 0) + 1)
    const { data: crm } = await supabase
      .from('leads')
      .select('leads_raw_id')
      .eq('organization_id', org)
      .in('leads_raw_id', ids)
    for (const l of crm || []) promotedLeads.add(l.leads_raw_id)
  }

  const tierRank: Record<string, number> = { hot: 3, warm: 2, cold: 1 }
  const byCompany = new Map<string, ProspectCompanyRow>()
  for (const r of leads) {
    const key = (r.company_name || '').toLowerCase()
    if (!key) continue
    const loc = [r.company_city, r.company_state, r.company_country].filter(Boolean).join(', ')
    const cur =
      byCompany.get(key) ||
      ({
        company: r.company_name,
        domain: r.company_domain,
        industry: r.company_industry,
        location: loc || null,
        size: r.company_size,
        icpId: r.icp_id,
        contactsCount: 0,
        bestScore: null,
        bestTier: null,
        intentScore: 'Low',
        signalsCount: 0,
        promoted: false,
        leadIds: [],
      } as ProspectCompanyRow)
    cur.contactsCount += 1
    cur.leadIds.push(r.id)
    cur.signalsCount += signalsByLead.get(r.id) || 0
    if (promotedLeads.has(r.id)) cur.promoted = true
    if (r.icp_score != null && (cur.bestScore == null || r.icp_score > cur.bestScore)) cur.bestScore = r.icp_score
    if (r.score_tier && (tierRank[r.score_tier] || 0) > (tierRank[cur.bestTier || ''] || 0)) cur.bestTier = r.score_tier
    if (!cur.domain && r.company_domain) cur.domain = r.company_domain
    byCompany.set(key, cur)
  }
  const out = Array.from(byCompany.values())
  for (const c of out) c.intentScore = c.bestTier ? intentFromTier(c.bestTier) : intentFromScore(c.bestScore)
  return out.sort((a, b) => (b.bestScore || 0) - (a.bestScore || 0) || b.signalsCount - a.signalsCount)
}

/** Resolve the AI lead behind a CRM lead (leads.leads_raw_id) and load its GTM data. */
export async function getGtmDataForCrmLead(crmLeadId: string) {
  const supabase = await createClient()
  if (!supabase) return null
  const org = await cachedOrgId()
  if (!org) return null
  const { data } = await supabase
    .from('leads')
    .select('leads_raw_id')
    .eq('organization_id', org)
    .eq('id', crmLeadId)
    .maybeSingle()
  const leadsRawId = data?.leads_raw_id
  if (!leadsRawId) return null
  const [bundle, competitors, signals] = await Promise.all([
    getLeadGtmData(leadsRawId),
    getCompetitorsForLead(leadsRawId),
    getSignalsForLead(leadsRawId),
  ])
  return { leadsRawId, ...bundle, competitors, signals }
}
