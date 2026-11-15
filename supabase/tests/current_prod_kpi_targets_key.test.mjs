// CUR-2: KPI targets get one uniqueness rule that includes the organisation.
// Reproduces the live "cannot save a second time" failure on the LIVE indexes, then runs the
// draft supabase/pending_migrations/20261113130500_cur_kpi_targets_org_scoped_key.sql.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = await readFile(
  new URL('../pending_migrations/20261113130500_cur_kpi_targets_org_scoped_key.sql', import.meta.url), 'utf8');
const uuid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const ORG_A = uuid(1);
const ORG_B = uuid(2);

async function setup() {
  const db = new PGlite();
  // Table, constraint and index exactly as pg_constraint / pg_indexes show them on 2026-11-12.
  await db.exec(`
    CREATE TABLE public.kpi_targets(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), metric text NOT NULL, target_value numeric NOT NULL,
      year integer NOT NULL DEFAULT 2026, month integer, site text, region text DEFAULT 'KSA', created_by uuid,
      updated_at timestamptz DEFAULT now(), country text DEFAULT 'KSA', target numeric, unit text, organisation_id uuid);
    ALTER TABLE public.kpi_targets ADD CONSTRAINT kpi_targets_metric_year_month_site_key UNIQUE (metric, year, month, site);
    CREATE UNIQUE INDEX kpi_targets_scope_uidx ON public.kpi_targets
      (metric, year, COALESCE(month, 0), COALESCE(site, ''::text), COALESCE(lower(btrim(country)), ''::text));
    INSERT INTO public.kpi_targets(metric, target_value, year, organisation_id) VALUES ('cpk', 0.03, 2026, '${ORG_A}');
  `);
  return db;
}

// What the web sent before the fix: INSERT ... ON CONFLICT (metric, year, month, site) DO UPDATE.
const oldUpsert = (org, value) => `
  INSERT INTO public.kpi_targets(metric, target_value, year, month, site, organisation_id)
  VALUES ('cpk', ${value}, 2026, NULL, NULL, '${org}')
  ON CONFLICT (metric, year, month, site) DO UPDATE SET target_value = EXCLUDED.target_value`;

test('LIVE indexes: the old upsert cannot save a target a second time (the production defect)', async () => {
  const db = await setup();
  try {
    await assert.rejects(db.exec(oldUpsert(ORG_A, 0.02)), /kpi_targets_scope_uidx|duplicate key/);
    assert.equal((await db.query(`SELECT target_value::float AS v FROM public.kpi_targets`)).rows[0].v, 0.03);
    // The web fix: find the stored row and update it by id. Works on the live indexes, no migration.
    const n = (await db.query(`UPDATE public.kpi_targets SET target_value = 0.02
      WHERE metric = 'cpk' AND year = 2026 AND month IS NULL AND site IS NULL RETURNING id`)).rows.length;
    assert.equal(n, 1);
  } finally { await db.close(); }
});

test('LIVE indexes: a second company cannot save the same metric and year', async () => {
  const db = await setup();
  try {
    await assert.rejects(
      db.exec(`INSERT INTO public.kpi_targets(metric, target_value, year, organisation_id) VALUES ('cpk', 0.05, 2026, '${ORG_B}')`),
      /kpi_targets_scope_uidx|duplicate key/);
  } finally { await db.close(); }
});

test('AFTER the draft: one rule, per organisation; blanks still count as a value', async () => {
  const db = await setup();
  try {
    await db.exec(migration);
    const idx = (await db.query(`SELECT indexname FROM pg_indexes WHERE tablename = 'kpi_targets' ORDER BY 1`)).rows.map(r => r.indexname);
    assert.deepEqual(idx, ['kpi_targets_org_scope_uidx', 'kpi_targets_pkey']);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM public.kpi_targets`)).rows[0].n, 1);

    // A second company now holds its own target for the same metric and year.
    await db.exec(`INSERT INTO public.kpi_targets(metric, target_value, year, organisation_id) VALUES ('cpk', 0.05, 2026, '${ORG_B}')`);
    // The same company still cannot hold two targets for one scope (blank month and site included).
    await assert.rejects(
      db.exec(`INSERT INTO public.kpi_targets(metric, target_value, year, organisation_id) VALUES ('cpk', 0.09, 2026, '${ORG_A}')`),
      /kpi_targets_org_scope_uidx|duplicate key/);
    // Case and padding of the country do not make a second scope.
    await assert.rejects(
      db.exec(`INSERT INTO public.kpi_targets(metric, target_value, year, country, organisation_id) VALUES ('cpk', 0.09, 2026, ' ksa ', '${ORG_A}')`),
      /duplicate key/);
    // A different month, site or country IS a different scope.
    await db.exec(`INSERT INTO public.kpi_targets(metric, target_value, year, month, organisation_id) VALUES ('cpk', 0.04, 2026, 3, '${ORG_A}');
                   INSERT INTO public.kpi_targets(metric, target_value, year, site, organisation_id) VALUES ('cpk', 0.04, 2026, 'NHC', '${ORG_A}');
                   INSERT INTO public.kpi_targets(metric, target_value, year, country, organisation_id) VALUES ('cpk', 0.04, 2026, 'UAE', '${ORG_A}');`);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM public.kpi_targets`)).rows[0].n, 5);
    // Running it again changes nothing.
    await db.exec(migration);
  } finally { await db.close(); }
});

test('the draft aborts instead of failing half way when a scope already holds two rows', async () => {
  const db = await setup();
  try {
    await db.exec(`DROP INDEX public.kpi_targets_scope_uidx;
      INSERT INTO public.kpi_targets(metric, target_value, year, organisation_id) VALUES ('cpk', 0.07, 2026, '${ORG_A}');`);
    await assert.rejects(db.exec(migration), /CUR-2 aborted/);
    await db.exec('ROLLBACK');  // the draft's own transaction is left aborted by the refusal
    // Nothing was changed: the old constraint is still there.
    const con = (await db.query(`SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'kpi_targets_metric_year_month_site_key'`)).rows[0].n;
    assert.equal(con, 1);
  } finally { await db.close(); }
});
