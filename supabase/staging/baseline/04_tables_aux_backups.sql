-- Tyre Pulse staging baseline: support schemas `backups` and `erp_promote_bak` (structure only)
-- Hand-written from a read-only catalog read. Public functions name these objects.
-- backups._do_snapshot and backups.run_restore_test are SIMPLIFIED STAND-INS (see README, stubs list):
-- staging holds synthetic data only, so row snapshots are not reproduced here.
-- @@
CREATE TABLE backups.snapshots (id uuid DEFAULT gen_random_uuid() NOT NULL, reason text DEFAULT 'manual'::text NOT NULL, taken_by uuid, taken_at timestamp with time zone DEFAULT now() NOT NULL, table_count integer DEFAULT 0 NOT NULL, total_rows bigint DEFAULT 0 NOT NULL);
-- @@
CREATE TABLE backups.snapshot_tables (id uuid DEFAULT gen_random_uuid() NOT NULL, snapshot_id uuid NOT NULL, table_name text NOT NULL, row_count integer DEFAULT 0 NOT NULL, data jsonb DEFAULT '[]'::jsonb NOT NULL, chunk_no integer DEFAULT 0 NOT NULL, status text DEFAULT 'ok'::text NOT NULL, note text);
-- @@
CREATE TABLE backups.restore_tests (id uuid DEFAULT gen_random_uuid() NOT NULL, snapshot_id uuid, snapshot_taken_at timestamp with time zone, started_at timestamp with time zone DEFAULT now() NOT NULL, finished_at timestamp with time zone, tables_tested integer DEFAULT 0 NOT NULL, rows_expected bigint DEFAULT 0 NOT NULL, rows_restored bigint DEFAULT 0 NOT NULL, status text DEFAULT 'running'::text NOT NULL, detail jsonb DEFAULT '[]'::jsonb NOT NULL, error text, run_by uuid DEFAULT auth.uid());
-- @@
CREATE TABLE erp_promote_bak.promotion_log (id uuid DEFAULT gen_random_uuid() NOT NULL, dataset text NOT NULL, batch_id uuid NOT NULL, organisation_id uuid NOT NULL, master_table text NOT NULL, master_id uuid, source_staging_id uuid NOT NULL, action text NOT NULL, detail jsonb, promoted_at timestamp with time zone DEFAULT now() NOT NULL, promoted_by uuid DEFAULT auth.uid());
-- @@
ALTER TABLE backups.snapshots ADD CONSTRAINT snapshots_pkey PRIMARY KEY (id);
-- @@
ALTER TABLE backups.snapshot_tables ADD CONSTRAINT snapshot_tables_pkey PRIMARY KEY (id);
-- @@
ALTER TABLE backups.restore_tests ADD CONSTRAINT restore_tests_pkey PRIMARY KEY (id);
-- @@
ALTER TABLE erp_promote_bak.promotion_log ADD CONSTRAINT promotion_log_pkey PRIMARY KEY (id);
-- @@
CREATE OR REPLACE FUNCTION backups._core_tables() RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path TO 'backups', 'public' AS $function$
  SELECT ARRAY['tyre_records','vehicle_fleet','accidents','inspections','work_orders',
               'pm_programs','pm_service_records','stock_records']::text[];
$function$;
-- @@
CREATE OR REPLACE FUNCTION backups._purge(p_days integer DEFAULT 30) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'backups' AS $function$
DECLARE v_n int;
BEGIN
  DELETE FROM backups.snapshots WHERE taken_at < now() - make_interval(days => GREATEST(1,p_days));
  GET DIAGNOSTICS v_n = ROW_COUNT; RETURN v_n;
END; $function$;
-- @@
CREATE OR REPLACE FUNCTION backups._do_snapshot(p_reason text DEFAULT 'manual'::text, p_by uuid DEFAULT NULL::uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'backups' AS $function$
DECLARE v_snap uuid;
BEGIN
  -- STAND-IN: records an empty snapshot header only.
  insert into backups.snapshots (reason, taken_by) values (coalesce(p_reason, 'manual'), p_by) returning id into v_snap;
  return v_snap;
END; $function$;
-- @@
CREATE OR REPLACE FUNCTION backups.run_restore_test() RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'backups', 'public' AS $function$
declare v_id uuid := gen_random_uuid();
begin
  -- STAND-IN: records a failed test row stating that staging has no row snapshots.
  insert into backups.restore_tests (id, started_at, finished_at, tables_tested, status, error)
  values (v_id, now(), now(), 0, 'failed', 'staging stand-in: no row snapshots exist');
  return v_id;
end $function$;
