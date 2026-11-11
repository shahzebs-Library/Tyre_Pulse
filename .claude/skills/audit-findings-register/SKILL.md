---
name: audit-findings-register
description: Shared evidence register and specialist-agent brief for any Tyre Pulse audit (360 audit, security review, pre-merge review). Gives every reviewer the same finding schema (what exists / should / does, evidence, root cause, severity P0-P3, confidence, files, cross-module effects, fix, expected result, acceptance tests, uncertainties), the read-only rules for production, and the consolidation steps. Use with complete-app-audit, or whenever more than one agent reviews the same codebase.
---

# Audit findings register

## Rules every reviewer follows
- Audit-only = READ ONLY: no edits, commits, stash, checkout, merges, deploys, migrations, data changes.
- Supabase: `mcp__Supabase__execute_sql` with SELECT / EXPLAIN / catalog reads only; impersonation only inside
  one `begin ... set local role authenticated ... rollback` call; never DELETE in a probe (approval prompt, timeout).
- Never claim a skill, test or browser check that did not run. Write NOT VERIFIED + reason instead.
- Only CONFIRMED findings may be P0/P1; "likely" / "suspected" must be tagged.
- Cite file:line or SQL + result. Prefer few real findings over many vague ones.

## Finding schema (one block per finding)
```
### F-<agent>-<nn> <title> | Severity P0|P1|P2|P3 | Confidence confirmed|likely|suspected
- What exists / What should happen / What actually happens
- Evidence (exact) / Root cause / Business impact
- Affected files / Cross-module effects
- Recommended fix / Expected result / Tests + acceptance criteria
- Uncertainties / needs human verification
```
Severity: P0 data loss, cross-tenant, money wrong at scale; P1 security or correctness in a live flow;
P2 contained defect; P3 quality/debt.

## Specialist split (disjoint scopes, one file each under <scratchpad>/audit/)
A architecture · B full-stack workflows · C database · D security · E tyre engineering · F finance/inventory ·
G AI/automation · H mobile · I QA/tests/CI · J UX/accessibility. The lead runs lint/build/test suites once and
shares the logs; agents never rerun the full suite.

## Consolidation
1. De-duplicate by root cause (two agents saying the same thing is one finding, not two proofs).
2. Cross-checks: DB vs frontend, engineering vs finance, mobile vs web, AI output vs DB truth, configured
   permissions vs enforced permissions, docs vs code, claimed tests vs CI logs.
3. Mark contradictions unresolved rather than picking a side without evidence.
4. Produce: capability inventory, coverage matrix, defects register, security, DB, engineering/finance, AI,
   mobile/UX, performance, current-vs-expected matrix, dependency analysis, roadmap, acceptance criteria,
   blockers + owner decisions, coverage scorecard. Publish as an Artifact for the owner.
