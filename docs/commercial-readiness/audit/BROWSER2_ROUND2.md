# BROWSER2, round 2 final report

Full results: `ROUND2_BROWSER_TESTS.md`. Production untouched (one read-only look at role module switches).

- **Files changed**: this note, `ROUND2_BROWSER_TESTS.md`, `e2e/staging/README.md`, `e2e/staging/round2_setup.sh`,
  `round2_harness.sql`, `specs/round2_lib.cjs`, `round2_recall.cjs`, `round2_work_orders.cjs`, `round2_closure.cjs`,
  `round2_responsive.cjs`. No feature code changed. Branch also holds the merges of PR #518, #519, #520.
- **Drafts written**: none. Applied to the test copy only: `20261113130000`, `20261115160000`, `160500`, `161000`,
  `20261116100000`, `101000`.
- **Tests run** (real browser, synthetic data): Recall Tracker 6 of 6 passed. Work orders 11 passed, 3 failed,
  1 not tested. Corrective actions 11 passed, 2 failed. Checklists 9 passed, 1 failed, 1 not tested. Phone width
  and Arabic 2 passed, 1 failed. `vite build` passed. eslint clean on the new specs.
- **Proven on synthetic staging**: the recall fix; the work order rights for Manager, both supervisor shapes, Tire
  Planning Engineer, Tyre Data Collector, Admin, and technicians once their module is on; the review loop, self
  review, history, exception; acknowledge with a fault, refusals, compliance. No raw database text in any message.
- **Not tested**: production, storage (real photographs), email, push, phone apps, Audit Pack with the new status.
- **Current-company impact**: none (nothing applied). If the drafts are applied as they are: W1/W2 would stop
  managers and supervisors saving any job that has an approved cost, and the job form already zeroes Parts Cost on
  imported job cards today (on main).
- **Commercial impact**: C1 (supervisors cannot reach review on the web), A1 (new panels English only) and K1
  (acknowledged sheet listed as pending) should be fixed before a customer sees these features.
- **Migration order**: unchanged. Fix W1 in the web build before the work order drafts. Renumber the duplicate
  `160000` / `161000` drafts.
- **Rollback**: nothing to roll back; the test database copy was dropped.
- **Remaining risks**: C2 (submitter can close their own submission by exception); W4 (technicians have no web
  screen for their job); the closure SQL fixture differs from real template shape (K4).
- **Questions for the owner**: (1) Should technicians work their assigned job on the web, or on the phone only?
  (2) May the person who submitted record an exception on their own action? (3) Should a Tyre Data Collector keep
  create, edit, quality check and Live Control? (4) How should an acknowledged sheet appear in lists and the Audit
  Pack?
