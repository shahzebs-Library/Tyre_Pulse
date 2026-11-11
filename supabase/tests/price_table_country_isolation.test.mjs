// Isolated PGlite regression harness; never connects to a server. Run: npm run test:database
//
// Loop 2 / F-C-01 (P1): restrictive country isolation on the three price/lifecycle tables.
// Loads the REAL migration 20261110140000 on fixtures shaped like the live tables (RESTRICTIVE
// org policy + PERMISSIVE read) and proves the V578 pattern end to end:
//   * a KSA-scoped elevated user reads KSA rows only (0 Egypt/UAE) on all three;
//   * a super admin reads every country;
//   * owner gate B: a non-elevated active user reads 0 (provenance read narrowed to elevated,
//     corrections/replacement were already elevated-only).
//
// NOTE (DB-1): there was no shared "country isolation" PGlite suite to extend, so this is a new
// focused suite in the same style as web_vehicle_meters.test.mjs. CI-1 also lists a F-C-01 country
// isolation extension in its ownership — coordinate so this is not duplicated.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = await readFile(new URL('../migrations/20261110140000_country_isolation_price_tables.sql', import.meta.url), 'utf8');
const org = '00000000-0000-0000-0000-000000000001';

test('price tables: country isolation hides foreign-country rows; owner gate B narrows provenance', async t => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE SCHEMA anum_integration; CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE FUNCTION app_current_org() RETURNS uuid LANGUAGE sql AS $$ SELECT '${org}'::uuid $$;
      CREATE FUNCTION is_super_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT current_setting('test.super',true)='true' $$;
      CREATE FUNCTION app_sees_all_countries() RETURNS boolean LANGUAGE sql AS $$ SELECT current_setting('test.allc',true)='true' $$;
      CREATE FUNCTION app_country_scope() RETURNS text[] LANGUAGE sql AS $$ SELECT string_to_array(coalesce(nullif(current_setting('test.scope',true),''),'ksa'), ',') $$;
      CREATE FUNCTION app_is_active() RETURNS boolean LANGUAGE sql AS $$ SELECT coalesce(current_setting('test.active',true),'true') <> 'false' $$;
      CREATE FUNCTION app_is_elevated() RETURNS boolean LANGUAGE sql AS $$ SELECT current_setting('test.elev',true)='true' $$;
      CREATE FUNCTION anum_integration.apply_reader_policies() RETURNS void LANGUAGE plpgsql AS $$ BEGIN END $$;

      CREATE TABLE public.tyre_cost_corrections(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organisation_id uuid, country text, old_cost numeric, new_cost numeric);
      CREATE TABLE public.tyre_price_provenance(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organisation_id uuid, country text, amount numeric);
      CREATE TABLE public.tyre_replacement_log(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organisation_id uuid, country text);
    `);

    // Live-shaped RLS BEFORE the fix: RESTRICTIVE org + PERMISSIVE read (provenance read = active).
    for (const [tbl, readExpr] of [
      ['tyre_cost_corrections', 'app_is_elevated'],
      ['tyre_price_provenance', 'app_is_active'],
      ['tyre_replacement_log', 'app_is_elevated'],
    ]) {
      await db.exec(`
        ALTER TABLE public.${tbl} ENABLE ROW LEVEL SECURITY;
        GRANT SELECT ON public.${tbl} TO authenticated;
        CREATE POLICY ${tbl}_org ON public.${tbl} AS RESTRICTIVE TO authenticated
          USING (organisation_id = (select app_current_org()) OR (select is_super_admin()));
        CREATE POLICY ${tbl}_read ON public.${tbl} AS PERMISSIVE FOR SELECT TO authenticated
          USING ((select ${readExpr}()));`);
    }

    await db.exec(`
      INSERT INTO public.tyre_cost_corrections(organisation_id,country) VALUES ('${org}','KSA'),('${org}','Egypt'),('${org}','UAE');
      INSERT INTO public.tyre_price_provenance(organisation_id,country) VALUES ('${org}','KSA'),('${org}','Egypt'),('${org}','UAE'),('${org}','UAE');
      INSERT INTO public.tyre_replacement_log(organisation_id,country) VALUES ('${org}','KSA'),('${org}','Egypt'),('${org}','UAE');
    `);

    // Apply the real migration (adds the three *_country_isolation policies + narrows provenance read).
    await db.exec(migration);

    await db.exec(`SET ROLE authenticated; SET test.scope='ksa'; SET test.elev='true'; SET test.active='true'; SET test.super='false'; SET test.allc='false';`);
    const counts = async () => ({
      corrections: (await db.query('SELECT count(*)::int n FROM public.tyre_cost_corrections')).rows[0].n,
      provenance: (await db.query('SELECT count(*)::int n FROM public.tyre_price_provenance')).rows[0].n,
      replacement: (await db.query('SELECT count(*)::int n FROM public.tyre_replacement_log')).rows[0].n,
    });

    await t.test('KSA-scoped elevated user reads KSA rows only (0 Egypt/UAE)', async () => {
      assert.deepEqual(await counts(), { corrections: 1, provenance: 1, replacement: 1 });
    });

    await t.test('super admin reads every country', async () => {
      await db.exec("SET test.super='true'");
      assert.deepEqual(await counts(), { corrections: 3, provenance: 4, replacement: 3 });
      await db.exec("SET test.super='false'");
    });

    await t.test('owner gate B: a non-elevated active user reads 0 from all three', async () => {
      await db.exec("SET test.elev='false'");
      assert.deepEqual(await counts(), { corrections: 0, provenance: 0, replacement: 0 });
      await db.exec("SET test.elev='true'");
    });
  } finally { await db.close(); }
});
