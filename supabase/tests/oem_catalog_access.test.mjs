import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
// Staging-style access tests for the OEM parts catalog against PGlite.
// Runs the two applied OEM migrations, then the PENDING advanced migration, and proves:
//   * a read-only member (the area manager, a custom role) can browse, search and select, nothing else
//   * Manager and Director lose import/edit/delete (admin only), Admin and super admin keep it
//   * another company sees nothing and writes nothing
//   * storage upload / replace / delete are admin only, read is org scoped
//   * an admin-corrected entry cannot be deleted or silently overwritten; corrections are append only
const base1 = await readFile(new URL('../migrations/20261117130000_oem_illustrated_parts_catalog.sql', import.meta.url), 'utf8')
const base2 = await readFile(new URL('../migrations/20261117143000_oem_parts_catalog_large_manuals.sql', import.meta.url), 'utf8')
const adv = await readFile(new URL('../pending_migrations/20261118100000_oem_catalog_advanced.sql', import.meta.url), 'utf8')
const rollback = await readFile(new URL('../pending_migrations/20261118100000_oem_catalog_advanced_ROLLBACK.sql', import.meta.url), 'utf8')
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const ORG_A = id(900); const ORG_B = id(901)
const MANUAL = id(10); const ENTRY = id(20); const ENTRY2 = id(21)

async function build({ withAdvanced = true } = {}) {
  const db = new PGlite()
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA auth; CREATE SCHEMA storage;
    GRANT USAGE ON SCHEMA auth, public, storage TO authenticated, anon;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.actor',true),'')::uuid $$;
    CREATE FUNCTION public.get_my_role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.role',true),'') $$;
    CREATE FUNCTION public.is_super_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('test.super',true),'') = 'on' $$;
    CREATE FUNCTION public.app_current_org() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.org',true),'')::uuid $$;
    CREATE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth, public TO authenticated, anon;
    CREATE TABLE storage.buckets(id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
  `)
  await db.exec(base1); await db.exec(base2)
  await db.exec(`
    INSERT INTO public.oem_parts_manuals(id, organisation_id, manufacturer, model, source_file_name, source_sha256)
      VALUES ('${MANUAL}', '${ORG_A}', 'SANY', 'SY412C-8/ST', 'b.pdf', 'sha-a');
    INSERT INTO public.oem_parts_entries(id, organisation_id, manual_id, source_pdf_page, row_order, part_no, description, quantity)
      VALUES ('${ENTRY}', '${ORG_A}', '${MANUAL}', 5, 1, '60012345', 'Water tank', 1), ('${ENTRY2}', '${ORG_A}', '${MANUAL}', 5, 2, '60012346', 'Water pump', 1);
    INSERT INTO storage.objects(bucket_id, name) VALUES ('oem-parts-catalogs', '${MANUAL}/source.pdf');
  `)
  if (withAdvanced) {
    await db.exec(adv)
    await db.exec(`
      INSERT INTO public.oem_figures(organisation_id, manual_id, figure_id, pdf_page, crop) VALUES ('${ORG_A}', '${MANUAL}', 'F2-14', 4, '{"x0":1,"y0":1,"x1":9,"y1":9}');
      INSERT INTO public.oem_review_items(organisation_id, manual_id, figure_id, pdf_page, part_no) VALUES ('${ORG_A}', '${MANUAL}', 'F2-14', 5, 'BAD');
    `)
  }
  return db
}
// roles: Admin, Manager, Director, area (custom role of the area manager), plus other-company admin
const WHO = {
  admin: { role: 'Admin', org: ORG_A, actor: id(1) },
  manager: { role: 'Manager', org: ORG_A, actor: id(2) },
  director: { role: 'Director', org: ORG_A, actor: id(3) },
  area: { role: 'Workshop Maintenance Area Manager', org: ORG_A, actor: id(4) },
  other: { role: 'Admin', org: ORG_B, actor: id(5) },
  superAdmin: { role: 'Reporter', org: ORG_A, actor: id(6), superOn: true },
}
async function as(db, who, fn) {
  const w = WHO[who]
  await db.exec(`SET test.actor='${w.actor}'; SET test.role='${w.role}'; SET test.org='${w.org}'; SET test.super='${w.superOn ? 'on' : 'off'}'; SET ROLE authenticated;`)
  try { return await fn() } finally { await db.exec(`RESET ROLE; RESET test.actor; RESET test.role; RESET test.org; RESET test.super;`) }
}
const n = async (db, sql) => (await db.query(sql)).rows.length
const tryWrite = async (db, who, sql) => { try { return { rows: await as(db, who, () => n(db, sql)) } } catch (e) { return { error: String(e.message) } } }

test('advanced migration is idempotent and the rollback restores the old policies', async () => {
  const db = await build()
  await db.exec(adv)
  await db.exec(rollback)
  assert.equal(await as(db, 'manager', () => n(db, `UPDATE public.oem_parts_entries SET remark='x' WHERE id='${ENTRY}' RETURNING 1`)), 1, 'manager can edit again after rollback')
})

test('before the migration a Manager could import and edit (this is the behaviour being tightened)', async () => {
  const db = await build({ withAdvanced: false })
  assert.equal(await as(db, 'manager', () => n(db, `UPDATE public.oem_parts_entries SET remark='x' WHERE id='${ENTRY}' RETURNING 1`)), 1)
})

test('read-only member can browse manuals, entries and figures of the own company', async () => {
  const db = await build()
  assert.equal(await as(db, 'area', () => n(db, `SELECT 1 FROM public.oem_parts_manuals`)), 1)
  assert.equal(await as(db, 'area', () => n(db, `SELECT 1 FROM public.oem_parts_entries`)), 2)
  assert.equal(await as(db, 'area', () => n(db, `SELECT 1 FROM public.oem_figures`)), 1)
  assert.equal(await as(db, 'area', () => n(db, `SELECT 1 FROM storage.objects WHERE bucket_id='oem-parts-catalogs'`)), 1, 'can view the stored source for reading')
})

test('read-only member cannot import, edit, delete, publish or reprocess', async () => {
  const db = await build()
  const ins = `INSERT INTO public.oem_parts_manuals(organisation_id, manufacturer, model, source_file_name, source_sha256) VALUES ('${ORG_A}','X','Y','f','sha-new') RETURNING 1`
  for (const who of ['area', 'manager', 'director']) {
    assert.match((await tryWrite(db, who, ins)).error || '', /row-level security/, `${who} must not insert a manual`)
    assert.equal((await tryWrite(db, who, `UPDATE public.oem_parts_entries SET description='hacked' RETURNING 1`)).rows, 0, `${who} must not edit entries`)
    assert.equal((await tryWrite(db, who, `DELETE FROM public.oem_parts_entries RETURNING 1`)).rows, 0, `${who} must not delete entries`)
    assert.equal((await tryWrite(db, who, `DELETE FROM public.oem_parts_manuals RETURNING 1`)).rows, 0, `${who} must not delete manuals`)
    assert.match((await tryWrite(db, who, `INSERT INTO public.oem_figures(organisation_id, manual_id, figure_id, pdf_page) VALUES ('${ORG_A}','${MANUAL}','F9',1) RETURNING 1`)).error || '', /row-level security/)
    assert.match((await tryWrite(db, who, `INSERT INTO storage.objects(bucket_id,name) VALUES ('oem-parts-catalogs','${MANUAL}/other.pdf') RETURNING 1`)).error || '', /row-level security/, `${who} must not upload a source PDF`)
    assert.equal((await tryWrite(db, who, `DELETE FROM storage.objects WHERE bucket_id='oem-parts-catalogs' RETURNING 1`)).rows, 0, `${who} must not delete or replace the source PDF`)
  }
  assert.equal(await as(db, 'area', () => n(db, `SELECT 1 FROM public.oem_review_items`)), 0, 'review queue is admin working data')
  assert.equal(await as(db, 'area', () => n(db, `SELECT 1 FROM public.oem_corrections`)), 0)
  assert.equal(await as(db, 'area', () => tryWrite(db, 'area', `SELECT public.oem_apply_correction('${ENTRY}','description','x','r')`)).then((r) => /administrator/.test(r.error || '')), true)
})

test('admin and super admin can import, edit, publish and use the review queue', async () => {
  const db = await build()
  for (const who of ['admin', 'superAdmin']) {
    const sha = `sha-${who}`
    assert.equal((await tryWrite(db, who, `INSERT INTO public.oem_parts_manuals(organisation_id, manufacturer, model, source_file_name, source_sha256) VALUES ('${ORG_A}','X','Y','f','${sha}') RETURNING 1`)).rows, 1)
    assert.equal((await tryWrite(db, who, `INSERT INTO storage.objects(bucket_id,name) VALUES ('oem-parts-catalogs','${MANUAL}/${who}.pdf') RETURNING 1`)).rows, 1)
    assert.equal((await tryWrite(db, who, `SELECT 1 FROM public.oem_review_items`)).rows, 1)
  }
})

test('another company sees nothing of this catalog and cannot write into it', async () => {
  const db = await build()
  for (const t of ['oem_parts_manuals', 'oem_parts_entries', 'oem_figures', 'oem_review_items']) {
    assert.equal(await as(db, 'other', () => n(db, `SELECT 1 FROM public.${t}`)), 0, `other company reads ${t}`)
  }
  assert.equal(await as(db, 'other', () => n(db, `SELECT 1 FROM storage.objects WHERE bucket_id='oem-parts-catalogs'`)), 0)
  assert.match((await tryWrite(db, 'other', `INSERT INTO public.oem_parts_entries(organisation_id, manual_id, source_pdf_page, row_order, part_no, description) VALUES ('${ORG_A}','${MANUAL}',9,9,'1','x') RETURNING 1`)).error || '', /row-level security/)
  assert.match((await tryWrite(db, 'other', `SELECT public.oem_apply_correction('${ENTRY}','description','x','r')`)).error || '', /not found/)
})

test('admin corrections are audited, protected from delete and from silent overwrite', async () => {
  const db = await build()
  await as(db, 'admin', () => db.query(`SELECT public.oem_apply_correction('${ENTRY}','description','Water tank (corrected)','typo in OEM scan')`))
  const row = (await db.query(`SELECT description, admin_corrected, review_status FROM public.oem_parts_entries WHERE id='${ENTRY}'`)).rows[0]
  assert.deepEqual(row, { description: 'Water tank (corrected)', admin_corrected: true, review_status: 'approved' })
  const hist = (await db.query(`SELECT field, old_value, new_value FROM public.oem_corrections WHERE entry_id='${ENTRY}'`)).rows
  assert.equal(hist.length, 1); assert.equal(hist[0].old_value, 'Water tank'); assert.equal(hist[0].new_value, 'Water tank (corrected)')
  // an ordinary admin edit, a delete, or a re-import upsert must not change it
  assert.match((await tryWrite(db, 'admin', `UPDATE public.oem_parts_entries SET description='overwritten' WHERE id='${ENTRY}' RETURNING 1`)).error || '', /corrected by an administrator/)
  assert.match((await tryWrite(db, 'admin', `DELETE FROM public.oem_parts_entries WHERE id='${ENTRY}' RETURNING 1`)).error || '', /cannot be deleted/)
  await as(db, 'admin', () => db.query(`INSERT INTO public.oem_parts_entries(organisation_id, manual_id, source_pdf_page, row_order, part_no, description) VALUES ('${ORG_A}','${MANUAL}',5,1,'60012345','from re-import') ON CONFLICT (manual_id, source_pdf_page, row_order) DO NOTHING`))
  assert.equal((await db.query(`SELECT description FROM public.oem_parts_entries WHERE id='${ENTRY}'`)).rows[0].description, 'Water tank (corrected)')
  // history is append only
  assert.match((await tryWrite(db, 'admin', `UPDATE public.oem_corrections SET reason='x' RETURNING 1`)).error || '', /permission denied/)
  assert.match((await tryWrite(db, 'admin', `DELETE FROM public.oem_corrections RETURNING 1`)).error || '', /permission denied/)
})

test('the migration changes no existing data (reconciliation fingerprint)', async () => {
  const before = await build({ withAdvanced: false })
  const fp = async (db) => (await db.query(`SELECT count(*)::int c, md5(string_agg(id::text || part_no || description || coalesce(quantity::text,''), '|' ORDER BY id)) h FROM public.oem_parts_entries`)).rows[0]
  const a = await fp(before)
  await before.exec(adv)
  assert.deepEqual(await fp(before), a)
  assert.equal((await before.query(`SELECT count(*)::int c FROM public.oem_parts_manuals`)).rows[0].c, 1)
})
