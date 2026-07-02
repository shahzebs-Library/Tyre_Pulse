# Data Intake Center - Server-side Commit Framework (V46)

> Migration `MIGRATIONS_V46_IMPORT_COMMIT.sql` (applied). Depends on V45
> (staging schema, PR #23) + V42 helpers. This is the **only** path staged rows
> take into live operational tables - never a browser insert.

## RPCs (all `SECURITY DEFINER`, `search_path=public`, granted to `authenticated`)

### `import_commit_batch(p_batch_id) → jsonb`
Commits an approved batch into its module's live table, atomically (one
transaction - partial failure rolls the whole thing back).
- **Guards:** caller `is_approved_and_unlocked()`; batch belongs to the caller's
  org (`app_current_org()`); `approval_status='approved'`; not already committed.
- **Per row** (`action='insert'`, `validation_status IN (ready,warning)`, not yet
  processed): enrich `transformed_data` (fallback `mapped_data`) with
  `organisation_id`, `country`, `created_by`/`uploaded_by`; insert **only the
  columns that actually exist** on the target table (via `jsonb_populate_record`
  + an `information_schema` column intersection - unknown keys are ignored,
  defaults apply); link the new id back to `import_rows.target_record_id`.
- **Idempotent:** processed rows are skipped; a committed batch returns
  `already_committed`. Writes an `import_audit_events` row.
- Module → table: `fleet→vehicle_fleet`, `tyre→tyre_records`,
  `stock→stock_records`, `accident→accidents`, `inspection→inspections`,
  `workorder→work_orders`, `warranty→warranty_claims`, `gatepass→gate_passes`
  (others raise "not supported yet" and stay staged).

### `import_reverse_batch(p_batch_id) → jsonb`
Deletes **only the exact live rows this batch created** (matched by
`target_record_id`), unlinks the source rows, marks the batch `reversed`, audits.
- **Elevated role only.** Org-scoped.
- *Limitation (follow-up):* a stricter "unmodified-since-import" guard is not yet
  applied - it removes the imported rows, not unrelated later business activity,
  but does not yet detect post-import edits to those specific rows.

### `import_reprocess_row(p_row_id)`
Resets an **uncommitted** row to `pending` for re-validation (never touches a
row that already has a `target_record_id`).

## Why this is the safe path
- No browser/mobile insert into live fleet/tyre/stock/accident tables.
- Server enforces permission + org/country scope; the live `organisation_id`
  is stamped by the server, not trusted from the file.
- Atomic + idempotent → no silent partial imports; retries don't double-insert.
- Every source row is permanently linked to the live record it produced.

## Test - `tests/rpc_import_commit.sql` (PASSED)
Self-asserting, rolled back: commit a ready row → live `tyre_records` row created
+ org/country/uploader stamped + source linked; second commit `already_committed`;
reverse deletes exactly that row. Run:
`psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/rpc_import_commit.sql`.

## Next
The web **parse/map/validate engine** (`src/lib/import/*`) stages rows + calls
these RPCs on approval; the Data Intake Center **UI** + module **adapters**
(Fleet → Tyre → Stock) follow.
