---
name: complete-app-audit
description: Orchestrates a full Tyre Pulse audit across web app, System Console, marketing site, Expo app, Flutter app, Supabase and edge functions by running the right installed and project skills in order, with DETECT-REPORT-FIX-TEST-VERIFY at every stage. Use for "check the complete app", "full audit", "audit everything", "is it production ready". Also holds the project accessibility and design-token rules.
---

# Complete app audit

## Surfaces (detect first; do not assume)
| Surface | Path | Stack |
|---|---|---|
| Web app + System Console | `src/`, `src/console/` | React 19 + Vite, Tailwind + CSS tokens, Supabase JS |
| Marketing site | `marketing/` | Next.js 16 App Router, plain CSS (`app/pmv.css`, `app/globals.css`) |
| Expo app (builds frozen, retired workflows) | `mobile/` | Expo SDK 54 / RN 0.81 |
| Flutter field app | `tyre_pulse_flutter/` | Flutter 3.47, Riverpod, go_router, ARB l10n |
| Native Kotlin app (see native-android skill) | `tyre_pulse_app/` | Compose |
| Backend | Supabase `jhssdmeruxtrlqnwfksc`, `supabase/functions/*`, `supabase/migrations/`, `MIGRATIONS_V*.sql` | Postgres + RLS + Deno edge fns |
| Python services | `services/` | report engine, analytics |

## Sequence (skip a stage only when its surface is absent, and say so)
1. architecture inspection (table above, `CLAUDE.md`, `PROJECT_MEMORY.md` top entries)
2. `git-safety` - status, branch, diff; note other sessions' work
3. identify web / mobile / backend / database parts touched or in scope
4. `full-review` (differential mode for a PR, deep mode for an audit)
5. `frontend-design` - critique against the approved design; never redesign approved screens
6. `responsive-design`
7. `frontend-visual-qa`
8. `visual-regression` baseline
9. `webapp-testing` (Playwright flows: login, nav, search, filters, forms, direct URLs, refresh, back)
10. `accessibility-audit` + project rules below
11. `performance-audit` (web) + `performance-review`
12. `auth-testing`
13. `rbac-testing`
14. `api-testing`
15. `supabase-review`
16. `database-migration-safety` (for any pending/new migration)
17. `owasp-security`
18. mobile security if mobile code in scope: `auth-assessment`, `secure-storage-audit`, `network-security-check`,
    `platform-interaction-review`, `crypto-review`, `privacy-audit`, `code-quality-scan`, `resilience-assessment`;
    user-invoked only: `/masvs-checklist`, `/mobile-threat-model`, `/mobile-pentest-plan`
19. `flutter-qa` (+ `flutter-app` conventions)
20. `localization-rtl`
21. `edge-case-testing`
22. `dependency-audit`
23. `release-readiness`
24-27. rerun visual QA, automated tests, builds, final `full-review` on the diff
28. final `git-safety` diff review

At each stage: **DETECT -> REPORT -> FIX -> TEST -> VERIFY AGAIN.** A stage is not PASS because a build or one
test passed. Fix root causes; never delete/skip tests, weaken security, remove functionality or modify production
data to get a clean report. Anything not executed is NOT RUN with the reason.

## Parallelising
Independent stages (security, database, frontend, mobile) can run as parallel subagents with **disjoint file
ownership**. Subagents must not commit, stash, reset or checkout; the lead commits by pathspec after reviewing.

## Accessibility rules (project)
WCAG 2.1 AA. Keyboard reachable and operable, visible `:focus-visible` rings, logical tab order, no traps, modals
move focus in and restore it on close (shared `Modal`, `useAnchoredPopover`), skip link to `#main-content`,
semantic landmarks, one `h1` per page, labelled inputs with error text tied by `aria-describedby`, `aria-disabled`
(not `disabled`) when the reason must stay discoverable, contrast >= 4.5:1 text / 3:1 UI (yellow `#FFC629` is a
fill behind dark text only - never yellow text on white), touch targets >= 44 px web / 48 dp Flutter, works at 200%
zoom and text scale 2.0, honours `prefers-reduced-motion`, RTL reading order correct.

## Design-token rules (project)
Reuse tokens; do not add magic numbers.
- Web app: CSS variables in `src/index.css` (`--bg-*`, `--text-*`, `--panel-ink-*`, `--border*`), dark default with
  `html.light` overrides; shared UI in `src/components/ui/` (Modal, PageHeader, EnterpriseTable, ThemeToggle);
  console kit `src/console/components/ui/index.jsx` (stay in gray-*/orange-* class families - the light theme is
  built from attribute selectors on those); command-center kit `src/components/commandCenter/kit.jsx` (`--cc-*`).
  Charts: `src/lib/reportColors.js` palette, `chartVarPlugin` resolves `var(--token)`.
- Marketing: `--brand #FFC629`, `--brand-ink`, `--ink #161616`, `--muted`, `--line`, hero spacing tokens
  `--hero-*` in `app/pmv.css`; hero classes use the `hc-` prefix (never `hero-stage`/`hero-copy`, legacy fixed heights).
- Flutter: `TpPalette`, theme extensions, `TpPalette.controlBorder` for interactive outlines.
- Expo: `mobile/lib/theme.ts` Daylight system + `mobile/components/ui` (see mobile-ui-design).

## Final report
The 28 headings the owner expects (skills, architecture, issues with severity CRITICAL/HIGH/MEDIUM/LOW/INFO, root
cause, files changed, fixes, tests run, browser tests, Flutter tests, viewport results, visual regression,
accessibility, security, auth, RBAC, API, database, dependencies, performance, release readiness, unresolved,
release blockers, final git status, final build status). No vague summaries.
