# TyrePulse Arabic i18n sweep — per-page wiring spec

Repo: /home/user/Tyre_Pulse (Vite + React 19). Languages: English (en) + Arabic (ar, RTL). NO other languages.

## Infrastructure (already exists — do NOT modify)
- `src/contexts/LanguageContext.jsx` eagerly loads every `src/locales/<lang>/<ns>.json`; the file basename is the namespace. `t('ns.path.to.key', {vars})` resolves, falls back to English, then to the key itself. Arabic auto-sets `dir="rtl"` on the document — never add manual RTL handling.
- Interpolation: `"subtitle": "{count} total records"` → `t('records.subtitle', { count: n })`.

## Per page assigned to you
1. Create `src/locales/en/<ns>.json` AND `src/locales/ar/<ns>.json` with IDENTICAL key structure (namespace assigned in your task; must not collide with existing: alerts, auth, common, dashboard, inspections, nav, onboarding, pwa, records, roles, scan, shell, ui, workorders — plus the ones other agents own).
2. Wire the page:
   - `import { useLanguage } from '../contexts/LanguageContext'`
   - `const { t } = useLanguage()` inside the component (each subcomponent in the file that renders text calls `useLanguage()` itself — hooks can't run at module level).
   - Replace user-facing strings with `t('<ns>.key')`.

## What to translate (aim for complete page chrome)
- Page title, subtitle, section headings, tab labels
- Buttons, action menus, tooltips (title=), aria-labels
- Search placeholders, filter placeholders/labels
- Table column headers
- KPI/stat card labels, chart titles and axis/series LABELS (only plain UI strings — do not restructure chart configs)
- Modal/form field labels, validation messages
- Loading / error / empty states, confirmation dialogs (`window.confirm`), toasts/banners

## What NOT to translate — leave exactly as-is
- Filter/option VALUES that match database values (translate the visible label only when it's a UI word like "All Sites"; never change the `value` used in queries/comparisons)
- Data from the DB (site names, brands, serials, statuses stored in rows) — render as-is
- Strings inside PDF/Excel/PPTX EXPORT builder functions (exports stay English for now)
- console.*, comments, keys, CSS classes, routes
- Technical tokens: keep CPK, MIS, KM, PDF, QR in Latin where natural; established Arabic style: CPK → "التكلفة/كم", "N/A" → "غير متاح"

## Module-level constant arrays with labels
Constants defined outside the component can't call hooks. Keep the constant with a stable `key`/`value` field and translate at render: `t(`<ns>.tabs.${tab.key}`)`. Do not move large constants inside components.

## Arabic quality
Professional fleet/tyre-engineering vocabulary (سجلات الإطارات، الأسطول، الموقع، العلامة التجارية، مستوى الخطورة، التكلفة، الفحص، أمر عمل، الخردة، المورد، الضغط، عمق المداس…). Match tone of `src/locales/ar/records.json` and `src/locales/ar/dashboard.json` — read them first as reference.

## Hard rules
- ZERO logic changes. No reordering JSX, no refactors, no renamed variables, no new deps.
- Minimal diffs: string → t() swaps + the import/hook line only.
- Both JSON files must parse (`node -e "JSON.parse(require('fs').readFileSync('<file>','utf8'))"`).
- After each page compile-check it:
  `cd /home/user/Tyre_Pulse && npx esbuild src/pages/<Page>.jsx --loader:.jsx=jsx --jsx=automatic --outfile=/dev/null`
- Do NOT run the full build/test suite (the orchestrator gates the wave).
- Do NOT git commit/push. Just leave files edited.
- If a page is enormous, still cover ALL visible chrome listed above; body copy inside rarely-seen info paragraphs may be keyed as longer strings — that's fine.

## Report back (final message)
Per page: namespace, approx number of keys, anything intentionally left untranslated beyond the exclusion list.

## ADDITIONAL HARD RULES (added after wave 1)
- NEVER use the Agent tool or delegate to sub-agents. Do every page yourself with Read/Grep/Edit/Write. If you delegate, all work is lost when you stop.
- Do NOT run `git commit` or `git push` — the orchestrator commits.
- Work page by page and SAVE files as you go, so partial progress survives interruption.
