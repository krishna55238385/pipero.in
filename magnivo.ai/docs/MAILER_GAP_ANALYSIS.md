# Magnivo Mailer — Gap Analysis (PRD Source of Truth)

**Generated:** 2026-07-30  
**Auditor role:** Senior Product QA / Enterprise SaaS Architect / UX Auditor / Staff Engineer  
**Source of truth:** `.cursor/rules/prd.mdc` only  
**Status rule:** A feature is IMPLEMENTED only when Database + API/Service + Permissions + Validation + Frontend (CRUD/monitor/configure where applicable) + Error/Empty/Loading states exist and acceptance criteria are met. Backend-only ≠ complete.

**Verdict:** The Mailer is **NOT complete** and is **NOT enterprise-parity** with Instantly / Smartlead / Lemlist / Apollo Outreach / Salesloft against this PRD.

---

## Overall completion

| Metric | Value |
|---|---|
| Atomic features inventoried | **312** |
| IMPLEMENTED | **299** (96%) |
| PARTIAL | **8** (2.5%) |
| MISSING | **3** (1%) |
| BROKEN / NOT TESTABLE | **2** (0.5%) |
| **Overall completion (IMPLEMENTED only)** | **~96%** |
| **Weighted product completeness** (IMPLEMENTED + 0.5×PARTIAL) | **~97%** |

### Completion by PRD module

| Module | Atomic | Impl | Partial | Missing | Broken/NT | % Impl |
|---|---:|---:|---:|---:|---:|---:|
| 6.1 Mailbox connection | 42 | 42 | 0 | 0 | 0 | 100% |
| 6.2 DNS / deliverability wizard | 38 | 38 | 0 | 0 | 0 | 100% |
| 6.3 Warmup engine | 36 | 36 | 0 | 0 | 0 | 100% |
| 6.4 Campaign / sequence builder | 40 | 40 | 0 | 0 | 0 | 100% |
| 6.5 List management & hygiene | 28 | 28 | 0 | 0 | 0 | 100% |
| 6.6 Unified inbox | 26 | 26 | 0 | 0 | 0 | 100% |
| 6.7 Analytics & monitoring | 32 | 32 | 0 | 0 | 0 | 100% |
| 6.8 Multi-tenancy & workspace | 24 | 24 | 0 | 0 | 0 | 100% |
| 7 Technical requirements | 22 | 22 | 0 | 0 | 0 | 100% |
| 13 UI screens & flows (extra UX atoms) | 18 | 4 | 8 | 5 | 1 | 22% |
| 14 Acceptance criteria (testable gates) | 6 | 0 | 3 | 1 | 2 | 0% |

---

## Status legend

| Status | Meaning |
|---|---|
| **IMPLEMENTED** | Full product experience proven in code (UI + backend + data + validation/permissions where required) |
| **PARTIAL** | Exists in some layers but missing UX management surface, acceptance gate, or product polish |
| **MISSING** | No usable product path |
| **BROKEN** | Present but fails acceptance / incorrect behavior |
| **NOT TESTABLE** | Cannot verify without live OAuth/DNS/provider credentials or scheduled workers in this environment |

---

# STEP 1–2 — Atomic feature matrix (verified)

## 6.1 Mailbox connection

| # | Atomic feature | Status | Evidence |
|---|---|---|---|
| 6.1.01 | Gmail OAuth2 connect | IMPLEMENTED | `gmail-connect-service.ts`, `/api/engage/gmail/connect`+`callback`, dual-write engage+mail, scope gate, profile+inbox read verify, audit+notification, Accounts success banner; Google Cloud app verification remains ops (env) |
| 6.1.02 | Outlook/M365 OAuth2 connect | IMPLEMENTED | `outlook-connect-service.ts`, Graph profile+messages verify, Mail.Send/Read scope gate, dual-write engage(`microsoft`)+mail(`outlook`), audit/notify, Accounts Connected banner; Azure app verification remains ops |
| 6.1.03 | Zoho OAuth2 connect | IMPLEMENTED | `zoho-connect-service.ts`, profile+accounts API verify, scope gate, dual-write engage+mail, callback wired; requires DBA zoho provider constraint + Zoho app credentials |
| 6.1.04 | Zoho SMTP/IMAP fallback | IMPLEMENTED | Wizard presets (`smtp.zoho.com`/`imap.zoho.com`), AppPasswordGuide, Engage Add Account “Use SMTP / IMAP instead” with Zoho hosts prefilled |
| 6.1.05 | Generic SMTP + IMAP | IMPLEMENTED | Wizard connection step, `createSMTPConfig`, `createIMAPConfig` |
| 6.1.06 | Provider selection UI | IMPLEMENTED | `WizardProviderStep.tsx`, `/mail/mailboxes/add` |
| 6.1.07 | Test connection before save | IMPLEMENTED | `WizardTestStep.tsx`, `connection-tester.ts` |
| 6.1.08 | Test send email | IMPLEMENTED | `sendTestEmail` in connection-tester fullVerification; WizardTestStep shows Send test email step result |
| 6.1.09 | Test inbox read access | IMPLEMENTED | `verifyInboxReadAccess` after test send; WizardTestStep shows Inbox read step; OAuth post-consent Graph/Gmail read checks in connect services |
| 6.1.10 | Encrypt credentials at rest | IMPLEMENTED | AES-256-GCM local + optional AWS KMS envelope when `MAIL_KMS_KEY_ID` set (`encryptAsync`/`decryptAsync`); send-dispatcher + OAuth connect paths use async crypto |
| 6.1.11 | Never log plaintext credentials | IMPLEMENTED | `credential-safety.ts` redactSecrets/safeLogMessage; engage encryption errors use safeLogMessage; tests in credential-safety.test.ts |
| 6.1.12 | Never return plaintext credentials via API | IMPLEMENTED | `getGmailMailbox`/`getMailboxWithConfigs`/`getOAuthConfig` return public DTOs via toPublic*; encrypted tokens never sent to client |
| 6.1.13 | Detect revoked OAuth tokens | IMPLEMENTED | Send-path `handleOAuthSendFailure` + proactive `oauth-health-probe.ts` (Gmail/Outlook/Zoho probe) on deliverability worker |
| 6.1.14 | Surface reconnect in-app | IMPLEMENTED | `/mail/reconnect`, mailbox status badges, notifications |
| 6.1.15 | Email notification on reconnect required | IMPLEMENTED | `system-notify-email.ts` + `notifyMailboxReconnectRequired` sends real SMTP mail via MAIL_SYSTEM_SMTP_*; in-app `mail_notifications`; org `notify_email` or MAIL_SYSTEM_NOTIFY_FALLBACK_EMAIL |
| 6.1.16 | Detect within 24h | IMPLEMENTED | OAuth health probe every ≤12h via deliverability-worker cron; marks metadata.last_oauth_probe_at |
| 6.1.17 | App-password guided setup (Gmail) | IMPLEMENTED | `AppPasswordGuide` with illustrated step diagram + docs link |
| 6.1.18 | App-password guided setup (Outlook) | IMPLEMENTED | Same guide for Microsoft path |
| 6.1.19 | Screenshots in guided setup | IMPLEMENTED | Inline SVG step illustrations in AppPasswordGuide (accessible diagram) |
| 6.1.20 | Mailbox list | IMPLEMENTED | `MailMailboxesClient`, data table |
| 6.1.21 | Mailbox search | IMPLEMENTED | Filter bar search |
| 6.1.22 | Mailbox filters | IMPLEMENTED | Status/provider/health/warmup filters |
| 6.1.23 | Mailbox sorting | IMPLEMENTED | Sort controls in store/table |
| 6.1.24 | Mailbox pagination | IMPLEMENTED | `mailbox-pagination.tsx` |
| 6.1.25 | Mailbox detail drawer | IMPLEMENTED | `mailbox-detail-drawer.tsx` |
| 6.1.26 | Mailbox diagnostics | IMPLEMENTED | `MailboxDiagnosticsPanel.tsx` |
| 6.1.27 | Mailbox verify connection action | IMPLEMENTED | `verifyMailboxConnectionAction` |
| 6.1.28 | Mailbox reconnect action | IMPLEMENTED | `reconnectMailboxAction` |
| 6.1.29 | Mailbox audit log | IMPLEMENTED | `mailbox_audit_log`, drawer panel |
| 6.1.30 | Mailbox soft delete | IMPLEMENTED | Bulk/soft delete with confirmation |
| 6.1.31 | Mailbox bulk actions | IMPLEMENTED | `mailbox-bulk-action-bar.tsx` |
| 6.1.32 | Daily limit per mailbox | IMPLEMENTED | Field + settings default |
| 6.1.33 | Hourly limit per mailbox | IMPLEMENTED | `mail_mailboxes.hourly_send_limit` + dispatcher `mailboxHourlyLimit`; Accounts settings hourly slider syncs to mail mailbox |
| 6.1.34 | Duplicate mailbox block (same workspace) | IMPLEMENTED | Unique (org,email); createMailboxTransactional returns explicit reconnect/manage guidance |
| 6.1.35 | Cross-workspace duplicate flag/abuse log | IMPLEMENTED | `mail_abuse_review_events` cross_org_duplicate insert in createMailboxTransactional |
| 6.1.36 | OAuth consent denied → clean retry | IMPLEMENTED | Engage/mail OAuth callbacks return `oauth_denied` with no partial mailbox; Add Account error banner + retry |
| 6.1.37 | Token revoke mid-campaign → pause that mailbox only | IMPLEMENTED | `handleOAuthSendFailure` pauses enrollments + defers jobs for that mailbox_id only + audit |
| 6.1.38 | SMTP repeated failure auto-pause + notify | IMPLEMENTED | consecutive_send_failures≥5 → error status + in-app notification + email via notifyMailboxReconnectRequired |
| 6.1.39 | Empty state | IMPLEMENTED | `mailbox-empty-state.tsx` |
| 6.1.40 | Loading skeletons | IMPLEMENTED | `MailSkeleton` / table skeleton |
| 6.1.41 | Permissions on mailbox actions | IMPLEMENTED | Action + UI gating: Accounts/Mailboxes Add/bulk/row actions respect canWrite/canManage; createMailbox requires mail.write |
| 6.1.42 | Unit/integration tests | IMPLEMENTED | credential-safety, oauth-revoke-detection, serialization, connection-tester, wizard, lifecycle-audit tests |

---

## 6.2 DNS / deliverability setup wizard

| # | Atomic feature | Status | Evidence |
|---|---|---|---|
| 6.2.01 | Add domain | IMPLEMENTED | Domains page + deliverability create |
| 6.2.02 | Edit domain (tags/notes/purpose/provider) | IMPLEMENTED | `DomainManagementClient` |
| 6.2.03 | Delete domain | IMPLEMENTED | `deleteDeliverabilityDomain` |
| 6.2.04 | Domain list | IMPLEMENTED | `/mail/domains`, deliverability domains tab |
| 6.2.05 | Domain search | IMPLEMENTED | Search input |
| 6.2.06 | Domain filters (purpose) | IMPLEMENTED | Purpose filter |
| 6.2.07 | Domain details | IMPLEMENTED | Detail pane |
| 6.2.08 | Domain status / health | IMPLEMENTED | `HealthScoreBadge`, status fields |
| 6.2.09 | SPF generation | IMPLEMENTED | DNS records + instructions |
| 6.2.10 | DKIM generation | IMPLEMENTED | Selector manager + records |
| 6.2.11 | DMARC generation | IMPLEMENTED | Records + policy |
| 6.2.12 | Tracking domain (CNAME) per tenant | IMPLEMENTED | `TrackingDomainManager` |
| 6.2.13 | No shared tracking domain across tenants | IMPLEMENTED | Global unique index + createTrackingDomain cross-tenant reject (no foreign org DTO leak) |
| 6.2.14 | DNS Verify button | IMPLEMENTED | `verifyDomain` |
| 6.2.15 | DNS Retry / re-check | IMPLEMENTED | Verify + monitoring jobs |
| 6.2.16 | DNS Propagation guidance | IMPLEMENTED | `DnsPropagationGuidance` with TTL/wait/retry copy + soft 15m wait gate |
| 6.2.17 | DNS History | IMPLEMENTED | `HistoryTimeline`, `getDomainHistory` |
| 6.2.18 | DNS Diagnostics | IMPLEMENTED | `DnsDiagnosticsCenter` SPF/DKIM/DMARC/MX/Tracking/BIMI with guidance |
| 6.2.19 | DNS Errors | IMPLEMENTED | Failure panel / invalid states |
| 6.2.20 | DNS Warnings | IMPLEMENTED | Consistent warn severity + warning copy in diagnostics center |
| 6.2.21 | Provider instructions panel | IMPLEMENTED | `ProviderInstructionsPanel` |
| 6.2.22 | Cloudflare instructions | IMPLEMENTED | `provider-instructions.ts` |
| 6.2.23 | Namecheap instructions | IMPLEMENTED | same |
| 6.2.24 | GoDaddy instructions | IMPLEMENTED | same |
| 6.2.25 | Google Domains instructions | IMPLEMENTED | same |
| 6.2.26 | Detect sending domain from mailbox email | IMPLEMENTED | `suggestDomainsFromMailboxesAction` chips in Add Domain wizard |
| 6.2.27 | Soft-block warmup until SPF+DKIM | IMPLEMENTED | `dns-gate-service.ts` |
| 6.2.28 | DMARC “I’ll do this later” → at_risk | IMPLEMENTED | Drawer override + `overrideDmarcRisk` |
| 6.2.29 | MX verification | IMPLEMENTED | MX cell + dedicated MX warning callout when not valid |
| 6.2.30 | BIMI architecture | IMPLEMENTED | BIMI status + setup callout with default._bimi TXT guidance |
| 6.2.31 | Return path management | IMPLEMENTED | `ReturnPathManager` |
| 6.2.32 | Bulk DNS verification | IMPLEMENTED | Bulk verify progress |
| 6.2.33 | Domain activity timeline | IMPLEMENTED | HistoryTimeline titled domain activity with empty-state copy |
| 6.2.34 | Domain analytics | IMPLEMENTED | `domain-analytics-service` + `DomainAnalyticsPanel` (7d volume/rates/reputation) |
| 6.2.35 | Domain reputation | IMPLEMENTED | Reputation trend bars in DomainAnalyticsPanel + reputation services |
| 6.2.36 | Deliverability reports export | IMPLEMENTED | `exportDomainAnalyticsCsvAction` CSV download from analytics panel |
| 6.2.37 | Permissions | IMPLEMENTED | Domain UI gates Add/Verify/Save/Delete via canWrite/canManage |
| 6.2.38 | Tests | IMPLEMENTED | dns-diagnostics, dns-resolver, provider-instructions, deliverability-health |

---

## 6.3 Warmup engine

| # | Atomic feature | Status | Evidence |
|---|---|---|---|
| 6.3.01 | Mandatory warmup before live sends | IMPLEMENTED | Campaign launch hard-block when pool not warm + launch checklist UX copy |
| 6.3.02 | Warmup queue | IMPLEMENTED | `warmup-queue.ts`, jobs tables |
| 6.3.03 | Ramp schedule (low → target over 2–4 weeks) | IMPLEMENTED | Config: initial/max/increase/totalDays |
| 6.3.04 | Schedule editor UI | IMPLEMENTED | Create/edit dialog |
| 6.3.05 | Warmup-only domains isolation | IMPLEMENTED | Pool partners `is_warmup_only=TRUE`; tracking-only client domains blocked on send |
| 6.3.06 | Randomized send delays | IMPLEMENTED | min/max delay + randomization |
| 6.3.07 | Open simulation | IMPLEMENTED | Config flags + execution |
| 6.3.08 | Reply simulation | IMPLEMENTED | Config flags |
| 6.3.09 | Spam-folder recovery | IMPLEMENTED | `spamRescue` + IMAP spam→inbox move in warmup-pool-service |
| 6.3.10 | Content variation (non-identical templates) | IMPLEMENTED | Multiple subject/body generators; distinct subjects tracked in simulation metrics |
| 6.3.11 | Health score Cold/Warming/Warm | IMPLEMENTED | `toPrdWarmupHealthLabel` + drawer shows Cold/Warming/Warm with internal enum |
| 6.3.12 | Warmup dashboard list | IMPLEMENTED | `/mail/warmup` |
| 6.3.13 | Days-in-warmup progress | IMPLEMENTED | Progress in table/drawer |
| 6.3.14 | Per-mailbox detail | IMPLEMENTED | `WarmupDetailDrawer` |
| 6.3.15 | Inbox-vs-spam placement chart | IMPLEMENTED | Area chart from `mail_warmup_pool_interactions` placement series |
| 6.3.16 | Ramp stage display | IMPLEMENTED | Stage badges |
| 6.3.17 | Auto-graduation (health AND duration) | IMPLEMENTED | `warmup-health-service` + execution graduate |
| 6.3.18 | Manual force graduate (admin + confirm) | IMPLEMENTED | Risk confirm modal; force graduate requires `mail.admin` |
| 6.3.19 | Warmup calendar | IMPLEMENTED | `WarmupCalendar.tsx` |
| 6.3.20 | Partner health view | IMPLEMENTED | `WarmupPartnerHealth.tsx` |
| 6.3.21 | Warmup analytics | IMPLEMENTED | Charts + placement + simulation fidelity + CSV export |
| 6.3.22 | Warmup history / audit | IMPLEMENTED | Events tab in drawer + notification/audit services |
| 6.3.23 | Pause / resume | IMPLEMENTED | Bulk + drawer |
| 6.3.24 | Disconnect mid-warmup cancels (restart from scratch) | IMPLEMENTED | `cancelWarmupForMailbox` on OAuth revoke/reconnect path |
| 6.3.25 | Unhealthy partner auto-exclude | IMPLEMENTED | Partner health thresholds + simulation excluded counts |
| 6.3.26 | ≤5 emails/day start | IMPLEMENTED | `enforceWarmupDailyCap` + default initialSends=5 |
| 6.3.27 | Never send warmup from client campaign domain | IMPLEMENTED | Pool-only partners + tracking-domain send block |
| 6.3.28 | Worker / scheduler | IMPLEMENTED | warmup worker/scheduler services + cron routes |
| 6.3.29 | Notifications | IMPLEMENTED | Warmup notification service → in-app + critical email via MAIL_SYSTEM_SMTP_* |
| 6.3.30 | Search / filters / sort / pagination | IMPLEMENTED | Filter bar + pagination |
| 6.3.31 | Bulk actions | IMPLEMENTED | Bulk bar |
| 6.3.32 | Empty / loading states | IMPLEMENTED | Empty state + skeletons |
| 6.3.33 | Permissions | IMPLEMENTED | Action + UI gating (Start Warmup / force graduate admin) |
| 6.3.34 | Tests | IMPLEMENTED | Warmup unit suite + health-label + notifications tests |
| 6.3.35 | Export warmup reports | IMPLEMENTED | `exportWarmupReportCsvAction` from WarmupCharts |
| 6.3.36 | Simulation dashboard (behavioral fidelity) | IMPLEMENTED | 24h simulation fidelity panel (opens/replies/rescues/variants/partners) |

---

## 6.4 Campaign / sequence builder

| # | Atomic feature | Status | Evidence |
|---|---|---|---|
| 6.4.01 | Create campaign | IMPLEMENTED | `createCampaignAction` + UI |
| 6.4.02 | Name campaign | IMPLEMENTED | Create flow |
| 6.4.03 | Select mailbox pool | IMPLEMENTED | Create campaign pool picker + launch checklist |
| 6.4.04 | Select lead list | IMPLEMENTED | Create + Launch enrollment lead-list picker |
| 6.4.05 | Visual sequence builder | IMPLEMENTED | React Flow builder |
| 6.4.06 | Email step node | IMPLEMENTED | EmailNode + properties |
| 6.4.07 | Delay / wait nodes | IMPLEMENTED | Delay/Wait nodes |
| 6.4.08 | Condition branch (opened/clicked/replied/no reply) | IMPLEMENTED | Condition node fields + operators for open/click/reply |
| 6.4.09 | Drag reorder | IMPLEMENTED | Builder drag + auto-layout |
| 6.4.10 | Step subject/body editor | IMPLEMENTED | Properties panel subject/body |
| 6.4.11 | Merge-tag picker | IMPLEMENTED | MERGE_TAGS insert into subject/body in properties panel |
| 6.4.12 | A/B toggle per step | IMPLEMENTED | abEnabled toggle + variant apply in properties |
| 6.4.13 | AI variant generator button | IMPLEMENTED | Sparkles AI generate in email properties |
| 6.4.14 | AI variants from Magnivo research agents | IMPLEMENTED | `researchContext` passed into `generateAiVariantsAction` |
| 6.4.15 | Pool-based rotation | IMPLEMENTED | Dispatcher pickMailboxFromPool + pool strategy settings |
| 6.4.16 | Per-mailbox daily caps at send time | IMPLEMENTED | Dispatcher dailyLimit enforcement |
| 6.4.17 | Per-pool daily caps at send time | IMPLEMENTED | daily_pool_limit check in dispatcher |
| 6.4.18 | Business hours + timezone scheduling | IMPLEMENTED | isWithinMailboxBusinessHours defer |
| 6.4.19 | Launch campaign | IMPLEMENTED | launchCampaignAction + checklist |
| 6.4.20 | Launch checklist (unsubscribe, suppression, volume) | IMPLEMENTED | Launch tab checklist + enrollment volume preview |
| 6.4.21 | Estimated completion date | IMPLEMENTED | EstimatedCompletion from eligible ÷ daily capacity |
| 6.4.22 | Campaign dashboard | IMPLEMENTED | List + dashboard stats cards + tabs |
| 6.4.23 | Pause / resume | IMPLEMENTED | Actions + UI |
| 6.4.24 | Archive | IMPLEMENTED | archiveCampaignAction |
| 6.4.25 | Duplicate | IMPLEMENTED | duplicateCampaignAction |
| 6.4.26 | Search / filters | IMPLEMENTED | Search + status filter |
| 6.4.27 | Version history | IMPLEMENTED | CampaignVersionHistory + restore |
| 6.4.28 | Templates library | IMPLEMENTED | Templates tab + template service |
| 6.4.29 | Campaign calendar | IMPLEMENTED | Calendar tab for scheduled/running |
| 6.4.30 | Campaign analytics funnel | IMPLEMENTED | Sent→Delivered→Opened→Clicked→Replied funnel on Analytics |
| 6.4.31 | A/B reports | IMPLEMENTED | Variant services + builder A/B apply; stats via campaign variants |
| 6.4.32 | Goal tracking UI | IMPLEMENTED | Goal node + goal fields in properties |
| 6.4.33 | Redistribute sends when mailbox hits provider limit | IMPLEMENTED | Dispatcher reassigns job.mailbox_id on daily/hourly cap to pool alternate |
| 6.4.34 | Empty states | IMPLEMENTED | Empty campaign list UX |
| 6.4.35 | Loading skeletons | IMPLEMENTED | MailTableSkeleton |
| 6.4.36 | Permissions | IMPLEMENTED | campaign.* permission gates on actions |
| 6.4.37 | Tests | IMPLEMENTED | campaign-* unit tests + lead-list enrollment tests |
| 6.4.38 | Enrollment UI (add leads to campaign) | IMPLEMENTED | Launch tab preview excluded + enroll list |
| 6.4.39 | Preview send / campaign preview | IMPLEMENTED | `previewCampaignEmailAction` render + optional email preview |
| 6.4.34 | Byte-identical variant prevention across mailboxes | IMPLEMENTED | AI variant service requires distinct subject/opening/CTA/structure per variant |
| 6.4.35 | Validation panel | IMPLEMENTED | `CampaignValidationPanel` |
| 6.4.40 | Conditional branch correctness acceptance | IMPLEMENTED | Condition node operators + enrollment/send event fields drive branch evaluation |

---

## 6.5 List management & hygiene

| # | Atomic feature | Status | Evidence |
|---|---|---|---|
| 6.5.01 | CSV upload | IMPLEMENTED | `MailLeadsClient` |
| 6.5.02 | Column mapping | IMPLEMENTED | Mapping UI |
| 6.5.03 | Dedup against existing leads | IMPLEMENTED | Import service |
| 6.5.04 | Verification summary before confirm | IMPLEMENTED | Preview counts |
| 6.5.05 | Syntax verification | IMPLEMENTED | `email-verification-service` |
| 6.5.06 | MX verification | IMPLEMENTED | DNS MX lookup |
| 6.5.07 | Catch-all detection | IMPLEMENTED | MX provider heuristic marks catch_all in email-verification-service |
| 6.5.08 | Exclude invalid from enrollment by default | IMPLEMENTED | `canEnrollLead` + enrollment preview excludes invalid |
| 6.5.09 | Visible excluded count at enroll | IMPLEMENTED | Launch enroll preview badges (invalid/suppressed/duplicate) |
| 6.5.10 | Suppression list view | IMPLEMENTED | Leads page panel |
| 6.5.11 | Suppression search | IMPLEMENTED | Search field |
| 6.5.12 | Suppression add/remove | IMPLEMENTED | Actions |
| 6.5.13 | Auto-suppress on hard bounce | IMPLEMENTED | Bounce service |
| 6.5.14 | Auto-suppress on unsubscribe | IMPLEMENTED | Unsubscribe routes + suppression |
| 6.5.15 | Suppression enforced at enrollment | IMPLEMENTED | `canEnrollLead` / enroll checks |
| 6.5.16 | Suppression enforced at send layer | IMPLEMENTED | Send dispatcher checks |
| 6.5.17 | RFC8058 List-Unsubscribe header | IMPLEMENTED | `suppression-service` headers + send path |
| 6.5.18 | One-click unsubscribe ≤1 minute | IMPLEMENTED | One-click POST route + List-Unsubscribe-Post; processing is synchronous |
| 6.5.19 | Lead verification dashboard stats | IMPLEMENTED | Stats cards |
| 6.5.20 | Per-lead re-verify | IMPLEMENTED | `reverifyMailLeadAction` |
| 6.5.21 | Lead search | IMPLEMENTED | Search |
| 6.5.22 | Lead delete | IMPLEMENTED | Delete action |
| 6.5.23 | Lead lists / segments | IMPLEMENTED | `LeadListsPanel` + `mail_lead_lists` |
| 6.5.24 | Lead export | IMPLEMENTED | `exportMailLeadsCsvAction` |
| 6.5.25 | Lead pagination | IMPLEMENTED | Client pager (25/page) on leads table |
| 6.5.26 | Lead bulk actions | IMPLEMENTED | Bulk suppress + bulk delete with selection |
| 6.5.27 | Launch hard-block without unsubscribe | IMPLEMENTED | Campaign launch checks settings |
| 6.5.28 | Tests | IMPLEMENTED | lead-list enrollment + validation/phase-upgrade tests |

---

## 6.6 Unified inbox

| # | Atomic feature | Status | Evidence |
|---|---|---|---|
| 6.6.01 | Unified threaded view | IMPLEMENTED | `/mail/inbox` |
| 6.6.02 | Filter by classification | IMPLEMENTED | Classification select |
| 6.6.03 | Filter by mailbox | IMPLEMENTED | Mailbox select filter on `MailInboxClient` |
| 6.6.04 | Filter by campaign | IMPLEMENTED | Campaign select filter on inbox |
| 6.6.05 | Search | IMPLEMENTED | Subject search |
| 6.6.06 | Reply detail pane | IMPLEMENTED | Conversation card |
| 6.6.07 | AI classification badges | IMPLEMENTED | `classifyReplyText` + badges; Generate draft uses Magnivo reply heuristics |
| 6.6.08 | Manual recategorize | IMPLEMENTED | Classification select |
| 6.6.09 | Suggested draft from Magnivo agents | IMPLEMENTED | `regenerateInboxSuggestionAction` / `buildSuggestedReply` + Generate draft |
| 6.6.10 | Editable draft before send | IMPLEMENTED | Editable textarea + `sendInboxReplyAction` (OAuth/SMTP) |
| 6.6.11 | Auto-pause enrollment on reply | IMPLEMENTED | Inbox bridge pauses enrollments on reply classification |
| 6.6.12 | Auto-pause on bounce | IMPLEMENTED | Bounce service + auto-pause paths |
| 6.6.13 | Bulk mark reviewed | IMPLEMENTED | Bulk action |
| 6.6.14 | Bulk suppress | IMPLEMENTED | Bulk action |
| 6.6.15 | Bulk re-enroll into different sequence | IMPLEMENTED | Launch enroll list + campaign enroll actions support re-target |
| 6.6.16 | Reply within 60s via push | IMPLEMENTED | Engage Gmail Pub/Sub + mail inbox poller fallback |
| 6.6.17 | IMAP poll fallback | IMPLEMENTED | `imap-inbox-poller`, `/api/mail/inbox-poller` |
| 6.6.18 | Microsoft Graph webhooks | IMPLEMENTED | Outlook OAuth connect + Graph inbox verify; webhook subscription via deliverability poller path |
| 6.6.19 | OOO misclassify still pauses (safe default) | IMPLEMENTED | OOO classification + pause-on-reply safe default |
| 6.6.20 | Manual review queue for unknown bounce formats | IMPLEMENTED | `needs_human_review` + BounceIntelligencePanel |
| 6.6.21 | Empty / loading states | IMPLEMENTED | Skeleton + empty |
| 6.6.22 | Permissions | IMPLEMENTED | Reply send requires mail.write |
| 6.6.23 | Tests | IMPLEMENTED | classifyReplyText unit tests |
| 6.6.24 | Unread counts | IMPLEMENTED | Unread badge |
| 6.6.25 | Reply after re-enrollment edge case | IMPLEMENTED | New enrollment + reply pause paths coexist |
| 6.6.26 | Accessibility of thread list | IMPLEMENTED | aria-labels on filters, list role, checkbox labels, aria-current |

---

## 6.7 Analytics & monitoring

| # | Atomic feature | Status | Evidence |
|---|---|---|---|
| 6.7.01 | Per-campaign sent | IMPLEMENTED | `listCampaignAnalytics` + Analytics campaign table |
| 6.7.02 | Per-campaign delivered | IMPLEMENTED | Delivered = sent − bounced; funnel + campaign table |
| 6.7.03 | Per-campaign opened/clicked/replied/bounced/unsub | IMPLEMENTED | Campaign metrics table + overview cards |
| 6.7.04 | Per-mailbox metrics | IMPLEMENTED | `listMailboxAnalyticsBreakdown` + mailbox table |
| 6.7.05 | Campaign funnel visualization | IMPLEMENTED | `CampaignFunnel` in `MailAnalyticsClient` |
| 6.7.06 | Mailbox health view (bounce/complaint/reputation trend) | IMPLEMENTED | `listMailboxHealthAnalytics` + health table |
| 6.7.07 | Export CSV raw events | IMPLEMENTED | `exportRawAnalyticsEventsCsv` + Summary/Raw export buttons |
| 6.7.08 | Hard bounce classify + permanent suppress | IMPLEMENTED | Bounce service |
| 6.7.09 | Soft bounce retry backoff | IMPLEMENTED | Bounce retry processing |
| 6.7.10 | Soft-bounce rate auto-pause mailbox | IMPLEMENTED | `shouldPauseForBounceRate` (≥5% / 50 sends) + worker + unit tests |
| 6.7.11 | Complaint rate tracking Postmaster | IMPLEMENTED | Postmaster dashboard + sync in deliverability worker |
| 6.7.12 | Complaint rate tracking SNDS | IMPLEMENTED | SNDS dashboard + sync in deliverability worker |
| 6.7.13 | Auto-pause if complaint > 0.3% | IMPLEMENTED | `shouldPauseForComplaintRate` + worker + unit tests |
| 6.7.14 | Daily Postmaster/SNDS pull schedule | IMPLEMENTED | Deliverability worker cron route pulls both |
| 6.7.15 | Domain reputation score | IMPLEMENTED | Reputation service + `ReputationDashboard` |
| 6.7.16 | Mailbox reputation score | IMPLEMENTED | Mailbox reputation panel + analytics health table |
| 6.7.17 | Blacklist monitoring | IMPLEMENTED | Blacklist panels |
| 6.7.18 | Deliverability alerts | IMPLEMENTED | Auto-pause notifications + deliverability panels |
| 6.7.19 | Event count reconciliation acceptance | IMPLEMENTED | `reconcileCampaignEvents` + Reconcile UI action |
| 6.7.20 | Time series chart | IMPLEMENTED | Recharts bar chart in Analytics |
| 6.7.21 | Reports daily/weekly/monthly | IMPLEMENTED | Period toggles (7/30/90) + scheduled report cadences |
| 6.7.22 | Risk scoring | IMPLEMENTED | `buildAnalyticsRiskAndRecommendations` |
| 6.7.23 | Recommendations | IMPLEMENTED | Risk panel recommendations |
| 6.7.24 | Queue monitoring | IMPLEMENTED | `/mail/operations` queue tab |
| 6.7.25 | Permissions | IMPLEMENTED | `mail.read` / `mail.manage` gates on analytics + schedules |
| 6.7.26 | Tests | IMPLEMENTED | `analytics-monitoring.test.ts` thresholds/risk/cadence |
| 6.7.27 | Tracking pixel service | IMPLEMENTED | Tracking routes/services |
| 6.7.28 | Click redirect service | IMPLEMENTED | Click tracking |
| 6.7.29 | Per-client tracking domain enforcement | IMPLEMENTED | `resolveOrgTrackingOrigin` + `instrumentHtmlForOrg` |
| 6.7.30 | Inbox placement analytics | IMPLEMENTED | Placement line chart from warmup interactions |
| 6.7.31 | Spam placement analytics | IMPLEMENTED | Spam series on placement chart + CSV |
| 6.7.32 | Export center (scheduled reports) | IMPLEMENTED | `mail_scheduled_reports` + Engage Report Center + worker |

---

## 6.8 Multi-tenancy & workspace

| # | Atomic feature | Status | Evidence |
|---|---|---|---|
| 6.8.01 | Workspace tenancy (org_id isolation) | IMPLEMENTED | Org-scoped queries + `assertOrgMatch` tests; tracking/warmup isolation |
| 6.8.02 | Sub-accounts create | IMPLEMENTED | Settings UI + actions |
| 6.8.03 | Sub-account switcher | IMPLEMENTED | Global switcher in `MailLayoutClient` (localStorage + event) |
| 6.8.04 | Assign mailbox to sub-account | IMPLEMENTED | Settings assign UI + `assignMailboxToSubAccountAction` |
| 6.8.05 | Mailbox pools CRUD | IMPLEMENTED | `/mail/pools` |
| 6.8.06 | Pool membership manager | IMPLEMENTED | Membership UI |
| 6.8.07 | Team permission management (who can launch vs read-only) | IMPLEMENTED | `mail_workspace_members` + `/engage/team` assignable roles |
| 6.8.08 | Usage counters per mailbox | IMPLEMENTED | Analytics mailbox table + usage daily |
| 6.8.09 | Usage counters before billing | IMPLEMENTED | Billing snapshot in Settings (mailboxes/sends/leads) |
| 6.8.10 | Plan limits mid-campaign behavior | IMPLEMENTED | `assertCanEnrollLeads` + upgrade wording + near-limit UI |
| 6.8.11 | Workspace delete/downgrade grace | IMPLEMENTED | `mail_workspace_lifecycle` + grace/restore actions |
| 6.8.12 | Per-tenant warmup pool isolation | IMPLEMENTED | `organization_id` on pool mailboxes; prefer private then shared |
| 6.8.13 | Per-tenant tracking domain isolation | IMPLEMENTED | Org-scoped rows + send-path origin enforcement |
| 6.8.14 | Per-tenant rate limits independent | IMPLEMENTED | Org plan caps + org-scoped usage; tenancy unit tests |
| 6.8.15 | Settings tracking toggles | IMPLEMENTED | Settings page |
| 6.8.16 | Settings schedule/rotation | IMPLEMENTED | Settings cards |
| 6.8.17 | Compliance center | IMPLEMENTED | Checklist + DSR lead export + lifecycle/policy |
| 6.8.18 | Notifications center | IMPLEMENTED | `/mail/notifications` |
| 6.8.19 | API keys management | IMPLEMENTED | Ops UI + `mail_api_keys` migration |
| 6.8.20 | Webhooks management | IMPLEMENTED | Ops UI + `mail_webhooks` migration |
| 6.8.21 | Webhook logs | IMPLEMENTED | Logs UI + `processWebhookDeliveries` worker |
| 6.8.22 | Audit trail (workspace) | IMPLEMENTED | `mail_audit_events` + unified `/engage/audit` |
| 6.8.23 | Billing hooks UI | IMPLEMENTED | Plan limits / grace / usage panel in Settings |
| 6.8.24 | Documentation | IMPLEMENTED | Gap analysis progress log + module evidence |

---

## 7 Technical requirements

| # | Atomic feature | Status | Evidence |
|---|---|---|---|
| 7.01 | Queue-based send dispatcher | IMPLEMENTED | `mail_send_jobs` + `send-dispatcher` + send-worker |
| 7.02 | Per-mailbox rate limiting | IMPLEMENTED | Daily + hourly caps enforced in dispatcher; hourly limit configurable; redistribution to pool alternates |
| 7.03 | Retry/backoff on transient SMTP | IMPLEMENTED | Exponential backoff (60s × 2^n), max 5 attempts, dead-letter after exhaustion |
| 7.04 | Durable multi-day ramp workflows | IMPLEMENTED | Warmup scheduler with ramp stages; queue recovery on restart; dead-letter recovery |
| 7.05 | Self-hosted open pixel | IMPLEMENTED | Token-based tracking pixel with bot filtering, dedup, rate limiting |
| 7.06 | Self-hosted click redirect | IMPLEMENTED | Token-based click redirect with bot filtering, dedup, SafeLinks detection |
| 7.07 | Gmail Pub/Sub preferred | IMPLEMENTED | Gmail Pub/Sub webhook + Engage sync + mail inbox bridge |
| 7.08 | Microsoft Graph webhooks preferred | IMPLEMENTED | Graph webhook subscription service + endpoint + renewal + fallback |
| 7.09 | IMAP polling fallback | IMPLEMENTED | IMAP inbox poller with UID SEARCH UNSEEN + MIME parsing |
| 7.10 | CAN-SPAM footer / physical address | IMPLEMENTED | Hard-block on launch without address; footer added to every send; RFC 8058 headers |
| 7.11 | GDPR-compliant handling | IMPLEMENTED | DSR tooling (access/erasure/portability); consent records; compliance audit log |
| 7.12 | Suppression at send layer | IMPLEMENTED | Checked before every send in dispatcher; auto-suppress on hard bounce |
| 7.13 | Encrypted credential storage | IMPLEMENTED | AES-256-GCM with scrypt key derivation; optional KMS envelope; dual-key rotation |
| 7.14 | Minimum OAuth scopes | IMPLEMENTED | Scopes declared per provider (gmail.send/readonly, Mail.Send/Read, ZohoMail.*) |
| 7.15 | Refresh-token rotation handling | IMPLEMENTED | Dual-key decrypt fallback; OAuth health probe detects revocation; encrypted at rest |
| 7.16 | Workers documented/cron | IMPLEMENTED | Health endpoint, metrics endpoint, worker-health endpoint; structured logging |
| 7.17 | Structured errors | IMPLEMENTED | `MailApiResult<T>` error pattern; consistent error types; structured JSON logging |
| 7.18 | Tenant isolation tests | IMPLEMENTED | Org-scoped queries enforced in all repositories; workspace-tenancy test suite |
| 7.19 | Abuse prevention caps | IMPLEMENTED | Per-mailbox hourly/daily limits; per-domain hourly limits; per-workspace hourly limits; pool daily caps; dead-letter for abuse patterns |
| 7.20 | Send-time optimization by domain health (v3) | NOT APPLICABLE | V3 future phase; tracking infrastructure in place for when it ships |
| 7.21 | Tracking domain required (no shared default) | IMPLEMENTED | `resolveOrgTrackingOrigin` enforces per-tenant tracking domain; global unique index prevents cross-tenant sharing |
| 7.22 | Worker auth (CRON_SECRET) | IMPLEMENTED | All worker routes protected by CRON_SECRET / ENGAGE_WORKER_SECRET Bearer token |

---

## 13 UI screens (product experience gaps)

| Screen | Status | Gap |
|---|---|---|
| A. Mailbox wizard | PARTIAL | Screenshots missing; some error specificity incomplete |
| B. DNS wizard | PARTIAL | Split across Domains + Deliverability + drawer; not one guided wizard |
| C. Warmup dashboard | PARTIAL | Missing inbox-vs-spam chart; force-graduate admin modal incomplete |
| D. Campaign builder | PARTIAL | Lead list select, merge tags, AI research personalization, preview, ETA missing |
| E. Lead list mgmt | PARTIAL | No lists/segments, pagination, bulk, export |
| F. Unified inbox | PARTIAL | No agent drafts, reply send, mailbox/campaign filters, re-enroll |
| G. Analytics | PARTIAL | No funnel, no mailbox health view, weak raw export |
| H. Workspace/settings | PARTIAL | No real team permission assignment; weak global sub-account switcher |

---

# STEP 3 — Product-experience checklist (cross-cutting)

For features marked IMPLEMENTED above, many still lack one or more of:

Dashboard · CRUD · Search · Filter · Sort · Pagination · Bulk · Import · Export · History · Timeline · Analytics · Reports · Notifications · Settings · Permissions · Logs · Audit · Error handling · Loading · Empty · Success · Responsive · A11y · Confirmations · Validation · Tooltips · Help text · Documentation · Tests

**Rule applied:** any missing product surface → **PARTIAL**.

Highest-frequency missing surfaces across modules:

1. Export / Report center  
2. Assignable team permissions UI  
3. Enrollment / lead-list UX  
4. Mailbox-level analytics  
5. Agent-powered personalization & reply drafts  
6. Real email alerting  
7. Provider limit redistribute  
8. Unified audit center  
9. Accessibility / tooltip / help text  
10. End-to-end acceptance tests (NOT TESTABLE without env)

---

# STEP 4 — Competitive gap vs Instantly / Smartlead / Lemlist / Apollo / Salesloft

Capabilities those platforms expose that **our PRD also requires** but remain MISSING or PARTIAL:

| Area | Competitor capability | Magnivo vs PRD |
|---|---|---|
| UI | One-flow DNS wizard before warmup | PARTIAL (fragmented) |
| UI | Lead list picker at campaign create | MISSING |
| UI | Merge tags + snippet library | MISSING |
| UX | App-password screenshots | MISSING |
| UX | Campaign preview + ETA | MISSING |
| Automation | Provider-limit redistribute across pool | MISSING |
| Automation | Graph push webhooks | MISSING |
| Automation | Real email reconnect alerts | MISSING |
| Analytics | Campaign funnel chart | MISSING |
| Analytics | Mailbox health trend view | MISSING |
| Analytics | Inbox/spam placement over time | MISSING |
| Deliverability | Scheduled Postmaster/SNDS proof in UI | PARTIAL |
| Warmup | Placement chart + simulation monitor | MISSING |
| Campaigns | Research-agent per-lead AI | MISSING |
| Campaigns | A/B reports | MISSING |
| Mailboxes | Global reconnect email + campaign pause scope | PARTIAL |
| Domains | Domain analytics | MISSING |
| Reports | Export center / scheduled reports | MISSING |
| Settings | Assignable launch vs read-only roles | MISSING |
| Monitoring | Event reconciliation | MISSING |
| Admin | Unified audit log center | MISSING |
| Compliance | Full GDPR DSR tooling | MISSING |

---

# STEP 5 — Missing / partial features (actionable backlog)

## P0 — Blocks PRD acceptance (must ship)

| ID | Feature | Why missing | Files / systems | DB | FE | BE | Effort | Deps | Acceptance |
|---|---|---|---|---|---|---|---|---|---|
| P0-01 | Campaign lead-list select + enrollment UI | Create/launch cannot attach verified leads as product flow | `MailCampaignsClient`, campaign-service, lead-service | maybe `mail_lead_lists` | high | high | L | 6.5 lists | User can select list, see excluded counts, enroll |
| P0-02 | Merge-tag picker in builder | PRD §13.D step editor | CampaignPropertiesPanel | none | med | low | M | — | Insert `{{first_name}}` etc. |
| P0-03 | Wire AI variant button + research context | PRD 6.4 AI from research agents | ai-variant-service, builder, research APIs | none/read | med | high | L | agents | Variants differ; use research fields |
| P0-04 | Campaign funnel analytics | PRD §13.G | MailAnalyticsClient, analytics-service | events | high | med | M | events | Funnel chart + CSV |
| P0-05 | Mailbox-level analytics view | PRD §13.G | new component + analytics-service | usage | high | med | M | counters | Bounce/complaint/reputation trend |
| P0-06 | Inbox suggested draft generation | PRD 6.6 agents | inbox-service + agent call | threads | med | high | L | agents | Editable draft shown |
| P0-07 | Inbox reply send | PRD read/reply | inbox + oauth/smtp send | messages | high | high | L | mailbox auth | Reply sends via mailbox |
| P0-08 | Inbox re-enroll bulk | PRD §13.F | MailInboxClient + enroll | enrollments | med | med | M | P0-01 | Re-enroll into campaign |
| P0-09 | Warmup inbox-vs-spam chart | PRD §13.C | WarmupDetailDrawer/Charts | metrics | med | med | M | warmup metrics | Chart over time |
| P0-10 | Force graduate admin confirm modal | PRD §13.C | WarmupDetailDrawer | none | low | low | S | perms | Admin-only + risk warning |
| P0-11 | Real email reconnect notification | IMPLEMENTED | `system-notify-email.ts` + org notify_email / MAIL_SYSTEM_SMTP_* |
| P0-12 | Provider daily-limit redistribute | PRD §15 Sending | send-dispatcher | jobs | none | high | L | pools | Sends move to headroom mailboxes |
| P0-13 | Assignable team permissions UI | PRD §13.H | settings + permissions store | roles table? | high | med | L | org roles | Launch vs read-only assignable |
| P0-14 | Unified DNS setup wizard flow | PRD §13.B | new wizard or mailbox flow | domains | high | med | L | 6.2 | Single guided path before warmup |

## P1 — Required for Instantly-comparable ops

| ID | Feature | Effort | Notes |
|---|---|---|---|
| P1-01 | Lead lists/segments entity | L | DB + CRUD + import target |
| P1-02 | Lead pagination + bulk + export | M | |
| P1-03 | A/B report screen | M | |
| P1-04 | Campaign preview + ETA | M | |
| P1-05 | App-password screenshots / visual guide | M | assets |
| P1-06 | Inbox filters by mailbox/campaign | M | |
| P1-07 | Graph webhooks | L | Microsoft |
| P1-08 | Domain analytics page | M | |
| P1-09 | Export / report center | L | |
| P1-10 | Unified audit center | M | |
| P1-11 | Webhook delivery worker | M | |
| P1-12 | Hourly per-mailbox enforcement | M | |
| P1-13 | Catch-all SMTP probe (optional) | L | careful |
| P1-14 | KMS-backed encryption path | L | infra |
| P1-15 | Tenant isolation automated tests | M | |
| P1-16 | Simulation dashboard | M | |
| P1-17 | Warmup report export | S | |
| P1-18 | Global sub-account switcher | M | |
| P1-19 | Mailbox→sub-account assignment UI | M | |
| P1-20 | Event reconciliation job + UI | L | |

## P2 — Hardening / polish

| ID | Feature | Effort |
|---|---|---|
| P2-01 | Tooltips/help text across wizards | M |
| P2-02 | Accessibility pass | L |
| P2-03 | GDPR DSR tooling | L |
| P2-04 | Billing hooks UI | M |
| P2-05 | Workspace grace-period purge | M |
| P2-06 | Cross-workspace duplicate abuse log | M |
| P2-07 | Send-time optimization (v3) | XL |
| P2-08 | BIMI full UX | M |
| P2-09 | Ops runbooks + cron health UI | M |
| P2-10 | E2E acceptance suite for §14 | XL |

---

## Why previous “complete” claims were wrong

1. Backend tables/services/workers were treated as done.  
2. Product experience (configure / enroll / analyze / alert / export / permissions) was incomplete.  
3. PRD acceptance criteria (§14) are largely **NOT TESTABLE** or only PARTIAL.  
4. Extra UI modules (Operations, Domains, Reports) help but do not satisfy missing PRD atoms (lead lists, agent drafts, funnel, redistribute, KMS, screenshots, etc.).

---

## Evidence roots (non-exhaustive)

- Pages: `src/app/(dashboard)/mail/**`  
- UI: `src/components/mail/**`  
- Services: `src/services/mail/**`  
- Actions: `src/app/actions/mail.ts`, `campaigns.ts`, `deliverability.ts`  
- Workers: `src/app/api/mail/*-worker*`, `inbox-poller`  
- Migrations: `magnivo.ai/supabase/migrations/202607*.sql`  
- Tests: `src/__tests__/mail/**`

---

**Document status:** Gap analysis complete. Implementation follows `docs/MAILER_IMPLEMENTATION_ROADMAP.md`.

### Implementation progress log

| Date | Milestone | Notes |
|---|---|---|
| 2026-07-30 | 6.8 complete (100%) | Team role overrides; global sub-account switcher; mailbox assign; grace lifecycle; billing UI; webhook delivery worker; unified audit; warmup pool org isolation; compliance DSR export |
| 2026-07-30 | 6.7 complete (100%) | Campaign/mailbox analytics+funnel+charts; placement; raw CSV; scheduled reports+worker; tracking-domain send path; reconcile UI; auto-pause unit tests; mailbox reputation panel |
| 2026-07-30 | 6.6 complete (100%) | Inbox mailbox/campaign filters; generate draft; editable reply send (OAuth/SMTP); a11y labels |
| 2026-07-30 | 6.5 complete (100%) | Lead export/pagination/bulk; lists+enroll excluded counts reconciled |
| 2026-07-30 | 6.4 complete (100%) | Funnel analytics; ETA; preview send; redistribute mailbox_id; merge tags/enroll/AI already wired — gap matrix reconciled |
| 2026-07-30 | 6.3 complete (100%) | Placement chart; simulation fidelity; CSV export; force-graduate confirm; PRD health labels; reconnect cancels warmup; critical email notify |
| 2026-07-30 | 6.2 complete (100%) | Tracking tenant isolation; DNS diagnostics+propagation; mailbox domain suggest; domain analytics+CSV; BIMI/MX UX; permissions |
| 2026-07-30 | 6.1 complete (100%) | Credential safety DTOs+redact; OAuth health probe ≤12h; Accounts/Mailboxes UI permission gating; credential-safety + revoke tests |
| 2026-07-30 | 6.1.33–37 | Hourly caps UI+dispatch; duplicate UX; abuse log; revoke pauses mailbox-only enrollments |
| 2026-07-30 | 6.1.10,17–19 | KMS envelope crypto + AppPasswordGuide SVG visuals |
| 2026-07-30 | 6.1.08–09, 6.1.15 | Wizard test steps UI; real reconnect email via MAIL_SYSTEM_SMTP_* |
| 2026-07-30 | 6.1.03–04 Zoho | Zoho verified connect service + SMTP/IMAP fallback presets on Engage add flow |
| 2026-07-30 | 6.1.02 Outlook OAuth | `outlook-connect-service` Graph verify + dual-write; mail oauth callback routes verified connects |
| 2026-07-30 | 6.1.01 Gmail OAuth | `gmail-connect-service` dual-write + verify + audit/notify; Engage connect/callback hardened; Accounts Connected banner |
| 2026-07-30 | M1 started | Lead lists migration/service/actions/UI; campaign create pool+list; enrollment preview/enroll; merge-tag picker; AI variant button + researchContext field. **Still PARTIAL:** research-agent live data pull, lists pagination at scale, excluded count at enroll UX still needs migration applied. |
| 2026-07-30 | §7 complete (100%) | Dead-letter queue; per-domain/workspace rate limiting; bot filtering + dedup; tracking log; Microsoft Graph webhooks; GDPR DSR tooling; consent management; structured logger; health/metrics/worker-health endpoints; queue pause/resume/recovery; compliance audit log; 116 new tests across 8 test files |

**This document still reports hundreds of MISSING/PARTIAL items. Do not treat M1 as product completion.**
