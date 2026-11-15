# COMMERCIAL2 round 2 report

Date 2026-11-15. Branch `claude/commercial-blockers-7rxp2t` (from main), not pushed, no PR.
Production was read only (counts). Nothing applied, deployed or switched on.

## Files changed
- Recall fix: `src/pages/RecallTracker.jsx`, `src/lib/recallCountry.js` (new), `src/lib/api/recalls.js`,
  `src/test/recallCountry.test.js` (new).
- Drafts copied unchanged: 13 TEN files (PR #506), 8 COM files (PR #510).
- New drafts: `20261115160000` ten6b, `161000` ten7c, `162000` ten8b, `163000` ten9b, `169000` ten9c HOLD.
- Runner: `supabase/tests/multi_company_sequence/` (4 files). `supabase/pending_migrations/README.md`.
- Docs: `MULTI_COMPANY_MIGRATION_SEQUENCE.md`, `COMMERCIAL_BLOCKER_CHECKLISTS.md`, this file.

## Recall Tracker: Verified Fixed (synthetic)
Cause confirmed on staging: the page wrote the profile country list into the single-value column; the
stored text matched no country scope and `recalls_country_write` refused it. A single country is accepted.
No other policy refuses the save. The form now has a Country picker, defaults to the active country,
requires a choice on the All view; the service never sends a list. `/recalls/:id` only reads. 13 new tests,
26 pass with the existing recall tests. eslint clean, `vite build` clean. Not tested in a browser.

## New drafts
- ten6b: enforcement preflight per company; guarded switch that refuses when the current company would be
  limited; direct write of the switch refused for a signed-in user.
- ten7c: role matrix readable only by the company it applies to; own rows win over defaults; matrix reader
  and optional seed.
- ten8b: invitation preview before sign-in; company code; a code alone never grants membership.
- ten9b: one sign-in resolver; `company code/name`; the current company's bare names win on a collision.
- ten9c HOLD: removes the five global username and employee id keys. Contains `drop`.

## Tests (local PostgreSQL 16, three synthetic companies)
- Whole sequence: 26 of 26 drafts applied in order, 0 failed.
- Current company unchanged: 191 facts compared after every step, 0 differences (permission map and
  capability matrix for 9 users, visible rows, vehicle insert, sign-in resolution, sign-up, service load,
  stored-data checksums).
- Round 2 draft tests: 87 of 87.
- Isolation suite on the final database: 35 of 35.
- COM group alone on a fresh copy: 8 of 8.

## Proven on synthetic staging only
Everything above. Not tested: production (PostgreSQL 17.6), hosted Supabase, real Auth, PostgREST, edge
functions, web, Flutter and Expo clients, timing on real volumes, the Billing page showing plan "Internal".

## Impact
- Current company: none from any draft with both switches as shipped. One intended visible change after
  TEN-6: Billing shows "Internal".
- Commercial: TEN-6 to TEN-9 now have a tested path each; all four stay Blocked on owner decisions and
  client work, not on database design.

## Order and rollback
Order, dependencies, per-step check and rollback: `MULTI_COMPANY_MIGRATION_SEQUENCE.md`. COM group is
independent of TEN. Point of no easy return: ten9c only.

## Remaining risks
- Owner invitation is tied to an e-mail; today's username sign-up form cannot redeem it.
- Account addresses are unique platform-wide: a second company needs `<username>+<code>@users.tyrepulse.app`.
- The sign-in edge function still resolves names itself.
- No client sends an invitation token or company code.
- Backups: large tables and storage files have no confirmed recovery path.

## Questions for the owner
1. Do all 5 existing organisations receive the unlimited `internal` plan?
2. New company role defaults: inherit live, or copy at creation?
3. May an owner invitation be untied from an e-mail, or will there be a real e-mail sign-up?
4. Is `company code/name` in the existing sign-in field acceptable, or a separate field?
5. Who reads the Supabase backup settings and runs one timed restore?
6. Will a hosted staging project be created for client and device tests?
