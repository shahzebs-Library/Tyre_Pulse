import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
// Follow-up to the applied advanced OEM migration: the review queue must keep every SOURCE row.
// Before 20261119100000 two rows with the same part number on one page collided on
// (manual_id, figure_id, part_no, pdf_page) and the second was dropped. After it, the key is the
// source row (manual_id, pdf_page, row_order), and the rollback restores the old key.
const read = (p) => readFile(new URL(p, import.meta.url), 'utf8')
const base1 = await read('../migrations/20261117130000_oem_illustrated_parts_catalog.sql')
const base2 = await read('../migrations/20261117143000_oem_parts_catalog_large_manuals.sql')
const adv = await read('../migrations/20261118100000_oem_catalog_advanced.sql')
const fix = await read('../pending_migrations/20261119100000_oem_review_items_source_row.sql')
const rollback = await read('../pending_migrations/20261119100000_oem_review_items_source_row_ROLLBACK.sql')
const ORG = '00000000-0000-0000-0000-000000000900'
const MANUAL = '00000000-0000-0000-0000-000000000010'

async function build() {
  const db = new PGlite()
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA auth; CREATE SCHEMA storage;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
    CREATE FUNCTION public.get_my_role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'Admin'::text $$;
    CREATE FUNCTION public.is_super_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
    CREATE FUNCTION public.app_current_org() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT '${ORG}'::uuid $$;
    CREATE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
    CREATE TABLE storage.buckets(id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text);
  `)
  await db.exec(base1); await db.exec(base2); await db.exec(adv)
  await db.exec(`INSERT INTO public.oem_parts_manuals(id, organisation_id, manufacturer, model, source_file_name, source_sha256)
    VALUES ('${MANUAL}', '${ORG}', 'SANY', 'SY412C', 'b.pdf', 'sha-a')`)
  return db
}
const twoRows = (orders = [3, 7]) => `INSERT INTO public.oem_review_items(organisation_id, manual_id, figure_id, pdf_page, part_no, row_order)
  VALUES ('${ORG}', '${MANUAL}', 'F2-14', 5, 'B230101000123', ${orders[0]}), ('${ORG}', '${MANUAL}', 'F2-14', 5, 'B230101000123', ${orders[1]})`
const count = async (db) => Number((await db.query('SELECT count(*)::int AS n FROM public.oem_review_items')).rows[0].n)

test('before the fix the same part twice on one page collides on the old key', async () => {
  const db = await build()
  await assert.rejects(db.exec(`INSERT INTO public.oem_review_items(organisation_id, manual_id, figure_id, pdf_page, part_no)
    VALUES ('${ORG}', '${MANUAL}', 'F2-14', 5, 'B230101000123'), ('${ORG}', '${MANUAL}', 'F2-14', 5, 'B230101000123')`), /unique|duplicate/i)
})

test('after the fix both source rows are kept, and the same source row still dedupes', async () => {
  const db = await build()
  await db.exec(fix)
  await db.exec(twoRows())
  assert.equal(await count(db), 2, 'same part number at two callouts on one page: both rows stored')
  await db.exec(`${twoRows()} ON CONFLICT (manual_id, pdf_page, row_order) DO NOTHING`)
  assert.equal(await count(db), 2, 're-importing the same source rows adds nothing')
})

test('the fix backfills row_order from the payload and is idempotent', async () => {
  const db = await build()
  await db.exec(`INSERT INTO public.oem_review_items(organisation_id, manual_id, figure_id, pdf_page, part_no, payload)
    VALUES ('${ORG}', '${MANUAL}', 'F2-14', 5, 'A1', '{"row_order": 4}'), ('${ORG}', '${MANUAL}', 'F2-14', 5, 'A2', '{"row_order": "x"}')`)
  await db.exec(fix)
  await db.exec(fix)
  const rows = (await db.query('SELECT part_no, row_order FROM public.oem_review_items ORDER BY part_no')).rows
  assert.deepEqual(rows.map((r) => r.row_order), [4, null])
})

test('the guard aborts when existing payloads would duplicate the new key', async () => {
  const db = await build()
  await db.exec(`INSERT INTO public.oem_review_items(organisation_id, manual_id, figure_id, pdf_page, part_no, payload)
    VALUES ('${ORG}', '${MANUAL}', 'F1', 5, 'A1', '{"row_order": 4}'), ('${ORG}', '${MANUAL}', 'F2', 5, 'A2', '{"row_order": 4}')`)
  await assert.rejects(db.exec(fix), /duplicate/)
  await db.exec('ROLLBACK') // the file opens its own transaction; end it after the abort
  const def = (await db.query("SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname='oem_review_items_unique'")).rows[0].d
  assert.match(def, /figure_id, part_no, pdf_page/, 'old key untouched after the abort')
})

test('rollback restores the old key and refuses when rows would be lost', async () => {
  const db = await build()
  await db.exec(fix)
  await db.exec(twoRows())
  await assert.rejects(db.exec(rollback), /repeat a part number/)
  await db.exec('ROLLBACK')
  await db.exec('DELETE FROM public.oem_review_items WHERE row_order = 7')
  await db.exec(rollback)
  const def = (await db.query("SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname='oem_review_items_unique'")).rows[0].d
  assert.match(def, /manual_id, figure_id, part_no, pdf_page/)
  const col = await db.query("SELECT 1 FROM information_schema.columns WHERE table_name='oem_review_items' AND column_name='row_order'")
  assert.equal(col.rows.length, 0)
})
