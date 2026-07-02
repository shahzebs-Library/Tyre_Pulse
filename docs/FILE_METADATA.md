# File Metadata & Private File Access (Phase 1e / V44)

> Migration: `MIGRATIONS_V44_FILE_METADATA.sql` (applied). Additive; depends on
> V42 (`organisations` + `app_current_org()`). Closes security-plan item **S7**.

## Why
Uploaded business files (inspection/accident photos, documents) lived in storage
with no DB authority record - access wasn't auditable, org-scoped, or tied to the
owning entity. This adds a per-file record so the **database row is the source of
truth**, not a URL. Files remain in **private** buckets and are served via
short-lived **signed URLs** (never public URLs).

## What it adds - `public.file_metadata`
| Column | Purpose |
|--------|---------|
| `id` | PK |
| `organisation_id` | tenant scope (default org; FK) |
| `owner_id` | uploader (FK `auth.users`) |
| `entity_type` / `entity_id` | the owning record (e.g. `accident` / `<uuid>`) |
| `bucket` / `path` | location in the private bucket (UNIQUE together) |
| `content_type` / `size_bytes` | validated metadata |
| `created_at` | timestamp |

Constraints: unique `(bucket, path)`; `size_bytes` ≤ 100 MB; `content_type`
restricted to image + PDF. Indexes on org, `(entity_type, entity_id)`, owner.

## RLS (org-scoped, same V42/V43 pattern)
- **RESTRICTIVE** `file_metadata_org_isolation` - row's `organisation_id` must
  match the caller's org (NULL permitted). ANDs on top of the permissive policies
  → tenant-isolated like every other business table.
- **read** - authenticated (org-restrictive ANDs).
- **insert** - only your own files (`owner_id = auth.uid()`) and only when
  approved+unlocked.
- **delete** - owner or elevated role.

## Access model
1. Client uploads bytes to a private bucket (existing flow).
2. App records a `file_metadata` row (owner/org/entity/bucket/path/type/size).
3. On display, the app requests a **short-lived signed URL** for the bucket+path
   (existing `storageRefs.resolveStorageUrl` on mobile). No permanent/public URLs.

## Follow-up (after the service-layer PR #21 merges)
Add an `uploads` service (`src/lib/api/uploads.js`): `recordFile({bucket,path,
entityType,entityId,contentType,sizeBytes})` and `listEntityFiles(entityType,
entityId)`, then wire the inspection/accident upload paths to record metadata on
successful upload. (Kept out of this PR to avoid depending on #21's `_client.js`.)
