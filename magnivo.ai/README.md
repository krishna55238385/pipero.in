# Magnivo AI — CRM (frontend)

A full-stack B2B GTM CRM built with Next.js 16, Supabase, and Clerk auth. Includes lead management, an email engagement engine (Engage), a dialer, GTM phase automation, and AI-assisted email generation.

> This is the **`magnivo.ai/`** frontend of the monorepo. The AI GTM pipeline it
> runs on lives in **`../gtm_backend/`**. See the [root README](../README.md) for
> the full project overview.

---

## Local Development

### Prerequisites

| Tool | Version |
|------|---------|
| Node.js | 18+ |
| npm | 9+ |
| Git | any |
| Supabase account | free tier works |
| Clerk account | free tier works |

### Setup

```bash
# 1. Clone, then enter the CRM frontend folder
git clone https://github.com/krishna55238385/pipero.in.git
cd pipero.in/magnivo.ai

# 2. Install dependencies
npm install

# 3. Copy env file and fill it in (see Environment Variables below)
cp .env.local.example .env.local

# 4. Apply DB migrations (need Supabase CLI)
npx supabase db push   # or run each file in supabase/migrations/ manually

# 5. Run dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

> **Auth in dev:** Set `NEXT_PUBLIC_BYPASS_AUTH=true` in `.env.local` to skip Clerk and auto-login as the first org/user. Remove it (or set to `false`) for real auth.

---

## Environment Variables

Copy `.env.local.example` → `.env.local` and fill in every value.

### Required — Supabase

| Variable | Where to get it |
|----------|----------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase dashboard → Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same page → `anon` / `public` key |
| `SUPABASE_SERVICE_ROLE_KEY` | Same page → `service_role` key (keep secret, server-only) |

### Required — Clerk Auth

| Variable | Where to get it |
|----------|----------------|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk dashboard → API Keys |
| `CLERK_SECRET_KEY` | Same page |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | `/sign-in` (set in Clerk dashboard too) |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | `/sign-up` |

### Optional — GTM Trigger Service

Needed only if you run the backend GTM phases (lead scoring, outreach automation).

| Variable | Value |
|----------|-------|
| `GTM_SERVICE_URL` | URL of the deployed `gtm_service/` on Render / Railway |
| `GTM_SERVICE_TOKEN` | Token from the service's `GTM_TRIGGER_TOKEN` env var |

### Optional — Engage (Email Engine)

| Variable | Notes |
|----------|-------|
| `GOOGLE_CLIENT_ID` | Google Cloud OAuth 2.0 client ID |
| `GOOGLE_CLIENT_SECRET` | Google Cloud OAuth 2.0 client secret |
| `GOOGLE_REDIRECT_URI` | `http://localhost:3000/api/engage/gmail/callback` locally |
| `GOOGLE_PUBSUB_TOPIC_NAME` | Google Cloud Pub/Sub topic for Gmail push notifications |
| `ENGAGE_GMAIL_WEBHOOK_TOKEN` | Any random string — used to verify Gmail webhook calls |
| `GEMINI_API_KEY` | Google AI Studio key for AI-drafted emails |

### Optional — WhatsApp (Interakt)

| Variable | Notes |
|----------|-------|
| `INTERAKT_API_KEY` | From Interakt dashboard |
| `INTERAKT_INTERNAL_SYNC_TOKEN` | Any secure random string |
| `INTERAKT_FB_TEMPLATE_NAME` | Your approved WhatsApp template name |
| `INTERAKT_FB_TEMPLATE_LANG` | e.g. `en` |

### Dev-only

| Variable | Default | Notes |
|----------|---------|-------|
| `NEXT_PUBLIC_BYPASS_AUTH` | `false` | Set `true` to skip Clerk in local dev |

---

## Deploying to Vercel

### One-time setup

1. Push the repo to GitHub (already done).
2. Go to [vercel.com/new](https://vercel.com/new) → import the repo.
3. Set **Root Directory** to `magnivo.ai` (the CRM frontend within this monorepo).
4. Framework preset: **Next.js** (auto-detected).

### Environment variables on Vercel

In Vercel → Project → Settings → Environment Variables, add **every variable** from the table above (all environments: Production, Preview, Development).

Key differences from local:
- `NEXT_PUBLIC_BYPASS_AUTH` → **do not set** (leave unset or `false`)
- `GOOGLE_REDIRECT_URI` → change to your production domain, e.g. `https://yourdomain.com/api/engage/gmail/callback`
- `SUPABASE_SERVICE_ROLE_KEY` → mark as **sensitive** / server-only

### Deploy

```bash
# Preview deploy
npx vercel

# Production deploy
npx vercel --prod
```

Or just push to `main` — Vercel auto-deploys on every push if CI is wired.

### Database migrations on deploy

Run migrations against your production Supabase project once before going live:

```bash
SUPABASE_PROJECT_ID=your-project-id npx supabase db push
```

Or apply each file in `supabase/migrations/` manually via the Supabase SQL editor.

---

## Project Structure

```
magnivo.ai/
├── src/
│   ├── app/                  # Next.js App Router pages + API routes
│   │   ├── (dashboard)/      # Authenticated CRM pages
│   │   ├── api/              # API routes (engage, gtm, webhooks)
│   │   └── landing/          # Public marketing pages
│   ├── components/           # UI components (engage, settings, layout, ui/)
│   ├── lib/                  # Supabase client, helpers
│   └── types/                # TypeScript types
├── supabase/
│   └── migrations/           # SQL migrations — run in order
├── scripts/                  # One-off admin scripts
└── .env.local.example        # Copy → .env.local
```

---

## Scripts

```bash
npm run dev                          # Start dev server (localhost:3000)
npm run build                        # Production build
npm run lint                         # ESLint
npm run create-super-admin-krishna   # Seed first super-admin user
```
