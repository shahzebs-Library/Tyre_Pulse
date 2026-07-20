-- MIGRATIONS_V315_ORG_REQUIRED_BUSINESS_ROWS.sql
-- Status: NOT YET APPLIED. Apply after review.
-- Reversible: each SET NOT NULL can be undone with the matching DROP NOT NULL
--             (ALTER TABLE ... ALTER COLUMN organisation_id DROP NOT NULL);
--             each SET DEFAULT can be undone with DROP DEFAULT. See the ROLLBACK block at the end.
--
-- PURPOSE
--   Reduce the latent "organisation_id IS NULL = cross-tenant visible" risk at the COLUMN level
--   for the core BUSINESS tables. Today org isolation is enforced only by RLS
--   (organisation_id = app_current_org()); a row that somehow lands with organisation_id NULL is
--   invisible to isolation on some code paths and a cross-tenant hazard. This migration makes
--   organisation_id structurally required on the tables where it is safe to do so.
--
-- INVESTIGATION SNAPSHOT (live DB, project jhssdmeruxtrlqnwfksc, 2026-07-20, READ-ONLY):
--   table               total  null_org  col_default          v290_stamp_trigger  decision
--   ------------------   -----  --------  -------------------  ------------------  -----------------------
--   vehicle_fleet          683         0  app_current_org()    yes (enabled)       NOT NULL
--   tyre_records          1419         0  app_current_org()    yes (enabled)       NOT NULL
--   accidents               32         0  app_current_org()    yes (enabled)       NOT NULL
--   inspections             25         0  app_current_org()    yes (enabled)       NOT NULL
--   work_orders              1         0  app_current_org()    yes (enabled)       NOT NULL
--   stock_records            0         0  app_current_org()    yes (enabled)       NOT NULL
--   warranty_claims          0         0  app_current_org()    yes (enabled)       NOT NULL
--   gate_passes              2         0  app_current_org()    yes (enabled)       NOT NULL
--   suppliers                0         0  (none)               yes (enabled)       ADD DEFAULT + NOT NULL
--   drivers                  0         0  (none)               yes (enabled)       ADD DEFAULT + NOT NULL
--   pm_programs              0         0  app_current_org()    NO                  DEFAULT-only (skip NOT NULL)
--   pm_service_records       0         0  app_current_org()    NO                  DEFAULT-only (skip NOT NULL)
--   wash_records             3         0  app_current_org()    NO (already NOT NULL) no action (documented)
--
-- BACKFILL
--   None required. EVERY table above has 0 null-organisation_id rows today, so there is nothing to
--   backfill to Company A ('00000000-0000-0000-0000-000000000001'). No row is touched by this migration.
--
-- WHY NOT NULL IS SAFE ON THE 10 IMPORT-TARGET TABLES
--   The V290 BEFORE INSERT ROW trigger `trg_stamp_import_default_org` (fn stamp_import_default_org)
--   fires on EVERY insert path (tgenabled='O') and sets organisation_id = Company A when it arrives NULL.
--   NOT NULL is checked AFTER BEFORE-triggers run, so any insert that reaches these tables (authenticated
--   -> column default app_current_org(); service-role/dashboard CSV import -> V290 trigger) has a non-null
--   organisation_id by constraint-check time. Authenticated inserts already carry app_current_org(); the
--   trigger only backstops the null (service-role / Supabase Table Editor import) case. Both drivers and
--   suppliers have the V290 trigger but no column default -> this migration ADDS the default first so
--   authenticated inserts get their REAL org (not Company A), then applies NOT NULL.
--
-- WHY pm_programs / pm_service_records ARE DEFAULT-ONLY (NO NOT NULL)
--   They carry the app_current_org() column default (covers authenticated app inserts) but they are NOT in
--   the V290 stamp set, so there is no trigger backstop for a service-role / dashboard / restore path that
--   could insert with a NULL org (app_current_org() returns NULL for a role with no profile). With 0 rows
--   and no stamp trigger, adding NOT NULL could break such a path. Per the "prefer DEFAULT-only when
--   uncertain" rule they are left DEFAULT-only. The default is already present, so there is nothing to add;
--   they are documented here and intentionally untouched. (To make them NOT-NULL-eligible later, add them
--   to the V290 stamp trigger set first, then a follow-up migration can SET NOT NULL.)
--
-- WHY wash_records IS UNTOUCHED
--   wash_records.organisation_id is ALREADY NOT NULL (created that way) and has the app_current_org()
--   default; it works in production without a stamp trigger (mobile driver inserts fill org via the
--   default). Nothing to change.
--
-- SINGLE-ORG ASSUMPTION (inherited from V290)
--   The V290 trigger stamps Company A unconditionally when org is NULL. All data + users live in Company A
--   today. If a 2nd tenant is added, the V290 trigger constant must become a per-context resolver BEFORE
--   their staff use the dashboard importer. NOT NULL does not change that assumption; it only forbids a
--   null org, which is always wrong regardless of tenant.

BEGIN;

-- 1) Add the missing app_current_org() column default to drivers + suppliers.
--    (Layering: the column default is applied first for authenticated inserts; the V290 BEFORE INSERT
--     trigger only backstops the remaining NULL from service-role/import paths.)
ALTER TABLE public.drivers   ALTER COLUMN organisation_id SET DEFAULT public.app_current_org();
ALTER TABLE public.suppliers ALTER COLUMN organisation_id SET DEFAULT public.app_current_org();

-- 2) Re-assert the app_current_org() default on the other import-target tables (idempotent no-op where
--    already set) so the whole set is uniform after this migration.
ALTER TABLE public.vehicle_fleet   ALTER COLUMN organisation_id SET DEFAULT public.app_current_org();
ALTER TABLE public.tyre_records    ALTER COLUMN organisation_id SET DEFAULT public.app_current_org();
ALTER TABLE public.accidents       ALTER COLUMN organisation_id SET DEFAULT public.app_current_org();
ALTER TABLE public.inspections     ALTER COLUMN organisation_id SET DEFAULT public.app_current_org();
ALTER TABLE public.work_orders     ALTER COLUMN organisation_id SET DEFAULT public.app_current_org();
ALTER TABLE public.stock_records   ALTER COLUMN organisation_id SET DEFAULT public.app_current_org();
ALTER TABLE public.warranty_claims ALTER COLUMN organisation_id SET DEFAULT public.app_current_org();
ALTER TABLE public.gate_passes     ALTER COLUMN organisation_id SET DEFAULT public.app_current_org();

-- 3) Enforce NOT NULL on the 10 V290-stamped import-target tables (all have 0 null rows + the trigger
--    backstop, so this is safe). Tables are tiny (<=1419 rows); the validating scan is negligible.
ALTER TABLE public.vehicle_fleet   ALTER COLUMN organisation_id SET NOT NULL;
ALTER TABLE public.tyre_records    ALTER COLUMN organisation_id SET NOT NULL;
ALTER TABLE public.accidents       ALTER COLUMN organisation_id SET NOT NULL;
ALTER TABLE public.inspections     ALTER COLUMN organisation_id SET NOT NULL;
ALTER TABLE public.work_orders     ALTER COLUMN organisation_id SET NOT NULL;
ALTER TABLE public.stock_records   ALTER COLUMN organisation_id SET NOT NULL;
ALTER TABLE public.warranty_claims ALTER COLUMN organisation_id SET NOT NULL;
ALTER TABLE public.gate_passes     ALTER COLUMN organisation_id SET NOT NULL;
ALTER TABLE public.suppliers       ALTER COLUMN organisation_id SET NOT NULL;
ALTER TABLE public.drivers         ALTER COLUMN organisation_id SET NOT NULL;

-- pm_programs, pm_service_records: DEFAULT-only (default already present, NOT NULL intentionally skipped).
-- wash_records: already NOT NULL, untouched.

COMMIT;

-- ============================================================================
-- ROLLBACK (reversible) -- run to undo this migration:
-- BEGIN;
--   ALTER TABLE public.vehicle_fleet   ALTER COLUMN organisation_id DROP NOT NULL;
--   ALTER TABLE public.tyre_records    ALTER COLUMN organisation_id DROP NOT NULL;
--   ALTER TABLE public.accidents       ALTER COLUMN organisation_id DROP NOT NULL;
--   ALTER TABLE public.inspections     ALTER COLUMN organisation_id DROP NOT NULL;
--   ALTER TABLE public.work_orders     ALTER COLUMN organisation_id DROP NOT NULL;
--   ALTER TABLE public.stock_records   ALTER COLUMN organisation_id DROP NOT NULL;
--   ALTER TABLE public.warranty_claims ALTER COLUMN organisation_id DROP NOT NULL;
--   ALTER TABLE public.gate_passes     ALTER COLUMN organisation_id DROP NOT NULL;
--   ALTER TABLE public.suppliers       ALTER COLUMN organisation_id DROP NOT NULL;
--   ALTER TABLE public.drivers         ALTER COLUMN organisation_id DROP NOT NULL;
--   -- optional: revert the two added defaults
--   ALTER TABLE public.drivers   ALTER COLUMN organisation_id DROP DEFAULT;
--   ALTER TABLE public.suppliers ALTER COLUMN organisation_id DROP DEFAULT;
-- COMMIT;
-- ============================================================================
