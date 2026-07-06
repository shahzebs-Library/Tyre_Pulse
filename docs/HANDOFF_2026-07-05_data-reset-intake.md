# Handoff — Data Reset, Intake Templates & Crash Fixes (2026-07-05)

**Production:** https://tyrepulse.app · **main @ `009a403`** deployed READY on Vercel.
**Supabase:** `jhssdmeruxtrlqnwfksc` · live schema through migration **V93**.

---

## 1. What shipped to production (main)

### a. Intake page crash — FIXED (the reported "intake not working")
Root cause: the i18n + PeriodFilter refactors renamed module-level constants but
left dangling references. These pass `esbuild` and JSON-parity checks (they only
fail at **render**), so they slipped the gate and crashed pages on load.

A full `no-undef` ESLint sweep across `src/` found **three**:
| Page | Bug | Fix |
|---|---|---|
| DataIntakeCenter | `STEPS is not defined` (stepper) — crashed the page you reported | `STEPS` → `STEP_KEYS`, labels via `t('intake.steps.*')` |
| DataCompletenessPanel | `TYRE_FIELDS` (renamed to flat `TYRE_FIELD_KEYS`) | fixed reference + `.filter((k)=>…)` |
| ExecutiveReport | `PERIODS` leftover from PeriodFilter migration | → `periodValueLabel(period)` |

Commit `009a403`. Build + 879 tests green. Also cherry-picked onto the pending
i18n branch (`a51b7aa`) so that branch isn't broken when resumed.

> **Only PWA globals** (`caches`, `indexedDB`) remain flagged by the sweep — those
> are legitimate. No other undefined-reference crashes exist in `src/`.

### b. Downloadable CSV import templates + live column guide
Commit `0ccded1`. In **Data Intake → step 1**, each module now has a
**Download CSV** button + an expandable column reference (required vs optional,
type). Templates are generated live from the `MODULE_FIELDS` registry, so headers
**auto-map at 100%** — no manual mapping needed.
- Code: `src/lib/import/templates.js`, `src/components/intake/ImportTemplatePanel.jsx`
- Files: `public/templates/{tyre,fleet,stock}_import_template.csv`, `docs/DATA_COLUMN_GUIDE.md`

### c. V93 — 50k+ row imports (shipped earlier this session)
`import_commit_batch` / `import_enrich_batch` now chunk server-side; the client
loops with a progress bar. See `MIGRATIONS_V93_CHUNKED_COMMIT_50K.sql`.

---

## 2. Data wipe — DONE (user-confirmed clean slate)

All operational data removed via the MCP SQL layer (one transaction, audit
trigger `trg_inspection_audit` temporarily disabled to avoid a self-referential
FK on delete, then re-enabled — verified state `O`).

| Table | Before | After |
|---|---|---|
| tyre_records | 2,383 | 0 |
| vehicles | 162 | 0 |
| inspections | 1 | 0 |
| corrective_actions | 3 | 0 |
| work_orders | 1 | 0 |
| import_batches (+rows/sheets/matches) | 1 | 0 |
| cleaning_log | 11 | 0 |
| alerts / tyre_disposals | 0 | 0 |

**Preserved:** 2 users, 4 organisations, settings, branding, roles, alias &
currency config. FK children cascaded correctly.

---

## 3. How to re-upload for 100% data completeness

1. Data Intake → pick module (Tyre or Fleet) → **Download CSV**.
2. Paste your ERP export into the template columns (order doesn't matter; blanks
   OK; extra columns are preserved as custom fields).
3. **To fill the analytics that were empty before**, make sure these columns have
   values: **Brand, Site, Position, KM at Fitment, KM at Removal**.
4. **Cost:** fill **Unit Cost / Tyre** (per-tyre) OR **Total Amount** (line total
   as ERP gives — auto-divided by Quantity). Not both.
5. Upload → map (auto) → validate → **Approve & commit**. 50k+ rows are fine.

Full column list: `docs/DATA_COLUMN_GUIDE.md` (24 tyre fields, 16 fleet fields).

---

## 4. Branch state

| Branch | State | Contents |
|---|---|---|
| `main` | **live** | V93 + i18n wave 1/2 (52 pages) + template feature + crash fixes |
| `claude/data-reset-intake-template` | = main (`009a403`) | this session's work branch |
| `claude/mobile-app-ui-features-tdfxy0` | **PENDING** (not merged) | full i18n sweep + crash-fix cherry-pick (`a51b7aa`); resume per `docs/I18N_ARABIC_SWEEP_STATUS.md` |

---

## 5. Open items (owner action)

- **Arabic i18n**: ~30 pages still English-only (safe — they fall back to English).
  Resume from the pending branch using `docs/I18N_SWEEP_SPEC.md`.
- **Recommended guard**: add a repo ESLint flat config with `no-undef` (+ run in
  the SessionStart hook / CI). It would have caught all three crashes pre-deploy.
  Not yet added — the sweep was run ad-hoc this session.
- Email digest secrets + `supabase functions deploy send-scheduled-reports`.
- Delete 24 stale remote branches (token lacks ref-delete permission).
