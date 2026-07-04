# Data Intake Center - Security Plan (Phase 0)

> **Scope.** The security model for the Multi-Country Data Intake Center: private
> original-file storage, country/company scope isolation, role-based approval
> workflow, secret hygiene, and PWA caching rules. Each control is mapped to the
> RLS/RPC **already applied** in `MIGRATIONS_V45_IMPORT_CENTER.sql` /
> `MIGRATIONS_V46_IMPORT_COMMIT.sql`, with the country-scope and role gates that
> **still need building** called out explicitly.
>
> Companion: `IMPORT_CENTER_MULTICOUNTRY_AUDIT.md`, `IMPORT_CENTER_DATA_MODEL.md`,
> `IMPORT_CENTER_COMMIT_FRAMEWORK.md`, `IMPORT_CENTER_MIGRATION_PLAN.md`,
> `IMPORT_CENTER_TEST_CASES.md`.

---

## 1. Trust model

| Principle | Statement |
|---|---|
| Server is the boundary | The browser/mobile client is **untrusted**. Scope (`organisation_id`, `country`) is **stamped server-side** at commit, never read from the file or the client. |
| RLS is the floor | Every `import_*` table has RESTRICTIVE org isolation that ANDs with all other policies - no policy can grant cross-org access. |
| Least privilege | Read is broad-but-org-scoped; write requires `is_approved_and_unlocked()`; commit requires approval; reversal requires an elevated role. |
| Auditable | Every commit/reverse writes an append-only `import_audit_events` row with actor, action, and detail. |

Helpers (defined in earlier migrations, reused here): `app_current_org()` →
caller's `profiles.org_id`; `is_approved_and_unlocked()` → caller is approved and
not locked; `app_is_elevated()` → role ∈ {admin, manager, director}.

---

## 2. Private original-file storage

**Requirement.** All import files, photos, documents, invoices, and reports are
private. No permanent public URLs. Authorised users receive short-lived signed
URLs only.

| Control | Implementation | Status |
|---|---|---|
| Private bucket | `import-files` created with `public = false`, 100 MB `file_size_limit` (`storage.buckets`) | **DONE - V45** |
| DB stores metadata only | `import_files` holds `storage_bucket`, `storage_path`, `original_filename`, `mime_type`, `size_bytes`, `sha256`, never bytes | **DONE - V45** |
| Path convention | `org/country/module/batch/uuid` - encodes scope into the object key for defence-in-depth | **Convention defined (V45 docs); enforced by the upload service in Phase 1** |
| Signed URLs only | Clients call `storage.createSignedUrl` (short TTL); no `getPublicUrl` anywhere in the import path | **Policy ready (V45); replaces the public-URL accident flow in Phase 3** |
| MIME / size / extension / scope validation | Validated before the `import_files` row + object are created | **To build - Phase 1 upload service** (`size_bytes` cap is enforced by the bucket today) |
| Same-file dedupe | `import_files_sha_org_uniq UNIQUE (organisation_id, sha256)` rejects re-upload of identical bytes within an org | **DONE - V45** |
| Storage RLS | `import_files_auth_read/insert` (authenticated, `bucket_id='import-files'`); `import_files_auth_delete` requires `app_is_elevated()` | **DONE - V45** |

**Still to harden (Phase 1):** the storage SELECT policy is currently
`bucket_id='import-files'` for any authenticated user. The signed-URL issuing
service must additionally check the requester's org **and country** against the
`import_files` row before minting a URL, so the object key + the issuing service -
not the raw storage policy - provide cross-country isolation. Tighten the storage
policy to join `import_files` on path once the path convention is enforced.

---

## 3. Country & company scope isolation

**Requirement.** A Country-A user must not read Country-B imports or files. The
same `asset_no`/supplier may legitimately exist in multiple countries and must
not be treated as a duplicate without country + company context.

| Control | Implementation | Status |
|---|---|---|
| Org isolation (tenant root) | RESTRICTIVE policy on all 10 `import_*` tables: `USING/WITH CHECK (organisation_id IS NULL OR organisation_id = app_current_org())` | **DONE - V45** |
| Country carried on the batch | `import_batches.country` is **NOT NULL**; `import_files.country`, `import_mapping_profiles.country`, `custom_field_catalog.country` all scoped | **DONE - V45** |
| Country stamped at commit | `import_commit_batch()` enriches each live row with `country` from the batch (not from the file) | **DONE - V46** |
| Country-aware natural keys | Duplicate detection uses org + country + (asset/serial/item) so the same asset in two countries is two records | **To build - Phase 2 adapters** (validation engine) |
| **Caller-country gate (commit)** | The caller must be **assigned** the batch's country (`profiles.country` text[] contains it, or hold `'All'`, or be an org admin, or be unassigned) before **commit** | **DONE - V76** (`import_commit_batch` raises `Cross-country commit denied` via `import_user_can_commit_country()`) |
| **Caller-country gate (read/staging RLS)** | Same predicate added to the `import_*` read/write policies | **GAP - Phase 2** (read isolation still org-only) |

**The commit-path country gate is now closed (V76).** `import_commit_batch()`
calls `import_user_can_commit_country(batch.country)` right after the cross-org
check, so a same-org user cannot commit another country's batch to live tables.
Rule: allow when the batch has no country, the caller is an org/super admin, the
caller is unassigned (`country IS NULL` = all-country, preserves today's sole
admin), or the batch country ∈ `profiles.country[]` (or `'All'`). Verified in a
rolled-back probe (KSA→KSA allowed, KSA→UAE denied, NULL→any allowed).

**Still open (Phase 2):** *read/staging* RLS on `import_*` is still org-only, so
two same-org users in different countries can still *see* each other's staged
rows (they cannot commit them). Closing that requires the same
`country = ANY(profiles.country)` predicate on the `import_*` read policies —
the control behind Test Case 7 (cross-country access denied) and 2 (same
`asset_no`, different country).

---

## 4. Approval workflow & role scope

**Requirement.** Country-scoped, role-based approval. No self-approval of
high-risk financial imports.

### 4.1 Policy matrix (target)

| Import type | Stage (correct data) | Approve | Auto-commit allowed? |
|---|---|---|---|
| Fleet / asset enrichment | Country Data Officer | Country PMV Manager | Yes, after validation if source trusted |
| Tyre lifecycle event | Country Data Officer | Country PMV Manager | Yes, only when **no conflict** |
| Stock adjustment / opening | Country Data Officer | **Country Finance/Stock Approver** | **No - approval required** |
| Supplier price list | Country Data Officer | Finance/Procurement | No |
| Accident / insurance claim | Country Data Officer | Manager + (Finance for cost) | No |
| Warranty claim | Country Data Officer | Manager | No |
| Financial cost data | Country Data Officer | **Finance** | No - and **no self-approval** |
| Inspection (trusted device) | - | - | Yes, after validation |
| ERP/GPS scheduled | - | - | Yes, after profile approval |

Roles are **country-scoped**: a Country-A Manager approves only Country-A batches.
A **Group Director** sees cross-country imports **only when explicitly assigned**.
**Platform Admin** manages profiles but cannot bypass `import_audit_events`.

### 4.2 What enforces it today vs. what is missing

| Control | Implementation | Status |
|---|---|---|
| Write gate (stage/correct) | `import_*` `_write` policy requires `is_approved_and_unlocked()` | **DONE - V45** |
| Commit blocked unless approved | `import_commit_batch()` raises unless `approval_status='approved'` | **DONE - V46** |
| Reversal is high-risk | `import_reverse_batch()` requires `app_is_elevated()` | **DONE - V46** |
| Cross-org commit denied | RPC raises on `organisation_id` mismatch | **DONE - V46** |
| Audit of every commit/reverse | `import_audit_events` row written by both RPCs | **DONE - V46** |
| **Role-scoped approval** (Manager vs Finance vs Director) | Approval transition `pending_approval → approved` must check role + module class + country | **GAP - to add (Phase 2): an `import_approve_batch()` RPC or policy that maps module → required role** |
| **No self-approval of financial imports** | `approver` must differ from `uploader`/`created_by` for stock/financial modules | **GAP - to add to the approval RPC (Phase 2)** |
| **Country-scoped approver** | Approver's `profiles.country` must contain the batch country | **GAP - same predicate as §3** |

**Recommended approval RPC (Phase 2):** `import_approve_batch(p_batch_id)` -
SECURITY DEFINER, checks: caller approved+unlocked; caller's role authorised for
the batch's module class (operational vs financial); caller assigned the batch's
country; for financial/stock modules, `auth.uid() <> b.created_by`; then sets
`approval_status='approved'`, `approver=auth.uid()`, `approved_at=now()`, audits.
This keeps the high-risk gate server-side, never in the UI.

---

## 5. Secret hygiene

| Rule | Status |
|---|---|
| No `service_role` key, AI key, DB password, or storage secret in web/mobile bundles | **Honoured** - server secrets live only in edge-function secrets (per `CURRENT_SYSTEM_AUDIT.md`); the import path uses the anon key + RLS + SECURITY DEFINER RPCs |
| Commit logic runs server-side | `import_commit_batch/reverse/reprocess` are SECURITY DEFINER RPCs, granted only to `authenticated` | **DONE - V46** |
| Signed URLs minted server-side / by the storage API, short TTL | **To build - Phase 1 upload service** |

---

## 6. PWA / caching rules

**Requirement.** Do not cache authenticated REST data, private files, or auth
responses in the generic PWA cache. Clear country/user-scoped cache on logout.

| Rule | Status |
|---|---|
| Service worker must **exclude** `/rest/v1/import_*`, `/storage/v1/object/sign/import-files/*`, and `/auth/*` from runtime caching | **To enforce - Phase 1** (web uses `vite-plugin-pwa`; add a `navigateFallbackDenylist` / `runtimeCaching` exclusion for authenticated + import + storage routes) |
| Signed-URL responses are never persisted to cache | **To enforce - Phase 1** |
| On logout, purge any import/preview cache and React Query caches | **To enforce - Phase 1** |

---

## 7. Control → enforcement summary

| Threat | Primary control | Enforced today by |
|---|---|---|
| Cross-org data leak | RESTRICTIVE org isolation on all `import_*` tables | **V45 RLS** |
| Cross-country data leak (same org) | Caller-country gate | **GAP - RPC/policy (Phase 1/2)** |
| Public exposure of confidential docs | Private bucket + signed URLs | **V45 bucket/policies; Phase 1 service** |
| Unsafe live writes from client | SECURITY DEFINER commit RPC only | **V46** |
| Unapproved go-live | `approval_status='approved'` gate in commit | **V46** |
| Self-approval of financial import | `approver <> creator` check | **GAP - approval RPC (Phase 2)** |
| Re-upload of same file | `UNIQUE (organisation_id, sha256)` | **V45** |
| Reversal misuse | Elevated-role gate | **V46** |
| Secret leakage | Server-only secrets | **Existing boundary** |
| Cached private data | PWA route exclusions | **GAP - Phase 1** |
