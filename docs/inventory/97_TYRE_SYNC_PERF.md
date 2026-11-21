# 97 - Tyre custody sync performance (follow-up migration, NOT applied)

Production project `jhssdmeruxtrlqnwfksc`. Measured 2026-11-21 (UTC). **Nothing in this document was applied
to production**: every production measurement ran inside a transaction that was rolled back (verified after:
tyre_items 0, tyre_custody_conflicts 0, tyre_item_events 0, `inv_tyre_sync_runs` absent, live function md5
unchanged `92e69b66...`). The migration needs the owner's approval.

## 1. Package

| File | sha256 |
|---|---|
| `supabase/pending_migrations/20261121110000_inv_tyre_sync_perf.sql` | `abff81a32b73065a9b986fd2c80e70f0e82e6cf734004e3c6cb394d95dbf269f` (revision 2, commit `22f7d660`, after the PR #574 review) |
| `supabase/pending_migrations/20261121110000_inv_tyre_sync_perf_ROLLBACK.sql` | `2731a776c44f2812ff83d76a40e5099fba8aaceaf821eb308dd32cae6534c70d` |
| Test | `supabase/tests/inventory_tyre_sync_perf.test.mjs` (PGlite, 10/10) |

Guard: the file refuses to run unless `md5(pg_get_functiondef('public._inv_tyre_item_sync(text)'))` (CR removed)
equals `92e69b6622a88dddc3358ddea0ff1276` (production, 2026-11-21; the PGlite harness carries the same body).
The original is kept in `_bak.inv_121110_snapshot`; the rollback executes it verbatim and drops the new cache
table. Re-applying is a no-op.

## 2. Root cause

`_inv_tyre_item_sync` builds `_tc_derived` with nine correlated subqueries per serial key (three counts, two
`exists`, three ordered `limit 1` picks, the holding) over temp tables that have no index and no statistics.
Production plan (rolled back, KSA rows, a 300-key sample):

```
Seq Scan on x_sub k (actual rows=300)            Buffers: local hit=230530
  SubPlan 1..8: Seq Scan on x_rows (loops=300)   Rows Removed by Filter: 6575   local hit=38400 each
Execution Time: 3008.613 ms
```

Each key re-scans all ~6,600 KSA rows seven times: 300 keys = 3.0 s, so 6,032 KSA keys = ~60 s for this step
alone. The conflict insert then built three jsonb evidence objects (again temp-table scans) for every key
before filtering. The serial canonicalisation is not the problem (`inv_canon_serial` / `tyre_serial_is_strong`
are IMMUTABLE and run once per row when the temp table is built).

## 3. Fix

* `_tc_derived` is set-based: one `GROUP BY` (counts, active assets, scrapped flag), `DISTINCT ON` for the last
  active / last / first-priced row, one join each for scrap marks and the (unique) active holding; the
  disposition lookup stays a lateral over `tyre_dispositions_serial_idx`.
* `(country, serial)` indexes + `ANALYZE` on the temp tables.
* Evidence is built only for keys that conflict.
* Incremental writes: a `tyre_items` row is written only when a derived value changed (`items_written`); events
  only on a state change (unchanged). A source watermark was considered and rejected: `tyre_records` has no
  `updated_at` and must not be modified, so a watermark would miss edits and deletes. Reading every row is now
  cheap; writing only changes is the safe incremental step.
* Idempotent: conflicts keep `ON CONFLICT (organisation_id, country, serial, conflict_type) WHERE status='open'
  DO NOTHING`.
* Repeat guard: `pg_advisory_xact_lock` per (company, country scope) serialises concurrent refreshes; table
  `public.inv_tyre_sync_runs` stores the last run's source fingerprint (tyre_records, scrap marks, holdings,
  dispositions, conflict statuses). A request with the same fingerprint within 60 s returns the stored result
  with `cached: true`, `new_conflicts: 0`, `state_changes: 0`. Any source change (a new tyre row, a disposition,
  a decided conflict) rescans.
* The cache table is **private to the SECURITY DEFINER function** (review P1): RLS on, no grant to anon or
  authenticated, no permissive policy (only the restrictive `anum_reader_*` policies the project adds to every
  table). No client can read any company's or country's run result.
* The fingerprint is captured **before** the derivation (review P2). After the run the sources are fingerprinted
  again and the conflicts are compared with "before + exactly the rows this run inserted" (`RETURNING`). If
  anything changed meanwhile (another session's commit, visible under READ COMMITTED), the run is stored as
  `not-cacheable:<uuid>` and returns `source_changed_during_sync: true`, so the next request rescans.
* Not touched: `tyre_records`, `tyre_status_marks`, costs, CPK inputs, the wrapper `inv_tyre_item_sync(jsonb)`,
  the ACL (`_inv_tyre_item_sync` stays owner/service_role only), the response keys the web reads (`items`,
  `new_conflicts`).

Behaviour differences (deliberate, stated):
1. **Exact ties.** Where two rows of one serial share the same order key (date and created_at), the old
   `limit 1` picked an arbitrary row (it could change between runs); the new code breaks the tie by row id.
   Measured on production: UAE 3 of 2,087 items differ, Egypt 8 of 500, every one an exact-tie serial
   (checked); KSA has 9 tied serials. Conflicts are identical (UAE md5 `2dac75ac...` both).
2. `last_derived_at` moves only for tyres whose derived values changed.
3. New response keys `items_written`, `cached`, `duration_ms` (and `last_run_at` when cached).

## 4. Timings

| Scope | Released function | Set-based | Source |
|---|---|---|---|
| KSA (6,032 items, 6 conflicts) | **87,210 ms** | **1,944 ms** first run (writes all 6,032); **26 ms** cached repeat | production, rolled back (postgres log `OLDKSA 87210 ms`) |
| UAE (2,087 items, 1 conflict) | 10,786 ms | 1,028 ms | production, rolled back |
| Egypt (500 items) | 1,262 ms | 653 ms | production, rolled back |
| 600 synthetic serials x 3 scopes | 2,429 ms | 331 ms | PGlite |
| 7,000 synthetic serials (8,742 KSA rows) | not run | 1,475 ms | PGlite |

Counts are equal on production: KSA items 6,032 / 6 new conflicts / 1,791 weak-serial rows (old and new), UAE
2,087 / 1 / 44, Egypt 500 / 0 / 7. The six KSA conflicts are the doc 31 serials L52043311, YMM18886, YMM22455,
YMM68731, YMU41519, YMY44573 (`scrapped_but_active`); the UAE one is YMA44467. Source tables unchanged
(tyre_records + tyre_status_marks md5 equal before and after).

## 5. PGlite proof (`inventory_tyre_sync_perf.test.mjs`)

* Two databases with identical synthetic data (the seven production patterns + 600 volume serials with
  removals, scraps, marks, holdings, dispositions, two-asset actives, no exact ties): the released and the new
  function produce byte-identical `tyre_items` and `tyre_custody_conflicts` (evidence included) for KSA, UAE and
  all countries, and identical response counts.
* The seven conflicts are open (6 KSA, 1 UAE); no duplicate open conflict.
* Unchanged sources within 60 s: cached. A recorded disposition: rescan, exactly 1 item written, 1 state change,
  0 new conflicts. A forced rescan with unchanged data: 0 written, 0 new.
* tyre_records / tyre_status_marks hashes unchanged; authenticated cannot execute the inner function or write
  the cache table; a viewer is refused 42501.
* Re-apply is a no-op; the rollback restores md5 `92e69b66...` and removes the cache table.
* Cache table private: authenticated / anon have no SELECT or INSERT, RLS on, 0 permissive policies.
* Concurrent change (P2): a test trigger commits a disposition while the sync inserts conflicts; the run returns
  `source_changed_during_sync: true` and is stored not-cacheable; the next call rescans (not cached) and picks up
  the new tyre; the third call is cached.

Revision 2 re-measured on production (rolled back, 2026-11-21): KSA 2,039 ms (6,032 items, 6 conflicts), UAE
890 ms, Egypt 622 ms, KSA rescan after the UAE run 1,277 ms (0 rows written), KSA cached repeat 26 ms; authenticated
SELECT on the cache table false, 4 policies all restrictive `anum_reader_*`.

## 6. Apply (when approved)

Same method as doc 96 section 3: fetch the file from GitHub raw at the merge commit via `pg_net` into
`_bak.inv_release_sql`, check sha256 `abff81a3...` in the database, `_bak.inv_release_run(file, sha)`, verify in
the same transaction (VERIFY block at the end of the file), ledger `20261121110000 inv_tyre_sync_perf`. Then
as an Admin: `inv_tyre_item_sync({country:'KSA'})` for real (this materialises the 6 KSA conflicts and 6,032
tyre items for the first time), then UAE and Egypt.

**Stop conditions:** md5 guard mismatch (someone changed the function: re-review); verify false; KSA first run
above 10 s; any change to tyre_records / tyre_status_marks fingerprints; conflict counts other than KSA 6 /
UAE 1 / Egypt 0 on the first real run. In any of these: run the rollback (restores the released function; rows
already derived are the same derivation and may stay).

**Rollback:** `20261121110000_inv_tyre_sync_perf_ROLLBACK.sql` (fetch + execute the same way; it contains
`drop`, so never paste it through MCP).
