const fs = require('fs')
const path = 'C:\\Users\\krish\\.gemini\\antigravity\\brain\\67d73ce3-6f2d-4a60-9318-ab536469d393\\implementation_plan.md'
const content = `

# Phase 33: Enterprise Notification Center (A-Z)

## 1. Database Schema (\`notifications\` table)
- \`id\` (uuid)
- \`organization_id\`
- \`user_id\` (Recipient)
- \`actor_id\` (Who caused it)
- \`type\` (mentions, assigned_lead, deal_won, task_reminder, system_alert)
- \`title\` & \`content\`
- \`link_url\` (Actionable link)
- \`read_at\` (Null if unread)

## 2. Notification Bell (Global Header)
- Unread badge counter.
- Popover dropdown list (Top 5 recent unread).
- Inline "Mark as read".
- Real-time updates via Supabase channel (live increment without refresh).
- Browser Toast pops up when a new notification arrives.

## 3. Dedicated Command Center (\`/notifications\`)
- Rich list view categorized by time ("Today", "Older").
- Tabs/Filters: \`All\`, \`Unread\`, \`Mentions\`, \`System\`.
- Visual indicators: Actor avatar, specific icons per category, bold for unread.
- Bulk actions: "Mark all as read", "Delete selected".

## 4. Operational Notifications (Wiring it up)
- Trigger: Lead Assigned -> Notify new owner.
- Trigger: Deal Won -> Notify Org Admins.
- Trigger: Lead Forwarded -> Notify recipient.
- Trigger: Task Assigned -> Notify assignee.
`
fs.appendFileSync(path, content)
console.log('Appended to implementation plan.')
