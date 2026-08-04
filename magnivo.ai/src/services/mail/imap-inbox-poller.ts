import { connect as tlsConnect, type TLSSocket } from 'tls'
import { connect as netConnect } from 'net'
import pool from '@/lib/db'
import { decrypt } from '@/lib/encryption'
import * as mailboxRepo from '@/repositories/mail/mailbox-repository'
import { ingestInboundMessage } from './inbox-service'
import type { IMAPTestInput } from './imap-validator'

const IMAP_TIMEOUT = 20_000

type ParsedImapMessage = {
  uid: string
  fromEmail: string
  toEmails: string[]
  subject: string
  bodyText: string
  bodyHtml: string
}

function imapCommand(socket: TLSSocket, tag: string, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('IMAP command timed out')), IMAP_TIMEOUT)
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

function decodeEncodedWord(value: string): string {
  return value.replace(/=\?([^?]+)\?([BQbq])\?([^?]*)\?=/g, (_m, _charset, encoding, text) => {
    if (String(encoding).toUpperCase() === 'B') {
      return Buffer.from(text, 'base64').toString('utf8')
    }
    return text.replace(/_/g, ' ')
  })
}

function extractHeader(raw: string, name: string): string {
  const match = raw.match(new RegExp(`^${name}:\\s*(.+)$`, 'im'))
  return match ? decodeEncodedWord(match[1].trim()) : ''
}

function extractAddresses(raw: string, name: string): string[] {
  const value = extractHeader(raw, name)
  if (!value) return []
  return value
    .split(',')
    .map((part) => {
      const angle = part.match(/<([^>]+)>/)
      return (angle ? angle[1] : part).trim().toLowerCase()
    })
    .filter(Boolean)
}

function extractBody(raw: string): { text: string; html: string } {
  const textMatch = raw.match(/Content-Type:\s*text\/plain[\s\S]*?\r?\n\r?\n([\s\S]*?)(?=\r?\n--|\r?\n[A-Z]|$)/i)
  const htmlMatch = raw.match(/Content-Type:\s*text\/html[\s\S]*?\r?\n\r?\n([\s\S]*?)(?=\r?\n--|\r?\n[A-Z]|$)/i)
  const text = textMatch ? textMatch[1].trim() : ''
  const html = htmlMatch ? htmlMatch[1].trim() : ''
  if (!text && !html) {
    const bodyStart = raw.indexOf('\r\n\r\n')
    const fallback = bodyStart >= 0 ? raw.slice(bodyStart + 4).trim() : raw.trim()
    return { text: fallback, html: '' }
  }
  return { text, html }
}

function parseFetchedMessage(uid: string, fetchResponse: string): ParsedImapMessage | null {
  const raw = fetchResponse
  const fromEmail = extractAddresses(raw, 'From')[0] || ''
  const toEmails = extractAddresses(raw, 'To')
  const subject = extractHeader(raw, 'Subject')
  const { text, html } = extractBody(raw)
  if (!fromEmail && !subject && !text) return null
  return {
    uid,
    fromEmail,
    toEmails,
    subject,
    bodyText: text || html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    bodyHtml: html || text,
  }
}

async function withImapSession<T>(
  input: IMAPTestInput,
  handler: (socket: TLSSocket, run: (tag: string, command: string) => Promise<string>) => Promise<T>
): Promise<T> {
  const port = input.port || (input.ssl ? 993 : 143)

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error('IMAP session timed out'))
    }, IMAP_TIMEOUT * 4)

    let socket: TLSSocket
    let tagCounter = 1
    const run = (tag: string, command: string) => imapCommand(socket, tag, command)

    const onConnect = async () => {
      try {
        const login = await run(`A${tagCounter++}`, `LOGIN "${input.username}" "${input.password}"`)
        if (!login.includes(' OK')) throw new Error('IMAP authentication failed')
        await run(`A${tagCounter++}`, 'SELECT INBOX')
        const result = await handler(socket, (tag, command) => run(tag, command))
        await run(`A${tagCounter++}`, 'LOGOUT').catch(() => {})
        clearTimeout(timer)
        socket.destroy()
        resolve(result)
      } catch (err) {
        clearTimeout(timer)
        socket.destroy()
        reject(err)
      }
    }

    if (input.ssl) {
      const rawSocket = netConnect({ host: input.host, port, timeout: IMAP_TIMEOUT })
      rawSocket.on('error', (err) => {
        clearTimeout(timer)
        reject(err)
      })
      socket = tlsConnect({ socket: rawSocket, rejectUnauthorized: true, servername: input.host })
      socket.on('error', (err) => {
        clearTimeout(timer)
        reject(err)
      })
      socket.on('connect', () => {
        void onConnect()
      })
    } else {
      const plainSocket = netConnect({ host: input.host, port, timeout: IMAP_TIMEOUT })
      plainSocket.on('error', (err) => {
        clearTimeout(timer)
        reject(err)
      })
      plainSocket.on('connect', () => {
        socket = plainSocket as unknown as TLSSocket
        void onConnect()
      })
    }
  })
}

async function fetchUnseenMessages(input: IMAPTestInput): Promise<ParsedImapMessage[]> {
  return withImapSession(input, async (_socket, run) => {
    let tagCounter = 100
    const search = await run(`B${tagCounter++}`, 'UID SEARCH UNSEEN')
    const uidMatches = search.match(/\* SEARCH([\s\S]*)/i)
    const uids = uidMatches
      ? uidMatches[1]
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 25)
      : []

    const messages: ParsedImapMessage[] = []
    for (const uid of uids) {
      const fetched = await run(`B${tagCounter++}`, `UID FETCH ${uid} (BODY.PEEK[] FLAGS)`)
      const parsed = parseFetchedMessage(uid, fetched)
      if (parsed) messages.push(parsed)
      await run(`B${tagCounter++}`, `UID STORE ${uid} +FLAGS (\\Seen)`)
    }
    return messages
  })
}

export async function pollImapMailbox(
  orgId: string,
  mailboxId: string
): Promise<{ ingested: number; errors: string[] }> {
  const mailbox = await mailboxRepo.findMailboxWithConfigs(mailboxId, orgId)
  if (!mailbox?.imapConfig) {
    return { ingested: 0, errors: ['Mailbox has no IMAP configuration'] }
  }

  const passwordRef = mailbox.imapConfig.encryptedPasswordReference
  if (!passwordRef) {
    return { ingested: 0, errors: ['IMAP password not configured'] }
  }

  const input: IMAPTestInput = {
    host: mailbox.imapConfig.host,
    port: mailbox.imapConfig.port,
    ssl: mailbox.imapConfig.ssl,
    username: mailbox.imapConfig.username,
    password: decrypt(passwordRef),
  }

  const errors: string[] = []
  let ingested = 0

  try {
    const messages = await fetchUnseenMessages(input)
    for (const message of messages) {
      const providerMessageId = `imap:${mailboxId}:${message.uid}`
      const existing = await pool.query(
        `SELECT 1 FROM public.mail_inbox_messages
         WHERE organization_id = $1 AND provider_message_id = $2 LIMIT 1`,
        [orgId, providerMessageId]
      )
      if (existing.rows[0]) continue

      const lead = await pool.query<{ id: string }>(
        `SELECT id FROM public.mail_leads
         WHERE organization_id = $1 AND LOWER(email) = $2 LIMIT 1`,
        [orgId, message.fromEmail.toLowerCase()]
      )

      const result = await ingestInboundMessage({
        organizationId: orgId,
        mailboxId,
        fromEmail: message.fromEmail,
        toEmails: message.toEmails.length > 0 ? message.toEmails : [mailbox.email],
        subject: message.subject || '(no subject)',
        bodyText: message.bodyText,
        bodyHtml: message.bodyHtml,
        providerThreadId: `imap-thread:${message.uid}`,
        providerMessageId,
        leadId: lead.rows[0]?.id,
      })

      if (result.success) ingested++
      else if (result.error) errors.push(result.error)
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : 'IMAP poll failed')
  }

  return { ingested, errors }
}

export async function pollImapInboxes(orgId?: string): Promise<{
  polled: number
  ingested: number
  errors: string[]
}> {
  const params: unknown[] = []
  let orgFilter = ''
  if (orgId) {
    params.push(orgId)
    orgFilter = `AND m.organization_id = $${params.length}`
  }

  const result = await pool.query<{ id: string; organization_id: string }>(
    `SELECT m.id, m.organization_id
     FROM public.mail_mailboxes m
     INNER JOIN public.mailbox_imap_configs ic ON ic.mailbox_id = m.id
     WHERE m.deleted_at IS NULL
       AND m.auth_type IN ('smtp', 'imap')
       ${orgFilter}`,
    params
  )

  let ingested = 0
  const errors: string[] = []
  for (const row of result.rows) {
    const poll = await pollImapMailbox(row.organization_id, row.id)
    ingested += poll.ingested
    errors.push(...poll.errors)
  }

  return { polled: result.rows.length, ingested, errors }
}

/** Alias used by deliverability worker cron */
export async function pollOrgSmtpMailboxes(orgId: string): Promise<{
  polled: number
  ingested: number
  errors: string[]
}> {
  return pollImapInboxes(orgId)
}
