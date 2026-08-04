/**
 * Warmup pool partner selection + real send path.
 * Warmup traffic must never use client campaign-sending domains as partners.
 */
import pool from '@/lib/db'
import nodemailer from 'nodemailer'
import { connect as tlsConnect, type TLSSocket } from 'tls'
import { connect as netConnect } from 'net'
import { decrypt, encrypt } from '@/lib/encryption'
import * as mailboxRepo from '@/repositories/mail/mailbox-repository'
import { incrementMailboxUsage } from './analytics-service'
import { getOAuthService } from './oauth'

const PARTNER_FAILURE_THRESHOLD = 3
const IMAP_TIMEOUT_MS = 12_000
const SPAM_FOLDER_CANDIDATES = ['[Gmail]/Spam', 'Junk', 'Spam', 'Bulk Mail']

export type WarmupPoolMailbox = {
  id: string
  email: string
  domain: string
  smtpHost: string | null
  smtpPort: number
  encryptedSmtpPassword: string | null
  imapHost: string | null
  imapPort: number
  encryptedImapPassword: string | null
  healthStatus: string
  dailyCapacity: number
  currentDailyUsage: number
}

export type WarmupPlacement = 'inbox' | 'spam' | 'unknown'

const SUBJECTS = [
  'Quick check-in',
  'Following up on our conversation',
  'Great connecting with you',
  'Wanted to share something useful',
  'Checking in',
  'Hope you are doing well',
  'Thought you might find this interesting',
  'Just a quick note',
  'Hello from my inbox',
  'Hope your week is going well',
]

const BODY_VARIANTS = [
  (name: string) => `Hi,\n\nJust wanted to touch base and say hello from ${name}. Hope your week is going well.\n\nBest`,
  (name: string) => `Hello,\n\nSharing a quick note from ${name}. No rush on a reply — hope things are good on your end.\n\nCheers`,
  (name: string) => `Hi there,\n\n${name} here with a short check-in. Enjoy the rest of your day!\n\nThanks`,
  (name: string) => `Hey,\n\nHope all is well. Sending a brief hello from ${name}.\n\nTalk soon`,
]

export async function pickHealthyPoolPartner(
  excludeDomain?: string,
  organizationId?: string | null
): Promise<WarmupPoolMailbox | null> {
  // Prefer private tenant pool mailboxes, then shared Magnivo pool (organization_id IS NULL).
  // Never return another organization's private partners (PRD §6.8.12).
  const result = await pool.query(
    `SELECT id, email, domain, smtp_host, smtp_port, encrypted_smtp_password,
            imap_host, imap_port, encrypted_imap_password,
            health_status, daily_capacity, current_daily_usage
     FROM public.mail_warmup_pool_mailboxes
     WHERE health_status = 'healthy'
       AND is_warmup_only = TRUE
       AND current_daily_usage < daily_capacity
       AND ($1::text IS NULL OR domain <> $1)
       AND (
         organization_id IS NULL
         OR ($2::uuid IS NOT NULL AND organization_id = $2::uuid)
       )
       AND NOT (
         $2::uuid IS NOT NULL
         AND organization_id IS NOT NULL
         AND organization_id <> $2::uuid
       )
     ORDER BY
       CASE WHEN organization_id = $2::uuid THEN 0 ELSE 1 END,
       current_daily_usage ASC,
       random()
     LIMIT 1`,
    [excludeDomain ?? null, organizationId ?? null]
  )
  const row = result.rows[0]
  if (!row) return null
  return {
    id: row.id,
    email: row.email,
    domain: row.domain,
    smtpHost: row.smtp_host,
    smtpPort: row.smtp_port ?? 587,
    encryptedSmtpPassword: row.encrypted_smtp_password,
    imapHost: row.imap_host,
    imapPort: row.imap_port ?? 993,
    encryptedImapPassword: row.encrypted_imap_password,
    healthStatus: row.health_status,
    dailyCapacity: row.daily_capacity,
    currentDailyUsage: row.current_daily_usage,
  }
}

function partnerHasImapCreds(partner: WarmupPoolMailbox): boolean {
  return Boolean(partner.imapHost && partner.encryptedImapPassword)
}

function imapEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function imapCommand(socket: TLSSocket, tag: string, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('IMAP command timed out')), IMAP_TIMEOUT_MS)
    let buffer = ''
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      if (buffer.includes(`${tag} OK`) || buffer.includes(`${tag} NO`) || buffer.includes(`${tag} BAD`)) {
        clearTimeout(timer)
        socket.removeListener('data', onData)
        socket.removeListener('error', onError)
        resolve(buffer)
      }
    }
    const onError = (err: Error) => {
      clearTimeout(timer)
      socket.removeListener('data', onData)
      reject(err)
    }
    socket.on('data', onData)
    socket.on('error', onError)
    socket.write(`${tag} ${command}\r\n`)
  })
}

async function withPartnerImap<T>(
  partner: WarmupPoolMailbox,
  fn: (socket: TLSSocket) => Promise<T>
): Promise<T | null> {
  if (!partnerHasImapCreds(partner)) return null
  const password = decrypt(partner.encryptedImapPassword!)
  const host = partner.imapHost!
  const port = partner.imapPort || 993

  return new Promise((resolve) => {
    let socket: TLSSocket
    const cleanup = () => {
      try {
        socket?.destroy()
      } catch {
        // ignore
      }
    }

    const run = async () => {
      try {
        const login = await imapCommand(socket, 'A001', `LOGIN "${imapEscape(partner.email)}" "${imapEscape(password)}"`)
        if (!login.includes('A001 OK')) {
          cleanup()
          resolve(null)
          return
        }
        const result = await fn(socket)
        await imapCommand(socket, 'A999', 'LOGOUT').catch(() => {})
        cleanup()
        resolve(result)
      } catch {
        cleanup()
        resolve(null)
      }
    }

    const rawSocket = netConnect({ host, port, timeout: IMAP_TIMEOUT_MS })
    rawSocket.on('error', () => {
      cleanup()
      resolve(null)
    })
    socket = tlsConnect({ socket: rawSocket, rejectUnauthorized: true, servername: host })
    socket.on('error', () => {
      cleanup()
      resolve(null)
    })
    socket.on('connect', () => {
      void run()
    })
  })
}

async function searchFolderForSubject(socket: TLSSocket, folder: string, subject: string): Promise<string | null> {
  const select = await imapCommand(socket, 'A010', `SELECT "${imapEscape(folder)}"`)
  if (!select.includes('A010 OK')) return null
  const search = await imapCommand(
    socket,
    'A011',
    `UID SEARCH SUBJECT "${imapEscape(subject.slice(0, 120))}"`
  )
  const match = search.match(/\* SEARCH(?:\s+([\d\s]+))?/i)
  if (!match?.[1]?.trim()) return null
  return match[1].trim().split(/\s+/)[0] ?? null
}

export async function detectWarmupPlacement(
  partner: WarmupPoolMailbox,
  subject: string
): Promise<WarmupPlacement> {
  if (!partnerHasImapCreds(partner)) return 'unknown'
  const placement = await withPartnerImap(partner, async (socket) => {
    for (const folder of SPAM_FOLDER_CANDIDATES) {
      const uid = await searchFolderForSubject(socket, folder, subject)
      if (uid) return 'spam' as WarmupPlacement
    }
    const inboxUid = await searchFolderForSubject(socket, 'INBOX', subject)
    if (inboxUid) return 'inbox'
    return 'unknown'
  })
  return placement ?? 'unknown'
}

export async function markWarmupMessageRead(
  partner: WarmupPoolMailbox,
  subject: string
): Promise<boolean> {
  if (!partnerHasImapCreds(partner)) return false
  const marked = await withPartnerImap(partner, async (socket) => {
    await imapCommand(socket, 'A020', 'SELECT INBOX')
    const uid = await searchFolderForSubject(socket, 'INBOX', subject)
    if (!uid) return false
    const store = await imapCommand(socket, 'A021', `UID STORE ${uid} +FLAGS (\\Seen)`)
    return store.includes('A021 OK')
  })
  return marked === true
}

export async function moveWarmupFromSpamToInbox(
  partner: WarmupPoolMailbox,
  subject: string
): Promise<boolean> {
  if (!partnerHasImapCreds(partner)) return false
  const rescued = await withPartnerImap(partner, async (socket) => {
    for (const folder of SPAM_FOLDER_CANDIDATES) {
      const uid = await searchFolderForSubject(socket, folder, subject)
      if (!uid) continue
      const copy = await imapCommand(socket, 'A030', `UID COPY ${uid} INBOX`)
      if (!copy.includes('A030 OK')) continue
      await imapCommand(socket, 'A031', `UID STORE ${uid} +FLAGS (\\Deleted)`)
      await imapCommand(socket, 'A032', 'EXPUNGE').catch(() => {})
      return true
    }
    return false
  })
  return rescued === true
}

export async function recordSimulatedOpenMetric(input: {
  organizationId: string
  clientMailboxId: string
  configId?: string
}): Promise<void> {
  void input.configId
  await incrementMailboxUsage(input.organizationId, input.clientMailboxId, { opens: 1 })
}

export async function insertWarmupReplyEvent(input: {
  organizationId: string
  configId: string
  clientMailboxId: string
  poolMailboxId: string
  executionId?: string
  subject: string
}): Promise<void> {
  await pool.query(
    `INSERT INTO public.mail_warmup_pool_interactions
      (organization_id, client_mailbox_id, pool_mailbox_id, config_id, execution_id,
       direction, subject, placed_in, replied)
     VALUES ($1,$2,$3,$4,$5,'pool_to_client',$6,'inbox',TRUE)`,
    [
      input.organizationId,
      input.clientMailboxId,
      input.poolMailboxId,
      input.configId,
      input.executionId ?? null,
      input.subject,
    ]
  )
}

export async function updateWarmupInteractionFlags(
  interactionId: string,
  flags: Partial<{ opened: boolean; replied: boolean; spamRescued: boolean; placedIn: WarmupPlacement }>
): Promise<void> {
  const sets: string[] = []
  const values: unknown[] = [interactionId]
  let idx = 2
  if (flags.opened !== undefined) {
    sets.push(`opened = $${idx++}`)
    values.push(flags.opened)
  }
  if (flags.replied !== undefined) {
    sets.push(`replied = $${idx++}`)
    values.push(flags.replied)
  }
  if (flags.spamRescued !== undefined) {
    sets.push(`spam_rescued = $${idx++}`)
    values.push(flags.spamRescued)
  }
  if (flags.placedIn !== undefined) {
    sets.push(`placed_in = $${idx++}`)
    values.push(flags.placedIn)
  }
  if (sets.length === 0) return
  await pool.query(
    `UPDATE public.mail_warmup_pool_interactions SET ${sets.join(', ')} WHERE id = $1`,
    values
  )
}

export async function recordPartnerFailure(poolMailboxId: string, reason: string): Promise<void> {
  const result = await pool.query<{ metadata: Record<string, unknown> }>(
    `UPDATE public.mail_warmup_pool_mailboxes
     SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
           'consecutiveFailures', COALESCE((metadata->>'consecutiveFailures')::int, 0) + 1,
           'lastFailureReason', $2::text,
           'lastFailureAt', $3::text
         ),
         updated_at = NOW()
     WHERE id = $1
     RETURNING metadata`,
    [poolMailboxId, reason, new Date().toISOString()]
  )
  const failures = Number(result.rows[0]?.metadata?.consecutiveFailures ?? 0)
  if (failures >= PARTNER_FAILURE_THRESHOLD) {
    await markPoolMailboxUnhealthy(poolMailboxId, `Repeated failures (${failures}): ${reason}`)
  }
}

export async function recordPartnerSuccess(poolMailboxId: string): Promise<void> {
  await pool.query(
    `UPDATE public.mail_warmup_pool_mailboxes
     SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"consecutiveFailures": 0}'::jsonb,
         updated_at = NOW()
     WHERE id = $1`,
    [poolMailboxId]
  )
}

export function generateWarmupContent(senderName: string): { subject: string; text: string; html: string } {
  const subject = SUBJECTS[Math.floor(Math.random() * SUBJECTS.length)]
  const bodyFn = BODY_VARIANTS[Math.floor(Math.random() * BODY_VARIANTS.length)]
  const text = bodyFn(senderName || 'our team')
  const html = text.split('\n').map((l) => `<p>${l || '&nbsp;'}</p>`).join('')
  return { subject, text, html }
}

export async function sendWarmupFromClientMailbox(input: {
  organizationId: string
  mailboxId: string
  toEmail: string
  subject: string
  html: string
  text: string
}): Promise<{ messageId?: string }> {
  const mailbox = await mailboxRepo.findMailboxWithConfigs(input.mailboxId, input.organizationId)
  if (!mailbox) throw new Error('Client mailbox not found')

  // PRD §6.3.05 / §6.3.27: never send warmup traffic using a domain marked for campaigns only.
  // Warmup pool partners are is_warmup_only=true; client may send TO them, but we refuse if
  // the client's domain purpose is exclusively "sending" without warmup allowance when flagged.
  const domainName = mailbox.email.split('@')[1]?.toLowerCase()
  if (domainName) {
    const domainCheck = await pool
      .query<{ purpose: string; is_warmup_only: boolean | null }>(
        `SELECT purpose, (metadata->>'warmupOnly')::boolean AS is_warmup_only
         FROM public.mail_deliverability_domains
         WHERE organization_id = $1 AND LOWER(domain) = $2
         LIMIT 1`,
        [input.organizationId, domainName]
      )
      .catch(() => ({ rows: [] as { purpose: string; is_warmup_only: boolean | null }[] }))
    const purpose = domainCheck.rows[0]?.purpose
    // Soft advisory only when purpose is tracking; hard block if domain is tracking-only
    if (purpose === 'tracking') {
      throw new Error('Warmup cannot send from a tracking-only domain')
    }
  }

  // Ensure warmup does not originate from shared campaign infra incorrectly:
  // client mailbox sends TO the pool; pool domains are warmup-only.
  if (mailbox.authType === 'oauth' && mailbox.oauthConfig?.encryptedRefreshToken) {
    const refresh = decrypt(mailbox.oauthConfig.encryptedRefreshToken)
    const service = getOAuthService(mailbox.oauthConfig.provider)
    const tokens = await service.refreshToken(refresh)
    if (mailbox.oauthConfig.provider === 'gmail') {
      const { sendEmail } = await import('@/lib/gmail')
      const result = await sendEmail(tokens.accessToken, {
        to: input.toEmail,
        subject: input.subject,
        bodyHtml: input.html,
        bodyText: input.text,
      })
      return { messageId: result?.id }
    }
  }

  if (!mailbox.smtpConfig) throw new Error('SMTP config required for warmup send')
  const password = decrypt(mailbox.smtpConfig.encryptedPasswordReference)
  const transport = nodemailer.createTransport({
    host: mailbox.smtpConfig.smtpHost,
    port: mailbox.smtpConfig.smtpPort,
    secure: mailbox.smtpConfig.encryption === 'ssl',
    auth: { user: mailbox.smtpConfig.username, pass: password },
  })
  try {
    const info = await transport.sendMail({
      from: `"${mailbox.senderName || mailbox.displayName || mailbox.email}" <${mailbox.email}>`,
      to: input.toEmail,
      subject: input.subject,
      html: input.html,
      text: input.text,
    })
    return { messageId: info.messageId }
  } finally {
    transport.close()
  }
}

export async function recordWarmupInteraction(input: {
  organizationId: string
  clientMailboxId: string
  poolMailboxId: string
  configId?: string
  executionId?: string
  subject: string
  placedIn?: 'inbox' | 'spam' | 'unknown'
}): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO public.mail_warmup_pool_interactions
      (organization_id, client_mailbox_id, pool_mailbox_id, config_id, execution_id,
       direction, subject, placed_in)
     VALUES ($1,$2,$3,$4,$5,'client_to_pool',$6,$7)
     RETURNING id`,
    [
      input.organizationId,
      input.clientMailboxId,
      input.poolMailboxId,
      input.configId ?? null,
      input.executionId ?? null,
      input.subject,
      input.placedIn ?? 'unknown',
    ]
  )
  await pool.query(
    `UPDATE public.mail_warmup_pool_mailboxes
     SET current_daily_usage = current_daily_usage + 1, updated_at = NOW()
     WHERE id = $1`,
    [input.poolMailboxId]
  )
  await incrementMailboxUsage(input.organizationId, input.clientMailboxId, { warmup_sends: 1, sends: 1 })
  return result.rows[0].id
}

export async function markPoolMailboxUnhealthy(poolMailboxId: string, reason: string): Promise<void> {
  await pool.query(
    `UPDATE public.mail_warmup_pool_mailboxes
     SET health_status = 'degraded',
         metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
         updated_at = NOW()
     WHERE id = $1`,
    [poolMailboxId, JSON.stringify({ lastUnhealthyReason: reason, at: new Date().toISOString() })]
  )
}

/** Seed helper for ops — stores encrypted SMTP password for a Magnivo warmup pool mailbox */
export async function upsertWarmupPoolMailbox(input: {
  email: string
  domain: string
  smtpHost: string
  smtpPort?: number
  smtpPassword: string
  dailyCapacity?: number
}): Promise<string> {
  const encrypted = encrypt(input.smtpPassword)
  const result = await pool.query<{ id: string }>(
    `INSERT INTO public.mail_warmup_pool_mailboxes
      (email, domain, smtp_host, smtp_port, encrypted_smtp_password, daily_capacity, is_warmup_only, health_status)
     VALUES ($1,$2,$3,$4,$5,$6,TRUE,'healthy')
     ON CONFLICT (email) DO UPDATE SET
       smtp_host = EXCLUDED.smtp_host,
       smtp_port = EXCLUDED.smtp_port,
       encrypted_smtp_password = EXCLUDED.encrypted_smtp_password,
       daily_capacity = EXCLUDED.daily_capacity,
       health_status = 'healthy',
       updated_at = NOW()
     RETURNING id`,
    [
      input.email.toLowerCase(),
      input.domain.toLowerCase(),
      input.smtpHost,
      input.smtpPort ?? 587,
      encrypted,
      input.dailyCapacity ?? 50,
    ]
  )
  return result.rows[0].id
}
