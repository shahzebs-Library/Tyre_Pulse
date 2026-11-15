// Stored report PDFs against the REAL Supabase Storage API (built from source, file backend)
// and real PostgREST, on a local copy of the synthetic staging database. Sign-in is the local
// shim (not GoTrue). Nothing here can reach production: the stack only listens on 127.0.0.1.
//
//   source e2e/pdf-storage/env.sh && node e2e/pdf-storage/specs/storage_api.mjs
//
// Uses supabase-js exactly as src/lib/api/pdfCache.js does: upload with upsert, createSignedUrl
// with a download name, download, remove.
import fs from 'node:fs'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(`${process.env.PDF_E2E_REPO}/package.json`)
const { createClient } = require('@supabase/supabase-js')

const URL_ = `http://127.0.0.1:${process.env.GATEWAY_PORT}`
const ANON = fs.readFileSync(`${process.env.PDF_E2E_RUN}/anon_key`, 'utf8').trim()
const DB = process.env.PDF_E2E_DB
const BUCKET = 'report-pdfs'
const ALPHA = '00000000-0000-0000-0000-000000000001'

const sql = (q) => execFileSync('psql', ['-X', '-q', '-At', '-h', '127.0.0.1', '-p', process.env.PGPORT_E2E || '54329', '-U', 'postgres', '-d', DB, '-c', q], { encoding: 'utf8' }).trim()
const accounts = () => {
  const out = {}
  for (const line of fs.readFileSync(process.env.E2E_ACCOUNTS_FILE, 'utf8').split('\n')) {
    const p = line.split('|').map((s) => s.trim())
    if (p.length >= 5 && p[3].includes('@')) out[p[2]] = { email: p[3], password: p[4] }
  }
  return out
}
const ACC = accounts()
async function as(username) {
  const c = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error } = await c.auth.signInWithPassword(ACC[username])
  if (error) throw new Error(`sign-in failed for ${username}`)
  return c
}
const pdf = (label) => Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\n% ${label}\ntrailer<</Root 1 0 R>>\n%%EOF\n`)
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')
const key = (src, tpl = 'tpl-e2e') => ({ p_type: 'tyre_inspection', p_source: src, p_template: tpl, p_branding: 'b-e2e', p_client_rev: '' })

const results = []
let failed = 0
function ok(cond, name, detail = '') {
  results.push({ name, pass: !!cond, detail: cond ? '' : String(detail).slice(0, 300) })
  if (!cond) failed += 1
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : `  [${String(detail).slice(0, 200)}]`}`)
}
const rpc = async (c, fn, args) => { const { data, error } = await c.rpc(fn, args); if (error) throw new Error(`${fn}: ${error.message}`); return data }
const upload = (c, path, bytes, contentType = 'application/pdf') => c.storage.from(BUCKET)
  .upload(path, new Blob([bytes], { type: contentType }), { contentType, upsert: true, cacheControl: '31536000' })

// ------------------------------------------------------------------ fixtures (synthetic rows only)
const pick = (where) => sql(`select id from public.inspections where organisation_id = '${ALPHA}' and country = 'KSA' and ${where} order by id limit 1`)
const insEast = pick(`site = 'ALPHA EAST PLANT' and approval_status = 'pending_approval'`)
const insEastApproved = pick(`site = 'ALPHA EAST PLANT' and approval_status = 'approved'`)
const insNorth = pick(`site = 'ALPHA NORTH PLANT'`)
const insBeta = sql(`select id from public.inspections where organisation_id = 'bbbbbbbb-0000-4000-8000-000000000002' and country = 'KSA' order by id limit 1`)
// clean slate for a repeatable run (this database copy only)
sql(`set session_replication_role = replica; delete from public.report_pdf_events; delete from public.report_pdf_bulk_requests; update public.report_pdf_files set superseded_by = null, regenerated_from = null; delete from public.report_pdf_files; delete from public.report_pdf_settings_events; delete from public.report_pdf_settings; delete from storage.objects where bucket_id = '${BUCKET}'; update public.profiles set sites = array['ALPHA EAST PLANT'] where email = 'alpha.tyreman@staging.tyrepulse.invalid';`)

const manager = await as('alpha.manager'), admin = await as('alpha.admin'), tyreman = await as('alpha.tyreman')
const beta = await as('beta.manager'), betaAdmin = await as('beta.admin')
const anon = createClient(URL_, ANON, { auth: { persistSession: false } })

// ------------------------------------------------------------------ 1. first generation through the real Storage API
const bytes1 = pdf('east working copy 1')
const claim = await rpc(manager, 'pdf_cache_claim', { ...key(insEast), p_file_name: 'Tyre Insp EAST.pdf', p_lease_seconds: 180, p_retry: false })
ok(claim.ok && claim.state === 'claimed', 'manager claims the job', JSON.stringify(claim))
{
  const wrong = await upload(manager, `${ALPHA}/tyre_inspection/${insEast}/not-my-job.pdf`, bytes1)
  ok(!!wrong.error, 'Storage API refuses an upload to a path that is not the leased job', JSON.stringify(wrong.data))
  const other = await upload(tyreman, claim.path, bytes1)
  ok(!!other.error, 'Storage API refuses an upload by a person who does not hold the lease')
  const notPdf = await upload(manager, claim.path, Buffer.from('hello'), 'text/plain')
  ok(!!notPdf.error, 'Storage API refuses a non-PDF content type (bucket rule)', JSON.stringify(notPdf.data))
  const up = await upload(manager, claim.path, bytes1)
  ok(!up.error, 'Storage API accepts the upload from the lease holder (upsert)', up.error?.message)
  const again = await upload(manager, claim.path, bytes1)
  ok(!again.error, 'a repeated upload of the same job (interrupted attempt) is accepted', again.error?.message)
  const bad = await rpc(manager, 'pdf_cache_complete', { p_file: claim.file_id, p_sha256: sha(bytes1), p_bytes: bytes1.length + 7 })
  ok(bad.reason === 'size_mismatch', 'complete compares the size the real Storage API recorded', JSON.stringify(bad))
  const done = await rpc(manager, 'pdf_cache_complete', { p_file: claim.file_id, p_sha256: sha(bytes1), p_bytes: bytes1.length })
  ok(done.ok && done.state === 'ready', 'complete accepts the stored object (real size and mimetype metadata)', JSON.stringify(done))
  const meta = JSON.parse(sql(`select metadata::text from storage.objects where bucket_id = '${BUCKET}' and name = '${claim.path}'`))
  ok(Number(meta.size) === bytes1.length && meta.mimetype === 'application/pdf', 'storage metadata keys are the ones the SQL reads (size, mimetype)', JSON.stringify(meta))
}

// ------------------------------------------------------------------ 2. a ready file is frozen at the Storage API too
{
  const over = await upload(manager, claim.path, pdf('tampered'))
  ok(!!over.error, 'Storage API refuses to overwrite a ready file (upsert by its own generator)')
  const overAdmin = await upload(admin, claim.path, pdf('tampered by admin'))
  ok(!!overAdmin.error, 'Storage API refuses to overwrite a ready file (administrator)')
  const rm = await manager.storage.from(BUCKET).remove([claim.path])
  ok(!rm.error && (rm.data || []).length === 0, 'Storage API removes nothing for a manager', JSON.stringify(rm))
  const rmAdmin = await admin.storage.from(BUCKET).remove([claim.path])
  ok(!rmAdmin.error && (rmAdmin.data || []).length === 0, 'Storage API removes nothing for an administrator while the copy is current')
}

// ------------------------------------------------------------------ 3. repeat download: signed link with the download name
{
  const look = await rpc(manager, 'pdf_cache_lookup', key(insEast))
  ok(look.state === 'ready' && look.file.path === claim.path, 'lookup: ready, no regeneration')
  const { data, error } = await manager.storage.from(BUCKET).createSignedUrl(claim.path, 120, { download: 'Tyre Insp EAST.pdf' })
  ok(!error && /token=/.test(data?.signedUrl || ''), 'createSignedUrl works for an authorised reader', error?.message)
  const res = await fetch(data.signedUrl)
  const body = Buffer.from(await res.arrayBuffer())
  ok(res.status === 200 && sha(body) === sha(bytes1), 'the signed link returns the stored bytes (sha256 identical)', res.status)
  ok(/attachment/i.test(res.headers.get('content-disposition') || '') && /Tyre(%20| )Insp(%20| )EAST\.pdf/.test(res.headers.get('content-disposition') || ''),
    'the signed link carries the download file name', res.headers.get('content-disposition'))
  ok((res.headers.get('content-type') || '').startsWith('application/pdf'), 'served as application/pdf', res.headers.get('content-type'))
  const dl = await manager.storage.from(BUCKET).download(claim.path)
  ok(!dl.error && sha(Buffer.from(await dl.data.arrayBuffer())) === sha(bytes1), 'authenticated download returns the same bytes (bulk ZIP path)')
  const noToken = await fetch(data.signedUrl.replace(/token=[^&]+/, 'token=broken'))
  ok(noToken.status >= 400, 'a broken token is refused', noToken.status)
}

// ------------------------------------------------------------------ 4. other company, other site, anon
{
  const s1 = await beta.storage.from(BUCKET).createSignedUrl(claim.path, 120)
  ok(!!s1.error, 'another company cannot make a signed link')
  const d1 = await beta.storage.from(BUCKET).download(claim.path)
  ok(!!d1.error, 'another company cannot download')
  const s2 = await anon.storage.from(BUCKET).createSignedUrl(claim.path, 120)
  ok(!!s2.error, 'anon cannot make a signed link')
  const d2 = await anon.storage.from(BUCKET).download(claim.path)
  ok(!!d2.error, 'anon cannot download')
  const pub = await fetch(`${URL_}/storage/v1/object/public/${BUCKET}/${claim.path}`)
  ok(pub.status >= 400, 'the bucket is not public', pub.status)
  const list = await beta.storage.from(BUCKET).list(`${ALPHA}/tyre_inspection/${insEast}`)
  ok(!list.error && (list.data || []).length === 0, 'another company lists nothing under the path')
  const bl = await rpc(beta, 'pdf_cache_lookup', key(insEast))
  ok(bl.reason === 'not_available', 'another company: lookup refused')
}

// ------------------------------------------------------------------ 5. Tyre Man: only reports he is authorised to see
{
  // a stored report for another site of the same company and country
  const c2 = await rpc(admin, 'pdf_cache_claim', { ...key(insNorth), p_file_name: 'Tyre Insp NORTH.pdf', p_lease_seconds: 180, p_retry: true })
  const b2 = pdf('north')
  const up = await upload(admin, c2.path, b2)
  const done = await rpc(admin, 'pdf_cache_complete', { p_file: c2.file_id, p_sha256: sha(b2), p_bytes: b2.length })
  ok(!up.error && done.state === 'ready', 'fixture: a report of ALPHA NORTH PLANT is stored')

  const mine = await tyreman.storage.from(BUCKET).createSignedUrl(claim.path, 120, { download: 'x.pdf' })
  ok(!mine.error, 'tyre man: signed link for a report of his own site')
  const mineDl = await tyreman.storage.from(BUCKET).download(claim.path)
  ok(!mineDl.error, 'tyre man: download of a report of his own site')
  const notMine = await tyreman.storage.from(BUCKET).createSignedUrl(c2.path, 120)
  ok(!!notMine.error, 'tyre man: NO signed link for a report of another site')
  const notMineDl = await tyreman.storage.from(BUCKET).download(c2.path)
  ok(!!notMineDl.error, 'tyre man: NO download of a report of another site')
  const tl = await rpc(tyreman, 'pdf_cache_lookup', key(insNorth))
  ok(tl.reason === 'not_available', 'tyre man: lookup of another site refused')
  const rows = await tyreman.from('report_pdf_files').select('id,site')
  ok(!rows.error && rows.data.length === 1 && rows.data[0].site === 'ALPHA EAST PLANT', 'tyre man: sees only his own site in report_pdf_files', JSON.stringify(rows.data))
  const bulk = await rpc(tyreman, 'pdf_cache_bulk_request', { p_type: 'tyre_inspection', p_sources: [insEast, insNorth, insBeta, crypto.randomUUID()] })
  ok(bulk.ok && bulk.allowed.length === 1 && bulk.allowed[0] === insEast && bulk.refused === 3, 'tyre man: bulk request allows only his own site', JSON.stringify(bulk))
  const regen = await rpc(tyreman, 'pdf_cache_regenerate', { ...key(insEast), p_file_name: null, p_reason: 'I want a new one', p_lease_seconds: 180 })
  ok(regen.reason === 'not_allowed', 'tyre man: cannot regenerate')
  const rm = await tyreman.storage.from(BUCKET).remove([claim.path])
  ok((rm.data || []).length === 0, 'tyre man: cannot remove a stored report')
}

// ------------------------------------------------------------------ 6. bulk limit (configurable, server enforced)
{
  const s0 = await rpc(manager, 'pdf_cache_settings', {})
  ok(s0.bulk_limit === 50 && s0.retention_days === 90 && s0.can_regenerate_approved === false, 'defaults: limit 50, retention 90, manager not authorised', JSON.stringify(s0))
  const set = await rpc(admin, 'pdf_cache_update_settings', { p_bulk_limit: 2, p_retention_days: null, p_manager_regenerate: null })
  ok(set.ok && set.bulk_limit === 2, 'administrator sets the bulk limit to 2')
  const over = await rpc(manager, 'pdf_cache_bulk_request', { p_type: 'tyre_inspection', p_sources: [insEast, insNorth, insEastApproved] })
  ok(over.ok === false && over.reason === 'over_limit' && over.limit === 2, 'three reports with a limit of two: refused by the server', JSON.stringify(over))
  const low = await rpc(admin, 'pdf_cache_update_settings', { p_bulk_limit: null, p_retention_days: 30, p_manager_regenerate: null })
  ok(low.reason === 'retention_below_minimum', 'retention below 90 days refused')
  const mgr = await rpc(manager, 'pdf_cache_update_settings', { p_bulk_limit: 500, p_retention_days: null, p_manager_regenerate: true })
  ok(mgr.reason === 'admin_only', 'a manager cannot change the settings or authorise himself')
  await rpc(admin, 'pdf_cache_update_settings', { p_bulk_limit: 50, p_retention_days: 120, p_manager_regenerate: null })
}

// ------------------------------------------------------------------ 7. approved report: authorised regeneration keeps the original
{
  const ca = await rpc(admin, 'pdf_cache_claim', { ...key(insEastApproved), p_file_name: 'Tyre Insp APPROVED.pdf', p_lease_seconds: 180, p_retry: true })
  const orig = pdf('approved original, signed')
  await upload(admin, ca.path, orig)
  const done = await rpc(admin, 'pdf_cache_complete', { p_file: ca.file_id, p_sha256: sha(orig), p_bytes: orig.length })
  ok(done.immutable === true, 'approved inspection: stored revision is locked')
  const r0 = await rpc(manager, 'pdf_cache_regenerate', { ...key(insEastApproved), p_file_name: null, p_reason: 'Please refresh', p_lease_seconds: 180 })
  ok(r0.reason === 'approved_needs_authorisation', 'manager without authorisation: refused')
  await rpc(admin, 'pdf_cache_update_settings', { p_bulk_limit: null, p_retention_days: null, p_manager_regenerate: true })
  const r1 = await rpc(manager, 'pdf_cache_regenerate', { ...key(insEastApproved), p_file_name: null, p_reason: null, p_lease_seconds: 180 })
  ok(r1.reason === 'reason_required', 'authorised manager without a reason: refused')
  const r2 = await rpc(manager, 'pdf_cache_regenerate', { ...key(insEastApproved), p_file_name: null, p_reason: 'Customer asked for a fresh print', p_lease_seconds: 180 })
  ok(r2.ok && r2.state === 'claimed' && r2.path !== ca.path && /\.g2\.pdf$/.test(r2.path), 'authorised manager with a reason: a new revision on its own path', JSON.stringify(r2))
  const rev = pdf('approved revision 2')
  const up = await upload(manager, r2.path, rev)
  const d2 = await rpc(manager, 'pdf_cache_complete', { p_file: r2.file_id, p_sha256: sha(rev), p_bytes: rev.length })
  ok(!up.error && d2.state === 'ready', 'the new revision is stored')
  const origDl = await manager.storage.from(BUCKET).download(ca.path)
  ok(!origDl.error && sha(Buffer.from(await origDl.data.arrayBuffer())) === sha(orig), 'the ORIGINAL approved file is still stored, byte for byte')
  const overwrite = await upload(manager, ca.path, pdf('overwrite original'))
  ok(!!overwrite.error, 'the original approved file cannot be overwritten through the Storage API')
  const row = JSON.parse(sql(`select row_to_json(t)::text from (select regenerate_reason, regenerated_from, created_by, immutable from public.report_pdf_files where id = '${r2.file_id}') t`))
  ok(row.regenerate_reason === 'Customer asked for a fresh print' && row.regenerated_from === ca.file_id && row.immutable, 'the revision records who, why and which revision it follows', JSON.stringify(row))
  const vers = await manager.from('report_pdf_files').select('id,generation,immutable,superseded_at,sha256').eq('source_id', insEastApproved).eq('status', 'ready').order('generation')
  ok(vers.data.length === 2 && vers.data[0].sha256 === sha(orig) && vers.data[0].superseded_at && !vers.data[1].superseded_at, 'both revisions are listed: the original as previous, the new one as current')
  await rpc(admin, 'pdf_cache_update_settings', { p_bulk_limit: null, p_retention_days: null, p_manager_regenerate: false })
}

// ------------------------------------------------------------------ 8. retention: only marked working copies can be removed
{
  // make a superseded working copy: regenerate the EAST working report
  const r = await rpc(manager, 'pdf_cache_regenerate', { ...key(insEast), p_file_name: null, p_reason: null, p_lease_seconds: 180 })
  const b = pdf('east working copy 2')
  await upload(manager, r.path, b)
  await rpc(manager, 'pdf_cache_complete', { p_file: r.file_id, p_sha256: sha(b), p_bytes: b.length })
  const oldId = claim.file_id
  ok(sql(`select public.pdf_cache_retention_run(100)->>'marked'`) === '0', 'retention marks nothing that is younger than the retention time')
  sql(`update public.report_pdf_files set superseded_at = now() - interval '200 days' where superseded_at is not null`)
  ok(sql(`select public.pdf_cache_retention_run(100)->>'marked'`) === '1', 'after the retention time exactly the working copy is marked (the approved original is not)')
  const approvedOld = sql(`select storage_path from public.report_pdf_files where source_id = '${insEastApproved}' and superseded_at is not null`)
  const tryRun = await manager.rpc('pdf_cache_retention_run', { p_limit: 10 })
  ok(!!tryRun.error, 'a signed-in person cannot start the retention job')
  const rmMgr = await manager.storage.from(BUCKET).remove([claim.path])
  ok((rmMgr.data || []).length === 0, 'manager: the Storage API removes nothing, even when marked')
  const rmBeta = await betaAdmin.storage.from(BUCKET).remove([claim.path])
  ok((rmBeta.data || []).length === 0, 'another company\'s administrator: the Storage API removes nothing')
  const early = await rpc(admin, 'pdf_cache_purge_confirm', { p_file: oldId })
  ok(early.reason === 'object_still_present', 'a purge cannot be recorded while the object exists')
  const list = await rpc(admin, 'pdf_cache_purge_list', { p_limit: 20 })
  ok(list.length === 1 && list[0].path === claim.path, 'the administrator is offered exactly the marked copy')
  const rmApproved = await admin.storage.from(BUCKET).remove([approvedOld])
  ok((rmApproved.data || []).length === 0, 'administrator: the Storage API refuses to remove an approved revision, however old')
  const rmAdmin = await admin.storage.from(BUCKET).remove([claim.path])
  ok(!rmAdmin.error && (rmAdmin.data || []).length === 1, 'administrator: the Storage API removes the marked working copy', JSON.stringify(rmAdmin))
  const conf = await rpc(admin, 'pdf_cache_purge_confirm', { p_file: oldId })
  ok(conf.ok === true, 'purge recorded once the object is gone')
  const gone = await admin.storage.from(BUCKET).download(claim.path)
  ok(!!gone.error, 'the purged object is no longer downloadable')
  const still = await admin.storage.from(BUCKET).download(approvedOld)
  ok(!still.error, 'the approved original is still downloadable after the purge')
  ok(sql(`select count(*) from public.report_pdf_files where id = '${oldId}' and purged_at is not null and sha256 is not null`) === '1', 'the row stays as the record of the purged copy')
}

const out = { ran_at: new Date().toISOString(), storage_api: 'supabase/storage v1.11.13 built from source, file backend', total: results.length, failed, results }
fs.mkdirSync(`${process.env.PDF_E2E_RUN}/results`, { recursive: true })
fs.writeFileSync(`${process.env.PDF_E2E_RUN}/results/storage_api.json`, JSON.stringify(out, null, 2))
console.log(`\n${results.length - failed} of ${results.length} checks passed`)
process.exit(failed ? 1 : 0)
