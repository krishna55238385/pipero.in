'use server'

/**
 * GTM pipeline data access — reads the phase1/2/3 tables and triggers
 * the Python pipelines (via the gtm_service FastAPI host). Everything is scoped
 * to the CRM's organization. RLS is disabled in this project, so org isolation
 * is enforced here in the server-action layer (same convention as crm.ts).
 */
import { cache } from 'react'
import { revalidatePath } from 'next/cache'
import pool from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
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

// Per-request memoized org lookup
const cachedOrgId = cache(async (): Promise<string | undefined> => {
  try {
    const session = await getSessionUser()
    return session?.orgId ?? undefined
  } catch { return undefined }
})

function sanitize(q: string): string {
  return q.replace(/[,()*]/g, ' ').trim()
}

// --------------------------------------------------------------------------- //
// ICPs
// --------------------------------------------------------------------------- //
export async function getIcps(): Promise<Icp[]> {
  try {
    const org = await cachedOrgId()
    if (!org) return []

    const icpsRes = await pool.query(
      'SELECT * FROM public.icp_profiles WHERE organization_id = $1 ORDER BY created_at DESC', [org])
    const icps = icpsRes.rows
    if (!icps.length) return []

    const leadRows = await pool.query(
      'SELECT icp_id, score_tier FROM public.leads_raw WHERE organization_id = $1', [org])
    const counts = new Map<number, { total: number; hot: number }>()
    for (const r of leadRows.rows) {
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
  } catch (err: any) { console.error('getIcps error:', err.message); return [] }
}

// --------------------------------------------------------------------------- //
// Prospect leads (leads_raw)
// --------------------------------------------------------------------------- //
export async function getProspectLeads(opts: {
  icpId?: number; tier?: string; q?: string; verifiedOnly?: boolean
  includeIncomplete?: boolean; page?: number; pageSize?: number
} = {}): Promise<{ data: ProspectLeadRow[]; count: number }> {
  try {
    const org = await cachedOrgId()
    if (!org) return { data: [], count: 0 }

    const page = opts.page || 1
    const pageSize = opts.pageSize || 25
    const offset = (page - 1) * pageSize

    const values: any[] = [org]
    const conditions: string[] = ['organization_id = $1']

    if (opts.icpId) { values.push(opts.icpId); conditions.push(`icp_id = $${values.length}`) }
    if (opts.tier) { values.push(opts.tier); conditions.push(`score_tier = $${values.length}`) }
    if (opts.verifiedOnly) { conditions.push('verified = true') }
    if (!opts.includeIncomplete) { conditions.push('contact_email IS NOT NULL') }
    if (opts.q) {
      const q = sanitize(opts.q)
      if (q) {
        values.push(`%${q}%`)
        const n = values.length
        conditions.push(`(company_name ILIKE $${n} OR contact_name ILIKE $${n} OR contact_email ILIKE $${n} OR company_industry ILIKE $${n})`)
      }
    }

    const where = `WHERE ${conditions.join(' AND ')}`
    const countRes = await pool.query(`SELECT COUNT(*) FROM public.leads_raw ${where}`, values)
    const count = parseInt(countRes.rows[0].count, 10)

    values.push(pageSize, offset)
    const rowsRes = await pool.query(
      `SELECT * FROM public.leads_raw ${where} ORDER BY icp_score DESC NULLS LAST, created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values)
    const leads = rowsRes.rows
    const ids = leads.map((r: any) => r.id)

    const signalsByLead = new Map<number, { count: number; top: string | null; topW: number }>()
    const promoted = new Map<number, string>()
    if (ids.length) {
      const [sigRes, crmRes] = await Promise.all([
        pool.query('SELECT lead_id, signal_type, weight FROM public.buying_signals WHERE lead_id = ANY($1)', [ids]),
        pool.query('SELECT id, leads_raw_id FROM public.leads WHERE organization_id = $1 AND leads_raw_id = ANY($2)', [org, ids])
      ])
      for (const s of sigRes.rows) {
        const cur = signalsByLead.get(s.lead_id) || { count: 0, top: null, topW: -1 }
        cur.count += 1
        if ((s.weight ?? 0) > cur.topW) { cur.topW = s.weight ?? 0; cur.top = s.signal_type }
        signalsByLead.set(s.lead_id, cur)
      }
      for (const l of crmRes.rows) promoted.set(l.leads_raw_id, l.id)
    }

    const data: ProspectLeadRow[] = leads.map((r: any) => {
      const loc = [r.company_city, r.company_state, r.company_country].filter(Boolean).join(', ')
      const sc = signalsByLead.get(r.id)
      return {
        id: r.id, company: r.company_name, contactName: r.contact_name, title: r.contact_title,
        email: r.contact_email, verified: !!r.verified, bounceStatus: r.bounce_status,
        location: loc || null, industry: r.company_industry, companySize: r.company_size,
        domain: r.company_domain, linkedin: r.contact_linkedin_url || r.company_linkedin_url,
        icpId: r.icp_id, icpScore: r.icp_score, scoreTier: r.score_tier,
        intentScore: r.score_tier ? intentFromTier(r.score_tier) : intentFromScore(r.icp_score),
        signalsCount: sc?.count || 0, topSignalType: sc?.top || null,
        promoted: promoted.has(r.id), crmLeadId: promoted.get(r.id) || null, createdAt: r.created_at,
      }
    })

    return { data, count }
  } catch (err: any) { console.error('getProspectLeads error:', err.message); return { data: [], count: 0 } }
}

export async function getProspectLeadById(id: number) {
  try {
    const org = await cachedOrgId()
    if (!org) return null
    const r = await pool.query(
      'SELECT * FROM public.leads_raw WHERE organization_id = $1 AND id = $2 LIMIT 1', [org, id])
    const row = r.rows[0]
    if (!row) return null
    const location = [row.company_city, row.company_state, row.company_country].filter(Boolean).join(', ')
    return {
      id: row.id as number, company: (row.company_name as string) || null,
      domain: (row.company_domain as string) || null, website: (row.company_website as string) || null,
      contactName: (row.contact_name as string) || null, title: (row.contact_title as string) || null,
      email: (row.contact_email as string) || null, verified: !!row.verified,
      bounceStatus: (row.bounce_status as string) || null, phone: (row.company_phone as string) || null,
      address: (row.company_address as string) || null, location: location || null,
      industry: (row.company_industry as string) || null, companySize: (row.company_size as string) || null,
      linkedin: (row.contact_linkedin_url as string) || (row.company_linkedin_url as string) || null,
      companyLinkedin: (row.company_linkedin_url as string) || null,
      icpId: (row.icp_id as number) ?? null, icpScore: (row.icp_score as number) ?? null,
      scoreTier: (row.score_tier as string) || null, scoreReasoning: (row.score_reasoning as string) || null,
      createdAt: (row.created_at as string) || null,
    }
  } catch (err: any) { console.error('getProspectLeadById error:', err.message); return null }
}

// --------------------------------------------------------------------------- //
// Buying signals
// --------------------------------------------------------------------------- //
export async function getSignalSummary(_icpId?: number): Promise<SignalTypeSummary[]> {
  try {
    const org = await cachedOrgId()
    if (!org) return []
    const r = await pool.query(
      'SELECT signal_type, buying_intent, detected_at, lead_id FROM public.buying_signals WHERE organization_id = $1', [org])
    const map = new Map<string, SignalTypeSummary>()
    for (const s of r.rows) {
      const cur = map.get(s.signal_type) || { type: s.signal_type, label: signalLabel(s.signal_type), count: 0, highIntent: 0, lastDetected: null }
      cur.count += 1
      if (s.buying_intent === 'high') cur.highIntent += 1
      if (!cur.lastDetected || s.detected_at > cur.lastDetected) cur.lastDetected = s.detected_at
      map.set(s.signal_type, cur)
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count)
  } catch (err: any) { console.error('getSignalSummary error:', err.message); return [] }
}

export async function getRecentSignals(limit = 50): Promise<BuyingSignalRow[]> {
  try {
    const org = await cachedOrgId()
    if (!org) return []
    const r = await pool.query(`
      SELECT bs.id, bs.lead_id, bs.signal_type, bs.weight, bs.signal_text, bs.signal_summary,
        bs.signal_source_url, bs.buying_intent, bs.detected_at,
        lr.company_name AS leads_raw_company_name
      FROM public.buying_signals bs
      LEFT JOIN public.leads_raw lr ON lr.id = bs.lead_id
      WHERE bs.organization_id = $1
      ORDER BY bs.detected_at DESC LIMIT $2
    `, [org, limit])
    return r.rows.map((s: any) => mapSignal({ ...s, leads_raw: { company_name: s.leads_raw_company_name } }))
  } catch (err: any) { console.error('getRecentSignals error:', err.message); return [] }
}

export async function getSignalsForLead(leadId: number): Promise<BuyingSignalRow[]> {
  try {
    const r = await pool.query(
      'SELECT id, lead_id, signal_type, weight, signal_text, signal_summary, signal_source_url, buying_intent, detected_at FROM public.buying_signals WHERE lead_id = $1 ORDER BY detected_at DESC',
      [leadId])
    return r.rows.map(mapSignal)
  } catch (err: any) { console.error('getSignalsForLead error:', err.message); return [] }
}

function mapSignal(s: any): BuyingSignalRow {
  return {
    id: s.id, leadId: s.lead_id, company: s.leads_raw?.company_name || null,
    signalType: s.signal_type, weight: s.weight, text: s.signal_text,
    summary: s.signal_summary, sourceUrl: s.signal_source_url,
    intent: s.buying_intent, detectedAt: s.detected_at,
  }
}

// --------------------------------------------------------------------------- //
// GA4 / visitor signals
// --------------------------------------------------------------------------- //
export async function getVisitorSignals(opts: { strength?: string; limit?: number } = {}): Promise<VisitorSignalRow[]> {
  try {
    const org = await cachedOrgId()
    if (!org) return []
    const values: any[] = [org]
    let where = 'WHERE organization_id = $1'
    if (opts.strength) { values.push(opts.strength); where += ` AND signal_strength = $${values.length}` }
    values.push(opts.limit || 100)
    const r = await pool.query(
      `SELECT * FROM public.website_visitor_signals ${where} ORDER BY last_seen_at DESC LIMIT $${values.length}`, values)
    return r.rows.map((row: any) => ({
      id: row.id, company: row.company_name, domain: row.company_domain,
      dimensionValue: row.dimension_value, channel: row.channel, country: row.country,
      sessions: row.sessions || 0, engagedSessions: row.engaged_sessions || 0,
      pageViews: row.page_views || 0, avgEngagementSeconds: Number(row.avg_engagement_seconds || 0),
      topPages: row.top_pages || [], visitorScore: row.visitor_score || 0,
      strength: row.signal_strength || 'low',
      intentScore: row.signal_strength === 'high' ? 'High' : row.signal_strength === 'medium' ? 'Medium' : 'Low',
      matchedCompanyId: row.matched_company_id, matchedLeadId: row.matched_lead_id, lastSeenAt: row.last_seen_at,
    }))
  } catch (err: any) { console.error('getVisitorSignals error:', err.message); return [] }
}

export async function getGa4Connections(): Promise<Ga4Connection[]> {
  try {
    const org = await cachedOrgId()
    if (!org) return []
    const r = await pool.query(
      'SELECT * FROM public.ga4_connections WHERE organization_id = $1 ORDER BY created_at DESC', [org])
    return r.rows
  } catch (err: any) { console.error('getGa4Connections error:', err.message); return [] }
}

export async function addGa4Connection(input: {
  propertyId: string; measurementId?: string; websiteUrl?: string; lookbackDays?: number
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const org = await cachedOrgId()
    if (!org) return { ok: false, error: 'no organization' }
    await pool.query(
      `INSERT INTO public.ga4_connections (organization_id, property_id, measurement_id, website_url, lookback_days, status)
       VALUES ($1,$2,$3,$4,$5,'connected')
       ON CONFLICT (organization_id, property_id) DO UPDATE SET
         measurement_id = EXCLUDED.measurement_id, website_url = EXCLUDED.website_url,
         lookback_days = EXCLUDED.lookback_days, status = EXCLUDED.status`,
      [org, input.propertyId, input.measurementId || null, input.websiteUrl || null, input.lookbackDays || 7])
    revalidatePath('/prospects/visitors')
    return { ok: true }
  } catch (err: any) { return { ok: false, error: err.message } }
}

// --------------------------------------------------------------------------- //
// Market sizing + competitors
// --------------------------------------------------------------------------- //
export async function getMarketSizing(icpId?: number): Promise<MarketSegment[]> {
  try {
    const org = await cachedOrgId()
    if (!org) return []
    const values: any[] = [org]
    let where = 'WHERE organization_id = $1'
    if (icpId) { values.push(icpId); where += ` AND icp_id = $${values.length}` }
    const r = await pool.query(
      `SELECT * FROM public.market_segment_intel ${where} ORDER BY week_of DESC, priority_rank ASC`, values)
    return r.rows.map((row: any) => ({
      id: row.id, icpId: row.icp_id, weekOf: row.week_of, segmentName: row.segment_name,
      leadTotal: row.lead_total || 0, leadHot: row.lead_hot || 0, leadWarm: row.lead_warm || 0, leadCold: row.lead_cold || 0,
      tamEstimate: row.tam_estimate, samEstimate: row.sam_estimate, somThisMonth: row.som_this_month,
      priorityRank: row.priority_rank ?? 3, priorityRationale: row.priority_rationale, recommendedVolume: row.recommended_volume || 0,
    }))
  } catch (err: any) { console.error('getMarketSizing error:', err.message); return [] }
}

export async function getCompetitors(icpId: number): Promise<CompetitorIntel[]> {
  try {
    const r = await pool.query(
      'SELECT * FROM public.competitor_intel WHERE icp_id = $1 ORDER BY threat_level ASC', [icpId])
    return r.rows.map((row: any) => ({
      id: row.id, competitorName: row.competitor_name, competitorDomain: row.competitor_domain,
      summary: row.summary, complaintCategories: row.complaint_categories || [],
      biggestWeakness: row.biggest_weakness, talkTracks: row.talk_tracks || [],
      threatLevel: row.threat_level || 'medium', whoLovesThem: row.who_loves_them ?? null,
      whoHatesThem: row.who_hates_them ?? null, sources: row.sources || [],
    }))
  } catch (err: any) { console.error('getCompetitors error:', err.message); return [] }
}

// --------------------------------------------------------------------------- //
// Per-lead deep data
// --------------------------------------------------------------------------- //
export async function getLeadGtmData(leadsRawId: number): Promise<{
  intel: AccountIntel | null; stakeholders: StakeholderRow[]; map: StakeholderMap | null
  brief: GtmBrief | null; outreach: OutreachBundle
}> {
  try {
    const [intelRes, stkRes, mapRes, briefRes, persRes, seqRes, planRes, logRes] = await Promise.all([
      pool.query('SELECT * FROM public.account_intelligence WHERE lead_id = $1 LIMIT 1', [leadsRawId]),
      pool.query('SELECT * FROM public.account_stakeholders WHERE lead_id = $1 ORDER BY rank ASC', [leadsRawId]),
      pool.query('SELECT * FROM public.stakeholder_maps WHERE lead_id = $1 LIMIT 1', [leadsRawId]),
      pool.query('SELECT * FROM public.gtm_insights WHERE lead_id = $1 ORDER BY brief_date DESC LIMIT 1', [leadsRawId]),
      pool.query('SELECT * FROM public.outreach_personalisations WHERE lead_id = $1 LIMIT 1', [leadsRawId]),
      pool.query('SELECT * FROM public.outreach_sequences WHERE lead_id = $1 LIMIT 1', [leadsRawId]),
      pool.query('SELECT * FROM public.outreach_channel_plans WHERE lead_id = $1 LIMIT 1', [leadsRawId]),
      pool.query('SELECT * FROM public.outreach_log WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 25', [leadsRawId]),
    ])

    const persRow = persRes.rows[0]; const seqRow = seqRes.rows[0]; const planRow = planRes.rows[0]
    return {
      intel: intelRes.rows[0] ? mapIntel(intelRes.rows[0]) : null,
      stakeholders: stkRes.rows.map(mapStakeholder),
      map: mapRes.rows[0] ? mapStakeholderMap(mapRes.rows[0]) : null,
      brief: briefRes.rows[0] ? mapBrief(briefRes.rows[0]) : null,
      outreach: {
        personalisation: persRow ? { angles: persRow.angles || [], qualityScore: persRow.quality_score || 0, status: persRow.status } : null,
        sequence: seqRow ? { persona: seqRow.persona, cta: seqRow.cta, steps: seqRow.steps || [], qualityScore: seqRow.sequence_quality_score || 0 } : null,
        channelPlan: planRow ? {
          primaryChannel: planRow.primary_channel, secondaryChannel: planRow.secondary_channel,
          sendWindowStartHour: planRow.send_window_start_hour, sendWindowEndHour: planRow.send_window_end_hour,
          touchesPerWeek: planRow.touches_per_week, rationale: planRow.rationale,
        } : null,
        log: logRes.rows.map((r: any) => ({
          id: r.id, channel: r.channel, stepNumber: r.step_number, variantSubject: r.variant_subject,
          status: r.status, sentAt: r.sent_at, error: r.error,
        })),
      },
    }
  } catch (err: any) {
    console.error('getLeadGtmData error:', err.message)
    return { intel: null, stakeholders: [], map: null, brief: null, outreach: emptyOutreach() }
  }
}

export async function getCompanyGtmData(companyId: string) {
  try {
    const org = await cachedOrgId()
    if (!org) return null
    const r = await pool.query(
      'SELECT leads_raw_id FROM public.leads WHERE organization_id = $1 AND company_id = $2 AND leads_raw_id IS NOT NULL LIMIT 1',
      [org, companyId])
    const leadsRawId = r.rows[0]?.leads_raw_id
    if (!leadsRawId) return null
    const bundle = await getLeadGtmData(leadsRawId)
    const competitors = bundle.brief?.id || bundle.intel ? await getCompetitorsForLead(leadsRawId) : []
    return { leadsRawId, ...bundle, competitors }
  } catch (err: any) { console.error('getCompanyGtmData error:', err.message); return null }
}

async function getCompetitorsForLead(leadsRawId: number): Promise<CompetitorIntel[]> {
  try {
    const r = await pool.query('SELECT icp_id FROM public.leads_raw WHERE id = $1 LIMIT 1', [leadsRawId])
    if (!r.rows[0]?.icp_id) return []
    return getCompetitors(r.rows[0].icp_id)
  } catch { return [] }
}

function emptyOutreach(): OutreachBundle {
  return { personalisation: null, sequence: null, channelPlan: null, log: [] }
}
function mapIntel(r: any): AccountIntel {
  return {
    id: r.id, leadId: r.lead_id, companyName: r.company_name, companyDomain: r.company_domain,
    whatTheyDo: r.what_they_do, businessModel: r.business_model, growthTrajectory: r.growth_trajectory,
    competitivePosition: r.competitive_position, recentMoves: r.recent_moves || [],
    likelyPainPoints: r.likely_pain_points || [], instabilityFlags: r.instability_flags || [],
    keySignalsForOutreach: r.key_signals_for_outreach || [], briefQualityScore: r.brief_quality_score || 0,
    status: r.status, refreshedAt: r.refreshed_at,
  }
}
function mapStakeholder(r: any): StakeholderRow {
  return {
    id: r.id, fullName: r.full_name, jobTitle: r.job_title, roleType: r.role_type,
    seniority: r.seniority, functionArea: r.function_area, linkedinUrl: r.linkedin_url,
    email: r.email, emailConfidence: r.email_confidence, reportsTo: r.reports_to, rank: r.rank ?? 99,
  }
}
function mapStakeholderMap(r: any): StakeholderMap {
  return {
    entryPointFullName: r.entry_point_full_name, entryPointRoleType: r.entry_point_role_type,
    multiThreadingStatus: r.multi_threading_status, coverageStatus: r.coverage_status,
    missingRoles: r.missing_roles || [], championBudgetFlag: !!r.champion_budget_flag,
  }
}
function mapBrief(r: any): GtmBrief {
  return {
    id: r.id, leadId: r.lead_id, companyName: r.company_name, briefDate: r.brief_date,
    executiveSummary: r.executive_summary, whoToTarget: r.who_to_target || {},
    whatToSay: r.what_to_say || {}, whichChannel: r.which_channel || {},
    urgencySignal: r.urgency_signal, nextActions: r.next_actions || [],
    flagsAndContradictions: r.flags_and_contradictions || [],
    reviewStatus: r.review_status, reviewedBy: r.reviewed_by, reviewedAt: r.reviewed_at,
  }
}

// --------------------------------------------------------------------------- //
// GTM brief review queue
// --------------------------------------------------------------------------- //
export async function getBriefsForReview(status = 'pending_review'): Promise<GtmBrief[]> {
  try {
    const org = await cachedOrgId()
    if (!org) return []
    const r = await pool.query(
      'SELECT * FROM public.gtm_insights WHERE organization_id = $1 AND review_status = $2 ORDER BY brief_date DESC LIMIT 100',
      [org, status])
    return r.rows.map(mapBrief)
  } catch (err: any) { console.error('getBriefsForReview error:', err.message); return [] }
}

export async function approveGtmBrief(briefId: number, reviewedBy = 'crm-user'): Promise<{ ok: boolean; error?: string }> {
  return setBriefStatus(briefId, 'approved', reviewedBy)
}
export async function rejectGtmBrief(briefId: number, reviewedBy = 'crm-user'): Promise<{ ok: boolean; error?: string }> {
  return setBriefStatus(briefId, 'rejected', reviewedBy)
}
async function setBriefStatus(briefId: number, status: string, reviewedBy: string) {
  try {
    await pool.query(
      'UPDATE public.gtm_insights SET review_status = $1, reviewed_by = $2, reviewed_at = $3 WHERE id = $4',
      [status, reviewedBy, new Date().toISOString(), briefId])
    revalidatePath('/prospects')
    return { ok: true }
  } catch (err: any) { return { ok: false, error: err.message } }
}

// --------------------------------------------------------------------------- //
// Promote leads_raw -> CRM lead
// --------------------------------------------------------------------------- //
export async function promoteLead(leadsRawId: number): Promise<{ ok: boolean; crmLeadId?: string; error?: string }> {
  try {
    const org = await cachedOrgId()
    if (!org) return { ok: false, error: 'no organization' }
    const r = await pool.query('SELECT gtm_promote_lead($1, $2) AS crmLeadId', [leadsRawId, org])
    revalidatePath('/prospects/leads'); revalidatePath('/leads')
    return { ok: true, crmLeadId: r.rows[0]?.crmleadid as string }
  } catch (err: any) { return { ok: false, error: err.message } }
}

// --------------------------------------------------------------------------- //
// LLM usage summary
// --------------------------------------------------------------------------- //
export async function getLlmUsageSummary(): Promise<{
  totalCost: number; totalCalls: number; totalTokens: number
  byAgent: Array<{ agent: string; cost: number; calls: number }>
  byPhase: Array<{ phase: string; cost: number; calls: number }>
}> {
  const empty = { totalCost: 0, totalCalls: 0, totalTokens: 0, byAgent: [], byPhase: [] }
  try {
    const org = await cachedOrgId()
    if (!org) return empty
    const r = await pool.query(
      'SELECT agent, phase, estimated_cost_usd, total_tokens FROM public.llm_usage WHERE organization_id = $1', [org])
    const rows = r.rows
    const agent = new Map<string, { cost: number; calls: number }>()
    const phase = new Map<string, { cost: number; calls: number }>()
    let totalCost = 0; let totalTokens = 0
    for (const row of rows) {
      const cost = Number(row.estimated_cost_usd || 0)
      totalCost += cost; totalTokens += row.total_tokens || 0
      const a = agent.get(row.agent) || { cost: 0, calls: 0 }; a.cost += cost; a.calls += 1; agent.set(row.agent, a)
      const p = phase.get(row.phase || 'unknown') || { cost: 0, calls: 0 }; p.cost += cost; p.calls += 1; phase.set(row.phase || 'unknown', p)
    }
    return {
      totalCost, totalCalls: rows.length, totalTokens,
      byAgent: Array.from(agent.entries()).map(([k, v]) => ({ agent: k, ...v })).sort((a, b) => b.cost - a.cost),
      byPhase: Array.from(phase.entries()).map(([k, v]) => ({ phase: k, ...v })).sort((a, b) => b.cost - a.cost),
    }
  } catch (err: any) { console.error('getLlmUsageSummary error:', err.message); return empty }
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
  const org = await cachedOrgId()
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
export async function runFindAndPrepare(icpId: number, limit?: number): Promise<RunResult> {
  return callService('/run/prepare', { icp_id: icpId, limit })
}
export async function runGenerateSignals(icpId?: number, limit = 200): Promise<RunResult> {
  return callService('/run/signals', icpId ? { icp_id: icpId, limit } : { limit })
}
export async function runPhase3(icpId: number, opts: { dryRun?: boolean; sender?: string; limit?: number } = {}): Promise<RunResult> {
  return callService('/run/phase3', { icp_id: icpId, limit: opts.limit, dry_run: opts.dryRun ?? false, sender: opts.sender || 'gmail' })
}
export async function runPhase3Send(icpId: number, opts: { sender?: string } = {}): Promise<RunResult> {
  const { id } = await ensureAutoCampaignForRun(icpId)
  return callService('/run/phase3', { icp_id: icpId, dry_run: true, sender: opts.sender || 'gmail', campaign_id: id })
}
export async function syncGa4(): Promise<RunResult> {
  return callService('/ga4/sync', {})
}

export async function getPhaseRuns(limit = 20): Promise<PhaseRun[]> {
  try {
    const org = await cachedOrgId()
    if (!org) return []
    const r = await pool.query(
      'SELECT id, phase, command, status, icp_id, error, started_at, completed_at, created_at FROM public.phase_runs WHERE organization_id = $1 ORDER BY created_at DESC LIMIT $2',
      [org, limit])
    return r.rows as PhaseRun[]
  } catch (err: any) { console.error('getPhaseRuns error:', err.message); return [] }
}

export async function getPhaseRun(runId: string): Promise<PhaseRun | null> {
  try {
    const r = await pool.query('SELECT * FROM public.phase_runs WHERE id = $1 LIMIT 1', [runId])
    return (r.rows[0] || null) as PhaseRun | null
  } catch (err: any) { console.error('getPhaseRun error:', err.message); return null }
}

// --------------------------------------------------------------------------- //
// Company-centric prospect view
// --------------------------------------------------------------------------- //
export interface ProspectCompanyRow {
  company: string; domain: string | null; industry: string | null; location: string | null
  size: string | null; icpId: number | null; contactsCount: number; bestScore: number | null
  bestTier: string | null; intentScore: IntentScore; signalsCount: number; promoted: boolean; leadIds: number[]
}

export async function getProspectCompanies(opts: { q?: string; icpId?: number } = {}): Promise<ProspectCompanyRow[]> {
  try {
    const org = await cachedOrgId()
    if (!org) return []

    const values: any[] = [org]
    let where = 'WHERE organization_id = $1'
    if (opts.icpId) { values.push(opts.icpId); where += ` AND icp_id = $${values.length}` }
    if (opts.q) {
      const q = sanitize(opts.q)
      if (q) { values.push(`%${q}%`); const n = values.length; where += ` AND (company_name ILIKE $${n} OR company_industry ILIKE $${n})` }
    }
    values.push(2000)
    const rowsRes = await pool.query(`SELECT * FROM public.leads_raw ${where} LIMIT $${values.length}`, values)
    const leads = rowsRes.rows
    const ids = leads.map((r: any) => r.id)

    const signalsByLead = new Map<number, number>()
    const promotedLeads = new Set<number>()
    if (ids.length) {
      const [sigRes, crmRes] = await Promise.all([
        pool.query('SELECT lead_id FROM public.buying_signals WHERE lead_id = ANY($1)', [ids]),
        pool.query('SELECT leads_raw_id FROM public.leads WHERE organization_id = $1 AND leads_raw_id = ANY($2)', [org, ids])
      ])
      for (const s of sigRes.rows) signalsByLead.set(s.lead_id, (signalsByLead.get(s.lead_id) || 0) + 1)
      for (const l of crmRes.rows) promotedLeads.add(l.leads_raw_id)
    }

    const tierRank: Record<string, number> = { hot: 3, warm: 2, cold: 1 }
    const byCompany = new Map<string, ProspectCompanyRow>()
    for (const r of leads) {
      const key = (r.company_name || '').toLowerCase()
      if (!key) continue
      const loc = [r.company_city, r.company_state, r.company_country].filter(Boolean).join(', ')
      const cur = byCompany.get(key) || ({
        company: r.company_name, domain: r.company_domain, industry: r.company_industry,
        location: loc || null, size: r.company_size, icpId: r.icp_id,
        contactsCount: 0, bestScore: null, bestTier: null, intentScore: 'Low' as IntentScore,
        signalsCount: 0, promoted: false, leadIds: [],
      } as ProspectCompanyRow)
      cur.contactsCount += 1; cur.leadIds.push(r.id)
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
  } catch (err: any) { console.error('getProspectCompanies error:', err.message); return [] }
}

export async function getGtmDataForCrmLead(crmLeadId: string) {
  try {
    const org = await cachedOrgId()
    if (!org) return null
    const r = await pool.query(
      'SELECT leads_raw_id FROM public.leads WHERE organization_id = $1 AND id = $2 LIMIT 1', [org, crmLeadId])
    const leadsRawId = r.rows[0]?.leads_raw_id
    if (!leadsRawId) return null
    const [bundle, competitors, signals] = await Promise.all([
      getLeadGtmData(leadsRawId),
      getCompetitorsForLead(leadsRawId),
      getSignalsForLead(leadsRawId),
    ])
    return { leadsRawId, ...bundle, competitors, signals }
  } catch (err: any) { console.error('getGtmDataForCrmLead error:', err.message); return null }
}
