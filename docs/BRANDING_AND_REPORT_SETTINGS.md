# Branding & Report Settings

How TyrePulse applies each tenant's identity to the app and to every generated
report, and how the Report Center produces and tracks those reports.

_Last updated: 2026-07-03 · migrations through V68 · Master Build Phases A/B/C/D._

---

## 1. Data model (V68)

Branding is stored per organisation in `organisations.settings->'branding'`
(JSONB). No new table — it rides the existing `organisations` row and inherits
its RLS. Top-level `organisations.logo_url` and `contact_email` are mirrored
from the branding block for backward compatibility.

| Key               | Type              | Purpose                                            |
|-------------------|-------------------|----------------------------------------------------|
| `legal_name`      | text              | Registered entity — report cover & footer          |
| `display_name`    | text              | Short brand name — app header                       |
| `primary_color`   | `#RRGGBB`         | Main accent (report headers, cover bar, KPIs)      |
| `secondary_color` | `#RRGGBB`         | Secondary accent                                    |
| `accent_color`    | `#RRGGBB`         | Highlight accent                                    |
| `logo_url`        | text              | Public/signed image URL, stamped on report covers  |
| `report_theme`    | `light` \| `dark` | Report cover theme                                  |
| `footer_text`     | text              | Report footer line                                  |
| `disclaimer`      | text              | Legal disclaimer (report cover)                    |
| `address`         | text              | Contact block                                       |
| `contact_email`   | text              | Contact block (mirrored to column)                 |
| `contact_phone`   | text              | Contact block                                       |
| `website`         | text              | Contact block                                       |
| `updated_at`      | timestamptz       | Server-stamped on save                              |
| `updated_by`      | uuid              | Server-stamped (`auth.uid()`)                       |

## 2. Server RPCs

Both are `SECURITY DEFINER`, `search_path=public`, `authenticated`-only
(`anon` EXECUTE revoked).

- **`get_org_branding(p_org_id uuid default null)` → jsonb**
  Returns the merged branding for an org (defaults to the caller's own org).
  A non-admin may only read their own org; an org admin / super admin may read
  any. The `IS DISTINCT FROM app_current_org()` guard means a null-org / anon
  caller can never read another org.

- **`set_org_branding(p_org_id uuid, p_branding jsonb)` → jsonb**
  Gated to `app_is_org_admin()` (super admin **or** Admin) and
  `is_approved_and_unlocked()`. Validates colours (`#RRGGBB`) and theme
  (`light`/`dark`), **whitelists** the allowed keys (unknown keys dropped),
  stamps `updated_at`/`updated_by`, mirrors `logo_url`/`contact_email` to the
  columns, and writes an audit event via `record_audit_event`. Returns the
  merged branding.

Validation, whitelisting, and merge are proven by a rolled-back self-asserting
SQL test.

## 3. Frontend wiring

- **`src/lib/api/branding.js`** — `getOrgBranding` / `setOrgBranding` /
  `withBrandingDefaults` / `DEFAULT_BRANDING` / `BRANDING_FIELDS`. The single
  Supabase boundary; 5 unit tests cover whitelist/trim/defaults/error mapping.
- **`src/contexts/TenantContext.jsx`** — loads the caller's branding once per
  session, exposes `{ branding, orgId, orgName, loading, error, refreshBranding }`,
  publishes `--brand-primary` / `--brand-accent` CSS variables (opt-in; never
  overrides the global theme), and always falls back to defaults so a load
  failure never blocks the app. Mounted in `App.jsx` inside `SettingsProvider`.
- **`src/components/OrgBrandingPanel.jsx`** — admin editor with an org selector
  (super admin / Admin), colour pickers, logo/text fields, report-theme toggle,
  and a live report-cover preview. Saves through `set_org_branding` and calls
  `refreshBranding()`. Surfaced as **User Management → Branding**. Non-admins
  see it read-only.

## 4. Branded report engine (`src/lib/exportUtils.js`)

The executive generators consume the branding object passed on their `data`:

- **`exportToPptx`** — primary/accent from `primary_color`/`accent_color`, logo
  on the cover slide, `footer_text` in the footer, `disclaimer` on the cover.
- **`exportDailyExecutivePdf`** — primary colour drives the header accent bar
  and cover triangles, logo on the cover, `footer_text` in the footer.
- **`exportToPdf` / `exportToExcel`** — carry the tenant legal/brand name in the
  `company` field / metadata sheet.

Safe helpers: `brandHex` (→ 6-hex), `hexToRgb` (→ jsPDF RGB), and
`fetchImageDataUri` (URL → base64 data URI, ≤2 MB, CORS + image-type guarded,
returns `null` on any failure). **A missing, blocked, or oversized logo never
breaks report generation** — the report falls back to the base design.

## 5. Report Center (`/report-center`)

A single page to generate branded reports on demand and review scheduled
deliveries:

- **Branding banner** — shows the active identity (logo, name) with a shortcut
  to the Branding editor.
- **Filters** — date range; honours the global country scope + currency.
- **Generate cards** — Executive PowerPoint, Daily Executive PDF, Tyre Records
  (Excel), Tyre Records (PDF). Each disables during build, shows a spinner, and
  reports success/failure via a toast (never a silent dead button).
- **Automated delivery** — shortcut to `/scheduled-reports`.
- **Delivery History** — the last 50 rows of `report_send_log` (schedule, type,
  recipients, status, error) with loading / error / empty states.

## 6. Operator guide

1. **User Management → Branding**: pick the organisation, set the legal + brand
   name, brand colours, logo URL, report theme, footer, disclaimer, and contact
   block. Save.
2. Open **Report Center**, choose a date range, and click **Generate** on any
   report — the downloaded file carries the branding just set.
3. For recurring email delivery, use **Scheduled Reports** (requires the
   `RESEND_API_KEY` edge-function secret to be set by the owner).

## 7. Security notes

- Branding writes are server-authoritative and org-admin-gated; the browser
  never writes `organisations` directly.
- Reads are org-scoped for non-admins.
- Logo URLs are rendered as images and embedded into reports client-side; only
  `image/*` responses ≤2 MB are accepted, and failures degrade silently.
