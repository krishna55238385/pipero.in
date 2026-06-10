// Shared types for the GTM pipeline data (phase1/2/3 Supabase tables) surfaced
// in the CRM. Kept in a plain module (not 'use server') so both server actions
// and client components can import them.

export type IntentScore = 'High' | 'Medium' | 'Low'
export type ScoreTier = 'hot' | 'warm' | 'cold' | 'disqualified' | string

export interface Icp {
  id: number
  name: string
  product_line?: string | null
  industry?: string[] | null
  geography?: string[] | null
  business_stage?: string | null
  buyer_titles?: string[] | null
  pain_points?: string | null
  prompts?: string | null
  active?: boolean | null
  created_at?: string | null
  // derived
  leadCount?: number
  hotCount?: number
}

export interface ProspectLeadRow {
  id: number // leads_raw.id
  company: string
  contactName: string | null
  title: string | null
  email: string | null
  verified: boolean
  bounceStatus: string | null
  location: string | null
  industry: string | null
  companySize: string | null
  domain: string | null
  linkedin: string | null
  icpId: number | null
  icpScore: number | null
  scoreTier: ScoreTier | null
  intentScore: IntentScore
  signalsCount: number
  topSignalType: string | null
  promoted: boolean
  crmLeadId: string | null
  createdAt: string
}

export interface BuyingSignalRow {
  id: number
  leadId: number
  company: string | null
  signalType: string
  weight: number
  text: string | null
  summary: string | null
  sourceUrl: string | null
  intent: string | null
  detectedAt: string
}

export interface SignalTypeSummary {
  type: string
  label: string
  count: number
  highIntent: number
  lastDetected: string | null
}

export interface VisitorSignalRow {
  id: number
  company: string | null
  domain: string | null
  dimensionValue: string | null
  channel: string | null
  country: string | null
  sessions: number
  engagedSessions: number
  pageViews: number
  avgEngagementSeconds: number
  topPages: string[]
  visitorScore: number
  strength: string
  intentScore: IntentScore
  matchedCompanyId: string | null
  matchedLeadId: number | null
  lastSeenAt: string
}

export interface Ga4Connection {
  id: string
  property_id: string
  measurement_id: string | null
  website_url: string | null
  sync_enabled: boolean
  status: string
  last_synced_at: string | null
  last_error: string | null
}

export interface AccountIntel {
  id: number
  leadId: number
  companyName: string
  companyDomain: string | null
  whatTheyDo: string | null
  businessModel: string | null
  growthTrajectory: string | null
  competitivePosition: string | null
  recentMoves: string[]
  likelyPainPoints: string[]
  instabilityFlags: string[]
  keySignalsForOutreach: string[]
  briefQualityScore: number
  status: string
  refreshedAt: string | null
}

export interface StakeholderRow {
  id: number
  fullName: string
  jobTitle: string | null
  roleType: string
  seniority: string | null
  functionArea: string | null
  linkedinUrl: string | null
  email: string | null
  emailConfidence: string | null
  reportsTo: string | null
  rank: number
}

export interface StakeholderMap {
  entryPointFullName: string | null
  entryPointRoleType: string | null
  multiThreadingStatus: string
  coverageStatus: string
  missingRoles: string[]
  championBudgetFlag: boolean
}

export interface CompetitorComplaint {
  category: string
  severity?: string | null
  top_complaints?: string[]
}

export interface CompetitorTalkTrack {
  message: string
  scenario?: string | null
}

export interface CompetitorIntel {
  id: number
  competitorName: string
  competitorDomain: string | null
  summary: string | null
  complaintCategories: CompetitorComplaint[]
  biggestWeakness: string | null
  talkTracks: CompetitorTalkTrack[]
  threatLevel: string
  whoLovesThem: string | null
  whoHatesThem: string | null
  sources: string[]
}

export interface GtmBrief {
  id: number
  leadId: number
  companyName: string
  briefDate: string
  executiveSummary: string | null
  whoToTarget: Record<string, unknown>
  whatToSay: Record<string, unknown>
  whichChannel: Record<string, unknown>
  urgencySignal: string | null
  nextActions: string[]
  flagsAndContradictions: string[]
  reviewStatus: string
  reviewedBy: string | null
  reviewedAt: string | null
}

export interface MarketSegment {
  id: number
  icpId: number
  weekOf: string
  segmentName: string | null
  leadTotal: number
  leadHot: number
  leadWarm: number
  leadCold: number
  tamEstimate: string | null
  samEstimate: string | null
  somThisMonth: string | null
  priorityRank: number
  priorityRationale: string | null
  recommendedVolume: number
}

export interface OutreachBundle {
  personalisation: {
    angles: Array<Record<string, unknown>>
    qualityScore: number
    status: string
  } | null
  sequence: {
    persona: string
    cta: string | null
    steps: Array<Record<string, unknown>>
    qualityScore: number
  } | null
  channelPlan: {
    primaryChannel: string
    secondaryChannel: string | null
    sendWindowStartHour: number
    sendWindowEndHour: number
    touchesPerWeek: number
    rationale: string | null
  } | null
  log: Array<{
    id: number
    channel: string
    stepNumber: number
    variantSubject: string | null
    status: string
    sentAt: string | null
    error: string | null
  }>
}

export interface PhaseRun {
  id: string
  phase: string
  command: string | null
  status: string
  icp_id: number | null
  logs: string | null
  error: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
}

export interface RunResult {
  ok: boolean
  runId?: string
  status?: string
  error?: string
}

// The signal taxonomy the user asked for (funding / launch / acquisition /
// layoffs / news keywords ...). Maps phase1 signal_type values to UI labels.
export const SIGNAL_LABELS: Record<string, string> = {
  funding: 'New Funding Announcement',
  product: 'New Product Launch',
  product_launch: 'New Product Launch',
  acquisition: 'Acquisition News',
  layoffs: 'Layoffs',
  hiring: 'Key Hire',
  key_hire: 'Key Hire',
  expansion: 'Office Expansion',
  partnership: 'New Partnership',
  awards: 'Awards & Recognition',
  keywords: 'Keywords Mentioned in News',
  news: 'Keywords Mentioned in News',
  website_visit: 'Website Visit',
  leadership_change: 'Leadership Change',
}

export function signalLabel(type: string): string {
  return SIGNAL_LABELS[type] || type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function intentFromScore(score: number | null | undefined): IntentScore {
  if (score == null) return 'Low'
  if (score >= 70) return 'High'
  if (score >= 40) return 'Medium'
  return 'Low'
}

export function intentFromTier(tier: string | null | undefined): IntentScore {
  if (tier === 'hot') return 'High'
  if (tier === 'warm') return 'Medium'
  return 'Low'
}
