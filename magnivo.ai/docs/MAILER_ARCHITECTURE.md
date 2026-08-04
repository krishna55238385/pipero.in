# Magnivo Mailer Architecture

## Dual-stack model

Magnivo Mailer upgrades Engage without a hard cutover.

| Concern | Legacy Engage | Mail upgrade (`/mail`) |
|---|---|---|
| UI entry | `/engage/*` (still live) | Primary nav → `/mail/*` |
| Mailboxes | `engage_mailboxes` (Gmail) | `mail_mailboxes` + oauth/smtp/imap configs |
| Campaigns | `engage_campaigns` + worker | `campaigns` + visual builder |
| Sending | `lib/engage-worker.ts` | New dispatcher (bridges until complete) |
| Inbox | Engage inbox + Gmail sync | Bridged into `/mail/inbox` |
| Warmup | `lib/engage-warmup.ts` | `mail_warmup_*` + queue/worker |

## Layering

```
Server Actions / API Routes
        ↓
Services (business logic)
        ↓
Repositories (SQL only)
        ↓
PostgreSQL
```

Rules:

- No business logic in controllers/actions beyond auth + permission checks.
- Repositories never call external APIs.
- Credentials are encrypted at rest (`MAIL_ENCRYPTION_KEY`, AES-256-GCM, KMS-envelope-ready).
- API responses never include decrypted tokens or passwords.

## Bridge map

| Engage entity | Mail entity | Cutover rule |
|---|---|---|
| `engage_mailboxes` | `mail_mailboxes` + `mailbox_oauth_configs` | Keep Engage writes; encrypt tokens additively; dual-write on new OAuth connects when mail path is used |
| `engage_campaigns` | `campaigns` | Engage worker continues until mail dispatcher is production-ready |
| `outreach_unsubscribes` | `mail_email_suppressions` | Unified check at send + enrollment |
| Engage inbox APIs | `/mail/inbox` | Reuse sync/classification; new UI mounts Engage-backed data |

## Status lifecycle (mailboxes)

`pending` → `testing` → `pending_dns` → `pending_warmup` → `warming` → `connected` (warm/graduated)

Failure/attention: `reconnect_required`, `oauth_expired`, `smtp_failed`, `imap_failed`, `verification_failed`, `at_risk`, `error`, `suspended`, `disabled`

Terminal/hidden: `archived`, `deleted`

## Feature completion order

1. Mailbox connection  
2. DNS wizard  
3. Warmup engine (real pool, no simulation)  
4. Campaign builder + send path  
5. Lead hygiene  
6. Unified inbox  
7. Analytics  
8. Workspace / sub-accounts  
9. Compliance  
10. Full production audit  

Never ship placeholders or simulated sends on production paths.

## Runtime workers

| Endpoint | Purpose | Auth |
|---|---|---|
| `POST /api/mail/send-worker` | Campaign send queue | `CRON_SECRET` / `ENGAGE_WORKER_SECRET` |
| `POST /api/mail/deliverability-worker` | Auto-pause + Postmaster/SNDS + IMAP poll | same |
| `POST /api/mail/inbox-poller` | SMTP mailbox IMAP ingest | same |
| `/api/tracking/pixel/[token]` | Mail open tracking | public pixel |
| `/api/tracking/click/[token]` | Mail click redirect | public redirect |
| `/api/track/*` | Legacy Engage tracking (BC) | public |

## OAuth callbacks (mail module)

- `/api/mail/oauth/gmail/callback`
- `/api/mail/oauth/microsoft/callback`
- `/api/mail/oauth/zoho/callback`

Engage Gmail OAuth at `/api/engage/gmail/*` remains live.
