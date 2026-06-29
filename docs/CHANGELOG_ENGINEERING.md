# Engineering Changelog

Per-phase engineering record for the in-place hardening program
(`Current issues fixing.md`). Each phase lands as its own reviewed PR and is
gated by `npm run test:run` · `npm run build` · `cd mobile && npm run typecheck`.

## Phase 0 — Audit (docs only; no code/schema changes)
**Branch:** `claude/harden-phase0-audit`

Added the seven audit/planning documents that baseline the current
Vite/React + Expo + Supabase system and define the remediation program:

- `CURRENT_SYSTEM_AUDIT.md` — as-built: 46 tables, direct-call inventory by
  module, edge functions, private buckets, RLS helpers + risks, mobile offline
  flow + failure scenarios, dashboard duplication map.
- `PRODUCT_GAP_REGISTER.md` — gaps grouped by severity (Critical/High/Medium/UX),
  already-mitigated items marked RESOLVED.
- `SECURITY_HARDENING_PLAN.md` — directive rules + 10 issues → reality; S-01…
  remediation table; Phase-1 exit criteria.
- `DATA_MODEL_CONSOLIDATION_PLAN.md` — canonical sources, backward-compatible
  cutover pattern, stock movement ledger, unified audit, transactional
  tyre-change RPC, structured inspections.
- `MODULE_ROADMAP.md` — module inventory (current vs target) mapped to Phases 1–6.
- `UX_NAVIGATION_PLAN.md` — 8-workspace navigation + UX requirements.
- `TEST_AND_RELEASE_PLAN.md` — release gate + 10-suite test matrix + per-phase
  exit criteria.

**DB changes:** none. **Tests:** n/a (docs). **Risks remaining:** the open
items tracked in the gap register / security plan. **Next phase:** Phase 1 —
security & platform foundation (service layer, RLS org/site scope + isolation
tests, private storage + file-metadata + signed-URL tests, PWA cache hardening +
logout clear, secret checks).
