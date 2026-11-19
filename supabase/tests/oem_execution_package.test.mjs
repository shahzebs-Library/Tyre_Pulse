import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
// Proves the OEM release-day SQL package against PGlite:
//  * 02 (rehearsal) and 03 (apply) embed byte-identical migration text, equal to the migration file
//  * the rehearsal ends in the PROBE RESULTS error, leaves nothing behind and touches no real catalog row
//  * the apply is all-or-nothing; the baseline-driven rollback restores EXACT policies and grants (zero diff)
//  * the guards abort before any change when the catalog does not match the baseline
const read = (p) => readFile(new URL(p, import.meta.url), 'utf8')
const migPath = '../migrations/20261118100000_oem_catalog_advanced.sql'
const M = await read(migPath)
const files = {}
for (const f of ['02_REHEARSAL_rolled_back', '02b_after_rehearsal_nothing_persisted', '03_APPLY_migration', '04_ROLLBACK_only_if_needed', '04b_VERIFY_rollback_vs_baseline', '06_VINAY_view_only_grant', '07_RECORD_in_migration_ledger']) files[f] = await read(`../../docs/oem-catalog/execution/${f}.sql`)
const base1 = await read('../migrations/20261117130000_oem_illustrated_parts_catalog.sql')
const base2 = await read('../migrations/20261117143000_oem_parts_catalog_large_manuals.sql')
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const ORG = id(1)
const U = { manager: '34793423-43df-4b6f-9270-9d1e8be6fa30', tyreman: '1cd74900-64fe-4f3a-913c-b9060f088ff3', vinay: '06161659-c666-48ac-82f3-5887b1082dc2', admin: '58787cc7-818b-4fd5-8b7b-c93e4e01f641' }

async function build({ entries = 1652 } = {}) {
  const db = new PGlite()
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA _bak;
    GRANT USAGE ON SCHEMA auth, public, storage TO authenticated, anon;
    CREATE TABLE public.profiles(id uuid PRIMARY KEY, role text, is_super_admin boolean DEFAULT false);
    GRANT SELECT ON public.profiles TO authenticated;
    INSERT INTO public.profiles VALUES ('${U.manager}','Manager',false), ('${U.tyreman}','Tyre Man',false), ('${U.vinay}','Workshop Maintenance Area Manager',false), ('${U.admin}','Admin',true);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT ((nullif(current_setting('request.jwt.claims',true),'')::json)->>'sub')::uuid $$;
    CREATE FUNCTION public.get_my_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT role FROM public.profiles WHERE id::text = auth.uid()::text $$;
    CREATE FUNCTION public.is_super_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT coalesce((SELECT is_super_admin FROM public.profiles WHERE id::text = auth.uid()::text), false) $$;
    CREATE FUNCTION public.app_current_org() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT '${ORG}'::uuid $$;
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
      SELECT ('00000000-0000-0000-0000-0000000000' || (10 + g))::uuid, '${ORG}', 'SANY', 'M' || g, 'f' || g || '.pdf', 'sha-' || g FROM generate_series(1, 4) g;
    INSERT INTO public.oem_parts_entries(organisation_id, manual_id, source_pdf_page, row_order, part_no, description, quantity)
      SELECT '${ORG}', '00000000-0000-0000-0000-000000000011', 1 + g / 100, 1 + g % 100, 'PN' || g, 'Part ' || g, 1 FROM generate_series(1, ${entries}) g;
    INSERT INTO storage.objects(bucket_id, name) VALUES ('oem-parts-catalogs', '00000000-0000-0000-0000-000000000011/a.pdf'), ('oem-parts-catalogs', '00000000-0000-0000-0000-000000000012/b.pdf');
    CREATE TABLE _bak.oem_policies_20261118 AS SELECT * FROM pg_policies WHERE (schemaname = 'public' AND tablename IN ('oem_parts_manuals','oem_parts_entries')) OR (schemaname = 'storage' AND policyname LIKE 'oem_parts_pdf%');
    CREATE TABLE _bak.oem_grants_20261118 AS SELECT grantee, table_name, privilege_type FROM information_schema.table_privileges WHERE table_schema = 'public' AND table_name IN ('oem_parts_manuals','oem_parts_entries');
  `)
  const fp = (await db.query(`SELECT md5(string_agg(id::text || part_no || description || coalesce(quantity::text,''), '|' ORDER BY id)) AS fp FROM public.oem_parts_entries`)).rows[0].fp
  const pol = (await db.query('SELECT count(*)::int AS n FROM _bak.oem_policies_20261118')).rows[0].n
  return { db, fp, pol }
}
// The files hard-code the production numbers (4 manuals, 1652 entries, 2 objects, 22 baseline policies, production fingerprint).
// The fixture matches all but the fingerprint and the baseline policy count, which are substituted.
const adapt = (sql, fp, pol) => sql.replaceAll('4270e1621f940a37d226c538118114e7', fp).replaceAll('<> 22', `<> ${pol}`)

test('rehearsal and apply embed the identical migration bytes', () => {
  const sha = createHash('sha256').update(M).digest('hex')
  assert.ok(files['02_REHEARSAL_rolled_back'].includes(M), 'rehearsal embeds the migration file verbatim')
  assert.ok(files['03_APPLY_migration'].includes(M), 'apply embeds the migration file verbatim')
  assert.ok(files['02_REHEARSAL_rolled_back'].includes(sha) && files['03_APPLY_migration'].includes(sha))
  assert.ok(files['02_REHEARSAL_rolled_back'].trimStart().split('\n').find((l) => !l.startsWith('--')).startsWith('begin;'))
  assert.ok(files['02b_after_rehearsal_nothing_persisted'].startsWith('rollback;'))
  assert.ok(files['03_APPLY_migration'].includes('begin;') && files['03_APPLY_migration'].trimEnd().endsWith('commit;'))
  for (const f of ['02_REHEARSAL_rolled_back', '03_APPLY_migration']) assert.match(files[f], /set local lock_timeout = '5s';\s*set local statement_timeout = '120s';/)
})

test('rehearsal: PROBE RESULTS error, nothing persisted, real rows untouched, synthetic-only probes', async () => {
  const { db, fp, pol } = await build()
  const before = (await db.query(`SELECT md5(string_agg(id::text || part_no || description || coalesce(quantity::text,''), '|' ORDER BY id)) AS fp FROM public.oem_parts_entries`)).rows[0].fp
  let message = ''
  try { await db.exec(adapt(files['02_REHEARSAL_rolled_back'], fp, pol)) } catch (e) { message = String(e.message) }
  assert.match(message, /PROBE RESULTS/)
  await db.exec(files['02b_after_rehearsal_nothing_persisted'])
  const q = async (s) => (await db.query(s)).rows[0]
  assert.equal((await q(`SELECT to_regproc('public.oem_catalog_admin') IS NOT NULL AS a, to_regclass('public.oem_figures') IS NOT NULL AS b`)).a, false)
  assert.equal((await q(`SELECT to_regclass('public.oem_figures') IS NOT NULL AS b`)).b, false)
  assert.equal((await q('SELECT count(*)::int AS n FROM public.oem_parts_entries')).n, 1652)
  assert.equal((await q(`SELECT count(*)::int AS n FROM public.oem_parts_manuals WHERE source_sha256 LIKE 'probe-sha%'`)).n, 0)
  assert.equal((await q(`SELECT md5(string_agg(id::text || part_no || description || coalesce(quantity::text,''), '|' ORDER BY id)) AS fp FROM public.oem_parts_entries`)).fp, before)
  const line = (who) => message.split('\n').find((l) => l.startsWith(who + ' '))
  for (const who of ['manager', 'tyreman', 'vinay']) {
    const l = line(who)
    for (const want of ['realManuals=4', 'realEntries=1652', 'insertManual=blocked', 'updateSynthetic=0', 'correction=blocked', 'deleteSynthetic=0', 'reassign=blocked', 'merge=blocked', 'split=blocked', 'storageInsert=blocked']) assert.ok(l.includes(want), `${who}: ${want} in ${l}`)
  }
  const a = line('admin')
  for (const want of ['insertManual=ALLOWED', 'updateSynthetic=1', 'correction=ALLOWED', 'deleteSynthetic=1', 'deleteCorrectedSynthetic=blocked', 'reassign=ALLOWED', 'merge=ALLOWED', 'split=ALLOWED', 'storageInsert=ALLOWED']) assert.ok(a.includes(want), `admin: ${want} in ${a}`)
})

test('guard aborts before any change when the catalog differs from the baseline', async () => {
  const { db, fp, pol } = await build({ entries: 1651 })
  let message = ''
  try { await db.exec(adapt(files['03_APPLY_migration'], fp, pol)) } catch (e) { message = String(e.message) }
  assert.match(message, /GUARD: expected 4 manuals and 1652 entries/)
  await db.exec('rollback')
  assert.equal((await db.query(`SELECT to_regproc('public.oem_catalog_admin') IS NOT NULL AS a`)).rows[0].a, false)
})

test('apply is all-or-nothing and the baseline rollback restores exact policies and grants', async () => {
  const { db, fp, pol } = await build()
  const diffSql = files['04b_VERIFY_rollback_vs_baseline']
  await db.exec(adapt(files['03_APPLY_migration'], fp, pol))
  assert.equal((await db.query(`SELECT to_regproc('public.oem_catalog_admin') IS NOT NULL AS a`)).rows[0].a, true)
  const mid = (await db.query(`SELECT side, count(*)::int AS n FROM pg_temp.oem_policy_diff() GROUP BY side ORDER BY side`).catch(() => null))
  await db.exec(diffSql)
  const changed = (await db.query('SELECT side, count(*)::int AS n FROM pg_temp.oem_policy_diff() GROUP BY side ORDER BY side')).rows
  assert.deepEqual(changed, [{ side: 'baseline_not_live', n: 9 }, { side: 'live_not_baseline', n: 9 }])
  void mid
  await db.exec(adapt(files['04_ROLLBACK_only_if_needed'], fp, pol))
  assert.equal((await db.query(`SELECT to_regclass('public.oem_figures') IS NOT NULL AS b`)).rows[0].b, false)
  assert.equal((await db.query(`SELECT to_regproc('public.oem_catalog_admin') IS NOT NULL AS a`)).rows[0].a, false)
  assert.equal((await db.query('SELECT count(*)::int AS n FROM pg_temp.oem_policy_diff()')).rows[0].n, 0)
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.oem_parts_entries')).rows[0].n, 1652)
})

test('apply assert block rolls everything back when a post-condition fails', async () => {
  const { db, fp, pol } = await build()
  // Break a post-condition on purpose: the baseline says there should be a grant that no longer exists.
  await db.exec(`INSERT INTO _bak.oem_grants_20261118 VALUES ('authenticated', 'oem_parts_entries', 'TRUNCATE')`)
  let message = ''
  try { await db.exec(adapt(files['03_APPLY_migration'], fp, pol)) } catch (e) { message = String(e.message) }
  assert.match(message, /ASSERT: 1 baseline grants missing/)
  await db.exec('rollback')
  assert.equal((await db.query(`SELECT to_regproc('public.oem_catalog_admin') IS NOT NULL AS a`)).rows[0].a, false)
})

test('Vinay grant and ledger files carry explicit provenance and guards', () => {
  const v = files['06_VINAY_view_only_grant']
  for (const s of ['06161659-c666-48ac-82f3-5887b1082dc2', "'parts_catalog_oem_preview'", "set_config('app.access_reason'", 'granted_by', '58787cc7-818b-4fd5-8b7b-c93e4e01f641', 'on conflict (user_id, module_key, capability, effect) do nothing']) assert.ok(v.includes(s), s)
  const l = files['07_RECORD_in_migration_ledger']
  for (const s of ["'20261118100000'", "'oem_catalog_advanced'", 'on conflict do nothing', createHash('sha256').update(M).digest('hex')]) assert.ok(l.includes(s), s)
})
