import type { CampaignNodeType } from '@/types/campaign'

export type NodeCategory = 'entry' | 'action' | 'flow' | 'future'

export type NodeDefinition = {
  type: CampaignNodeType
  label: string
  icon: string
  color: string
  bgColor: string
  borderColor: string
  category: NodeCategory
  description: string
  disabled?: boolean
  comingSoon?: boolean
}

export const NODE_DEFINITIONS: NodeDefinition[] = [
  {
    type: 'start',
    label: 'Start',
    icon: 'Play',
    color: 'text-emerald-600',
    bgColor: 'bg-emerald-500/10',
    borderColor: 'border-emerald-500/30',
    category: 'entry',
    description: 'Campaign entry point',
  },
  {
    type: 'email',
    label: 'Email',
    icon: 'Mail',
    color: 'text-blue-600',
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/30',
    category: 'action',
    description: 'Send an email to the recipient',
  },
  {
    type: 'wait',
    label: 'Wait',
    icon: 'Clock',
    color: 'text-amber-600',
    bgColor: 'bg-amber-500/10',
    borderColor: 'border-amber-500/30',
    category: 'flow',
    description: 'Wait for a duration before proceeding',
  },
  {
    type: 'condition',
    label: 'Condition',
    icon: 'GitBranch',
    color: 'text-purple-600',
    bgColor: 'bg-purple-500/10',
    borderColor: 'border-purple-500/30',
    category: 'flow',
    description: 'Branch based on conditions',
  },
  {
    type: 'split',
    label: 'Split',
    icon: 'Split',
    color: 'text-cyan-600',
    bgColor: 'bg-cyan-500/10',
    borderColor: 'border-cyan-500/30',
    category: 'flow',
    description: 'A/B test or percentage-based split',
  },
  {
    type: 'goal',
    label: 'Goal',
    icon: 'Target',
    color: 'text-rose-600',
    bgColor: 'bg-rose-500/10',
    borderColor: 'border-rose-500/30',
    category: 'flow',
    description: 'Track goal completion and exit recipients',
  },
  {
    type: 'webhook',
    label: 'Webhook',
    icon: 'Webhook',
    color: 'text-orange-600',
    bgColor: 'bg-orange-500/10',
    borderColor: 'border-orange-500/30',
    category: 'action',
    description: 'Call an external HTTP endpoint',
  },
  {
    type: 'delay',
    label: 'Delay',
    icon: 'Timer',
    color: 'text-teal-600',
    bgColor: 'bg-teal-500/10',
    borderColor: 'border-teal-500/30',
    category: 'flow',
    description: 'Add a time delay between steps',
  },
  {
    type: 'exit',
    label: 'Exit',
    icon: 'LogOut',
    color: 'text-gray-600',
    bgColor: 'bg-gray-500/10',
    borderColor: 'border-gray-500/30',
    category: 'entry',
    description: 'End the campaign for this recipient',
  },
  {
    type: 'ai_send',
    label: 'AI Email',
    icon: 'Sparkles',
    color: 'text-violet-500',
    bgColor: 'bg-violet-500/5',
    borderColor: 'border-violet-500/20',
    category: 'future',
    description: 'AI-generated email content',
    disabled: true,
    comingSoon: true,
  },
  {
    type: 'crm_update',
    label: 'CRM Update',
    icon: 'Database',
    color: 'text-indigo-500',
    bgColor: 'bg-indigo-500/5',
    borderColor: 'border-indigo-500/20',
    category: 'future',
    description: 'Update CRM contact records',
    disabled: true,
    comingSoon: true,
  },
  {
    type: 'slack_notify',
    label: 'Slack',
    icon: 'MessageSquare',
    color: 'text-pink-500',
    bgColor: 'bg-pink-500/5',
    borderColor: 'border-pink-500/20',
    category: 'future',
    description: 'Send a Slack notification',
    disabled: true,
    comingSoon: true,
  },
  {
    type: 'http_request',
    label: 'HTTP Request',
    icon: 'Globe',
    color: 'text-sky-500',
    bgColor: 'bg-sky-500/5',
    borderColor: 'border-sky-500/20',
    category: 'future',
    description: 'Make a custom HTTP request',
    disabled: true,
    comingSoon: true,
  },
]

export const NODE_CATEGORIES: { key: NodeCategory; label: string }[] = [
  { key: 'entry', label: 'Entry / Exit' },
  { key: 'action', label: 'Actions' },
  { key: 'flow', label: 'Flow Control' },
  { key: 'future', label: 'Coming Soon' },
]

export const DEFAULT_NODE_DATA: Record<CampaignNodeType, Partial<Record<string, unknown>>> = {
  start: {},
  email: { subject: '', body: '', templateId: null },
  wait: { duration: 1, unit: 'days' },
  condition: { field: '', operator: 'equals', value: '', pathTrue: true, pathFalse: true },
  split: { percentages: [50, 50] },
  goal: { goalType: 'email_opened', goalName: '' },
  webhook: { url: '', method: 'POST', headers: {} },
  delay: { duration: 1, unit: 'hours' },
  exit: {},
  ai_send: {},
  crm_update: {},
  slack_notify: {},
  http_request: {},
}

export const NODE_WIDTH = 220
export const NODE_HEIGHT = 120
export const NODE_SPACING_X = 80
export const NODE_SPACING_Y = 160
export const AUTOSAVE_DEBOUNCE_MS = 3000
export const MAX_UNDO_STEPS = 50
export const VALIDATION_POLL_MS = 2000
