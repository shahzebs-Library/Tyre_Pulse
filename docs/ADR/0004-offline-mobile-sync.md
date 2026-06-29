# ADR 0004 — Offline mobile sync

**Status:** Proposed · **Date:** 2026-06-29

## Context
The mobile app is offline-first. Inspections queue in AsyncStorage
(`tp_inspection_queue_v1`) and sync on reconnect. A second generic queue,
`mobile/lib/recordQueue.ts`, exposes `saveRecord(table, payload)` which calls
`supabase.from(table).insert(payload)` — **the client chooses the table and
writes straight to it**. This is unsafe (no server validation, client-decided
target, no idempotency, no conflict handling) and blocks the API boundary. Field
operations also need robust retries, attachment handling, and tenant safety.

## Decision
Replace arbitrary-table queueing with **typed offline commands** posted to the
Go API. The foundation ships now in `mobile/lib/offlineCommands.ts` (types only,
unwired); the cutover happens in Step 2 (mobile sync).

- A closed command set: `CreateInspection`, `SubmitTyreChange`, `CreateWorkOrder`,
  `ReportIssue`, `SubmitRCA`, `UploadAttachment`. The client expresses an
  **intent**, never a table.
- Each command carries: `commandId`, `idempotencyKey`, `type`, `endpoint`,
  `payload`, `scope` (organisation/site/country), `createdAt`, `status`,
  `retryCount`, `error`, `attachments[]`.
- **Server endpoints are idempotent** via the `Idempotency-Key` header backed by
  the `idempotency_keys` table — a retried command replays the stored result.
- **Conflict detection** uses record `version` (optimistic concurrency); the API
  returns 409 on stale writes and the client surfaces a recoverable conflict.
- Retries use backoff; failed commands remain visible and recoverable.
- **Attachments** upload via signed URLs (ADR 0003) with resume/retry.
- **On logout, clear org-scoped local data**; never sync a record into a
  different user/organisation.
- **Operational store:** migrate from AsyncStorage to a local **SQLite**
  database for the command log/attachments when the stronger implementation
  lands; SecureStore keeps only tokens and small settings.
- **Keep Expo / React Native** for this phase. A Kotlin-rewrite evaluation is a
  later, separate document — not started here.

## Consequences
**Positive:** server validates/authorizes every write; safe retries; tenant
isolation; clear, testable sync contract.
**Negative:** more client plumbing than a generic insert; SQLite migration
effort; needs idempotent + versioned endpoints server-side first.
**Neutral:** the existing inspection queue maps onto `CreateInspection`.

## Alternatives considered
- **Keep generic `saveRecord(table,…)`** — rejected: client-chosen tables and
  unvalidated writes are a security and integrity hole.
- **Full CRDT/automerge sync** — rejected: unnecessary complexity for
  append-mostly field data; version-based conflict detection suffices.
- **Online-only mobile** — rejected: field connectivity is unreliable; offline
  capture is a core requirement.
