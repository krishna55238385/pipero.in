# Get the app working (success path)

Follow this once after deploy. You should land on the dashboard.

## Option 1: Sign in (default)

1. Open your app URL (e.g. `https://pipero-io-eight.vercel.app`).
2. Go to **/login** (or click "Sign In" from the landing page).
3. Enter **any email** (e.g. `you@company.com`) and **any password**.
4. Click **Sign In**.
5. You should be redirected to **/home** (dashboard). If you see "Account Suspended", that page now redirects to /home, so you will land on the dashboard.

If you already have the auth cookie (you signed in before), visiting **/login** again will redirect you straight to the dashboard.

## Option 2: Bypass auth (if Option 1 still fails)

1. In **Vercel** → your project → **Settings** → **Environment Variables**.
2. Add: **Key** `NEXT_PUBLIC_BYPASS_AUTH`, **Value** `true`.
3. **Redeploy** (Deployments → ⋮ → Redeploy).
4. Open your app URL. You will go straight to the dashboard with no login.
5. **Remove** `NEXT_PUBLIC_BYPASS_AUTH` from Vercel when you are done and redeploy (so auth is required again).

## What’s in place

- **/suspended** always redirects to **/home** (suspended screen is never shown).
- **Login** sets a persistent cookie (path, maxAge, sameSite, secure) so it works on Vercel.
- **Dashboard** accepts the mock cookie and uses a fallback user if the DB is unavailable.
- **Bypass** (`NEXT_PUBLIC_BYPASS_AUTH=true`) lets you in without logging in.
