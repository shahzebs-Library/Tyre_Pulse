# COMMERCIAL-MERGE round 2

Date 2026-11-15. Branch `claude/commercial-fixes-7rxp2t` (draft PR #510). Not pushed. Production untouched.

## What was done
- Merged `origin/main` (6e7945ad) into the branch. 16 marketing files conflicted.
- Cause: the branch already held main's premium pass (#502) content plus the claim fixes, added as new files
  on an older base, so git saw add/add and overlapping edits.
- Resolution: each file three-way merged with the #502 version as the base (branch = #502 + claim fixes,
  main = #502 + #516). All 16 merged with no hand edits. Result: `marketing/` equals main plus exactly the 25
  claim-fix files. `next.config.ts` and `test/legal-redirects.test.mjs` are main's, unchanged.
- No main feature dropped. No audited claim restored.

## Claim wording
- The 14 corrections in `MARKETING_CLAIM_FIXES.md` are all present after the merge, wording unchanged.
- Main's only marketing change since the fixes were written is the legal redirects (#516): no new copy, so
  no new unsupported claim. A scan for uptime, certification, accuracy, iOS, TPMS, telematics, sign-up,
  integration and guarantee wording found nothing outside the corrected text.
- One new edit: a code comment in `components/motion/walkthrough/tyreIntel.tsx` still said TPMS data arrives
  "via the telematics connection"; it now says it illustrates the planned feature. Not user facing.

## Tests (real output)
| Check | Result |
|---|---|
| marketing `npm run lint` | exit 0 |
| marketing `npx tsc --noEmit` | exit 0 |
| marketing `npm test` | 45 of 45 pass (includes the legal redirect tests from main) |
| marketing `npm run build` | exit 0, 28 static pages |
| `git merge-tree --write-tree origin/main HEAD` | clean |
| vitest, the 16 branch test files + designSystemRatchet | 17 files, 171 of 171 pass |
| eslint on changed `src` files | 0 errors, 2 warnings (existing hook dependency warnings) |
| PGlite `supabase/tests/commercial_*.test.mjs` | 22 of 22 pass (synthetic data only) |
| `vite build` | built |

Marketing dependencies were hard-linked from the main checkout (lockfile identical), then removed.
Not Tested: pages in a browser, the deployed site, Arabic wording by a native reader.

## Draft numbers
`DRAFT_RENUMBERING_PLAN.md`: 46 drafts, 2 clashes (#518 against #519). Proposal: move the three work order
drafts to 20261115140000 / 140500 / 141000; nothing else moves. Plan only.

## Notes for the owner
- PR #510's base is `claude/tyrepulse-inspector-build-7rxp2t`, not main. After this merge its diff against
  that base also shows main's commits until the base branch takes main too.
- `20261115120000_observation_erp_reconciliation.sql` sits in `supabase/migrations/` on main (never applied)
  and as a rework draft on #521. Do not apply main's copy.
- Rollback: `git reset --hard 833b6f53` on this branch (nothing pushed).
