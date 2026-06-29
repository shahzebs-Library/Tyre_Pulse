# ADR 0003 — Private file storage

**Status:** Proposed · **Date:** 2026-06-29

## Context
Files (inspection photos, accident photos, documents) live in Supabase Storage.
Inspection photos already use private buckets via `mobile/lib/storageRefs.ts`
(`tp-storage://` refs resolved to short-lived signed URLs), and accident photos
were recently moved from public `getPublicUrl` to a private bucket. The target
architecture must guarantee that **no sensitive file is ever reachable by a
permanent public URL**, that access is authorized per owning record, and that
storage can move from Supabase to MinIO/S3 later without touching business code.

## Decision
Define a **storage provider interface** (`internal/platform/storage`) that all
modules depend on; concrete providers are swappable.

- **Phase A:** Supabase **private** buckets behind the interface.
- **Phase C:** MinIO / S3-compatible private storage — same interface.
- **Access flow:** client requests an operation from the Go API → API checks
  permission for the owning record + validates **MIME, size, extension,
  ownership, path** → API issues a **short-lived signed URL** (upload or
  download). Defaults: download TTL 5 min, upload TTL 10 min.
- **Never** return permanent/public URLs. Store **file metadata** (bucket, key,
  content-type, size, owner, entity link, checksum) in a DB table; the row is
  the source of truth, not a URL.
- Confirm-after-upload step links the object to its entity and records metadata.

## Consequences
**Positive:** uniform private access; provider portability; auditable file
access; closes the public-URL risk class.
**Negative:** every file read/write now needs an API round-trip for a signed
URL; metadata table to maintain.
**Neutral:** existing `storageRefs` signed-URL pattern generalizes cleanly into
the provider.

## Alternatives considered
- **Public buckets + obscurity** — rejected: accident/inspection imagery is
  sensitive; unauthenticated reachability is unacceptable.
- **Direct client→storage credentials** — rejected: clients must never hold
  storage keys; authorization must precede every signed URL.
- **Proxy all bytes through the API** — rejected for large media: signed URLs
  offload transfer to the store while keeping authorization at the API.
