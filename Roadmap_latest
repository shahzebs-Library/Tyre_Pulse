You are the lead SaaS architect, senior Go backend engineer, React engineer, mobile reliability engineer, database architect, and security reviewer for the existing TyrePulse project.

Your job is to improve and migrate this existing system into a production-ready, long-term fleet, tyre, inspection, workshop, accident, stock, and analytics platform.

Do not give me generic advice only. Inspect the repository, create the required architecture documents, then implement the work in safe phases. Do not rebuild everything at once. Keep the current web and mobile applications working throughout the migration.

1. Current application reality

This repository currently contains:

* Web app: Vite + React 19
* Mobile app: Expo React Native with Expo Router
* Current backend: Supabase PostgreSQL, Supabase Auth, Supabase Storage, Edge Functions
* Web uses many direct Supabase table calls
* Mobile also writes directly to Supabase tables
* There are more than 40 SQL migration/schema files
* Existing modules include tyres, inspections, assets, stock, work orders, accidents, RCA, warranty, suppliers, uploads, reports, AI, audits, users, organisations, sites, dashboards, and analytics.

Do not force a move to Next.js. The existing Vite React dashboard can remain. The priority is backend ownership, security, data quality, reliable workflows, and scalability.

The target architecture is:

Web Dashboard: Vite React
Mobile App: Keep Expo React Native temporarily
Backend: Go API
Database: PostgreSQL
Private file storage: S3-compatible storage or MinIO
Cache and job queue: Redis when required
Reverse proxy: Nginx or Traefik
Deployment: Docker Compose first, then scalable separation later
Monitoring, backups, audit logs, and role-based access control: required

Target flow:

Web React Dashboard ─┐
├── Go API ─── PostgreSQL
Mobile App ──────────┘       │
├── Private file storage
├── Redis queue/cache
└── Audit, reports, integrations

The browser and mobile app may request data. The Go backend must decide access, validation, workflow, and database changes.

2. Important issues already identified

Confirm these findings in the codebase before changing anything:

1. There are many direct supabase.from(...) calls in both web and mobile.
2. src/contexts/AuthContext.jsx contains hard-coded role defaults such as Admin and Manager. Frontend role checks must not be treated as real security.
3. mobile/lib/recordQueue.ts accepts arbitrary table names and inserts directly into Supabase. Replace this with typed API commands. A mobile client must never decide which table to write to.
4. mobile/lib/photoUpload.ts uses getPublicUrl() for accident photos. Accident photos and documents must never become public links.
5. The PWA configuration caches Supabase REST, Supabase Auth, and Storage traffic. Do not cache authenticated API responses or user data in generic browser caches.
6. Duplicate or overlapping master tables exist, including:
    * vehicle_fleet and fleet_master
    * stock_records and stock
7. The current SQL migration history is fragmented and must be consolidated into a clean, traceable production schema plan.
8. Inspections and some operational records depend heavily on JSON payloads. Keep raw snapshots where useful, but create structured reporting tables for tyre checks, findings, measurements, and attachments.
9. The mobile offline queue uses secure storage or AsyncStorage style storage. This is acceptable as a temporary queue, but not robust enough for serious field operations, photos, retries, conflicts, and high volumes.
10. Heavy reporting libraries such as Excel, PDF, and PowerPoint generation are currently bundled in the web app. Large report generation should move to backend jobs over time.

Do not delete existing working functionality before replacement functionality is tested.

3. First mandatory deliverables before major changes

Create these documents first:

* docs/ARCHITECTURE_CURRENT_STATE.md
* docs/TARGET_ARCHITECTURE.md
* docs/GO_BACKEND_MIGRATION_PLAN.md
* docs/LEGACY_DATA_MAPPING.md
* docs/SECURITY_RISK_REGISTER.md
* docs/API_CONTRACT_STRATEGY.md
* docs/ADR/0001-go-backend-and-api-boundary.md
* docs/ADR/0002-multi-tenant-data-model.md
* docs/ADR/0003-private-file-storage.md
* docs/ADR/0004-offline-mobile-sync.md

The current-state document must list:

* Existing tables
* Duplicate tables and possible ownership conflicts
* Direct Supabase calls by module
* Current auth flow
* Current file upload flow
* Current mobile offline flow
* Existing Edge Functions
* Existing security policies and RLS assumptions
* Existing external services and secrets required

The migration plan must include module-by-module cutover, rollback method, test criteria, and exact legacy-to-canonical data mapping.

Do not rely on guesses. Read the actual code and SQL files.

4. Target backend architecture

Create a new Go backend inside this repository.

Suggested structure:

/backend
/cmd/api
/cmd/worker
/internal/platform
/config
/database
/httpserver
/auth
/authorization
/storage
/queue
/audit
/observability
/internal/modules
/identity
/organisation
/assets
/tyres
/inspections
/workorders
/inventory
/accidents
/uploads
/imports
/reports
/notifications
/integrations
/migrations
/openapi
/tests

Use a clean Go architecture with clear module boundaries. Avoid a heavy framework unless it provides clear value. Prefer standard Go net/http and small well-maintained libraries only where needed.

Use PostgreSQL through safe parameterized queries. Never build SQL by joining user strings.

Create:

* OpenAPI specification for all public API routes
* Versioned /api/v1 endpoints
* Consistent JSON response format
* Request validation
* Structured error codes
* Request IDs
* Idempotency support for mobile write actions
* Pagination, filtering, sorting, and search rules
* API rate limits
* Audit event creation for critical actions

Do not let React or Expo directly access business tables once a module is migrated.

5. Transition approach from Supabase

Do not abruptly remove Supabase.

Use this path:

Phase A: Transition state

* Keep existing Supabase PostgreSQL temporarily.
* Build Go API beside the current app.
* Go connects to PostgreSQL using server-only credentials.
* Web and mobile call Go for newly migrated modules.
* Existing Supabase direct calls remain only for modules not yet migrated.
* Supabase service role key must never be exposed to web or mobile.
* Keep existing Supabase Auth temporarily if needed, but Go must validate user tokens and enforce authorization.
* Do not create a second conflicting source of truth.

Phase B: Controlled cutover

Migrate modules one at a time.

For each module:

1. Build canonical schema.
2. Create data migration script.
3. Run migration dry-run.
4. Produce reconciliation report showing old count, new count, failures, and duplicates.
5. Route web and mobile through Go API.
6. Run integration and regression tests.
7. Freeze old direct writes for that module.
8. Keep legacy tables read-only until the cutover is validated.
9. Only then deprecate old tables or fields.

Phase C: Full ownership later

After Go API, domain model, data reconciliation, and deployments are stable:

* Move PostgreSQL from Supabase to self-hosted PostgreSQL or managed PostgreSQL you control.
* Move files from Supabase Storage to MinIO or private S3-compatible storage.
* Keep a formal export and restore plan.
* Do not move database and storage during the same risky release.

6. Canonical multi-tenant structure

Create a clean hierarchical model:

Organisation
Country
Project
Site
Asset
Tyre / Inspection / Work Order / Accident / Cost / Stock Movement

Every business record must have:

* id
* organisation_id
* Appropriate scope such as country_id, project_id, site_id
* created_at
* updated_at
* created_by
* updated_by where applicable
* Soft delete or lifecycle status where appropriate
* Optimistic concurrency/version field for records that may be edited by multiple users

Create proper reference tables:

* organisations
* countries
* projects
* sites
* cost_centers
* users
* organisation_memberships
* roles
* permissions
* role_permissions
* user_role_assignments
* user_site_assignments

Use role-based access control plus scope checks.

Example:

* Platform Admin can access all organisations only if explicitly allowed.
* Company Admin can access their organisation.
* PMV Director can access assigned company/country.
* PMV Manager can access assigned projects/sites.
* Tyre Head can manage tyre workflows only for assigned scope.
* Tyre Man can create inspections but cannot approve warranty or delete records.
* Store Keeper can manage stock movement but cannot approve financial adjustments.
* Driver or Operator can submit defects but cannot edit fleet master data.
* Viewer has read-only access.

The Go backend must enforce this on every request.

7. Canonical domain modules

A. Asset and fleet master

Replace duplicate fleet sources with one canonical assets domain.

Create:

* assets
* asset_configurations
* asset_status_history
* asset_meter_readings
* asset_documents
* asset_assignments

Each asset must support:

* Asset number
* Fleet number
* Registration/plate number
* Chassis/VIN
* Vehicle/equipment type
* Make/model/year
* Site, project, country, organisation
* Status
* Current KM or hour meter
* Tyre configuration
* Tyre size
* Tyre count
* Axle/wheel position template
* Recommended tyre pressure
* Torque standard
* Inspection frequency

Create one unified Asset Timeline that combines:

* tyre fitments
* inspections
* pressure checks
* damage
* work orders
* accidents
* downtime
* costs
* documents
* gate passes
* alerts

B. Tyre lifecycle

Create a real tyre lifecycle model.

Core tables:

* tyres
* tyre_fitments
* tyre_events
* tyre_measurements
* tyre_repairs
* tyre_retreads
* tyre_warranty_claims
* tyre_scrap_records
* tyre_photos

Each tyre must have a permanent serial-level identity.

A tyre movement must be transactional:

1. Remove tyre from current asset and wheel position.
2. Record removal KM/hours and removal reason.
3. Create tyre event.
4. Update tyre status.
5. Fit replacement tyre where applicable.
6. Update asset tyre layout.
7. Update stock ledger if stock is involved.
8. Write audit log.

Do this inside a database transaction in Go. Do not make the browser or mobile app perform several uncoordinated table updates.

C. Inspections and field operations

Create structured inspection entities:

* inspection_templates
* inspection_runs
* inspection_items
* inspection_tyre_checks
* inspection_findings
* inspection_attachments
* corrective_actions
* inspection_reviews

Each tyre check must support:

* Asset
* Tyre serial
* Wheel position
* Pressure
* Tread depth
* Damage condition
* Severity
* Photo reference
* Inspector
* Timestamp
* GPS or site data where permitted
* Recommended action
* Reinspection due date

Rules:

* Critical findings must create a corrective action automatically.
* Critical actions require supervisor review.
* Closed action requires evidence and quality check.
* Tyre pressure standards must come from asset configuration, not hard-coded frontend values.
* Keep raw inspection JSON only as immutable source snapshot if useful. Reporting must use structured fields.

D. Work orders, corrective actions, workshop, and gate pass

Create one connected workflow:

Inspection Finding
→ Corrective Action
→ Approval
→ Work Order
→ Parts Reservation
→ Repair / Tyre Action
→ Quality Check
→ Vehicle Release
→ Gate Pass
→ Cost and Downtime Closure

Create:

* work_orders
* work_order_tasks
* work_order_labour
* work_order_parts
* work_order_status_history
* quality_checks
* gate_passes
* downtime_records

Gate pass should be blocked if a critical unresolved safety issue exists.

E. Inventory, procurement, suppliers, and warranty

Replace direct stock balance edits with ledger logic.

Create:

* items
* warehouses
* warehouse_bins
* inventory_movements
* inventory_balances
* stock_reservations
* stock_transfers
* stock_issues
* stock_returns
* purchase_orders
* goods_receipts
* suppliers
* supplier_price_agreements
* warranty_claims

Stock should be calculated from movements. Do not treat a manually edited total as the source of truth.

Use movement types such as:

* receipt
* issue
* return
* transfer_in
* transfer_out
* adjustment
* scrap
* reservation
* release

F. Accidents and insurance

Create a linked accident module:

* accidents
* accident_attachments
* accident_estimates
* accident_parts
* accident_claims
* accident_claim_events
* accident_closure_approvals

Each accident must link to:

* asset
* driver/operator
* site/project
* date/time
* insurer/broker/policy
* estimated cost
* approved cost
* actual cost
* claim amount
* recovered amount
* unrecovered loss
* downtime
* root cause
* tyre/wheel damage when applicable

Accident photos must remain private.

G. Imports, data cleaning, and ERP integration

Do not import Excel directly into live tables.

Create a controlled import process:

Upload file
→ Save original private file
→ Create import batch
→ Map columns
→ Validate rows
→ Show errors
→ Approve batch
→ Commit through Go
→ Create audit summary
→ Support rollback before final approval

Create:

* import_batches
* import_rows
* import_errors
* import_mappings
* integration_runs
* integration_failures

Add duplicate detection, row-level errors, import ownership, approval, file hash, and audit history.

H. Analytics, reports, KPIs, and AI

Do not calculate core KPIs separately in frontend components.

Create central definitions for:

* KPI name
* formula
* scope
* target
* owner
* source datasets
* reporting frequency

Use backend queries, views, materialized views, or daily KPI snapshots for heavy calculations.

Create:

* kpi_definitions
* kpi_daily_snapshots
* report_jobs
* report_exports
* scheduled_reports

Move large Excel, PDF, and PowerPoint report generation to backend jobs. The web dashboard should request the report and then download it after completion.

AI rules:

* AI must not write directly to database records.
* AI may recommend actions only.
* AI must respect organisation and site permissions.
* AI responses must show source period, filters, record count, and source references.
* AI usage must be logged.
* AI requests must go through Go backend.
* Do not build advanced predictive tyre AI before tyre serial, fitment, pressure, tread, damage, and cost data are clean.

8. Security requirements

Implement these rules:

1. No database credentials, service keys, storage keys, AI keys, or secrets in Vite frontend or mobile app.
2. All secrets must be server-side environment variables.
3. Do not use public bucket URLs for accidents, inspections, documents, warranty files, or user uploads.
4. File access must use short-lived signed URLs created after Go verifies permission.
5. Validate file size, MIME type, extension, ownership, and upload path.
6. Store file metadata in database, not public direct URLs.
7. Use HTTPS in production.
8. Add secure headers, CORS allow-list, rate limits, and CSRF protection where cookie sessions are used.
9. Add request IDs and structured logs.
10. Never log passwords, access tokens, refresh tokens, private links, or raw personal data.
11. Add immutable audit records for:
    * login/security events
    * permission changes
    * tyre fitment/removal
    * stock movements
    * approvals
    * corrective action closure
    * deletion/archival
    * import approval
    * report exports
12. Admin functions require stronger controls, including 2FA plan and fresh-session confirmation for critical changes.
13. Database must not be publicly open to the internet in production.
14. Use least-privilege database accounts.
15. Add backup restore testing, not only backup creation.

Do not build password authentication from scratch in the first migration phase. Retain Supabase Auth temporarily if it is currently working, but make Go validate tokens and own authorization. Document a later safe migration path toward self-hosted identity if full ownership is required.

9. File storage design

Create a provider interface so storage can start with Supabase private buckets and later move to MinIO without changing business modules.

Required flow:

1. Client requests upload session from Go.
2. Go checks user permission and expected record scope.
3. Go returns restricted upload permission or uploads through backend.
4. Client uploads file.
5. Client confirms upload.
6. Go validates metadata and links file to the correct entity.
7. Download request goes to Go.
8. Go checks access and returns short-lived signed URL.

Never return permanent public URLs.

Fix the current accident photo public URL behavior.

10. Mobile offline design

Do not keep the current generic table + payload queue design.

Replace it gradually with typed offline commands, such as:

* CreateInspection
* SubmitTyreChange
* CreateWorkOrder
* ReportIssue
* SubmitRCA
* UploadAttachment

Each command must include:

* command ID
* idempotency key
* user ID
* organisation/site scope
* created time
* retry count
* status
* error details
* local attachment references

Use a proper local SQLite database for operational offline records when moving to the stronger mobile implementation. Secure storage should store tokens and small sensitive settings only, not the complete operational database.

Sync requirements:

* Idempotent server endpoints
* Retry with backoff
* Conflict detection using record versions
* Server response acknowledgement
* Attachment retry and resume support
* Clear organisation data after logout
* No syncing records into a different user or organisation account
* Failed records must be visible and recoverable

Keep Expo React Native for now. Do not rebuild mobile into Kotlin until the Go API and sync contract are stable. Create a Kotlin migration recommendation document later, but do not start Kotlin rewrite in this task.

11. PWA and frontend data rules

Update the PWA strategy:

* Do not generically cache authenticated Supabase REST responses.
* Do not cache authentication endpoints.
* Do not cache private file responses in a shared browser cache.
* Cache only static application assets and explicitly safe public assets.
* Use application-level data cache scoped by authenticated user and organisation if needed.
* Clear user-scoped cache on logout.
* Replace direct Supabase data access in migrated modules with typed API clients.

Create:

* src/lib/apiClient.js
* typed domain API modules
* central auth-aware request handling
* retry/error handling
* pagination helpers
* no direct business-table access from page components after migration

Do not rewrite every page at once. Migrate pages module by module.

12. DevOps and deployment

Create local development setup using Docker Compose:

* Go API
* PostgreSQL
* MinIO
* Redis
* Mail testing service if required
* optional local reverse proxy

Create:

* .env.example files with no real secrets
* docker-compose.dev.yml
* production Dockerfiles
* health endpoints
* readiness endpoints
* backup scripts
* restore scripts
* deployment runbook
* rollback runbook
* production environment variable checklist

For initial production, design for one VPS:

* Nginx
* Go API
* PostgreSQL
* MinIO
* Redis
* automated database backups
* storage backup
* monitoring

Design the application so that later PostgreSQL, storage, and API can move to separate servers without code redesign.

Do not introduce Kubernetes now.

13. Testing and quality gates

Add real automated testing.

Required:

* Go unit tests for domain rules
* Go integration tests using PostgreSQL
* API contract tests against OpenAPI
* Migration tests
* Permission and tenant-isolation tests
* File upload authorization tests
* Idempotency tests
* Offline sync tests
* Web API client tests
* Mobile command queue tests
* Regression tests for existing critical workflows
* Load smoke test for inspections and dashboard queries
* Restore test for backups

Every module migration must pass:

* Existing web build
* Existing mobile typecheck
* Existing tests
* New Go tests
* API tests
* Tenant isolation tests
* Data reconciliation checks

Do not claim a module is migrated until its frontend/mobile calls, tests, and data ownership are actually switched.

14. Implementation sequence

Follow this order:

Step 0: Audit and safety

* Inspect repository.
* Create architecture and migration documents.
* Create a change log.
* Identify all existing tables and direct calls.
* Identify source of truth for each domain.
* Do not delete or rename production tables yet.

Step 1: Backend foundation

* Create Go backend skeleton.
* Add configuration, health checks, logging, database connection, error model, auth validation, authorisation middleware, OpenAPI base, Docker local setup.
* Add organisation and scope model.
* Add audit framework.
* Add API client foundation in web and mobile.

Step 2: First real module cutover

Migrate in this exact priority:

1. Identity and scope authorization
2. Assets/fleet master
3. Tyre lifecycle and tyre fitment
4. Inspections and findings
5. Private uploads and attachment access
6. Mobile typed offline command sync

This is the first major usable foundation.

Step 3: Operations workflow

Migrate:

* corrective actions
* work orders
* workshop workflow
* gate pass
* downtime
* inventory and stock movements
* procurement
* suppliers
* warranty

Step 4: Accidents, imports, analytics

Migrate:

* accident and insurance module
* import/approval/data-cleaning pipeline
* reporting jobs
* KPI snapshots
* AI gateway and AI usage logs

Step 5: Remove legacy direct access

Only after each module is verified:

* remove direct Supabase table calls for that module
* remove obsolete client-side business logic
* remove duplicate old tables only after backup, export, reconciliation, and a documented rollback window

15. Acceptance criteria

At the end of each completed phase, provide:

1. What changed
2. Which files changed
3. Which modules are fully migrated
4. Which modules still use Supabase direct access
5. Test results
6. Security checks performed
7. Data migration/reconciliation status
8. Rollback instructions
9. Known limitations
10. Exact next phase

Do not use placeholders, fake APIs, mock security, or pretend implementation.

Do not break existing working screens just to make the architecture look cleaner.

Make practical decisions without waiting for me to answer small questions. Record important decisions in ADR files. If something is unsafe or cannot be completed in the current phase, explain it clearly and leave the existing system working.

Start now with Step 0 and Step 1. Then implement the first cutover module only after the foundation is tested.
