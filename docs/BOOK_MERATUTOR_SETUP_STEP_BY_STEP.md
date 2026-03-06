# Book.meratutor.ai + CRM — Step-by-step setup

You have:
- **CRM** (Pipero) — deployed on Vercel (e.g. pipero-in.vercel.app).
- **4 landing pages** — maths, maths-2, science, science-2 (each was its own repo/project).
- **meratutor-router** — Vercel project with domain **book.meratutor.ai** so that:
  - https://book.meratutor.ai/maths
  - https://book.meratutor.ai/maths-2
  - https://book.meratutor.ai/science
  - https://book.meratutor.ai/science-2
  all work.

Goal: **Leads from those 4 pages (when visited via book.meratutor.ai) should appear in the CRM.**

---

## How it works (short)

- **meratutor-router** (book.meratutor.ai) should **rewrite** requests to your **CRM** app:
  - `/maths` → CRM’s `/book/maths/`
  - `/maths-2` → CRM’s `/book/maths-2/`
  - `/science` → CRM’s `/book/science/`
  - `/science-2` → CRM’s `/book/science-2/`
  - `/api/public/leads` → CRM’s `/api/public/leads` (so form submits create leads in the CRM).

- The **CRM** repo (this one, pipero.in) already contains:
  - The 4 landing pages under `public/book/` (maths, maths-2, science, science-2).
  - Forms on those pages that send data to `/api/public/leads` with a source like `book.meratutor.ai - maths`.

So: **router** sends traffic to **CRM**; **CRM** serves the pages and stores leads. You need to get both sides right.

---

## Step 1 — Check where book.meratutor.ai points today

1. Open **Vercel**: https://vercel.com and log in.
2. In the dashboard, find the project **meratutor-router** (or the one that has **book.meratutor.ai**).
3. Open it → **Settings** → **Domains**.
4. Check:
   - Is **book.meratutor.ai** listed?
   - Is it the **Production** domain (not Preview)?

Write down:
- [ ] Domain **book.meratutor.ai** is added to the project: **Yes / No**
- [ ] Project name that has this domain: **________________**

---

## Step 2 — Make the router send traffic to the CRM

The router project must have a **vercel.json** that rewrites to your CRM URL.

**2.1 — Find the meratutor-router repo on your PC**

- Where is the **meratutor-router** project folder? (e.g. `E:\meratutor-router` or inside `E:\crm`.)
- If you don’t have it: in Vercel, open **meratutor-router** → **Settings** → **Git** and note the repo (e.g. `github.com/yourname/meratutor-router`). Then clone it:
  - Open PowerShell or Git Bash.
  - `cd` to a folder where you keep projects (e.g. `E:\`).
  - Run: `git clone https://github.com/YOUR_USERNAME/meratutor-router.git`
  - Replace `YOUR_USERNAME` with your GitHub username if needed.

**2.2 — Add or update vercel.json in that repo**

1. Open the **meratutor-router** folder in File Explorer (or in Cursor).
2. In the **root** of that folder (same level as `package.json` if it exists), create or edit a file named **vercel.json** (no other name).
3. Put this **exact** content in it (replace the URL if your CRM is not pipero-in.vercel.app):

```json
{
  "rewrites": [
    { "source": "/maths", "destination": "https://pipero-in.vercel.app/book/maths/" },
    { "source": "/maths/(.*)", "destination": "https://pipero-in.vercel.app/book/maths/$1" },
    { "source": "/maths-2", "destination": "https://pipero-in.vercel.app/book/maths-2/" },
    { "source": "/maths-2/(.*)", "destination": "https://pipero-in.vercel.app/book/maths-2/$1" },
    { "source": "/science", "destination": "https://pipero-in.vercel.app/book/science/" },
    { "source": "/science/(.*)", "destination": "https://pipero-in.vercel.app/book/science/$1" },
    { "source": "/science-2", "destination": "https://pipero-in.vercel.app/book/science-2/" },
    { "source": "/science-2/(.*)", "destination": "https://pipero-in.vercel.app/book/science-2/$1" },
    { "source": "/api/public/leads", "destination": "https://pipero-in.vercel.app/api/public/leads" }
  ]
}
```

- If your CRM is on a **different** Vercel URL (e.g. `pipero.vercel.app`), replace **every** `https://pipero-in.vercel.app` with that URL.
4. Save the file.

**2.3 — Push so Vercel redeploys the router**

1. Open PowerShell or Git Bash and `cd` into the **meratutor-router** folder.
2. Run:
   - `git add vercel.json`
   - `git commit -m "Route book.meratutor.ai to CRM and leads API"`
   - `git push`
3. In Vercel, open **meratutor-router** → **Deployments** and wait until the latest deployment is **Ready**.

Checklist:
- [ ] I have the meratutor-router repo on my PC.
- [ ] vercel.json is in the **root** of that repo with the content above (and correct CRM URL).
- [ ] I ran `git add`, `git commit`, `git push` for meratutor-router.
- [ ] New deployment is **Ready** on Vercel.

---

## Step 3 — Make sure the CRM has the latest code and is deployed

The CRM (this repo, pipero.in) must be deployed with the **book** pages and the **lead form wiring**.

**3.1 — Commit and push the CRM repo (e.g. e:\crm)**

1. Open PowerShell and go to the CRM folder, e.g.:
   - `cd E:\crm`
2. Check status:
   - `git status`
3. Add everything and commit:
   - `git add .`
   - `git commit -m "Book landing pages and lead API wiring for book.meratutor.ai"`
4. Push to GitHub:
   - `git push origin main`
   (Use your branch name if it’s not `main`.)

**3.2 — Check CRM on Vercel**

1. In Vercel, open the **CRM project** (the one linked to the pipero.in / crm repo).
2. Go to **Deployments**.
3. Wait until the latest deployment is **Ready** (it may trigger automatically after `git push`).

Checklist:
- [ ] I ran `git add .` and `git commit` and `git push` in the **CRM** repo (e.g. E:\crm).
- [ ] The CRM project on Vercel shows a new **Ready** deployment.

---

## Step 4 — CRM environment variables (for leads to save)

Leads are stored by the CRM API using Supabase. The CRM project on Vercel needs these env vars (you already use them in `.env.local` locally):

1. In Vercel: open the **CRM** project → **Settings** → **Environment Variables**.
2. Add (or confirm) for **Production** (and **Preview** if you use it):

| Name                         | Value (use your real values) |
|-----------------------------|-------------------------------|
| NEXT_PUBLIC_SUPABASE_URL    | Your Supabase project URL     |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | Your Supabase anon key      |

3. Save.
4. **Redeploy** the CRM once: **Deployments** → ⋯ on latest → **Redeploy**.

Checklist:
- [ ] CRM project has **NEXT_PUBLIC_SUPABASE_URL** and **NEXT_PUBLIC_SUPABASE_ANON_KEY** set.
- [ ] I redeployed the CRM after changing env vars.

---

## Step 5 — Test the full flow

**5.1 — Pages**

Open in a browser (one by one):

- https://book.meratutor.ai/maths  
- https://book.meratutor.ai/maths-2  
- https://book.meratutor.ai/science  
- https://book.meratutor.ai/science-2  

For each:
- [ ] The page loads (no 404).
- [ ] Styles and images look correct.

**5.2 — Lead → CRM**

1. Pick one page, e.g. https://book.meratutor.ai/maths .
2. Fill the form (e.g. student name, parent phone, grade, date, time).
3. Submit (e.g. “Book your free demo”).
4. You should get redirected to a success page.
5. In the **CRM** (pipero.in app):
   - Log in.
   - Open **Leads** (or the list where leads appear).
   - Find the lead you just submitted (by name or phone).
   - Check that **Source** is something like **book.meratutor.ai - maths**.

Checklist:
- [ ] I submitted a test lead on one of the 4 pages.
- [ ] I see that lead in the CRM with the correct source (e.g. book.meratutor.ai - maths).

---

## If something doesn’t work

**book.meratutor.ai/maths (or others) shows 404**

- Router’s **vercel.json** might not be in the repo root, or the CRM URL in it might be wrong.
- Confirm the **CRM** URL: open the CRM project in Vercel → **Deployments** → open the latest deployment → copy the **Production** URL (e.g. pipero-in.vercel.app). Use that in **vercel.json** and push again.

**Page loads but form submit doesn’t create a lead**

- CRM might be missing env vars (Step 4) or the latest deploy might not be live.
- In the CRM project, check **Deployments** → latest → **Build Logs** for errors.
- Try opening the CRM’s lead API directly in the browser (you’ll get “Method Not Allowed” for GET, which is fine):  
  `https://YOUR_CRM_URL/api/public/leads`  
  Replace YOUR_CRM_URL with your real CRM domain (e.g. pipero-in.vercel.app).

**I don’t have the meratutor-router repo**

- Create a new repo on GitHub named `meratutor-router`.
- Locally create a folder `meratutor-router`, put only **vercel.json** (from Step 2.2) in it.
- Run:  
  `git init`  
  `git add vercel.json`  
  `git commit -m "Add rewrites for book.meratutor.ai"`  
  `git remote add origin https://github.com/YOUR_USERNAME/meratutor-router.git`  
  `git push -u origin main`
- In Vercel: **Add New Project** → **Import** that repo → add domain **book.meratutor.ai** in **Settings** → **Domains**.

---

## Quick reference

| What                    | Where / URL |
|-------------------------|------------|
| Router project (Vercel)| meratutor-router, domain book.meratutor.ai |
| CRM project (Vercel)    | Your Pipero/CRM project (e.g. pipero-in.vercel.app) |
| Router config           | Repo **meratutor-router**, file **vercel.json** in root |
| Book pages in code      | CRM repo, folder **public/book/** (maths, maths-2, science, science-2) |
| Lead API                | CRM: **/api/public/leads** (used via book.meratutor.ai when router is set up) |

Do the steps in order, tick the checkboxes, and if something fails tell me which step and what you see (e.g. 404, blank page, no lead in CRM). Then we can fix that exact part.
