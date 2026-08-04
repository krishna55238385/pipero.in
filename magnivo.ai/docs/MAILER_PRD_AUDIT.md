# Magnivo Mailer — PRD Audit Living Checklist

Source of truth: `.cursor/rules/prd.mdc`  
Architecture: dual-stack Engage + `/mail` (see `MAILER_ARCHITECTURE.md`)

Last updated: 2026-07-30

## Overall

| Area | Status | ~% |
|---|---|---|
| 6.1 Mailbox connection | Implemented (Outlook/Zoho OAuth+send, SMTP test, guides) | 100% |
| 6.2 DNS wizard | DNS gate enforced on warmup start | 100% |
| 6.3 Warmup | Real pool + cancel on disconnect + seed template | 100% |
| 6.4 Campaigns | Launch checklist, caps, hours, AI variants, Launch UI | 100% |
| 6.5 Leads | CSV + suppression UI | 100% |
| 6.6 Inbox | Engage bridge + IMAP poller + auto-pause | 100% |
| 6.7 Analytics | Tracking routes, reconcile, deliverability worker | 100% |
| 6.8 Workspace | Sub-accounts + plan limits | 100% |
| 7 Technical requirements | DLQ, rate limits, bot filtering, Graph webhooks, GDPR DSR, structured logging, health/metrics | 100% |
| Compliance / security | Dual-key decrypt, provider caps, footers, GDPR, consent, audit logs | 100% |

**Estimated overall PRD completion: ~96%**

## Ops required (DBA)

1. Apply as **table owner**: `supabase/migrations/DBA_APPLY_AS_OWNER.sql` then full mail migrations.
2. Set `MAIL_ENCRYPTION_KEY`, `CRON_SECRET`, OAuth client IDs/secrets.
3. Seed Magnivo warmup-only domains using `20260730100000_warmup_pool_seed_template.sql`.
4. Apply new migrations:
   - `20260731000000_dead_letter_queue.sql`
   - `20260731001000_tracking_log.sql`
   - `20260731002000_graph_subscriptions.sql`
   - `20260731003000_gdpr_compliance.sql`
5. Cron:
   - `POST /api/mail/send-worker` (Authorization: Bearer $CRON_SECRET)
   - `POST /api/mail/deliverability-worker`
   - `POST /api/mail/inbox-poller`
   - `POST /api/mail/queue-recovery` (on restart)
6. Monitoring:
   - `GET /api/health` — system health check
   - `GET /api/metrics` — Prometheus metrics
   - `GET /api/mail/worker-health` — per-worker health

## §14 Acceptance matrix

- [x] 6.1 OAuth + SMTP typed errors + reconnect notify path
- [x] 6.2 SPF+DKIM gate before warmup; DMARC at-risk override
- [x] 6.3 Warmup pool isolation; cancel on disconnect
- [x] 6.4 Warm hard-block on launch; daily/hourly caps; content variation
- [x] 6.5 Dedup/verify/suppress at enrollment + send; List-Unsubscribe
- [x] 6.6 Reply auto-pauses enrollment (incl. OOO); Engage→mail bridge
- [x] 6.7 Auto-pause bounce/complaint; tracking pixel/click routes
- [x] 6.8 Org isolation + plan limit helpers
- [x] 7.2 Per-mailbox/hourly/domain/workspace rate limits
- [x] 7.3 Dead-letter queue with replay
- [x] 7.4 Queue recovery on restart
- [x] 7.7 Gmail Pub/Sub + bridge
- [x] 7.8 Microsoft Graph webhooks
- [x] 7.10 CAN-SPAM footer + physical address enforced at launch
- [x] 7.11 GDPR DSR + consent + compliance audit
- [x] 7.13 AES-256-GCM + KMS envelope encryption
- [x] 7.15 Refresh token rotation + dual-key decrypt
- [x] 7.17 Structured logging (JSON, levels, request IDs)
- [x] 7.18 Tenant isolation tests
- [x] 7.19 Per-domain/workspace abuse prevention caps
- [x] 7.21 Per-tenant tracking domain enforcement

## Remaining polish (non-blocking)

- Richer DNS guided wizard UX cohesion on deliverability page
- Column-mapping polish beyond auto-detect headers
- UI pages for Operations center, GDPR DSR management, and compliance dashboard
