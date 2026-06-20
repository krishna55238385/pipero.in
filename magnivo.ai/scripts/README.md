# Scripts

## Fix "Account Suspended" on Vercel

The app works locally but shows **Account Suspended** on Vercel because the **production** Supabase database has `is_active = false` for your user in `public.users`. Local uses a different DB (or you already unsuspended there).

**Fix:** Unsuspend the user in the **same** Supabase project that Vercel uses.

1. In [Vercel](https://vercel.com) → your project → **Settings** → **Environment Variables**, copy:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY` (if you don’t have it, create it in Supabase Dashboard → Settings → API → service_role)

2. From your project root, run (use the values from step 1):

   ```bash
   set NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   set SUPABASE_SERVICE_ROLE_KEY=eyJ...
   node scripts/unsuspend_user.mjs bhishm@avaniglobal.in
   ```

   On macOS/Linux use `export` instead of `set`.

3. Sign in again on pipero-io-eight.vercel.app — you should reach the dashboard.

You only need to run this once per user that was suspended in production.
