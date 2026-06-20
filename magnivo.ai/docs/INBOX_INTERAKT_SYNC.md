# Inbox ↔ Interakt sync – why it might not be syncing

The CRM Inbox shows conversations and messages from your **Supabase** database. It does **not** pull messages directly from Interakt on every load. Sync works like this:

## How sync works

1. **Incoming messages (customer → you)**  
   Interakt must send webhooks to your app when a message is received. Your app then:
   - Finds or creates the lead (by phone number)
   - Finds or creates the conversation
   - Inserts the message into `messages`
   - Inbox (and Supabase Realtime) then show it

2. **Outgoing messages (you → customer)**  
   Messages you send from the CRM are sent via the Interakt API and also stored in your DB. If you (or someone) sends from the **Interakt dashboard** instead of the CRM, those only appear in the Inbox if Interakt sends a `message_sent` webhook to your app and your webhook handler saves them.

3. **“Sync” button in the Inbox**  
   This runs **contact sync** only: it pulls the list of users/contacts from Interakt and creates/updates **leads** and **conversations** in your DB. It does **not** pull message history (Interakt’s public API does not expose full message history for polling).

So: **message-level sync is entirely driven by webhooks.** If webhooks are not hitting your app, new messages from Interakt will not show up in the Inbox.

---

## Checklist: why Inbox might not be syncing

### 1. Webhook URL not configured in Interakt (most common)

- Your app must be reachable at a **public URL** (e.g. `https://yourdomain.com`), not only `localhost`.
- In the **Interakt dashboard**, set the webhook URL to:
  - `https://<your-public-domain>/api/webhooks/interakt`
- Ensure the events you need are enabled (e.g. **message_received**, **message_sent**), depending on Interakt’s UI.

If the app runs only on `localhost`, Interakt’s servers cannot call your webhook, so no messages will sync.

### 2. Interakt API key missing or wrong

- The app uses `INTERAKT_API_KEY` (env) for:
  - Sending messages from the CRM
  - Contact sync (“Sync” button)
- If the key is missing or invalid, sending and contact sync will fail. Webhook delivery does not depend on this key, but without it the rest of the flow is broken.
- Set in `.env.local`:  
  `INTERAKT_API_KEY=<your Interakt API key>`

### 3. Phone number format mismatch

- The webhook normalizes phone numbers (e.g. strips country code to get a 10‑digit form) and looks up leads with variants (`10-digit`, `+91…`, `91…`).
- If leads were created with a different format (e.g. US `1` + 10 digits), the webhook might not find them and will create a new lead. That can look like “no sync” if you expect the message on an existing lead.
- Keep lead phone numbers in a format that matches what Interakt sends (or ensure your webhook logic covers all formats you use).

### 4. Supabase Realtime (optional)

- The Inbox uses Supabase Realtime on `conversations` and `messages` so that new rows appear without refreshing.
- If Realtime is disabled for these tables, the Inbox will still show new data after a refresh or when you re-open a conversation; the main fix is still making sure webhooks are received and rows are inserted.

### 5. Webhook secret (optional)

- The route does not currently verify `INTERAKT_WEBHOOK_SECRET`. If you add verification later, ensure the secret in Interakt matches the one in your env so valid webhooks are not rejected.

---

## Quick test

1. **Contact sync**  
   In Inbox, click the **Sync** (refresh) button. If it succeeds, your API key and “list users” flow work. That does not pull message history.

2. **Webhook**  
   From a tool like Postman or `curl`, send a POST request to:
   `https://<your-public-url>/api/webhooks/interakt`
   with a JSON body that matches what Interakt sends for `message_received` (see Interakt docs or your webhook route for the exact shape). If that request creates a conversation/message in Supabase and they appear in the Inbox, the webhook path is working.

3. **End-to-end**  
   Send a WhatsApp message to your Interakt number from a phone. If the webhook URL is correct and events are enabled, that message should show up in the Inbox (and in the `messages` table) after Interakt sends the webhook.

---

## Summary

| What you want              | What to check                                      |
|----------------------------|----------------------------------------------------|
| New customer messages in Inbox | Interakt webhook URL set to `…/api/webhooks/interakt` and events enabled; app on a public URL. |
| Messages you send from CRM    | `INTERAKT_API_KEY` set and valid.                  |
| Contact list / conversations  | Use the Inbox “Sync” button; ensure `INTERAKT_API_KEY` is set. |
| Full message history          | Not available by API; only new messages via webhooks are stored. |

Once the webhook URL is public and configured in Interakt (and events are enabled), Inbox and Interakt stay in sync for all new messages that Interakt sends to your webhook.
