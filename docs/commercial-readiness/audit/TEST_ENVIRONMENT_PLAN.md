# Test Environment Plan

Date: 2026-11-12. Status: PLAN ONLY. Nothing was created, enabled or changed. Every step that costs money or
creates a service is marked **needs owner approval**.

## 1. Why this is needed (both verdicts)

- Internal Production Readiness: at risk without it. Every migration, edge function deploy and probe today
  runs against the one live database the current company works in. Past sessions measurably slowed it.
- Commercial SaaS Readiness: blocked without it. Tenant creation, sign-up, Stripe, trial expiry and
  suspension (findings CF-01 to CF-08) cannot be tested on production, because the tests need writes, a second
  tenant and fake payments.

## 2. What exists today (VERIFIED with read-only calls)

| Item | Value | Source |
|---|---|---|
| Supabase organisation plan | Pro | `get_organization` |
| Projects in the organisation | 2: `Tyre_pulse` (Tokyo, `ap-northeast-1`, Postgres 17.6) and `opsbrain` (Mumbai) | `list_projects` |
| Database size | 2,650 MB | `pg_database_size` |
| Branching | Already switched on once. One branch record exists: the default branch `main`, created 2026-06-11, `with_data: false`, status **MIGRATIONS_FAILED** | `list_branches` |
| Migrations recorded in the database | 1,089 (first `20260609044306`, last `20261112082058`) | `supabase_migrations.schema_migrations` |
| Migration files in `supabase/migrations` | 301 (first `20260830073937`) | repository |
| Older root files `MIGRATIONS_V*.sql` | 576, not in the folder a branch reads | repository |
| Overlap | Of the first 170 repository files, 50 match a recorded version; the database recorded 224 migrations in the same period. 734 recorded migrations are older than the first repository file | SQL comparison |
| `supabase/seed.sql` | does not exist | repository |
| `supabase/config.toml` | exists, declares `major_version = 15` while production is 17 | repository |
| Extensions in use | pg_cron, pg_net, pgcrypto, vector, pgmq, supabase_vault, pg_graphql, uuid-ossp, wrappers, hypopg, index_advisor, pg_stat_statements | `pg_extension` |
| Extra schemas | `backups`, `_bak`, `approval_private`, `administration_imports`, `private`, `anum_integration`, `workforce_internal`, `ai_tyre_private`, `erp_promote_bak`, `data_cleanup_backups` | `pg_namespace` |
| Cron jobs | 27 active | `cron.job` |
| Storage buckets | 9, all private | `storage.buckets` |
| Edge functions | 18 deployed | `list_edge_functions` |
| In-repository database tests | 45 files under `supabase/tests`, run on PGlite with hand-built fixtures | repository |

## 3. Can a Supabase branch be used?

**Available on the plan: yes.** Branching is offered on paid plans and the organisation is on Pro.

**How it is billed (documentation quotes):**
- "There is no fixed fee for a Preview branch. You only pay for the usage it incurs. A branch running on the
  default Micro Compute size starts at $0.01344 per hour." (Manage Branching usage)
- "Each Preview branch is a separate environment with all Supabase services... You're charged for usage within
  that environment, such as Compute, Disk Size, Egress, and Storage, just like the project you branched from."
- "Usage by Preview branches counts toward your subscription plan's quota. Branches are not covered by the
  Spend Cap."
- "Do Compute Credits apply to Branching Compute? No."
- Compute is billed per started hour.

Worked figure from those quotes: a Micro branch left running for a full month is about 730 hours x 0.01344 =
about USD 10 per month, plus any disk, egress and storage it uses. A branch used 4 hours a day on working days
is about USD 1.20 per month.

**Unknown, and stated as unknown:** the size the branch would actually be given (the quote says "default
Micro"; the production compute size was not readable with the tools available), whether a persistent branch
pauses when idle, disk charges for a branch above the plan allowance, and any change to these prices after the
documentation was read today.

**What a branch copies:** "New branches do not start with any data from your main project." A branch gets a
new empty database, then runs the files in `supabase/migrations`, then an optional `seed.sql`, then deploys
edge functions. It has its own URL and API keys. Auth users, storage files, secrets and cron job rows are not
copied.

**Why a branch will not work as the repository stands (VERIFIED):** the existing branch record already shows
`MIGRATIONS_FAILED`. The reasons are structural:
1. The repository holds 301 of 1,089 migrations. The first 734 exist only in the database history (or as root
   files a branch does not read). Replaying 301 files onto an empty database fails at the first statement that
   alters a table that was never created.
2. Many changes were applied through the SQL editor with no file at all (project memory records this for
   VACUUM runs, several function rewrites and all data fixes).
3. File timestamps and recorded versions differ for most files, so "which files are already applied" cannot
   be matched by version.
4. Many migrations contain one-off data repairs for the current customer that assume its rows exist.

So branching needs a baseline first (section 5). This is the same work the alternatives need.

## 4. Options compared

| | A. Supabase persistent branch | B. Second Supabase project (free tier) | C. Local Supabase in Docker (developer machine and CI) |
|---|---|---|---|
| Cost | About USD 10 per month if always on, usage based, not capped | USD 0. Free projects pause after inactivity and have small limits; the free organisation is separate from the paid one | USD 0 |
| Creates a service | Yes | Yes | No |
| Isolation from production | Separate database and keys, but same organisation, same dashboard, one click from merge-to-production | Fully separate organisation, keys and billing; cannot be merged into production by accident | Total; no network path to production |
| Customer data risk | None copied by design | None unless someone loads a dump with data | None |
| Schema fidelity | Exact once the baseline replays | Exact from a schema-only dump; extension availability on the free tier must be checked (pg_cron, pg_net, vector, pgmq) | Exact for Postgres objects; pg_cron and pg_net behave differently locally |
| Edge functions and Stripe webhook | Yes, public URL | Yes, public URL | Functions run locally; Stripe needs the Stripe CLI to forward events |
| Mobile app testing | Yes | Yes | No (phones cannot reach it) |
| Automated tests on every pull request | Possible (GitHub integration) | Manual | Yes, the natural fit |
| Main weakness | Needs the baseline; branch merge would push the baseline to production if misused | Drifts from production unless refreshed deliberately | Not shareable; no real auth email, push or cron |

## 5. The baseline every option needs

A schema-only snapshot of production, taken once, becomes migration zero.

- Tool: `supabase db dump` (wraps `pg_dump --schema-only`) for schemas `public` and the private app schemas;
  a second roles-only dump. No `--data-only` run is ever made against production.
- Exclude: schemas `_bak`, `backups`, `data_cleanup_backups`, `erp_promote_bak` and every table whose name
  starts with `_` (they are snapshots of customer rows; their structure is not needed).
- Not included by a schema dump and handled separately: `cron.job` rows (re-create from a reviewed list),
  storage buckets (9 names, all private), `system_config` and `subscription_plans` reference rows,
  `country_currency`, `modules`, `module_permissions` global rows, checklist option sets. These are
  configuration, not customer data, and go into a small reviewed reference seed. Each table in that seed must
  be checked for customer content first (for example `system_config` holds email addresses and a logo URL:
  those keys are replaced with placeholders).
- Never dumped: `auth.users`, `auth.identities`, `profiles`, any business table, `vault.secrets`,
  `cron_config` (holds secrets), storage objects, edge function secrets.
- Hard-coded company id: 20 functions and one column default name the current company's id. The synthetic
  seed creates an organisation with that same id as "Test Company A" so those functions run unchanged. No
  customer row carries over; only the id value is reused.
- After the baseline, the 301 existing files are marked as already applied (or archived) and new work
  continues as ordinary migration files. From then on a branch or a fresh project replays cleanly.
- Proof step: restore the baseline into a local Postgres 17 and run the 45 existing `supabase/tests` files
  and a table, policy and function count comparison against production (485 tables, policy count, function
  count). A mismatch means the dump missed a schema.

## 6. Guaranteeing no customer data, passwords or secrets cross over

1. The only production read is a schema-only dump. The command line is reviewed before it runs and contains
   no data flag.
2. The dump file is scanned before use: no `COPY`, no `INSERT INTO`, no email pattern, no `eyJ` token
   pattern, no known customer name. A hit stops the process.
3. Column defaults and function bodies are scanned for literals (site names, the support email, phone
   numbers). Known hits today: function bodies with the company id (kept on purpose, section 5) and classifier
   token lists that contain brand names (not personal data).
4. The test environment gets its own keys. Production keys are never set there. Names only:
   `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `RESEND_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
   `FIREBASE_SERVICE_ACCOUNT`, `TWILIO_*`, `WORKFLOW_NOTIFY_SECRET`, `AI_WORKER_SECRET`. For the test
   environment, mail, push, WhatsApp and AI keys are left unset or set to sandbox values so nothing can reach a
   real person; the functions already degrade cleanly when a key is missing.
5. Auth users are created fresh with invented names and the synthetic email domain.
6. The reference seed is reviewed line by line once and then lives in the repository.

## 7. Synthetic data

No reusable seed exists today (the demo organisation was built by hand; `scripts/provision-driver-accounts.mjs`
is specific to the current company). Reuse instead of inventing:
- The importer's own CSV templates (`src/lib/import/templates.js`) define valid columns for fleet, tyres,
  stock, accidents, inspections, work orders, warranty, gate pass, suppliers and drivers. A small generator
  script fills them with invented assets (the marketing site already uses invented codes such as MX-214).
- The test harnesses in `supabase/tests/fixtures` show the minimum platform rows each module needs.
- Two tenants are seeded: "Test Company A" (reusing the fixed id, three countries, about 60 vehicles, 600 tyre
  rows across fitted, removed and scrapped, 12 months of expense lines in SAR, AED and EGP, job cards,
  inspections with tyre conditions, meter readings so CPK is measurable) and "Test Company B" (one country,
  20 vehicles, deliberately reusing A's asset numbers, job card numbers and employee ids to exercise CF-09).
- The same generator later rebuilds the production demo organisation (finding CF-17), always with an explicit
  organisation id and a guard that refuses the live company's id.

## 8. Pointing the apps at it (names only)

| Piece | Setting |
|---|---|
| Web app (Vercel preview or a second Vercel project) | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`; leave `VITE_SENTRY_DSN` and `VITE_POSTHOG_KEY` unset or pointed at test projects; `VITE_TURNSTILE_SITE_KEY` unset |
| Edge functions | deployed to the test project with `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (set by the platform), `ALLOWED_ORIGINS` (test web origin), `APP_URL` (test web origin) |
| Stripe test mode | `STRIPE_SECRET_KEY` (test key), `STRIPE_WEBHOOK_SECRET` (secret of a test-mode webhook endpoint that targets the test project's `billing-webhook` URL). Events to subscribe: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, and after CF-06 the three `invoice.*` events |
| Flutter | build with dart-defines for the Supabase URL and anon key of the test project and `APP_ENV=staging`; a separate application id suffix so it installs beside the real app |
| Cron | only the jobs under test are scheduled; `cron_config` gets test-only secrets |
| Vercel note | previews are suppressed for working branches in `vercel.json` to protect the daily deployment limit; use one named staging branch or a separate Vercel project |

## 9. Test accounts to create there

| Account | Tenant | Role | Scope | Purpose |
|---|---|---|---|---|
| platform.owner | none (super admin) | Admin, super admin, 2FA on | all | console, tenant creation, export |
| a.admin | Test Company A | Admin | all countries | tenant admin without super rights |
| a.manager.ksa | Test Company A | Manager | KSA, all sites | country wall |
| a.manager.site | Test Company A | Manager | KSA, one site | site wall (never exercised in production) |
| a.tyreman | Test Company A | Tyre Man | KSA | mobile inspection, scrap |
| a.driver | Test Company A | Driver | KSA | meter log, washing |
| a.pending | Test Company A | Reporter, not approved | none | approval gate |
| b.admin | Test Company B | Admin | its one country | second tenant owner, billing |
| b.tyreman | Test Company B | Tyre Man | its one country | cross-tenant negative tests |
| b.trial.expired | Test Company B copy with an expired trial | Admin | | suspension and read-only |

All with invented names, synthetic emails and passwords stored only in the team password manager.

## 10. Recommendation

**Use C and B together; do not use a Supabase branch yet.**

- C (local Supabase in CI) for every pull request: free, no service, proves the baseline replays and runs the
  database tests. It is also the only way to make the baseline trustworthy.
- B (a separate free-tier project in a separate free organisation) as the shared staging for web, mobile and
  Stripe test mode: free, and it cannot be merged into production or billed to the production organisation.
  If the free tier lacks a needed extension or pauses too often, move staging to a Pro project in the paid
  organisation (about USD 10 per month for Micro compute after credits are used by production) or to a
  persistent branch (option A) at the same order of cost.
- Reasons against A now: the existing branch already fails migrations; branch compute is outside the spend
  cap and outside compute credits; a branch sits one merge away from production, which is the wrong default
  while the migration history is being rebuilt.

## 11. Steps

| # | Step | Approval |
|---|---|---|
| 1 | Review and agree the exact schema-only dump command and exclusion list (section 5) | owner informed; read-only on production |
| 2 | Run the schema-only and roles-only dumps from an operator machine during a quiet hour | **needs owner approval** (first direct database connection for this purpose; read-only) |
| 3 | Scan the dump (section 6), commit it as the baseline migration, fix `config.toml` major version to 17 | none (repository change through normal review) |
| 4 | Write the reference seed and the synthetic generator; review the seed for customer content | none |
| 5 | Add a CI job: start local Supabase, apply baseline plus migrations, seed, run `supabase/tests`, compare object counts | none (uses free CI minutes; confirm the CI minute budget) |
| 6 | Create a separate free Supabase organisation and one project "tyrepulse-staging" in the same region family | **needs owner approval** (creates a service; USD 0) |
| 7 | Apply baseline, migrations and seed to staging; create the 9 private buckets and the test accounts | none after step 6 |
| 8 | Deploy the 18 edge functions to staging with test-only secrets | **needs owner approval** for each third-party sandbox key that is created |
| 9 | Create a staging web deployment pointed at staging (separate Vercel project or one staging branch) | **needs owner approval** (creates a service; within the current Vercel plan) |
| 10 | Create a Stripe account or use the existing one in test mode; add the test webhook endpoint | **needs owner approval** (creates a service; USD 0 in test mode) |
| 11 | Build a staging Flutter build with a separate application id | **needs owner approval** (standing rule: no mobile builds unless the owner asks) |
| 12 | Run the commercial fixes (CF-01 to CF-09) on staging first, with the journey in COMMERCIAL_FOUNDATION section 5 as the acceptance script | none |
| 13 | Decide whether to delete the failed production branch record and whether to adopt branching later | **needs owner approval** |

Risk to the current company from this plan: none for steps 3 to 12 (nothing touches production). Step 2 is a
read-only dump; run it off-hours because the instance has a 256 MB cache and heavy reads are felt by users.

## 12. Not verified

- The production compute size and therefore the exact credit position.
- Free-tier limits and extension availability for a new free project today (check at creation time).
- Whether the free plan allows a second free organisation for this account.
- Whether a schema-only dump of this database restores without manual edits (expected small fixes: extension
  schemas, `supabase_admin`-owned objects, the `vector` indexes).
- The policy and function counts to use in the comparison (take them at dump time).
