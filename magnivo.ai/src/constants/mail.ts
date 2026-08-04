import type { MailPermissionType, ProviderInfo } from '@/types/mail'

export const MAIL_PERMISSIONS: Record<MailPermissionType, { label: string; description: string }> = {
  'mail.read': {
    label: 'Read Mail',
    description: 'View mailboxes, campaigns, and inbox items',
  },
  'mail.write': {
    label: 'Write Mail',
    description: 'Create and edit campaigns, sequences, and templates',
  },
  'mail.manage': {
    label: 'Manage Mail',
    description: 'Manage mailboxes, warmup settings, and lead lists',
  },
  'mail.admin': {
    label: 'Mail Admin',
    description: 'Full administrative access to all mail features',
  },
}

export const MAIL_FEATURE_FLAGS = {
  mailbox: 'mailbox',
  dns: 'dns',
  warmup: 'warmup',
  campaign: 'campaign',
  inbox: 'inbox',
  analytics: 'analytics',
} as const

export type MailFeatureFlag = (typeof MAIL_FEATURE_FLAGS)[keyof typeof MAIL_FEATURE_FLAGS]

export const MAIL_NAV_ITEMS = [
  { key: 'mail-dashboard', name: 'Dashboard', href: '/mail', icon: 'LayoutDashboard' },
  { key: 'mail-mailboxes', name: 'Mailboxes', href: '/mail/mailboxes', icon: 'Mailbox' },
  { key: 'mail-deliverability', name: 'Deliverability', href: '/mail/deliverability', icon: 'ShieldCheck' },
  { key: 'mail-warmup', name: 'Warmup', href: '/mail/warmup', icon: 'Flame' },
  { key: 'mail-campaigns', name: 'Campaigns', href: '/mail/campaigns', icon: 'Megaphone' },
  { key: 'mail-leads', name: 'Leads', href: '/mail/leads', icon: 'Users' },
  { key: 'mail-inbox', name: 'Inbox', href: '/mail/inbox', icon: 'Inbox' },
  { key: 'mail-analytics', name: 'Analytics', href: '/mail/analytics', icon: 'BarChart3' },
  { key: 'mail-settings', name: 'Settings', href: '/mail/settings', icon: 'Settings' },
] as const

export const MAIL_WIZARD_STEPS = [
  { key: 'provider', label: 'Select Provider', number: 1 },
  { key: 'details', label: 'Connection Details', number: 2 },
  { key: 'review', label: 'Review', number: 3 },
  { key: 'test', label: 'Test Connection', number: 4 },
  { key: 'complete', label: 'Done', number: 5 },
] as const

export const MAIL_WIZARD_PROVIDERS: ProviderInfo[] = [
  {
    id: 'gmail',
    name: 'Gmail',
    description: 'Connect your Google Workspace or personal Gmail account via OAuth for secure, passwordless authentication.',
    authType: 'oauth',
    icon: 'mail',
  },
  {
    id: 'outlook',
    name: 'Outlook / Microsoft 365',
    description: 'Connect your Microsoft 365 or Outlook account via OAuth for secure, passwordless authentication.',
    authType: 'oauth',
    icon: 'building',
  },
  {
    id: 'zoho',
    name: 'Zoho Mail',
    description: 'Connect your Zoho Mail account via OAuth for secure, passwordless authentication.',
    authType: 'oauth',
    icon: 'mail',
  },
  {
    id: 'custom',
    name: 'Generic SMTP / IMAP',
    description: 'Configure any SMTP and IMAP server manually. Ideal for custom or self-hosted email providers.',
    authType: 'smtp_imap',
    icon: 'server',
  },
]
