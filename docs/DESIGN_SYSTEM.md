# Design System

The TyrePulse visual language: design tokens, light/dark theming, the tenant
accent, component classes, and UI-state conventions.

_Last updated: 2026-07-03 · Master Build Phase E._

---

## 1. Tokens (`src/index.css` `:root`)

All colour, surface, text, border, radius, shadow, easing and component values
are CSS custom properties. Prefer tokens over literal hex in new components.

| Group      | Tokens |
|------------|--------|
| Brand      | `--brand`, `--brand-bright`, `--brand-electric`, `--brand-glow`, `--brand-subtle`, `--brand-halo` |
| **Accent** | `--accent`, `--accent-strong`, `--accent-ring` — tenant-themable (§3) |
| Surface    | `--bg-base`, `--surface-0..3`, `--surface-raised` |
| Text       | `--text-primary`, `--text-secondary`, `--text-muted`, `--text-dim` |
| Border     | `--border-brand`, `--border-bright`, `--border-dim`, `--border-subtle` |
| Radius     | `--radius-sm/card/lg/xl` |
| Shadow     | `--shadow-card/glow/float` |
| Easing     | `--ease-spring/smooth/in-out` |
| Component  | `--card-*`, `--input-*`, `--table-*`, `--btn-2-*`, `--glass-bg`, `--login-*` |

## 2. Light / dark theming

- **`src/contexts/ThemeContext.jsx`** — resolves the initial theme from
  `localStorage['tyrepulse-theme']` or the OS `prefers-color-scheme`, follows OS
  changes until the user picks manually, and toggles the `html.light` / `.dark`
  class. Exposes `{ theme, toggleTheme, isDark }`; the header has the toggle.
- **Dark** is the base (`:root`). **Light** is a comprehensive override layer
  (`html.light …`, ~280 lines in `index.css`) mapping the dark Tailwind classes
  (`bg-gray-900`, `text-white`, `border-gray-800`, gradients, status colours…)
  to accessible light equivalents. New pages built with the standard classes get
  light mode automatically — no per-page work.

## 3. Tenant accent (per-organisation theming)

The V68 branding (`BRANDING_AND_REPORT_SETTINGS.md`) flows into the app accent:

- `TenantContext` publishes `--brand-primary` / `--brand-accent` from the org's
  branding, and overrides the semantic accent tokens **only when the org sets a
  custom colour** (≠ the product green `#16a34a`):
  `--accent`, `--accent-ring`, `--accent-strong`.
- A default / unbranded org keeps the **exact** original green design (the
  tokens hard-default to green; overrides are cleared on logout / default orgs).
- The universal accent surfaces follow the token: the global `:focus-visible`
  ring uses `--accent-ring`; the `.text-accent` / `.bg-accent` /
  `.border-accent` / `.ring-accent` utilities use `--accent`.
- **Deliberately not tinted:** the hand-tuned green component gradients
  (`.btn-primary`, glows, shadows). Recolouring those per-tenant risks visual
  regressions; brand identity is carried by reports (fully branded) + the accent
  surfaces above. Extending the accent to more chrome is a future, opt-in step.

## 4. Component classes (`@layer components`)

`.card`, `.card-stat`, `.btn-primary`, `.btn-secondary`, `.input`,
`.table-header`, `.table-cell`, `.stat-value`, `.page-title`, `.glass`,
`.nav-section`, `.login-card`. All are light/dark aware. Use these instead of
re-implementing surfaces.

## 5. UI-state conventions

Every data screen must render four states (enforced across the app):

- **Loading** — `LoadingState` / skeletons.
- **Error** — `AlertTriangle` + message + a Retry that re-runs the fetch.
- **Empty** — `EmptyState` (`icon`, `title`, `description`, optional `action`).
- **Populated** — with search, filters, actions.

Toasts for async actions (exports, saves): in-flight spinner + success/error
message; never a silent dead control (see the Report Center / branding editor).

## 6. Accessibility

- Visible `:focus-visible` ring on every interactive element (tenant-accent
  coloured, 2px, offset).
- Light + dark both meet contrast on text/status colours (the light layer maps
  neon-on-dark to AA-legible tones).
- RTL: the app ships an RTL shell + Arabic locales (i18n workstream); layouts
  use logical properties / flex so mirroring is automatic.

## 7. Extending

- New colour? Add a token, not a literal. New accent surface? Use `--accent*`.
- New page? Use the component classes + the four states; light mode is free.
- Changing the brand default? Update `--brand*` / `--accent*` in `:root` — the
  light layer keys off the same green rgba values.
