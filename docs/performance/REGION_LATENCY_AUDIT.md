# Tyre Pulse - region and latency audit (read-only)

Date: 2026-11-24. Author: performance investigation (read-only; nothing created, migrated, deployed or committed).
Every number below comes from a command run or a log read in this session; the method is given beside it.
Anything not measured is marked **NOT MEASURED** or **ESTIMATE**.

## 0. Where things are

| Item | Value | How known |
|---|---|---|
| Supabase project `jhssdmeruxtrlqnwfksc` | **ap-northeast-1 (Tokyo)**, Postgres 17.6, ACTIVE_HEALTHY | Supabase MCP `get_project` |
| Other project in the same org | `opsbrain` (`ofikwvjqedcayybfkdbl`) in **ap-south-1 (Mumbai)** | MCP `list_projects` (used only for a network RTT probe to `/auth/v1/health`, no data read) |
| Measuring machine | **Riyadh, SA**, ISP AS43766 Mobile Telecommunication Co. Saudi Arabia (Zain), tz Asia/Riyadh | `ipinfo.io/json`; Cloudflare trace `colo=RUH loc=SA` |
| Path to `*.supabase.co` from this machine | Enters Cloudflare at **MRS (Marseille)**, not RUH | `cf-ray` suffix `-MRS` on 3/3 responses |
| Path used by real Saudi users (24 h of logs) | **MXP Milan 18,709 req, MRS Marseille 1,073, RUH Riyadh 819, JED Jeddah 156** = 20,757 SA requests; **95.3 % enter Cloudflare in Europe** | `query_logs` on `edge_logs`, `request.cf.country='SA'` grouped by `request.cf.colo` |
| Web app | Vercel, served from **bom1 (Mumbai)** edge for this client | `x-vercel-id: bom1::...` on `https://tyrepulse.app/` |
| Edge functions | Server-side/cron invocations run in **ap-northeast-1** (`x_sb_edge_region`); no SA-originated function calls in the 24 h window | `function_edge_logs` |
| DB size / storage | DB **2,788 MB**; storage **30,390 objects / 6,604 MB in 11 buckets**; 787 auth users; 28 active cron jobs; 15 realtime tables; extensions incl. pg_cron, pg_net, vector, supabase_vault | `execute_sql` (read) |
| shared_buffers | 32,768 x 8 kB = 256 MB | `pg_settings` |

The measuring machine IS in Riyadh, so it is representative of at least one large Saudi ISP (Zain mobile). It may not represent STC/Mobily fixed lines; the logs show some Saudi users peer at RUH/JED, and their figures are reported separately below.

## 1. Network round trip, Riyadh -> Supabase

### 1a. Cold request (new TCP+TLS each time), curl `-w` timing, 30 runs each

Tokyo project (`/auth/v1/health`, publishable key):

| phase (cumulative) | p50 | p95 |
|---|---|---|
| DNS | 2.3 ms | 3.5 ms |
| TCP connect | 103.8 ms | 138.6 ms |
| TLS done | 230.1 ms | 262.0 ms |
| TTFB | **589.0 ms** | **1,037.8 ms** |
| server+network after TLS (ttfb - tls) | 351.5 ms | 803.3 ms |

Tokyo project, trivial REST RPC (`POST /rest/v1/rpc/get_public_config`): TTFB p50 **587.8 ms**, p95 **1,038.5 ms**; ttfb-tls p50 362.8 ms.
Repeat run interleaved with Mumbai (30 runs): Tokyo TTFB p50 593.7 / p95 1,155.6 ms.

Mumbai project (same method, interleaved, 30 runs): TTFB p50 **489.0 ms**, p95 **705.5 ms**; ttfb-tls p50 249.4 ms. Also enters Cloudflare at MRS.

`ping` to the Cloudflare anycast address: avg 112.5 ms (min 94.8, max 147.3), 10 packets, 0 % loss. TCP handshake (connect - dns) p50 ~104 ms for both projects, i.e. Riyadh -> Marseille edge.

### 1b. Warm request (keep-alive, same connection reused; this is what a browser tab does)

curl with 5 URLs on one connection (`num_connects` 1 then 0):

| target | request 1 (new conn) | requests 2-5 (reused) |
|---|---|---|
| Tokyo | 648 ms | **408, 459, 418, 368 ms** |
| Mumbai | 440 ms | **226, 241, 241, 242 ms** |

Small sample (n=4 warm per target), but consistent with the logs below. **Per-request network penalty of Tokyo vs Mumbai from this ISP: ~170 ms warm.**

### 1c. Real production requests (Supabase edge logs, last 24 h)

`response.origin_time` = Cloudflare edge -> Supabase origin and back; `x_envoy_upstream_service_time` = time inside the API service (PostgREST/Auth/Storage incl. DB).

| Saudi entry colo | requests | origin p50 | origin p95 | upstream p50 |
|---|---|---|---|---|
| MXP Milan | 18,709 | **249 ms** | 1,038 ms | **3 ms** |
| MRS Marseille | 1,073 | 288 ms | 1,283 ms | 0 ms |
| RUH Riyadh | 819 | 240 ms | 1,778 ms | 13 ms |
| JED Jeddah | 156 | 269 ms | 792 ms | 13 ms |
| (for comparison) JP NRT, server-side callers | 3,462 | 36 ms | 237 ms | 22 ms |

Saudi traffic by type:

| kind | requests | origin p50 / p95 | upstream (server) p50 / p95 |
|---|---|---|---|
| REST tables/views | 11,980 | 243 / 841 ms | 11 / 276 ms |
| storage | 4,553 | 288 / 1,319 ms | 0 / 0 ms (not reported) |
| RPC | 3,178 | 251 / 813 ms | 12 / 229 ms |
| realtime ws | 613 | 118 / 340 ms | - |
| auth | 430 | 245 / 952 ms | 8 / 129 ms |

**Conclusion of section 1:** for a median Saudi request, ~230-245 ms of the ~250 ms origin time is the Europe-edge -> Tokyo network leg; the server itself answers in ~10-20 ms. On top of that the user pays Riyadh -> European edge (~104 ms TCP RTT measured). The client-observed total per request is therefore roughly 350-450 ms warm (measured 368-459 ms) before any DB work.

## 2. Database execution time (server side, network excluded)

Method: `execute_sql`, inside a transaction that was ROLLED BACK, impersonating a real approved KSA Manager (`set local role authenticated` + `request.jwt.claims`) so RLS applies. Timings by `clock_timestamp()` around each call with the result size referenced (not optimised away). Run 1 = first touch (may be cold cache), run 2 = immediately after.

| read | run 1 | run 2 | payload |
|---|---|---|---|
| `get_cost_cpk_overview('KSA', null, today-365, today)` | 5,303 ms | **1,115 ms** | 13.7 kB |
| `get_maintenance_snapshot(null,'KSA', today-365, today)` | 13,617 ms | **579 ms** | 4.7 kB |
| `get_parts_expense_snapshot(null,'KSA', ...)` | 512 ms | 320 ms | 4.3 kB |
| `v_inv_balances where country='KSA' order by id limit 50` | 323 ms | **279 ms** | 34.7 kB |
| `v_inv_movements order by posted_at desc limit 200` | 404 ms | **291 ms** | 224.8 kB |
| `v_inventory_valuation limit 200` | 20 ms | 15 ms | 123 kB |
| `vehicle_fleet KSA order by asset_no,id limit 1000` (fleet register page) | 18 ms | 10 ms | 115 kB |

`EXPLAIN (ANALYZE, BUFFERS)` of `v_inv_balances ... limit 50` under RLS: **356 ms, 37,748 shared buffers**. Breakdown:
- `Seq Scan on stock_records` 217.6 ms for 5,569 rows. The filter calls `inv_blind_hides_balance(organisation_id, site, location_id, item_id)` **once per row**. That function is `LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public`, so it can never be inlined: ~37 us x 5,569 rows.
- Planner estimate **rows=1 vs actual 5,569**, so it chose nested loops: `material_master` index probe x5,569 (16,633 buffers) and a **seq scan of `inventory_locations` x5,569 loops** (13,708 buffers).
- It sorts all 5,569 rows to return 50 (no usable index for `order by id` after the filter).

pg_stat_statements (window since 2026-11-23 10:05 UTC, ~1.5 days):

| statement | calls | mean | total |
|---|---|---|---|
| Realtime WAL decoder `SELECT wal->>...` | 75,141 | 15.4 ms | **1,159 s** (largest by far) |
| PostgREST `v_inv_balances` | 123 | **644 ms** | 79 s |
| PostgREST `stock_records` | 124 | **517 ms** | 64 s |
| `cron_health_watch()` | 262 | 219 ms | 57 s |
| PostgREST `v_inventory_valuation` | 41 | 758 ms | 31 s |
| PostgREST `v_inv_movements` | 41 | 749 ms | 31 s |
| PostgREST `v_inv_valuation` (country filter) | 8 | **3,598 ms** (max 7,939) | 29 s |
| `workshop_status_notify_scan()` | 22 | 1,385 ms | 31 s |
| `scan_due_alerts()` | 22 | 1,261 ms | 28 s |
| `anum_integration.pre_request()` (runs on every API request) | 9,128 | 1.4 ms | 12.7 s |
| one-off `inv_material_canonical_propose` / `inv_opening_batch_create` imports | 1 each | 70-75 s each | - |

Note the PostgREST means for `v_inv_balances` (644 ms) and `stock_records` (517 ms) are higher than my direct measurement because PostgREST adds `count=exact` and JSON shaping.

Performance advisor (`get_advisors performance`, full output read, 6 lint groups): auth_rls_initplan 313 (none on stock_records, material_master, inventory_locations, inventory_audits, tyre_records, inspections, vehicle_fleet, profiles, work_orders); multiple_permissive_policies 513 (10 on hot tables: inspections, material_master, profiles, tyre_records, vehicle_fleet, work_orders); unindexed_foreign_keys 169 (4 on inventory_audits / inventory_locations / stock_records); unused_index 954; no_primary_key 209 (mostly `_bak`); Auth server capped at 10 DB connections (absolute).

### Network vs DB, side by side (median Saudi user, warm connection)

| screen read | DB time (measured, warm) | network (measured, per round trip) | share that is network |
|---|---|---|---|
| fleet register page of 1,000 | ~10 ms | ~370-460 ms | **~97 %** |
| config/bootstrap RPC (upstream p50 8-23 ms in logs) | ~10-20 ms | ~370-460 ms | **~95 %** |
| `v_inv_balances` 50 rows | ~280 ms | ~370-460 ms | ~60 % |
| `get_maintenance_snapshot` | ~580 ms warm / 13.6 s cold | ~370-460 ms | 40 % warm |
| `get_cost_cpk_overview` | ~1.1 s warm / 5.3 s cold | ~370-460 ms | 25 % warm |

So for the large majority of calls (95 % of SA requests have upstream p50 <= 20 ms) the region is the cost; for the inventory hub and cost dashboards the DB work is also significant and is fixable without moving anything.

## 3. Root causes, ranked

1. **Region distance (dominant for ~all requests).** Saudi traffic enters Cloudflare in Milan/Marseille, then crosses to Tokyo: ~245 ms per request on the edge->origin leg alone (logs, n=18,709), ~370-460 ms per request end to end warm (measured). Every sequential round trip on a page pays this.
2. **Inventory views evaluate a SECURITY DEFINER function per row** (`inv_blind_hides_balance`), plus a 1-row planner estimate that produces nested-loop seq scans. 280-650 ms per call, called 123+ times in 1.5 days.
3. **Cold cache on a 256 MB `shared_buffers` instance.** Same RPC: 5.3 s vs 1.1 s, 13.6 s vs 0.58 s. Users who open a cost page first in the morning get the cold number. (Compute tier, not SQL.)
4. **Chatty bootstrap/config reads, each a full intercontinental round trip.** 24 h SA counts: profiles 866, `get_organisation_configuration` 540, `system_config` 414, `get_my_access_grants` 405, `get_user_module_permissions` 389, `modules` 281, `get_org_branding` 271, `get_my_capabilities` 262, `country_addresses` 261. These change rarely.
5. **Sequential reads that could run in parallel, and chunk loops that run one chunk at a time** (section 4).
6. **Realtime WAL decoder** is the largest DB consumer (1,159 s in ~1.5 days). Not user latency directly but competes for the small cache.
7. Storage reads: 4,553 SA requests, p50 288 ms / p95 1,319 ms origin, served from Tokyo.

## 4. Optimisations that do not need a migration (do these first)

DB (each needs a migration + your approval to apply; none applied):

1. **`inv_blind_hides_balance`**: evaluate the caller's open blind audits ONCE per query instead of per row. Options: (a) make the view join a CTE/subquery `select ... from inventory_audits where blind and auth.uid() in (counter_id, recount_counter_id) and open` (zero or few rows) and anti-join, instead of a per-row DEFINER call; or (b) short-circuit with an InitPlan `(select exists(open blind audit for me))` so the per-row function only runs when the user actually has a blind audit (almost never). Expected: removes ~217 ms of the 356 ms plan (measured seq scan share). Verify with the same rolled-back EXPLAIN.
2. Fix the rows=1 estimate on `stock_records` (it comes from the opaque function); once (1) is done re-check that `inventory_locations` is hashed, not looped 5,569 times. Add the 4 missing FK indexes on stock_records / inventory_locations / inventory_audits flagged by the advisor.
3. `v_inv_valuation` with a country filter: mean 3.6 s, max 7.9 s - EXPLAIN it under RLS next (NOT MEASURED in detail this session).
4. Cold-cache: compute tier upgrade (more RAM / shared_buffers) is the only real lever for the 5-14 s first-hit numbers; the repo's own memory already records that 256 MB vs a 679 MB `audit_log_v2` keeps the DB I/O bound.

Frontend (repo `/Users/anum/Documents/wt-inv-layout`, branch HEAD `d964664f`):

5. `src/pages/StockManagement.jsx:278` then `:284` - `listStockRecords` and `listTyreIssuesSince` are awaited one after the other but are independent. Run them with `Promise.all`; saves one full set of round trips (~400 ms+ per page open from Riyadh).
6. `src/lib/configurationStore.js:4` and `:54` - every `getConfiguration`/`listConfiguration` is an uncached RPC (540 calls/day from SA). Add a per-session in-memory cache keyed by namespace (the file already has a scope/generation invalidation mechanism to hang it on), and load each namespace once instead of key by key.
7. `src/contexts/AuthContext.jsx:321-330` and `:396-398` - the 4-5 access RPCs are already parallel (good), but `refreshAccess` re-runs them on refocus. Combine `get_user_module_permissions` + `get_my_access_grants` + `get_my_capabilities` (+ role caps) into ONE RPC returning a single JSON; saves 3 round trips per login and per refocus.
8. Config tables read directly on many pages: `system_config` (`src/lib/api/systemConfig.js:229`, `mobileOps.js:29/48/62/84`, `brandLogo.js:39/62`, `adminAccess.js:319`, `engineeringCenter.js:85/146`), `modules` (`modulesRegistry.js:62/90`). Read once into a context with a TTL (SettingsContext already loads system_config; route the others through it).
9. Sequential chunk loops that should run a bounded number in parallel (same pattern as `fetchAllPages`, which already uses concurrency 4 at `src/lib/fetchAll.js:23`):
   - `src/lib/workshopStock/service.js:36-37` (`readByIds`, 150 ids per request, one at a time)
   - `src/lib/api/floorWorkflow.js:37-39`
   - `src/lib/api/stockReconcile.js:67-68` and `:108-109`
   - `src/lib/api/profileDirectory.js:27-29` and `:100-103`
   - `src/lib/api/washRecords.js:330-331`
   - `src/lib/api/kpiTargets.js:81-82` (one read per year) and `:85-95` (one UPDATE per row)
10. N+1 writes (one round trip per row; ~400 ms each from Riyadh):
   - `src/lib/api/procurementChain.js:123-124` - one `inv_po_add_line` RPC per PO line. A 20-line PO = ~8 s of network. Add a bulk RPC taking an array.
   - `src/lib/api/correctiveActions.js:183-184` - one insert per action; batch insert.
   - `src/lib/api/erpIntake.js:292-299` - one UPDATE per changed row during import merges.
   - `src/lib/api/schedulePlanning.js:177-180`, `src/lib/api/costPerM3.js:715-720`, `src/lib/api/oemCatalogAdmin.js:81-97`, `src/lib/audit.js:183-186`, `src/lib/offlineQueue.js:215-219` - same pattern.
11. Storage: 4,553 SA storage requests/day at p50 288 ms. Use signed URLs with long `Cache-Control` / browser caching for photos that never change, and avoid re-signing on every render.
12. Edge functions that touch the DB a lot (e.g. ai-tyre-inspection p50 2.0 s, send-scheduled-reports p50 2.0 s) already run in ap-northeast-1 next to the DB; keep them there (`x-region`) after any move, i.e. move them with the DB.

The heuristic loop scan found 92 awaited calls inside loops in `src/`; the list above is the subset on interactive read/write paths. Export/PDF image fetch loops (`exportUtils.js:2250/2842`, `checklistPdf.js:513`, `photoDownload.js:78`) are also sequential and would benefit from limited concurrency.

## 5. Region comparison

| candidate | basis | per-request cost from Saudi (warm) |
|---|---|---|
| ap-northeast-1 Tokyo (current) | **MEASURED**: 368-459 ms warm (this machine); edge->origin p50 249 ms (logs) | ~400 ms |
| ap-south-1 Mumbai | **MEASURED** via the existing opsbrain project: 226-242 ms warm, cold TTFB p50 489 / p95 706 ms | ~235 ms |
| eu-central-1 Frankfurt | **ESTIMATE, not measured** (no existing project there; I did not create one). Derived: Riyadh -> MRS edge TCP RTT ~104 ms (measured) + Marseille/Milan -> Frankfurt ~10-20 ms (typical published intra-Europe RTT) + origin ~10 ms | **~120-140 ms** (estimate) |
| eu-west-3 Paris / eu-central-2 Zurich | ESTIMATE, same reasoning, similar to Frankfurt | ~120-145 ms |
| Bahrain (me-south-1) / UAE (me-central-1) | Not in the Supabase region list returned by `search_docs` (Edge Functions region list: ap-northeast-1/2, ap-south-1, ap-southeast-1/2, ca-central-1, us-east-1, us-west-1/2, eu-central-1, eu-west-1/2/3, sa-east-1). Confirm with Management API `GET /v1/projects/available-regions`. | not available (as far as checked) |

Caveat that decides the recommendation: 95.3 % of Saudi requests (logs) and this machine enter Cloudflare in **Europe**, so a European database is on their path. The ~4.7 % that enter at RUH/JED (STC/fixed lines likely) would get roughly Riyadh -> Frankfurt direct; published Riyadh-Frankfurt RTT is commonly ~80-110 ms (ESTIMATE) vs today's measured ~240-270 ms origin p50 for those colos - still a large improvement. Mumbai is good for RUH/JED-peered users but worse for the Milan/Marseille majority (traffic goes Riyadh -> Europe -> Mumbai).

**Recommended target: eu-central-1 (Frankfurt).** Before committing, prove the estimate: create a throwaway free project in eu-central-1 and in ap-south-1-is-already-measured, run the same 30x curl + warm keep-alive test from Riyadh (Zain and one STC line). That needs your approval (it creates a project).

Lower-risk alternative to a full move: a **Supabase read replica in eu-central-1** (paid add-on, requires a compute add-on). Reads (which are ~90 % of traffic here) would get the Frankfurt latency; writes, Auth and Storage stay in Tokyo. Needs approval and cost check; client must route reads to the replica endpoint (supabase-js load balancer / separate URL).

## 6. Region migration plan (Tokyo -> Frankfurt)

Supabase cannot change a project's region in place. A move = new project in the target region + migrate everything + cut clients over.

### Risk
- **High.** Production data (2.8 GB DB, 6.6 GB / 30,390 storage objects, 787 users), live mobile apps with the old URL compiled in, 28 cron jobs, pg_net callbacks, realtime, edge function secrets.
- **The project ref and URL change.** `jhssdmeruxtrlqnwfksc.supabase.co` becomes a new ref. Old Expo/Flutter builds on phones keep calling Tokyo until users update. This is the biggest risk: field users with old builds write to the OLD database after cutover.
- Hard-coded old ref in: `mobile/app.json`, `mobile/eas.json`, `.github/workflows/deploy-edge-functions.yml`, `.github/workflows/flutter-release-ios.yml`, `.github/workflows/flutter-release-play.yml`, `.github/workflows/flutter-internal-apk.yml`, `src/lib/import/enums.js`, and ~204 migration files (history only), plus DB-side `cron_config` values (edge function URLs used by pg_cron/pg_net, e.g. workflow-notify, send-scheduled-reports) and the `report_shares`/QR public links that embed the app host (app host does not change if Vercel stays).
- Auth: user passwords (bcrypt hashes) move with `auth.users`; **JWT secret differs**, so every session is invalidated - everyone signs in again (web + mobile). MFA factors move with the auth schema. OAuth/SSO redirect URLs and SAML/OIDC providers must be re-registered.
- Storage objects must be copied separately (a DB dump copies only `storage.objects` metadata, not the files).
- Vault secrets / `cron_config` secrets / edge-function secrets (RESEND_API_KEY, FIREBASE_SERVICE_ACCOUNT, Sentry token, Stripe, AI keys, WORKFLOW_NOTIFY_SECRET, cron secret) must be re-created; vault-encrypted values need re-entry because the key differs.
- Extensions present: pg_cron, pg_net, vector, pgcrypto, pg_stat_statements, supabase_vault - all available on new projects, but cron jobs and their stored URLs/anon keys must be re-pointed.
- `_bak` schema (209 tables without PK) - decide whether to carry it.

### Cost
- NOT MEASURED (no billing access used). A second project on the same plan/compute for the overlap period (days), plus storage egress from Tokyo for 6.6 GB. If Frankfurt read replica is chosen instead: replica compute add-on monthly. Get the figure from the dashboard or `get_cost` before approval.

### Backups (before anything)
1. Confirm PITR/daily backup is current on Tokyo; take an on-demand backup.
2. `supabase db dump` (roles, schema, data separately) from Tokyo, stored outside Supabase.
3. Full storage bucket export (all 11 buckets) to local/S3.
4. Keep Tokyo project **running and untouched** until the rollback window ends.

### Steps
1. Create project in eu-central-1, same org, same or larger compute (address the 256 MB cache issue at the same time).
2. Restore roles + schema + data from the dump (Supabase "restore to new project" / migration guide). Verify row counts per table and checksums on key tables (`tyre_records`, `work_orders`, `parts_consumption`, `stock_records`, `inventory_*`, `accidents`, `profiles`, `auth.users`).
3. Copy storage objects bucket by bucket (script using service role on both sides), keeping identical paths so `tp-storage://` refs and stored paths stay valid; verify object counts (30,390) and total bytes (6,604 MB).
4. Re-create edge functions (19 dirs in `supabase/functions/`) via CLI deploy to the new ref, with the same `verify_jwt` flags recorded in PROJECT_MEMORY (several are `verify_jwt=false` and self-validate).
5. Re-create secrets: edge function secrets, vault secrets, `cron_config` rows (new function URLs, new anon key, cron secret), Sentry config, Resend, Firebase, Stripe webhook (new endpoint URL in Stripe dashboard).
6. Re-create pg_cron jobs (they restore with the dump but contain old URLs/keys - rewrite) and confirm `cron.job_run_details` runs.
7. Auth config: site URL, redirect URLs, SMTP, providers (Google/Microsoft/SSO), CAPTCHA setting (currently off), leaked-password setting, rate limits, Auth DB connection setting (switch to percentage per advisor).
8. Realtime publication: confirm the 15 published tables.
9. RLS: comes with the schema dump; re-run the security advisor and the repo's RLS tests on the new project; spot-check impersonation results equal Tokyo (same counts per role/country).
10. Clients:
    - Vercel web: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (publishable) for Production/Preview; CSP already allows `*.supabase.co`. Redeploy.
    - Marketing site: any Supabase env if used.
    - Flutter: `SUPABASE_URL`/anon key are passed in the release workflows (`flutter-release-play.yml`, `flutter-release-ios.yml`, `flutter-internal-apk.yml`) - update secrets/values, bump version, build, publish, then raise `system_config.flutter_min_version` on BOTH old and new DB so old builds show "Update required".
    - Expo: `mobile/app.json` + `mobile/eas.json` (EXPO_PUBLIC_SUPABASE_URL / key). Expo store builds are retired; an OTA cannot be published from main (see PROJECT_MEMORY) - decide whether Expo users are forced to the Flutter app.
    - GitHub Actions: `deploy-edge-functions.yml` project ref.
11. Cutover window: freeze writes (maintenance mode flag `system_config.maintenance_mode` on Tokyo), take a final incremental dump of rows changed since step 2 (or do the full dump in the window if 2.8 GB restores fast enough - measure on the rehearsal), restore, verify, flip Vercel env, redeploy, open the new app build.
12. Keep Tokyo read-only for N days; set its `mobile_min_version`/`flutter_min_version` above all old builds so old phones stop writing there.

### Rollback
- Until clients are switched: nothing to roll back (Tokyo untouched).
- After switch: revert Vercel env vars and redeploy (minutes); mobile builds pointing to the new URL would need a rebuild, so release mobile builds only after the web cutover is stable. Any writes made in Frankfurt after cutover must be copied back - keep an audit window short and reconcile from `audit_log_v2`.

### Downtime estimate
- ESTIMATE: write freeze of **1-3 hours** for a 2.8 GB dump/restore + verification + env flip; storage copy can be done beforehand (immutable photos) with a final delta. Users must sign in again (JWT secret change). Mobile: field users are effectively blocked until they update the app. A rehearsal on a scratch project is required to replace this estimate with a measured number.

### Approvals needed (each explicit)
1. Create a test project in eu-central-1 for benchmarking (cost, even if small).
2. Choose: full migration vs Frankfurt read replica (cost + architecture).
3. Create the production project in the target region and pay for overlap.
4. Take/export backups and copy storage (data leaves Tokyo; egress).
5. Re-enter all secrets (owner holds them).
6. Change Vercel production env vars and deploy.
7. Build and release Flutter (and decide Expo) to the stores - standing owner rule: no mobile build without explicit ask.
8. The maintenance window date/time and the forced sign-in for all users.
9. Raise min-version on the old project to stop old builds.
10. Decommission Tokyo after the rollback window.

## 7. Not measured / limits
- STC / Mobily / fixed-line paths: not measured from this machine (logs show their colos only).
- Frankfurt/Paris latency: estimate only; no environment exists there and none was created.
- Per-page total load time in a real browser (DevTools waterfall): NOT MEASURED this session.
- Storage download sizes/throughput: NOT MEASURED.
- pg_stat_statements covers only ~1.5 days (stats_since 2026-11-23 10:05 UTC).
- Warm keep-alive sample is small (4 requests per target); the edge logs (n=18,709) corroborate the size of the effect.
