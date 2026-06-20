export type EngageEmailSummary = {
  id: string
  threadId: string
  from: string
  to?: string
  subject: string
  snippet: string
  date: string
  unread: boolean
  starred: boolean
  labelIds?: string[]
  direction?: 'sent' | 'received'
}

export type EngageThreadMessage = {
  id: string
  messageId?: string // RFC Message-ID header, used to thread replies (In-Reply-To)
  from: string
  to: string
  subject: string
  date: string
  bodyHtml: string
  bodyText: string
}

export type EngageThread = {
  id: string
  subject: string
  messages: EngageThreadMessage[]
}

export type EngageAttachment = {
  // Storage object path inside the `engage-attachments` bucket.
  path: string
  filename: string
  mimeType: string
  size?: number
}

export type ComposePayload = {
  to: string
  subject: string
  bodyHtml: string
  // Optional threading fields — set when replying so Gmail keeps it in-thread.
  threadId?: string
  inReplyTo?: string // the Message-ID being replied to
  references?: string
  attachments?: EngageAttachment[]
}

export type EngageLead = {
  id: string
  name: string
  email: string
  company: string
}

export type EngageTemplate = {
  id: string
  name: string
  subject: string
  body: string
  attachments: EngageAttachment[]
  updatedAt: string
}

export type EngageSequenceStep = {
  id: string
  templateId: string
  delayDays: number
}

export type EngageSequence = {
  id: string
  name: string
  steps: EngageSequenceStep[]
}

export type EngageCampaign = {
  id: string
  name: string
  audienceLeadIds: string[]
  templateId: string
  sequenceId?: string
  scheduleAt: string
  status: 'draft' | 'scheduled' | 'running' | 'completed'
  stopOnReply?: boolean
  openTracking?: boolean
  linkTracking?: boolean
  dailyLimit?: number
  // 'template' = mail-merge ({{name}}/{{company}}); 'ai' = AI writes a unique
  // email per lead, using the template as a base + the optional instruction.
  personalizeMode?: 'template' | 'ai'
  aiInstruction?: string
  // 'manual' = user-built (Path B); 'auto' = created by a phase-3 Reach-Out run
  // (Path A). icpId links an auto campaign to its ICP.
  origin?: 'manual' | 'auto'
  icpId?: number | null
}

// Delivery outcome counts per campaign (Path A GTM runs + Path B campaigns),
// derived from outreach_log status — the unified send ledger.
export type DeliveryStats = {
  campaignId: string
  name: string
  source: 'campaign' | 'gtm' | 'manual'
  attempted: number
  sent: number
  failed: number
  skipped: number
}

// Instantly-style per-lead interest labels inside a campaign / unibox.
export const INTEREST_STATUSES = [
  'lead', 'interested', 'meeting_booked', 'meeting_completed', 'won',
  'no_show', 'out_of_office', 'wrong_person', 'not_interested',
] as const
export type InterestStatus = (typeof INTEREST_STATUSES)[number]
// interest labels that count as opportunities
export const POSITIVE_INTEREST: InterestStatus[] = ['interested', 'meeting_booked', 'meeting_completed', 'won']

export type CampaignLeadRow = {
  recipientId: string
  leadId: number | null
  email: string
  name: string
  company: string
  jobTitle: string
  provider: string
  deliveryStatus: string // recipient status: pending/in_progress/completed/replied/failed/skipped
  interestStatus: InterestStatus
  skipReason: string | null
  threadId: string | null
  lastSentAt: string | null
}

export type CampaignStepStat = {
  step: number
  sent: number
  opened: number
  replied: number
  clicked: number
  opportunities: number
}

export type CampaignKpis = {
  sequenceStarted: number // recipients that received step 1
  sent: number
  openCount: number
  openRate: number
  clickCount: number
  clickRate: number
  replyCount: number
  replyRate: number
  opportunities: number
  unsubscribes: number
  progressPct: number // % of recipients completed/replied
}

export type CampaignDetailData = {
  campaign: EngageCampaign
  kpis: CampaignKpis
  steps: CampaignStepStat[]
  leads: CampaignLeadRow[]
  timeSeries: EngageAnalyticsDay[]
}

// Unibox (Instantly-style inbox) left-rail metadata.
export type UniboxThreadMeta = {
  campaignId: string | null
  campaignName: string | null
  interestStatus: InterestStatus
  recipientId: string | null
  // True when this campaign recipient bounced (undeliverable, sequence stopped).
  bounced?: boolean
}

export type UniboxMeta = {
  byThread: Record<string, UniboxThreadMeta>
  campaigns: Array<{ id: string; name: string }>
  mailboxes: Array<{ email: string }>
  statusCounts: Record<string, number>
}

// Conversations (WhatsApp/two-way threads) — moved out of actions/engage.ts
// because that file is 'use server' and may only export async functions.
export type ConversationMessage = {
  id: string
  senderType: string
  messageType: string
  content: string
  mediaUrl: string | null
  status: string
  createdAt: string
}

export type ConversationInsight = {
  intent: string | null
  sentiment: string | null
  suggestedReply: string | null
  urgency: string | null
}

export type ConversationThread = {
  id: string
  leadName: string
  leadPhone: string | null
  unreadCount: number
  lastCustomerMessageAt: string | null
  createdAt: string
  messages: ConversationMessage[]
  insight: ConversationInsight | null
}

export type UnsubscribeRow = {
  email: string
  campaignId: string | null
  unsubscribedAt: string | null
}

export type EngageCampaignStats = {
  campaignId: string
  name: string
  status: string
  recipients: number
  sent: number
  opens: number
  uniqueOpens: number
  clicks: number
  uniqueClicks: number
  replies: number
  opportunities: number
  completed: number
  failed: number
}

export type EngageAccountStats = {
  email: string
  provider: string
  connectedAt: string | null
  lastSyncedAt: string | null
  watchActive: boolean
  sent: number
  opens: number
  replies: number
  bounces: number
}

export type EngageAnalyticsDay = {
  date: string
  sends: number
  opens: number
  clicks: number
  replies: number
  unsubscribes: number
}

export type EngageAnalyticsData = {
  totals: {
    sends: number
    opens: number
    uniqueOpens: number
    clicks: number
    uniqueClicks: number
    replies: number
    uniqueReplies: number
    unsubscribes: number
    opportunities: number
  }
  openRate: number
  clickRate: number
  replyRate: number
  unsubscribeRate: number
  timeSeries: EngageAnalyticsDay[]
  campaigns: EngageCampaignStats[]
  accounts: EngageAccountStats[]
}

export type AccountStatus = 'active' | 'paused' | 'warming' | 'error' | 'disconnected'

export type AccountTag = {
  id: string
  name: string
  color: string
}

export type EmailAccount = {
  id: string
  email: string
  provider: string
  status: AccountStatus
  connectedAt: string | null
  lastSyncedAt: string | null
  watchActive: boolean
  dailySendLimit: number
  sentToday: number
  warmupEnabled: boolean
  warmupStartedAt: string | null
  warmupDailyLimit: number
  warmupReplyRate: number
  warmupOpenRate: number
  warmupSpamRescuePct: number
  warmupMarkImportantPct: number
  warmupEmails7d: number
  healthScore: number | null
  combinedScore: number | null
  sent: number
  opens: number
  clicks: number
  replies: number
  tags: AccountTag[]
}

export type AccountSettingsInput = {
  status?: AccountStatus
  dailySendLimit?: number
  warmupEnabled?: boolean
  warmupDailyLimit?: number
  warmupReplyRate?: number
  warmupOpenRate?: number
  warmupSpamRescuePct?: number
  warmupMarkImportantPct?: number
}

export type GtmScheduleConfig = {
  id?: string
  icpId: number | null
  enabled: boolean
  runHour: number
  runMinute: number
  timezone: string
  leadsPerDay: number
  sender: 'gmail' | 'instantly'
  autoSend: boolean
  lastRunDate: string | null
  lastRunStatus: string | null
}
