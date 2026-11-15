// Round 3: work order cost ledger, technician completion and final closure, in a real browser,
// after ALL work order drafts (incl. 20261115142000 ledger) are applied to the e2e COPY only.
// Usage: node specs/round3_ledger.cjs
// Every case reads the database before and after, so a screen that only looks right does not pass.
const R = require('./round2_lib.cjs')

const wo = (mark) => {
  const [id, no] = R.sql(`select id, work_order_no from public.work_orders where description like 'R2-${mark} %'`).split('\t')
  return { id, no }
}
const one = (q) => R.sql(q)
const { execFileSync } = require('child_process')
// Run one statement as a signed-in person, inside a transaction that is always rolled back.
function dbAs(uid, stmt) {
  const q = `begin; select set_config('request.jwt.claims', json_build_object('sub','${uid}','role','authenticated')::text, true); set local role authenticated; ${stmt}; rollback;`
  try { execFileSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', process.env.PGPORT_E2E || '54329', '-U', 'postgres', '-d', process.env.E2E_DB, '-c', q], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); return 'ACCEPTED' }
  catch (e) { return 'REFUSED: ' + String(e.stderr || e.message).split('\n').find((l) => /ERROR/.test(l)) }
}

function snapshot() {
  R.sql(`create schema if not exists _r3;
    create table if not exists _r3.wo as select * from public.work_orders where description like 'R2-%';
    create or replace function _r3.reset() returns void language plpgsql as $f$
    declare cols text;
    begin
      select string_agg(format('%I = s.%I', column_name, column_name), ', ') into cols from information_schema.columns
       where table_schema = 'public' and table_name = 'work_orders' and is_generated = 'NEVER' and column_name <> 'id';
      set local session_replication_role = replica;
      execute 'update public.work_orders w set ' || cols || ' from _r3.wo s where w.id = s.id';
      delete from public.work_order_cost_entry_events e using public.work_order_cost_entries c
       where e.entry_id = c.id and c.description like 'R3-%';
      delete from public.work_order_cost_entries where description like 'R3-%';
      set local session_replication_role = origin;
    end $f$;`)
}
const reset = () => R.sql('select _r3.reset()')

async function openView(s, w) {
  const p = s.page
  for (const b of await p.getByRole('button', { name: 'Clear date' }).all()) await b.click().catch(() => {})
  await p.getByLabel('Search work orders').fill(w.no)
  await p.waitForTimeout(1800)
  const v = p.locator(`button[aria-label="View work order ${w.no}"]`).first()
  if (!(await v.isVisible().catch(() => false))) return null
  await v.click(); await p.waitForTimeout(1500)
  return p.locator('[role=dialog]').last()
}
async function closeAll(p) {
  for (let i = 0; i < 3; i++) { await p.keyboard.press('Escape').catch(() => {}); await p.waitForTimeout(250) }
}

async function addCost(s, w, desc, amount) {
  const out = {}
  const st = await R.openRoute(s.page, '/work-orders', s.log)
  if (st.accessDenied) return { opened: false }
  const dlg = await openView(s, w)
  if (!dlg) return { listed: false }
  const panel = dlg.locator('section[aria-label="Cost ledger"]')
  out.panel = await panel.isVisible().catch(() => false)
  out.panelText = out.panel ? (await panel.innerText()).replace(/\s+/g, ' ').slice(0, 400) : ''
  const addBtn = panel.getByRole('button', { name: 'Add cost' })
  out.addOffered = (await addBtn.count()) > 0
  if (out.addOffered) {
    await panel.getByLabel('What the cost is').fill(desc)
    await panel.getByLabel(/^Amount in /).fill(String(amount))
    await panel.getByLabel('Why it is added').fill('round 3 browser test')
    await addBtn.click(); await s.page.waitForTimeout(2500)
    out.messageAfter = (await panel.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 400)
  }
  out.db = one(`select status || ' recon=' || reconciliation || ' amount=' || amount from public.work_order_cost_entries where description = '${desc}'`)
  await closeAll(s.page)
  return out
}

async function decide(s, w, desc, decision) {
  const st = await R.openRoute(s.page, '/work-orders', s.log)
  if (st.accessDenied) return { opened: false }
  const dlg = await openView(s, w)
  if (!dlg) return { listed: false }
  const panel = dlg.locator('section[aria-label="Cost ledger"]')
  const entry = panel.locator('li').filter({ hasText: desc }).first()
  const btn = entry.getByRole('button', { name: decision, exact: true })
  const out = { offered: (await btn.count()) > 0 }
  if (out.offered) {
    // The session helper answers dialogs with an empty value; give the reconciliation note through the page.
    await s.page.evaluate(() => { window.prompt = () => 'Checked against the imported amount in round 3: not in the ERP lines' })
    await btn.first().click(); await s.page.waitForTimeout(2500)
    out.messageAfter = (await panel.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300)
  }
  out.db = one(`select status || ' decided_by=' || coalesce((select username from public.profiles where id = decided_by), '-') from public.work_order_cost_entries where description = '${desc}'`)
  await closeAll(s.page)
  return out
}

async function statusButton(s, w, to, click) {
  const st = await R.openRoute(s.page, '/work-orders', s.log)
  if (st.accessDenied) return { opened: false }
  const dlg = await openView(s, w)
  if (!dlg) return { listed: false }
  const b = dlg.getByRole('button', { name: to, exact: true })
  const out = { present: (await b.count()) > 0 }
  if (out.present) {
    out.disabled = await b.first().isDisabled()
    if (click && !out.disabled) { await b.first().click(); await s.page.waitForTimeout(2200) }
  }
  out.message = ((await dlg.innerText().catch(() => '')).match(/Update failed:[^\n]*/) || [''])[0]
  out.dbStatus = one(`select status from public.work_orders where id = '${w.id}'`)
  await closeAll(s.page)
  return out
}

async function as(username, fn) {
  const s = await R.session(username)
  try { return await fn(s) } catch (e) { return { error: String(e.message).slice(0, 400) } } finally { await s.context.close() }
}

;(async () => {
  snapshot(); reset()
  const res = { cases: {} }
  const parts = wo('PARTS'); const qc = wo('QC'); const asg = wo('ASSIGNED')
  const totals = (id) => one(`select imported_total || '|' || additional_approved || '|' || calculated_total || '|' || unapproved_amount from public.v_work_order_cost_totals where work_order_id = '${id}'`)
  res.before = { partsCost: one(`select parts_cost from public.work_orders where id = '${parts.id}'`), totals: totals(parts.id) }

  // 1. Manager adds a cost on a card with an imported parts cost: a ledger entry, never a change to parts_cost.
  res.cases.managerAdds = await as('alpha.manager', (s) => addCost(s, parts, 'R3-MGR-PART', 20))
  res.cases.managerAddsPartsCostAfter = one(`select parts_cost from public.work_orders where id = '${parts.id}'`)
  // 2. The person who entered it cannot approve it.
  res.cases.managerSelfApprove = await as('alpha.manager', (s) => decide(s, parts, 'R3-MGR-PART', 'Approve'))
  // 3. Database refusal of self-approval, independent of the screen.
  const mgrId = one(`select id from public.profiles where username = 'alpha.manager'`)
  const entryId = one(`select id from public.work_order_cost_entries where description = 'R3-MGR-PART'`)
  res.cases.selfApproveDb = entryId ? dbAs(mgrId, `select public.work_order_cost_decide('${entryId}', 'approved', 'self')`) : 'no entry'
  res.cases.selfApproveDbStatus = one(`select status from public.work_order_cost_entries where description = 'R3-MGR-PART'`)
  // 4. A Workshop Supervisor has no cost approval under the drafts; an Admin (independent of the author) approves.
  res.cases.supervisorApproves = await as('r2.sup.all', (s) => decide(s, parts, 'R3-MGR-PART', 'Approve'))
  res.cases.adminApproves = await as('alpha.admin', (s) => decide(s, parts, 'R3-MGR-PART', 'Approve'))
  res.after = { partsCost: one(`select parts_cost from public.work_orders where id = '${parts.id}'`), totals: totals(parts.id) }
  // 5. Tyre Data Collector: on an UNASSIGNED job no cost entry; on an ASSIGNED job a draft cost, never an approval.
  const east = wo('EAST')
  res.eastBefore = { partsCost: one(`select parts_cost from public.work_orders where id = '${east.id}'`), totals: totals(east.id) }
  res.cases.collectorAddsUnassigned = await as('clo.collector', (s) => addCost(s, parts, 'R3-COL-UNASSIGNED', 15))
  R.sql(`insert into public.wo_assignments (job_id, user_id, role, active, organisation_id, country, site)
         select w.id, p.id, 'primary', true, w.organisation_id, w.country, w.site from public.work_orders w, public.profiles p
          where w.id = '${east.id}' and p.username = 'clo.collector'`)
  res.cases.collectorAddsAssigned = await as('clo.collector', (s) => addCost(s, east, 'R3-COL-PART', 15))
  res.cases.collectorApproveOwn = await as('clo.collector', (s) => decide(s, east, 'R3-COL-PART', 'Approve'))
  const colId = one(`select id from public.profiles where username = 'clo.collector'`)
  const colEntry = one(`select id from public.work_order_cost_entries where description = 'R3-COL-PART'`)
  const mgrEntry = one(`select id from public.work_order_cost_entries where description = 'R3-MGR-PART'`)
  res.cases.collectorApproveDb = colEntry ? dbAs(colId, `select public.work_order_cost_decide('${colEntry}', 'approved', 'collector')`) : 'no entry'
  res.cases.collectorReverseDb = mgrEntry ? dbAs(colId, `select public.work_order_cost_reverse('${mgrEntry}', 'collector')`) : 'no entry'
  res.cases.managerApprovesCollector = await as('alpha.manager', (s) => decide(s, east, 'R3-COL-PART', 'Approve'))
  res.eastTotalsAfter = totals(east.id)
  res.eastPartsCostAfter = one(`select parts_cost from public.work_orders where id = '${east.id}'`)
  R.sql(`delete from public.wo_assignments a using public.profiles p where a.user_id = p.id and p.username = 'clo.collector' and a.job_id = '${east.id}'`)
  // 6. Data Monitor Officer: no final closure on a job waiting for its quality check.
  res.cases.monitorClose = await as('r2.monitor', (s) => statusButton(s, qc, 'Completed', true))
  // 7. Technician on My Jobs: "Submit work done" moves an assigned job to Quality Inspection, not Completed.
  res.cases.technicianSubmit = await as('alpha.tyreman', async (s) => {
    const st = await R.openRoute(s.page, '/my-jobs', s.log)
    const out = { opened: !st.accessDenied && st.url === '/my-jobs', heading: st.heading }
    const card = s.page.locator('article, li, section').filter({ hasText: asg.no }).first()
    out.closeOffered = (await card.getByRole('button', { name: 'Completed', exact: true }).count()) > 0
    out.closeExplained = /You cannot close a job/.test(await card.innerText().catch(() => ''))
    await card.locator('textarea').first().fill('Round 3: tyre changed and torqued')
    const b = card.getByRole('button', { name: 'Submit work done' })
    out.offered = (await b.count()) > 0
    if (out.offered && !(await b.first().isDisabled())) { await b.first().click(); await s.page.waitForTimeout(2500) }
    out.dbStatus = one(`select status from public.work_orders where id = '${asg.id}'`)
    out.event = one(`select event_type from public.tech_activity_events where job_id = '${asg.id}' order by at desc limit 1`)
    return out
  })
  // 8. Supervisor gives final closure on the quality-check job.
  res.cases.supervisorClose = await as('r2.sup.all', (s) => statusButton(s, qc, 'Completed', true))
  res.cases.supervisorCloseClosedAt = one(`select coalesce(completed_at::text,'-') from public.work_orders where id = '${qc.id}'`)

  R.save('round3_ledger', res)
  console.log(JSON.stringify(res, null, 1))
  reset()
  await R.closeBrowser()
})()
