/**
 * Engage product IA — routes under /engage (live Sidebar).
 */
export type EngageNavLink = { name: string; href: string }
export type EngageNavGroup = { label: string; items: EngageNavLink[] }

export const engageNavGroups: EngageNavGroup[] = [
  {
    label: 'Workspace',
    items: [
      { name: 'Overview', href: '/engage' },
      { name: 'Settings', href: '/engage/settings' },
      { name: 'Team', href: '/engage/team' },
      { name: 'Notifications', href: '/engage/notifications' },
      { name: 'Compliance', href: '/engage/compliance' },
    ],
  },
  {
    label: 'Infrastructure',
    items: [
      { name: 'Accounts', href: '/engage/accounts' },
      { name: 'Pools', href: '/engage/pools' },
      { name: 'Domains', href: '/engage/domains' },
      { name: 'Tracking Domains', href: '/engage/tracking-domains' },
    ],
  },
  {
    label: 'Deliverability',
    items: [
      { name: 'Deliverability Center', href: '/engage/deliverability' },
      { name: 'Warmup', href: '/engage/warmup' },
    ],
  },
  {
    label: 'Outreach',
    items: [
      { name: 'Campaigns', href: '/engage/campaigns' },
      { name: 'Sequences', href: '/engage/sequences' },
      { name: 'Templates', href: '/engage/templates' },
    ],
  },
  {
    label: 'Inbox',
    items: [
      { name: 'Inbox', href: '/engage/inbox' },
      { name: 'Conversations', href: '/engage/conversations' },
    ],
  },
  {
    label: 'Lists & Hygiene',
    items: [
      { name: 'Leads', href: '/engage/leads' },
      { name: 'Verification', href: '/engage/verification' },
      { name: 'Suppression', href: '/engage/suppression' },
    ],
  },
  {
    label: 'Insights & Ops',
    items: [
      { name: 'Analytics', href: '/engage/analytics' },
      { name: 'Reports', href: '/engage/reports' },
      { name: 'Operations', href: '/engage/operations' },
      { name: 'Audit Logs', href: '/engage/audit' },
    ],
  },
]
