# Tyre Pulse staging database

A schema-only copy of the production database structure, plus invented test data, that can be stood up
anywhere: a local PostgreSQL today, a hosted Supabase project later. It exists so that tenant creation,
sign-up, imports, fixes and migrations can be tried without touching the one live database.

Status on 2026-11-12: built and measured on local PostgreSQL 16. NOT yet loaded into a hosted project
(none exists; creating one is the owner's decision). Nothing in this folder was applied to production.

## Isolation rules (read first)

1. Never production data. The only rows read from production were platform configuration rows, listed
   and reviewed below. No business table, no `profiles`, no `auth.users`, no storage object was read.
2. Never production keys. No key, token, password or connection string is stored here. Test passwords are
   generated when the seed runs and written to a file outside the repository.
3. Every script refuses to run against the production project reference.
4. The baseline replaces the production project host inside three function bodies with
   `staging-project-ref.supabase.co`, so a staging database cannot call production edge functions.
5. The local cluster lives outside the repository (scratch folder). `start.sh` refuses a path inside it.

## Folder map

| Path | What it is |
|---|---|
| `baseline/` | Ordered SQL files, zero rows, that recreate the application schemas. `MANIFEST.json` holds the expected counts |
| `local/` | `start.sh`, `stop.sh`, `reset.sh`, `env.sh`, `prereq.sql` (local stand-ins for Supabase services) |
| `hosted/00_hosted_prereq.sql` | The few statements a hosted Supabase project needs before the baseline |
| `seed/` | `00_reference.sql` (platform configuration), `generate_seed.py` (synthetic companies), `run_seed.sh` |
| `tests/` | `run_tests.py` (isolation tests), `apply_pending_and_retest.sh` (try drafted fixes on a copy) |
| `tools/` | `build_baseline.py`, `load_baseline.py`, `verify_baseline.py`, `build_reference_seed.py`, `extract_queries.sql`, `defer.json` |

## Run locally

Needs PostgreSQL 16 server binaries, the `pgvector` package (`apt install postgresql-16-pgvector`), `psql`,
and a Python 3 with `psycopg2` (`pip install psycopg2-binary`).

```
supabase/staging/local/reset.sh        # destroy, initdb, prerequisites, baseline, verify, seed
supabase/staging/local/start.sh        # start an existing cluster (creates it on first run)
supabase/staging/local/stop.sh
python3 supabase/staging/tests/run_tests.py --dsn "host=127.0.0.1 port=54329 dbname=tyrepulse_staging user=postgres"
supabase/staging/tests/apply_pending_and_retest.sh   # copy the database, apply drafted fixes, rerun tests
```

Settings (environment variables, all optional): `STAGING_ROOT` (cluster folder, must be outside the
repository), `STAGING_PORT` (default 54329), `STAGING_DB`, `PGBIN`, `STAGING_PYTHON`, `SKIP_SEED=1`,
`STAGING_ACCOUNTS_FILE`. A full reset takes about 15 seconds.

When run as root the scripts start PostgreSQL inside a user namespace that maps root to the `postgres`
user id, because PostgreSQL refuses to run as root. No file changes owner.

## What the baseline contains (measured, production catalog versus local load)

| Object | Production | Loaded |
|---|---|---|
| Tables (7 application schemas) | 497 | 497 |
| Functions (extension functions excluded) | 1,127 | 1,127 |
| Policies on application tables | 4,433 | 4,433 |
| Policies on `storage.objects` | 31 | 31 |
| Constraints | 1,635 | 1,635 |
| Indexes not owned by a constraint | 1,168 | 1,168 |
| Views | 21 | 21 |
| Triggers (one kept disabled, as in production) | 512 | 512 |
| Sequences | 44 | 44 |
| Tables with row level security on | 492 | 492 |
| Functions executable by anon / authenticated / service_role | 148 / 764 / 1,074 | 148 / 764 / 1,074 |
| Tables and views selectable by anon / authenticated | 0 / 478 | 0 / 478 |

Load result: 14,857 statements, 0 failed, 0 needed a retry. All 1,127 function bodies were re-created with
`check_function_bodies = on` and validate against the loaded schema (0 failures).

Schemas included: `public`, `approval_private`, `private`, `workforce_internal`, `ai_tyre_private`,
`anum_integration`, `administration_imports`. Also, by hand: the structure of `backups` (3 tables, 4
functions) and `erp_promote_bak.promotion_log`, and the two application triggers on `auth.users`.

Order of the files: schemas, sequences, functions, tables, functions that need a table row type,
constraints, indexes, views, functions that need a view row type, triggers, row level security switches,
policies, storage policies, grants, miscellaneous, auth triggers. `load_baseline.py` runs every statement
on its own, retries failures after the rest, and lists anything unresolved. In the committed order nothing
needs a retry, so plain `psql -f` in file name order also works.

## What is NOT covered (stated, not hidden)

- Comments on tables, columns, functions and policies were not extracted.
- Table and function OWNERS are not reproduced: everything is owned by the loading role. In production
  everything in these schemas is owned by `postgres`, which is also the loading role on a hosted project.
- The `MAINTAIN` privilege (PostgreSQL 17 only) is skipped.
- `_bak`, `data_cleanup_backups` and the rest of `erp_promote_bak` are not created (one `_bak` table that a
  function names exists as an empty stand-in locally).
- `backups._do_snapshot` and `backups.run_restore_test` are simplified stand-ins.
- The 27 cron jobs are not scheduled. Job names and schedules were read (no commands); nothing runs.
- Edge functions (18), auth settings, storage objects, vault secrets, `cron_config`: not copied.
- Policies in schemas other than the seven application schemas and `storage` (for example `realtime`).
- Role settings other than the PostgREST pre-request hook (statement timeouts of anon and authenticated).
- Checklist templates, option sets, site aliases, brand aliases, departments, routing rules, approval
  policies, AI model rows: customer shaped, so NOT copied. Staging starts without them.
- Function bodies are verbatim. A scan of the whole baseline found no email address, phone number, JWT,
  key pattern, mailbox domain or site name. Business constants that are already in the repository's own
  migrations (for example the fallback company id) remain.
- Runtime behaviour of functions that call the network, cron or vault is not exercised: those calls hit
  local stand-ins.

## Local stand-ins (stubs), all in `local/prereq.sql`

| Stub | Replaces | Behaviour |
|---|---|---|
| Roles `anon`, `authenticated`, `service_role`, `authenticator`, `supabase_admin`, `supabase_auth_admin`, `supabase_storage_admin`, `dashboard_user` | Supabase roles | same attributes that matter (service_role and postgres bypass RLS) |
| `auth.users`, `identities`, `sessions`, `refresh_tokens`, `mfa_factors`, `audit_log_entries`, `sso_providers`, `sso_domains` | GoTrue tables | minimal columns, empty |
| `auth.uid()`, `auth.role()`, `auth.jwt()`, `auth.email()` | GoTrue helpers | read `request.jwt.claims`, as on Supabase |
| `storage.buckets`, `storage.objects`, `storage.foldername()`, `filename()`, `extension()` | Storage | tables with RLS on, no files |
| `cron.job`, `cron.job_run_details`, `cron.schedule()`, `unschedule()`, `alter_job()` | pg_cron | records the job, never runs it |
| `net.http_post()`, `net._http_response`, `net._stub_requests` | pg_net | records the request without Authorization or apikey headers, never sends |
| `vault.decrypted_secrets` | Vault | always empty |
| `extensions.pg_stat_statements`, `pg_stat_statements_info`, `pg_stat_statements_reset()` | pg_stat_statements | empty |
| publication `supabase_realtime` | Realtime | exists, nothing consumes it |
| `_bak.cron_run_details_20261011` | one snapshot table | empty |
| Not stubbed because nothing in the baseline names them | pgmq, wrappers, pg_graphql, hypopg, index_advisor | absent |

Real extensions used locally: `pgcrypto` and `uuid-ossp` (schema `extensions`), `vector` (schema `public`).

## Differences from production

| Topic | Production | Local staging |
|---|---|---|
| PostgreSQL | 17.6 | 16 |
| Auth, storage, realtime, edge functions | real services | database stand-ins only, no HTTP API |
| Cron | 27 active jobs | none |
| Outbound calls (email, push, AI, webhooks) | real | recorded in `net._stub_requests`, never sent |
| Data | one live company | three invented companies |
| `system_config` | live values | same keys; mail, push, AI, backup and 2FA switches off; mailboxes and logo replaced |
| Sign-in | GoTrue | not available locally; tests impersonate with `request.jwt.claims` |

## Reference rows copied from production (the only rows read)

Each table is platform configuration. Checked after extraction: 0 email addresses, 0 URLs, 0 tokens, 0
phone numbers. Columns that can name a person were removed inside the extraction query.

| Table | Rows | Note |
|---|---|---|
| `modules` | 197 | id, name, category, status, visibility. `note` and `updated_by` not read |
| `module_permissions` | 538 | global rows for built-in role names only. Rows for customer-defined role names not read |
| `country_currency` | 3 | KSA, UAE, Egypt |
| `subscription_plans` | 4 | platform plans and limits |
| `system_config` | 62 keys | value kept only when a plain boolean or number; every other value is a staging placeholder |
| `metric_registry`, `metric_versions` | 12, 12 | owner and approver columns not read |
| `upload_feeds` | 35 | table and column names |
| `quality_rules` | 10 | owner and alert recipient not read |
| `event_consumers` | 8 | function names |
| `due_alert_rules` | 8 | recipient roles cut to built-in role names |
| `data_assets`, `lineage_edges`, `dashboard_registry`, `widget_bindings` | 34, 36, 15, 24 | metadata about metrics and screens |
| `storage.buckets` | 9 | bucket names and size limits only, all private |

## Synthetic seed

Invented companies, sites, vehicles, tyres, people. Emails end `@staging.tyrepulse.invalid`.

| Company | Vehicles | Tyre records | Job cards | Expense lines | Inspections | Accidents | Stock rows | Users |
|---|---|---|---|---|---|---|---|---|
| Alpha Readymix Co | 52 | 569 | 689 | 732 | 60 | 4 | 12 | 7 + platform owner |
| Beta Haulage LLC | 46 | 489 | 609 | 674 | 60 | 4 | 12 | 7 |
| Gamma New Fleet (empty) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |

Both companies have sites in KSA, UAE and Egypt, mixers, pumps, wheel loaders, pickups and trailers, tyre
fitment and removal history with kilometres, and prices in SAR, AED and EGP by country (about one tyre in
eight deliberately has no price). Both use the SAME asset codes (`TM001`, `PL001`, ...) so isolation is
tested on equal keys. Alpha reuses the id that 20 functions name as their fallback company, so those
functions run unchanged; only the id value is reused.

Test accounts (passwords are in the generated file, never in the repository):

| Username | Company | Role | Country scope |
|---|---|---|---|
| `alpha.admin`, `beta.admin` | Alpha, Beta | Admin (customer admin) | KSA, UAE, Egypt |
| `alpha.manager`, `beta.manager` | Alpha, Beta | Manager | KSA |
| `alpha.director`, `beta.director` | Alpha, Beta | Director | KSA, UAE, Egypt |
| `alpha.engineer`, `beta.engineer` | Alpha, Beta | Tyre Engineer (custom role) | UAE |
| `alpha.tyreman`, `beta.tyreman` | Alpha, Beta | Tyre Man | KSA |
| `alpha.inspector`, `beta.inspector` | Alpha, Beta | Inspector | Egypt |
| `alpha.driver`, `beta.driver` | Alpha, Beta | Driver | KSA |
| `gamma.admin` | Gamma | Admin | KSA, UAE, Egypt |
| `platform.superadmin` | platform (sits in Alpha, as in production) | Admin, super admin | all |

Email is `<username>@staging.tyrepulse.invalid`. All accounts are approved, unlocked, site scope ALL.

## Tests

`tests/run_tests.py` impersonates seeded users (role `authenticated` plus `request.jwt.claims`) inside
transactions that are always rolled back, and confirms every write with a privileged recount.

- A: no cross-company read, both directions, 7 roles each, on all 363 tables that carry `organisation_id`.
- B: no cross-company insert, update, delete or move, both directions, with an own-company control.
- C: country scoping inside a company, read and write, with a control row.
- D: the empty company reads zero rows of others, 28 key RPCs return without error, first vehicle lands in it.
- T: findings TEN-1 to TEN-9, each split into sub-checks, reported as REPRODUCES, PARTIAL or NOT REPRODUCED.

Result on the baseline as extracted (before-state): A to D 35 of 35 pass. TEN-1, 2, 3, 5, 6, 7, 9
reproduce in full; TEN-4 and TEN-8 are partial (`admin_set_web_access` already refuses another company;
a service load is already refused when `single_tenant_mode` is false).

## Loading into a hosted Supabase project later

Not done yet and not tested. Steps for the owner, in order:

1. Create a NEW project in a separate (free) organisation. Never a branch of production, never the
   production project. Region and name are free choices. Note its project reference and database password.
2. Connection string: Project Settings, Database, direct connection, role `postgres`. Keep it in a shell
   variable only, for example `STAGING_DSN`. Do not write it into any file in the repository.
3. `psql "$STAGING_DSN" -f supabase/staging/hosted/00_hosted_prereq.sql` (do NOT run `local/prereq.sql`).
4. `python3 supabase/staging/tools/load_baseline.py --dsn "$STAGING_DSN" --baseline supabase/staging/baseline --report /tmp/load_report.json`
5. `python3 supabase/staging/tools/verify_baseline.py --dsn "$STAGING_DSN" --baseline supabase/staging/baseline`
6. `psql "$STAGING_DSN" -f supabase/staging/seed/00_reference.sql`
7. `python3 supabase/staging/seed/generate_seed.py --dsn "$STAGING_DSN" --accounts-out ~/staging_test_accounts.txt`
8. `python3 supabase/staging/tests/run_tests.py --dsn "$STAGING_DSN"`
9. In the hosted dashboard: confirm the 9 storage buckets exist and are private; leave cron jobs
   unscheduled; set edge function secrets only if a function is deployed there, with staging values.

Expected differences on a hosted project, to check on the first load: statements that alter
`authenticator`, the realtime publication, default privileges, triggers on `auth.users` and policies on
`storage.objects` need the `postgres` role of that project (they are normal there, but they are the
statements to look at first if the load report lists a failure). The seed writes `auth.users` and
`auth.identities` directly with a bcrypt hash; if sign-in fails for a seeded user, recreate that user
through the dashboard and keep the profile row.

Application settings, NAMES only (values come from the staging project and are never committed):

| App | Names |
|---|---|
| Web (Vite) | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_APP_ENV` (set to `staging`); leave `VITE_SENTRY_DSN`, `VITE_POSTHOG_KEY`, `VITE_TURNSTILE_SITE_KEY` empty |
| Flutter (`--dart-define`) | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `APP_ENV` (staging), `APP_VERSION`; leave `SENTRY_DSN` empty |
| Expo (retired) | `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_ENV` |

Use a separate Vercel preview environment or a local `.env.local` (already ignored by git) for the web
values. Never place the staging service role key in any client setting.

## Regenerating the baseline

1. Run the generator queries in `tools/extract_queries.sql` against the source catalog (read-only, catalog
   tables only) and save each JSON result as `raw/<name>.json`.
2. `python3 tools/build_baseline.py <raw_dir> baseline tools/defer.json`
3. `local/reset.sh`, then check the count table and the load report. Update `tools/defer.json` only if a
   function newly needs a table row type (the load report lists first-pass failures).
