# Tyre Pulse — Operations & Feature Guide

A practical guide to running Tyre Pulse: how countries keep data separated, how
to upload any spreadsheet, what each role can do, and how every module works.

---

## 1. Core concept — Countries keep data separated

**One rule: the country decides who owns the data.**

- Every record carries a `country` (KSA, UAE, etc.).
- You **never** add a country column to your files and you **never** tag rows by
  hand. The system stamps it for you:
  - **Web upload** → stamped with the country selected in the **top bar**.
  - **Mobile** → stamped with the logged-in user's **profile country** (set by
    an admin).
- **Viewing**: when a country is selected, you see that country's data plus any
  older uncategorised rows (so nothing ever disappears). Switch the bar and you
  see only that country.

### Keeping Saudi and UAE separate (example)
1. Top bar → **KSA** → upload all Saudi files.
2. Top bar → **UAE** → upload all UAE files.
3. Done. No country column, no manual tagging, no mixing.

> Uploading is **blocked when the top bar shows "All"** — you must pick a real
> country first. This is the safeguard that makes mixing impossible.

---

## 2. Uploading data (any Excel / CSV)

Supported: `.xlsx .xls .xlsm .xlsb .ods .csv .tsv .txt`

### What happens, step by step
1. **Drop the file.** If a file is mislabelled (a `.csv` that is really Excel, or
   an odd encoding), it auto-tries the other format. If it genuinely cannot be
   read, you get a clear message — never a frozen screen.
2. **Multiple sheets** → pick which tabs to import. Pivot/summary tabs are
   flagged "looks like a pivot" and pre-skipped. If only one tab has data, this
   step is skipped automatically.
3. **Smart header detection** → ERP exports often start with title/logo rows.
   The true header row is found automatically. If it guesses wrong, the **raw
   preview** lets you click the correct header row and it re-maps instantly.
4. **Smart column mapping** → your column names are matched to system fields
   (issue date, brand, serial, asset, cost, site, …) across hundreds of
   variations, abbreviations, and **Arabic** headers. Mappings are remembered
   per file layout, so the next matching file maps itself. You can override any
   mapping by hand.
5. **Quality check** → before import you see each field's **% filled**, **invalid
   values**, and **in-file duplicates**, with a warning if a required field is
   under 50% filled (usually a wrong header row or mapping).
6. **Auto-classification** → each row is categorised and risk-scored (rule-based;
   optional AI pass for low-confidence rows).
7. **Country stamp** → every row tagged with the selected country.
8. **De-dupe** → re-uploading the same file is detected ("data you've already
   uploaded — N matching records"); skip duplicates so records never double.

### Upload tips
- Pick the **country first**, then upload.
- Upload the **vehicle/asset list** before tyre records so assets resolve.
- If a required field reads low, fix the **header row** or **mapping** before
  importing.

---

## 3. Roles & access (RBAC)

Roles are assigned by an **admin** in **Admin → Users**. Access is least-privilege
and enforced in the database, not just the UI.

| Role | Typical use | Tyre records | Notes |
|------|-------------|--------------|-------|
| **Admin** | Full control | Create / edit / delete | User management, deletes, all modules |
| **Manager** | Site/fleet management | Create / edit | No hard deletes |
| **Director** | Executive oversight | Read-only | Dashboards, reports, analytics |
| **Inspector** | Field inspections | — | Creates inspections |
| **Tyre Man** | Workshop / fittings | Create | Records tyre changes |
| **Reporter** | Data entry | Create | Logs records |

- **Approval gate**: a new account cannot use the app until an admin approves it.
- **Lock/revoke**: an admin can lock an account; locked users are blocked from
  everything (including writes) instantly.
- **Country**: each user's country controls what they see and what their
  mobile-created records are stamped with.

---

## 4. Web modules

Every screen has real data, search, filters, actions, and loading/empty/error
states.

- **Dashboard** — fleet KPIs, risk breakdown, cost, top sites/brands, monthly
  trend. Country-aware and refreshes with new data.
- **Tyre Records** — full records with search/filter, bulk **Scrap**, export.
- **Upload Data** — the importer described in section 2.
- **Inspections / Inspection Planner / Inspection Intelligence** — schedule,
  record, and analyse inspections; inspector quality scoring; data-quality flags.
- **Pressure Intelligence** — pressure compliance, under/over-inflation, by site.
- **Accidents** — incident logging, claims, recovery tracking, parts, audit of
  who-changed-what, net cost after recovery.
- **Work Orders / Workshop Management** — jobs, technicians, labour/parts cost.
- **Safety & Compliance** — compliance scoring across tyres, inspections,
  accidents.
- **Reports / Executive Report** — country- and period-correct reports; export to
  **PDF / Excel / PowerPoint** (charts are native and editable).
- **Predictive / Forecasting / Fleet Intelligence** — replacement and budget
  forecasting, fleet odometer and registration.
- **Budgets / Purchase Orders / Stock** — planning, procurement, inventory.
- **Audit Trail** — immutable record of changes (management/admin view).
- **AI Command Center** — natural-language questions answered from your data
  using retrieval (no full-data dumps).

---

## 5. Mobile app

Role-adaptive home screen — each user sees only what their role allows.

- **Create**: tyre change, inspection (with per-tyre photos), accident report,
  issue/corrective action, RCA, work order. All auto-stamped with the user's
  country.
- **Offline**: records created without signal are queued and sync automatically
  when back online.
- **Realtime**: lists update live; tab badges show open accidents and pending
  tasks/alerts.
- **Access gate**: not-yet-approved or locked accounts see a clear message and
  cannot proceed until an admin grants access.
- **Localization**: full Arabic support including right-to-left layout.

---

## 6. Clean-slate test flow (recommended first run)

1. **Admin → Users** — give every user a **country**.
2. Top bar → **KSA**:
   - Upload your **vehicle/asset list**.
   - Upload your **tyre records**.
3. Top bar → **UAE** — repeat with UAE files.
4. **Mobile** — log in as a KSA user and create a tyre change / inspection /
   accident; confirm it appears under KSA only.
5. Check **Dashboard**, **Reports**, and the **PowerPoint export** populate with
   that country's data.

> The database was wiped to a clean slate (no demo data). Users, organisations,
> settings, and saved column mappings were kept.

---

## 7. Data integrity guarantees

- **No country mixing** — country is stamped by the system, never by the file.
- **No duplicates** — re-uploads are detected and can be skipped.
- **Least privilege** — every write is checked by role in the database.
- **Immutable audit** — changes are logged and cannot be edited away.
- **Null-safe views** — uncategorised legacy rows never silently disappear.

---

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Upload button does nothing on "All" | Country safeguard | Pick a specific country in the top bar |
| "Could not read this file…" | Unreadable/locked/corrupt file | Close it in Excel, or re-save as `.xlsx`/`.csv` |
| Wrong columns mapped | Header row mis-detected | Use the raw preview to pick the correct header row |
| A required field reads low % | Mapping or header issue | Re-map the field or fix the header row |
| A user can't see data | No country on their profile, or not approved | Admin sets country / approves in Admin → Users |
| New record not visible | Different country selected | Switch the top bar to that country |

---

*Built for production: scalable, secure, multi-country, and audit-ready.*
