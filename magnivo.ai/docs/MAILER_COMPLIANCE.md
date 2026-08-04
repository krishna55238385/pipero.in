# Mailer compliance checklist

## Google / Yahoo sender requirements
- SPF + DKIM verified before warmup (DMARC soft-override → `at_risk`)
- `List-Unsubscribe` + `List-Unsubscribe-Post` on every campaign/manual send
- Complaint auto-pause threshold: 0.3%
- Bounce-rate auto-pause on elevated soft/hard bounce rates

## CAN-SPAM / GDPR
- Physical address / signature configurable in Mail Settings
- Org-wide suppression list enforced at enrollment **and** send time
- One-click unsubscribe via signed tenant-scoped tokens (`/api/track/unsubscribe?token=`)
- Data retention days stored on `mail_org_settings.retention_days`

## Security
- Mail credentials: AES-256-GCM (`MAIL_ENCRYPTION_KEY`), never returned in API DTOs
- Engage Gmail tokens: dual-write encrypted columns; plaintext cleared when encryption succeeds
- OAuth scopes minimized to `gmail.send` + `gmail.readonly` (+ openid/email/profile)
- Role-based mail permissions via `lib/mail-permissions.ts`

## Encryption key rotation
- Algorithm: **AES-256-GCM** with per-ciphertext random salt + IV (`src/lib/encryption.ts`)
- Primary secret: `MAIL_ENCRYPTION_KEY` (64-char hex = 32-byte master key)
- **Dual-key rotation (recommended):** set `MAIL_ENCRYPTION_KEY_PREVIOUS` to the outgoing key and update `MAIL_ENCRYPTION_KEY` to the new key. Re-encrypt stored credentials (OAuth refresh tokens, SMTP/IMAP passwords, warmup pool secrets) by reading with either key and writing with the new key via a one-off ops script.
- **Single-key rotation:** if dual-key is not configured, schedule a maintenance window, export/decrypt with the old key, deploy the new `MAIL_ENCRYPTION_KEY`, and re-encrypt all `encrypted_*` columns before resuming sends.
- Never log plaintext credentials or encryption keys. Rotate keys at least annually or immediately after any suspected compromise.

## Tenant isolation
- Unique `(organization_id, email)` on mailboxes and leads
- Tracking domains blocked from cross-tenant reuse
- Warmup partners are Magnivo warmup-only domains (`mail_warmup_pool_mailboxes.is_warmup_only`)
- Abuse review events for cross-org duplicate mailbox connections
