'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { refreshAccessToken, startGmailWatch } from '@/lib/gmail'
import { syncMailboxEmails, type MailboxRow } from '@/lib/engage-sync'
import { enrollCampaignRecipients, runEngageWorker, type WorkerReport } from '@/lib/engage-worker'
import { runWarmupCycle } from '@/lib/engage-warmup'
import { generateJson } from '@/lib/llm'
import nodemailer from 'nodemailer'
import type {
  AccountSettingsInput,
  AccountTag,
  ConversationInsight,
  ConversationMessage,
  ConversationThread,
  EmailAccount,
  EngageAccountStats,
  EngageAnalyticsData,
  EngageAttachment,
  EngageCampaign,
  EngageCampaignStats,
  EngageLead,
  EngageSequence,
  EngageTemplate,
  GtmScheduleConfig,
  UnsubscribeRow,
} from '@/types/engage'

type DbClient = Awaited<ReturnType<typeof createClient>>

async function getDefaultOrgId(supabase: DbClient) {
  const { data } = await supabase.from('organizations').select('id').limit(1).single()
  return data?.id as string | undefined
}

async function getCurrentActor(supabase: DbClient) {
  const cookieStore = await cookies()
  const isMockAuth = cookieStore.get('sb-mock-auth')?.value === 'true'
  const { data: authData } = await supabase.auth.getUser()
  let userId = authData?.user?.id ?? null

  if (!userId && isMockAuth) {
    const { data: firstUser } = await supabase.from('users').select('id').limit(1).single()
    userId = firstUser?.id ?? null
  }
  if (!userId) throw new Error('Authentication required')
  const orgId = await getDefaultOrgId(supabase)
  if (!orgId) throw new Error('No organization found')
  return { userId, orgId }
}

export async function upsertGmailMailbox(input: {
  email: string
  accessToken: string
  refreshToken?: string
  tokenType?: string
  scope?: string
  expiresIn?: number
}) {
  const supabase = await createClient()
  const { userId, orgId } = await getCurrentActor(supabase)
  const expiresAt = input.expiresIn
    ? new Date(Date.now() + input.expiresIn * 1000).toISOString()
    : null

  const { error } = await supabase.from('engage_mailboxes').upsert(
    {
      user_id: userId,
      organization_id: orgId,
      provider: 'gmail',
      email: input.email,
      access_token: input.accessToken,
      refresh_token: input.refreshToken ?? null,
      token_type: input.tokenType ?? 'Bearer',
      scope: input.scope ?? null,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
      connected_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,provider,email' }
  )
  if (error) throw new Error(error.message)
}

export async function getGmailMailbox() {
  const supabase = await createClient()
  const { userId } = await getCurrentActor(supabase)
  const { data, error } = await supabase
    .from('engage_mailboxes')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', 'gmail')
    .order('connected_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

export async function getMailboxSyncStatus() {
  const mailbox = await getGmailMailbox()
  if (!mailbox) return null
  return {
    email: mailbox.email as string,
    lastSyncedAt: mailbox.last_synced_at as string | null,
    watchExpiration: mailbox.gmail_watch_expiration as string | null,
    historyId: mailbox.gmail_history_id as string | null,
  }
}

/** All connected Gmail mailboxes for the current user (most-recent first). */
export async function getGmailMailboxes(): Promise<
  Array<{ id: string; email: string; lastSyncedAt: string | null; watchExpiration: string | null }>
> {
  const supabase = await createClient()
  const { userId } = await getCurrentActor(supabase)
  const { data, error } = await supabase
    .from('engage_mailboxes')
    .select('id, email, last_synced_at, gmail_watch_expiration')
    .eq('user_id', userId)
    .eq('provider', 'gmail')
    .order('connected_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map((m) => ({
    id: String(m.id),
    email: m.email as string,
    lastSyncedAt: (m.last_synced_at as string | null) ?? null,
    watchExpiration: (m.gmail_watch_expiration as string | null) ?? null,
  }))
}

export async function getValidGmailAccessToken() {
  const supabase = await createClient()
  const mailbox = await getGmailMailbox()
  if (!mailbox) throw new Error('No Gmail mailbox connected')

  const exp = mailbox.expires_at ? new Date(mailbox.expires_at).getTime() : 0
  const soon = Date.now() + 30_000
  if (mailbox.access_token && exp > soon) return mailbox.access_token as string

  if (!mailbox.refresh_token) throw new Error('Gmail refresh token missing')
  const refreshed = await refreshAccessToken(mailbox.refresh_token as string)
  const expiresAt = new Date(Date.now() + (refreshed.expires_in ?? 3600) * 1000).toISOString()

  const { error } = await supabase
    .from('engage_mailboxes')
    .update({
      access_token: refreshed.access_token,
      token_type: refreshed.token_type ?? 'Bearer',
      scope: refreshed.scope ?? mailbox.scope,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq('id', mailbox.id)
  if (error) throw new Error(error.message)
  return refreshed.access_token
}

export async function registerGmailWatch() {
  const supabase = await createClient()
  const mailbox = await getGmailMailbox()
  if (!mailbox) throw new Error('No Gmail mailbox connected')
  const accessToken = await getValidGmailAccessToken()
  const watch = await startGmailWatch(accessToken)
  const watchExpiration = watch.expiration ? new Date(Number(watch.expiration)).toISOString() : null

  const { error } = await supabase
    .from('engage_mailboxes')
    .update({
      gmail_history_id: watch.historyId ?? mailbox.gmail_history_id ?? null,
      gmail_watch_expiration: watchExpiration,
      updated_at: new Date().toISOString(),
    })
    .eq('id', mailbox.id)
  if (error) throw new Error(error.message)

  // Deep initial backfill (inbox + sent) through the shared sync path so
  // direction/labels are classified consistently.
  await syncMailboxEmails(supabase, mailbox as MailboxRow, accessToken, { maxResults: 300 })

  revalidatePath('/engage/settings')
}

/** Manual full re-sync from the Engage settings page. */
export async function resyncMailboxNow() {
  const supabase = await createClient()
  const mailbox = await getGmailMailbox()
  if (!mailbox) throw new Error('No Gmail mailbox connected')
  const accessToken = await getValidGmailAccessToken()
  const count = await syncMailboxEmails(supabase, mailbox as MailboxRow, accessToken, { maxResults: 300 })
  revalidatePath('/engage/inbox')
  revalidatePath('/engage/settings')
  return { synced: count }
}

/** Runs one campaign-worker tick from the UI ("Run now"). */
export async function runEngageWorkerNow(): Promise<WorkerReport> {
  const supabase = await createClient()
  await getCurrentActor(supabase) // auth gate
  const report = await runEngageWorker()
  revalidatePath('/engage/campaigns')
  return report
}

/** Runs one warmup cycle from the UI ("Run warmup now"). */
export async function triggerWarmupCycle(): Promise<{ sent: number; errors: string[] }> {
  const supabase = await createClient()
  await getCurrentActor(supabase) // auth gate
  const report = await runWarmupCycle()
  revalidatePath('/engage/accounts')
  return { sent: report.sent, errors: report.errors }
}

export async function getEngageCampaigns(): Promise<EngageCampaign[]> {
  const supabase = await createClient()
  const { orgId } = await getCurrentActor(supabase)
  const { data, error } = await supabase
    .from('engage_campaigns')
    .select('*')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
  if (error) return []
  return (data ?? []).map((x) => ({
    id: String(x.id),
    name: String(x.name),
    audienceLeadIds: Array.isArray(x.audience_lead_ids) ? x.audience_lead_ids.map(String) : [],
    templateId: x.template_id ? String(x.template_id) : '',
    sequenceId: x.sequence_id ? String(x.sequence_id) : undefined,
    scheduleAt: x.schedule_at ? String(x.schedule_at) : new Date().toISOString(),
    status: (x.status ?? 'draft') as EngageCampaign['status'],
    stopOnReply: Boolean(x.stop_on_reply ?? true),
    openTracking: Boolean(x.open_tracking ?? true),
    linkTracking: Boolean(x.link_tracking ?? true),
    dailyLimit: Number(x.daily_limit ?? 50),
    personalizeMode: (x.personalize_mode === 'ai' ? 'ai' : 'template'),
    aiInstruction: x.ai_instruction ? String(x.ai_instruction) : '',
    origin: (x.origin === 'auto' ? 'auto' : 'manual'),
    icpId: x.icp_id != null ? Number(x.icp_id) : null,
  }))
}

function campaignRow(x: Record<string, unknown>): EngageCampaign {
  return {
    id: String(x.id),
    name: String(x.name),
    audienceLeadIds: Array.isArray(x.audience_lead_ids) ? (x.audience_lead_ids as unknown[]).map(String) : [],
    templateId: x.template_id ? String(x.template_id) : '',
    sequenceId: x.sequence_id ? String(x.sequence_id) : undefined,
    scheduleAt: x.schedule_at ? String(x.schedule_at) : new Date().toISOString(),
    status: (x.status ?? 'draft') as EngageCampaign['status'],
    stopOnReply: Boolean(x.stop_on_reply ?? true),
    openTracking: Boolean(x.open_tracking ?? true),
    linkTracking: Boolean(x.link_tracking ?? true),
    dailyLimit: Number(x.daily_limit ?? 50),
    personalizeMode: (x.personalize_mode === 'ai' ? 'ai' : 'template'),
    aiInstruction: x.ai_instruction ? String(x.ai_instruction) : '',
    origin: (x.origin === 'auto' ? 'auto' : 'manual'),
    icpId: x.icp_id != null ? Number(x.icp_id) : null,
  }
}

// Creates (or reuses today's) auto-campaign for a phase-3 Reach-Out run so the
// generated leads/sends are grouped under a named campaign ("<ICP> — Campaign N")
// that shows in the campaigns list, tagged origin='auto'. Returns its id, which
// the caller passes to the pipeline as the outreach_log campaign_id.
// ONE campaign per ICP: find the existing auto-campaign for this ICP and
// re-activate it (so newly-prepared leads get enrolled + sent), or create it
// the first time. Every manual "Send now" and every auto 3 AM run for the same
// ICP funnels its leads into this single campaign — never a new one each click.
export async function ensureAutoCampaignForRun(icpId: number): Promise<{ id: string; name: string }> {
  const supabase = await createClient()
  const { orgId, userId } = await getCurrentActor(supabase)

  const { data: existing } = await supabase
    .from('engage_campaigns')
    .select('id, name')
    .eq('organization_id', orgId)
    .eq('origin', 'auto')
    .eq('icp_id', icpId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (existing) {
    // Re-activate so the worker enrolls any new, un-sent leads for this ICP.
    await supabase
      .from('engage_campaigns')
      .update({ status: 'running', completed_at: null, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
    revalidatePath('/engage/campaigns')
    return { id: String(existing.id), name: String(existing.name) }
  }

  const { data: icp } = await supabase.from('icp_profiles').select('name').eq('id', icpId).maybeSingle()
  const name = `${String(icp?.name || `ICP ${icpId}`)} — Outreach`

  const { data, error } = await supabase
    .from('engage_campaigns')
    .insert({
      organization_id: orgId,
      created_by: userId,
      name,
      origin: 'auto',
      icp_id: icpId,
      status: 'running',
      personalize_mode: 'template',
      started_at: new Date().toISOString(),
    })
    .select('id, name')
    .single()
  if (error) throw new Error(error.message)
  revalidatePath('/engage/campaigns')
  return { id: String(data.id), name: String(data.name) }
}

// "Send now" (manual, agent-14-only): create the auto-campaign and immediately
// run the worker, which dispatches the ALREADY-GENERATED per-lead sequences
// from the database — no LLM, no re-running agents 11/12/13 — to leads that
// haven't been emailed yet. Fast.
export async function sendNowForIcp(icpId: number): Promise<{ campaignId: string; report: WorkerReport }> {
  const supabase = await createClient()
  await getCurrentActor(supabase)
  // Require generated sequences first (Find leads / prep), else there's nothing to send.
  const { count } = await supabase
    .from('outreach_sequences')
    .select('lead_id', { count: 'exact', head: true })
    .eq('icp_id', icpId)
  if (!count) {
    throw new Error('No prepared emails for this ICP yet — run "Find leads" first to generate them.')
  }
  const { id } = await ensureAutoCampaignForRun(icpId)
  const report = await runEngageWorker()
  revalidatePath('/engage/campaigns')
  revalidatePath('/prospects/icp')
  return { campaignId: id, report }
}

export async function getEngageCampaign(id: string): Promise<EngageCampaign | null> {
  const supabase = await createClient()
  const { orgId } = await getCurrentActor(supabase)
  const { data, error } = await supabase
    .from('engage_campaigns')
    .select('*')
    .eq('organization_id', orgId)
    .eq('id', id)
    .maybeSingle()
  if (error || !data) return null
  return campaignRow(data)
}

export async function createEngageCampaign(input: Omit<EngageCampaign, 'id'>): Promise<{ id: string }> {
  const supabase = await createClient()
  const { orgId, userId } = await getCurrentActor(supabase)
  if (!input.templateId && !input.sequenceId) {
    throw new Error('Pick a template or a sequence for the campaign')
  }
  const { data, error } = await supabase
    .from('engage_campaigns')
    .insert({
      organization_id: orgId,
      created_by: userId,
      name: input.name,
      audience_lead_ids: input.audienceLeadIds,
      template_id: input.templateId || null,
      sequence_id: input.sequenceId || null,
      schedule_at: input.scheduleAt,
      status: input.status,
      stop_on_reply: input.stopOnReply ?? true,
      open_tracking: input.openTracking ?? true,
      link_tracking: input.linkTracking ?? true,
      daily_limit: input.dailyLimit ?? 50,
      personalize_mode: input.personalizeMode === 'ai' ? 'ai' : 'template',
      ai_instruction: input.aiInstruction || null,
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)

  // Enroll the audience right away so the campaign's Leads tab is populated
  // immediately — matching auto-campaigns, which enroll on creation. Sending
  // stays gated on status='running', so a draft or future-scheduled campaign
  // shows its leads without sending early. Best-effort: a hiccup here must not
  // fail campaign creation (the worker will re-enroll idempotently when due).
  try {
    await enrollCampaignRecipients(supabase, {
      id: String(data.id),
      organization_id: orgId,
      audience_lead_ids: (input.audienceLeadIds ?? []).map(String),
      sequence_id: input.sequenceId || null,
    })
  } catch (enrollError) {
    console.error('createEngageCampaign: immediate enrollment failed', enrollError)
  }

  revalidatePath('/engage/campaigns')
  return { id: String(data.id) }
}

// Patch a campaign's settings/schedule/audience/status from the detail tabs.
export async function updateEngageCampaign(
  id: string,
  patch: Partial<Omit<EngageCampaign, 'id'>>,
) {
  const supabase = await createClient()
  const { orgId } = await getCurrentActor(supabase)
  const dbPatch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.name !== undefined) dbPatch.name = patch.name
  if (patch.audienceLeadIds !== undefined) dbPatch.audience_lead_ids = patch.audienceLeadIds
  if (patch.templateId !== undefined) dbPatch.template_id = patch.templateId || null
  if (patch.sequenceId !== undefined) dbPatch.sequence_id = patch.sequenceId || null
  if (patch.scheduleAt !== undefined) dbPatch.schedule_at = patch.scheduleAt
  if (patch.status !== undefined) dbPatch.status = patch.status
  if (patch.stopOnReply !== undefined) dbPatch.stop_on_reply = patch.stopOnReply
  if (patch.openTracking !== undefined) dbPatch.open_tracking = patch.openTracking
  if (patch.linkTracking !== undefined) dbPatch.link_tracking = patch.linkTracking
  if (patch.dailyLimit !== undefined) dbPatch.daily_limit = patch.dailyLimit
  if (patch.personalizeMode !== undefined) dbPatch.personalize_mode = patch.personalizeMode
  if (patch.aiInstruction !== undefined) dbPatch.ai_instruction = patch.aiInstruction || null
  const { error } = await supabase
    .from('engage_campaigns')
    .update(dbPatch)
    .eq('organization_id', orgId)
    .eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/engage/campaigns')
  revalidatePath(`/engage/campaigns/${id}`)
}

// Pause / resume / schedule a campaign from the detail header.
export async function setCampaignStatus(id: string, status: EngageCampaign['status']) {
  return updateEngageCampaign(id, { status })
}

/** Per-campaign recipient progress (enrolled / sent / replied / failed). */
export async function getEngageCampaignProgress(): Promise<Record<string, Record<string, number>>> {
  const supabase = await createClient()
  let orgId: string
  try {
    ;({ orgId } = await getCurrentActor(supabase))
  } catch {
    return {}
  }
  const { data } = await supabase
    .from('engage_campaign_recipients')
    .select('campaign_id, status')
    .eq('organization_id', orgId)
  const out: Record<string, Record<string, number>> = {}
  for (const row of data ?? []) {
    const cid = String(row.campaign_id)
    const status = String(row.status)
    out[cid] = out[cid] ?? {}
    out[cid][status] = (out[cid][status] ?? 0) + 1
  }
  return out
}

// Per-campaign breakdown of WHY recipients were skipped, so "N skipped" in the
// UI is explainable (missing email, unsubscribed, bounced, duplicate, …).
export async function getEngageCampaignSkips(): Promise<Record<string, Record<string, number>>> {
  const supabase = await createClient()
  let orgId: string
  try {
    ;({ orgId } = await getCurrentActor(supabase))
  } catch {
    return {}
  }
  const { data } = await supabase
    .from('engage_campaign_recipients')
    .select('campaign_id, skip_reason')
    .eq('organization_id', orgId)
    .eq('status', 'skipped')
  const out: Record<string, Record<string, number>> = {}
  for (const row of data ?? []) {
    const cid = String(row.campaign_id)
    const reason = String(row.skip_reason ?? 'unknown')
    out[cid] = out[cid] ?? {}
    out[cid][reason] = (out[cid][reason] ?? 0) + 1
  }
  return out
}

// --------------------------------------------------------------------------- //
// Campaign detail (Instantly-style): leads, step analytics, KPIs, lead status
// --------------------------------------------------------------------------- //

export async function getCampaignDetail(id: string): Promise<import('@/types/engage').CampaignDetailData | null> {
  const supabase = await createClient()
  let orgId: string
  try {
    ;({ orgId } = await getCurrentActor(supabase))
  } catch {
    return null
  }
  const campaign = await getEngageCampaign(id)
  if (!campaign) return null

  const [recipientsRes, logRes, opensRes, clicksRes, repliesRes, unsubsRes] = await Promise.all([
    supabase.from('engage_campaign_recipients').select('*').eq('campaign_id', id).order('created_at', { ascending: true }),
    supabase.from('outreach_log').select('email:contact_email, status, step_number, sent_at, created_at').eq('campaign_id', id),
    supabase.from('outreach_opens').select('email, opened_at, created_at').eq('campaign_id', id),
    supabase.from('outreach_clicks').select('email, clicked_at, created_at').eq('campaign_id', id),
    supabase.from('outreach_replies').select('email, replied_at, created_at').eq('campaign_id', id),
    supabase.from('outreach_unsubscribes').select('email, unsubscribed_at, created_at').eq('campaign_id', id),
  ])

  const recipients = recipientsRes.data ?? []
  const sentRows = (logRes.data ?? []).filter((r) => r.status === 'sent')
  const opens = opensRes.data ?? []
  const clicks = clicksRes.data ?? []
  const replies = repliesRes.data ?? []
  const unsubs = unsubsRes.data ?? []

  const uniq = (rows: Array<{ email?: string | null }>) =>
    new Set(rows.map((r) => String(r.email ?? '').toLowerCase()).filter(Boolean)).size
  const sequenceStarted = recipients.filter((r) =>
    ['in_progress', 'completed', 'replied'].includes(String(r.status)),
  ).length
  const uniqueOpens = uniq(opens)
  const uniqueClicks = uniq(clicks)
  const uniqueReplies = uniq(replies)
  const opportunities = recipients.filter((r) =>
    (['interested', 'meeting_booked', 'meeting_completed', 'won'] as string[]).includes(String(r.interest_status)),
  ).length
  const denom = sequenceStarted || sentRows.length || 1
  const completed = recipients.filter((r) => ['completed', 'replied'].includes(String(r.status))).length

  const kpis: import('@/types/engage').CampaignKpis = {
    sequenceStarted,
    sent: sentRows.length,
    openCount: uniqueOpens,
    openRate: (uniqueOpens / denom) * 100,
    clickCount: uniqueClicks,
    clickRate: (uniqueClicks / denom) * 100,
    replyCount: uniqueReplies,
    replyRate: (uniqueReplies / denom) * 100,
    opportunities,
    unsubscribes: unsubs.length,
    progressPct: recipients.length ? (completed / recipients.length) * 100 : 0,
  }

  // Per-step analytics (sent/opened/replied/clicked are at the campaign grain;
  // step-level sent comes from outreach_log.step_number).
  const stepNumValues: number[] = sentRows.map((r) => Number((r as { step_number?: number }).step_number ?? 1))
  const stepNums: number[] = Array.from(new Set<number>(stepNumValues)).sort((a, b) => a - b)
  const steps: import('@/types/engage').CampaignStepStat[] = (stepNums.length ? stepNums : [1]).map((step) => {
    const sentForStep = sentRows.filter((r) => Number(r.step_number ?? 1) === step).length
    return {
      step,
      sent: sentForStep,
      // opens/clicks/replies aren't step-attributed in our schema; show on step 1.
      opened: step === (stepNums[0] ?? 1) ? uniqueOpens : 0,
      clicked: step === (stepNums[0] ?? 1) ? uniqueClicks : 0,
      replied: step === (stepNums[0] ?? 1) ? uniqueReplies : 0,
      opportunities: step === (stepNums[0] ?? 1) ? opportunities : 0,
    }
  })

  const leads: import('@/types/engage').CampaignLeadRow[] = recipients.map((r) => ({
    recipientId: String(r.id),
    leadId: r.lead_id != null ? Number(r.lead_id) : null,
    email: String(r.email ?? ''),
    name: String(r.name ?? ''),
    company: String(r.company ?? ''),
    jobTitle: String(r.job_title ?? ''),
    provider: String(r.email_provider ?? ''),
    deliveryStatus: String(r.status ?? 'pending'),
    interestStatus: (r.interest_status ?? 'lead') as import('@/types/engage').InterestStatus,
    skipReason: r.skip_reason ? String(r.skip_reason) : null,
    threadId: r.gmail_thread_id ? String(r.gmail_thread_id) : null,
    lastSentAt: r.last_sent_at ? String(r.last_sent_at) : null,
  }))

  // Daily series for the chart.
  type Bucket = { sends: number; opens: number; clicks: number; replies: number; unsubscribes: number }
  const byDate: Record<string, Bucket> = {}
  const add = (dt: string | null | undefined, key: keyof Bucket) => {
    if (!dt) return
    const d = new Date(dt)
    if (Number.isNaN(d.getTime())) return
    const k = d.toISOString().split('T')[0]
    byDate[k] = byDate[k] ?? { sends: 0, opens: 0, clicks: 0, replies: 0, unsubscribes: 0 }
    byDate[k][key] += 1
  }
  sentRows.forEach((r) => add(r.sent_at ?? r.created_at, 'sends'))
  opens.forEach((r) => add(r.opened_at ?? r.created_at, 'opens'))
  clicks.forEach((r) => add(r.clicked_at ?? r.created_at, 'clicks'))
  replies.forEach((r) => add(r.replied_at ?? r.created_at, 'replies'))
  unsubs.forEach((r) => add(r.unsubscribed_at ?? r.created_at, 'unsubscribes'))
  const timeSeries = Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b)).map(([date, b]) => ({ date, ...b }))

  return { campaign, kpis, steps, leads, timeSeries }
}

// Set a lead's interest label inside a campaign (Lead / Interested / Won / …).
export async function setRecipientInterest(recipientId: string, status: import('@/types/engage').InterestStatus) {
  const supabase = await createClient()
  const { orgId } = await getCurrentActor(supabase)
  const { data, error } = await supabase
    .from('engage_campaign_recipients')
    .update({ interest_status: status, updated_at: new Date().toISOString() })
    .eq('organization_id', orgId)
    .eq('id', recipientId)
    .select('campaign_id')
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (data?.campaign_id) revalidatePath(`/engage/campaigns/${data.campaign_id}`)
}

// Unified "sent vs not sent" delivery stats across Path A (GTM) + Path B
// (campaigns), grouped by campaign_id from the outreach_log ledger.
export async function getOutreachDeliveryStats(days: number = 30): Promise<import('@/types/engage').DeliveryStats[]> {
  const supabase = await createClient()
  let orgId: string
  try {
    ;({ orgId } = await getCurrentActor(supabase))
  } catch {
    return []
  }
  const since = new Date()
  since.setDate(since.getDate() - days)

  const [logRes, campaignsRes] = await Promise.all([
    supabase
      .from('outreach_log')
      .select('campaign_id, status')
      .eq('organization_id', orgId)
      .gte('created_at', since.toISOString()),
    supabase.from('engage_campaigns').select('id, name').eq('organization_id', orgId),
  ])
  const nameById = new Map<string, string>()
  for (const c of campaignsRes.data ?? []) nameById.set(String(c.id), String(c.name))

  const agg = new Map<string, { sent: number; failed: number; skipped: number }>()
  for (const row of logRes.data ?? []) {
    const cid = String(row.campaign_id ?? 'manual')
    const a = agg.get(cid) ?? { sent: 0, failed: 0, skipped: 0 }
    const s = String(row.status ?? 'sent')
    if (s === 'sent') a.sent += 1
    else if (s === 'failed') a.failed += 1
    else if (s === 'skipped') a.skipped += 1
    agg.set(cid, a)
  }

  return Array.from(agg.entries())
    .map(([cid, a]) => {
      const source: import('@/types/engage').DeliveryStats['source'] = nameById.has(cid)
        ? 'campaign'
        : cid === 'manual'
          ? 'manual'
          : 'gtm'
      const name = nameById.get(cid) ?? (cid === 'manual' ? 'Manual sends (composer)' : `GTM pipeline · ${cid}`)
      return { campaignId: cid, name, source, attempted: a.sent + a.failed + a.skipped, sent: a.sent, failed: a.failed, skipped: a.skipped }
    })
    .sort((x, y) => y.attempted - x.attempted)
}

export async function getEngageTemplates(): Promise<EngageTemplate[]> {
  const supabase = await createClient()
  const { orgId } = await getCurrentActor(supabase)
  const { data, error } = await supabase
    .from('engage_templates')
    .select('*')
    .eq('organization_id', orgId)
    .order('updated_at', { ascending: false })
  if (error) return []
  return (data ?? []).map((x) => ({
    id: String(x.id),
    name: String(x.name),
    subject: String(x.subject ?? ''),
    body: String(x.body ?? ''),
    attachments: (Array.isArray(x.attachments) ? x.attachments : []) as EngageAttachment[],
    updatedAt: String(x.updated_at ?? new Date().toISOString()),
  }))
}

export async function upsertEngageTemplate(input: Omit<EngageTemplate, 'updatedAt'>): Promise<{ id: string }> {
  const supabase = await createClient()
  const { orgId, userId } = await getCurrentActor(supabase)
  const payload = {
    id: input.id || undefined,
    organization_id: orgId,
    created_by: userId,
    name: input.name,
    subject: input.subject,
    body: input.body,
    attachments: input.attachments ?? [],
    updated_at: new Date().toISOString(),
  }
  const { data, error } = await supabase.from('engage_templates').upsert(payload).select('id').single()
  if (error) throw new Error(error.message)
  revalidatePath('/engage/templates')
  return { id: String(data.id) }
}

// Autonomous AI sequence builder: from a single prompt, the AI SELECTS and
// ORDERS the user's ALREADY-SAVED templates into a multi-step sequence and
// assigns sensible wait-days between them. It does not invent new content —
// it reuses existing templates. Returns the wired steps for the UI to review.
export async function generateSequenceWithAI(prompt: string): Promise<{
  name: string
  steps: Array<{ templateId: string; delayDays: number; templateName: string }>
}> {
  const supabase = await createClient()
  const { orgId } = await getCurrentActor(supabase)
  const instruction = (prompt || '').trim()
  if (!instruction) throw new Error('Tell the AI what the sequence should achieve.')

  const { data: tpls } = await supabase
    .from('engage_templates')
    .select('id, name, subject, body')
    .eq('organization_id', orgId)
    .order('updated_at', { ascending: false })
  const templates = tpls ?? []
  if (!templates.length) {
    throw new Error('Create some templates first — the AI builds the sequence from your saved templates.')
  }

  const list = templates
    .map((t, i) => `[${i}] ${String(t.name)} — subject: "${String(t.subject ?? '')}" — body: ${String(t.body ?? '').replace(/\s+/g, ' ').slice(0, 180)}`)
    .join('\n')
  const llmPrompt = [
    'You are a B2B outbound sequence designer. From the AVAILABLE TEMPLATES below,',
    'SELECT an ordered subset (2–5 steps) that forms a coherent cold-email sequence',
    'for the goal — typically an intro, one or two follow-ups, and a breakup. Reuse',
    'the templates AS-IS (do not invent new content); just choose which to use, in',
    'what order, and the wait-days between them. You may use a template at most once.',
    '',
    `Goal: ${instruction}`,
    '',
    'AVAILABLE TEMPLATES (refer to them by [index]):',
    list,
    '',
    'Respond with JSON: { "name": "<short sequence name>", "steps": [',
    '  { "index": <a template index from the list above>, "delayDays": <int: 0 for step 1, else days to wait after the previous step> }',
    '] }. Step 1 must have delayDays 0. Only use indices that appear in the list.',
  ].join('\n')

  const raw = await generateJson(llmPrompt, 'engage_sequence_ai')
  let parsed: { name?: string; steps?: Array<{ index?: number; delayDays?: number }> }
  try {
    parsed = JSON.parse(raw)
  } catch {
    const m = raw.match(/\{[\s\S]*\}/)
    parsed = m ? JSON.parse(m[0]) : {}
  }
  const seqName = (parsed.name || 'AI sequence').trim()
  const rawSteps = Array.isArray(parsed.steps) ? parsed.steps.slice(0, 6) : []

  const steps: Array<{ templateId: string; delayDays: number; templateName: string }> = []
  const used = new Set<number>()
  for (const s of rawSteps) {
    const idx = Number(s.index)
    if (!Number.isInteger(idx) || idx < 0 || idx >= templates.length || used.has(idx)) continue
    used.add(idx)
    const t = templates[idx]
    steps.push({
      templateId: String(t.id),
      delayDays: steps.length === 0 ? 0 : Math.max(1, Math.trunc(Number(s.delayDays ?? 2))),
      templateName: String(t.name),
    })
  }
  // Fallback: if the AI returned nothing usable, seed with the first template.
  if (!steps.length) {
    steps.push({ templateId: String(templates[0].id), delayDays: 0, templateName: String(templates[0].name) })
  }
  return { name: seqName, steps }
}

export async function deleteEngageTemplate(id: string) {
  const supabase = await createClient()
  const { orgId } = await getCurrentActor(supabase)
  const { error } = await supabase
    .from('engage_templates')
    .delete()
    .eq('organization_id', orgId)
    .eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/engage/templates')
}

export async function getEngageSequences(): Promise<EngageSequence[]> {
  const supabase = await createClient()
  const { orgId } = await getCurrentActor(supabase)
  const { data, error } = await supabase
    .from('engage_sequences')
    .select('*')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
  if (error) return []
  return (data ?? []).map((x) => ({
    id: String(x.id),
    name: String(x.name),
    steps: Array.isArray(x.steps)
      ? x.steps.map((s: unknown, idx: number) => {
          const step = (s ?? {}) as { id?: unknown; templateId?: unknown; delayDays?: unknown }
          return {
            id: String(step.id ?? `step-${idx}`),
            templateId: String(step.templateId ?? ''),
            delayDays: Number(step.delayDays ?? 1),
          }
        })
      : [],
  }))
}

export async function createEngageSequence(input: Omit<EngageSequence, 'id'>) {
  const supabase = await createClient()
  const { orgId, userId } = await getCurrentActor(supabase)
  const { error } = await supabase.from('engage_sequences').insert({
    organization_id: orgId,
    created_by: userId,
    name: input.name,
    steps: input.steps,
  })
  if (error) throw new Error(error.message)
  revalidatePath('/engage/sequences')
}

export async function updateEngageSequence(id: string, input: Omit<EngageSequence, 'id'>) {
  const supabase = await createClient()
  const { orgId } = await getCurrentActor(supabase)
  const { error } = await supabase
    .from('engage_sequences')
    .update({ name: input.name, steps: input.steps, updated_at: new Date().toISOString() })
    .eq('organization_id', orgId)
    .eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/engage/sequences')
}

export async function deleteEngageSequence(id: string) {
  const supabase = await createClient()
  const { orgId } = await getCurrentActor(supabase)
  const { error } = await supabase
    .from('engage_sequences')
    .delete()
    .eq('organization_id', orgId)
    .eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/engage/sequences')
}

export async function deleteEngageCampaign(id: string) {
  const supabase = await createClient()
  const { orgId } = await getCurrentActor(supabase)
  // engage_campaign_recipients cascade-delete via FK ON DELETE CASCADE.
  const { error } = await supabase
    .from('engage_campaigns')
    .delete()
    .eq('organization_id', orgId)
    .eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/engage/campaigns')
}

// Emailable prospects come from the GTM `leads_raw` table (the same source the
// outreach_* tables reference via lead_id). The CRM `leads` table only stores
// name + phone, so it cannot back an email campaign audience.
export async function getEngageLeads(): Promise<EngageLead[]> {
  const supabase = await createClient()
  const { orgId } = await getCurrentActor(supabase)
  const { data, error } = await supabase
    .from('leads_raw')
    .select('id, contact_name, contact_email, company_name')
    .eq('organization_id', orgId)
    .not('contact_email', 'is', null)
    .order('icp_score', { ascending: false, nullsFirst: false })
    .limit(200)
  if (error) return []
  return (data ?? []).map((x) => ({
    id: String(x.id),
    name: String(x.contact_name || x.company_name || 'Unknown'),
    email: String(x.contact_email || ''),
    company: String(x.company_name || ''),
  }))
}

// Aggregates real outreach engagement into Instantly-style analytics: totals,
// unique-based rates, a per-day series, plus per-campaign and per-account
// breakdowns. Source tables: outreach_log / outreach_opens / outreach_clicks /
// outreach_replies / outreach_unsubscribes (shared by composer sends, Engage
// campaigns, and the GTM Phase 3 pipeline).
export async function getEngageAnalytics(days: number = 30): Promise<EngageAnalyticsData> {
  const empty: EngageAnalyticsData = {
    totals: {
      sends: 0, opens: 0, uniqueOpens: 0, clicks: 0, uniqueClicks: 0,
      replies: 0, uniqueReplies: 0, unsubscribes: 0, opportunities: 0,
    },
    openRate: 0,
    clickRate: 0,
    replyRate: 0,
    unsubscribeRate: 0,
    timeSeries: [],
    campaigns: [],
    accounts: [],
  }

  const supabase = await createClient()
  let orgId: string
  try {
    ;({ orgId } = await getCurrentActor(supabase))
  } catch {
    return empty
  }

  const since = new Date()
  since.setDate(since.getDate() - days)
  const sinceISO = since.toISOString()

  const [sendsRes, opensRes, clicksRes, repliesRes, unsubsRes] = await Promise.all([
    supabase
      .from('outreach_log')
      .select('sent_at, created_at, campaign_id, contact_email, status')
      .eq('organization_id', orgId)
      .gte('created_at', sinceISO),
    supabase
      .from('outreach_opens')
      .select('opened_at, created_at, campaign_id, email')
      .eq('organization_id', orgId)
      .gte('created_at', sinceISO),
    supabase
      .from('outreach_clicks')
      .select('clicked_at, created_at, campaign_id, email')
      .eq('organization_id', orgId)
      .gte('created_at', sinceISO),
    supabase
      .from('outreach_replies')
      .select('replied_at, created_at, campaign_id, email, classification')
      .eq('organization_id', orgId)
      .gte('created_at', sinceISO),
    supabase
      .from('outreach_unsubscribes')
      .select('unsubscribed_at, created_at, campaign_id, email')
      .eq('organization_id', orgId)
      .gte('created_at', sinceISO),
  ])

  const sends = (sendsRes.data ?? []).filter((s) => (s.status ?? 'sent') === 'sent')
  const opens = opensRes.data ?? []
  const clicks = clicksRes.data ?? []
  const replies = repliesRes.data ?? []
  const unsubs = unsubsRes.data ?? []

  const uniqueBy = (rows: Array<{ email?: string | null }>) =>
    new Set(rows.map((r) => String(r.email ?? '').toLowerCase()).filter(Boolean)).size
  const POSITIVE = new Set(['interested'])

  const totals = {
    sends: sends.length,
    opens: opens.length,
    uniqueOpens: uniqueBy(opens),
    clicks: clicks.length,
    uniqueClicks: uniqueBy(clicks),
    replies: replies.length,
    uniqueReplies: uniqueBy(replies),
    unsubscribes: unsubs.length,
    opportunities: replies.filter((r) => POSITIVE.has(String(r.classification ?? ''))).length,
  }

  type Bucket = { sends: number; opens: number; clicks: number; replies: number; unsubscribes: number }
  const byDate: Record<string, Bucket> = {}
  const addToBucket = (dt: string | null | undefined, key: keyof Bucket) => {
    if (!dt) return
    const parsed = new Date(dt)
    if (Number.isNaN(parsed.getTime())) return
    const date = parsed.toISOString().split('T')[0]
    if (!byDate[date]) byDate[date] = { sends: 0, opens: 0, clicks: 0, replies: 0, unsubscribes: 0 }
    byDate[date][key] += 1
  }
  sends.forEach((r) => addToBucket(r.sent_at ?? r.created_at, 'sends'))
  opens.forEach((r) => addToBucket(r.opened_at ?? r.created_at, 'opens'))
  clicks.forEach((r) => addToBucket(r.clicked_at ?? r.created_at, 'clicks'))
  replies.forEach((r) => addToBucket(r.replied_at ?? r.created_at, 'replies'))
  unsubs.forEach((r) => addToBucket(r.unsubscribed_at ?? r.created_at, 'unsubscribes'))

  const timeSeries = Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, bucket]) => ({ date, ...bucket }))

  // ---- Campaign breakdown ----------------------------------------------------
  const [campaignsRes, recipientsRes] = await Promise.all([
    supabase
      .from('engage_campaigns')
      .select('id, name, status')
      .eq('organization_id', orgId),
    supabase
      .from('engage_campaign_recipients')
      .select('campaign_id, status')
      .eq('organization_id', orgId),
  ])

  const campaignNames = new Map<string, { name: string; status: string }>()
  for (const c of campaignsRes.data ?? []) {
    campaignNames.set(String(c.id), { name: String(c.name), status: String(c.status) })
  }

  type CampAgg = {
    sent: number
    opens: number
    openEmails: Set<string>
    clicks: number
    clickEmails: Set<string>
    replies: number
    opportunities: number
  }
  const campAgg = new Map<string, CampAgg>()
  const aggFor = (cid: string): CampAgg => {
    let agg = campAgg.get(cid)
    if (!agg) {
      agg = { sent: 0, opens: 0, openEmails: new Set(), clicks: 0, clickEmails: new Set(), replies: 0, opportunities: 0 }
      campAgg.set(cid, agg)
    }
    return agg
  }
  sends.forEach((r) => { if (r.campaign_id) aggFor(String(r.campaign_id)).sent += 1 })
  opens.forEach((r) => {
    if (!r.campaign_id) return
    const a = aggFor(String(r.campaign_id))
    a.opens += 1
    if (r.email) a.openEmails.add(String(r.email).toLowerCase())
  })
  clicks.forEach((r) => {
    if (!r.campaign_id) return
    const a = aggFor(String(r.campaign_id))
    a.clicks += 1
    if (r.email) a.clickEmails.add(String(r.email).toLowerCase())
  })
  replies.forEach((r) => {
    if (!r.campaign_id) return
    const a = aggFor(String(r.campaign_id))
    a.replies += 1
    if (POSITIVE.has(String(r.classification ?? ''))) a.opportunities += 1
  })

  const recipientCounts = new Map<string, { total: number; completed: number; failed: number }>()
  for (const r of recipientsRes.data ?? []) {
    const cid = String(r.campaign_id)
    const entry = recipientCounts.get(cid) ?? { total: 0, completed: 0, failed: 0 }
    entry.total += 1
    if (r.status === 'completed' || r.status === 'replied') entry.completed += 1
    if (r.status === 'failed') entry.failed += 1
    recipientCounts.set(cid, entry)
  }

  const campaignIds = new Set<string>([...campAgg.keys(), ...campaignNames.keys()])
  const campaigns: EngageCampaignStats[] = Array.from(campaignIds).map((cid) => {
    const meta = campaignNames.get(cid)
    const a = campAgg.get(cid)
    const rec = recipientCounts.get(cid)
    return {
      campaignId: cid,
      name: meta?.name ?? (cid === 'manual' ? 'Manual sends (composer)' : cid.startsWith('gmail-') || cid.startsWith('instantly-') ? `GTM pipeline · ${cid}` : cid),
      status: meta?.status ?? 'external',
      recipients: rec?.total ?? a?.sent ?? 0,
      sent: a?.sent ?? 0,
      opens: a?.opens ?? 0,
      uniqueOpens: a?.openEmails.size ?? 0,
      clicks: a?.clicks ?? 0,
      uniqueClicks: a?.clickEmails.size ?? 0,
      replies: a?.replies ?? 0,
      opportunities: a?.opportunities ?? 0,
      completed: rec?.completed ?? 0,
      failed: rec?.failed ?? 0,
    }
  }).sort((x, y) => y.sent - x.sent)

  // ---- Account breakdown -------------------------------------------------------
  const { data: mailboxes } = await supabase
    .from('engage_mailboxes')
    .select('email, provider, connected_at, last_synced_at, gmail_watch_expiration')
    .eq('organization_id', orgId)

  const accounts: EngageAccountStats[] = (mailboxes ?? []).map((mb) => ({
    email: String(mb.email),
    provider: String(mb.provider ?? 'gmail'),
    connectedAt: mb.connected_at ? String(mb.connected_at) : null,
    lastSyncedAt: mb.last_synced_at ? String(mb.last_synced_at) : null,
    watchActive: Boolean(
      mb.gmail_watch_expiration && new Date(String(mb.gmail_watch_expiration)).getTime() > Date.now(),
    ),
    // Single-mailbox setup: org-wide counters map 1:1 to the account.
    sent: totals.sends,
    opens: totals.opens,
    replies: totals.replies,
    bounces: 0,
  }))

  return {
    totals,
    openRate: totals.sends > 0 ? (totals.uniqueOpens / totals.sends) * 100 : 0,
    clickRate: totals.sends > 0 ? (totals.uniqueClicks / totals.sends) * 100 : 0,
    replyRate: totals.sends > 0 ? (totals.uniqueReplies / totals.sends) * 100 : 0,
    unsubscribeRate: totals.sends > 0 ? (totals.unsubscribes / totals.sends) * 100 : 0,
    timeSeries,
    campaigns,
    accounts,
  }
}

// --------------------------------------------------------------------------- //
// Daily GTM automation schedule (3 AM scrape -> enrich -> score -> send)
// --------------------------------------------------------------------------- //
// One row per organization in gtm_schedules; the gtm_service scheduler loop
// reads it every minute and fires the phase pipeline at the configured time.

export async function getGtmSchedule(): Promise<GtmScheduleConfig | null> {
  const supabase = await createClient()
  let orgId: string
  try {
    ;({ orgId } = await getCurrentActor(supabase))
  } catch {
    return null
  }
  const { data } = await supabase
    .from('gtm_schedules')
    .select('*')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!data) return null
  return {
    id: String(data.id),
    icpId: data.icp_id != null ? Number(data.icp_id) : null,
    enabled: Boolean(data.enabled),
    runHour: Number(data.run_hour ?? 3),
    runMinute: Number(data.run_minute ?? 0),
    timezone: String(data.timezone ?? 'Asia/Kolkata'),
    leadsPerDay: Number(data.leads_per_day ?? 25),
    sender: (data.sender === 'instantly' ? 'instantly' : 'gmail'),
    autoSend: Boolean(data.auto_send ?? true),
    lastRunDate: data.last_run_date ? String(data.last_run_date) : null,
    lastRunStatus: data.last_run_status ? String(data.last_run_status) : null,
  }
}

export async function saveGtmSchedule(input: Omit<GtmScheduleConfig, 'lastRunDate' | 'lastRunStatus'>) {
  const supabase = await createClient()
  const { orgId } = await getCurrentActor(supabase)
  const payload = {
    organization_id: orgId,
    icp_id: input.icpId,
    enabled: input.enabled,
    run_hour: Math.min(23, Math.max(0, Math.trunc(input.runHour))),
    run_minute: Math.min(59, Math.max(0, Math.trunc(input.runMinute))),
    timezone: input.timezone || 'Asia/Kolkata',
    leads_per_day: Math.min(500, Math.max(1, Math.trunc(input.leadsPerDay))),
    sender: input.sender,
    auto_send: input.autoSend,
    updated_at: new Date().toISOString(),
  }
  const { data: existing } = await supabase
    .from('gtm_schedules')
    .select('id')
    .eq('organization_id', orgId)
    .limit(1)
    .maybeSingle()
  const { error } = existing
    ? await supabase.from('gtm_schedules').update(payload).eq('id', existing.id)
    : await supabase.from('gtm_schedules').insert(payload)
  if (error) throw new Error(error.message)
  revalidatePath('/engage/settings')
}

export async function getIcpOptions(): Promise<Array<{ id: number; name: string }>> {
  const supabase = await createClient()
  try {
    await getCurrentActor(supabase)
  } catch {
    return []
  }
  const { data } = await supabase
    .from('icp_profiles')
    .select('id, name')
    .order('id', { ascending: true })
    .limit(100)
  return (data ?? []).map((x) => ({ id: Number(x.id), name: String(x.name ?? `ICP ${x.id}`) }))
}

// --------------------------------------------------------------------------- //
// Unibox metadata (Instantly-style filters: Status / Campaign / Inbox)
// --------------------------------------------------------------------------- //
// Maps Gmail threads to the campaign + lead interest-status they belong to, so
// the inbox can be filtered by lead label (Interested, Won, …), by campaign,
// and by mailbox — exactly like Instantly's Unibox left rail.
// NB: types live in '@/types/engage' — a 'use server' module may only export
// async functions, not types.

export async function getUniboxMeta(): Promise<import('@/types/engage').UniboxMeta> {
  const empty: import('@/types/engage').UniboxMeta = { byThread: {}, campaigns: [], mailboxes: [], statusCounts: {} }
  const supabase = await createClient()
  let orgId: string
  try {
    ;({ orgId } = await getCurrentActor(supabase))
  } catch {
    return empty
  }

  const [recipientsRes, campaignsRes, mailboxesRes] = await Promise.all([
    supabase
      .from('engage_campaign_recipients')
      .select('id, campaign_id, gmail_thread_id, interest_status, status, last_error')
      .eq('organization_id', orgId)
      .not('gmail_thread_id', 'is', null),
    supabase.from('engage_campaigns').select('id, name').eq('organization_id', orgId).order('created_at', { ascending: false }),
    supabase.from('engage_mailboxes').select('email').eq('organization_id', orgId),
  ])

  const nameById = new Map<string, string>()
  for (const c of campaignsRes.data ?? []) nameById.set(String(c.id), String(c.name))

  const byThread: Record<string, import('@/types/engage').UniboxThreadMeta> = {}
  const statusCounts: Record<string, number> = {}
  for (const r of recipientsRes.data ?? []) {
    const threadId = String(r.gmail_thread_id)
    const status = (r.interest_status ?? 'lead') as import('@/types/engage').InterestStatus
    // engage-sync marks a bounced recipient status='stopped', last_error='bounced'.
    const bounced = r.status === 'stopped' && r.last_error === 'bounced'
    byThread[threadId] = {
      campaignId: r.campaign_id ? String(r.campaign_id) : null,
      campaignName: r.campaign_id ? nameById.get(String(r.campaign_id)) ?? null : null,
      interestStatus: status,
      recipientId: String(r.id),
      bounced,
    }
    statusCounts[status] = (statusCounts[status] ?? 0) + 1
  }

  return {
    byThread,
    campaigns: (campaignsRes.data ?? []).map((c) => ({ id: String(c.id), name: String(c.name) })),
    mailboxes: (mailboxesRes.data ?? []).map((m) => ({ email: String(m.email) })),
    statusCounts,
  }
}

// Set a lead's interest label from the Unibox (by thread).
export async function setThreadInterest(threadId: string, status: import('@/types/engage').InterestStatus) {
  const supabase = await createClient()
  const { orgId } = await getCurrentActor(supabase)
  const { error } = await supabase
    .from('engage_campaign_recipients')
    .update({ interest_status: status, updated_at: new Date().toISOString() })
    .eq('organization_id', orgId)
    .eq('gmail_thread_id', threadId)
  if (error) throw new Error(error.message)
  revalidatePath('/engage/inbox')
}

// --------------------------------------------------------------------------- //
// Conversations (real two-way threads)
// --------------------------------------------------------------------------- //
// Source tables: `conversations` (thread per lead), `messages` (turns) and
// `ai_insights` (intent / sentiment / suggested reply). `conversations.lead_id`
// references the CRM `leads` table (name + phone). Everything is org-scoped in
// this layer because RLS is disabled project-wide (same convention as crm.ts).


// Email reply conversations: surface Gmail threads where a lead replied to our
// outreach as ConversationThread items, so email replies show up in the
// Conversations page alongside WhatsApp chats (not only in the Unibox).
export async function getEmailConversations(): Promise<ConversationThread[]> {
  const supabase = await createClient()
  let orgId: string
  try {
    ;({ orgId } = await getCurrentActor(supabase))
  } catch {
    return []
  }

  // Threads that received a reply (outreach_replies), with classification.
  const { data: repliesRaw } = await supabase
    .from('outreach_replies')
    .select('thread_id, email, classification, replied_at')
    .eq('organization_id', orgId)
    .not('thread_id', 'is', null)
    .order('replied_at', { ascending: false })
    .limit(100)
  // Defensively drop bounce/mailer-daemon "replies" — only real human replies
  // become conversations.
  const replies = (repliesRaw ?? []).filter((r) => !/mailer-daemon|postmaster|no-?reply/i.test(String(r.email ?? '')))
  if (!replies.length) return []

  const threadIds: string[] = Array.from(new Set<string>(replies.map((r) => String(r.thread_id))))
  const replyByThread = new Map<string, { classification: string | null; repliedAt: string | null; email: string }>()
  for (const r of replies) {
    const t = String(r.thread_id)
    if (!replyByThread.has(t)) {
      replyByThread.set(t, { classification: r.classification ?? null, repliedAt: r.replied_at ?? null, email: String(r.email ?? '') })
    }
  }

  // The emails in those threads (both directions) + recipient names.
  const [emailsRes, recipientsRes] = await Promise.all([
    supabase
      .from('engage_emails')
      .select('gmail_message_id, gmail_thread_id, from_email, to_email, subject, snippet, direction, received_at, unread')
      .eq('organization_id', orgId)
      .in('gmail_thread_id', threadIds)
      .order('received_at', { ascending: true }),
    supabase
      .from('engage_campaign_recipients')
      .select('gmail_thread_id, name, company, interest_status')
      .eq('organization_id', orgId)
      .in('gmail_thread_id', threadIds),
  ])

  const recipientByThread = new Map<string, { name: string; company: string; interest: string }>()
  for (const r of recipientsRes.data ?? []) {
    if (r.gmail_thread_id) {
      recipientByThread.set(String(r.gmail_thread_id), {
        name: String(r.name ?? ''),
        company: String(r.company ?? ''),
        interest: String(r.interest_status ?? 'lead'),
      })
    }
  }

  const emailsByThread = new Map<string, ConversationMessage[]>()
  const lastReceivedByThread = new Map<string, string>()
  for (const e of emailsRes.data ?? []) {
    const t = String(e.gmail_thread_id)
    const list = emailsByThread.get(t) ?? []
    const sent = e.direction === 'sent'
    list.push({
      id: String(e.gmail_message_id),
      senderType: sent ? 'agent' : 'user',
      messageType: 'text',
      content: `${e.subject ? `${e.subject}\n` : ''}${e.snippet ?? ''}`.trim(),
      mediaUrl: null,
      status: 'delivered',
      createdAt: String(e.received_at ?? new Date().toISOString()),
    })
    emailsByThread.set(t, list)
    if (!sent) lastReceivedByThread.set(t, String(e.received_at ?? ''))
  }

  const INTENT_LABEL: Record<string, string> = {
    interested: 'Interested', not_now: 'Not now', wrong_person: 'Wrong person',
    not_interested: 'Not interested', auto_reply: 'Auto-reply', unknown: 'Replied',
  }

  return threadIds.map((t) => {
    const rec = recipientByThread.get(t)
    const rep = replyByThread.get(t)
    const cls = rep?.classification ?? 'unknown'
    return {
      id: `email-${t}`,
      leadName: rec?.name || rep?.email || 'Email lead',
      leadPhone: rec?.company || (rep?.email ?? null),
      unreadCount: 0,
      lastCustomerMessageAt: lastReceivedByThread.get(t) || rep?.repliedAt || null,
      createdAt: rep?.repliedAt || new Date().toISOString(),
      messages: emailsByThread.get(t) ?? [],
      insight: {
        intent: INTENT_LABEL[cls] ?? 'Replied',
        sentiment: cls === 'interested' ? 'positive' : cls === 'not_interested' ? 'negative' : null,
        suggestedReply: null,
        urgency: cls === 'interested' ? 'high' : null,
      },
    }
  })
}

export async function getConversations(): Promise<ConversationThread[]> {
  const supabase = await createClient()
  let orgId: string
  try {
    ;({ orgId } = await getCurrentActor(supabase))
  } catch {
    return []
  }

  const { data: convos, error } = await supabase
    .from('conversations')
    .select(
      'id, unread_count, last_customer_message_at, created_at, lead:leads(name, phone_number)'
    )
    .eq('organization_id', orgId)
    .order('last_customer_message_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(100)
  if (error || !convos || convos.length === 0) return []

  const conversationIds = convos.map((c) => String(c.id))

  const [messagesRes, insightsRes] = await Promise.all([
    supabase
      .from('messages')
      .select('id, conversation_id, sender_type, message_type, content, media_url, status, created_at')
      .eq('organization_id', orgId)
      .in('conversation_id', conversationIds)
      .order('created_at', { ascending: true }),
    supabase
      .from('ai_insights')
      .select('conversation_id, intent, sentiment, suggested_reply, urgency, created_at')
      .eq('organization_id', orgId)
      .in('conversation_id', conversationIds)
      .order('created_at', { ascending: false }),
  ])

  const messagesByConvo = new Map<string, ConversationMessage[]>()
  for (const m of messagesRes.data ?? []) {
    const key = String(m.conversation_id)
    const list = messagesByConvo.get(key) ?? []
    list.push({
      id: String(m.id),
      senderType: String(m.sender_type ?? 'system'),
      messageType: String(m.message_type ?? 'text'),
      content: String(m.content ?? ''),
      mediaUrl: m.media_url ? String(m.media_url) : null,
      status: String(m.status ?? 'unknown'),
      createdAt: String(m.created_at ?? new Date().toISOString()),
    })
    messagesByConvo.set(key, list)
  }

  // ai_insights ordered newest-first; keep the latest insight per conversation.
  const insightByConvo = new Map<string, ConversationInsight>()
  for (const i of insightsRes.data ?? []) {
    const key = String(i.conversation_id)
    if (insightByConvo.has(key)) continue
    insightByConvo.set(key, {
      intent: i.intent ? String(i.intent) : null,
      sentiment: i.sentiment ? String(i.sentiment) : null,
      suggestedReply: i.suggested_reply ? String(i.suggested_reply) : null,
      urgency: i.urgency ? String(i.urgency) : null,
    })
  }

  return convos.map((c) => {
    const lead = Array.isArray(c.lead) ? c.lead[0] : c.lead
    const id = String(c.id)
    return {
      id,
      leadName: String(lead?.name || 'Unknown contact'),
      leadPhone: lead?.phone_number ? String(lead.phone_number) : null,
      unreadCount: Number(c.unread_count ?? 0),
      lastCustomerMessageAt: c.last_customer_message_at ? String(c.last_customer_message_at) : null,
      createdAt: String(c.created_at ?? new Date().toISOString()),
      messages: messagesByConvo.get(id) ?? [],
      insight: insightByConvo.get(id) ?? null,
    }
  })
}

// --------------------------------------------------------------------------- //
// Unsubscribes
// --------------------------------------------------------------------------- //
// Source table: `outreach_unsubscribes` (Phase 3 Agent 14 engagement tracking).
// Read-only list surfaced in Engage Settings so operators can audit suppressed
// recipients. Org-scoped in this layer (RLS disabled project-wide).


export async function getUnsubscribes(): Promise<UnsubscribeRow[]> {
  const supabase = await createClient()
  let orgId: string
  try {
    ;({ orgId } = await getCurrentActor(supabase))
  } catch {
    return []
  }

  const { data, error } = await supabase
    .from('outreach_unsubscribes')
    .select('email, campaign_id, unsubscribed_at, created_at')
    .eq('organization_id', orgId)
    .order('unsubscribed_at', { ascending: false, nullsFirst: false })
    .limit(500)
  if (error) return []

  return (data ?? []).map((x) => ({
    email: String(x.email ?? ''),
    campaignId: x.campaign_id ? String(x.campaign_id) : null,
    unsubscribedAt: x.unsubscribed_at ? String(x.unsubscribed_at) : x.created_at ? String(x.created_at) : null,
  }))
}

// =========================================================================
// Email Accounts dashboard (Instantly-style)
// =========================================================================

export async function getEmailAccounts(): Promise<EmailAccount[]> {
  const supabase = await createClient()
  let orgId: string
  try {
    ;({ orgId } = await getCurrentActor(supabase))
  } catch {
    return []
  }

  const { data: mailboxes } = await supabase
    .from('engage_mailboxes')
    .select(`
      id, email, provider, status, connected_at, last_synced_at,
      gmail_watch_expiration, daily_send_limit,
      warmup_enabled, warmup_started_at, warmup_daily_limit,
      warmup_reply_rate, warmup_open_rate,
      warmup_spam_rescue_pct, warmup_mark_important_pct,
      mailbox_tags ( tag_id, account_tags ( id, name, color ) )
    `)
    .eq('organization_id', orgId)
    .order('connected_at', { ascending: false })

  if (!mailboxes?.length) return []

  // Warmup emails sent in last 7 days per mailbox
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data: warmupRows } = await supabase
    .from('engage_warmup_log')
    .select('mailbox_id, placed_inbox')
    .eq('organization_id', orgId)
    .gte('sent_at', sevenDaysAgo)

  const warmupByMailbox: Record<string, { total: number; inbox: number }> = {}
  for (const w of warmupRows ?? []) {
    const key = String(w.mailbox_id)
    if (!warmupByMailbox[key]) warmupByMailbox[key] = { total: 0, inbox: 0 }
    warmupByMailbox[key].total++
    if (w.placed_inbox === true) warmupByMailbox[key].inbox++
  }

  // Sends today per mailbox (forward-tracked via mailbox_id on outreach_log)
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const { data: todaySends } = await supabase
    .from('outreach_log')
    .select('mailbox_id')
    .eq('organization_id', orgId)
    .eq('status', 'sent')
    .gte('sent_at', todayStart.toISOString())
    .not('mailbox_id', 'is', null)

  const sentTodayByMailbox: Record<string, number> = {}
  for (const s of todaySends ?? []) {
    const key = String(s.mailbox_id)
    sentTodayByMailbox[key] = (sentTodayByMailbox[key] ?? 0) + 1
  }

  // Campaign analytics per mailbox (all-time open+reply for combined score)
  const { data: analyticsRows } = await supabase
    .from('outreach_log')
    .select('mailbox_id, status')
    .eq('organization_id', orgId)
    .not('mailbox_id', 'is', null)

  const analyticsByMailbox: Record<string, { sent: number; opens: number; replies: number; clicks: number }> = {}
  for (const r of analyticsRows ?? []) {
    const key = String(r.mailbox_id)
    if (!analyticsByMailbox[key]) analyticsByMailbox[key] = { sent: 0, opens: 0, replies: 0, clicks: 0 }
    analyticsByMailbox[key].sent++
  }

  return mailboxes.map((mb) => {
    const id = String(mb.id)
    const warmup = warmupByMailbox[id] ?? { total: 0, inbox: 0 }
    const healthScore =
      warmup.total > 0 ? Math.round((warmup.inbox / warmup.total) * 100) : null
    const analytics = analyticsByMailbox[id] ?? { sent: 0, opens: 0, replies: 0, clicks: 0 }
    const combinedScore =
      analytics.sent >= 100
        ? Math.round(
            ((analytics.opens / analytics.sent) * 0.5 + (analytics.replies / analytics.sent) * 0.5) * 100,
          )
        : null

    const rawTags = (mb.mailbox_tags as any[]) ?? []
    const tags: AccountTag[] = rawTags
      .map((mt: any) => mt.account_tags)
      .filter(Boolean)
      .map((t: any) => ({ id: String(t.id), name: String(t.name), color: String(t.color) }))

    return {
      id,
      email: String(mb.email),
      provider: String(mb.provider ?? 'gmail'),
      status: (mb.status ?? 'active') as EmailAccount['status'],
      connectedAt: mb.connected_at ? String(mb.connected_at) : null,
      lastSyncedAt: mb.last_synced_at ? String(mb.last_synced_at) : null,
      watchActive: Boolean(
        mb.gmail_watch_expiration &&
          new Date(String(mb.gmail_watch_expiration)).getTime() > Date.now(),
      ),
      dailySendLimit: Number(mb.daily_send_limit ?? 50),
      sentToday: sentTodayByMailbox[id] ?? 0,
      warmupEnabled: Boolean(mb.warmup_enabled),
      warmupStartedAt: mb.warmup_started_at ? String(mb.warmup_started_at) : null,
      warmupDailyLimit: Number(mb.warmup_daily_limit ?? 10),
      warmupReplyRate: Number(mb.warmup_reply_rate ?? 30),
      warmupOpenRate: Number(mb.warmup_open_rate ?? 50),
      warmupSpamRescuePct: Number(mb.warmup_spam_rescue_pct ?? 20),
      warmupMarkImportantPct: Number(mb.warmup_mark_important_pct ?? 20),
      warmupEmails7d: warmup.total,
      healthScore,
      combinedScore,
      sent: analytics.sent,
      opens: analytics.opens,
      clicks: analytics.clicks,
      replies: analytics.replies,
      tags,
    }
  })
}

export async function updateAccountSettings(
  id: string,
  settings: AccountSettingsInput,
): Promise<{ error?: string }> {
  const supabase = await createClient()
  let orgId: string
  try {
    ;({ orgId } = await getCurrentActor(supabase))
  } catch {
    return { error: 'Unauthorized' }
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (settings.status !== undefined) patch.status = settings.status
  if (settings.dailySendLimit !== undefined) patch.daily_send_limit = settings.dailySendLimit
  if (settings.warmupEnabled !== undefined) {
    patch.warmup_enabled = settings.warmupEnabled
    if (settings.warmupEnabled && !patch.warmup_started_at) {
      patch.warmup_started_at = new Date().toISOString()
    }
  }
  if (settings.warmupDailyLimit !== undefined) patch.warmup_daily_limit = settings.warmupDailyLimit
  if (settings.warmupReplyRate !== undefined) patch.warmup_reply_rate = settings.warmupReplyRate
  if (settings.warmupOpenRate !== undefined) patch.warmup_open_rate = settings.warmupOpenRate
  if (settings.warmupSpamRescuePct !== undefined) patch.warmup_spam_rescue_pct = settings.warmupSpamRescuePct
  if (settings.warmupMarkImportantPct !== undefined) patch.warmup_mark_important_pct = settings.warmupMarkImportantPct

  const { error } = await supabase
    .from('engage_mailboxes')
    .update(patch)
    .eq('id', id)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }
  revalidatePath('/engage/accounts')
  return {}
}

export async function bulkUpdateAccounts(
  ids: string[],
  action: 'enable_warmup' | 'pause_warmup' | 'unpause' | 'pause',
): Promise<{ error?: string }> {
  if (!ids.length) return {}
  const supabase = await createClient()
  let orgId: string
  try {
    ;({ orgId } = await getCurrentActor(supabase))
  } catch {
    return { error: 'Unauthorized' }
  }

  let patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (action === 'enable_warmup') {
    patch = { ...patch, warmup_enabled: true, status: 'warming', warmup_started_at: new Date().toISOString() }
  } else if (action === 'pause_warmup') {
    patch = { ...patch, warmup_enabled: false }
  } else if (action === 'unpause') {
    patch = { ...patch, status: 'active' }
  } else if (action === 'pause') {
    patch = { ...patch, status: 'paused' }
  }

  const { error } = await supabase
    .from('engage_mailboxes')
    .update(patch)
    .in('id', ids)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }
  revalidatePath('/engage/accounts')
  return {}
}

export async function getAccountTags(): Promise<AccountTag[]> {
  const supabase = await createClient()
  let orgId: string
  try {
    ;({ orgId } = await getCurrentActor(supabase))
  } catch {
    return []
  }

  const { data } = await supabase
    .from('account_tags')
    .select('id, name, color')
    .eq('organization_id', orgId)
    .order('name')

  return (data ?? []).map((t) => ({
    id: String(t.id),
    name: String(t.name),
    color: String(t.color ?? '#6366f1'),
  }))
}

export async function createAccountTag(
  name: string,
  color = '#6366f1',
): Promise<{ tag?: AccountTag; error?: string }> {
  const supabase = await createClient()
  let orgId: string
  try {
    ;({ orgId } = await getCurrentActor(supabase))
  } catch {
    return { error: 'Unauthorized' }
  }

  const { data, error } = await supabase
    .from('account_tags')
    .insert({ organization_id: orgId, name: name.trim(), color })
    .select('id, name, color')
    .single()

  if (error) return { error: error.message }
  revalidatePath('/engage/accounts')
  return { tag: { id: String(data.id), name: String(data.name), color: String(data.color) } }
}

export async function applyTagsToAccounts(
  accountIds: string[],
  tagIds: string[],
): Promise<{ error?: string }> {
  if (!accountIds.length || !tagIds.length) return {}
  const supabase = await createClient()
  try {
    await getCurrentActor(supabase)
  } catch {
    return { error: 'Unauthorized' }
  }

  const rows = accountIds.flatMap((mailboxId) =>
    tagIds.map((tagId) => ({ mailbox_id: mailboxId, tag_id: tagId })),
  )
  const { error } = await supabase.from('mailbox_tags').upsert(rows, { onConflict: 'mailbox_id,tag_id' })
  if (error) return { error: error.message }
  revalidatePath('/engage/accounts')
  return {}
}

export async function removeTagFromAccount(
  accountId: string,
  tagId: string,
): Promise<{ error?: string }> {
  const supabase = await createClient()
  try {
    await getCurrentActor(supabase)
  } catch {
    return { error: 'Unauthorized' }
  }

  const { error } = await supabase
    .from('mailbox_tags')
    .delete()
    .eq('mailbox_id', accountId)
    .eq('tag_id', tagId)

  if (error) return { error: error.message }
  revalidatePath('/engage/accounts')
  return {}
}

// SMTP account connection

function buildSmtpTransport(input: {
  smtpHost: string
  smtpPort: number
  smtpUser: string
  smtpPass: string
  smtpSecurity: 'tls' | 'ssl' | 'none'
}) {
  return nodemailer.createTransport({
    host: input.smtpHost,
    port: input.smtpPort,
    secure: input.smtpSecurity === 'ssl',
    auth: { user: input.smtpUser, pass: input.smtpPass },
    requireTLS: input.smtpSecurity === 'tls',
  })
}

export async function testSmtpConnection(input: {
  smtpHost: string
  smtpPort: number
  smtpUser: string
  smtpPass: string
  smtpSecurity: 'tls' | 'ssl' | 'none'
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const transport = buildSmtpTransport(input)
    await transport.verify()
    return { ok: true }
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : 'SMTP connection failed' }
  }
}

export async function connectSmtpAccount(input: {
  fromName: string
  smtpHost: string
  smtpPort: number
  smtpUser: string
  smtpPass: string
  smtpSecurity: 'tls' | 'ssl' | 'none'
  imapHost?: string
  imapPort?: number
}): Promise<{ error?: string }> {
  const supabase = await createClient()
  let userId: string
  let orgId: string
  try {
    ;({ userId, orgId } = await getCurrentActor(supabase))
  } catch {
    return { error: 'Unauthorized' }
  }

  const test = await testSmtpConnection({
    smtpHost: input.smtpHost,
    smtpPort: input.smtpPort,
    smtpUser: input.smtpUser,
    smtpPass: input.smtpPass,
    smtpSecurity: input.smtpSecurity,
  })
  if (!test.ok) return { error: test.error ?? 'SMTP connection failed' }

  const now = new Date().toISOString()
  const { error: upsertError } = await supabase.from('engage_mailboxes').upsert(
    {
      user_id: userId,
      organization_id: orgId,
      provider: 'smtp',
      email: input.smtpUser,
      smtp_host: input.smtpHost,
      smtp_port: input.smtpPort,
      smtp_user: input.smtpUser,
      smtp_pass: input.smtpPass,
      smtp_from_name: input.fromName,
      smtp_security: input.smtpSecurity,
      imap_host: input.imapHost ?? null,
      imap_port: input.imapPort ?? null,
      status: 'active',
      updated_at: now,
      connected_at: now,
    },
    { onConflict: 'user_id,provider,email' }
  )
  if (upsertError) return { error: upsertError.message }

  revalidatePath('/engage/accounts')
  revalidatePath('/engage/settings')
  return {}
}

