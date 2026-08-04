# Product Completeness — Domain & UX Modules

Updated: 2026-07-30 (continued implementation)

## Product rule

A feature is complete only when users can configure, edit, delete, monitor, troubleshoot, and act on it from the UI — not merely because backend tables/services exist.

## Product surfaces

| Module | Route | Status |
|---|---|---|
| Domain Management | `/mail/domains` | Dashboard, wizard, DNS verify, MX/BIMI, tags/notes/purpose, history, provider instructions |
| Deliverability Center | `/mail/deliverability` | Overview, DNS, DKIM, tracking, reputation, blacklist, bounces, complaints, **Reports** (risk/recommendations/export), Postmaster, SNDS, monitoring, alerts |
| Campaign Platform | `/mail/campaigns` | Stats, search/filter, duplicate/archive/pause, templates, launch checklist, **calendar** |
| Warmup | `/mail/warmup` | Table + charts + schedule editor + **calendar** + **partner health / graduation** |
| Mailbox Diagnostics | Mailbox detail drawer | Status, OAuth/SMTP/IMAP, verify/reconnect, audit log |
| Leads / Verification / Suppression | `/mail/leads` | Import, verify stats, per-lead re-verify, suppression CRUD |
| Operations Center | `/mail/operations` | Send queue monitor/retry/cancel, API keys, webhooks, webhook logs |
| Notifications | `/mail/notifications` | Unread filter, mark read, dismiss |
| Compliance Center | `/mail/compliance` | RFC8058, CAN-SPAM, tracking policy |
| Settings | `/mail/settings` | Tracking, limits, **schedule/timezone/rotation**, signatures, sub-accounts, usage |
| Analytics | `/mail/analytics` | Overview + CSV export |
| Pools | `/mail/pools` | Pool CRUD + membership |

## Nav

Engage children: Mailboxes, Domains, Deliverability, Pools, Inbox, Warmup, Campaigns, Leads, Analytics, **Operations**, Notifications, Settings, Compliance.

## DB (apply as owner)

1. `20260730120000_domain_management_fields.sql`
2. `20260730140000_mail_operations_center.sql` (API keys, webhooks, logs, schedule columns on `mail_org_settings`)

## Still iterating toward Instantly-parity

- Dedicated A/B report screens beyond builder metrics
- Team permission matrix UI (role resolver exists; visual matrix pending)
- Billing hooks UI
- Scheduled PDF report center
- OAuth reconnect center as standalone page (drawer diagnostics covers per-mailbox today)
