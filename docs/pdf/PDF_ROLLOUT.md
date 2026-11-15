# Stored PDF service: rollout, rollback and open items

Date: 2026-11-15. Branch `claude/pdf-cache-service-7rxp2t`. Nothing here has been merged, deployed or applied.
The owner decides each step. Read `PDF_ARCHITECTURE_AUDIT.md` first.

## 1. What merging the code alone does (no migration applied)

Nothing changes for users except three small things:

- Download PDF on an inspection or an observation works exactly as before. The service asks the database for a
  stored copy, the function does not exist yet, and it generates directly. One extra request that fails fast.
- The inspections register lets every reader select rows (before: administrators only, for removal). Removal
  stays administrator only. Selected rows can be downloaded as one ZIP; with no stored copies every report is
  generated in the browser, two at a time.
- The stored-PDF panel and the "Update available" states stay hidden until the tables exist.

No edge function is touched. No mobile app is touched.

## 2. Migration order (drafts in `supabase/pending_migrations/`, all AUTHORED, NOT APPLIED)

| Order | File | What it does | Needed for |
|---|---|---|---|
| 1 | `20261117090000_report_pdf_cache.sql` | bucket `report-pdfs`, `report_pdf_files`, `report_pdf_events`, the `pdf_cache_*` functions, storage policies | stored PDFs, fast repeat downloads, regenerate, versions |
| 2 | `20261117091000_report_pdf_autoqueue.sql` | `report_pdf_queue` and an AFTER trigger on `inspections` that records a request when a record is completed or approved | automatic preparation of reports approved away from the web page |
| not to apply | `20261117092000_report_export_jobs_DESIGN.sql` | table for a later server ZIP worker | nothing today; design only |

Before applying file 1 to production:

1. Apply to a staging copy and run `supabase/tests/staging/report_pdf_cache_tests.sh` (it makes its own copy of the
   local staging database, proves existing rows, functions, policies and triggers are byte-identical, runs 102
   checks, a real five-session claim race and a concurrent lookup run).
2. The file contains `drop policy if exists` guards for the policies it creates. The Supabase MCP asks a person to
   confirm any statement containing that word, and the prompt is not reachable from a cloud session. Apply it from
   the SQL editor, or with the owner present to approve.
3. File 2 adds a trigger on `inspections`. It only reads the row and swallows every error, and it was tested with
   the inspection lock triggers in place on staging. Apply it only after file 1 has been live for a few days.
4. After applying, confirm in production (read only): the bucket is private; `anon` cannot execute any
   `pdf_cache_*` function; an account limited to one country gets `not_available` for another country's inspection.

No setting needs to be changed. Optional: `system_config.pdf_bulk_limit` = 10, 50 or 100 (default 50 in code).

## 3. What changes once file 1 is applied

- First download of a revision: generated in the browser as today, then uploaded (about 1 s extra on wifi, about
  4 s on a site connection for a 12-photo report). Paid once.
- Every later download of the same revision by anyone allowed to read the inspection: no generation, no photo
  downloads, a signed link (0.16 s to 0.7 s to the link in the harness, depending on the connection).
- Editing the inspection, adding or replacing a photo, approving it, changing the logo or bumping the template
  version makes the stored copy "previous" and the next download prepares the new revision.
- An approved inspection's stored revision is locked. Only an administrator, with a reason, can add a replacement;
  the original stays stored and listed.

## 4. Rollback

Code: revert the merge commit. The generators' `save: false` and `warnings` options are harmless if left.

Database, file 2 first, then file 1. The exact statements are in each file's header. In short:

- File 2: remove the trigger `report_pdf_autoqueue_trg` on `inspections`, then the two functions and the table.
  Removing only the trigger is enough to stop it instantly.
- File 1: remove stored objects through the Storage API (a bucket with objects cannot be removed by SQL), then the
  three storage policies, the functions, the two tables and the bucket row.
- A softer stop that needs no removal: revoke EXECUTE on `pdf_cache_lookup` from `authenticated`. The web app then
  treats the cache as not set up and generates directly, as before.

No existing table, row, function or policy is changed by either file (proved on staging by fingerprinting 4,678
objects before and after), so rollback cannot affect inspections, costs, tyre records or ERP rows.

## 5. Outstanding issues and risks

1. Not tested in a signed-in browser against a real Supabase project: the upload with `upsert`, the signed link
   and its `download` file name, and the storage policies as enforced by the real Storage API (tested here against
   the storage tables with the same policies, not the Storage service). First thing to verify on a staging project.
2. Round-trip times to the hosted project were simulated, not measured.
3. A browser generates the file, so a user who may read an inspection could upload different bytes for it. The row
   records who did, ready rows are frozen and approved revisions need an administrator to replace. A server renderer
   removes this; see the audit, section 5.
4. Reports approved on the phone are prepared only when somebody next opens the web inspections page.
5. The expected tyre life panel, inspection ordinal and signer names are not part of the key (they are read live
   when drawn). A stored copy shows them as of its generation date. Regenerate latest refreshes them.
6. Bulk download of observation reports is not built. Corrective-action and job-card reports are not wired.
7. Retention is a written rule, not a job. Storage grows by roughly 1 GB a month until one exists.
8. Template versions must be bumped when a generator changes. A test fails when the source changed and the version
   did not; it cannot know about changes in shared helpers outside the pinned source range.
9. `pdf_cache_complete` trusts the client's sha256 (it can check size and type only).
10. Selecting rows on the inspections register is now offered to every reader. If that is not wanted, the bulk
    button can be limited to managers with a one-line change.

## 6. Questions for the owner

1. Apply file 1 on a staging project first, or straight to production in a quiet hour?
2. Should Regenerate on an approved report be administrator only (as built) or also managers?
3. Is 50 the right default for one bulk download, and should Tyre Men be allowed to bulk download?
4. Is a headless renderer (5 to 25 USD a month, 1 to 2 weeks) wanted so that reports approved on the phone are
   prepared with nobody at a computer?
5. How long should superseded working copies be kept (the draft rule says 90 days)?

## 7. Verification, 2026-11-15 (local staging copies only, production untouched)

Merge gate, drafts NOT applied:
- `src/test/pdfCacheNotProvisioned.test.js` (26 tests): the real data-access module answering 42P01, PGRST205,
  PGRST202 and 42883 for every function this branch added. Each download is generated in the browser once, only
  the one lookup is attempted, nothing is uploaded, signed or queued, no message is shown, the bulk gate falls back
  to the client limit and the retention sweep does nothing.
- Browser, real production build against a database copy with no PDF tables, functions or bucket: 16 of 16
  (Manager and Administrator, single, second record and bulk ZIP downloads, no error, nothing uploaded, no panel).

Drafts applied (copy only):
- `supabase/tests/staging/report_pdf_cache_tests.sh`: existing objects byte-identical (4678 fingerprints),
  157 SQL checks, 5 simultaneous claims give one generator, 1020 concurrent lookups all ready.
- `e2e/pdf-storage/specs/storage_api.mjs` against the real Supabase Storage API: 64 of 64.
- `e2e/pdf-storage/specs/browser.cjs`: 20 of 20. First download 1.3 to 2.7 s (generated and stored),
  repeat 0.16 to 0.28 s (signed link, no generation). The Tyre Man part is checked with his own session against
  the server: on the web he is kept on checklist capture and does not see the register's download buttons.

## 8. Authenticated storage integration, round 2 (2026-11-15)

What was tested: the exact tree that would ship (this branch, which already contains `main` at `f11e18f2`;
merge conflict-free), as a production build, against a LOCAL Supabase Storage API (supabase/storage v1.11.13
built from source, file backend), real PostgREST 12 and a local sign-in gateway that issues signed-in JWTs.
This is NOT the hosted Supabase project: hosted Storage is not reachable from the test machine, so behaviour of
the hosted service itself is Not Tested. Database: a copy of the synthetic staging database (`tp_pdf6`) with the
drafts 20261117090000, 091000 and 093000 applied, and a second copy (`tp_pdf6_nodraft`) with none of them.
Production was not touched; no Supabase MCP call; both copies were dropped afterwards.

Every storage request in the browser was checked: it carried the person's own JWT (role `authenticated`,
`sub` = that person), never the service key. The only Storage API requests without that header are the browser
opening a signed URL, which carries its own short-lived token. API checks used JWTs from the gateway sign-in.

Specs: `e2e/pdf-storage/specs/round2.cjs` (60 of 60), `browser.cjs` provisioned (20 of 20),
`storage_api.mjs` (64 of 64), `browser.cjs` unprovisioned (16 of 16; one earlier run timed out waiting for the
bulk ZIP download event, the rerun passed).

| # | Case | Role | Expected | Observed | Evidence | Label |
|---|---|---|---|---|---|---|
| 1 | First inspection PDF download | Manager | Generated in the browser, stored privately once | Generated (blob), one upload, row sha256 = downloaded bytes, approved copy locked. 3.2 to 3.9 s (134 kB) | round2 case 1 | Verified Fixed |
| 1 | Repeat download | Manager | Served from storage via a short-lived signed URL, no generation | Same bytes through `/object/sign/...`, no second upload, signed URL valid 120 s. 133 to 187 ms | round2 case 1 | Verified Fixed |
| 1 | First / repeat download | Admin | As above | First 1.0 to 1.1 s (267 kB, stored once), repeat 115 to 152 ms via signed URL | round2 case 1 | Verified Fixed |
| 2 | Object path | any | Company-scoped | `<company id>/tyre_inspection/<record id>/<key>.pdf` | round2 case 2 | Verified Fixed |
| 2 | Other company reads Alpha report | Beta Manager, Beta Admin | 403/404 or refusal on object, signed URL step, cache row | Storage API download 400, sign 400; `pdf_cache_lookup` not_available; `report_pdf_files` and `report_pdf_events` return 0 rows; write into Alpha folder 400 | round2 case 2 | Verified Fixed |
| 2 | Anonymous | none | Nothing | Download, sign and public URL 400; lookup and table read 401; folder listing empty | round2 case 2 | Verified Fixed |
| 3 | Own site | Tyre Man (ALPHA EAST PLANT) | Allowed | Download 200, signed URL 200, rows only of his site | round2 case 3 | Verified Fixed |
| 3 | Other site | Tyre Man | Refused at database and storage | Lookup not_available; Storage API download 400, sign 400, overwrite 400 | round2 case 3 | Verified Fixed |
| 4 | Overwrite approved object | Manager, Admin | Refused by storage policy | PUT 400, POST upsert 400, remove removes 0; object unchanged byte for byte | round2 case 4 | Verified Fixed |
| 4 | Regenerate approved | Manager (not authorised), Admin | Needs authorised role and reason, keeps original, audit row | Manager: approved_needs_authorisation; Admin without reason: reason_required; Admin with reason: new revision on `.g2.pdf`, original kept byte for byte, `regenerate_requested` event by the admin, revision records who, why, from which file | round2 case 4 | Verified Fixed |
| 5 | Bulk 50 / 51 | Admin, Manager | 50 allowed, 51 refused by the server | Admin: 50 accepted (50 returned), 51 over_limit. Manager: 50 accepted, only his 22 KSA records returned (28 refused as out of scope), 51 over_limit | round2 case 5 | Verified Fixed |
| 5 | Configurable limit | Admin sets 10 | Honoured; manager cannot change it | 10 accepted, 11 over_limit; manager update refused (admin_only); every request logged with its outcome | round2 case 5 | Verified Fixed |
| 6 | Retention, dry run in a rolled-back transaction | cron (no user) | Never approved, never younger than 90 days | Of a working copy superseded 200 days ago, one superseded 30 days ago and the approved original backdated 400 days, only the 200-day copy was marked; rollback left nothing marked. A signed-in admin cannot start the job (permission denied); the Storage API removes neither the unmarked copy nor the approved original | round2 case 6 | Verified Fixed |
| 7 | Observation PDF, browser | Manager | First generated and stored, repeat from storage | First 0.9 s (15 kB, one upload, under `<company>/tyre_observation/`), repeat 119 to 216 ms via signed URL, same bytes and file name, no error; refused to another company (400) | round2 case 7 | Verified Fixed |
| 8 | Drafts NOT applied | Manager, Admin | Downloads work as on main, no storage call, no error | Generated in the browser (blob), second record and bulk ZIP work, no error, no stored-PDF panel, zero Storage API requests, nothing created in the database | browser.cjs unprovisioned | Verified Fixed |

Timings are from one local machine and only show the shape (generated vs served); they are not a production
measurement. Not Tested: the hosted Supabase Storage service and its policies as deployed (local Storage API
only); GoTrue (sign-in is the local shim, the JWT shape and claims match); the retention purge for real (dry
run only, by design).
