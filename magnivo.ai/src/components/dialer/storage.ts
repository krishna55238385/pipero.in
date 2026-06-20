// Dialer call-log types.
//
// NOTE: localStorage persistence (loadCallLogs/saveCallLogs) and mock seeding
// (seedCallLogs) were removed — call logs are now read/written through Supabase
// via the server actions in `src/app/actions/dialer.ts`. This file now only
// exports the shared client-side `CallLog` type used by the dialer components.

export type CallDirection = 'outbound' | 'inbound'

export type DialerCallSummary = {
  overview: string
  key_points: string[]
  objections: string[]
  next_steps: string[]
  sentiment?: string
  risk_flags?: string[]
}

export type CallLog = {
  id: string
  leadId: string | null
  leadName: string
  company: string
  phone: string
  direction: CallDirection
  startedAt: string
  endedAt: string
  durationSeconds: number
  outcome: 'connected' | 'no_answer' | 'voicemail' | 'failed'
  hasRecording: boolean
  recordingUrl?: string | null
  notes?: string
  transcript?: string
  summary?: DialerCallSummary
  ai_generated_at?: string
  tags?: string[]
  scorecard?: {
    talk_ratio?: number
    clarity?: number
    empathy?: number
    next_step_set?: boolean
  }
}
