# System Console, AI services and file handling review - 2026-11-12

Read-only audit against the live project. Database tests ran in rolled-back transactions, one impersonated
user per transaction. No AI provider call, email, push or file download was made.
Status words: see [SECURITY_AUDIT.md](SECURITY_AUDIT.md).

Evidence labels: IMP = proved by impersonation; CAT = read from the live catalog; CODE = read in source only.

Accounts used: a Manager, a Driver (lowest field role), the one locked + unapproved account. There is no plain
(non-super) Admin on this database, so that role was not run as a real user.

## A. Console

### CON-1 (P2) Any signed-in user could forge console audit rows - FIXED
- Evidence (IMP, Driver): `log_console_action` accepted calls; console_sessions 278 -> 280, and each forged
  row raised a break-glass notification to every super admin.
- Fix: `20261112150000_console_logger_super_admin_gate.sql`.
- Verified: Driver -> 42501, counts unchanged; super admin still logs.

### CON-2 (P2) Privileged-action audit depended on the browser - FIXED / OPEN
- Evidence (CAT + CODE): 15 action names are logged by the browser after the RPC; `backup_restore_missing`,
  `set_sentry_config`, `admin_set_admin_user`, `admin_clear_push_token` wrote no audit row at all; data
  browser, tenant export page, storage list and sign-in facts are reads with no read audit; no outcome or
  correlation column.
- FIXED: `20261112184000_console_server_audit_and_sentry_url_check.sql`. Those four writers now write a
  server-side audit row in the same transaction. Verified: each call adds a row with the actor and
  `source = server`; a refused call adds none.
- OPEN: the other browser-logged writers, read auditing, outcome / correlation columns, logging of refusals.

### CON-3 (P2) No step-up on destructive console actions - OPEN
- Evidence (CODE): destructive dialogs ask for a reason and a typed word in the browser only; the RPCs do not
  require a fresh second factor. Since `20261112160000` a super admin with an enrolled factor must at least
  hold an aal2 session, but there is no freshness check.

### CON-4 (P3) Dual control off; covers four actions when on - OPEN
- Evidence (CAT): `dual_control_enabled = false`. Owner decision. Two super admins exist, so four-eyes is
  achievable.

### CON-5 (P2 for a multi-tenant launch, P3 today) Tenant suspension and support sessions not enforced - OPEN
- Evidence (CAT): 0 policies reference `organisations.active / locked`; `support_sessions` has 0 rows and 0
  policies. A super admin crosses organisations whether or not a session is open.

### CON-6 (P3) Console stats and config readable by every signed-in user - FIXED
- Evidence (IMP, Driver): `get_console_stats()` returned user totals including the super admin count; all 62
  config keys readable.
- Fix: `20261112182000`. Verified: Driver, Manager and locked account -> 42501 on stats; config by read level.

### Console gate results at audit time
- 42 console RPCs called as a Manager: 38 refused; the other 4 were a refusal in the body, CON-6, CON-1 and a
  harmless null. Same pattern as a Driver. None is executable by anon.
- 19 console and audit tables returned 0 rows to a Driver.
- Six functions raise a different refusal code from the rest (cosmetic).

### Privileged console actions

| Action | Gate | Server audit row | Step-up | Dual control |
|---|---|---|---|---|
| Data cleanup | super admin (IMP) | yes | no | first entry point only |
| Tenant export (server job) | super admin (IMP) | yes | no | no |
| Tenant export (browser path) | super admin (IMP) | only if the client logs | no | no |
| Bulk role change | super admin (IMP) | trigger + client | no | yes |
| Backup restore | super admin (IMP) | yes since 20261112184000 | no | yes |
| Set user password | super admin / Admin | yes | no | no |
| Session revoke (edge) | super admin, not locked | yes | no | no |
| Data browser write | super admin (IMP) | yes (undoable) | no | no |
| Data browser read | super admin (IMP) | no | n/a | n/a |
| Platform settings | super admin (IMP) | history trigger | no | one key only |
| Sentry config | super admin (IMP) | yes since 20261112184000 | no | no |
| Console admin roles | super admin (IMP) | yes since 20261112184000 | no | no |
| Clear push token | super admin | yes since 20261112184000 | no | no |
| Organisation suspend | super admin | none specific | no | not enforced (CON-5) |

## B. AI

Seven agents exist; the role map is deny-by-default. All 14 orchestrator tools are read-only and run on the
caller's JWT, so RLS and RPC guards apply.

### AI-1 (P2) Any signed-in user could exhaust or freeze the AI budget - FIXED
- Evidence (IMP, Driver): one inserted ledger row with cost 1000 moved the month spend from 0.33 to 1000.33
  against a budget of 20; a row under another user's id was also accepted.
- Fix: `20261112151000_ai_ledgers_server_write_only.sql`.
- Verified: both inserts -> 42501; spend unchanged; service role still writes; negative cost -> 23514.

### AI-2 (P3 now, P2 at multi-tenant) Budget and quota are global, not per tenant - OPEN

### AI-3 (P3) Knowledge search bypasses country / site scope and trusts a caller-supplied org when the caller has none - OPEN
- Latent: 0 profiles without an organisation and 0 knowledge documents. Read, not exercised.

### AI-4 (P3) Prompts, tool output and answers stored; chat cache never purged - OPEN
- Evidence (CAT): 39 cache rows, 39 expired. No retention rule for AI messages.

### AI-5 (P3) `chat-ai` path narrates figures computed in the browser - OPEN
- Accuracy and governance item. The orchestrator path uses server RPCs with provenance.

## C. Files, documents, reports

### FILE-1 (P1) Storage ignored role and country - FIXED / OPEN
- Evidence (IMP, Driver): 29 raw import workbooks (all three countries), 26,987 tyre photos and 13 accident
  objects visible. Download was not performed (PLAUSIBLE).
- FIXED: `20261112153000_storage_sensitive_read_rules.sql`. Verified: Driver sees 0 import files and 0
  accident documents; a KSA Manager sees 26 import files (KSA only); super admin 29.
- OPEN (stated in the migration): Flutter uploads accident case documents under a path that does not mark
  them as documents, so those stay readable by any active member; a per-record or per-country rule for photos
  needs org- and record-prefixed paths (FILE-4).

### FILE-2 (P2) `inspection-photos` accepted uploads from locked accounts - FIXED
- Fix: `20261112152000`. Verified: locked account -> 42501; active users still upload.

### FILE-3 (P3) `vehicle-photos` overwrite by any approved user - FIXED / OPEN
- FIXED: `20261112152000` (owner or authorised same-org user). Verified: Driver updates 0 rows.
- OPEN: no org-prefixed path rule on insert.

### FILE-4 (P3) `tyre-photos` paths are client-chosen and not org-prefixed - OPEN

### FILE-5 (P2) Formula-injection sanitising covered one module only - STAGED
- Evidence (CODE): about 17 screens wrote sheets directly without sanitising.
- STAGED (d5764687): one shared sanitiser `src/lib/csvSafe.js` used by every writer, TAB / CR added to the
  CSV escape, and a source-scan test `src/test/exportSafeScan.test.js`. Goes live with the web deploy.

### FILE-6 (P3) Expo inspection PDF injects the stored signature SVG as raw HTML - OPEN
- 0 live rows contain script or link markup. Confidence PLAUSIBLE (not confirmed on a device).

### FILE-7 (P3) Upload and export caps are browser-only; client file checks differ from bucket rules - OPEN

### FILE-8 (P3) No deletion or retention path for media - OPEN
- `tyre-photos` has no DELETE policy for any role.

### Buckets (9, none public)

| Bucket | Read rule after fixes | Notes |
|---|---|---|
| tyre-photos | active + owner in my org; `accidents/` prefix limited to case workers | no delete policy |
| accident-photos | as above; document-named objects limited to case workers | |
| inspection-photos | active + owner in my org | upload now needs an active account |
| vehicle-photos | active + owner in my org | update now owner or authorised |
| import-files | uploader, or elevated / `upload_data:view` within country scope | |
| tenant-exports | super admin | service-role writes |
| driver-fine-evidence, team-action-evidence, workforce-evidence | record-scoped | 0 objects |

No bucket allows SVG or HTML.

## Checked and clean

- Console RPC gate and console tables (see gate results above).
- Both super admins have a verified MFA factor; last-super-admin guards present.
- AI orchestrator: read-only tools on the caller's JWT; server-side tool allowlist; inputs normalised.
- AI tables with no policy are service-role only; conversations are owner-only.
- Photo worker output is schema-constrained; no automatic action follows a model result.
- A Driver cannot overwrite another user's tyre photo or insert into import-files.
- Web signature rendering uses images, not inline markup.

## NOT VERIFIED

1. A real plain Admin against the console RPCs.
2. Live HTTP behaviour of the edge functions; deployed source versus repo for the AI functions.
3. Actual download of the objects a Driver could list before the fix.
4. Whether the second cleanup entry point consumes a dual-control approval.
5. Whether a direct API call to the browser-logged console RPCs leaves no console audit row (inferred).
6. Script execution in the Expo print view (FILE-6).
7. Prompt-injection resistance in practice (no provider calls were made).
8. Knowledge retrieval end to end (0 documents).
9. Photo worker and budget lock under load.
10. Whether any storage retention rule or export purge actually removes objects.
11. Bodies of about 110 console RPCs not individually read.
