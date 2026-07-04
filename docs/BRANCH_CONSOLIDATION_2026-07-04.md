# Branch Consolidation — 2026-07-04

All feature/session branches have been consolidated onto `main`. Every branch
listed below was verified — with `git merge --no-commit` dry-runs and
`git branch -r --merged` — to have its work **already fully present in `main`**
(or to be superseded by newer work in `main`). They were then removed to keep
the repository clean.

`main` (auto-deploys to Vercel) remains the single integrated trunk.

## Kept (intentionally NOT merged into main)

| Branch | Tip SHA | Reason |
|--------|---------|--------|
| `claude/backend-step2-assets` | `cc1ef2b` | Go backend (server-authoritative migration, frozen). Never merged to main by policy. |
| `claude/mobile-kotlin-app` | `e1110c2` | Native Kotlin Android app (frozen). Never merged to main by policy. |
| `claude/mobile-app-ui-features-tdfxy0` | `1d8a30e` | Active web/mobile development branch; kept aligned with `main`. |

## Removed — work already in `main` (already-merged)

Verified via `git branch -r --merged origin/main`. Tip SHAs recorded for recovery.

| Branch | Tip SHA | Contents (all in main) |
|--------|---------|------------------------|
| `claude/harden-phase0-audit` | `535cd19` | Phase 0 audit/planning docs |
| `claude/harden-phase1a-pwa-secrets` | `7970323` | PWA cache hardening, logout cache clear, secret guard |
| `claude/harden-phase1b-org-scope` | `1caccc5` | Organisation-scope foundation (additive) |
| `claude/harden-phase1c-org-enforce` | `376459e` | RLS org isolation enforcement + isolation test |
| `claude/harden-phase1d-service-layer` | `c9799f0` | `src/lib/api` service layer |
| `claude/harden-phase1e-file-metadata` | `f89422e` | `file_metadata` authority record (org-scoped) |
| `claude/import-center-commit-rpcs` | `4a5d28f` | Server-side commit-framework RPCs |
| `claude/import-center-db-foundation` | `43d32a9` | Multi-country data-intake staging schema |
| `claude/import-center-engine` | `637f573` | Parse/map/validate data-cleaning engine |
| `claude/import-center-ui` | `e7824ec` | Data Intake Center UI |
| `claude/import-center-views` | `b1200dd` | Import Control views (history/quality/profiles) |
| `claude/live-testing-supabase-deploy-lrwzvg` | `baec240` | Supabase deploy / live-testing pass |
| `claude/mapping-format-assets-6cfndu` | `ab5508f` | Column-mapping asset formats |
| `claude/release-current-setup` | `ee73b40` | Release config (exclude Go/Android from main) |
| `claude/tyrepulse-inspector-build-7rxp2t` | `52bbcc3` | Inspector build |
| `feature/web-ci-cd` | `f793f3c` | Web CI/CD workflow |

## Removed — merge into `main` is a no-op (superseded, 0 net changes)

Dry-run `git merge --no-ff` into `main` produced **0 conflicts and 0 file
changes** — their content is already in `main` through later re-implementation.

| Branch | Tip SHA |
|--------|---------|
| `claude/handoff-setup-gZAHb` | `f8331e2` |
| `claude/peaceful-cray-YPKbn` | `5a53f5b` |
| `claude/relaxed-brown-26m2q7` | `ff55af6` |
| `claude/test-coverage-analysis-YsbTg` | `25e770c` |
| `claude/todo-implementation-bYKx5` | `e47160b` |

## Removed — superseded, would regress production (deleted without merging)

Dry-run merges conflicted against **current** production files; their features
(Arabic/Urdu i18n, the animated login) are already shipped in `main` via later,
better implementations (Phase E i18n, current `Login.jsx`, V69 login). Merging
the month-old versions would have overwritten live code, so they were deleted
without merging (owner decision, 2026-07-04).

| Branch | Tip SHA | Why not merged |
|--------|---------|----------------|
| `feat/3d-truck-login` | `b2730eb` | 6 conflicts incl. `Login.jsx`; old login experiment |
| `feature/i18n-arabic-urdu` | `4366608` | 14 conflicts across the whole mobile app; i18n already in main |
| `fix/mobile-eas-build-assets` | `da0fa7e` | Mobile EAS asset fix, superseded |

## Recovery

Any removed branch can be restored from its recorded tip SHA:
`git branch <name> <sha> && git push origin <name>`.
