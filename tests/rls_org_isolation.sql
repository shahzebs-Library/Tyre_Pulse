-- ─────────────────────────────────────────────────────────────────────────────
-- Tenant-isolation test for organisation-scoped RLS (MIGRATIONS_V42 + V43).
--
-- Proves a user in org A cannot READ or WRITE another organisation's rows, and
-- can still see their own org's rows (no over-blocking). Self-asserting: raises
-- an exception (non-zero exit) on any failure. Rolls back — leaves no data.
--
-- Run against a database where V42/V43 are applied and at least one profile
-- exists in the default org:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/rls_org_isolation.sql
--
-- Verified passing on 2026-06-29 (read-denied, own-visible, write-denied).
-- ─────────────────────────────────────────────────────────────────────────────
\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
  uid uuid;
  foreign_visible int;
  own_visible int;
  write_blocked boolean := false;
  org_a constant uuid := '00000000-0000-0000-0000-000000000001';
  org_b constant uuid := '00000000-0000-0000-0000-000000000002';
BEGIN
  SELECT id INTO uid FROM public.profiles WHERE org_id = org_a LIMIT 1;
  IF uid IS NULL THEN RAISE EXCEPTION 'no default-org profile to test with'; END IF;

  -- (privileged setup) a second org + one row in each org
  INSERT INTO public.organisations(id,name,slug)
    VALUES(org_b,'ISO Test B','iso-test-b') ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.tyre_records(id,serial_no,organisation_id) VALUES
    ('11111111-1111-1111-1111-111111111111','ISO_B_ROW',org_b),
    ('22222222-2222-2222-2222-222222222222','ISO_A_ROW',org_a);

  -- become an org-A authenticated user
  PERFORM set_config('role','authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid)::text, true);

  SELECT count(*) INTO foreign_visible FROM public.tyre_records WHERE serial_no='ISO_B_ROW';
  SELECT count(*) INTO own_visible     FROM public.tyre_records WHERE serial_no='ISO_A_ROW';

  -- writing into a foreign org must be denied by the restrictive WITH CHECK
  BEGIN
    INSERT INTO public.tyre_records(id,serial_no,organisation_id)
      VALUES('33333333-3333-3333-3333-333333333333','ISO_WRITE_B',org_b);
  EXCEPTION WHEN insufficient_privilege THEN write_blocked := true;
  END;

  IF foreign_visible <> 0 THEN RAISE EXCEPTION 'ISOLATION FAIL: foreign-org row visible (count=%)', foreign_visible; END IF;
  IF own_visible     <> 1 THEN RAISE EXCEPTION 'REGRESSION: own-org row not visible (count=%)', own_visible; END IF;
  IF NOT write_blocked    THEN RAISE EXCEPTION 'ISOLATION FAIL: insert into foreign org was allowed'; END IF;
  RAISE NOTICE 'RLS org-isolation test PASSED: read-denied=ok, own-visible=ok, write-denied=ok';
END $$;
ROLLBACK;
