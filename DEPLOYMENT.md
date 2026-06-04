# TyrePulse — Full Deployment Guide
**Readymix Concrete Company · Built by Shahzeb Rahman © 2026**

---

## What This App Is

TyrePulse is a **React + Supabase** tyre fleet management system.

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, Tailwind CSS (dark theme) |
| Backend / Database | Supabase (PostgreSQL, Auth, Row-Level Security) |
| File Storage | Supabase Storage (tyre photos) |
| Charts | Chart.js v4 + react-chartjs-2 |
| Exports | xlsx (Excel), jsPDF + autoTable (PDF), pptxgenjs (PowerPoint) |
| Hosting | Vercel (recommended) or Netlify |

No server to manage. No Docker. Supabase is the entire backend.

---

## Prerequisites

Install these on your machine before starting:

- **Node.js** v18 or later → https://nodejs.org
- **npm** v9+ (comes with Node)
- **Git** (to clone the repo)
- A **Supabase account** (free tier is fine) → https://supabase.com
- A **Vercel account** (free tier is fine) → https://vercel.com  
  *(or Netlify → https://netlify.com — instructions below)*

---

## PART 1 — SUPABASE BACKEND SETUP

### Step 1.1 — Create a Supabase Project

1. Go to https://supabase.com → **New Project**
2. Choose your organisation
3. **Project name:** `TyrePulse` (or anything you like)
4. **Database password:** Set a strong password and save it somewhere safe
5. **Region:** Choose the closest to Saudi Arabia → `ap-southeast-1` (Singapore) or `eu-central-1` (Frankfurt)
6. Click **Create new project** — wait 1–2 minutes for it to spin up

---

### Step 1.2 — Run the Main Database Schema

1. In your Supabase dashboard → click **SQL Editor** (left sidebar)
2. Click **New Query**
3. Open the file `SUPABASE_SCHEMA.sql` from this repo
4. Copy the entire contents → paste into the SQL editor
5. Click **Run** (green button)
6. You should see: `Success. No rows returned`

This creates all the main tables:
- `profiles` (user accounts)
- `tyre_records` (all tyre data)
- `stock_records` (stock levels per site)
- `budgets` (monthly budget per site)
- `corrective_actions`
- `rca_records` (root cause analysis)
- `upload_history`
- `column_mappings` (remembers your Excel column headers)
- `cleaning_log`
- `settings`

---

### Step 1.3 — Run the Phase 2 Migrations

1. In SQL Editor → **New Query**
2. Open `MIGRATIONS.sql` from this repo
3. Copy entire contents → paste → **Run**

This adds:
- `due_date` column on `corrective_actions`
- `inspections` table (schedule/track tyre inspections)
- `stock_movements` table (log every stock change)
- `audit_log` table
- `kpi_targets` table (your monthly KPI goals)
- Extra indexes for faster analytics queries

---

### Step 1.4 — Enable Role-Based Access Control (RLS)

This step enforces which roles (Admin / Manager / Reporter / Director) can read, write, update, and delete each table. **Run this after the previous two SQL files.**

1. In SQL Editor → **New Query**
2. Open `BACKEND_RLS.sql` from this repo
3. Copy entire contents → paste → **Run**

This creates a `get_my_role()` helper function and replaces the permissive "full access" policies with role-specific ones across all 14 tables.

| Role | What they can do |
|---|---|
| **Admin** | Full access — read, write, update, delete everything |
| **Manager** | Read everything; edit records, close actions, manage stock / KPI targets |
| **Director** | Read-only across all tables |
| **Reporter** | Read everything; can upload data and log corrective actions; cannot delete |

> After running this file, only Admin users can change Settings or delete records. New accounts default to Reporter — promote them via the `profiles` table.

---

### Step 1.5 — Set Up Photo Storage

1. In Supabase dashboard → **Storage** (left sidebar)
2. Click **New bucket**
3. **Bucket name:** `tyre-photos`
4. Toggle **Public bucket:** ON
5. Click **Save**
6. In SQL Editor → run these three lines:

```sql
insert into storage.buckets (id, name, public)
values ('tyre-photos', 'tyre-photos', true)
on conflict do nothing;

create policy "Auth upload" on storage.objects
for insert with check (
  auth.role() = 'authenticated' and bucket_id = 'tyre-photos'
);

create policy "Public read" on storage.objects
for select using (bucket_id = 'tyre-photos');
```

---

### Step 1.6 — Get Your API Keys

1. Supabase dashboard → **Settings** (gear icon, bottom left)
2. Click **API**
3. Copy two values — you'll need them in the next step:
   - **Project URL** — looks like `https://abcdefghijkl.supabase.co`
   - **anon public** key — a long JWT string starting with `eyJ...`

> ⚠️ Never share the `service_role` key. Only use the `anon` key in the frontend.

---

### Step 1.7 — Configure Authentication Settings

1. Supabase dashboard → **Authentication** → **Providers**
2. **Email** provider → make sure it is **Enabled**
3. Toggle **Confirm email** ON (users get a confirmation email before they can log in)
4. (Optional) If you want to skip email confirmation during testing:
   - Authentication → Settings → **Disable email confirmations** → toggle ON temporarily

---

## PART 2 — FRONTEND SETUP

### Step 2.1 — Clone and Install

```bash
# Clone the repository
git clone https://github.com/shahzebs-library/tyre_pulse.git
cd tyre_pulse

# Install all dependencies
npm install
```

---

### Step 2.2 — Create Your Environment File

```bash
# Copy the example file
cp .env.example .env
```

Open `.env` in any text editor and fill in your keys from Step 1.6:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

> The `.env` file is listed in `.gitignore` — it will never be committed to Git.

---

### Step 2.3 — Test Locally

```bash
npm run dev
```

Open http://localhost:5173 in your browser. You should see the TyrePulse login screen.

**First login:** go to the Sign In tab → click "Create Account" → fill in your details. Your first account will have **Reporter** role. You can promote it to **Admin** in Supabase (see Step 3.3 below).

---

### Step 2.4 — Build for Production

```bash
npm run build
```

This creates a `dist/` folder with the optimised static files. You never need to run a Node server — these are just HTML/JS/CSS files that any static host can serve.

---

## PART 3 — DEPLOYING TO VERCEL (Recommended)

Vercel is the easiest option. Free tier handles this app's traffic easily.

### Option A — Deploy via Vercel CLI

```bash
# Install Vercel CLI globally (one-time)
npm install -g vercel

# Inside the project folder
vercel

# Follow prompts:
# ? Set up and deploy? → Yes
# ? Which scope? → your account
# ? Link to existing project? → No
# ? Project name? → tyrepulse (or anything)
# ? In which directory is your code? → ./ (press Enter)
# ? Want to modify settings? → No

# For production deploy:
vercel --prod
```

### Option B — Deploy via Vercel Dashboard (no CLI)

1. Go to https://vercel.com → **Add New Project**
2. Connect your GitHub account → select the `tyre_pulse` repository
3. Vercel auto-detects Vite → Framework Preset: **Vite**
4. Build Command: `npm run build`
5. Output Directory: `dist`
6. Click **Environment Variables** → add:
   - `VITE_SUPABASE_URL` → your Supabase URL
   - `VITE_SUPABASE_ANON_KEY` → your anon key
7. Click **Deploy**

Vercel gives you a URL like `https://tyrepulse-xyz.vercel.app`. Every time you push to `main`, it re-deploys automatically.

---

## PART 3B — DEPLOYING TO NETLIFY (Alternative)

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Build first
npm run build

# Deploy
netlify deploy --prod --dir=dist
```

Or via Netlify dashboard:
1. netlify.com → **Add new site** → **Import from Git**
2. Connect repo → Build command: `npm run build` → Publish directory: `dist`
3. Site settings → **Environment variables** → add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
4. **Deploy site**

---

## PART 4 — POST-DEPLOYMENT CHECKLIST

After your site is live, do these steps in order:

### ✅ 4.1 — Create Your Admin Account

1. Go to your live URL → **Create Account** tab
2. Sign up with your email
3. Check email → confirm your address
4. Log in — you'll have **Reporter** role initially

### ✅ 4.2 — Promote Yourself to Admin

1. Supabase dashboard → **Table Editor** → `profiles` table
2. Find your row → click **Edit**
3. Change `role` from `Reporter` to `Admin`
4. Save

### ✅ 4.3 — Configure Default Settings

1. Log into TyrePulse → go to **Settings** page
2. Confirm:
   - **Company Name:** Readymix Concrete Company
   - **Default Region:** KSA
   - **Currency:** SAR
   - **Default Cost per Tyre:** 1200 (or your standard price)

### ✅ 4.4 — Set KPI Targets

1. Go to **KPI Scorecard** page
2. Click **Edit Targets**
3. Set your monthly targets:
   - Max Monthly Cost (SAR)
   - Max High-Risk % (recommended: 20%)
   - Max Overdue Actions
   - Max Avg Cost / Tyre
4. Click **Save Targets**

### ✅ 4.5 — Test Upload

1. Go to **Upload Data**
2. Upload a small test Excel file (even 5 rows)
3. Map the columns → confirm
4. Check **Tyre Records** to see the data

### ✅ 4.6 — Run First Anomaly Scan

1. Go to **Anomaly Detection**
2. Click **Run Scan**
3. Review any flagged records

---

## PART 5 — ADDING MORE USERS

### Invite Method (Recommended)

In Supabase dashboard → **Authentication** → **Users** → **Invite User** → enter email. They get a link to set a password. After they log in, go to `profiles` table and set their role.

### Self-Registration

Users can register themselves via the **Create Account** tab on the login page. All new accounts default to **Reporter** role. Promote them in the `profiles` table.

### Roles and What They Can Do

| Role | Description |
|---|---|
| **Admin** | Full access, can change settings |
| **Manager** | Full data access, can approve/close actions |
| **Director** | Read-only analytics and reports |
| **Reporter** | Upload data, log corrective actions |

> Role enforcement is currently display-level. Full RLS role enforcement can be added by updating the Supabase policies.

---

## PART 6 — KEEPING DATA SAFE

### Automatic Backups

Supabase Pro plan includes daily backups. On the free tier:
- Export data regularly: in each page, use the **Excel export** buttons
- Or use Supabase Dashboard → **Database** → **Backups**

### Supabase Free Tier Limits

| Resource | Free Tier Limit |
|---|---|
| Database size | 500 MB |
| API requests | 2 million / month |
| Storage | 1 GB |
| Auth users | Unlimited |

For Readymix fleet size this is more than enough. Upgrade to Pro ($25/mo) only if you exceed 500 MB data.

---

## PART 7 — CUSTOM DOMAIN (Optional)

### On Vercel:
1. Vercel dashboard → your project → **Settings** → **Domains**
2. Add your domain: e.g. `tyrepulse.readymix.com.sa`
3. Add a CNAME record in your DNS: `tyrepulse` → `cname.vercel-dns.com`

### On Netlify:
1. Netlify dashboard → your site → **Domain management** → **Add domain**
2. Follow the DNS instructions

---

## PART 8 — LOCAL DEVELOPMENT REFERENCE

```bash
# Start dev server (hot reload)
npm run dev
# → http://localhost:5173

# Build for production
npm run build
# → output in dist/

# Preview the production build locally
npm run preview
# → http://localhost:4173
```

---

## PART 9 — PROJECT STRUCTURE

```
tyre_pulse/
├── SUPABASE_SCHEMA.sql     ← Run this FIRST in Supabase SQL Editor
├── MIGRATIONS.sql          ← Run this SECOND (Phase 2 tables)
├── BACKEND_RLS.sql         ← Run this THIRD (role-based access control)
├── .env.example            ← Copy to .env and fill in your keys
├── index.html
├── vite.config.js
├── tailwind.config.js
├── src/
│   ├── App.jsx             ← All routes defined here
│   ├── main.jsx
│   ├── contexts/
│   │   └── AuthContext.jsx ← Supabase auth state
│   ├── components/
│   │   ├── Layout.jsx      ← Sidebar, global search (Cmd+K), alert badge
│   │   └── ProtectedRoute.jsx
│   ├── lib/
│   │   ├── supabase.js         ← Supabase client (reads .env)
│   │   ├── tyreClassifier.js   ← Rule-based classification engine
│   │   ├── analyticsEngine.js  ← Stats, regression, aggregations
│   │   ├── alertEngine.js      ← Real-time alert detection
│   │   ├── anomalyEngine.js    ← Anomaly / suspicious pattern detection
│   │   └── exportUtils.js      ← Excel, PDF, PowerPoint export
│   └── pages/
│       ├── Login.jsx
│       ├── Dashboard.jsx
│       ├── TyreRecords.jsx
│       ├── Analytics.jsx        ← Cost by site/brand, monthly trend
│       ├── BrandPerformance.jsx ← Brand ranking, failure rate
│       ├── SiteComparison.jsx   ← Multi-site radar + head-to-head
│       ├── FleetAnalytics.jsx   ← Per-asset history, lifecycle
│       ├── KpiScorecard.jsx     ← Targets vs actuals, forecasting
│       ├── StockManagement.jsx  ← Stock levels, movement history
│       ├── Budgets.jsx          ← Monthly + annual planner
│       ├── CorrectiveActions.jsx
│       ├── RcaRecords.jsx
│       ├── Inspections.jsx
│       ├── Alerts.jsx           ← Live alert feed
│       ├── Anomalies.jsx        ← Suspicious pattern scan
│       ├── DataCleaning.jsx
│       ├── UploadData.jsx
│       └── Settings.jsx
```

---

## PART 10 — TROUBLESHOOTING

### "Invalid API key" or blank screen after login

- Check your `.env` file has the correct `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
- Make sure there are no spaces around the `=` sign
- On Vercel/Netlify: check the environment variables are saved in the dashboard, then **redeploy**

### "relation does not exist" database error

- You haven't run `MIGRATIONS.sql` yet — do Step 1.3
- Or the table name has a typo — check Supabase → Table Editor

### Email confirmation not arriving

- Check spam folder
- In Supabase → Authentication → Settings → disable email confirmation temporarily for testing

### Charts not rendering

- This is usually a React state issue. Hard refresh the page (Ctrl+Shift+R / Cmd+Shift+R)
- If persistent, check browser console for errors

### Excel upload not mapping columns

- Column mapping uses header names. Accepted names for each field are in `src/lib/tyreClassifier.js`
- On first upload, map manually — the app remembers for next time (stored in `column_mappings` table)

### "Row level security" policy error

- Run `BACKEND_RLS.sql` — this replaces the permissive default policies with role-based ones
- Make sure you're logged in (authenticated) before accessing data

---

## PART 11 — ENVIRONMENT VARIABLES REFERENCE

| Variable | Where to find it | Example |
|---|---|---|
| `VITE_SUPABASE_URL` | Supabase → Settings → API → Project URL | `https://abcd1234.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Supabase → Settings → API → anon public | `eyJhbGciOiJ...` |

These are the **only** two variables the app needs. There is no separate backend server, no database connection string — Supabase handles all of that through its API.

---

## PART 12 — UPDATING THE APP

When new code is pushed to the `main` branch (or `claude/todo-implementation-bYKx5`):

```bash
git pull origin main

# If new dependencies were added:
npm install

# Test locally:
npm run dev

# Deploy:
vercel --prod
# or: git push (if Vercel is connected to GitHub, it deploys automatically)
```

If new SQL migrations are needed, they will be in `MIGRATIONS.sql` — run only the new sections in Supabase SQL Editor.

---

*TyrePulse v2.0 · Built by Shahzeb Rahman © 2026*
