# Magnivo Mailer — Implementation Roadmap

**Source:** `docs/MAILER_GAP_ANALYSIS.md` + `.cursor/rules/prd.mdc`  
**Rule:** Each milestone is independently deployable. Ship complete modules (DB → API → service → UI → permissions → validation → docs → tests). Never ship isolated APIs.

**Target:** Gap analysis reports **0 MISSING** and **0 P0 PARTIAL** for PRD atomic features.

---

## Current baseline

| Metric | Value |
|---|---|
| Overall IMPLEMENTED | ~31% |
| Weighted (Impl + 0.5×Partial) | ~52% |
| Blocker | P0 backlog (14 items) |

---

## Milestone M0 — Truth & ops readiness (deploy first)

**Goal:** Stop false completion claims; make environments runnable.

| Work | Deliverable |
|---|---|
| Keep gap analysis current | Update `MAILER_GAP_ANALYSIS.md` after each milestone |
| Apply pending migrations as owner | Domain fields + operations center SQL |
| Cron secrets / worker smoke | send-worker, deliverability-worker, inbox-poller health |
| Encryption key present | `MAIL_ENCRYPTION_KEY` documented |

**Exit:** Staging can open every `/mail/*` route without 500s from missing tables.

---

## Milestone M1 — Campaign enrollment & builder completeness (P0-01, P0-02, P0-03, P0-38)

**Deployable module:** Lead Lists + Enrollment + Builder editors

### Includes
1. **Lead lists**
   - DB: `mail_lead_lists`, `mail_lead_list_members`
   - CRUD UI on `/mail/leads` (Lists tab)
   - Import into list, search, pagination, member counts
2. **Campaign enrollment**
   - Select list at create/launch
   - Preview excluded (invalid/suppressed/dup) counts
   - Enroll action with send-layer + enrollment-time suppression checks
3. **Builder**
   - Merge-tag picker in email step properties
   - AI variant generate button wired to action
   - Pull available research fields when present (graceful empty)
4. **Permissions / validation / tests / docs**

**Exit criteria**
- User can create list → import CSV → attach to campaign → see excluded counts → enroll → launch blocked if pool not warm
- Merge tags insert into subject/body
- AI variants generate from UI

---

## Milestone M2 — Analytics product (P0-04, P0-05, P1-03)

**Deployable module:** Analytics Center

### Includes
1. Campaign funnel (sent → delivered → opened → clicked → replied → bounced → unsub)
2. Mailbox health analytics view (bounce, complaint, reputation trend)
3. A/B report tab (even if data sparse)
4. Raw event CSV export
5. Empty/loading/error states + tests

**Exit:** Matches PRD §13.G product experience.

---

## Milestone M3 — Inbox product completion (P0-06, P0-07, P0-08, P1-06)

**Deployable module:** Unified Inbox v2

### Includes
1. Suggested draft generation via Magnivo agent path (or documented agent stub that uses existing generateJson with lead context — production call, not mock UI)
2. Editable draft + send reply via mailbox OAuth/SMTP
3. Filters: mailbox, campaign
4. Bulk re-enroll into campaign/sequence
5. Safe-default pause on OOO remains
6. Tests for classification + pause + permissions

**Exit:** PRD §13.F usable end-to-end.

---

## Milestone M4 — Warmup product acceptance (P0-09, P0-10, P1-16, P1-17)

**Deployable module:** Warmup Insights

### Includes
1. Inbox-vs-spam placement chart over time (from warmup metrics)
2. Force graduate: admin-only + confirmation modal with risk copy
3. Simulation dashboard (delays/opens/replies/spam rescue rates)
4. Warmup CSV report export
5. Docs + tests

**Exit:** PRD §13.C acceptance items covered in UI.

---

## Milestone M5 — Reliability & alerts (P0-11, P0-12, P1-11, P1-12)

**Deployable module:** Send reliability

### Includes
1. Real email reconnect notifications (system mail path)
2. Provider daily-limit hit → pause mailbox remaining → redistribute to pool headroom
3. Hourly per-mailbox enforcement
4. Webhook delivery worker + log success/fail
5. Tests for redistribute + rate limit

**Exit:** PRD §15 Sending + §14 reconnect email covered.

---

## Milestone M6 — DNS wizard unification (P0-14, P1-08)

**Deployable module:** Guided DNS Wizard

### Includes
1. Single wizard: detect domain from mailbox → records table → provider dropdown → verify → override path
2. Soft-block to warmup with clear CTA
3. Domain analytics page (health, reputation, blacklist timeline)
4. App-password visual guide assets (P1-05 can ship here)

**Exit:** PRD §13.B is one flow, not three pages.

---

## Milestone M7 — Workspace admin (P0-13, P1-18, P1-19, P1-10)

**Deployable module:** Workspace Admin

### Includes
1. Assignable mail permissions (launch vs read-only) mapped to org members
2. Global sub-account switcher in mail layout
3. Mailbox → sub-account assignment UI
4. Unified audit center (mailbox + warmup + campaign + ops)
5. Tests for permission denies

**Exit:** PRD §13.H complete.

---

## Milestone M8 — Hardening (P1 remaining + P2 critical)

### Includes
1. KMS-backed encryption adapter (or documented cloud KMS integration)
2. Microsoft Graph webhooks
3. Tenant isolation automated tests
4. Event reconciliation job + UI
5. Export/report center (scheduled)
6. GDPR DSR basics
7. Accessibility + tooltips pass
8. E2E suite for §14 acceptance criteria

**Exit:** Gap analysis P0 = 0; P1 MISSING = 0; overall IMPLEMENTED ≥ 85%.

---

## Milestone M9 — Parity polish

### Includes
1. Campaign preview + ETA
2. Billing hooks UI (counters → upgrade prompts)
3. Workspace grace purge policy
4. BIMI optional UX
5. Send-time optimization (PRD v3) if still required by success metrics

**Exit:** `MAILER_GAP_ANALYSIS.md` reports no MISSING items for PRD §6–§14 (v1+v2 scope). v3 items explicitly marked only if product decides to defer with PRD amendment.

---

## Sequencing diagram

```text
M0 ops truth
  → M1 enrollment/builder
  → M2 analytics
  → M3 inbox
  → M4 warmup insights
  → M5 reliability/alerts
  → M6 DNS wizard
  → M7 workspace admin
  → M8 hardening
  → M9 parity polish
```

Parallelization (after M1):
- M2 ∥ M4 (analytics vs warmup charts)
- M3 depends on M1 (re-enroll needs campaigns/lists)
- M5 can parallel M6
- M7 after permissions model agreed
- M8 last for infra-heavy items

---

## Definition of Done (every milestone)

- [ ] Additive migration (if needed) + indexes + tenant isolation
- [ ] Repository + service + actions/API
- [ ] Validation + permissions
- [ ] Worker/job if async
- [ ] Frontend: dashboard/settings/management + loading/empty/error/success
- [ ] Search/filter/pagination where lists exist
- [ ] Tests in `src/__tests__/mail/`
- [ ] Docs updated (`MAILER_GAP_ANALYSIS.md` statuses flipped)
- [ ] Typecheck clean
- [ ] No placeholder/TODO/mock product paths

---

## Immediate next implementation

**Start M1 now** (complete module): Lead Lists + Campaign Enrollment + Merge tags + AI variant button wiring.
