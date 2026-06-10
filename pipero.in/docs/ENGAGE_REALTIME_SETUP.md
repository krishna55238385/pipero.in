# Engage Realtime Setup (Gmail Push + Supabase)

Use this checklist to enable true push-based inbox updates.

## 1) Environment variables

Set these in your deployment:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI` (for OAuth callback)
- `GOOGLE_PUBSUB_TOPIC_NAME` (format: `projects/<project-id>/topics/<topic-name>`)
- `ENGAGE_GMAIL_WEBHOOK_TOKEN` (shared secret for webhook querystring validation)
- `SUPABASE_SERVICE_ROLE_KEY` (required by webhook to sync data without user cookies)

## 2) Supabase migrations

Apply latest migrations, especially:

- `20260607000000_engage_module.sql`
- `20260607010000_engage_gmail_realtime.sql`

## 3) Google Cloud Pub/Sub

1. Create topic (same value as `GOOGLE_PUBSUB_TOPIC_NAME`).
2. Create push subscription to:
   - `https://<your-domain>/api/engage/gmail/webhook?token=<ENGAGE_GMAIL_WEBHOOK_TOKEN>`
3. Grant Gmail publish permission to the topic for:
   - `gmail-api-push@system.gserviceaccount.com`

## 4) Gmail OAuth

In Google OAuth app:

- Add redirect URI:
  - `https://<your-domain>/api/engage/gmail/callback`
- Include scopes:
  - `https://www.googleapis.com/auth/gmail.readonly`
  - `https://www.googleapis.com/auth/gmail.send`
  - `https://www.googleapis.com/auth/gmail.modify`

## 5) Start watch

From Engage Settings:

1. Connect Gmail.
2. Click **Start Gmail push watch**.
3. Confirm `watch_expiration` and `last_synced_at` are populated.

## 6) Runtime behavior

- Inbox reads from `engage_emails` table first (DB + realtime updates).
- Webhook syncs new messages into `engage_emails`.
- Polling (30s) remains as fallback resilience.

