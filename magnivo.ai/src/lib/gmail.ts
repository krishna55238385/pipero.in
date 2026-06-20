import type { ComposePayload, EngageAttachment, EngageEmailSummary, EngageThread, EngageThreadMessage } from '@/types/engage'

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1'
const GOOGLE_OAUTH_BASE = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'

type OAuthTokenResponse = {
  access_token: string
  expires_in: number
  refresh_token?: string
  scope?: string
  token_type?: string
}

function env(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is missing`)
  return value
}

function decodeBase64Url(input: string) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(normalized, 'base64').toString('utf8')
}

function encodeBase64Url(input: string | Buffer) {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

/** Pull the bare address out of a `Name <email@x.com>` header value. */
export function parseEmailAddress(header: string): string {
  const match = header.match(/<([^>]+)>/)
  return (match?.[1] ?? header).trim().toLowerCase()
}

async function gmailFetch<T>(path: string, accessToken: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${GMAIL_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Gmail API ${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

export function getGmailScopes() {
  return [
    'openid',
    'email',
    'profile',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.modify',
  ]
}

export function buildGmailOAuthUrl(state: string) {
  const clientId = env('GOOGLE_CLIENT_ID')
  const redirectUri = env('GOOGLE_REDIRECT_URI')
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    access_type: 'offline',
    // `select_account` forces Google to show the account chooser so a user can
    // connect a SECOND/THIRD mailbox instead of silently reusing the one they're
    // already signed into; `consent` still guarantees a refresh_token is returned.
    prompt: 'select_account consent',
    scope: getGmailScopes().join(' '),
    state,
  })
  return `${GOOGLE_OAUTH_BASE}?${params.toString()}`
}

export async function exchangeCodeForTokens(code: string) {
  const clientId = env('GOOGLE_CLIENT_ID')
  const clientSecret = env('GOOGLE_CLIENT_SECRET')
  const redirectUri = env('GOOGLE_REDIRECT_URI')
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  })
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`Token exchange failed: ${txt}`)
  }
  return (await res.json()) as OAuthTokenResponse
}

export async function refreshAccessToken(refreshToken: string) {
  const clientId = env('GOOGLE_CLIENT_ID')
  const clientSecret = env('GOOGLE_CLIENT_SECRET')
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  })
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`Token refresh failed: ${txt}`)
  }
  return (await res.json()) as OAuthTokenResponse
}

export async function getGoogleProfileEmail(accessToken: string) {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`Failed to fetch profile email: ${txt}`)
  }
  const data = (await res.json()) as { email?: string }
  if (!data.email) throw new Error('Google profile did not include email')
  return data.email
}

function parseHeader(headers: Array<{ name: string; value: string }> | undefined, name: string) {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''
}

function extractBody(payload: unknown): { bodyText: string; bodyHtml: string } {
  const root = (payload ?? {}) as {
    parts?: unknown[]
    mimeType?: string
    body?: { data?: string }
  }
  let html = ''
  let text = ''

  const walk = (node: unknown) => {
    const n = (node ?? {}) as {
      mimeType?: string
      body?: { data?: string }
      parts?: unknown[]
    }
    if (!node) return
    if (n.mimeType === 'text/plain' && n.body?.data) {
      text ||= decodeBase64Url(n.body.data)
    } else if (n.mimeType === 'text/html' && n.body?.data) {
      html ||= decodeBase64Url(n.body.data)
    }
    if (Array.isArray(n.parts)) n.parts.forEach(walk)
  }

  walk(root)
  if (!text && root.body?.data) text = decodeBase64Url(root.body.data)
  if (!html && text) html = `<pre style="white-space:pre-wrap;font-family:inherit">${text}</pre>`
  return { bodyText: text, bodyHtml: html }
}

type GmailMessageMeta = {
  id?: string
  threadId?: string
  snippet?: string
  labelIds?: string[]
  payload?: { headers?: Array<{ name: string; value: string }> }
}

const SUMMARY_METADATA_PATH =
  'format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date'

function metaToSummary(msg: GmailMessageMeta): EngageEmailSummary {
  const headers = msg.payload?.headers
  const labelIds = (msg.labelIds ?? []) as string[]
  return {
    id: String(msg.id ?? ''),
    threadId: String(msg.threadId ?? ''),
    from: parseHeader(headers, 'From') || '(unknown)',
    to: parseHeader(headers, 'To'),
    subject: parseHeader(headers, 'Subject') || '(no subject)',
    snippet: msg.snippet || '',
    date: parseHeader(headers, 'Date') || new Date().toISOString(),
    unread: labelIds.includes('UNREAD'),
    starred: labelIds.includes('STARRED'),
    labelIds,
  }
}

/**
 * Lists messages across the whole mailbox (inbox + sent), newest first, with
 * pagination. `maxResults` is the total cap across pages (Gmail caps a single
 * page at 100).
 */
export async function listInboxMessages(
  accessToken: string,
  opts?: { q?: string; unread?: boolean; starred?: boolean; maxResults?: number },
) {
  const queryParts: string[] = []
  if (opts?.q) queryParts.push(opts.q)
  if (opts?.unread) queryParts.push('is:unread')
  if (opts?.starred) queryParts.push('is:starred')
  const q = queryParts.join(' ').trim()
  const total = Math.max(1, Math.min(opts?.maxResults ?? 100, 500))

  const ids: Array<{ id: string; threadId: string }> = []
  let pageToken: string | undefined
  while (ids.length < total) {
    const pageSize = Math.min(100, total - ids.length)
    const qs = new URLSearchParams({ maxResults: String(pageSize) })
    if (q) qs.set('q', q)
    if (pageToken) qs.set('pageToken', pageToken)
    const list = await gmailFetch<{ messages?: Array<{ id: string; threadId: string }>; nextPageToken?: string }>(
      `/users/me/messages?${qs.toString()}`,
      accessToken,
    )
    ids.push(...(list.messages ?? []))
    pageToken = list.nextPageToken
    if (!pageToken || !(list.messages ?? []).length) break
  }
  if (!ids.length) return [] as EngageEmailSummary[]

  // Fetch metadata in chunks to stay well under Gmail's concurrency limits.
  const summaries: EngageEmailSummary[] = []
  const CHUNK = 20
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK)
    const details = await Promise.all(
      chunk.map((m) =>
        gmailFetch<GmailMessageMeta>(`/users/me/messages/${m.id}?${SUMMARY_METADATA_PATH}`, accessToken),
      ),
    )
    summaries.push(...details.map(metaToSummary))
  }
  return summaries
}

export async function getThreadById(accessToken: string, threadId: string): Promise<EngageThread> {
  const data = await gmailFetch<{ id?: string; messages?: Array<{ id?: string; payload?: unknown }> }>(`/users/me/threads/${threadId}?format=full`, accessToken)
  const messages = (data.messages ?? []).map((msg) => {
    const payload = (msg.payload ?? {}) as { headers?: Array<{ name: string; value: string }> }
    const headers = payload.headers
    const body = extractBody(msg.payload)
    return {
      id: String(msg.id ?? ''),
      messageId: parseHeader(headers, 'Message-ID') || parseHeader(headers, 'Message-Id') || undefined,
      from: parseHeader(headers, 'From') || '(unknown)',
      to: parseHeader(headers, 'To') || '',
      subject: parseHeader(headers, 'Subject') || '(no subject)',
      date: parseHeader(headers, 'Date') || new Date().toISOString(),
      bodyHtml: body.bodyHtml,
      bodyText: body.bodyText,
    } satisfies EngageThreadMessage
  })
  return {
    id: String(data.id ?? threadId),
    subject: messages[0]?.subject || '(no subject)',
    messages,
  }
}

/** Marks every message in a thread as read (removes the UNREAD label). */
export async function markThreadRead(accessToken: string, threadId: string) {
  await gmailFetch(`/users/me/threads/${threadId}/modify`, accessToken, {
    method: 'POST',
    body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
  })
}

function buildMimeMessage(payload: ComposePayload, attachments: Array<{ meta: EngageAttachment; data: Buffer }>) {
  const headers = [`To: ${payload.to}`, `Subject: ${payload.subject}`, 'MIME-Version: 1.0']
  // Threading: when replying, these headers + the threadId keep Gmail's
  // conversation grouping intact instead of starting a new thread.
  if (payload.inReplyTo) {
    headers.push(`In-Reply-To: ${payload.inReplyTo}`)
    headers.push(`References: ${payload.references || payload.inReplyTo}`)
  }

  if (!attachments.length) {
    headers.push('Content-Type: text/html; charset=UTF-8')
    return [...headers, '', payload.bodyHtml].join('\r\n')
  }

  const boundary = `engage_${Math.random().toString(36).slice(2)}`
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`)
  const parts: string[] = [...headers, '', `--${boundary}`, 'Content-Type: text/html; charset=UTF-8', '', payload.bodyHtml]
  for (const att of attachments) {
    const filename = att.meta.filename.replace(/"/g, '')
    const base64 = att.data.toString('base64').replace(/(.{76})/g, '$1\r\n')
    parts.push(
      `--${boundary}`,
      `Content-Type: ${att.meta.mimeType || 'application/octet-stream'}; name="${filename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${filename}"`,
      '',
      base64,
    )
  }
  parts.push(`--${boundary}--`)
  return parts.join('\r\n')
}

export async function sendEmail(
  accessToken: string,
  payload: ComposePayload,
  attachments: Array<{ meta: EngageAttachment; data: Buffer }> = [],
) {
  const message = buildMimeMessage(payload, attachments)
  const raw = encodeBase64Url(message)
  const body: { raw: string; threadId?: string } = { raw }
  if (payload.threadId) body.threadId = payload.threadId
  return gmailFetch<{ id?: string; threadId?: string; labelIds?: string[] }>(
    '/users/me/messages/send',
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  )
}

export async function getMessageSummaryById(accessToken: string, messageId: string) {
  const msg = await gmailFetch<GmailMessageMeta>(
    `/users/me/messages/${messageId}?${SUMMARY_METADATA_PATH}`,
    accessToken,
  )
  return metaToSummary(msg)
}

export async function startGmailWatch(accessToken: string) {
  const topicName = env('GOOGLE_PUBSUB_TOPIC_NAME')
  // Watch the whole mailbox (no label filter): sent mail must sync too, not
  // just INBOX — otherwise the Sent box only updates on manual refresh.
  return gmailFetch<{ historyId?: string; expiration?: string }>('/users/me/watch', accessToken, {
    method: 'POST',
    body: JSON.stringify({ topicName }),
  })
}

export async function listHistoryMessageIds(accessToken: string, startHistoryId: string) {
  const items: string[] = []
  let latestHistoryId = startHistoryId
  let pageToken: string | undefined

  for (let i = 0; i < 5; i++) {
    const qs = new URLSearchParams({
      startHistoryId,
      historyTypes: 'messageAdded',
      maxResults: '100',
    })
    if (pageToken) qs.set('pageToken', pageToken)

    const data = await gmailFetch<{
      historyId?: string
      nextPageToken?: string
      history?: Array<{
        id?: string
        messagesAdded?: Array<{ message?: { id?: string } }>
      }>
    }>(`/users/me/history?${qs.toString()}`, accessToken)

    if (data.historyId) latestHistoryId = String(data.historyId)
    for (const h of data.history ?? []) {
      if (h.id) latestHistoryId = String(h.id)
      for (const ma of h.messagesAdded ?? []) {
        const id = ma.message?.id
        if (id) items.push(id)
      }
    }
    pageToken = data.nextPageToken
    if (!pageToken) break
  }

  return {
    messageIds: Array.from(new Set(items)),
    latestHistoryId,
  }
}
