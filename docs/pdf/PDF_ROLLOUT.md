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
