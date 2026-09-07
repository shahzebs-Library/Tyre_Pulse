# Tyre Pulse agent rules

These rules apply to the whole repository. A closer `AGENTS.md` overrides them for its folder.

## Start with the smallest useful context

1. Read `CODEX_CONTEXT.md`.
2. Read only the nearest `AGENTS.md` for the files being changed.
3. Inspect `git status`, the requested files, their direct imports, and related tests.
4. Search with `rg` before opening files. Do not scan the whole repository.
5. Open a large document only when the task requires it. Search it first and read the matching section.
6. Do not reread files already inspected in the current task unless they changed.
7. Do not generate broad audits, inventories, plans, or documentation unless requested.

Do not load `HANDOFF.md`, `CLAUDE.md`, every migration, every architecture document, or all test files by default. They are references, not startup context.

## Product and source boundaries

- Primary production mobile app: `tyre_pulse_flutter/` for Android and iOS.
- Production web app: root `src/`.
- Legacy React Native reference: `mobile/`. Treat as read-only unless the task explicitly targets it.
- Native Android reference: `tyre_pulse_app/`. Follow its local `AGENTS.md`.
- Backend: `supabase/`, root migrations, existing RPCs, and existing Edge Functions.
- Marketing site: `marketing/`.
- Services: `services/`.

Never combine implementations merely because similarly named files exist. Confirm the target app first.

## Change discipline

- Continue from current `main`; do not restart completed work.
- Preserve user changes and real vehicle SVGs/photos.
- Reuse existing components, repositories, schemas, routes, and design tokens.
- No fabricated data, endpoints, tables, columns, KPIs, or completed states.
- No placeholder controls, dead buttons, silent errors, or broad rewrites.
- Do not change database schema without an explicit migration.
- Preserve tenant isolation, RBAC, auditability, offline behavior, RTL, dark mode, and real back navigation.
- Keep edits limited to the requested feature and its tests.
- Never edit generated files by hand when a generator owns them.
- Never commit secrets, local SDK paths, build output, caches, or dependency folders.

## Efficient workflow

- Prefer one focused search and one focused edit pass.
- Use existing tests as the behavioral contract.
- Run the smallest relevant test first, then the required package gate.
- Do not repeatedly run full suites while iterating.
- Do not install or upgrade dependencies unless the task needs it.
- Do not refactor unrelated code while fixing a bug.
- Do not create duplicate status or handoff documents. Update `CODEX_CONTEXT.md` only when architecture, commands, or active blockers materially change.
- Keep progress messages short. Final response: outcome, verification, blocker only.

## Verification by area

- Root web: `npm run lint`, relevant Vitest target, then `npm run build`.
- Flutter: follow `tyre_pulse_flutter/AGENTS.md`; CI must run analyze, tests, Android build, and unsigned iOS build.
- React Native legacy: verify only if explicitly changed.
- Supabase: validate migrations and affected tests; never run destructive resets against shared or production data.
- Documentation-only changes: check links, paths, and commands. Do not run application suites unless CI policy requires them.

Never claim success when a required check was skipped, blocked, or failed. State the exact blocker.
