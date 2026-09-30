---
name: database-migration-safety
description: Safety gate for any Supabase/Postgres schema or data change in Tyre Pulse (project jhssdmeruxtrlqnwfksc). Use before writing, applying or reviewing a migration, a backfill, a trigger/function replacement, an index drop, or any UPDATE/DELETE over live tables. Triggers on "migration", "apply", "backfill", "drop", "alter table", "change the function".
---

# Database migration safety

Production is a single live Supabase project shared by the web app, the Expo app, the Flutter app and edge
functions. Old mobile builds stay installed for months (no forced update unless `system_config.mobile_min_version`
/ `flutter_min_version` is raised), so **every schema change must keep old clients working**.

## Where migrations live
- New: `supabase/migrations/<YYYYMMDDHHMMSS>_<name>.sql` (timestamp versions in the DB).
- Legacy history: repo-root `MIGRATIONS_V*.sql`. Next free V-number is recorded in `PROJECT_MEMORY.md`.
- Verify what is really applied with `select version, name from supabase_migrations.schema_migrations order by 1 desc limit 20`
  AND the live object (`pg_get_functiondef`, `\d`). A file header saying APPLIED is a claim, not evidence.

## Required pre-flight (write the answers in the migration header)
| Check | How |
|---|---|
| Data loss | Any `DROP`, `DELETE`, `TRUNCATE`, type narrowing, column removal? Snapshot first into `_bak.<table>_<purpose>` |
| Rename / removal | Grep `src/`, `mobile/`, `tyre_pulse_flutter/lib`, `supabase/functions` for the column. Old mobile builds still read it: add new, backfill, keep old until no client reads it |
| Type change | Can every stored value cast? `select count(*) where not (col ~ pattern)` first |
| CHECK constraints | New client value against an old CHECK = every save fails with "Some values are not valid" (V244, V612). Removing a jsonb key can also violate a CHECK (washing, 2026-09-22). Grep the CHECK before shipping client vocabulary |
| Locks | `ALTER TABLE ... ADD COLUMN ... DEFAULT` volatile, `VACUUM FULL`, index builds without `CONCURRENTLY` hold ACCESS EXCLUSIVE on large tables (`work_orders`, `parts_consumption`, `audit_log_v2`, `production_logs`) |
| FK impact | Cascade rules, orphan rows, `ON DELETE` behaviour |
| Index impact | Confirm with EXPLAIN (as `authenticated`, see below) that the planner uses it; drop only with >= several days of `pg_stat_user_indexes` evidence and never UNIQUE/PK/FK-supporting |
| Triggers | A backfill UPDATE fires BEFORE UPDATE triggers: `classify_parts_consumption` re-buckets money, `tyre_records_master_process_tg` nulls km 0, `trg_lock_inspection_content`, `trg_guard_profile_privileged`. Measure affected rows first; disable only the one trigger, re-enable in the same statement, verify `tgenabled='O'` |
| RLS | New table: RLS on, RESTRICTIVE org isolation `organisation_id = (select app_current_org())`, country/site restrictive, elevated write. No anon grants |
| SECURITY DEFINER | pin `search_path`, re-check org/country/site in the body, `revoke execute ... from public` THEN `from anon`, grant `authenticated` explicitly. Never grant `authenticated` a DEFINER fn that accepts an org id |
| PostgREST | Never `RAISE ... ERRCODE '40001'`: PostgREST retries it forever (2026-09-26 loop). Use `PT409` |
| Duration | Estimate rows touched; batch backfills (5k-50k rows) so none exceeds the 60 s statement window; a timed-out UPDATE may still have committed, so re-count |
| Rollback | Exact SQL to undo, including restoring from the `_bak` snapshot |

## Order for risky changes
1. **Schema change** (additive: new nullable column / new table / new function beside the old)
2. **Backfill** (batched, idempotent, snapshot kept)
3. **Verification** (counts before/after, money totals per country unchanged unless intended, impersonation test)
4. **Cleanup** (drop the old path only after no client reads it)
5. **Rollback** plan written before step 1

## Verifying as a real user (RLS is bypassed by the MCP/service role)
```sql
begin;
select set_config('request.jwt.claims', json_build_object('sub','<real user uuid>','role','authenticated')::text, true);
set local role authenticated;
-- run the reads/writes the change affects; EXPLAIN here too
rollback;
```
Count results as a privileged reader in the same transaction (`reset role`) to tell "refused" from "invisible".
One user per transaction: `app_country_scope()` is STABLE and caches within a statement.

## Never without explicit owner approval
Irreversible deletion of business data, dropping tables/columns with data, `VACUUM FULL`, changing auth
settings, and anything run against production "just to test".

## Pass / fail
PASS: header documents every row of the table above, change applied, verification queries shown, security
advisor (`get_advisors security`) shows no new finding, repo file matches the applied SQL.
FAIL: any unchecked row, any unverified count, or a migration file that differs from what ran.
