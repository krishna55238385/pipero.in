import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'
import { getMessageSummaryById, sendEmail } from '@/lib/gmail'
import {
  getMailboxAccessToken,
  renewWatchIfNeeded,
  summaryToRow,
  syncMailboxEmails,
  type MailboxRow,
} from '@/lib/engage-sync'
import { loadAttachments } from '@/lib/engage-attachments'
import { generateJson } from '@/lib/llm'
import type { EngageAttachment } from '@/types/engage'

// Campaign/sequence execution engine. Invoked by /api/engage/worker (cron /
// gtm_service pinger) and by the "Run now" action in the campaigns UI.
//
// Lifecycle: scheduled campaign -> recipients enrolled (validated, deduped,
// suppression-checked) -> due steps sent through Gmail with open/click
// tracking -> stop-on-reply -> completed.

const MAX_SENDS_PER_RUN = 50
const SYNC_STALENESS_MS = 60_000
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
// Verifier outcomes that mean the address is genuinely undeliverable. "unknown"
// (inconclusive) is intentionally NOT here — those leads still get emailed.
const BAD_BOUNCE_STATUSES = new Set(['no_mx', 'invalid', 'bounced'])
// Placeholder strings enrichment writes when it has no real value.
const PLACEHOLDER_VALUES = new Set(['', 'null', 'none', 'n/a', 'na', 'unknown', 'undefined'])

function blankIfPlaceholder(value: string): string {
  return PLACEHOLDER_VALUES.has(value.toLowerCase()) ? '' : value
}

// Rough provider detection from the email domain (for the Leads table badge).
function detectProvider(email: string): string {
  const domain = (email.split('@')[1] ?? '').toLowerCase()
  if (/(gmail|googlemail)\.com$/.test(domain) || domain === 'google.com') return 'Google'
  if (/(outlook|hotmail|live|msn)\.com$/.test(domain) || /office365|microsoft/.test(domain)) return 'Microsoft'
  return 'Other'
}

type LeadContext = {
  name: string
  company: string
  title: string
  industry: string
  email: string
}

// AI-personalize one email for a lead: the chosen template is the example/voice,
// the optional instruction is the goal, and the lead's data makes it bespoke.
// Returns null on any failure so the caller can fall back to template merge.
async function personalizeForLead(
  template: { subject: string; body: string },
  instruction: string,
  lead: LeadContext,
): Promise<{ subject: string; bodyHtml: string } | null> {
  try {
    const prompt = [
      'You are an expert B2B outbound copywriter. Rewrite the example email so it',
      'is personalized for ONE specific lead. Keep it concise (≈70–120 words),',
      'natural, and non-spammy, with a single clear ask. Keep the same general',
      'intent/offer as the example.',
      instruction ? `Extra instruction: ${instruction}` : '',
      '',
      'Lead:',
      `- Name: ${lead.name || '(unknown)'}`,
      `- Company: ${lead.company || '(unknown)'}`,
      lead.title ? `- Job title: ${lead.title}` : '',
      lead.industry ? `- Industry: ${lead.industry}` : '',
      '',
      'Example email (voice/offer to preserve):',
      `Subject: ${template.subject || '(none)'}`,
      `Body: ${template.body || '(none)'}`,
      '',
      'Respond with a JSON object: "subject" (plain text) and "bodyHtml" (the body',
      'as simple <p> HTML, no <html>/<body> tags). Address the person by first name.',
    ].filter(Boolean).join('\n')

    const raw = await generateJson(prompt, 'engage_campaign_personalize')
    let parsed: { subject?: string; bodyHtml?: string; body?: string }
    try {
      parsed = JSON.parse(raw)
    } catch {
      const m = raw.match(/\{[\s\S]*\}/)
      parsed = m ? JSON.parse(m[0]) : {}
    }
    let bodyHtml = parsed.bodyHtml || parsed.body || ''
    if (!bodyHtml) return null
    if (!/<[a-z][\s\S]*>/i.test(bodyHtml)) {
      bodyHtml = bodyHtml.split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('')
    }
    return { subject: parsed.subject || template.subject || 'Quick note', bodyHtml }
  } catch (e) {
    console.error('[engage-worker] AI personalize failed:', e instanceof Error ? e.message : e)
    return null
  }
}

type Db = SupabaseClient

type CampaignRow = {
  id: string
  organization_id: string
  name: string
  audience_lead_ids: string[]
  template_id: string | null
  sequence_id: string | null
  schedule_at: string | null
  status: string
  stop_on_reply: boolean
  open_tracking: boolean
  link_tracking: boolean
  daily_limit: number
  personalize_mode: 'template' | 'ai' | null
  ai_instruction: string | null
  origin: 'manual' | 'auto' | null
  icp_id: number | null
}

type RecipientRow = {
  id: string
  campaign_id: string
  organization_id: string
  lead_id: number | null
  email: string
  name: string
  company: string
  job_title: string | null
  current_step: number
  total_steps: number
  status: string
  gmail_thread_id: string | null
}

type TemplateRow = {
  id: string
  subject: string
  body: string
  attachments: EngageAttachment[] | null
}

type SequenceStep = { id?: string; templateId?: string; delayDays?: number }

// A step of a per-lead AI sequence (outreach_sequences.steps from phase 3).
type OutreachSeqVariant = { subject?: string; body?: string }
type OutreachSeqStep = { step_number?: number; delay_days?: number; variants?: OutreachSeqVariant[] }

export type WorkerReport = {
  enrolled: number
  skipped: number
  sent: number
  failed: number
  completedCampaigns: number
  syncedMailboxes: number
  errors: string[]
}

function trackingBaseUrl() {
  return (
    process.env.ENGAGE_PUBLIC_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'http://localhost:3000'
  ).replace(/\/$/, '')
}

export function renderTemplate(text: string, vars: Record<string, string>) {
  return text.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (full, key: string) => {
    const v = vars[key.toLowerCase()]
    return v !== undefined ? v : full
  })
}

function trackingParams(campaignId: string, leadId: number | null, email: string) {
  const qs = new URLSearchParams({ c: campaignId, e: email })
  if (leadId != null) qs.set('l', String(leadId))
  return qs.toString()
}

export function instrumentHtml(
  html: string,
  opts: { campaignId: string; leadId: number | null; email: string; openTracking: boolean; linkTracking: boolean },
) {
  const base = trackingBaseUrl()
  const params = trackingParams(opts.campaignId, opts.leadId, opts.email)
  let out = html

  if (opts.linkTracking) {
    out = out.replace(/href="(https?:\/\/[^"]+)"/gi, (full, url: string) => {
      if (url.includes('/api/track/')) return full
      return `href="${base}/api/track/click?${params}&u=${encodeURIComponent(url)}"`
    })
  }

  // Unsubscribe footer (never link-tracked).
  out += `<p style="margin-top:24px;font-size:11px;color:#9ca3af">If you'd rather not hear from us, <a href="${base}/api/track/unsubscribe?${params}" style="color:#9ca3af">unsubscribe here</a>.</p>`

  if (opts.openTracking) {
    out += `<img src="${base}/api/track/open?${params}" width="1" height="1" style="display:none" alt=""/>`
  }
  return out
}

async function mailboxForOrg(supabase: Db, orgId: string): Promise<MailboxRow | null> {
  const { data } = await supabase
    .from('engage_mailboxes')
    .select('*')
    .eq('provider', 'gmail')
    .eq('organization_id', orgId)
    .order('connected_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as MailboxRow) ?? null
}

/**
 * Validate a campaign's audience and (idempotently) create per-recipient state
 * rows in engage_campaign_recipients. Returns how many were enrolled vs skipped.
 *
 * Shared by the worker's scheduled-enrollment pass AND by manual campaign
 * creation, so a manually-built campaign shows its leads immediately (like an
 * auto-campaign) instead of staying empty until the worker's next due tick.
 * It deliberately does NOT change campaign status — sending is gated elsewhere
 * on status='running', so pre-enrolling a draft/future campaign never sends early.
 */
export async function enrollCampaignRecipients(
  supabase: Db,
  campaign: Pick<CampaignRow, 'id' | 'organization_id' | 'audience_lead_ids' | 'sequence_id'>,
): Promise<{ enrolled: number; skipped: number }> {
  const nowIso = new Date().toISOString()

  let totalSteps = 1
  if (campaign.sequence_id) {
    const { data: seq } = await supabase
      .from('engage_sequences')
      .select('steps')
      .eq('id', campaign.sequence_id)
      .maybeSingle()
    const steps = Array.isArray(seq?.steps) ? (seq.steps as SequenceStep[]) : []
    totalSteps = Math.max(1, steps.length)
  }

  const leadIds = (campaign.audience_lead_ids ?? []).map((x) => Number(x)).filter((n) => Number.isFinite(n))
  const { data: leads } = leadIds.length
    ? await supabase
        .from('leads_raw')
        .select('id, contact_name, contact_email, contact_title, company_name, company_industry, bounce_status')
        .in('id', leadIds)
    : { data: [] }

  const { data: unsubs } = await supabase.from('outreach_unsubscribes').select('email')
  const suppressed = new Set((unsubs ?? []).map((u) => String(u.email).toLowerCase()))

  const seenEmails = new Set<string>()
  const rows = (leads ?? []).map((lead) => {
    const email = String(lead.contact_email ?? '').trim().toLowerCase()
    // Enrichment writes the literal "null"/"none" when it can't find a real
    // value — treat those as blank so they don't pass the gate.
    const name = blankIfPlaceholder(String(lead.contact_name ?? '').trim())
    const company = blankIfPlaceholder(String(lead.company_name ?? '').trim())
    const localPart = email.split('@')[0] ?? ''

    // "No blanks" rule: a recipient must have every column the email needs;
    // incomplete rows are skipped (visibly), never half-sent.
    let skipReason: string | null = null
    if (!email || !EMAIL_RE.test(email) || PLACEHOLDER_VALUES.has(localPart)) {
      // catches blank, malformed, and synthesized "null@domain" addresses
      skipReason = 'missing_or_invalid_email'
    } else if (suppressed.has(email)) {
      skipReason = 'unsubscribed'
    } else if (BAD_BOUNCE_STATUSES.has(String(lead.bounce_status ?? '').toLowerCase())) {
      // Only genuinely undeliverable addresses are skipped. "unknown" means
      // the verifier was inconclusive, NOT that the address bounced — those
      // still send (else nearly every unverified lead would be skipped).
      skipReason = `bounce_status:${lead.bounce_status}`
    } else if (!name && !company) {
      skipReason = 'missing_name_and_company'
    } else if (seenEmails.has(email)) {
      skipReason = 'duplicate_email_in_audience'
    }
    if (email) seenEmails.add(email)

    return {
      campaign_id: campaign.id,
      organization_id: campaign.organization_id,
      lead_id: Number(lead.id),
      email: email || `invalid-${lead.id}@invalid.local`,
      name,
      company,
      job_title: blankIfPlaceholder(String(lead.contact_title ?? '').trim()) || null,
      email_provider: email ? detectProvider(email) : null,
      current_step: 0,
      total_steps: totalSteps,
      status: skipReason ? 'skipped' : 'pending',
      skip_reason: skipReason,
      next_run_at: skipReason ? null : nowIso,
    }
  })

  if (rows.length) {
    const { error } = await supabase
      .from('engage_campaign_recipients')
      .upsert(rows, { onConflict: 'campaign_id,email', ignoreDuplicates: true })
    if (error) throw new Error(error.message)
  }

  // Unified delivery ledger: record skips in outreach_log too, so the
  // "sent vs not sent" stats cover Path A (GTM) and Path B (campaigns) alike.
  const skippedRows = rows.filter((r) => r.status === 'skipped')
  if (skippedRows.length) {
    await supabase.from('outreach_log').insert(
      skippedRows.map((r) => ({
        organization_id: campaign.organization_id,
        lead_id: r.lead_id,
        contact_email: r.email,
        campaign_id: campaign.id,
        channel: 'email',
        status: 'skipped',
        error: r.skip_reason,
      })),
    )
  }

  return {
    enrolled: rows.filter((r) => r.status === 'pending').length,
    skipped: skippedRows.length,
  }
}

/** Enrolls due scheduled campaigns and flips them to 'running'. */
async function enrollDueCampaigns(supabase: Db, report: WorkerReport) {
  const nowIso = new Date().toISOString()
  const { data: campaigns } = await supabase
    .from('engage_campaigns')
    .select('*')
    .eq('status', 'scheduled')
    .lte('schedule_at', nowIso)
  for (const c of (campaigns ?? []) as CampaignRow[]) {
    try {
      const { enrolled, skipped } = await enrollCampaignRecipients(supabase, c)
      report.enrolled += enrolled
      report.skipped += skipped

      await supabase
        .from('engage_campaigns')
        .update({ status: 'running', started_at: nowIso, last_error: null, updated_at: nowIso })
        .eq('id', c.id)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      report.errors.push(`enroll ${c.name}: ${msg}`)
      await supabase
        .from('engage_campaigns')
        .update({ last_error: msg, updated_at: new Date().toISOString() })
        .eq('id', c.id)
    }
  }
}

// Enroll leads into a Path-A auto campaign ("Reach out / Send now"). The
// audience is every lead in the ICP that phase 3 generated a sequence for —
// the worker then drips each lead's own outreach_sequences steps with
// stop-on-reply. Idempotent: only enrolls leads not already on the campaign.
async function enrollAutoCampaigns(supabase: Db, report: WorkerReport) {
  const nowIso = new Date().toISOString()
  const { data: campaigns } = await supabase
    .from('engage_campaigns')
    .select('*')
    .eq('origin', 'auto')
    .eq('status', 'running')
    .not('icp_id', 'is', null)

  for (const c of (campaigns ?? []) as CampaignRow[]) {
    try {
      const icpId = c.icp_id
      if (icpId == null) continue

      const { data: seqs } = await supabase
        .from('outreach_sequences')
        .select('lead_id, steps')
        .eq('icp_id', icpId)
      const seqLenByLead = new Map<number, number>()
      for (const s of seqs ?? []) {
        if (s.lead_id != null) {
          seqLenByLead.set(Number(s.lead_id), Math.max(1, Array.isArray(s.steps) ? (s.steps as unknown[]).length : 1))
        }
      }
      if (seqLenByLead.size === 0) continue

      const { data: existing } = await supabase
        .from('engage_campaign_recipients')
        .select('lead_id')
        .eq('campaign_id', c.id)
      const enrolled = new Set((existing ?? []).map((e) => Number(e.lead_id)))

      // "Only new leads" rule: never re-email a lead who already received an
      // email (in ANY campaign/run). So Send-now over the same ICP twice sends
      // 0 the second time — only freshly-found, un-contacted leads go out.
      const { data: sentRows } = await supabase
        .from('outreach_log')
        .select('lead_id')
        .eq('organization_id', c.organization_id)
        .eq('status', 'sent')
        .not('lead_id', 'is', null)
      const alreadySent = new Set((sentRows ?? []).map((r) => Number(r.lead_id)))

      const newLeadIds = Array.from(seqLenByLead.keys()).filter(
        (id) => !enrolled.has(id) && !alreadySent.has(id),
      )
      if (!newLeadIds.length) continue

      const { data: leads } = await supabase
        .from('leads_raw')
        .select('id, contact_name, contact_email, contact_title, company_name, bounce_status')
        .in('id', newLeadIds)
      const { data: unsubs } = await supabase.from('outreach_unsubscribes').select('email')
      const suppressed = new Set((unsubs ?? []).map((u) => String(u.email).toLowerCase()))

      const rows = (leads ?? []).map((lead) => {
        const email = String(lead.contact_email ?? '').trim().toLowerCase()
        const name = blankIfPlaceholder(String(lead.contact_name ?? '').trim())
        const company = blankIfPlaceholder(String(lead.company_name ?? '').trim())
        const localPart = email.split('@')[0] ?? ''
        let skipReason: string | null = null
        if (!email || !EMAIL_RE.test(email) || PLACEHOLDER_VALUES.has(localPart)) skipReason = 'missing_or_invalid_email'
        else if (suppressed.has(email)) skipReason = 'unsubscribed'
        else if (BAD_BOUNCE_STATUSES.has(String(lead.bounce_status ?? '').toLowerCase())) skipReason = `bounce_status:${lead.bounce_status}`
        else if (!name && !company) skipReason = 'missing_name_and_company'
        return {
          campaign_id: c.id,
          organization_id: c.organization_id,
          lead_id: Number(lead.id),
          email: email || `invalid-${lead.id}@invalid.local`,
          name,
          company,
          job_title: blankIfPlaceholder(String(lead.contact_title ?? '').trim()) || null,
          email_provider: email ? detectProvider(email) : null,
          current_step: 0,
          total_steps: seqLenByLead.get(Number(lead.id)) ?? 1,
          status: skipReason ? 'skipped' : 'pending',
          skip_reason: skipReason,
          next_run_at: skipReason ? null : nowIso,
        }
      })

      if (rows.length) {
        const { error } = await supabase
          .from('engage_campaign_recipients')
          .upsert(rows, { onConflict: 'campaign_id,email', ignoreDuplicates: true })
        if (error) throw new Error(error.message)
        const skippedRows = rows.filter((r) => r.status === 'skipped')
        if (skippedRows.length) {
          await supabase.from('outreach_log').insert(
            skippedRows.map((r) => ({
              organization_id: c.organization_id,
              lead_id: r.lead_id,
              contact_email: r.email,
              campaign_id: c.id,
              channel: 'email',
              status: 'skipped',
              error: r.skip_reason,
            })),
          )
        }
        report.enrolled += rows.filter((r) => r.status === 'pending').length
        report.skipped += skippedRows.length
      }
    } catch (e) {
      report.errors.push(`auto-enroll ${c.name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
}

async function sentTodayCount(supabase: Db, campaignId: string) {
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)
  const { count } = await supabase
    .from('outreach_log')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .eq('status', 'sent')
    .gte('created_at', startOfDay.toISOString())
  return count ?? 0
}

async function processDueRecipients(supabase: Db, report: WorkerReport) {
  const nowIso = new Date().toISOString()
  const { data: running } = await supabase.from('engage_campaigns').select('*').eq('status', 'running')
  const campaigns = (running ?? []) as CampaignRow[]
  if (!campaigns.length) return

  const templateCache = new Map<string, TemplateRow | null>()
  const getTemplate = async (id: string | null): Promise<TemplateRow | null> => {
    if (!id) return null
    if (templateCache.has(id)) return templateCache.get(id) ?? null
    const { data } = await supabase
      .from('engage_templates')
      .select('id, subject, body, attachments')
      .eq('id', id)
      .maybeSingle()
    templateCache.set(id, (data as TemplateRow) ?? null)
    return (data as TemplateRow) ?? null
  }

  // Per-lead AI sequences (Path A "Reach out" auto-campaigns) live in
  // outreach_sequences — each lead has its own 5-step drip with variants.
  const leadSeqCache = new Map<number, OutreachSeqStep[]>()
  const getLeadSequence = async (leadId: number | null): Promise<OutreachSeqStep[]> => {
    if (leadId == null) return []
    if (leadSeqCache.has(leadId)) return leadSeqCache.get(leadId) as OutreachSeqStep[]
    const { data } = await supabase.from('outreach_sequences').select('steps').eq('lead_id', leadId).maybeSingle()
    const steps = Array.isArray(data?.steps) ? (data!.steps as OutreachSeqStep[]) : []
    leadSeqCache.set(leadId, steps)
    return steps
  }

  let sendsLeft = MAX_SENDS_PER_RUN
  for (const c of campaigns) {
    if (sendsLeft <= 0) break

    let steps: SequenceStep[] = []
    if (c.sequence_id) {
      const { data: seq } = await supabase
        .from('engage_sequences')
        .select('steps')
        .eq('id', c.sequence_id)
        .maybeSingle()
      steps = Array.isArray(seq?.steps) ? (seq.steps as SequenceStep[]) : []
    }

    const dailyBudget = Math.max(0, (c.daily_limit ?? 50) - (await sentTodayCount(supabase, c.id)))
    if (dailyBudget <= 0) continue

    const { data: due } = await supabase
      .from('engage_campaign_recipients')
      .select('*')
      .eq('campaign_id', c.id)
      .in('status', ['pending', 'in_progress'])
      .lte('next_run_at', nowIso)
      .order('next_run_at', { ascending: true })
      .limit(Math.min(sendsLeft, dailyBudget))
    if (!due?.length) continue

    const mailbox = await mailboxForOrg(supabase, c.organization_id)
    if (!mailbox) {
      await supabase
        .from('engage_campaigns')
        .update({ last_error: 'No Gmail mailbox connected', updated_at: nowIso })
        .eq('id', c.id)
      report.errors.push(`campaign ${c.name}: no Gmail mailbox connected`)
      continue
    }
    let accessToken: string
    try {
      accessToken = await getMailboxAccessToken(supabase, mailbox)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      report.errors.push(`campaign ${c.name}: ${msg}`)
      continue
    }

    for (const r of (due ?? []) as RecipientRow[]) {
      if (sendsLeft <= 0) break

      // Stop-on-reply: detectReplies flips recipients to 'replied' as soon as
      // an inbound message lands in one of our threads; double-check here in
      // case a reply arrived since enrollment.
      if (c.stop_on_reply) {
        const { data: replied } = await supabase
          .from('outreach_replies')
          .select('id')
          .eq('campaign_id', c.id)
          .eq('email', r.email)
          .limit(1)
        if (replied?.length) {
          await supabase
            .from('engage_campaign_recipients')
            .update({ status: 'replied', updated_at: new Date().toISOString() })
            .eq('id', r.id)
          continue
        }
      }

      const stepIndex = r.current_step
      const firstName = r.name.split(/\s+/)[0] ?? ''
      const vars = {
        name: r.name || r.company || 'there',
        first_name: firstName || r.company || 'there',
        company: r.company || 'your company',
        email: r.email,
      }

      // Resolve this step's subject + body, total step count, the delay before
      // the NEXT step, and any attachments — differs for auto vs manual.
      let subject = ''
      let rawBody = ''
      let totalSteps = r.total_steps
      let nextDelayDays = 1
      let attachmentsMeta: EngageAttachment[] = []

      if (c.origin === 'auto') {
        // Path A: per-lead AI drip from outreach_sequences (already personalized
        // by phase 3, so no LLM at send time — fast).
        const seqSteps = await getLeadSequence(r.lead_id)
        totalSteps = Math.max(1, seqSteps.length)
        const step = seqSteps[stepIndex]
        if (!step) {
          // Sequence exhausted — mark done and move on.
          await supabase
            .from('engage_campaign_recipients')
            .update({ status: 'completed', next_run_at: null, total_steps: totalSteps, updated_at: new Date().toISOString() })
            .eq('id', r.id)
          continue
        }
        const variant = (step.variants ?? [])[0] ?? {}
        subject = renderTemplate(String(variant.subject ?? ''), vars).trim() || `Quick question for ${vars.company}`
        rawBody = renderTemplate(String(variant.body ?? ''), vars)
        nextDelayDays = Math.max(1, Number(seqSteps[stepIndex + 1]?.delay_days ?? 2))
      } else {
        // Path B: shared template / multi-template sequence with merge tags.
        const templateId = c.sequence_id ? steps[stepIndex]?.templateId ?? null : c.template_id
        const template = await getTemplate(templateId ? String(templateId) : null)
        if (!template) {
          await supabase
            .from('engage_campaign_recipients')
            .update({ status: 'failed', last_error: `No template for step ${stepIndex + 1}`, updated_at: new Date().toISOString() })
            .eq('id', r.id)
          report.failed += 1
          continue
        }
        subject = renderTemplate(template.subject || '', vars).trim() || `Quick question for ${vars.company}`
        rawBody = renderTemplate(template.body || '', vars)
        nextDelayDays = Math.max(1, Number(steps[stepIndex + 1]?.delayDays ?? 1))
        attachmentsMeta = (template.attachments ?? []) as EngageAttachment[]
      }

      const bodyHtml = instrumentHtml(
        /<[a-z][\s\S]*>/i.test(rawBody) ? rawBody : rawBody.split('\n').join('<br>'),
        {
          campaignId: c.id,
          leadId: r.lead_id,
          email: r.email,
          openTracking: c.open_tracking,
          linkTracking: c.link_tracking,
        },
      )

      try {
        const attachments = await loadAttachments(supabase, attachmentsMeta)
        const sent = await sendEmail(
          accessToken,
          {
            to: r.email,
            subject,
            bodyHtml,
            // Follow-up steps stay in the original Gmail thread.
            threadId: stepIndex > 0 && r.gmail_thread_id ? r.gmail_thread_id : undefined,
          },
          attachments,
        )
        if (!sent?.id) throw new Error('Gmail did not return a message id')
        const threadId = sent.threadId ?? r.gmail_thread_id ?? sent.id

        // Mirror into the unibox + log for analytics.
        try {
          const summary = await getMessageSummaryById(accessToken, sent.id)
          await supabase
            .from('engage_emails')
            .upsert(summaryToRow(mailbox, summary), { onConflict: 'mailbox_id,gmail_message_id' })
        } catch (e) {
          console.error('[engage-worker] sent mirror failed:', e instanceof Error ? e.message : e)
        }
        await supabase.from('outreach_log').insert({
          organization_id: c.organization_id,
          lead_id: r.lead_id,
          contact_email: r.email,
          campaign_id: c.id,
          channel: 'email',
          step_number: stepIndex + 1,
          variant_subject: subject,
          status: 'sent',
          sent_at: new Date().toISOString(),
          message_id: sent.id,
          thread_id: threadId,
        })

        const nowSent = new Date().toISOString()
        const nextStep = stepIndex + 1
        const isDone = nextStep >= totalSteps
        await supabase
          .from('engage_campaign_recipients')
          .update({
            current_step: nextStep,
            total_steps: totalSteps,
            status: isDone ? 'completed' : 'in_progress',
            gmail_thread_id: threadId,
            last_message_id: sent.id,
            last_sent_at: nowSent,
            next_run_at: isDone ? null : new Date(Date.now() + nextDelayDays * 86_400_000).toISOString(),
            last_error: null,
            updated_at: nowSent,
          })
          .eq('id', r.id)
        report.sent += 1
        sendsLeft -= 1
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        report.failed += 1
        report.errors.push(`send ${r.email}: ${msg}`)
        await supabase
          .from('engage_campaign_recipients')
          .update({ status: 'failed', last_error: msg, updated_at: new Date().toISOString() })
          .eq('id', r.id)
        // Unified delivery ledger: record the failed attempt too.
        await supabase.from('outreach_log').insert({
          organization_id: c.organization_id,
          lead_id: r.lead_id,
          contact_email: r.email,
          campaign_id: c.id,
          channel: 'email',
          step_number: stepIndex + 1,
          variant_subject: subject,
          status: 'failed',
          error: msg,
        })
      }
    }
  }
}

async function completeFinishedCampaigns(supabase: Db, report: WorkerReport) {
  const { data: running } = await supabase.from('engage_campaigns').select('id').eq('status', 'running')
  for (const c of running ?? []) {
    const { count } = await supabase
      .from('engage_campaign_recipients')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', c.id)
      .in('status', ['pending', 'in_progress'])
    if ((count ?? 0) === 0) {
      await supabase
        .from('engage_campaigns')
        .update({ status: 'completed', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', c.id)
      report.completedCampaigns += 1
    }
  }
}

export async function runEngageWorker(): Promise<WorkerReport> {
  const report: WorkerReport = {
    enrolled: 0,
    skipped: 0,
    sent: 0,
    failed: 0,
    completedCampaigns: 0,
    syncedMailboxes: 0,
    errors: [],
  }
  const supabase = createServiceClient()

  // Keep mailboxes synced server-side so replies are detected (and stop-on-
  // reply honored) even when nobody has the unibox open in a browser.
  const { data: mailboxes } = await supabase
    .from('engage_mailboxes')
    .select('*')
    .eq('provider', 'gmail')
  for (const mb of (mailboxes ?? []) as MailboxRow[]) {
    try {
      const accessToken = await getMailboxAccessToken(supabase, mb)
      await renewWatchIfNeeded(supabase, mb, accessToken)
      const lastSynced = mb.last_synced_at ? new Date(mb.last_synced_at).getTime() : 0
      if (Date.now() - lastSynced > SYNC_STALENESS_MS) {
        await syncMailboxEmails(supabase, mb, accessToken, { maxResults: 50 })
        report.syncedMailboxes += 1
      }
    } catch (e) {
      report.errors.push(`sync ${mb.email}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  await enrollDueCampaigns(supabase, report)
  await enrollAutoCampaigns(supabase, report)
  await processDueRecipients(supabase, report)
  await completeFinishedCampaigns(supabase, report)
  return report
}
