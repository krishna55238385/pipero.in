'use server'

import { revalidatePath } from 'next/cache'
// createClient retained only for syncMailboxEmails / enrollCampaignRecipients — external libs that accept SupabaseClient
import { createClient } from '@/lib/supabase/server'
import { refreshAccessToken, startGmailWatch } from '@/lib/gmail'
import { syncMailboxEmails, type MailboxRow } from '@/lib/engage-sync'
import { enrollCampaignRecipients, runEngageWorker, type WorkerReport } from '@/lib/engage-worker'
import { runWarmupCycle } from '@/lib/engage-warmup'
import { generateJson } from '@/lib/llm'
import nodemailer from 'nodemailer'
import pool from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
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

async function getCurrentActor() {
  const session = await getSessionUser()
  if (!session) throw new Error('Authentication required')
  if (!session.orgId) throw new Error('No organization found')
  return { userId: session.userId, orgId: session.orgId, role: session.role }
}

async function requireMailWrite() {
  const actor = await getCurrentActor()
  const { resolveMailPermissions, hasMailPermission } = await import('@/lib/mail-permissions')
  const perms = resolveMailPermissions(actor.role)
  if (!hasMailPermission(perms, 'mail.write')) {
    throw new Error('Permission denied')
  }
  return actor
}

export async function getMailPermissionsForClient() {
  try {
    const actor = await getCurrentActor()
    const { resolveMailPermissions } = await import('@/lib/mail-permissions')
    return resolveMailPermissions(actor.role)
  } catch {
    return { canRead: false, canWrite: false, canManage: false, canAdmin: false }
  }
}

export async function upsertGmailMailbox(input: {
  email: string
  accessToken: string
  refreshToken?: string
  tokenType?: string
  scope?: string
  expiresIn?: number
}) {
  const { userId, orgId } = await getCurrentActor()
  const expiresAt = input.expiresIn
    ? new Date(Date.now() + input.expiresIn * 1000).toISOString()
    : null
  const now = new Date().toISOString()

  const { encrypt } = await import('@/lib/encryption')
  let encryptedAccess: string | null = null
  let encryptedRefresh: string | null = null
  try {
    encryptedAccess = encrypt(input.accessToken)
    encryptedRefresh = input.refreshToken ? encrypt(input.refreshToken) : null
  } catch (err) {
    // MAIL_ENCRYPTION_KEY may be unset in some envs — fall back to legacy columns only
    const { safeLogMessage } = await import('@/lib/credential-safety')
    console.error('[engage] token encryption unavailable:', safeLogMessage(err))
  }

  // Prefer encrypted dual-write when columns exist; otherwise legacy plaintext path.
  if (encryptedAccess) {
    try {
      await pool.query(
        `INSERT INTO public.engage_mailboxes
         (user_id, organization_id, provider, email, access_token, refresh_token, token_type, scope, expires_at,
          encrypted_access_token, encrypted_refresh_token, tokens_encrypted_at, updated_at, connected_at)
         VALUES ($1,$2,'gmail',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (user_id, provider, email) DO UPDATE SET
           access_token = EXCLUDED.access_token,
           refresh_token = EXCLUDED.refresh_token,
           token_type = EXCLUDED.token_type,
           scope = EXCLUDED.scope,
           expires_at = EXCLUDED.expires_at,
           encrypted_access_token = COALESCE(EXCLUDED.encrypted_access_token, engage_mailboxes.encrypted_access_token),
           encrypted_refresh_token = COALESCE(EXCLUDED.encrypted_refresh_token, engage_mailboxes.encrypted_refresh_token),
           tokens_encrypted_at = COALESCE(EXCLUDED.tokens_encrypted_at, engage_mailboxes.tokens_encrypted_at),
           updated_at = EXCLUDED.updated_at,
           connected_at = EXCLUDED.connected_at`,
        [
          userId,
          orgId,
          input.email,
          '',
          encryptedRefresh ? '' : (input.refreshToken ?? null),
          input.tokenType ?? 'Bearer',
          input.scope ?? null,
          expiresAt,
          encryptedAccess,
          encryptedRefresh,
          now,
          now,
          now,
        ]
      )
      return
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (!/encrypted_access_token|encrypted_refresh_token|tokens_encrypted_at/i.test(message)) {
        throw err
      }
      // Migration not applied yet — fall through to legacy write
    }
  }

  await pool.query(
    `INSERT INTO public.engage_mailboxes
     (user_id, organization_id, provider, email, access_token, refresh_token, token_type, scope, expires_at, updated_at, connected_at)
     VALUES ($1,$2,'gmail',$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (user_id, provider, email) DO UPDATE SET
       access_token = EXCLUDED.access_token,
       refresh_token = EXCLUDED.refresh_token,
       token_type = EXCLUDED.token_type,
       scope = EXCLUDED.scope,
       expires_at = EXCLUDED.expires_at,
       updated_at = EXCLUDED.updated_at,
       connected_at = EXCLUDED.connected_at`,
    [
      userId,
      orgId,
      input.email,
      input.accessToken,
      input.refreshToken ?? null,
      input.tokenType ?? 'Bearer',
      input.scope ?? null,
      expiresAt,
      now,
      now,
    ]
  )
}

/** Internal row with credentials — never return this from client-facing exports. */
async function fetchGmailMailboxRow(): Promise<Record<string, unknown> | null> {
  const { userId } = await getCurrentActor()
  const r = await pool.query(
    `SELECT * FROM public.engage_mailboxes WHERE user_id = $1 AND provider = 'gmail' ORDER BY connected_at DESC LIMIT 1`,
    [userId]
  )
  return (r.rows[0] as Record<string, unknown> | undefined) ?? null
}

/** Public mailbox snapshot — credentials stripped (PRD §6.1.12). */
export async function getGmailMailbox() {
  const { toPublicEngageMailbox } = await import('@/lib/credential-safety')
  return toPublicEngageMailbox(await fetchGmailMailboxRow())
}

export async function getMailboxSyncStatus() {
  const mailbox = await fetchGmailMailboxRow()
  if (!mailbox) return null
  return {
    email: mailbox.email as string,
    lastSyncedAt: mailbox.last_synced_at as string | null,
    watchExpiration: mailbox.gmail_watch_expiration as string | null,
    historyId: mailbox.gmail_history_id as string | null,
  }
}

export async function getGmailMailboxes(): Promise<
  Array<{ id: string; email: string; lastSyncedAt: string | null; watchExpiration: string | null }>
> {
  const { userId } = await getCurrentActor()
  const r = await pool.query(
    `SELECT id, email, last_synced_at, gmail_watch_expiration FROM public.engage_mailboxes WHERE user_id = $1 AND provider = 'gmail' ORDER BY connected_at DESC`,
    [userId])
  return (r.rows ?? []).map((m: any) => ({
    id: String(m.id),
    email: m.email as string,
    lastSyncedAt: (m.last_synced_at as string | null) ?? null,
    watchExpiration: (m.gmail_watch_expiration as string | null) ?? null,
  }))
}

export async function getValidGmailAccessToken() {
  const mailbox = await fetchGmailMailboxRow()
  if (!mailbox) throw new Error('No Gmail mailbox connected')

  let accessToken = (mailbox.access_token as string | null) || null
  let refreshToken = (mailbox.refresh_token as string | null) || null

  // Only attempt decrypt when encrypted columns are present (migration applied)
  if (mailbox.encrypted_access_token || mailbox.encrypted_refresh_token) {
    try {
      const { decrypt } = await import('@/lib/encryption')
      if (mailbox.encrypted_access_token) {
        accessToken = decrypt(mailbox.encrypted_access_token as string)
      }
      if (mailbox.encrypted_refresh_token) {
        refreshToken = decrypt(mailbox.encrypted_refresh_token as string)
      }
    } catch {
      // fall back to legacy plaintext columns
    }
  }

  const exp = mailbox.expires_at ? new Date(mailbox.expires_at as string).getTime() : 0
  const soon = Date.now() + 30_000
  if (accessToken && exp > soon) return accessToken

  if (!refreshToken) throw new Error('Gmail refresh token missing')
  const refreshed = await refreshAccessToken(refreshToken)
  const expiresAt = new Date(Date.now() + (refreshed.expires_in ?? 3600) * 1000).toISOString()

  let encryptedAccess: string | null = null
  let encryptedRefresh: string | null = null
  try {
    const { encrypt } = await import('@/lib/encryption')
    encryptedAccess = encrypt(refreshed.access_token)
    encryptedRefresh = encrypt(refreshToken)
  } catch {
    // encryption optional
  }

  // Try encrypted dual-write first; fall back if migration not applied
  if (encryptedAccess) {
    try {
      await pool.query(
        `UPDATE public.engage_mailboxes SET
           access_token=$1, token_type=$2, scope=$3, expires_at=$4, updated_at=$5,
           encrypted_access_token = COALESCE($7, encrypted_access_token),
           encrypted_refresh_token = COALESCE($8, encrypted_refresh_token),
           tokens_encrypted_at = CASE WHEN $7 IS NOT NULL THEN NOW() ELSE tokens_encrypted_at END
         WHERE id=$6`,
        [
          '',
          refreshed.token_type ?? 'Bearer',
          refreshed.scope ?? mailbox.scope,
          expiresAt,
          new Date().toISOString(),
          mailbox.id,
          encryptedAccess,
          encryptedRefresh,
        ]
      )
      return refreshed.access_token
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (!/encrypted_access_token|encrypted_refresh_token|tokens_encrypted_at/i.test(message)) {
        throw err
      }
    }
  }

  await pool.query(
    `UPDATE public.engage_mailboxes SET access_token=$1, token_type=$2, scope=$3, expires_at=$4, updated_at=$5 WHERE id=$6`,
    [
      refreshed.access_token,
      refreshed.token_type ?? 'Bearer',
      refreshed.scope ?? mailbox.scope,
      expiresAt,
      new Date().toISOString(),
      mailbox.id,
    ]
  )

  return refreshed.access_token
}

export async function registerGmailWatch() {
  const mailbox = await fetchGmailMailboxRow()
  if (!mailbox) throw new Error('No Gmail mailbox connected')
  const accessToken = await getValidGmailAccessToken()
  const watch = await startGmailWatch(accessToken)
  const watchExpiration = watch.expiration ? new Date(Number(watch.expiration)).toISOString() : null

  await pool.query(
    `UPDATE public.engage_mailboxes SET gmail_history_id=$1, gmail_watch_expiration=$2, updated_at=$3 WHERE id=$4`,
    [watch.historyId ?? mailbox.gmail_history_id ?? null, watchExpiration, new Date().toISOString(), mailbox.id])

  // syncMailboxEmails uses supabase internally — external lib compat
  const supabase = await createClient()
  await syncMailboxEmails(supabase, mailbox as MailboxRow, accessToken, { maxResults: 300 })

  revalidatePath('/engage/settings')
}

export async function resyncMailboxNow() {
  const mailbox = await fetchGmailMailboxRow()
  if (!mailbox) throw new Error('No Gmail mailbox connected')
  const accessToken = await getValidGmailAccessToken()
  // syncMailboxEmails uses supabase internally — external lib compat
  const supabase = await createClient()
  const count = await syncMailboxEmails(supabase, mailbox as MailboxRow, accessToken, { maxResults: 300 })
  revalidatePath('/engage/inbox')
  revalidatePath('/engage/settings')
  return { synced: count }
}

export async function runEngageWorkerNow(): Promise<WorkerReport> {
  await getCurrentActor() // auth gate
  const report = await runEngageWorker()
  revalidatePath('/engage/campaigns')
  return report
}

export async function triggerWarmupCycle(): Promise<{ sent: number; errors: string[] }> {
  await getCurrentActor() // auth gate
  const report = await runWarmupCycle()
  revalidatePath('/engage/accounts')
  return { sent: report.sent, errors: report.errors }
}

export async function getEngageCampaigns(): Promise<EngageCampaign[]> {
  const { orgId } = await getCurrentActor()
  const r = await pool.query(
    `SELECT * FROM public.engage_campaigns WHERE organization_id = $1 ORDER BY created_at DESC`,
    [orgId])
  return (r.rows ?? []).map(campaignRow)
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

export async function ensureAutoCampaignForRun(icpId: number): Promise<{ id: string; name: string }> {
  const { orgId, userId } = await getCurrentActor()

  const existingRes = await pool.query(
    `SELECT id, name FROM public.engage_campaigns WHERE organization_id = $1 AND origin = 'auto' AND icp_id = $2 ORDER BY created_at ASC LIMIT 1`,
    [orgId, icpId])
  const existing = existingRes.rows[0]

  if (existing) {
    await pool.query(
      `UPDATE public.engage_campaigns SET status = 'running', completed_at = NULL, updated_at = $1 WHERE id = $2`,
      [new Date().toISOString(), existing.id])
    revalidatePath('/engage/campaigns')
    return { id: String(existing.id), name: String(existing.name) }
  }

  const icpRes = await pool.query(`SELECT name FROM public.icp_profiles WHERE id = $1 LIMIT 1`, [icpId])
  const name = `${String(icpRes.rows[0]?.name || `ICP ${icpId}`)} — Outreach`

  const r = await pool.query(
    `INSERT INTO public.engage_campaigns (organization_id, created_by, name, origin, icp_id, status, personalize_mode, started_at)
     VALUES ($1,$2,$3,'auto',$4,'running','template',$5) RETURNING id, name`,
    [orgId, userId, name, icpId, new Date().toISOString()])
  if (!r.rows[0]) throw new Error('Failed to create auto-campaign')
  revalidatePath('/engage/campaigns')
  return { id: String(r.rows[0].id), name: String(r.rows[0].name) }
}

export async function sendNowForIcp(icpId: number): Promise<{ campaignId: string; report: WorkerReport }> {
  await getCurrentActor()
  const countRes = await pool.query(
    `SELECT COUNT(*) FROM public.outreach_sequences WHERE icp_id = $1`, [icpId])
  const count = Number(countRes.rows[0]?.count ?? 0)
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
  const { orgId } = await getCurrentActor()
  const r = await pool.query(
    `SELECT * FROM public.engage_campaigns WHERE organization_id = $1 AND id = $2 LIMIT 1`,
    [orgId, id])
  if (!r.rows[0]) return null
  return campaignRow(r.rows[0])
}

export async function createEngageCampaign(input: Omit<EngageCampaign, 'id'>): Promise<{ id: string }> {
  const { orgId, userId } = await getCurrentActor()
  if (!input.templateId && !input.sequenceId) {
    throw new Error('Pick a template or a sequence for the campaign')
  }
  const r = await pool.query(
    `INSERT INTO public.engage_campaigns
     (organization_id, created_by, name, audience_lead_ids, template_id, sequence_id, schedule_at, status,
      stop_on_reply, open_tracking, link_tracking, daily_limit, personalize_mode, ai_instruction)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [orgId, userId, input.name, JSON.stringify(input.audienceLeadIds ?? []),
     input.templateId || null, input.sequenceId || null, input.scheduleAt, input.status,
     input.stopOnReply ?? true, input.openTracking ?? true, input.linkTracking ?? true,
     input.dailyLimit ?? 50, input.personalizeMode === 'ai' ? 'ai' : 'template',
     input.aiInstruction || null])
  if (!r.rows[0]) throw new Error('Failed to create campaign')
  const newId = String(r.rows[0].id)

  try {
    // enrollCampaignRecipients uses supabase internally — external lib compat
    const supabase = await createClient()
    await enrollCampaignRecipients(supabase, {
      id: newId,
      organization_id: orgId,
      audience_lead_ids: (input.audienceLeadIds ?? []).map(String),
      sequence_id: input.sequenceId || null,
    })
  } catch (enrollError) {
    console.error('createEngageCampaign: immediate enrollment failed', enrollError)
  }

  revalidatePath('/engage/campaigns')
  return { id: newId }
}

export async function updateEngageCampaign(
  id: string,
  patch: Partial<Omit<EngageCampaign, 'id'>>,
) {
  const { orgId } = await getCurrentActor()
  const dbPatch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.name !== undefined) dbPatch.name = patch.name
  if (patch.audienceLeadIds !== undefined) dbPatch.audience_lead_ids = JSON.stringify(patch.audienceLeadIds)
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

  const keys = Object.keys(dbPatch)
  const vals = Object.values(dbPatch)
  const sets = keys.map((k, i) => `"${k}" = $${i + 1}`).join(', ')
  await pool.query(
    `UPDATE public.engage_campaigns SET ${sets} WHERE organization_id = $${keys.length + 1} AND id = $${keys.length + 2}`,
    [...vals, orgId, id])
  revalidatePath('/engage/campaigns')
  revalidatePath(`/engage/campaigns/${id}`)
}

export async function setCampaignStatus(id: string, status: EngageCampaign['status']) {
  return updateEngageCampaign(id, { status })
}

export async function getEngageCampaignProgress(): Promise<Record<string, Record<string, number>>> {
  let orgId: string
  try {
    ;({ orgId } = await getCurrentActor())
  } catch {
    return {}
  }
  const r = await pool.query(
    `SELECT campaign_id, status FROM public.engage_campaign_recipients WHERE organization_id = $1`, [orgId])
  const out: Record<string, Record<string, number>> = {}
  for (const row of r.rows ?? []) {
    const cid = String(row.campaign_id)
    const status = String(row.status)
    out[cid] = out[cid] ?? {}
    out[cid][status] = (out[cid][status] ?? 0) + 1
  }
  return out
}

export async function getEngageCampaignSkips(): Promise<Record<string, Record<string, number>>> {
  let orgId: string
  try {
    ;({ orgId } = await getCurrentActor())
  } catch {
    return {}
  }
  const r = await pool.query(
    `SELECT campaign_id, skip_reason FROM public.engage_campaign_recipients WHERE organization_id = $1 AND status = 'skipped'`,
    [orgId])
  const out: Record<string, Record<string, number>> = {}
  for (const row of r.rows ?? []) {
    const cid = String(row.campaign_id)
    const reason = String(row.skip_reason ?? 'unknown')
    out[cid] = out[cid] ?? {}
    out[cid][reason] = (out[cid][reason] ?? 0) + 1
  }
  return out
}

export async function getCampaignDetail(id: string): Promise<import('@/types/engage').CampaignDetailData | null> {
  let orgId: string
  try {
    ;({ orgId } = await getCurrentActor())
  } catch {
    return null
  }
  const campaign = await getEngageCampaign(id)
  if (!campaign) return null

  const [recipientsRes, logRes, opensRes, clicksRes, repliesRes, unsubsRes] = await Promise.all([
    pool.query(`SELECT * FROM public.engage_campaign_recipients WHERE campaign_id = $1 ORDER BY created_at ASC`, [id]),
    pool.query(`SELECT contact_email AS email, status, step_number, sent_at, created_at FROM public.outreach_log WHERE campaign_id = $1`, [id]),
    pool.query(`SELECT email, opened_at, created_at FROM public.outreach_opens WHERE campaign_id = $1`, [id]),
    pool.query(`SELECT email, clicked_at, created_at FROM public.outreach_clicks WHERE campaign_id = $1`, [id]),
    pool.query(`SELECT email, replied_at, created_at FROM public.outreach_replies WHERE campaign_id = $1`, [id]),
    pool.query(`SELECT email, unsubscribed_at, created_at FROM public.outreach_unsubscribes WHERE campaign_id = $1`, [id]),
  ])

  void orgId

  const recipients = recipientsRes.rows ?? []
  const sentRows = (logRes.rows ?? []).filter((r: any) => r.status === 'sent')
  const opens = opensRes.rows ?? []
  const clicks = clicksRes.rows ?? []
  const replies = repliesRes.rows ?? []
  const unsubs = unsubsRes.rows ?? []

  const uniq = (rows: Array<{ email?: string | null }>) =>
    new Set(rows.map((r) => String(r.email ?? '').toLowerCase()).filter(Boolean)).size
  const sequenceStarted = recipients.filter((r: any) =>
    ['in_progress', 'completed', 'replied'].includes(String(r.status)),
  ).length
  const uniqueOpens = uniq(opens)
  const uniqueClicks = uniq(clicks)
  const uniqueReplies = uniq(replies)
  const opportunities = recipients.filter((r: any) =>
    (['interested', 'meeting_booked', 'meeting_completed', 'won'] as string[]).includes(String(r.interest_status)),
  ).length
  const denom = sequenceStarted || sentRows.length || 1
  const completed = recipients.filter((r: any) => ['completed', 'replied'].includes(String(r.status))).length

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

  const stepNumValues: number[] = sentRows.map((r: any) => Number(r.step_number ?? 1))
  const stepNums: number[] = Array.from(new Set<number>(stepNumValues)).sort((a, b) => a - b)
  const steps: import('@/types/engage').CampaignStepStat[] = (stepNums.length ? stepNums : [1]).map((step) => {
    const sentForStep = sentRows.filter((r: any) => Number(r.step_number ?? 1) === step).length
    return {
      step,
      sent: sentForStep,
      opened: step === (stepNums[0] ?? 1) ? uniqueOpens : 0,
      clicked: step === (stepNums[0] ?? 1) ? uniqueClicks : 0,
      replied: step === (stepNums[0] ?? 1) ? uniqueReplies : 0,
      opportunities: step === (stepNums[0] ?? 1) ? opportunities : 0,
    }
  })

  const leads: import('@/types/engage').CampaignLeadRow[] = recipients.map((r: any) => ({
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
  sentRows.forEach((r: any) => add(r.sent_at ?? r.created_at, 'sends'))
  opens.forEach((r: any) => add(r.opened_at ?? r.created_at, 'opens'))
  clicks.forEach((r: any) => add(r.clicked_at ?? r.created_at, 'clicks'))
  replies.forEach((r: any) => add(r.replied_at ?? r.created_at, 'replies'))
  unsubs.forEach((r: any) => add(r.unsubscribed_at ?? r.created_at, 'unsubscribes'))
  const timeSeries = Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b)).map(([date, b]) => ({ date, ...b }))

  return { campaign, kpis, steps, leads, timeSeries }
}

export async function setRecipientInterest(recipientId: string, status: import('@/types/engage').InterestStatus) {
  const { orgId } = await getCurrentActor()
  const r = await pool.query(
    `UPDATE public.engage_campaign_recipients SET interest_status=$1, updated_at=$2 WHERE organization_id=$3 AND id=$4 RETURNING campaign_id`,
    [status, new Date().toISOString(), orgId, recipientId])
  const campaignId = r.rows[0]?.campaign_id
  if (campaignId) revalidatePath(`/engage/campaigns/${campaignId}`)
}

export async function getOutreachDeliveryStats(days: number = 30): Promise<import('@/types/engage').DeliveryStats[]> {
  let orgId: string
  try {
    ;({ orgId } = await getCurrentActor())
  } catch {
    return []
  }
  const since = new Date()
  since.setDate(since.getDate() - days)

  const [logRes, campaignsRes] = await Promise.all([
    pool.query(
      `SELECT campaign_id, status FROM public.outreach_log WHERE organization_id = $1 AND created_at >= $2`,
      [orgId, since.toISOString()]),
    pool.query(`SELECT id, name FROM public.engage_campaigns WHERE organization_id = $1`, [orgId]),
  ])

  const nameById = new Map<string, string>()
  for (const c of campaignsRes.rows ?? []) nameById.set(String(c.id), String(c.name))

  const agg = new Map<string, { sent: number; failed: number; skipped: number }>()
  for (const row of logRes.rows ?? []) {
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
  const { orgId } = await getCurrentActor()
  const r = await pool.query(
    `SELECT * FROM public.engage_templates WHERE organization_id = $1 ORDER BY updated_at DESC`, [orgId])
  return (r.rows ?? []).map((x: any) => ({
    id: String(x.id),
    name: String(x.name),
    subject: String(x.subject ?? ''),
    body: String(x.body ?? ''),
    attachments: (Array.isArray(x.attachments) ? x.attachments : []) as EngageAttachment[],
    updatedAt: String(x.updated_at ?? new Date().toISOString()),
  }))
}

export async function upsertEngageTemplate(input: Omit<EngageTemplate, 'updatedAt'>): Promise<{ id: string }> {
  const { orgId, userId } = await getCurrentActor()
  const now = new Date().toISOString()
  if (input.id) {
    await pool.query(
      `UPDATE public.engage_templates SET name=$1, subject=$2, body=$3, attachments=$4, updated_at=$5 WHERE organization_id=$6 AND id=$7`,
      [input.name, input.subject, input.body, JSON.stringify(input.attachments ?? []), now, orgId, input.id])
    revalidatePath('/engage/templates')
    return { id: input.id }
  }
  const r = await pool.query(
    `INSERT INTO public.engage_templates (organization_id, created_by, name, subject, body, attachments, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [orgId, userId, input.name, input.subject, input.body, JSON.stringify(input.attachments ?? []), now])
  revalidatePath('/engage/templates')
  return { id: String(r.rows[0].id) }
}

export async function generateSequenceWithAI(prompt: string): Promise<{
  name: string
  steps: Array<{ templateId: string; delayDays: number; templateName: string }>
}> {
  const { orgId } = await getCurrentActor()
  const instruction = (prompt || '').trim()
  if (!instruction) throw new Error('Tell the AI what the sequence should achieve.')

  const tplRes = await pool.query(
    `SELECT id, name, subject, body FROM public.engage_templates WHERE organization_id = $1 ORDER BY updated_at DESC`,
    [orgId])
  const templates = tplRes.rows ?? []
  if (!templates.length) {
    throw new Error('Create some templates first — the AI builds the sequence from your saved templates.')
  }

  const list = templates
    .map((t: any, i: number) => `[${i}] ${String(t.name)} — subject: "${String(t.subject ?? '')}" — body: ${String(t.body ?? '').replace(/\s+/g, ' ').slice(0, 180)}`)
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
  if (!steps.length) {
    steps.push({ templateId: String(templates[0].id), delayDays: 0, templateName: String(templates[0].name) })
  }
  return { name: seqName, steps }
}

export async function deleteEngageTemplate(id: string) {
  const { orgId } = await getCurrentActor()
  await pool.query(`DELETE FROM public.engage_templates WHERE organization_id = $1 AND id = $2`, [orgId, id])
  revalidatePath('/engage/templates')
}

export async function getEngageSequences(): Promise<EngageSequence[]> {
  const { orgId } = await getCurrentActor()
  const r = await pool.query(
    `SELECT * FROM public.engage_sequences WHERE organization_id = $1 ORDER BY created_at DESC`, [orgId])
  return (r.rows ?? []).map((x: any) => ({
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
  const { orgId, userId } = await getCurrentActor()
  await pool.query(
    `INSERT INTO public.engage_sequences (organization_id, created_by, name, steps) VALUES ($1,$2,$3,$4)`,
    [orgId, userId, input.name, JSON.stringify(input.steps)])
  revalidatePath('/engage/sequences')
}

export async function updateEngageSequence(id: string, input: Omit<EngageSequence, 'id'>) {
  const { orgId } = await getCurrentActor()
  await pool.query(
    `UPDATE public.engage_sequences SET name=$1, steps=$2, updated_at=$3 WHERE organization_id=$4 AND id=$5`,
    [input.name, JSON.stringify(input.steps), new Date().toISOString(), orgId, id])
  revalidatePath('/engage/sequences')
}

export async function deleteEngageSequence(id: string) {
  const { orgId } = await getCurrentActor()
  await pool.query(`DELETE FROM public.engage_sequences WHERE organization_id=$1 AND id=$2`, [orgId, id])
  revalidatePath('/engage/sequences')
}

export async function deleteEngageCampaign(id: string) {
  const { orgId } = await getCurrentActor()
  await pool.query(`DELETE FROM public.engage_campaigns WHERE organization_id=$1 AND id=$2`, [orgId, id])
  revalidatePath('/engage/campaigns')
}

export async function getEngageLeads(): Promise<EngageLead[]> {
  const { orgId } = await getCurrentActor()
  const r = await pool.query(
    `SELECT id, contact_name, contact_email, company_name FROM public.leads_raw WHERE organization_id = $1 AND contact_email IS NOT NULL ORDER BY icp_score DESC NULLS LAST LIMIT 200`,
    [orgId])
  return (r.rows ?? []).map((x: any) => ({
    id: String(x.id),
    name: String(x.contact_name || x.company_name || 'Unknown'),
    email: String(x.contact_email || ''),
    company: String(x.company_name || ''),
  }))
}

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

  let orgId: string
  try {
    ;({ orgId } = await getCurrentActor())
  } catch {
    return empty
  }

  const since = new Date()
  since.setDate(since.getDate() - days)
  const sinceISO = since.toISOString()

  const [sendsRes, opensRes, clicksRes, repliesRes, unsubsRes] = await Promise.all([
    pool.query(`SELECT sent_at, created_at, campaign_id, contact_email AS email, status FROM public.outreach_log WHERE organization_id = $1 AND created_at >= $2`, [orgId, sinceISO]),
    pool.query(`SELECT opened_at, created_at, campaign_id, email FROM public.outreach_opens WHERE organization_id = $1 AND created_at >= $2`, [orgId, sinceISO]),
    pool.query(`SELECT clicked_at, created_at, campaign_id, email FROM public.outreach_clicks WHERE organization_id = $1 AND created_at >= $2`, [orgId, sinceISO]),
    pool.query(`SELECT replied_at, created_at, campaign_id, email, classification FROM public.outreach_replies WHERE organization_id = $1 AND created_at >= $2`, [orgId, sinceISO]),
    pool.query(`SELECT unsubscribed_at, created_at, campaign_id, email FROM public.outreach_unsubscribes WHERE organization_id = $1 AND created_at >= $2`, [orgId, sinceISO]),
  ])

  const sends = (sendsRes.rows ?? []).filter((s: any) => (s.status ?? 'sent') === 'sent')
  const opens = opensRes.rows ?? []
  const clicks = clicksRes.rows ?? []
  const replies = repliesRes.rows ?? []
  const unsubs = unsubsRes.rows ?? []

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
    opportunities: replies.filter((r: any) => POSITIVE.has(String(r.classification ?? ''))).length,
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
  sends.forEach((r: any) => addToBucket(r.sent_at ?? r.created_at, 'sends'))
  opens.forEach((r: any) => addToBucket(r.opened_at ?? r.created_at, 'opens'))
  clicks.forEach((r: any) => addToBucket(r.clicked_at ?? r.created_at, 'clicks'))
  replies.forEach((r: any) => addToBucket(r.replied_at ?? r.created_at, 'replies'))
  unsubs.forEach((r: any) => addToBucket(r.unsubscribed_at ?? r.created_at, 'unsubscribes'))

  const timeSeries = Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, bucket]) => ({ date, ...bucket }))

  const [campaignsRes, recipientsRes] = await Promise.all([
    pool.query(`SELECT id, name, status FROM public.engage_campaigns WHERE organization_id = $1`, [orgId]),
    pool.query(`SELECT campaign_id, status FROM public.engage_campaign_recipients WHERE organization_id = $1`, [orgId]),
  ])

  const campaignNames = new Map<string, { name: string; status: string }>()
  for (const c of campaignsRes.rows ?? []) {
    campaignNames.set(String(c.id), { name: String(c.name), status: String(c.status) })
  }

  type CampAgg = {
    sent: number; opens: number; openEmails: Set<string>
    clicks: number; clickEmails: Set<string>; replies: number; opportunities: number
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
  sends.forEach((r: any) => { if (r.campaign_id) aggFor(String(r.campaign_id)).sent += 1 })
  opens.forEach((r: any) => {
    if (!r.campaign_id) return
    const a = aggFor(String(r.campaign_id))
    a.opens += 1
    if (r.email) a.openEmails.add(String(r.email).toLowerCase())
  })
  clicks.forEach((r: any) => {
    if (!r.campaign_id) return
    const a = aggFor(String(r.campaign_id))
    a.clicks += 1
    if (r.email) a.clickEmails.add(String(r.email).toLowerCase())
  })
  replies.forEach((r: any) => {
    if (!r.campaign_id) return
    const a = aggFor(String(r.campaign_id))
    a.replies += 1
    if (POSITIVE.has(String(r.classification ?? ''))) a.opportunities += 1
  })

  const recipientCounts = new Map<string, { total: number; completed: number; failed: number }>()
  for (const r of recipientsRes.rows ?? []) {
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

  const mailboxRes = await pool.query(
    `SELECT email, provider, connected_at, last_synced_at, gmail_watch_expiration FROM public.engage_mailboxes WHERE organization_id = $1`,
    [orgId])

  const accounts: EngageAccountStats[] = (mailboxRes.rows ?? []).map((mb: any) => ({
    email: String(mb.email),
    provider: String(mb.provider ?? 'gmail'),
    connectedAt: mb.connected_at ? String(mb.connected_at) : null,
    lastSyncedAt: mb.last_synced_at ? String(mb.last_synced_at) : null,
    watchActive: Boolean(
      mb.gmail_watch_expiration && new Date(String(mb.gmail_watch_expiration)).getTime() > Date.now(),
    ),
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

export async function getGtmSchedule(): Promise<GtmScheduleConfig | null> {
  let orgId: string
  try {
    ;({ orgId } = await getCurrentActor())
  } catch {
    return null
  }
  const r = await pool.query(
    `SELECT * FROM public.gtm_schedules WHERE organization_id = $1 ORDER BY created_at ASC LIMIT 1`,
    [orgId])
  const data = r.rows[0]
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
  const { orgId } = await getCurrentActor()
  const now = new Date().toISOString()
  const icp_id = input.icpId
  const enabled = input.enabled
  const run_hour = Math.min(23, Math.max(0, Math.trunc(input.runHour)))
  const run_minute = Math.min(59, Math.max(0, Math.trunc(input.runMinute)))
  const timezone = input.timezone || 'Asia/Kolkata'
  const leads_per_day = Math.min(500, Math.max(1, Math.trunc(input.leadsPerDay)))
  const sender = input.sender
  const auto_send = input.autoSend

  const existingRes = await pool.query(
    `SELECT id FROM public.gtm_schedules WHERE organization_id = $1 LIMIT 1`, [orgId])
  const existing = existingRes.rows[0]

  if (existing) {
    await pool.query(
      `UPDATE public.gtm_schedules SET icp_id=$1, enabled=$2, run_hour=$3, run_minute=$4, timezone=$5, leads_per_day=$6, sender=$7, auto_send=$8, updated_at=$9 WHERE id=$10`,
      [icp_id, enabled, run_hour, run_minute, timezone, leads_per_day, sender, auto_send, now, existing.id])
  } else {
    await pool.query(
      `INSERT INTO public.gtm_schedules (organization_id, icp_id, enabled, run_hour, run_minute, timezone, leads_per_day, sender, auto_send, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [orgId, icp_id, enabled, run_hour, run_minute, timezone, leads_per_day, sender, auto_send, now])
  }
  revalidatePath('/engage/settings')
}

export async function getIcpOptions(): Promise<Array<{ id: number; name: string }>> {
  try {
    await getCurrentActor()
  } catch {
    return []
  }
  const r = await pool.query(`SELECT id, name FROM public.icp_profiles ORDER BY id ASC LIMIT 100`)
  return (r.rows ?? []).map((x: any) => ({ id: Number(x.id), name: String(x.name ?? `ICP ${x.id}`) }))
}

export async function getUniboxMeta(): Promise<import('@/types/engage').UniboxMeta> {
  const empty: import('@/types/engage').UniboxMeta = { byThread: {}, campaigns: [], mailboxes: [], statusCounts: {} }
  let orgId: string
  try {
    ;({ orgId } = await getCurrentActor())
  } catch {
    return empty
  }

  const [recipientsRes, campaignsRes, mailboxesRes] = await Promise.all([
    pool.query(
      `SELECT id, campaign_id, gmail_thread_id, interest_status, status, last_error FROM public.engage_campaign_recipients WHERE organization_id = $1 AND gmail_thread_id IS NOT NULL`,
      [orgId]),
    pool.query(`SELECT id, name FROM public.engage_campaigns WHERE organization_id = $1 ORDER BY created_at DESC`, [orgId]),
    pool.query(`SELECT email FROM public.engage_mailboxes WHERE organization_id = $1`, [orgId]),
  ])

  const nameById = new Map<string, string>()
  for (const c of campaignsRes.rows ?? []) nameById.set(String(c.id), String(c.name))

  const byThread: Record<string, import('@/types/engage').UniboxThreadMeta> = {}
  const statusCounts: Record<string, number> = {}
  for (const r of recipientsRes.rows ?? []) {
    const threadId = String(r.gmail_thread_id)
    const status = (r.interest_status ?? 'lead') as import('@/types/engage').InterestStatus
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
    campaigns: (campaignsRes.rows ?? []).map((c: any) => ({ id: String(c.id), name: String(c.name) })),
    mailboxes: (mailboxesRes.rows ?? []).map((m: any) => ({ email: String(m.email) })),
    statusCounts,
  }
}

// --------------------------------------------------------------------------- //
// Agent 17 (Reply Handling) draft approval — outreach_replies.draft_response
// is drafted by the Python backend and held at response_status='pending_review'
// until a human approves it here. Modeled on the GtmIntelligence approve/
// reject pattern in app/actions/gtm.ts (approveGtmBrief/rejectGtmBrief).
// --------------------------------------------------------------------------- //
export async function getReplyDraftForThread(threadId: string): Promise<{
  id: number
  draftResponse: string | null
  responseStatus: string
} | null> {
  const { orgId } = await getCurrentActor()
  const res = await pool.query(
    `SELECT id, draft_response, response_status FROM public.outreach_replies
     WHERE organization_id = $1 AND thread_id = $2
     ORDER BY replied_at DESC NULLS LAST, created_at DESC LIMIT 1`,
    [orgId, threadId])
  const row = res.rows?.[0]
  if (!row) return null
  return { id: row.id, draftResponse: row.draft_response ?? null, responseStatus: row.response_status }
}

async function callGtmService(path: string, body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  const url = process.env.GTM_SERVICE_URL
  const token = process.env.GTM_SERVICE_TOKEN
  if (!url || !token) {
    return { ok: false, error: 'GTM service not configured (set GTM_SERVICE_URL & GTM_SERVICE_TOKEN)' }
  }
  try {
    const res = await fetch(`${url}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      cache: 'no-store',
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: json.detail ? JSON.stringify(json.detail) : `service returned ${res.status}` }
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'service unreachable' }
  }
}

export async function approveAndSendReply(replyId: number): Promise<{ ok: boolean; error?: string }> {
  const { orgId } = await getCurrentActor()
  try {
    // Flip to 'approved' first — this is the one hard gate the backend's
    // send_approved_response() checks before it will dispatch anything.
    await pool.query(
      `UPDATE public.outreach_replies SET response_status = 'approved' WHERE id = $1 AND organization_id = $2`,
      [replyId, orgId])

    const sendResult = await callGtmService('/reply/send', { organization_id: orgId, reply_id: replyId })
    if (!sendResult.ok) {
      // Leave it at 'approved' — it's queued and safe to retry/send later
      // (e.g. via `python -m phase3 send-reply --reply-id`) even if the
      // live service call failed right now (service down, etc).
      revalidatePath('/engage/conversations')
      return { ok: false, error: sendResult.error }
    }
    revalidatePath('/engage/conversations')
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
}

export async function rejectReplyDraft(replyId: number): Promise<{ ok: boolean; error?: string }> {
  const { orgId } = await getCurrentActor()
  try {
    await pool.query(
      `UPDATE public.outreach_replies SET response_status = 'no_response_needed' WHERE id = $1 AND organization_id = $2`,
      [replyId, orgId])
    revalidatePath('/engage/conversations')
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
}

export async function setThreadInterest(threadId: string, status: import('@/types/engage').InterestStatus) {
  const { orgId } = await getCurrentActor()
  await pool.query(
    `UPDATE public.engage_campaign_recipients SET interest_status=$1, updated_at=$2 WHERE organization_id=$3 AND gmail_thread_id=$4`,
    [status, new Date().toISOString(), orgId, threadId])
  revalidatePath('/engage/inbox')
}

export async function getEmailConversations(): Promise<ConversationThread[]> {
  let orgId: string
  try {
    ;({ orgId } = await getCurrentActor())
  } catch {
    return []
  }

  const repliesRawRes = await pool.query(
    `SELECT thread_id, email, classification, replied_at FROM public.outreach_replies WHERE organization_id = $1 AND thread_id IS NOT NULL ORDER BY replied_at DESC LIMIT 100`,
    [orgId])
  const repliesRaw = repliesRawRes.rows ?? []
  const replies = repliesRaw.filter((r: any) => !/mailer-daemon|postmaster|no-?reply/i.test(String(r.email ?? '')))
  if (!replies.length) return []

  const threadIds: string[] = Array.from(new Set<string>(replies.map((r: any) => String(r.thread_id))))
  const replyByThread = new Map<string, { classification: string | null; repliedAt: string | null; email: string }>()
  for (const r of replies) {
    const t = String(r.thread_id)
    if (!replyByThread.has(t)) {
      replyByThread.set(t, { classification: r.classification ?? null, repliedAt: r.replied_at ?? null, email: String(r.email ?? '') })
    }
  }

  const [emailsRes, recipientsRes] = await Promise.all([
    pool.query(
      `SELECT gmail_message_id, gmail_thread_id, from_email, to_email, subject, snippet, direction, received_at, unread FROM public.engage_emails WHERE organization_id = $1 AND gmail_thread_id = ANY($2) ORDER BY received_at ASC`,
      [orgId, threadIds]),
    pool.query(
      `SELECT gmail_thread_id, name, company, interest_status FROM public.engage_campaign_recipients WHERE organization_id = $1 AND gmail_thread_id = ANY($2)`,
      [orgId, threadIds]),
  ])

  const recipientByThread = new Map<string, { name: string; company: string; interest: string }>()
  for (const r of recipientsRes.rows ?? []) {
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
  for (const e of emailsRes.rows ?? []) {
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
      threadId: t,
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
  let orgId: string
  try {
    ;({ orgId } = await getCurrentActor())
  } catch {
    return []
  }

  const convosRes = await pool.query(
    `SELECT c.id, c.unread_count, c.last_customer_message_at, c.created_at,
       json_build_object('name', l.name, 'phone_number', l.phone_number) AS lead
     FROM public.conversations c
     LEFT JOIN public.leads l ON l.id = c.lead_id
     WHERE c.organization_id = $1
     ORDER BY c.last_customer_message_at DESC NULLS LAST, c.created_at DESC
     LIMIT 100`,
    [orgId])
  const convos = convosRes.rows ?? []
  if (!convos.length) return []

  const conversationIds = convos.map((c: any) => String(c.id))

  const [messagesRes, insightsRes] = await Promise.all([
    pool.query(
      `SELECT id, conversation_id, sender_type, message_type, content, media_url, status, created_at FROM public.messages WHERE organization_id = $1 AND conversation_id = ANY($2) ORDER BY created_at ASC`,
      [orgId, conversationIds]),
    pool.query(
      `SELECT conversation_id, intent, sentiment, suggested_reply, urgency, created_at FROM public.ai_insights WHERE organization_id = $1 AND conversation_id = ANY($2) ORDER BY created_at DESC`,
      [orgId, conversationIds]),
  ])

  const messagesByConvo = new Map<string, ConversationMessage[]>()
  for (const m of messagesRes.rows ?? []) {
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

  const insightByConvo = new Map<string, ConversationInsight>()
  for (const i of insightsRes.rows ?? []) {
    const key = String(i.conversation_id)
    if (insightByConvo.has(key)) continue
    insightByConvo.set(key, {
      intent: i.intent ? String(i.intent) : null,
      sentiment: i.sentiment ? String(i.sentiment) : null,
      suggestedReply: i.suggested_reply ? String(i.suggested_reply) : null,
      urgency: i.urgency ? String(i.urgency) : null,
    })
  }

  return convos.map((c: any) => {
    const lead = c.lead
    const id = String(c.id)
    return {
      id,
      threadId: '', // not an email thread (WhatsApp/SMS) — no outreach_replies draft applies
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

export async function getUnsubscribes(): Promise<UnsubscribeRow[]> {
  let orgId: string
  try {
    ;({ orgId } = await getCurrentActor())
  } catch {
    return []
  }

  const r = await pool.query(
    `SELECT email, campaign_id, unsubscribed_at, created_at FROM public.outreach_unsubscribes WHERE organization_id = $1 ORDER BY unsubscribed_at DESC NULLS LAST LIMIT 500`,
    [orgId])

  return (r.rows ?? []).map((x: any) => ({
    email: String(x.email ?? ''),
    campaignId: x.campaign_id ? String(x.campaign_id) : null,
    unsubscribedAt: x.unsubscribed_at ? String(x.unsubscribed_at) : x.created_at ? String(x.created_at) : null,
  }))
}

export async function getEmailAccounts(): Promise<EmailAccount[]> {
  let orgId: string
  try {
    ;({ orgId } = await getCurrentActor())
  } catch {
    return []
  }

  const mailboxesRes = await pool.query(
    `SELECT em.id, em.email, em.provider, em.status, em.connected_at, em.last_synced_at,
       em.gmail_watch_expiration, em.daily_send_limit,
       em.warmup_enabled, em.warmup_started_at, em.warmup_daily_limit,
       em.warmup_reply_rate, em.warmup_open_rate,
       em.warmup_spam_rescue_pct, em.warmup_mark_important_pct,
       COALESCE(
         json_agg(json_build_object('tag_id', mt.tag_id, 'account_tags', json_build_object('id', at.id, 'name', at.name, 'color', at.color)))
         FILTER (WHERE mt.tag_id IS NOT NULL),
         '[]'::json
       ) AS mailbox_tags
     FROM public.engage_mailboxes em
     LEFT JOIN public.mailbox_tags mt ON mt.mailbox_id = em.id
     LEFT JOIN public.account_tags at ON at.id = mt.tag_id
     WHERE em.organization_id = $1
     GROUP BY em.id
     ORDER BY em.connected_at DESC`,
    [orgId])

  const mailboxes = mailboxesRes.rows ?? []
  if (!mailboxes.length) return []

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const [warmupRes, todaySendsRes, analyticsRes] = await Promise.all([
    pool.query(
      `SELECT mailbox_id, placed_inbox FROM public.engage_warmup_log WHERE organization_id = $1 AND sent_at >= $2`,
      [orgId, sevenDaysAgo]),
    pool.query(
      `SELECT mailbox_id FROM public.outreach_log WHERE organization_id = $1 AND status = 'sent' AND sent_at >= $2 AND mailbox_id IS NOT NULL`,
      [orgId, todayStart.toISOString()]),
    pool.query(
      `SELECT mailbox_id, status FROM public.outreach_log WHERE organization_id = $1 AND mailbox_id IS NOT NULL`,
      [orgId]),
  ])

  const warmupByMailbox: Record<string, { total: number; inbox: number }> = {}
  for (const w of warmupRes.rows ?? []) {
    const key = String(w.mailbox_id)
    if (!warmupByMailbox[key]) warmupByMailbox[key] = { total: 0, inbox: 0 }
    warmupByMailbox[key].total++
    if (w.placed_inbox === true) warmupByMailbox[key].inbox++
  }

  const sentTodayByMailbox: Record<string, number> = {}
  for (const s of todaySendsRes.rows ?? []) {
    const key = String(s.mailbox_id)
    sentTodayByMailbox[key] = (sentTodayByMailbox[key] ?? 0) + 1
  }

  const analyticsByMailbox: Record<string, { sent: number; opens: number; replies: number; clicks: number }> = {}
  for (const r of analyticsRes.rows ?? []) {
    const key = String(r.mailbox_id)
    if (!analyticsByMailbox[key]) analyticsByMailbox[key] = { sent: 0, opens: 0, replies: 0, clicks: 0 }
    analyticsByMailbox[key].sent++
  }

  return mailboxes.map((mb: any) => {
    const id = String(mb.id)
    const warmup = warmupByMailbox[id] ?? { total: 0, inbox: 0 }
    const healthScore = warmup.total > 0 ? Math.round((warmup.inbox / warmup.total) * 100) : null
    const analytics = analyticsByMailbox[id] ?? { sent: 0, opens: 0, replies: 0, clicks: 0 }
    const combinedScore =
      analytics.sent >= 100
        ? Math.round(((analytics.opens / analytics.sent) * 0.5 + (analytics.replies / analytics.sent) * 0.5) * 100)
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
        mb.gmail_watch_expiration && new Date(String(mb.gmail_watch_expiration)).getTime() > Date.now(),
      ),
      dailySendLimit: Number(mb.daily_send_limit ?? 50),
      hourlySendLimit: Number((mb as { hourly_send_limit?: number }).hourly_send_limit ?? 20),
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
  let orgId: string
  try {
    ;({ orgId } = await requireMailWrite())
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unauthorized' }
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (settings.status !== undefined) patch.status = settings.status
  if (settings.dailySendLimit !== undefined) patch.daily_send_limit = settings.dailySendLimit
  // hourly_send_limit lives on mail_mailboxes (engage column requires DBA); synced below
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

  try {
    const keys = Object.keys(patch)
    const vals = Object.values(patch)
    const sets = keys.map((k, i) => `"${k}" = $${i + 1}`).join(', ')
    await pool.query(
      `UPDATE public.engage_mailboxes SET ${sets} WHERE id = $${keys.length + 1} AND organization_id = $${keys.length + 2}`,
      [...vals, id, orgId])

    if (settings.hourlySendLimit !== undefined || settings.dailySendLimit !== undefined) {
      const emailRes = await pool.query<{ email: string }>(
        `SELECT email FROM public.engage_mailboxes WHERE id = $1 AND organization_id = $2`,
        [id, orgId]
      )
      const email = emailRes.rows[0]?.email
      if (email) {
        await pool
          .query(
            `UPDATE public.mail_mailboxes
             SET hourly_send_limit = COALESCE($3, hourly_send_limit),
                 daily_limit = COALESCE($4, daily_limit),
                 updated_at = NOW()
             WHERE organization_id = $1 AND LOWER(email) = LOWER($2) AND deleted_at IS NULL`,
            [
              orgId,
              email,
              settings.hourlySendLimit ?? null,
              settings.dailySendLimit ?? null,
            ]
          )
          .catch(() => {})
      }
    }

    revalidatePath('/engage/accounts')
    return {}
  } catch (err: any) {
    return { error: err.message }
  }
}

export async function bulkUpdateAccounts(
  ids: string[],
  action: 'enable_warmup' | 'pause_warmup' | 'unpause' | 'pause',
): Promise<{ error?: string }> {
  if (!ids.length) return {}
  let orgId: string
  try {
    ;({ orgId } = await requireMailWrite())
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unauthorized' }
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

  try {
    const keys = Object.keys(patch)
    const vals = Object.values(patch)
    const sets = keys.map((k, i) => `"${k}" = $${i + 1}`).join(', ')
    await pool.query(
      `UPDATE public.engage_mailboxes SET ${sets} WHERE id = ANY($${keys.length + 1}) AND organization_id = $${keys.length + 2}`,
      [...vals, ids, orgId])
    revalidatePath('/engage/accounts')
    return {}
  } catch (err: any) {
    return { error: err.message }
  }
}

export async function getAccountTags(): Promise<AccountTag[]> {
  let orgId: string
  try {
    ;({ orgId } = await getCurrentActor())
  } catch {
    return []
  }
  const r = await pool.query(
    `SELECT id, name, color FROM public.account_tags WHERE organization_id = $1 ORDER BY name`, [orgId])
  return (r.rows ?? []).map((t: any) => ({
    id: String(t.id),
    name: String(t.name),
    color: String(t.color ?? '#6366f1'),
  }))
}

export async function createAccountTag(
  name: string,
  color = '#6366f1',
): Promise<{ tag?: AccountTag; error?: string }> {
  let orgId: string
  try {
    ;({ orgId } = await getCurrentActor())
  } catch {
    return { error: 'Unauthorized' }
  }
  try {
    const r = await pool.query(
      `INSERT INTO public.account_tags (organization_id, name, color) VALUES ($1,$2,$3) RETURNING id, name, color`,
      [orgId, name.trim(), color])
    revalidatePath('/engage/accounts')
    return { tag: { id: String(r.rows[0].id), name: String(r.rows[0].name), color: String(r.rows[0].color) } }
  } catch (err: any) {
    return { error: err.message }
  }
}

export async function applyTagsToAccounts(
  accountIds: string[],
  tagIds: string[],
): Promise<{ error?: string }> {
  if (!accountIds.length || !tagIds.length) return {}
  try {
    await getCurrentActor()
  } catch {
    return { error: 'Unauthorized' }
  }
  try {
    for (const mailboxId of accountIds) {
      for (const tagId of tagIds) {
        await pool.query(
          `INSERT INTO public.mailbox_tags (mailbox_id, tag_id) VALUES ($1,$2) ON CONFLICT (mailbox_id, tag_id) DO NOTHING`,
          [mailboxId, tagId])
      }
    }
    revalidatePath('/engage/accounts')
    return {}
  } catch (err: any) {
    return { error: err.message }
  }
}

export async function removeTagFromAccount(
  accountId: string,
  tagId: string,
): Promise<{ error?: string }> {
  try {
    await getCurrentActor()
  } catch {
    return { error: 'Unauthorized' }
  }
  try {
    await pool.query(`DELETE FROM public.mailbox_tags WHERE mailbox_id=$1 AND tag_id=$2`, [accountId, tagId])
    revalidatePath('/engage/accounts')
    return {}
  } catch (err: any) {
    return { error: err.message }
  }
}

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
  let userId: string
  let orgId: string
  try {
    ;({ userId, orgId } = await getCurrentActor())
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
  try {
    await pool.query(
      `INSERT INTO public.engage_mailboxes
       (user_id, organization_id, provider, email, smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from_name, smtp_security, imap_host, imap_port, status, updated_at, connected_at)
       VALUES ($1,$2,'smtp',$3,$4,$5,$6,$7,$8,$9,$10,$11,'active',$12,$13)
       ON CONFLICT (user_id, provider, email) DO UPDATE SET
         smtp_host = EXCLUDED.smtp_host, smtp_port = EXCLUDED.smtp_port,
         smtp_user = EXCLUDED.smtp_user, smtp_pass = EXCLUDED.smtp_pass,
         smtp_from_name = EXCLUDED.smtp_from_name, smtp_security = EXCLUDED.smtp_security,
         imap_host = EXCLUDED.imap_host, imap_port = EXCLUDED.imap_port,
         status = EXCLUDED.status, updated_at = EXCLUDED.updated_at`,
      [userId, orgId, input.smtpUser, input.smtpHost, input.smtpPort, input.smtpUser,
       input.smtpPass, input.fromName, input.smtpSecurity,
       input.imapHost ?? null, input.imapPort ?? null, now, now])
    revalidatePath('/engage/accounts')
    revalidatePath('/engage/settings')
    return {}
  } catch (err: any) {
    return { error: err.message }
  }
}
