# Multi-company migration sequence: local run

Runs every draft needed to host a second company, in order, on a COPY of the local staging database
(three synthetic companies), and proves after each step that the current company is unchanged.
Nothing here touches production; the runner refuses any host but 127.0.0.1.

Needs: the local staging cluster from `supabase/staging` (branch `claude/staging-environment-7rxp2t`,
PR #508) running on port 54329, `psql`, and a Python with `psycopg2` (`/usr/bin/python3` on the build box).

```
/usr/bin/python3 supabase/tests/multi_company_sequence/run_sequence.py --out /path/outside/repo/report.json
```

| File | Purpose |
|---|---|
| `sequence.json` | The ordered list of drafts, what each needs, and the HOLD step |
| `prepare_production_shape.sql` | Makes the copy resemble production: current company with no subscription row and above the trial caps, a custom role stored as global matrix rows, made-up sign-in addresses |
| `run_sequence.py` | Copy, prepare, snapshot, apply each draft, re-snapshot and compare, run the round 2 tests, apply the HOLD step, test again |

The "current company" snapshot is 191 facts: for each of its 9 synthetic users the md5 of
`get_user_module_permissions()`, the md5 of `app_user_can` over every module and six capabilities, the
row counts visible in 14 tables and the visible configuration; whether an Admin, a Manager and a Tyre Man
can add a vehicle; what every username and employee id resolves to at sign-in; where a sign-up with no
invitation and a service load with no session land; and count and checksum of stored business data per
company (so a draft that rewrites history is caught).

Result of the run on 2026-11-15 is recorded in
`docs/commercial-readiness/audit/MULTI_COMPANY_MIGRATION_SEQUENCE.md`.
