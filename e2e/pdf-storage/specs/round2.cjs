// Round 2 of the authenticated storage integration (docs/pdf/PDF_ROLLOUT.md section 8).
// Real production build, real PostgREST, the REAL Supabase Storage API (local, file backend),
// signed-in sessions from the local sign-in shim. Every storage call carries the person's own JWT;
// the service key is never used by a client here. Local copy of the synthetic staging database.
//
//   source e2e/pdf-storage/env.sh && node e2e/pdf-storage/specs/round2.cjs
//
// Cases: 1 first and repeat download (Manager, Admin), 2 company isolation and anonymous,
// 3 Tyre Man site scope, 4 approved revision immutable and audited regeneration, 5 bulk limit,
// 6 retention dry run, 7 observation PDF in the browser.
const fs = require('fs')
const crypto = require('crypto')
const { execFileSync } = require('child_process')
const load = () => { for (const p of [process.env.E2E_PLAYWRIGHT, '/opt/node22/lib/node_modules/playwright', 'playwright'].filter(Boolean)) { try { return require(p) } catch { /* next */ } } throw new Error('Playwright not found') }
const { chromium } = load()
const { createClient } = require(`${process.env.PDF_E2E_REPO}/node_modules/@supabase/supabase-js`)

const WEB = `http://127.0.0.1:${process.env.WEB_PORT}`
const API = `http://127.0.0.1:${process.env.GATEWAY_PORT}`
const RUN = process.env.PDF_E2E_RUN
const DB = process.env.PDF_E2E_DB
const BUCKET = 'report-pdfs'
const ALPHA = '00000000-0000-0000-0000-000000000001'
const BETA = 'bbbbbbbb-0000-4000-8000-000000000002'
const ANON = fs.readFileSync(`${RUN}/anon_key`, 'utf8').trim()
const SERVICE = fs.readFileSync(`${RUN}/service_key`, 'utf8').trim()
const sql = (q) => execFileSync('psql', ['-X', '-q', '-At', '-h', '127.0.0.1', '-p', process.env.PGPORT_E2E || '54329', '-U', 'postgres', '-d', DB, '-c', q], { encoding: 'utf8' }).trim()
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')
const jwtPayload = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString('utf8'))
const ACC = {}
for (const line of fs.readFileSync(process.env.E2E_ACCOUNTS_FILE, 'utf8').split('\n')) {
  const p = line.split('|').map((s) => s.trim())
  if (p.length >= 5 && p[3].includes('@')) ACC[p[2]] = { email: p[3], password: p[4] }
}
const results = []; const timings = {}; let failed = 0
function ok(cond, name, detail = '') {
  results.push({ name, pass: !!cond, detail: String(detail).slice(0, 400) }); if (!cond) failed += 1
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? `  [${String(detail).slice(0, 240)}]` : ''}`)
}
const pdfBytes = (label) => Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\n% ${label}\ntrailer<</Root 1 0 R>>\n%%EOF\n`)

// ------------------------------------------------------------------ API sessions (real JWT from the gateway)
async function as(username) {
  const c = createClient(API, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await c.auth.signInWithPassword(ACC[username])
  if (error) throw new Error(`sign-in failed for ${username}`)
  c.token = data.session.access_token; c.uid = data.user.id
  return c
}
const rpc = async (c, fn, args) => { const { data, error } = await c.rpc(fn, args); if (error) throw new Error(`${fn}: ${error.message}`); return data }
// Raw Storage API calls with an explicit bearer (or none): status codes are what we report.
async function storageGet(path, bearer) {
  const h = { apikey: ANON }; if (bearer) h.authorization = `Bearer ${bearer}`
  return (await fetch(`${API}/storage/v1/object/authenticated/${BUCKET}/${path}`, { headers: h })).status
}
async function storageSign(path, bearer) {
  const h = { apikey: ANON, 'content-type': 'application/json' }; if (bearer) h.authorization = `Bearer ${bearer}`
  return (await fetch(`${API}/storage/v1/object/sign/${BUCKET}/${path}`, { method: 'POST', headers: h, body: JSON.stringify({ expiresIn: 120 }) })).status
}
async function storageWrite(path, bearer, method, bytes) {
  const h = { apikey: ANON, 'content-type': 'application/pdf', 'x-upsert': 'true' }; if (bearer) h.authorization = `Bearer ${bearer}`
  const r = await fetch(`${API}/storage/v1/object/${BUCKET}/${path}`, { method, headers: h, body: bytes })
  return { status: r.status, body: (await r.text()).slice(0, 160) }
}
async function restRows(table, query, bearer) {
  const h = { apikey: ANON }; if (bearer) h.authorization = `Bearer ${bearer}`
  const r = await fetch(`${API}/rest/v1/${table}?${query}`, { headers: h })
  const body = await r.text()
  let rows = null; try { rows = JSON.parse(body) } catch { /* not json */ }
  return { status: r.status, rows }
}
async function restRpc(fn, args, bearer) {
  const h = { apikey: ANON, 'content-type': 'application/json' }; if (bearer) h.authorization = `Bearer ${bearer}`
  const r = await fetch(`${API}/rest/v1/rpc/${fn}`, { method: 'POST', headers: h, body: JSON.stringify(args) })
  const t = await r.text(); let j = null; try { j = JSON.parse(t) } catch { /* */ }
  return { status: r.status, json: j, text: t.slice(0, 160) }
}

// ------------------------------------------------------------------ browser
let browser
async function signIn(username) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', acceptDownloads: true })
  const page = await context.newPage()
  const log = { uploads: 0, signs: 0, signedOpens: 0, storageAuth: new Set(), errors: [] }
  page.on('pageerror', (e) => log.errors.push(String(e.message).slice(0, 200)))
  page.on('request', (r) => {
    if (!/\/storage\/v1\//.test(r.url())) return
    // A signed URL is opened by the browser itself and carries its own short-lived token in the query.
    if (r.method() === 'GET' && /\/object\/sign\/.*[?&]token=/.test(r.url())) { log.signedOpens += 1; return }
    log.storageAuth.add(r.headers().authorization || '(none)')
  })
  page.on('response', (r) => {
    const u = r.url().replace(/^https?:\/\/[^/]+/, '')
    if (r.request().method() === 'POST' && /^\/storage\/v1\/object\/report-pdfs\//.test(u) && r.status() < 300) log.uploads += 1
    if (/^\/storage\/v1\/object\/sign\//.test(u) && r.status() < 300) log.signs += 1
  })
  await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('#login-identifier', ACC[username].email)
  await page.fill('#login-password', ACC[username].password)
  await page.click('button[type=submit].tpl-primary')
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 })
  const skip = page.getByRole('button', { name: 'Skip tour' }).first()
  if (await skip.waitFor({ state: 'visible', timeout: 4000 }).then(() => true, () => false)) await skip.click()
  await page.goto(`${WEB}/inspections`, { waitUntil: 'domcontentloaded' })
  await page.locator('button[aria-label^="Export detailed PDF"]').first().waitFor({ timeout: 30000 })
  return { context, page, log }
}
async function download(page, trigger) {
  const t0 = Date.now()
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 90000 }), trigger()])
  const p = await dl.path()
  const out = { name: dl.suggestedFilename(), bytes: fs.readFileSync(p), ms: Date.now() - t0, url: dl.url() }
  fs.rmSync(p, { force: true })
  return out
}
const rowButton = (page, asset) => page.locator(`button[aria-label^="Export detailed PDF"][aria-label*="${asset}"]`).first()
// The browser's own Authorization header on every Storage API request: the person's JWT, never the service key.
function checkStorageAuth(log, uid, who) {
  const hs = [...log.storageAuth]
  const good = hs.length > 0 && hs.every((h) => h.startsWith('Bearer ') && h !== `Bearer ${SERVICE}` && (() => {
    const p = jwtPayload(h.slice(7)); return p.role === 'authenticated' && p.sub === uid
  })())
  ok(good, `${who}: every Storage API request carried the person's own JWT (role authenticated, sub = user), never the service key`, hs.map((h) => (h.startsWith('Bearer ') ? `Bearer ${JSON.stringify(jwtPayload(h.slice(7)))}` : h)).join(' ; ').slice(0, 300) + ` (signed URL opens without a header: ${log.signedOpens})`)
}
const userId = (u) => sql(`select id from public.profiles where email = '${ACC[u].email}'`)
// The key the browser used for the stored copy (template, branding, client revision), so the API calls
// address the same stored report.
const realKey = (type, src) => {
  const [t, b, c] = sql(`select template_version || '|' || branding_rev || '|' || coalesce(client_rev, '') from public.report_pdf_files where source_id = '${src}' order by generation desc limit 1`).split('|')
  return { p_type: type, p_source: src, p_template: t, p_branding: b, p_client_rev: c || '' }
}
const fileRows = (src) => JSON.parse(sql(`select coalesce(json_agg(t order by generation)::text, '[]') from (select id, status, sha256, bytes, immutable, generation, storage_path, regenerate_reason, regenerated_from, created_by, superseded_at, organisation_id, site, report_type from public.report_pdf_files where source_id = '${src}' and status = 'ready') t`))

async function main() {
  sql(`set session_replication_role = replica; delete from public.report_pdf_events; delete from public.report_pdf_bulk_requests; delete from public.report_pdf_queue; update public.report_pdf_files set superseded_by = null, regenerated_from = null; delete from public.report_pdf_files; delete from public.report_pdf_settings_events; delete from public.report_pdf_settings; delete from storage.objects where bucket_id = '${BUCKET}'; update public.profiles set sites = array['ALPHA EAST PLANT'] where email = 'alpha.tyreman@staging.tyrepulse.invalid';`)
  const [apAsset, apId] = sql(`select asset_no || '|' || id from public.inspections where organisation_id = '${ALPHA}' and country = 'KSA' and site = 'ALPHA EAST PLANT' and approval_status = 'approved' order by inspection_date desc limit 1`).split('|')
  const [wkAsset] = sql(`select asset_no from public.inspections i where organisation_id = '${ALPHA}' and country = 'KSA' and site = 'ALPHA EAST PLANT' and approval_status <> 'approved' and asset_no <> '${apAsset}'
      and not exists (select 1 from public.inspections j where j.organisation_id = i.organisation_id and j.asset_no = i.asset_no and j.approval_status = 'approved') order by inspection_date desc limit 1`).split('|')
  const [northAsset] = sql(`select asset_no from public.inspections where organisation_id = '${ALPHA}' and country = 'KSA' and site = 'ALPHA NORTH PLANT' order by inspection_date desc limit 1`).split('|')

  // ================================================================ 1. first and repeat download, Manager and Admin
  const m = await signIn('alpha.manager')
  const d1 = await download(m.page, () => rowButton(m.page, apAsset).click())
  await m.page.waitForTimeout(1200)
  let rows = fileRows(apId)
  ok(d1.bytes.slice(0, 5).toString() === '%PDF-' && d1.url.startsWith('blob:') && rows.length === 1 && rows[0].sha256 === sha(d1.bytes) && m.log.uploads === 1,
    'case 1 manager: first download generated in the browser and stored once (same sha256)', `${d1.ms} ms, uploads ${m.log.uploads}`)
  const d2 = await download(m.page, () => rowButton(m.page, apAsset).click())
  ok(sha(d2.bytes) === sha(d1.bytes) && /\/storage\/v1\/object\/sign\//.test(d2.url) && m.log.uploads === 1 && m.log.signs >= 1,
    'case 1 manager: repeat download served from storage through a short-lived signed URL, no generation', `${d2.ms} ms ${d2.url.replace(/token=[^&]+/, 'token=...').slice(0, 90)}`)
  const signedExp = (() => { const t = new URL(d2.url).searchParams.get('token'); const p = jwtPayload(t); return p.exp - p.iat })()
  ok(signedExp > 0 && signedExp <= 300, 'case 1: the signed URL is short-lived', `${signedExp} s`)
  timings.manager = { first_ms: d1.ms, repeat_ms: d2.ms, bytes: d1.bytes.length }
  ok(rows[0].organisation_id === ALPHA && rows[0].storage_path.startsWith(`${ALPHA}/tyre_inspection/${apId}/`), 'case 2: the stored object path is company-scoped (company id / report type / record)', rows[0].storage_path)
  checkStorageAuth(m.log, userId('alpha.manager'), 'case 1 manager')

  const a = await signIn('alpha.admin')
  await a.page.getByLabel('Search inspections').last().fill(wkAsset); await a.page.waitForTimeout(800)
  const d3 = await download(a.page, () => rowButton(a.page, wkAsset).click())
  await a.page.waitForTimeout(1200)
  const wkId = sql(`select source_id from public.report_pdf_files where created_by = '${userId('alpha.admin')}' and status = 'ready' order by created_at desc limit 1`)
  rows = fileRows(wkId)
  ok(!!wkId && d3.url.startsWith('blob:') && rows.length === 1 && rows[0].sha256 === sha(d3.bytes) && a.log.uploads === 1 && !rows[0].immutable,
    'case 1 admin: first download generated in the browser and stored once (working copy, not locked)', `${d3.ms} ms`)
  const d4 = await download(a.page, () => rowButton(a.page, wkAsset).click())
  ok(sha(d4.bytes) === sha(d3.bytes) && /\/storage\/v1\/object\/sign\//.test(d4.url) && a.log.uploads === 1, 'case 1 admin: repeat download served from storage through a signed URL', `${d4.ms} ms`)
  timings.admin = { first_ms: d3.ms, repeat_ms: d4.ms, bytes: d3.bytes.length }
  checkStorageAuth(a.log, userId('alpha.admin'), 'case 1 admin')
  const apPath = fileRows(apId)[0].storage_path; const apSha = fileRows(apId)[0].sha256; const apFile = fileRows(apId)[0].id

  // ================================================================ 2. other company and anonymous
  const betaM = await as('beta.manager'); const betaA = await as('beta.admin')
  ok(jwtPayload(betaM.token).role === 'authenticated' && jwtPayload(betaM.token).sub === betaM.uid, 'case 2: the Beta session is a real signed-in JWT from the gateway')
  for (const [who, c] of [['beta.manager', betaM], ['beta.admin', betaA]]) {
    const g = await storageGet(apPath, c.token); const s = await storageSign(apPath, c.token)
    ok([400, 403, 404].includes(g) && [400, 403, 404].includes(s), `case 2 ${who}: Storage API refuses the Alpha object (download and signed URL)`, `download ${g}, sign ${s}`)
    const look = await restRpc('pdf_cache_lookup', realKey('tyre_inspection', apId), c.token)
    ok(look.status === 200 && look.json?.reason === 'not_available', `case 2 ${who}: pdf_cache_lookup (the step before the signed URL) refused`, look.text)
    const rr = await restRows('report_pdf_files', `id=eq.${apFile}&select=id,storage_path`, c.token)
    ok(rr.status === 200 && Array.isArray(rr.rows) && rr.rows.length === 0, `case 2 ${who}: the cache row is not readable`, `${rr.status} ${JSON.stringify(rr.rows)}`)
    const ev = await restRows('report_pdf_events', `file_id=eq.${apFile}&select=id`, c.token)
    ok(ev.status === 200 && ev.rows.length === 0, `case 2 ${who}: the audit rows are not readable`)
    const w = await storageWrite(`${ALPHA}/tyre_inspection/${apId}/beta.pdf`, c.token, 'POST', pdfBytes('beta'))
    ok(w.status >= 400, `case 2 ${who}: cannot write into the Alpha company folder`, w.status)
  }
  {
    const g = await storageGet(apPath, null); const s = await storageSign(apPath, null)
    const pub = (await fetch(`${API}/storage/v1/object/public/${BUCKET}/${apPath}`)).status
    const look = await restRpc('pdf_cache_lookup', realKey('tyre_inspection', apId), null)
    const rr = await restRows('report_pdf_files', 'select=id', null)
    const ls = await fetch(`${API}/storage/v1/object/list/${BUCKET}`, { method: 'POST', headers: { apikey: ANON, authorization: `Bearer ${ANON}`, 'content-type': 'application/json' }, body: JSON.stringify({ prefix: `${ALPHA}/`, limit: 100 }) })
    const lsBody = await ls.json().catch(() => null)
    ok(g >= 400 && s >= 400 && pub >= 400, 'case 2 anonymous: Storage API refuses download, signed URL and public URL', `${g} ${s} ${pub}`)
    ok(look.status >= 400 || look.json?.reason === 'not_available', 'case 2 anonymous: lookup refused', `${look.status} ${look.text}`)
    ok(rr.status >= 400 || (Array.isArray(rr.rows) && rr.rows.length === 0), 'case 2 anonymous: no cache row readable', `${rr.status}`)
    ok(!Array.isArray(lsBody) || lsBody.length === 0, 'case 2 anonymous: listing the company folder returns nothing', `${ls.status}`)
  }

  // ================================================================ 3. Tyre Man site scope
  await a.page.getByLabel('Search inspections').last().fill(northAsset); await a.page.waitForTimeout(800)
  await download(a.page, () => rowButton(a.page, northAsset).click()); await a.page.waitForTimeout(1200)
  const north = JSON.parse(sql(`select row_to_json(t)::text from (select id, source_id, storage_path from public.report_pdf_files where site = 'ALPHA NORTH PLANT' and status = 'ready' limit 1) t`))
  const tm = await as('alpha.tyreman')
  {
    const ownG = await storageGet(apPath, tm.token); const ownS = await storageSign(apPath, tm.token)
    ok(ownG === 200 && ownS === 200, 'case 3 tyre man: his own site report, download and signed URL allowed', `${ownG} ${ownS}`)
    const g = await storageGet(north.storage_path, tm.token); const s = await storageSign(north.storage_path, tm.token)
    ok(g >= 400 && s >= 400, 'case 3 tyre man: other site refused at the Storage API (download and signed URL)', `${g} ${s}`)
    const look = await restRpc('pdf_cache_lookup', realKey('tyre_inspection', north.source_id), tm.token)
    ok(look.json?.reason === 'not_available', 'case 3 tyre man: other site refused at the database (lookup)', look.text)
    const rr = await restRows('report_pdf_files', 'select=id,site', tm.token)
    ok(rr.status === 200 && rr.rows.length > 0 && rr.rows.every((r) => r.site === 'ALPHA EAST PLANT'), 'case 3 tyre man: report_pdf_files shows only his own site', JSON.stringify(rr.rows.map((r) => r.site)))
    const w = await storageWrite(north.storage_path, tm.token, 'PUT', pdfBytes('tm'))
    ok(w.status >= 400, 'case 3 tyre man: cannot overwrite another site report', w.status)
  }

  // ================================================================ 4. approved revision immutable, audited regeneration
  ok(fileRows(apId)[0].immutable === true, 'case 4: the approved inspection copy is locked (immutable)')
  for (const [who, c] of [['manager', await as('alpha.manager')], ['admin', await as('alpha.admin')]]) {
    const put = await storageWrite(apPath, c.token, 'PUT', pdfBytes(`overwrite by ${who}`))
    const post = await storageWrite(apPath, c.token, 'POST', pdfBytes(`upsert by ${who}`))
    const rm = await c.storage.from(BUCKET).remove([apPath])
    ok(put.status >= 400 && post.status >= 400 && (rm.data || []).length === 0, `case 4 ${who}: overwrite (PUT, POST upsert) and remove of the approved object refused by storage policy`, `PUT ${put.status} POST ${post.status} removed ${(rm.data || []).length}`)
  }
  ok(sha(Buffer.from(await (await fetch(`${API}/storage/v1/object/authenticated/${BUCKET}/${apPath}`, { headers: { apikey: ANON, authorization: `Bearer ${(await as('alpha.manager')).token}` } })).arrayBuffer())) === apSha,
    'case 4: after the attempts the approved object is unchanged, byte for byte')
  {
    const mgr = await as('alpha.manager'); const adm = await as('alpha.admin')
    const k = realKey('tyre_inspection', apId)
    const rm0 = await rpc(mgr, 'pdf_cache_regenerate', { ...k, p_file_name: null, p_reason: 'refresh', p_lease_seconds: 180 })
    ok(rm0.reason === 'approved_needs_authorisation' || rm0.reason === 'not_allowed', 'case 4: manager without company authorisation cannot regenerate the approved report', JSON.stringify(rm0))
    const ra0 = await rpc(adm, 'pdf_cache_regenerate', { ...k, p_file_name: null, p_reason: null, p_lease_seconds: 180 })
    ok(ra0.reason === 'reason_required', 'case 4: administrator without a reason: refused', JSON.stringify(ra0))
    const ra = await rpc(adm, 'pdf_cache_regenerate', { ...k, p_file_name: null, p_reason: 'Round 2: corrected template print', p_lease_seconds: 180 })
    ok(ra.ok && ra.path && ra.path !== apPath, 'case 4: administrator with a reason gets a new revision on its own path', JSON.stringify(ra))
    const nb = pdfBytes('approved rev 2 round 2')
    const up = await adm.storage.from(BUCKET).upload(ra.path, new Blob([nb], { type: 'application/pdf' }), { contentType: 'application/pdf', upsert: true })
    const done = await rpc(adm, 'pdf_cache_complete', { p_file: ra.file_id, p_sha256: sha(nb), p_bytes: nb.length })
    ok(!up.error && done.state === 'ready', 'case 4: the new revision is stored', up.error?.message)
    const orig = await adm.storage.from(BUCKET).download(apPath)
    ok(!orig.error && sha(Buffer.from(await orig.data.arrayBuffer())) === apSha, 'case 4: the ORIGINAL approved object is kept byte for byte after regeneration')
    const ev = JSON.parse(sql(`select coalesce(json_agg(t)::text,'[]') from (select event, actor, detail from public.report_pdf_events where source_id = '${apId}' and event in ('regenerate_requested','superseded') order by created_at) t`))
    const rev = fileRows(apId)
    ok(ev.some((e) => e.event === 'regenerate_requested' && e.actor === adm.uid) && rev.length === 2 && rev[1].regenerate_reason === 'Round 2: corrected template print' && rev[1].regenerated_from === apFile && rev[1].immutable,
      'case 4: audit row written (regenerate_requested by the administrator) and the revision records who, why and from which file', JSON.stringify(ev.map((e) => e.event)))
  }

  // ================================================================ 5. bulk limit
  {
    const mgr = await as('alpha.manager'); const adm = await as('alpha.admin')
    const ids = sql(`select string_agg(id::text, ',') from (select id from public.inspections where organisation_id = '${ALPHA}' order by id limit 51) x`).split(',')
    ok(ids.length === 51, 'fixture: 51 real Alpha inspections')
    // Administrator (all three countries) sees all 51; the Manager is limited to KSA (26 of the 60 Alpha records).
    const b50 = await rpc(adm, 'pdf_cache_bulk_request', { p_type: 'tyre_inspection', p_sources: ids.slice(0, 50) })
    ok(b50.ok === true && b50.limit === 50 && b50.requested === 50 && b50.allowed.length === 50, 'case 5 admin: 50 reports allowed by the server (default limit 50)', JSON.stringify({ ok: b50.ok, n: b50.allowed?.length }))
    const b51 = await rpc(adm, 'pdf_cache_bulk_request', { p_type: 'tyre_inspection', p_sources: ids })
    ok(b51.ok === false && b51.reason === 'over_limit' && b51.limit === 50 && b51.requested === 51, 'case 5 admin: 51 reports refused by the server', JSON.stringify(b51))
    const ksa = Number(sql(`select count(*) from public.inspections where id = any('{${ids.slice(0, 50).join(',')}}'::uuid[]) and country = 'KSA'`))
    const m50 = await rpc(mgr, 'pdf_cache_bulk_request', { p_type: 'tyre_inspection', p_sources: ids.slice(0, 50) })
    ok(m50.ok === true && m50.allowed.length === ksa && m50.refused === 50 - ksa, 'case 5 manager: 50 accepted under the limit, only his own country returned', JSON.stringify({ allowed: m50.allowed?.length, refused: m50.refused, ksa }))
    const m51 = await rpc(mgr, 'pdf_cache_bulk_request', { p_type: 'tyre_inspection', p_sources: ids })
    ok(m51.ok === false && m51.reason === 'over_limit', 'case 5 manager: 51 refused by the server', JSON.stringify(m51))
    const set = await rpc(adm, 'pdf_cache_update_settings', { p_bulk_limit: 10, p_retention_days: null, p_manager_regenerate: null })
    const b10 = await rpc(adm, 'pdf_cache_bulk_request', { p_type: 'tyre_inspection', p_sources: ids.slice(0, 10) })
    const b11 = await rpc(adm, 'pdf_cache_bulk_request', { p_type: 'tyre_inspection', p_sources: ids.slice(0, 11) })
    ok(set.ok && b10.ok && b10.allowed.length === 10 && b11.reason === 'over_limit' && b11.limit === 10, 'case 5: configured limit 10 honoured (10 allowed, 11 refused)', JSON.stringify({ b10: b10.ok, b11: b11.reason }))
    const self = await rpc(mgr, 'pdf_cache_update_settings', { p_bulk_limit: 500, p_retention_days: null, p_manager_regenerate: null })
    ok(self.reason === 'admin_only', 'case 5: a manager cannot raise the limit', JSON.stringify(self))
    const logged = sql(`select string_agg(outcome || ':' || requested, ',' order by created_at) from public.report_pdf_bulk_requests where report_type = 'tyre_inspection' and requested >= 10`)
    ok(logged === 'accepted:50,over_limit:51,accepted:50,over_limit:51,accepted:10,over_limit:11', 'case 5: every bulk request is recorded with its outcome', logged)
    await rpc(adm, 'pdf_cache_update_settings', { p_bulk_limit: 50, p_retention_days: null, p_manager_regenerate: null })
    // and on screen with the default limit: 51 selected is not offered
    await a.page.reload(); await a.page.locator('button[aria-label^="Export detailed PDF"]').first().waitFor({ timeout: 30000 })
    const boxes = a.page.locator('input[aria-label="Select row"]'); const n = await boxes.count()
    ok(n > 0, 'fixture: register rows selectable', n)
  }

  // ================================================================ 6. retention dry run
  {
    const adm = await as('alpha.admin')
    const k = realKey('tyre_inspection', wkId)
    for (const label of ['wk rev 2', 'wk rev 3']) {
      const r = await rpc(adm, 'pdf_cache_regenerate', { ...k, p_file_name: null, p_reason: 'retention fixture', p_lease_seconds: 180 })
      const b = pdfBytes(label)
      await adm.storage.from(BUCKET).upload(r.path, new Blob([b], { type: 'application/pdf' }), { contentType: 'application/pdf', upsert: true })
      await rpc(adm, 'pdf_cache_complete', { p_file: r.file_id, p_sha256: sha(b), p_bytes: b.length })
    }
    const wk = fileRows(wkId)
    ok(wk.length === 3 && wk[0].superseded_at && wk[1].superseded_at && !wk[2].superseded_at, 'fixture: three working revisions, two superseded')
    const mark = (id, days) => `update public.report_pdf_files set superseded_at = now() - interval '${days} days' where id = '${id}';`
    const apOrig = fileRows(apId)[0].id
    const out = sql(`begin; ${mark(wk[0].id, 200)} ${mark(wk[1].id, 30)} ${mark(apOrig, 400)}
      select public.pdf_cache_retention_run(500)::text;
      select string_agg(id::text, ',') from public.report_pdf_files where purge_due_at is not null;
      rollback;`).split('\n').filter(Boolean)
    const res = JSON.parse(out[0]); const marked = (out[1] || '').split(',').filter(Boolean)
    ok(res.ok && res.marked === 1 && marked.length === 1 && marked[0] === wk[0].id, 'case 6 dry run: only the working copy superseded 200 days ago is marked', JSON.stringify({ res, marked }))
    ok(!marked.includes(apOrig), 'case 6 dry run: the approved original (backdated 400 days) is never marked')
    ok(!marked.includes(wk[1].id), 'case 6 dry run: a copy superseded 30 days ago (younger than 90) is not marked')
    ok(sql(`select count(*) from public.report_pdf_files where purge_due_at is not null or purged_at is not null`) === '0', 'case 6: the dry run was rolled back, nothing marked or removed')
    const ret = await adm.rpc('pdf_cache_retention_run', { p_limit: 10 })
    ok(!!ret.error || ret.data?.reason === 'not_allowed', 'case 6: a signed-in administrator cannot start the purge job', JSON.stringify(ret.data || ret.error?.message))
    const rmYoung = await adm.storage.from(BUCKET).remove([wk[1].storage_path])
    const rmAp = await adm.storage.from(BUCKET).remove([apPath])
    ok((rmYoung.data || []).length === 0 && (rmAp.data || []).length === 0, 'case 6: the Storage API removes neither an unmarked working copy nor the approved original', JSON.stringify([rmYoung.data, rmAp.data]))
  }
  await m.context.close(); await a.context.close()

  // ================================================================ 7. observation PDF in the browser (Manager)
  {
    const s = await signIn('alpha.manager')
    await s.page.locator('button[aria-pressed]', { hasText: 'Observations' }).first().click()
    await s.page.getByRole('table', { name: 'Observations' }).waitFor({ timeout: 30000 })
    await s.page.getByRole('row').nth(1).getByRole('button', { name: /Open/ }).click()
    const btn = s.page.getByRole('button', { name: /Download observation PDF/ })
    await btn.waitFor({ timeout: 30000 })
    const o1 = await download(s.page, () => btn.click())
    await s.page.waitForTimeout(1500)
    const orow = JSON.parse(sql(`select coalesce(json_agg(t)::text,'[]') from (select id, source_id, sha256, storage_path, organisation_id from public.report_pdf_files where report_type = 'tyre_observation' and status = 'ready') t`))
    ok(o1.bytes.slice(0, 5).toString() === '%PDF-' && o1.url.startsWith('blob:') && orow.length === 1 && orow[0].sha256 === sha(o1.bytes) && s.log.uploads === 1,
      'case 7: observation PDF first download generated in the browser and stored once', `${o1.ms} ms ${o1.name}`)
    ok(orow[0]?.storage_path.startsWith(`${ALPHA}/tyre_observation/`), 'case 7: stored under the company folder', orow[0]?.storage_path)
    await btn.waitFor({ timeout: 20000 })
    const o2 = await download(s.page, () => btn.click())
    ok(sha(o2.bytes) === sha(o1.bytes) && /\/storage\/v1\/object\/sign\//.test(o2.url) && s.log.uploads === 1 && o2.name === o1.name,
      'case 7: observation PDF repeat download served from storage through a signed URL', `${o2.ms} ms`)
    timings.observation_manager = { first_ms: o1.ms, repeat_ms: o2.ms, bytes: o1.bytes.length }
    checkStorageAuth(s.log, userId('alpha.manager'), 'case 7 manager')
    const alerts = (await s.page.locator('[role=alert]').allInnerTexts()).filter((t) => t.trim())
    ok(alerts.length === 0 && s.log.errors.length === 0, 'case 7: no error shown, no page error', JSON.stringify([alerts, s.log.errors]))
    const bo = await as('beta.manager')
    ok((await storageGet(orow[0].storage_path, bo.token)) >= 400, 'case 7: the stored observation PDF is refused to another company')
    await s.context.close()
  }
}

;(async () => {
  browser = await chromium.launch()
  try { await main() } catch (e) { ok(false, 'spec ran to the end', e.stack) }
  await browser.close()
  fs.mkdirSync(`${RUN}/results`, { recursive: true })
  fs.writeFileSync(`${RUN}/results/round2.json`, JSON.stringify({ ran_at: new Date().toISOString(), total: results.length, failed, timings, results }, null, 2))
  console.log(`\nTIMINGS ${JSON.stringify(timings)}\n${results.length - failed} of ${results.length} checks passed (round 2)`)
  process.exit(failed ? 1 : 0)
})()
