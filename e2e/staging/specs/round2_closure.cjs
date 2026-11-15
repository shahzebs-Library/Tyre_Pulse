// Round 2: corrective action review loop and checklist acknowledge, in a real browser, after the closure drafts.
// Usage: node specs/round2_closure.cjs [actions] [checklists]
const zlib = require('zlib')
const R = require('./round2_lib.cjs')

const A1 = 'c4000000-0000-4000-8000-000000000001'   // North, assigned to clo.collector
const A2 = 'c4000000-0000-4000-8000-000000000002'   // East, assigned to alpha.manager by this spec
const A6 = 'c4000000-0000-4000-8000-000000000006'   // North, open
const S1 = 'c3000000-0000-4000-8000-000000000001', S6 = 'c3000000-0000-4000-8000-000000000006', S8 = 'c3000000-0000-4000-8000-000000000008'
const TABLES = ['corrective_actions', 'action_items', 'checklist_submissions']

function snapshot() {
  R.sql(`create schema if not exists _r2;
    ${TABLES.map((t) => `create table if not exists _r2.${t} as select * from public.${t};`).join('\n')}
    create or replace function _r2.restore(p_table text) returns void language plpgsql as $f$
    declare cols text;
    begin
      select string_agg(format('%I = s.%I', column_name, column_name), ', ') into cols from information_schema.columns
       where table_schema = 'public' and table_name = p_table and is_generated = 'NEVER' and column_name <> 'id';
      execute format('delete from public.%I t where not exists (select 1 from _r2.%I s where s.id = t.id)', p_table, p_table);
      execute format('update public.%I t set %s from _r2.%I s where t.id = s.id', p_table, cols, p_table);
    end $f$;`)
}
function reset() {
  R.fixtureSql(`${TABLES.map((t) => `select _r2.restore('${t}')`).join('; ')};
    delete from public.corrective_action_review_events; delete from public.checklist_decision_events;
    delete from public.user_signatures where user_id in (select id from public.profiles where username like 'clo.%' or username like 'alpha.%')`)
}

// A tiny valid PNG, built here so no image file is stored in the repository.
function png() {
  const crc = (b) => { let c, n = ~0; for (const x of b) { c = (n ^ x) & 255; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; n = (n >>> 8) ^ c } return ~n >>> 0 }
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]) }
  const w = 32, h = 32, raw = Buffer.alloc((w * 3 + 1) * h, 120)
  for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

const ca = (id) => JSON.parse(R.sql(`select row_to_json(t) from (select status, review_status, exception_requested_by is not null as exc_requested, closed_by is not null as has_closed_by, submitted_by is not null as has_submitter, coalesce(jsonb_array_length(completion_photos),0) as photos, left(coalesce(review_comment,''),80) as review_comment from public.corrective_actions where id = '${id}') t`))
const events = (id) => R.sql(`select coalesce(string_agg(event_type, ',' order by id), '') from public.corrective_action_review_events where action_id = '${id}'`)
const sheet = (id) => JSON.parse(R.sql(`select row_to_json(t) from (select approval_status, locked, answers::text as answers, acknowledged_by is not null as acked, acknowledged_name, supervisor_by is not null as sup_signed from public.checklist_submissions where id = '${id}') t`))
const compliance = (id) => R.sql(`select row_to_json(v) from public.v_checklist_fault_compliance v where v.submission_id = '${id}'`)
const { execFileSync } = require('child_process')
// Round 4: run statements as a signed-in person inside a transaction that is always rolled back.
function dbAs(uid, stmt) {
  const q = `begin; select set_config('request.jwt.claims', json_build_object('sub','${uid}','role','authenticated')::text, true); set local role authenticated; ${stmt}; rollback;`
  try { execFileSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', process.env.PGPORT_E2E || '54329', '-U', 'postgres', '-d', process.env.E2E_DB, '-c', q], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); return 'ACCEPTED' }
  catch (e) { return 'REFUSED: ' + String(e.stderr || e.message).split('\n').find((l) => /ERROR/.test(l)) }
}

async function openAction(s, title) {
  const p = s.page
  const st = await R.openRoute(p, '/actions', s.log)
  if (st.url !== '/actions' || st.accessDenied) return { opened: false, url: st.url, denied: st.accessDenied }
  const card = p.locator('article', { hasText: title }).first()
  if (!(await card.isVisible().catch(() => false))) return { opened: true, listed: false }
  await card.getByRole('button', { name: 'Edit' }).click(); await p.waitForTimeout(1500)
  const panel = p.locator('[data-testid="closure-review-panel"]')
  const has = async (name) => panel.getByRole('button', { name }).isVisible().catch(() => false)
  return { opened: true, listed: true, panel: await panel.isVisible().catch(() => false),
    label: ((await panel.locator('span.border').first().innerText().catch(() => '')) || '').trim(),
    canSubmit: await has('Submit for review'), canProgress: await has('Save as progress'),
    canApprove: await has('Approve closure'), canReturn: await has('Return for correction'),
    canException: await panel.getByText('Ask for a documented exception instead').isVisible().catch(() => false),
    canDecideException: await panel.locator('[data-testid="exception-decision"]').isVisible().catch(() => false),
    exceptionSelfBlocked: await panel.locator('[data-testid="exception-self-blocked"]').isVisible().catch(() => false),
    waitingOn: ((await panel.locator('[data-testid="closure-waiting-on"]').innerText().catch(() => '')) || '').trim(),
    text: ((await panel.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').slice(0, 700), loc: panel }
}
const feedback = async (panel) => ((await panel.locator('[role=status], [role=alert]').first().innerText({ timeout: 4000 }).catch(() => '')) || '').trim()
const strip = (o) => { const { loc, ...rest } = o; return rest }
async function closeDialog(page) { await page.locator('[role=dialog]').last().getByRole('button', { name: 'Cancel' }).click().catch(() => {}); await page.waitForTimeout(400) }

async function statusSelectClose(s, title, id) {
  const p = s.page
  await R.openRoute(p, '/actions', s.log)
  await p.getByLabel(`Status of ${title}`).first().selectOption('Closed'); await p.waitForTimeout(2000)
  const msg = (await p.locator('main [role=alert]').allInnerTexts()).join(' | ').replace(/\s+/g, ' ').trim()
  return { message: msg, rawSql: R.rawSql(msg), db: ca(id) }
}

async function requestException(a, reason) {
  await a.loc.getByText('Ask for a documented exception instead').click()
  await a.loc.locator('#ca-exception-reason').fill('short')
  const shortDisabled = await a.loc.getByRole('button', { name: 'Request exception' }).isDisabled()
  await a.loc.locator('#ca-exception-reason').fill(reason)
  await a.loc.getByRole('button', { name: 'Request exception' }).click()
  return { shortDisabled, message: await feedback(a.loc) }
}
async function decideException(a, decision, note) {
  if (note) await a.loc.locator('#ca-exception-decision').fill(note)
  await a.loc.getByRole('button', { name: decision === 'approve' ? 'Approve exception' : 'Refuse exception' }).click()
  return feedback(a.loc)
}

async function actions() {
  const out = {}
  R.fixtureSql(`update public.action_items set assigned_user_id = (select id from public.profiles where username = 'alpha.manager'), assigned_to = 'Test Alpha Manager' where source = 'corrective:${A2}'`)
  const T1 = 'Synthetic: replace worn tyre', T2 = 'Synthetic: check pressure', T6 = 'Synthetic: second north action'

  // 1. The assigned worker.
  let w = await R.session('clo.collector')
  let a = await openAction(w, T1)
  out.worker_open = strip(a)
  await a.loc.locator('#ca-completion-note').fill('R2 progress: wheel removed, waiting for the new tyre.')
  await a.loc.getByRole('button', { name: 'Save as progress' }).click()
  out.worker_progress = { message: await feedback(a.loc), events: events(A1), db: ca(A1) }
  await closeDialog(w.page)
  out.worker_close_by_status = await statusSelectClose(w, T1, A1)
  a = await openAction(w, T1)
  await a.loc.locator('input[type=file]').setInputFiles({ name: 'evidence.png', mimeType: 'image/png', buffer: png() }); await w.page.waitForTimeout(1200)
  out.worker_photo_preview = await a.loc.locator('img[alt^="Completion evidence"]').count()
  await a.loc.locator('#ca-completion-note').fill('R2 completion: new tyre fitted and torqued.')
  await a.loc.getByRole('button', { name: 'Submit for review' }).click()
  out.worker_submit = { message: await feedback(a.loc), events: events(A1), db: ca(A1) }
  await w.page.waitForTimeout(800)
  out.worker_after_submit = strip(await openAction(w, T1))
  await w.context.close()

  // 2. Another collector, not assigned.
  const o = await R.session('clo.collector2')
  out.unassigned_worker = strip(await openAction(o, T1))
  await o.context.close()

  // 3. Reviewer returns it with a comment.
  let m = await R.session('alpha.manager')
  a = await openAction(m, T1)
  out.reviewer_open = strip(a)
  out.reviewer_return_disabled_without_comment = await a.loc.getByRole('button', { name: 'Return for correction' }).isDisabled().catch(() => null)
  await a.loc.locator('#ca-review-comment').fill('R2: torque value is missing, add it and resubmit.')
  await a.loc.getByRole('button', { name: 'Return for correction' }).click()
  out.reviewer_return = { message: await feedback(a.loc), events: events(A1), db: ca(A1) }
  await m.context.close()

  // 4. Worker sees the comment and resubmits.
  w = await R.session('clo.collector')
  a = await openAction(w, T1)
  out.worker_sees_return = strip(a)
  await a.loc.locator('#ca-completion-note').fill('R2 resubmission: torque 600 Nm recorded.')
  await a.loc.getByRole('button', { name: 'Submit for review' }).click()
  out.worker_resubmit = { message: await feedback(a.loc), events: events(A1), db: ca(A1) }
  await w.context.close()

  // 5. Reviewer approves; history.
  // C1: the North Workshop Supervisor (a default reviewer) reaches /actions and reviews an action at his own site.
  const sn = await R.session('clo.sup.north')
  const snLinks = await R.sidebarLinks(sn.page)
  out.c1_sidebar_actions = snLinks.some((l) => l.href === '/actions')
  a = await openAction(sn, T1)
  out.c1_sup_own_site_open = strip(a)
  if (a.canApprove) {
    await a.loc.getByRole('button', { name: 'Approve closure' }).click()
    out.reviewer_approve = { by: 'clo.sup.north', message: await feedback(a.loc), events: events(A1), db: ca(A1) }
  }
  out.c1_sup_failed = sn.log.failed.filter((f) => !/user_view_prefs/.test(f)); out.c1_sup_page_errors = sn.log.pageErrors
  await sn.context.close()
  m = await R.session('alpha.manager')
  if (!out.reviewer_approve) {
    a = await openAction(m, T1)
    await a.loc.getByRole('button', { name: 'Approve closure' }).click()
    out.reviewer_approve = { by: 'alpha.manager', message: await feedback(a.loc), events: events(A1), db: ca(A1) }
    await m.page.waitForTimeout(800)
    await closeDialog(m.page)
  }
  await m.page.getByLabel('Filter by status').selectOption({ label: 'Closed' }).catch(() => {})
  a = await openAction(m, T1)
  if (a.listed) {
    await a.loc.locator('summary').click().catch(() => {}); await m.page.waitForTimeout(300)
    out.history_shown = (await a.loc.locator('details li').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').slice(0, 140))
  } else out.history_shown = 'closed action not listed with the default filters'

  // 6. Self-review: the manager is the assigned worker of A2, submits, then tries to decide it.
  await closeDialog(m.page)
  a = await openAction(m, T2)
  out.self_open = strip(a)
  if (a.canSubmit) {
    await a.loc.locator('#ca-completion-note').fill('R2 self-review case: pressure corrected.')
    await a.loc.getByRole('button', { name: 'Submit for review' }).click()
    out.self_submit = { message: await feedback(a.loc), db: ca(A2) }
    await m.page.waitForTimeout(800)
    out.self_after_submit = strip(await openAction(m, T2))
    await closeDialog(m.page)
    out.self_close_by_status = await statusSelectClose(m, T2, A2)
  }
  // 7. Exception by an authorised role, with a reason.
  a = await openAction(m, T6)
  out.exception_open = strip(a)
  if (a.canException) {
    const rq = await requestException(a, 'R3: vehicle sold, the fix will not happen.')
    out.exception_short_reason_disabled = rq.shortDisabled
    out.exception_requested = { message: rq.message, events: events(A6), db: ca(A6) }
    await m.page.waitForTimeout(800); await closeDialog(m.page)
    out.exception_requester_view = strip(await openAction(m, T6))
    await closeDialog(m.page)
    out.exception_requester_close_by_status = await statusSelectClose(m, T6, A6)
  }
  out.manager_failed = m.log.failed.filter((f) => !/user_view_prefs/.test(f)); out.manager_page_errors = m.log.pageErrors
  await m.context.close()

  // C1: the North supervisor on a submitted action at ANOTHER site (East).
  const sn2 = await R.session('clo.sup.north')
  out.c1_sup_other_site = strip(await openAction(sn2, T2))
  out.c1_sup_other_site_db = ca(A2)
  await sn2.context.close()

  // 8. Another reviewer decides the self-submitted one.
  const ad = await R.session('alpha.admin')
  a = await openAction(ad, T2)
  out.other_reviewer_open = strip(a)
  if (a.canApprove) { await a.loc.getByRole('button', { name: 'Approve closure' }).click(); out.other_reviewer_approve = { message: await feedback(a.loc), db: ca(A2) } }
  a = await openAction(ad, T6)
  out.exception_decider_open = strip(a)
  if (a.canDecideException) out.exception_decided = { message: await decideException(a, 'approve', 'R3: confirmed with the fleet register.'), events: events(A6), db: ca(A6) }
  await ad.context.close()
  // Round 4: history keeps both people and both times; the action reads as closed by exception.
  out.exception_history = R.sql(`select string_agg(event_type || ' by ' || actor_name || ' (' || actor_role || ') at ' || to_char(created_at, 'YYYY-MM-DD HH24:MI'), ' | ' order by id) from public.corrective_action_review_events where action_id = '${A6}'`)
  out.exception_people = R.sql(`select (select username from public.profiles where id = exception_requested_by) || ' asked at ' || exception_requested_at || '; ' || (select username from public.profiles where id = reviewed_by) || ' decided at ' || reviewed_at from public.corrective_actions where id = '${A6}'`)
  { const ad5 = await R.session('alpha.admin'); out.exception_closed_view = strip(await openAction(ad5, T6)); await ad5.context.close() }
  // Round 4: an exception asked for and decided by the same person is refused by the database.
  {
    const mgr = R.sql(`select id from public.profiles where username = 'alpha.manager'`)
    const open = R.sql(`select id from public.corrective_actions where title like 'Checklist fault: Mirrors (Synthetic Workshop%' and status = 'Open' and review_status is null and organisation_id = '00000000-0000-0000-0000-000000000001' order by id limit 1`)
    out.exception_self_decide_db = dbAs(mgr, `select public.corrective_action_request_exception('${open}', 'R4: same person asks and decides.'); select public.corrective_action_decide_exception('${open}', 'approve', 'R4 self')`)
    out.exception_self_decide_request_alone_db = dbAs(mgr, `select public.corrective_action_request_exception('${open}', 'R4: same person asks and decides.')`)
    out.exception_self_decide_after = ca(open)
  }

  // 9. Roles that should not get the exception or the page.
  const t = await R.session('r2.tpe')
  out.tpe_on_open_action = strip(await openAction(t, 'Checklist fault: Brakes'))
  await t.context.close()
  const c = await R.session('clo.collector')
  out.collector_on_unassigned = strip(await openAction(c, 'Checklist fault: Brakes'))
  await c.context.close()
  for (const u of ['clo.sup.north', 'clo.sup.east', 'alpha.tyreman']) {
    const x = await R.session(u); const st = await R.openRoute(x.page, '/actions', x.log)
    out[`route_${u}`] = { url: st.url, heading: st.heading, denied: st.accessDenied }
    await x.context.close()
  }
  // 10. Does the self-review rule also hold for the exception path? The submitter records an exception on their own submission.
  const m2 = await R.session('alpha.manager')
  const T5 = 'Checklist fault: Seat belts'
  const A5 = R.sql(`select id from public.corrective_actions where title like '${T5}%' limit 1`)
  a = await openAction(m2, T5)
  if (a.canSubmit) {
    await a.loc.locator('#ca-completion-note').fill('R2: submitter then exception case.')
    await a.loc.getByRole('button', { name: 'Submit for review' }).click(); await feedback(a.loc); await m2.page.waitForTimeout(800)
    a = await openAction(m2, T5)
    out.self_exception_offered = a.canException
    if (a.canException) {
      const rq = await requestException(a, 'R3: asking for an exception on my own submission.')
      out.self_exception_request = { message: rq.message, events: events(A5), db: ca(A5) }
      await m2.page.waitForTimeout(800); await closeDialog(m2.page)
      out.self_exception_requester_view = strip(await openAction(m2, T5))
      await closeDialog(m2.page)
      out.self_exception_close_by_status = await statusSelectClose(m2, T5, A5)
    }
  }
  await m2.context.close()
  if (out.self_exception_request) {
    const ad2 = await R.session('alpha.admin')
    a = await openAction(ad2, T5)
    out.self_exception_second_reviewer_open = strip(a)
    if (a.canDecideException) out.self_exception_refused = { message: await decideException(a, 'refuse', 'R3: fix the seat belt instead.'), events: events(A5), db: ca(A5) }
    await ad2.context.close()
  }
  const b = await R.session('beta.manager'); const bs = await R.openRoute(b.page, '/actions', b.log)
  out.other_company_sees = /Synthetic: replace worn tyre/.test(bs.text)
  await b.context.close()
  return out
}

async function drawSignature(page, scope) {
  const pad = scope.locator('[data-testid="signature-capture"]').first()
  if (!(await pad.count())) return false
  await pad.scrollIntoViewIfNeeded(); await page.waitForTimeout(200)
  const box = await pad.boundingBox()
  if (!box) return false
  await page.mouse.move(box.x + 20, box.y + box.height / 2); await page.mouse.down()
  for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + 20 + i * 18, box.y + box.height / 2 + (i % 2 ? -14 : 14), { steps: 3 })
  await page.mouse.up(); await page.waitForTimeout(300)
  return true
}
async function openSheet(s, id) {
  const p = s.page
  const st = await R.openRoute(p, `/checklists/submission/${id}`, s.log)
  await p.waitForTimeout(1200)
  const fault = p.locator('[data-testid="checklist-fault-panel"]'), dec = p.locator('[data-testid="checklist-decision-panel"]')
  return { url: st.url, denied: st.accessDenied, notFound: /not found|could not|no longer/i.test(st.text) && !/Recorded faults/.test(st.text),
    faultPanel: await fault.isVisible().catch(() => false), decisionPanel: await dec.isVisible().catch(() => false),
    faultText: ((await fault.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').slice(0, 700),
    decisionText: ((await dec.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').slice(0, 400),
    canAcknowledge: await fault.getByRole('button', { name: 'Acknowledge with fault' }).isVisible().catch(() => false),
    statusLine: (st.text.match(/Sign-off[^\n]*\n[^\n]*/) || [''])[0].replace(/\s+/g, ' '), fault, dec }
}
const stripS = (o) => { const { fault, dec, ...rest } = o; return rest }

async function checklists() {
  const out = {}
  // 1. Single-signature sheet at East, signed by the East supervisor.
  let e = await R.session('clo.sup.east')
  let v = await openSheet(e, S6)
  out.sup_east_open = stripS(v)
  // The normal approval is still refused.
  if (v.decisionPanel) {
    await drawSignature(e.page, v.dec)
    const ab = v.dec.getByRole('button', { name: /^Approve/ })
    out.approve_with_fault = { disabled: await ab.isDisabled().catch(() => null), title: await ab.getAttribute('title').catch(() => null) }
    if (out.approve_with_fault.disabled === false) { await ab.click(); await e.page.waitForTimeout(1500); out.approve_with_fault.message = ((await v.dec.locator('p.text-red-400').first().innerText().catch(() => '')) || '').trim(); out.approve_with_fault.db = sheet(S6) }
  }
  v = await openSheet(e, S6)
  out.ack_button_disabled_without_signature = await v.fault.getByRole('button', { name: 'Acknowledge with fault' }).isDisabled().catch(() => null)
  await v.fault.locator('textarea').fill('R2: horn fault seen, vehicle held.')
  out.signature_drawn = await drawSignature(e.page, v.fault)
  await v.fault.getByRole('button', { name: 'Acknowledge with fault' }).click(); await e.page.waitForTimeout(2500)
  out.acknowledge = { message: ((await v.fault.locator('[role=status], [role=alert]').first().innerText().catch(() => '')) || '').trim(), db: sheet(S6), compliance: compliance(S6) }
  out.after_ack_page = stripS(await openSheet(e, S6))
  const list = await R.openRoute(e.page, '/checklists', e.log)
  out.after_ack_list = (list.text.match(/[^\n]*Synthetic Single Sign[^\n]*(\n[^\n]*){0,6}/) || [''])[0].replace(/\s+/g, ' ').slice(0, 300)
  // K1: the acknowledged sheet in the list, the viewer drawer and the Audit Pack.
  const LBL = 'Acknowledged, Action Required'
  out.k1_list = { label: list.text.includes(LBL), pendingApprovalNearRow: /Pending approval/i.test(out.after_ack_list), rawWord: /\backnowledged\b/.test(list.text),
    tiles: (list.text.match(/(Pending approval|Action Required|Acknowledged)[^\n]*\n[^\n]*/gi) || []).map((t) => t.replace(/\s+/g, ' ')).slice(0, 8) }
  // The workspace row is a selector button (it fills the detail card); the drawer opens from "Open viewer".
  const rowBtn = e.page.locator('button.clw-row').filter({ hasText: 'Synthetic Single Sign' }).filter({ hasText: 'TM007' }).first()
  out.k1_viewer = { rowFound: await rowBtn.isVisible().catch(() => false), rowText: ((await rowBtn.innerText().catch(() => '')) || '').replace(/\s+/g, ' ') }
  if (out.k1_viewer.rowFound) {
    await rowBtn.click(); await e.page.waitForTimeout(1000)
    const ov = e.page.getByRole('button', { name: 'Open viewer' }).first()
    out.k1_viewer.viewerButton = await ov.isVisible().catch(() => false)
    if (out.k1_viewer.viewerButton) {
      await ov.click(); await e.page.waitForTimeout(2000)
      const dlg = e.page.locator('[role=dialog][aria-label="Checklist"]').last()
      const dt = ((await dlg.innerText().catch(() => '')) || '').replace(/\s+/g, ' ')
      out.k1_viewer = { ...out.k1_viewer, opened: dt.length > 0, label: dt.includes(LBL), rawWord: /\backnowledged\b/.test(dt), text: dt.slice(0, 400) }
      await e.page.keyboard.press('Escape').catch(() => {})
    }
  }
  // The Audit Pack is an author surface (CHECKLIST_AUTHOR_ROLES): a Workshop Supervisor is refused, a Manager reads it.
  const apSup = await R.openRoute(e.page, '/checklist-audit', e.log); await e.page.waitForTimeout(1500)
  out.k1_audit_pack_non_author = { role: 'Workshop Supervisor', url: apSup.url, denied: apSup.accessDenied, text: (await R.bodyText(e.page)).slice(0, 200) }
  const mg = await R.session('alpha.manager')
  const ap = await R.openRoute(mg.page, '/checklist-audit', mg.log); await mg.page.waitForTimeout(3000)
  let apText = await R.bodyText(mg.page)
  out.k1_audit_pack = { role: 'Manager', url: ap.url, denied: ap.accessDenied, tile: (apText.match(/Acknowledged, Action Required\s*\d+/) || [''])[0], head: apText.slice(0, 300) }
  const recTab = mg.page.getByRole('tab', { name: /record/i }).first()
  out.k1_audit_pack.recordsTab = await recTab.isVisible().catch(() => false)
  if (out.k1_audit_pack.recordsTab) { await recTab.click(); await mg.page.waitForTimeout(1500); apText = await R.bodyText(mg.page) }
  out.k1_audit_pack.recordsLabel = apText.includes(LBL); out.k1_audit_pack.rawWord = /\backnowledged\b/.test(apText)
  out.k1_audit_pack.row = (apText.match(/.{0,100}Acknowledged, Action Required.{0,100}/g) || []).slice(-1)[0] || ''
  out.k1_audit_pack.failed = mg.log.failed; out.k1_audit_pack.pageErrors = mg.log.pageErrors
  await mg.context.close()
  out.sup_east_failed = e.log.failed; out.sup_east_page_errors = e.log.pageErrors
  await e.context.close()

  // 2. Not authorised: supervisor of another site, the person who filled the sheet, a collector, a Tyre Man.
  const n = await R.session('clo.sup.north')
  out.other_site_supervisor_S6 = stripS(await openSheet(n, S6))
  out.own_sheet_S1 = stripS(await openSheet(n, S1))
  v = await openSheet(n, S8)
  out.two_stage_first_signer_S8 = stripS(v)
  if (v.decisionPanel) {
    await drawSignature(n.page, v.dec)
    const sb = v.dec.locator('button').last()
    out.first_signature = { button: (await sb.innerText().catch(() => '')).trim(), disabled: await sb.isDisabled().catch(() => null) }
    if (out.first_signature.disabled === false) { await sb.click(); await n.page.waitForTimeout(2000); out.first_signature.message = ((await v.dec.locator('p.text-green-400, p.text-red-400').first().innerText().catch(() => '')) || '').trim(); out.first_signature.db = sheet(S8) }
  }
  await n.context.close()
  const c = await R.session('clo.collector')
  out.collector_S8 = stripS(await openSheet(c, S8))
  await c.context.close()
  const am = await R.session('clo.areamgr')
  out.area_manager_own_sheet_S8 = stripS(await openSheet(am, S8))
  await am.context.close()
  const tm = await R.session('alpha.tyreman')
  out.tyre_man_S6 = stripS(await openSheet(tm, S6))
  await tm.context.close()

  // 3. Final signer acknowledges the two-stage sheet.
  const ad = await R.session('alpha.admin')
  v = await openSheet(ad, S8)
  out.final_signer_S8 = stripS(v)
  if (v.canAcknowledge) {
    await drawSignature(ad.page, v.fault)
    await v.fault.getByRole('button', { name: 'Acknowledge with fault' }).click(); await ad.page.waitForTimeout(2500)
    out.final_acknowledge = { message: ((await v.fault.locator('[role=status], [role=alert]').first().innerText().catch(() => '')) || '').trim(), db: sheet(S8), compliance: compliance(S8) }
  }
  await ad.context.close()

  // 4. Exception on the fault's corrective action by an authorised role, with a reason; the sheet then reads compliant by exception.
  const m = await R.session('alpha.manager')
  const a = await openAction(m, 'Checklist fault: Horn')
  out.exception_action_open = strip(a)
  if (a.canException) {
    const rq = await requestException(a, 'R3: horn unit obsolete, vehicle retired from road use.')
    out.exception_request = { message: rq.message, compliance: compliance(S6) }
  }
  out.sheet_after_exception_request = stripS(await openSheet(m, S6))
  await m.context.close()
  const ad3 = await R.session('alpha.admin')
  const a3 = await openAction(ad3, 'Checklist fault: Horn')
  if (a3.canDecideException) out.exception = { message: await decideException(a3, 'approve', 'R3: agreed.'), compliance: compliance(S6) }
  out.sheet_after_exception = stripS(await openSheet(ad3, S6))
  await ad3.context.close()
  const c2 = await R.session('clo.collector2')
  out.exception_unauthorised_collector = strip(await openAction(c2, 'Checklist fault: Mirrors'))
  await c2.context.close()
  return out
}

;(async () => {
  snapshot(); reset()
  const which = process.argv.slice(2).length ? process.argv.slice(2) : ['actions', 'checklists']
  for (const k of which) {
    let r
    try { r = k === 'actions' ? await actions() : await checklists() } catch (e) { r = { error: String(e.stack).slice(0, 900) } }
    R.save(`closure_${k}`, r); console.log(`\n=== ${k}\n` + JSON.stringify(r, null, 1))
    await R.closeBrowser()
  }
})()
