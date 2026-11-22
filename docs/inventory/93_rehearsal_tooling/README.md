# PG17 rehearsal tooling (2026-11-20)

Evidence: `../93_REHEARSAL_EVIDENCE.md`. Nothing here writes to production.

| File | Role |
|---|---|
| `extract_queries.sql` | The three READ-ONLY queries run on production through the Supabase MCP (function closure, relation DDL parts, sanitized data). Their results are saved as `prod_functions.raw`, `prod_tables.raw`, `prod_data.raw` in a scratch dir (never committed: they contain production data). |
| `mcpjson.py` | Parses an MCP result file. |
| `build_snapshot.py` | Turns the three extracts into `snap_schema_pre.sql`, `snap_data.sql`, `snap_schema_post.sql`, `snap_manifest.json`. |
| `roles.sql`, `guc.sql` | Production role model (postgres NOT superuser, BYPASSRLS) and server `search_path`. Run once per cluster as `supabase_admin`. |
| `rebuild.sh` | Recreates database `snap_base` from the extracts. |
| `fpcheck.py`, `tblcheck.py` | Snapshot vs production: function fingerprints (md5 of chr(13)-stripped prosrc and functiondef) and relation structure. |
| `apply.sh <db> forward|rollback` | Applies the 16 pending files (or the 16 ROLLBACK files in reverse) as role `postgres`; prints sha256, result, duration. |
| `gate3.sh` | Copy A forward; copy B forward, rollback, compare with the snapshot, forward again, compare with A. |
| `catalog_fp.sql`, `fpdiff.py` | Whole-catalog fingerprint (functions, relations, columns, ACLs sorted, constraints, indexes, policies, triggers, types, schemas, default ACLs, business-data hashes) and diff. |
| `verify.sql` | The per-file verify queries of doc 90 section 3. |
| `hashes.sql` | Business-data fingerprints over the pre-migration column set (gate 11). |
| `lib.mjs`, `setup.mjs`, `gates.mjs`, `gate9.mjs` | Gates 4-10, 12 on a disposable clone (`fresh.sh`), every call its own psql connection with `request.jwt.claims`, as a PostgREST request would be. |

Binaries used: PostgreSQL 17.6 server (`@embedded-postgres/linux-x64@17.6.0-beta.15`, npm), client
`pg_dump`/`pg_restore` 18.7 (conda-forge `postgresql`; dumping a 17 server with a newer client is the
supported direction, and the restore into 17.6 was verified).
