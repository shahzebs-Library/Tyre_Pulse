# TyrePulse - API Contract Strategy

> **Status:** Step 0 design. Governs every `/api/v1` endpoint. The OpenAPI file
> (`backend/openapi/openapi.yaml`) is the machine-readable source of truth.

## 1. Versioning
All routes under `/api/v1`. Breaking changes ship as `/api/v2`; `v1` is
supported until clients migrate. Additive changes (new fields/endpoints) stay in
`v1`.

## 2. Response envelope
Every response uses one shape:

```json
{ "data": <payload|null>, "error": <error|null>, "meta": <object|null> }
```

- Success: `data` set, `error` omitted. Lists put pagination in `meta`.
- Failure: `error` set with a **stable machine code** + safe message.

```json
// success
{ "data": { "id": "…", "role": "inspector" } }
// error
{ "error": { "code": "forbidden", "message": "Account is not active." } }
```

## 3. Error codes
Stable, client-switchable codes (HTTP status in parentheses):
`bad_request` (400), `unauthorized` (401), `forbidden` (403), `not_found` (404),
`conflict` (409, optimistic-concurrency/idempotency), `rate_limited` (429),
`service_unavailable` (503), `internal_error` (500). Internal detail is logged
server-side with the request id and **never** leaked in the body.

## 4. Auth contract (Phase A)
`Authorization: Bearer <supabase-access-token>`. The API verifies the HS256
signature with `SUPABASE_JWT_SECRET`, then loads **role + scope from the
database**. The client-supplied role is ignored. Locked/unapproved accounts get
403 regardless of a valid token.

## 5. Request correlation
Clients may send `X-Request-Id`; the API generates one if absent and echoes it
on the response and in every log line for that request.

## 6. Idempotency (writes)
Mutating requests carry `Idempotency-Key: <uuid>`. The API records
`(idem_key, endpoint)` in `idempotency_keys` with the stored status/response.
A retry with the same key **replays** the original result instead of repeating
the action - essential for the mobile offline queue.

```
POST /api/v1/inspections
Idempotency-Key: 5e9f…   →  201 { "data": { "id": "insp_123" } }
# network retry, same key  →  201 { "data": { "id": "insp_123" } }  (replayed)
```

## 7. Pagination, filtering, sorting, search
- **Cursor pagination:** `?limit=50&cursor=<opaque>`. Response:
  `data: { items: [...], next_cursor: "…"|null }` (or `meta.next_cursor`).
  Cursors are opaque and stable; no offset scanning for large sets.
- **Filtering:** explicit query params per field, e.g. `?site=Riyadh&status=open`.
- **Sorting:** `?sort=created_at&order=desc` (allow-listed fields only).
- **Search:** `?q=<text>` against module-defined searchable fields.

```json
// GET /api/v1/tyres?limit=2
{ "data": { "items": [ {"id":"t1"}, {"id":"t2"} ], "next_cursor": "eyJrIjoidDIifQ==" },
  "meta": { "limit": 2 } }
```

## 8. Example - GET /api/v1/me
```
GET /api/v1/me
Authorization: Bearer <jwt>
→ 200
{ "data": { "id": "11111111-…", "email": "i@ex.com", "role": "inspector",
            "site": "Riyadh", "country": ["KSA"], "approved": true, "locked": false } }
```

## 9. Rate limits
Per-IP fixed-window guard in the API (default 120/min, configurable) plus
per-user limits for expensive endpoints (e.g. AI). 429 returns `rate_limited`.
Production also enforces limits at the edge/reverse proxy; multi-instance
accuracy uses Redis.

## 10. Validation
All input validated server-side against the endpoint schema before any write.
Field length/type/range and allowed enum values are enforced; unknown fields are
rejected (no client-spread into rows).

## 11. Audit
Critical actions (auth/security events, tyre fitment/removal, stock movements,
approvals, corrective-action closure, deletions/archival, import approval, report
export) write an immutable `api_audit_events` row with actor, action, entity,
request id, and structured metadata.

## 12. CORS & headers
Strict origin allow-list (no wildcard with credentials). Allowed headers:
`Authorization, Content-Type, Idempotency-Key, X-Request-Id`. Methods:
`GET, POST, PUT, PATCH, DELETE, OPTIONS`.
