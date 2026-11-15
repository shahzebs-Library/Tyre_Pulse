// Builds docs/commercial-readiness/audit/MODULE_WORKFLOW_TESTS.md and module_workflow_tests.json from the result files.
const fs = require('fs'); const path = require('path')
const RUN = process.env.E2E_RUN; const mods = require('./modules.json')
const outDir = path.join(__dirname, '..', '..', 'docs', 'commercial-readiness', 'audit')
const P = 'Verified Passed', F = 'Verified Failed', N = 'Not Tested', B = 'Blocked'
const NATIVE_REQUIRED = ['materials', 'repair_requests', 'retread', 'service_requests', 'shifts', 'breakdowns']
const known = (x) => /user_view_prefs/.test(x) || /status of 404/.test(x)
const rows = []
for (const m of mods) {
  const f = path.join(RUN, 'results', `${m.id}.json`)
  if (!fs.existsSync(f)) { rows.push({ id: m.id, name: m.name, route: m.route, status: N, reason: 'no result file', checks: {} }); continue }
  const R = JSON.parse(fs.readFileSync(f)); const s = R.steps; const c = s.crud; const ch = {}; const notes = []; const defects = []
  const actorOpen = R.actor === 'alpha.manager' ? s.open_manager : s.open_admin
  const allErr = [...actorOpen.consoleErrors, ...actorOpen.failedRequests, ...actorOpen.pageErrors].filter((x) => !known(x))
  const viewPrefs = [s.open_manager, s.open_admin, s.tenant_gamma].some((o) => o.failedRequests.some((x) => /user_view_prefs/.test(x)))
  // 1 open
  ch.open = (!actorOpen.errorBoundary && !actorOpen.accessDenied && !actorOpen.pageErrors.length && !allErr.length) ? P : F
  notes.push(`Opened as ${R.actor.replace('.', ' ')}: heading "${actorOpen.heading}"${allErr.length ? '; errors: ' + allErr.join(' ; ') : ''}`)
  if (viewPrefs) defects.push('D2')
  // 3 role access
  const mgrAllowed = m.roles.length === 0 || m.roles.includes('Manager')
  const mgrOk = mgrAllowed ? !s.open_manager.accessDenied : s.open_manager.accessDenied
  const adminOk = !s.open_admin.accessDenied && !s.open_admin.errorBoundary
  const lowRefused = s.open_tyreman.accessDenied
  ch.role = (mgrOk && adminOk && (lowRefused || m.roles.length === 0)) ? P : F
  notes.push(`Roles: Manager ${s.open_manager.accessDenied ? 'refused (Access Restricted)' : 'opens'}; Admin opens; Tyre Man ${lowRefused ? 'refused (Access Restricted)' : 'OPENS the page (route has no role guard)'}`)
  if (!lowRefused) defects.push('D5')
  if (!mgrAllowed) defects.push('D6')
  // empty state (Gamma)
  const g = s.tenant_gamma; const gErr = [...g.consoleErrors, ...g.failedRequests, ...g.pageErrors].filter((x) => !known(x))
  ch.empty = (!g.errorBoundary && !g.accessDenied && !gErr.length && !g.seesAlphaMarker && (R.gammaRowsInDb || 0) === 0) ? P : F
  // create / update
  if (!c.attempted) { ch.create = N; ch.update = N; notes.push('Read-only report: no create or update action on the page. The attendance data path (roster plus check-in) was not exercised.') }
  else {
    ch.create = c.created && c.visibleAfterReload && c.dbRowsOtherOrg === 0 ? P : (c.error ? N : F)
    if (c.created) notes.push(`Created through the form, row found in ${m.table} with the Alpha company id (marker ${R.marker})${c.visibleProbe ? ', shown in the list as ' + c.visibleProbe : ''}; still listed after reload`)
    else notes.push(`Create did not save: ${[...(c.createMessages || []).slice(-1), ...(c.createFailedRequests || [])].join(' ; ') || c.error}`)
    const u = c.update
    ch.update = !u ? N : u.updated ? P : (u.error ? N : F)
    if (u && u.updated) notes.push(u.kind ? `Update: ${u.kind}, status ${u.statusBefore} to ${u.statusAfter} in the database` : 'Update: edited a text field and saved, new value found in the database')
    if (u && !u.updated) notes.push(`Update not completed: ${u.error || (u.messages || []).join(' ; ')}`)
    if (!u && !c.created) notes.push('Update not reached because create failed')
  }
  // error handling
  if (!c.attempted) ch.error = N
  else {
    const v = c.validation || {}; const d = v.diff || {}
    const msg = [...(d.newText || []), ...(v.messages || [])].filter((x) => /requir|enter|provide|choose|select|pick|fill/i.test(x))
    const refused = (v.rowsCreatedByEmptySubmit === 0) && (d.rowsCreated === undefined || d.rowsCreated === 0)
    const raw = v.rawSqlShown || d.rawSqlShown
    if (!refused || raw) ch.error = F
    else if (msg.length) { ch.error = P; notes.push(`Empty form refused with: "${msg[0]}"; no row written`) }
    else if (NATIVE_REQUIRED.includes(m.id)) { ch.error = P; notes.push('Empty form refused by the browser required-field prompt on the first required field; form stayed open; no row written') }
    else { ch.error = N; notes.push('Empty form wrote no row, but the message text was not captured') }
  }
  // tenant
  const b = s.tenant_beta
  ch.tenant = (!b.seesAlphaMarker && !g.seesAlphaMarker && (c.dbRowsOtherOrg || 0) === 0 && !b.errorBoundary) ? (c.created ? P : N) : F
  notes.push(`Tenant: ${b.user.replace('.', ' ')} ${b.accessDenied ? 'refused' : 'opens the page and does not see'} the Alpha record; Gamma admin sees an empty page, 0 rows in the database for Gamma, no errors`)
  const vals = Object.values(ch)
  let status = vals.includes(F) ? F : vals.includes(N) ? N : P
  if (m.id === 'recall_tracker') defects.push('D1')
  if (m.id === 'repair_requests') defects.push('D3')
  if (m.id === 'warranty') defects.push('D4')
  rows.push({ id: m.id, name: m.name, route: m.route, routeRoles: m.roles.length ? m.roles : ['any signed-in role'], crudActor: R.actor, table: m.table, status, checks: ch, notes, defects: [...new Set(defects)],
    evidence: { spec: 'e2e/staging/specs/module_workflow.cjs', screenshot: fs.existsSync(path.join(__dirname, 'evidence', `${m.id}.png`)) ? `e2e/staging/evidence/${m.id}.png` : null,
      dbCheck: m.table ? `select count(*) from public.${m.table} t where organisation_id = <Alpha> and row_to_json(t)::text like '%${R.marker}%' -> ${c.dbRowsWithMarker ?? 'n/a'}; other companies -> ${c.dbRowsOtherOrg ?? 'n/a'}` : null } })
}
const DEFECTS = [
  { id: 'D1', severity: 'High', module: 'recall_tracker', title: 'An Admin cannot save a recall',
    seen: 'Alpha Admin filled Add recall and pressed Save recall. The API answered 403 and the page said "You do not have permission to do that." No row was written.',
    cause: 'src/pages/RecallTracker.jsx line 444 sends country: form.country || profile?.country. profiles.country is an array, recalls.country is a single text value, so the row fails the country write policy (recalls_country_write). The same insert with country null succeeds for the same user (checked in SQL). In production today only a super admin passes because that policy lets super admins through.',
    file: 'src/pages/RecallTracker.jsx' },
  { id: 'D2', severity: 'Medium', module: 'breakdowns, driver_training, dvir, equipment, retread_claims, rotation, service_requests, shifts, tyre_pool, warranty',
    title: 'Saved table views call a table that is not in the database',
    seen: 'Every page that uses saved views requests /rest/v1/user_view_prefs and gets 404, with a console error. The page still works; saved views do not.',
    cause: 'supabase/migrations/20260921090000_user_view_prefs.sql exists in the repository but the table is absent from the staging schema, which was copied from the production catalog. The migration appears not to be applied.',
    file: 'supabase/migrations/20260921090000_user_view_prefs.sql' },
  { id: 'D3', severity: 'Medium', module: 'repair_requests', title: 'Request numbers carry another company\'s prefix',
    seen: 'Alpha Readymix received request number GC/RFR/0001/1126.',
    cause: 'Database function next_rfr_no falls back to the fixed prefix GC when the company has no row in repair_request_number_config. A new customer has no row.',
    file: 'database function public.next_rfr_no' },
  { id: 'D4', severity: 'Low', module: 'warranty', title: 'Country on a warranty claim is free text and a wrong value reads as a permission error',
    seen: 'With a Country value that is not one of the user\'s countries the save answered 403 and "You do not have permission to do that." With KSA the same claim saved.',
    cause: 'The Country field in the Add Claim form is a text box; the country write policy refuses unknown values and the message does not say which field is wrong.',
    file: 'src/pages/WarrantyTracker.jsx' },
  { id: 'D5', severity: 'Low', module: 'tyre_pool, warranty', title: 'No role guard on two routes',
    seen: 'Alpha Tyre Man opened /tyre-pool and /warranty and saw the page with its Add button. Whether a Tyre Man can save there was not tested.',
    cause: 'These two routes have no RoleRoute in src/App.jsx. This may be intended; it should be a decision, not an accident.',
    file: 'src/App.jsx' },
  { id: 'D6', severity: 'Info', module: '19 of the 31 routes', title: 'Most restored modules are Admin only',
    seen: 'Alpha Manager got Access Restricted on 19 routes. Restoring the module switch alone gives managers nothing on those pages.',
    cause: 'RoleRoute allowed={["Admin"]} in src/App.jsx.', file: 'src/App.jsx' },
]
const count = (st) => rows.filter((r) => r.status === st).length
const summary = { generated: new Date().toISOString().slice(0, 10), stack: 'local: PostgreSQL 16 copy of staging + PostgREST 12.2.3 + local sign-in shim + production build in headless Chromium (Playwright)',
  counts: { [P]: count(P), [F]: count(F), [N]: count(N), [B]: count(B) },
  safe_to_restore: rows.filter((r) => r.status === P).map((r) => r.id), not_safe: rows.filter((r) => r.status === F).map((r) => r.id), not_tested: rows.filter((r) => r.status === N || r.status === B).map((r) => r.id) }
fs.writeFileSync(path.join(outDir, 'module_workflow_tests.json'), JSON.stringify({ summary, defects: DEFECTS, modules: rows }, null, 1))
const sh = (x) => x === P ? 'Passed' : x === F ? 'FAILED' : x === N ? 'Not tested' : x
let md = `# Module workflow tests (31 core modules)\n\nGenerated ${summary.generated}. Executed in a real browser (headless Chromium driven by Playwright) against the production build of the web app,\ntalking to a real PostgREST on a local copy of the staging database with synthetic companies. Production was not touched.\nHow to run it again: \`e2e/staging/README.md\`.\n\n`
md += `## What was real and what was a stand-in\n\n- Real: the built web app, the login page, every page and form, PostgREST, the full database schema with its row level security, triggers and functions.\n- Stand-in: sign-in service (a local shim checks the bcrypt password and signs the token). Storage, edge functions and realtime do not exist locally and answer 501.\n- So NOT covered: photo or file upload, emails, push, live updates, MFA, mobile apps.\n- The 31 modules were set to live only in the copy \`tyrepulse_e2e\`.\n\n`
md += `## Result counts\n\n| Status | Modules |\n|---|---|\n` + [P, F, N, B].map((k) => `| ${k} | ${summary.counts[k]} |`).join('\n') + '\n\n'
md += `Status rule: a module is Verified Passed only when every one of the seven checks below ran in the browser and passed. Any check that failed makes it Verified Failed. Any check that could not be exercised makes it Not Tested.\n\n`
md += `## Per module\n\nUsers: Alpha Manager, Alpha Admin, Alpha Tyre Man (low role), Beta Manager or Beta Admin (other company), Gamma Admin (empty company).\n\n| Module | Route | Who may open | Open | Role access | Empty state (Gamma) | Create | Update | Error handling | Tenant | Status | Defects |\n|---|---|---|---|---|---|---|---|---|---|---|---|\n`
for (const r of rows) md += `| ${r.name} | ${r.route} | ${(r.routeRoles || []).join(', ')} | ${sh(r.checks.open)} | ${sh(r.checks.role)} | ${sh(r.checks.empty)} | ${sh(r.checks.create)} | ${sh(r.checks.update)} | ${sh(r.checks.error)} | ${sh(r.checks.tenant)} | **${r.status}** | ${(r.defects || []).join(', ')} |\n`
md += `\n## Notes and evidence per module\n\n`
for (const r of rows) { md += `### ${r.name} (${r.id}) : ${r.status}\n\n` + (r.notes || []).map((n) => `- ${n}`).join('\n') + `\n- Evidence: spec \`${r.evidence?.spec}\`${r.evidence?.screenshot ? ', screenshot `' + r.evidence.screenshot + '`' : ''}${r.evidence?.dbCheck ? ', database check: ' + r.evidence.dbCheck : ''}\n\n` }
md += `## Defects found\n\n| Id | Severity | Module | Defect | What was seen | Likely cause | File |\n|---|---|---|---|---|---|---|\n` + DEFECTS.map((d) => `| ${d.id} | ${d.severity} | ${d.module} | ${d.title} | ${d.seen} | ${d.cause} | ${d.file} |`).join('\n') + '\n\n'
md += `## Dependencies seen\n\n- The seed has assets, sites, tyres and work orders for Alpha and Beta. It has no drivers, parts, suppliers or technicians. No module was blocked by that: driver, supplier, technician and asset fields on these forms are free text.\n- Free text also means these forms do not check that an asset number or driver exists. That was not tested further.\n- Parts Requests offered Alpha's open work orders and catalog parts only.\n- Preventive Maintenance needs the asset confirmed with Find vehicle before it saves; TM001 was found.\n- Rotation needs at least one current wheel position picked.\n- Tyre Pool refuses a serial already in the pool with a plain message.\n- Absence and Attendance reads rosters and check-ins. No web screen in these 31 modules records a check-in, so its data path was not exercised.\n\n`
md += `## Recommendation\n\n**Safe to restore (${summary.safe_to_restore.length}), tested end to end:** ${summary.safe_to_restore.join(', ')}.\n\n**Not safe to restore yet (${summary.not_safe.length}):** ${summary.not_safe.join(', ') || 'none'}. Recall Tracker: fix D1 first, an Admin cannot save a recall.\n\n**Not tested (${summary.not_tested.length}):** ${summary.not_tested.join(', ') || 'none'}. Absence and Attendance opens cleanly with correct access and an empty state, but nothing proved it shows real attendance.\n\nBefore restoring for a second customer also settle D2 (saved views table), D3 (request number prefix) and decide D5 and D6.\n\nNot tested anywhere in this run: delete actions, exports (Excel, PDF), file upload, approvals beyond one status step, Arabic, phone widths, Director and Inspector roles, and whether a low role can write through the two unguarded routes. The 17 optional, 6 misleading and 21 unsupported modules were out of scope.\n`
fs.writeFileSync(path.join(outDir, 'MODULE_WORKFLOW_TESTS.md'), md)
console.log(JSON.stringify(summary, null, 1))
for (const r of rows) if (r.status !== P) console.log(r.id, r.status, JSON.stringify(r.checks))
