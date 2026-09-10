# Administration remediation and rollout record

Date: 2026-09-10. Scope: the 19 web Administration entries and the shared backend used by Flutter Administration. This records local corrections after the requested audit. No production migration, data repair, deployment, commit, or push was performed by this task.

**Local implementation is not production completion.** Existing live authorization weaknesses remain until reviewed migrations are applied. Historical missing records, external integrations, session revocation, deployment compatibility and production-volume/concurrency verification remain open.

## High-priority corrections

| Finding | Corrected workflow | Evidence and remaining boundary |
|---|---|---|
| Cleaning could ignore errors, cross the selected country, partially update data, and erase undo evidence | Browser supplies selected scope and expected snapshots; `admin_clean_tyre_records` validates active Admin, tenant and caller RLS, locks records, checks stale changes, and commits records plus audit/history atomically. Confirmed IDs alone count as saved. | Database, API and rendered-page regressions. Bulk work consists of independently atomic chunks: a later failure reports already confirmed rows. No invented serial suffixes; physical serial corrections require an entered value. |
| Expense replacement could clear all visible data before a failed upload | Validate active/elevated caller and explicit tenant/country; stage 200-row chunks; lock and compare original dataset fingerprint; archive originals and replace within one transaction; retain immutable retry receipt. | Isolated failure/retry/scope tests. Production-sized transaction timing remains unmeasured. Table lock deliberately serializes direct/legacy writers and affects other tenants during commit. |
| Web legacy upload approval used non-atomic writes | Existing approval/rejection RPCs enforce identity, role, tenant/country/site and atomic destination/status changes; replay does not duplicate records. | Actual destination constraints covered in harness. Pending rows without provable ownership fail closed. |
| Approval controls were bypassable through direct staging writes and old definer RPCs | Protect approved/final source data and batch context; serialize commit, enrich, reprocess and reverse on the parent batch; require applicable role, active membership, organisation, country and destination site. Reprocess only eligible unprocessed draft/pending rows. | Reviewed callable RPC paths and actual baseline function fixtures. Elevated self-approval remains intentional. Multi-session PostgreSQL testing is still required. |
| Landing checks accepted missing/malformed confirmation and counted another tenant's target | Verifier requires active tenant and staging ownership; counts matching destination organisation/country. Browser rejects malformed or old unscoped confirmations. | SQL and API regressions. ID/scope presence is not proof of field-value equality, correct business mapping, or future survival of records. |
| Global settings could mix tenant configuration and report partial saves as success | Audited RPCs derive organisation server-side and store separate `settings`/`app_settings` namespaces in `organisations.settings`; all keys of an app-settings save commit together. Existing branding is retained. Tenant changes invalidate caches and stale responses. Unset configuration stays unset. | SQL transaction/audit rollback, cross-tenant cache and API regressions. Old global rows are retained as a platform-only archive, never assigned to guessed owners. Coordinate installed-client rollout. |
| OCR/onboarding writes and support responses were insufficiently restricted | Administrative policies and protected actor/response fields are enforced in the database; requester updates cannot impersonate a support responder. | Authorization and support tests. This does not connect an OCR provider. |
| Mobile user administration had nullable caller checks and access update races | Require a real active caller profile, serialize relevant user actions, protect last-admin handling, and give mobile access overrides new IDs atomically so stale client cleanup cannot remove a newer decision. | Shared RPC tests and existing Flutter contract tests. Default/reset still uses multiple client calls. This does not revoke all existing Auth sessions or harden every unrelated profile-write path. |
| Upload history had country visibility without reliable tenant ownership | Stamp immutable organisation on new history; attribute old rows only from uniquely tenant-owned surviving destination rows; quarantine unknown/mixed attribution. | Migration and RLS tests. Unknown historical ownership needs explicit reconciliation. |
| Browser webhook settings stored signing secrets | Reject raw signing credentials; redact legacy reads; signed endpoints fail closed pending server-managed signing. Non-secret endpoints retain explicitly best-effort browser delivery. | Webhook tests; no delivery request was sent to an external endpoint. Server signing/rotation and durable delivery are separate operational work. |

## Medium-priority corrections

| Area | Result |
|---|---|
| Reconciliation | Failed reads throw instead of producing empty success. Summary tiles show unavailable checks; missing services stop loading with an error. |
| Audit Trail | Read failures and unavailable totals are visible. Export matches date/action/user/search filters and checks paging completeness. Legacy reversal archives destination rows and retains history; dependent cleaning/disposal activity prevents unsafe removal. |
| Custom field synonyms | Tenant-scoped uniqueness and RLS; corrected title-case Admin/Manager role checks. Unowned global synonyms remain quarantined. |
| System Health | Uses remote user validation; HTTP 5xx is down and denied/preflight responses are not claimed as end-to-end success. |
| Usage & Adoption | Paginates inputs, shares the activity dataset and refuses incomplete totals. Bounded reporting still needs server aggregates above configured limits. |
| Advanced Search | Per-source failures, exact match totals separately from displayed rows, explicit display caps and uncertain saved counts. Scope/request changes discard stale results. |
| ERP configuration | Failed loads expose Retry and prevent overwriting defaults. Saved schedule preferences are not described as proof that a connector runs. |
| Developer Portal | UI describes key/webhook reference records accurately; deleting a reference no longer claims to revoke an operational credential. |

## Module coverage and production limits

| Web Administration module | Backend/workflow coverage in this change | What is not certified |
|---|---|---|
| Data Intake Center | Canonical staging, approval, commit/enrich/reprocess/reverse, destination verification | Historical missing targets; every field mapping; large/concurrent imports |
| ERP Data Import | Shared canonical import safeguards apply where this path uses those RPCs | Every file format and alternative specialized importer |
| Data Intake (ERP) | Shared staging/commit protections | Provider-specific extraction and all saved mappings |
| Expense Import | New staged atomic scoped operation | Production-sized latency, lock duration and retention/restore operation |
| Upload Approvals | Atomic guarded legacy RPC decisions | Authenticated device/browser rollout against migrated schema |
| Data Cleaning | Scope, expected-state checks, transactional audit and retained undo | Physical truth of entered corrections; all chunks as one transaction |
| Data Reconciliation | Honest errors and unavailable summaries | Every existing reconciliation mutation's concurrency semantics |
| Custom Data | Tenant-safe synonym configuration | Every custom dataset/import schema |
| ERP Sync | Tenant connection config, guarded load/save, honest schedule wording | Live connector, secrets, scheduler, run reconciliation and delivery |
| OCR Scanner | Administrative access protections | External OCR extraction, quality/accuracy and downstream application |
| Advanced Search | Error/count/cap correctness and stale-result protection | Full-text relevance and large-tenant performance |
| Brand Assets | Branding subtree retained by new configuration storage | No new branding implementation or end-to-end certification |
| Onboarding Wizard | Administrative write boundary | External provisioning and all cross-module onboarding side effects |
| Audit Trail | Scoped history, error handling, filtered complete exports, archival reversal | Complete attribution of historical events; indefinite export scale |
| System Health | Honest authenticated/preflight health semantics | End-to-end health of every Edge Function or queue |
| Usage & Adoption | Complete-or-unavailable aggregation | Server aggregates for tenants over reporting limits |
| Developer Portal | Honest metadata registration/deletion semantics | Real key issuance, verification, revocation, rate limiting or webhook delivery |
| Settings | Tenant configuration, atomic saves, stale-cache isolation, unset states | Ownership of legacy global settings; all other Settings subsections |
| Help & Support | Protected administrative responses and trusted caller identity | External notification delivery and operational support SLAs |

Flutter Administration receives shared backend authorization and import-decision fixes without changing its protected router/sync wiring. This task does not create Flutter equivalents for all 19 web modules. Existing mobile user, access, site, approval and matrix tests are run separately; mocked client tests cannot prove live database delivery.

## Read-only live data evidence

Project-wide diagnostic on 2026-09-10; no customer rows or identifiers are included here. Destination references were joined to the real module target table and checked against the batch organisation/country.

| Committed canonical module | Referenced destination IDs | Existing IDs | IDs in expected scope |
|---|---:|---:|---:|
| Fleet | 602 | 602 | 602 |
| Tyre | 1,419 | 0 | 0 |
| Accident | 11 | 0 | 0 |

The tyre batch declares 1,463 input rows, 1,419 imported and 44 errors. Commit audit events exist; this does not establish whether missing rows never landed or were subsequently removed. No matching DELETE entries were found in the examined `audit_log` subset; absence there does not prove no deletion occurred. Reconcile other audit sources, backups and intentional removal history before considering restoration. Never fabricate a successful reconciliation or recreate old records based only on counts.

Fourteen specialized production/SCO/sites history batches have final committed summaries without canonical staging rows; their counters cannot be verified by the canonical row-reference check. They require their own business-key reconciliation.

## Rollout plan and enterprise acceptance

1. **Review and inventory deployment.** Validate all pending migration files against the current live function definitions. This workspace has unrelated ongoing work; deploy only an explicitly reviewed set. Guarded patches intentionally abort on schema/function drift.
2. **Resolve legacy ownership.** Assign old global settings only with evidence of the owning tenant. Review quarantined history/synonyms/pending uploads. Retain source/archive evidence. No cross-tenant copy or blanket backfill.
3. **Stage backend and clients together.** Apply schema/RPC/policy changes in migration order on an isolated production-like database. Verify supported installed clients, especially old global settings readers and approved import editors. New web code intentionally has no unsafe legacy write fallback.
4. **Exercise real concurrency.** Use separate PostgreSQL sessions for competing approval, enrichment, reversal, user-role and replacement operations. Prove one winner, explicit conflict/retry, no duplicates, no cross-tenant reads/writes, preserved audit evidence and safe cancellation.
5. **Measure production volumes.** Exercise approximately 200,000 expense rows and actual maximum imports. Measure timeout, memory, lock duration, cancellation, retries and archive growth. Set operational limits and retention only from measured results.
6. **Verify actual user journeys.** In isolated staging, use Admin, Manager, ordinary, inactive, site-limited and second-tenant accounts. Trace web and Flutter request -> RPC/RLS -> committed rows -> refresh/relogin readback -> audit record. Include expired sessions, failed network responses and repeat submissions.
7. **Resolve historical data separately.** Build a per-batch discrepancy report with natural keys and provenance. Approve a specific recovery only after proving legitimate source data and intended business state; retain original evidence.
8. **Finish operational integrations.** Connect OCR/ERP providers, server credential management and durable signed webhook delivery. Real developer credentials require backend verification, scope enforcement, rotation, revocation, rate limits and delivery logs. Metadata screens alone cannot meet this acceptance.
9. **Finish account lifecycle.** Coordinate Auth/session invalidation and installed-client login changes. Existing anonymous identifier-to-email RPC and historical signing-key concerns from the earlier security rollout remain open. Avoid breaking installed clients by deploying an incompatible auth change alone.
10. **Release gates.** Backend and frontend rollout, authenticated end-to-end evidence, monitored canary, documented rollback without reopening insecure legacy writes, Android/device verification and iOS verification on a supported runner. No enterprise-readiness claim until all applicable gates pass.

## Verification record

- Initial combined web configuration/reconciliation batch: 175 tests across 9 files passed.
- Updated cache/context/procurement batch: 64 passed, 2 new cache tests initially assumed an outdated feature default; expectations corrected to use the registry default. Final feature-flag file: 18 passed.
- Cleaning: database 9, API 24, rendered page 3 passed.
- System/tenant health: 58 passed, plus final growth-count guard 2 targeted checks passed.
- Advanced Search: 6 API tests passed.
- Expense and legacy reversal: 14 SQL tests; import/audit web tests: 17 passed.
- Browser webhooks: 25 passed.
- Support: 8 passed. Import verification/control/automation: 26 passed.
- Authorization/state database tests: latest combined 17 passed; synonym and destination-scope tests: 1 each passed.
- Tenant configuration database test: passed, including audit rollback, cross-tenant reads, forbidden writes, integration role and webhook-secret rejection.
- Whole-web ESLint: no errors; one existing warning in separately edited `Approvals.jsx`. Later copy changes receive focused lint.
- Production build, focused Flutter Administration and Settings page regression results are recorded below when complete.

These are local isolated harnesses, not a live penetration test or proof that production changes have been deployed. PGlite does not establish real multi-session lock behavior. No real production writes were used for verification.
