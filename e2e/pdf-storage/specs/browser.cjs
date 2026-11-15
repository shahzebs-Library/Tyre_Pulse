// Signed-in browser tests of the stored-PDF flows: the real production build of the web app,
// real PostgREST, the REAL Supabase Storage API, a local copy of the synthetic staging database.
// Sign-in is the local shim (not GoTrue).
//
//   source e2e/pdf-storage/env.sh && node e2e/pdf-storage/specs/browser.cjs            # drafts applied
//   PDF_E2E_MODE=unprovisioned node e2e/pdf-storage/specs/browser.cjs                  # drafts ABSENT
//
// Mode "unprovisioned" points the same build at a database copy WITHOUT the PDF drafts and proves
// the download behaves exactly as before: generated in the browser, no error, nothing stored.
const fs = require('fs')
const crypto = require('crypto')
const { execFileSync } = require('child_process')
const load = () => { for (const p of [process.env.E2E_PLAYWRIGHT, '/opt/node22/lib/node_modules/playwright', 'playwright'].filter(Boolean)) { try { return require(p) } catch { /* next */ } } throw new Error('Playwright not found') }
const { chromium } = load()
const JSZip = require(`${process.env.PDF_E2E_REPO}/node_modules/jszip`)

const WEB = `http://127.0.0.1:${process.env.WEB_PORT}`
const RUN = process.env.PDF_E2E_RUN
const MODE = process.env.PDF_E2E_MODE || 'provisioned'
const DB = MODE === 'unprovisioned' ? process.env.PDF_E2E_NODRAFT_DB : process.env.PDF_E2E_DB
const sql = (q) => execFileSync('psql', ['-X', '-q', '-At', '-h', '127.0.0.1', '-p', process.env.PGPORT_E2E || '54329', '-U', 'postgres', '-d', DB, '-c', q], { encoding: 'utf8' }).trim()
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')
const ACC = {}
for (const line of fs.readFileSync(process.env.E2E_ACCOUNTS_FILE, 'utf8').split('\n')) {
  const p = line.split('|').map((s) => s.trim())
  if (p.length >= 5 && p[3].includes('@')) ACC[p[2]] = { email: p[3], password: p[4] }
}
const results = []; let failed = 0
function ok(cond, name, detail = '') {
  results.push({ name, pass: !!cond, detail: cond ? '' : String(detail).slice(0, 300) }); if (!cond) failed += 1
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : `  [${String(detail).slice(0, 240)}]`}`)
}

let browser
async function signIn(username, { register = true } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', acceptDownloads: true })
  const page = await context.newPage()
  const log = { uploads: 0, signs: 0, http: [], errors: [], pdfRpc: 0, storageCalls: 0 }
  page.on('request', (r) => { if (/\/storage\/v1\//.test(r.url())) log.storageCalls += 1 })
  page.on('pageerror', (e) => log.errors.push(String(e.message).slice(0, 200)))
  page.on('response', (r) => {
    const u = r.url().replace(/^https?:\/\/[^/]+/, '')
    if (r.request().method() === 'POST' && /^\/storage\/v1\/object\/report-pdfs\//.test(u) && r.status() < 300) log.uploads += 1
    if (/^\/storage\/v1\/object\/sign\//.test(u) && r.status() < 300) log.signs += 1
    if (/\/rest\/v1\/rpc\/pdf_cache_/.test(u)) log.pdfRpc += 1
    if (r.status() >= 400 && /\/(rest|storage|auth)\/v1/.test(u)) log.http.push(`${r.status()} ${u.slice(0, 120)}`)
  })
  await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('#login-identifier', ACC[username].email)
  await page.fill('#login-password', ACC[username].password)
  await page.click('button[type=submit].tpl-primary')
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 })
  const skip = page.getByRole('button', { name: 'Skip tour' }).first()
  if (await skip.waitFor({ state: 'visible', timeout: 4000 }).then(() => true, () => false)) await skip.click()
  await page.goto(`${WEB}/inspections`, { waitUntil: 'domcontentloaded' })
  if (register) await page.locator('button[aria-label^="Export detailed PDF"]').first().waitFor({ timeout: 30000 })
  else await page.waitForLoadState('networkidle').catch(() => {})
  return { context, page, log }
}
const rowButton = (page, asset) => page.locator(`button[aria-label^="Export detailed PDF"][aria-label*="${asset}"]`).first()
async function download(page, trigger) {
  const t0 = Date.now()
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 90000 }), trigger()])
  const path = await dl.path()
  return { name: dl.suggestedFilename(), bytes: fs.readFileSync(path), ms: Date.now() - t0, url: dl.url() }
}

async function unprovisioned() {
  ok(sql("select count(*) from pg_proc where proname like 'pdf\\_cache\\_%'") === '0' && sql("select count(*) from pg_class where relname like 'report\\_pdf\\_%'") === '0',
    'this database has NO PDF cache table, function or bucket (as production today)')
  for (const user of ['alpha.manager', 'alpha.admin']) {
    const s = await signIn(user)
    const d = await download(s.page, () => s.page.locator('button[aria-label^="Export detailed PDF"]').first().click())
    ok(d.bytes.slice(0, 5).toString() === '%PDF-' && d.bytes.length > 20000 && /^Tyre Insp .*\.pdf$/.test(d.name), `${user}: the inspection PDF downloads, generated in the browser`, `${d.name} ${d.bytes.length}`)
    ok(d.url.startsWith('blob:'), `${user}: the file was made in the page (no stored copy involved)`, d.url.slice(0, 40))
    const d2 = await download(s.page, () => s.page.locator('button[aria-label^="Export detailed PDF"]').nth(1).click())
    ok(d2.bytes.slice(0, 5).toString() === '%PDF-', `${user}: a second record downloads too`)
    await s.page.waitForTimeout(800)
    const alerts = (await s.page.locator('[role=alert]').allInnerTexts()).filter((t) => t.trim())
    ok(alerts.length === 0 && s.log.errors.length === 0, `${user}: no error is shown and no page error is raised`, JSON.stringify([alerts, s.log.errors]))
    ok(s.log.uploads === 0 && s.log.signs === 0 && s.log.storageCalls === 0, `${user}: nothing is uploaded or signed, no Storage API request at all`, s.log.storageCalls)
    ok(await s.page.locator('section[aria-label="Stored PDF"]').count() === 0 && await s.page.getByText('Stored PDF settings').count() === 0, `${user}: no stored-PDF panel or settings are shown`)
    // bulk ZIP without any server path
    await s.page.locator('input[aria-label="Select row"]').nth(0).check(); await s.page.locator('input[aria-label="Select row"]').nth(1).check()
    const z = await download(s.page, () => s.page.getByRole('button', { name: /Download 2 PDFs/ }).click())
    const zip = await JSZip.loadAsync(z.bytes); const man = JSON.parse(await zip.file('manifest.json').async('string'))
    ok(man.included === 2 && man.missing === 0, `${user}: bulk ZIP of two reports works without the server path`, JSON.stringify({ i: man.included, m: man.missing }))
    await s.context.close()
  }
  ok(sql("select count(*) from pg_class where relname like 'report\\_pdf\\_%'") === '0', 'nothing was created or queued in the database')
}

async function provisioned() {
  sql(`set session_replication_role = replica; delete from public.report_pdf_events; delete from public.report_pdf_bulk_requests; delete from public.report_pdf_queue; update public.report_pdf_files set superseded_by = null, regenerated_from = null; delete from public.report_pdf_files; delete from public.report_pdf_settings_events; delete from public.report_pdf_settings; delete from storage.objects where bucket_id = 'report-pdfs';`)
  const approved = sql(`select asset_no || '|' || id from public.inspections where organisation_id = '00000000-0000-0000-0000-000000000001' and country = 'KSA' and site = 'ALPHA EAST PLANT' and approval_status = 'approved' order by inspection_date desc limit 1`).split('|')
  const [asset, insId] = approved

  // ---- 1. first download stores the report through the real Storage API; the repeat is a signed link
  const m = await signIn('alpha.manager')
  const d1 = await download(m.page, () => rowButton(m.page, asset).click())
  await m.page.waitForTimeout(1200)
  const row = () => JSON.parse(sql(`select coalesce(json_agg(t order by generation)::text, '[]') from (select id, status, bytes, sha256, immutable, generation, storage_path, regenerate_reason, regenerated_from, created_by from public.report_pdf_files where source_id = '${insId}' and status = 'ready') t`))
  let rows = row()
  ok(d1.bytes.slice(0, 5).toString() === '%PDF-' && rows.length === 1 && rows[0].sha256 === sha(d1.bytes) && Number(rows[0].bytes) === d1.bytes.length,
    'first download: generated in the browser, uploaded and recorded with the same sha256', JSON.stringify(rows))
  ok(m.log.uploads === 1, 'exactly one upload to the Storage API', m.log.uploads)
  const stored = Number(sql(`select metadata->>'size' from storage.objects where bucket_id = 'report-pdfs' and name = '${rows[0].storage_path}'`))
  ok(stored === d1.bytes.length, 'the object is stored by the Storage API with the same size')
  const d2 = await download(m.page, () => rowButton(m.page, asset).click())
  ok(sha(d2.bytes) === sha(d1.bytes) && /\/storage\/v1\/object\/sign\//.test(d2.url) && d2.name === d1.name, 'repeat download: the stored file through a signed link, same bytes, same file name', `${d2.url.slice(0, 60)} ${d2.name}`)
  ok(m.log.uploads === 1 && row().length === 1, 'repeat download: no generation, no upload, still one stored row')
  console.log(`     first download ${d1.ms} ms, repeat ${d2.ms} ms (local machine)`)

  // ---- 2. another signed-in person gets the same stored file
  const a = await signIn('alpha.admin')
  const d3 = await download(a.page, () => rowButton(a.page, asset).click())
  ok(sha(d3.bytes) === sha(d1.bytes) && a.log.uploads === 0, 'a second person receives the stored copy without generating')

  // ---- 3. approved report: manager is not offered Regenerate until the company authorises managers
  const openPanel = async (page) => { await page.locator(`button[aria-label^="Open Tyre inspection ${asset}"]`).first().click(); const p = page.locator('section[aria-label="Stored PDF"]'); await p.waitFor({ timeout: 20000 }); return p }
  let panel = await openPanel(m.page)
  ok(/Approved revision, locked/.test(await panel.innerText()) && await panel.getByRole('button', { name: /Regenerate latest/ }).count() === 0, 'manager: approved report is locked, no Regenerate offered by default')
  ok(await m.page.getByText('Stored PDF settings').count() === 0, 'manager: does not see the settings')
  // administrator: settings (limit 3, managers authorised)
  await a.page.getByText('Stored PDF settings').click()
  ok((await a.page.getByLabel(/Reports in one bulk download/).inputValue()) === '50' && (await a.page.getByLabel(/Keep superseded copies/).inputValue()) === '90', 'administrator sees the starting values: 50 reports, 90 days')
  await a.page.getByLabel(/Keep superseded copies/).fill('30'); await a.page.getByRole('button', { name: 'Save settings' }).click()
  ok(/at least 90 days/.test(await a.page.locator('details [role=alert]').innerText()), 'retention below 90 days is refused on screen')
  await a.page.getByLabel(/Keep superseded copies/).fill('120'); await a.page.getByLabel(/Reports in one bulk download/).fill('3')
  await a.page.getByLabel(/Managers and directors may regenerate/).check(); await a.page.getByRole('button', { name: 'Save settings' }).click()
  await a.page.locator('details [role=status]').waitFor({ timeout: 10000 })
  ok(sql(`select bulk_limit || '/' || superseded_retention_days || '/' || manager_regenerate_approved from public.report_pdf_settings`) === '3/120/true', 'settings saved: limit 3, 120 days, managers authorised')
  await m.page.reload(); await m.page.locator('button[aria-label^="Export detailed PDF"]').first().waitFor({ timeout: 30000 })
  panel = await openPanel(m.page)
  await panel.getByRole('button', { name: /Regenerate latest/ }).click()
  ok(await panel.getByRole('button', { name: 'Regenerate', exact: true }).isDisabled(), 'authorised manager: a reason is required before regenerating')
  await panel.getByLabel(/Reason for regenerating/).fill('Customer asked for a fresh print')
  await panel.getByRole('button', { name: 'Regenerate', exact: true }).click()
  await m.page.getByText('Approved revision (regenerated), locked').waitFor({ timeout: 60000 })
  rows = row()
  const mgrId = sql(`select id from public.profiles where email = '${ACC['alpha.manager'].email}'`)
  ok(rows.length === 2 && rows[0].sha256 === sha(d1.bytes) && rows[0].immutable && rows[1].immutable && rows[1].regenerate_reason === 'Customer asked for a fresh print'
    && rows[1].regenerated_from === rows[0].id && rows[1].created_by === mgrId && rows[1].storage_path !== rows[0].storage_path,
  'regeneration: a new revision beside the original, with who and why; the original row is unchanged', JSON.stringify(rows))
  const token = await m.page.evaluate(() => JSON.parse(localStorage.getItem('tp_auth')).access_token)
  const orig = await fetch(`http://127.0.0.1:${process.env.GATEWAY_PORT}/storage/v1/object/authenticated/report-pdfs/${rows[0].storage_path}`, { headers: { authorization: `Bearer ${token}` } })
  ok(orig.status === 200 && sha(Buffer.from(await orig.arrayBuffer())) === sha(d1.bytes), 'the ORIGINAL approved file is still served by the Storage API, byte for byte')
  ok(/Previous stored versions \(1\)/.test(await panel.innerText()), 'the original is listed on screen as a previous version')

  // ---- 4. bulk limit on screen
  await m.page.reload(); await m.page.locator('button[aria-label^="Export detailed PDF"]').first().waitFor({ timeout: 30000 })
  for (let i = 0; i < 4; i++) await m.page.locator('input[aria-label="Select row"]').nth(i).check()
  ok(await m.page.getByRole('button', { name: /Download 4 PDFs/ }).isDisabled() && await m.page.getByText('Up to 3 per download').count() === 1, 'four selected with a limit of three: the download is not offered')
  await m.context.close(); await a.context.close()

  // ---- 5. Tyre Man (limited to ALPHA EAST PLANT on this copy; the web module is switched on for the test, see harness.sql)
  const adminNorth = await signIn('alpha.admin')
  const northAsset = sql(`select asset_no from public.inspections where organisation_id = '00000000-0000-0000-0000-000000000001' and country = 'KSA' and site = 'ALPHA NORTH PLANT' order by inspection_date desc limit 1`)
  await adminNorth.page.getByLabel('Search inspections').last().fill(northAsset); await adminNorth.page.waitForTimeout(800)
  await download(adminNorth.page, () => rowButton(adminNorth.page, northAsset).click())
  await adminNorth.page.waitForTimeout(1200); await adminNorth.context.close()
  const north = sql(`select storage_path from public.report_pdf_files where site = 'ALPHA NORTH PLANT' and status = 'ready' limit 1`)
  ok(!!north, 'fixture: a report of ALPHA NORTH PLANT is stored')
  // On the web a Tyre Man is kept on the checklist capture view (Inspections.jsx: showWorkspace is
  // false and the register with its download buttons is not shown to him), so his authorisation
  // is checked with HIS OWN browser session against the server: the bulk request answers only for
  // his site, and the Storage API refuses the other site's file.
  const t = await signIn('alpha.tyreman', { register: false })
  const tk = await t.page.evaluate(() => JSON.parse(localStorage.getItem('tp_auth')).access_token)
  const rest = `http://127.0.0.1:${process.env.GATEWAY_PORT}/rest/v1/rpc/pdf_cache_bulk_request`
  const anonKey = fs.readFileSync(`${RUN}/anon_key`, 'utf8').trim()
  const eastIds = sql(`select string_agg(id::text, ',') from (select id from public.inspections where organisation_id = '00000000-0000-0000-0000-000000000001' and site = 'ALPHA EAST PLANT' order by id limit 2) x`).split(',')
  const northId = sql(`select source_id from public.report_pdf_files where site = 'ALPHA NORTH PLANT' and status = 'ready' limit 1`)
  const br = await (await fetch(rest, { method: 'POST', headers: { apikey: anonKey, authorization: `Bearer ${tk}`, 'content-type': 'application/json' },
    body: JSON.stringify({ p_type: 'tyre_inspection', p_sources: [...eastIds, northId] }) })).json()
  ok(br.ok && br.allowed.length === 2 && !br.allowed.includes(northId), 'tyre man: bulk request authorises only reports of his own site', JSON.stringify(br))
  const g = `http://127.0.0.1:${process.env.GATEWAY_PORT}/storage/v1/object`
  const h = { authorization: `Bearer ${tk}`, 'content-type': 'application/json' }
  const r1 = await fetch(`${g}/authenticated/report-pdfs/${north}`, { headers: h })
  const r2 = await fetch(`${g}/sign/report-pdfs/${north}`, { method: 'POST', headers: h, body: JSON.stringify({ expiresIn: 120 }) })
  ok(r1.status >= 400 && r2.status >= 400, 'tyre man: with his own session the Storage API refuses the other site (download and signed link)', `${r1.status} ${r2.status}`)
  ok(t.log.errors.length === 0, 'tyre man: no page error', t.log.errors.join(';'))
  await t.context.close()
}

;(async () => {
  browser = await chromium.launch()
  try { await (MODE === 'unprovisioned' ? unprovisioned() : provisioned()) }
  catch (e) { ok(false, 'spec ran to the end', e.message) }
  await browser.close()
  fs.mkdirSync(`${RUN}/results`, { recursive: true })
  fs.writeFileSync(`${RUN}/results/browser_${MODE}.json`, JSON.stringify({ ran_at: new Date().toISOString(), mode: MODE, total: results.length, failed, results }, null, 2))
  console.log(`\n${results.length - failed} of ${results.length} checks passed (${MODE})`)
  process.exit(failed ? 1 : 0)
})()
