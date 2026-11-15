// Round 2: work order rights by role, in a real browser, after the work order drafts are applied to the e2e copy.
// Usage: node specs/round2_work_orders.cjs [username ...]
const R = require('./round2_lib.cjs')

const ALPHA = '00000000-0000-0000-0000-000000000001'
const USERS = {
  'alpha.admin':   { label: 'Admin', site: 'all' },
  'alpha.manager': { label: 'Manager (KSA, all sites)', site: 'all' },
  'r2.sup.all':    { label: 'Workshop Supervisor (KSA, all sites)', site: 'all' },
  'clo.sup.north': { label: 'Workshop Supervisor (North plant only)', site: 'north' },
  'r2.tpe':        { label: 'Tire Planning Engineer (KSA)', site: 'all', tyreOnly: true },
  'alpha.tyreman': { label: 'Tyre Man', site: 'all', technician: true },
  'r2.mechanic':   { label: 'Mechanic (technician)', site: 'north', technician: true },
  'clo.collector': { label: 'Tyre Data Collector', site: 'all' },
}
const wo = (mark) => {
  const [id, no] = R.sql(`select id, work_order_no from public.work_orders where description like 'R2-${mark} %'`).split('\t')
  return { id, no }
}
const row = (id, cols) => R.sql(`select row_to_json(t) from (select ${cols} from public.work_orders where id = '${id}') t`)

function snapshot() {
  R.sql(`create schema if not exists _r2;
    create table if not exists _r2.wo as select * from public.work_orders where description like 'R2-%';
    create table if not exists _r2.asg as select id from public.wo_assignments;
    create or replace function _r2.reset() returns void language plpgsql as $f$
    declare cols text;
    begin
      select string_agg(format('%I = s.%I', column_name, column_name), ', ') into cols from information_schema.columns
       where table_schema = 'public' and table_name = 'work_orders' and is_generated = 'NEVER' and column_name <> 'id';
      set local session_replication_role = replica;
      execute 'update public.work_orders w set ' || cols || ' from _r2.wo s where w.id = s.id';
      delete from public.wo_assignments a where not exists (select 1 from _r2.asg s where s.id = a.id);
      delete from public.work_orders where description like 'R2NEW-%';
      set local session_replication_role = origin;
    end $f$;`)
}
const reset = () => R.sql('select _r2.reset()')

async function findRow(page, no) {
  for (const b of await page.getByRole('button', { name: 'Clear date' }).all()) await b.click().catch(() => {})
  await page.getByLabel('Search work orders').fill(no)
  await page.waitForTimeout(1800)
  return page.locator(`button[aria-label="View work order ${no}"]`).first().isVisible().catch(() => false)
}
const btnState = async (loc) => (await loc.count()) === 0 ? { present: false }
  : { present: true, disabled: await loc.first().isDisabled(), title: (await loc.first().getAttribute('title')) || '' }

async function saveForm(s, buttonName) {
  const before = s.alerts.length
  await s.page.locator('[role=dialog]').last().getByRole('button', { name: buttonName }).click()
  await s.page.waitForTimeout(2500)
  const open = await s.page.locator('[role=dialog]').getByRole('button', { name: buttonName }).isVisible().catch(() => false)
  const errors = open ? (await s.page.locator('[role=dialog]').last().locator('span.text-red-400').allInnerTexts()).filter((t) => t.trim() && t.trim() !== '*').slice(0, 5) : []
  return { alert: s.alerts.slice(before).join(' | '), formStillOpen: open, fieldErrors: errors }
}
async function closeDialogs(page) {
  for (let i = 0; i < 3; i++) {
    const c = page.locator('[role=dialog]').last().getByRole('button', { name: /^(Cancel|Close)$/ }).first()
    if (await c.isVisible().catch(() => false)) await c.click().catch(() => {})
    else await page.keyboard.press('Escape').catch(() => {})
    await page.waitForTimeout(300)
  }
}

async function createCase(s, { asset, type, marker }) {
  const p = s.page
  const out = { asset, type }
  const nb = p.getByRole('button', { name: 'New Work Order' }).first()
  out.button = await btnState(nb)
  if (!out.button.present || out.button.disabled) return out
  await nb.click(); await p.waitForTimeout(800)
  const dlg = p.locator('[role=dialog]').last()
  out.typesOffered = await R.control(dlg, 'Job Type').locator('option').allInnerTexts()
  if (!out.typesOffered.includes(type)) { out.result = 'type not offered'; await closeDialogs(p); return out }
  await R.control(dlg, 'Asset Code').fill(asset)
  await R.control(dlg, 'Asset Code').blur(); await p.waitForTimeout(1200)
  await R.control(dlg, 'Job Type').selectOption(type)
  await R.control(dlg, 'Production Complaint').fill(marker)
  out.siteFilled = await R.control(dlg, 'Location (Site)').inputValue()
  Object.assign(out, await saveForm(s, 'Create job card'))
  out.db = R.sql(`select work_order_no || ' site=' || coalesce(site,'') || ' country=' || coalesce(country,'') || ' status=' || status from public.work_orders where description = '${marker}' and organisation_id = '${ALPHA}'`)
  out.result = out.db ? 'created' : 'not created'
  await closeDialogs(p)
  return out
}

async function editCase(s, mark, { field, value, column }) {
  const p = s.page
  const w = wo(mark)
  const out = { mark, field }
  out.listed = await findRow(p, w.no)
  if (!out.listed) return out
  const eb = p.locator(`button[aria-label="Edit work order ${w.no}"]`)
  out.button = await btnState(eb)
  if (out.button.disabled) return out
  const before = row(w.id, `${column}, parts_cost, labour_cost, status, created_by`)
  await eb.click(); await p.waitForTimeout(900)
  const dlg = p.locator('[role=dialog]').last()
  const c = R.control(dlg, field)
  if (!(await c.isVisible().catch(() => false))) {
    // collapsed section: open every section header then retry
    for (const h of await dlg.locator('button:has-text("filled")').all()) { if (!(await c.isVisible().catch(() => false))) await h.click().catch(() => {}) }
  }
  out.controlDisabled = await c.isDisabled().catch(() => null)
  if (out.controlDisabled === false) await c.fill(String(value))
  Object.assign(out, await saveForm(s, 'Save job card'))
  out.before = before; out.after = row(w.id, `${column}, parts_cost, labour_cost, status, created_by`)
  out.changed = out.before !== out.after
  await closeDialogs(p)
  return out
}

async function statusCase(s, mark, to) {
  const p = s.page
  const w = wo(mark)
  const out = { mark, to }
  out.listed = await findRow(p, w.no)
  if (!out.listed) return out
  await p.locator(`button[aria-label="View work order ${w.no}"]`).click(); await p.waitForTimeout(900)
  const dlg = p.locator('[role=dialog]').last()
  const b = dlg.getByRole('button', { name: to, exact: true })
  out.button = await btnState(b)
  if (out.button.present && !out.button.disabled) { await b.click(); await p.waitForTimeout(2000) }
  out.message = ((await dlg.innerText().catch(() => '')).match(/Update failed:[^\n]*/) || [''])[0]
  out.dbStatus = R.sql(`select status from public.work_orders where id = '${w.id}'`)
  await closeDialogs(p)
  return out
}

async function liveCase(s) {
  const p = s.page
  const out = {}
  const st = await R.openRoute(p, '/workshop-live', s.log)
  out.open = !st.accessDenied && !st.errorBoundary && st.url === '/workshop-live'
  out.heading = st.heading
  if (!out.open) { out.refusal = (st.text.match(/This section requires[^.]*\.|Your role does not have permission[^.]*\./) || [''])[0]; return out }
  await p.waitForTimeout(1500)
  out.newJob = await btnState(p.getByRole('button', { name: 'New Job' }))
  const show = p.getByRole('button', { name: 'Show job board' })
  if (await show.isVisible().catch(() => false)) { await show.click(); await p.waitForTimeout(800) }
  for (const mark of ['GENERAL', 'EAST', 'QC', 'ASSIGNED']) {
    const w = wo(mark)
    const card = p.locator(`[id="ref-${w.id}"]`)
    const c = { onBoard: (await card.count()) > 0 }
    if (c.onBoard) {
      c.assign = await btnState(card.getByLabel('Assign technician'))
      c.move = await btnState(card.getByLabel('Move status'))
      c.priority = await btnState(card.getByLabel('Set priority'))
      if (mark === 'QC') c.qcPass = await btnState(card.getByRole('button', { name: 'QC Pass' }))
    }
    out[mark] = c
  }
  // Assign a technician to the general job from the board.
  const g = wo('GENERAL'); const gc = p.locator(`[id="ref-${g.id}"]`)
  if (out.GENERAL.onBoard && out.GENERAL.assign.present && !out.GENERAL.assign.disabled) {
    const opts = await gc.getByLabel('Assign technician').locator('option').evaluateAll((os) => os.map((o) => [o.value, o.textContent]))
    const pick = opts.find((o) => o[0])
    out.GENERAL.techniciansOffered = opts.length - 1
    if (pick) {
      await gc.getByLabel('Assign technician').selectOption(pick[0]); await p.waitForTimeout(2500)
      out.GENERAL.assignDb = R.sql(`select count(*) from public.wo_assignments where job_id = '${g.id}' and active`) + ' active assignment(s); owner set=' + R.sql(`select assigned_owner_id is not null from public.work_orders where id = '${g.id}'`)
      out.GENERAL.flash = ((await R.bodyText(p)).match(/Technician assigned\.|Job reassigned\.|could not[^.]*\.|not allowed[^.]*\./i) || [''])[0]
    }
  }
  if (out.GENERAL.onBoard && out.GENERAL.move.present && !out.GENERAL.move.disabled) {
    await p.locator(`[id="ref-${g.id}"]`).getByLabel('Move status').selectOption('In Progress').catch(() => {}); await p.waitForTimeout(2500)
    out.GENERAL.moveDb = R.sql(`select status from public.work_orders where id = '${g.id}'`)
  }
  const q = wo('QC'); const qc = p.locator(`[id="ref-${q.id}"]`)
  if (out.QC.onBoard && out.QC.qcPass?.present && !out.QC.qcPass.disabled) {
    await qc.getByRole('button', { name: 'QC Pass' }).click(); await p.waitForTimeout(2500)
    out.QC.qcDb = R.sql(`select status || ' qc=' || coalesce(qc_status,'') from public.work_orders where id = '${q.id}'`)
  }
  const a = wo('ASSIGNED'); const ac = p.locator(`[id="ref-${a.id}"]`)
  if (out.ASSIGNED.onBoard && out.ASSIGNED.move.present && !out.ASSIGNED.move.disabled && USERS[s.account.username]?.technician) {
    await ac.getByLabel('Move status').selectOption('Waiting for Parts').catch(() => {}); await p.waitForTimeout(2500)
    out.ASSIGNED.moveDb = R.sql(`select status from public.work_orders where id = '${a.id}'`)
  }
  return out
}

async function runUser(username) {
  const u = USERS[username]
  const res = { username, role: u.label, steps: {} }
  reset()
  const s = await R.session(username)
  const p = s.page
  try {
    const links = await R.sidebarLinks(p)
    res.steps.sidebar = { workOrders: links.some((l) => l.href === '/work-orders'), liveControl: links.some((l) => l.href === '/workshop-live'),
      correctiveActions: links.some((l) => l.href === '/actions'), count: links.length, workshop: links.filter((l) => /work|job|pm-|parts|shift|bay/i.test(l.href)).map((l) => l.text) }
    const st = await R.openRoute(p, '/work-orders', s.log)
    res.steps.open = { opened: !st.accessDenied && st.url === '/work-orders', heading: st.heading,
      refusal: (st.text.match(/Your role does not have permission[^.]*\./) || [''])[0] }
    if (res.steps.open.opened) {
      const tag = username.replace(/\W/g, '').toUpperCase()
      res.steps.createOwnSite = await createCase(s, { asset: 'MP001', type: u.tyreOnly ? 'Tyre Change' : 'Repair', marker: `R2NEW-${tag}-NORTH` })
      if (u.tyreOnly) res.steps.createGeneral = await createCase(s, { asset: 'MP001', type: 'Repair', marker: `R2NEW-${tag}-GENERAL` })
      if (u.site === 'north') res.steps.createOtherSite = await createCase(s, { asset: 'TM007', type: 'Repair', marker: `R2NEW-${tag}-EAST` })
      res.steps.editOpen = await editCase(s, u.tyreOnly ? 'TYRE' : 'GENERAL', { field: 'Scope', value: `edited by ${tag}`, column: 'scope' })
      if (u.tyreOnly) res.steps.editGeneral = await editCase(s, 'GENERAL', { field: 'Scope', value: `edited by ${tag}`, column: 'scope' })
      res.steps.editOtherSite = await editCase(s, 'EAST', { field: 'Scope', value: `edited by ${tag}`, column: 'scope' })
      res.steps.editAssigned = await editCase(s, 'ASSIGNED', { field: 'Scope', value: `edited by ${tag}`, column: 'scope' })
      res.steps.editPartsJob = await editCase(s, 'PARTS', { field: 'Scope', value: `edited by ${tag}`, column: 'scope' })
      res.steps.costOnApproved = await editCase(s, 'APPROVED', { field: 'Tyre Cost', value: 777, column: 'tyre_cost' })
      res.steps.scopeOnApproved = await editCase(s, 'APPROVED', { field: 'Scope', value: `edited by ${tag}`, column: 'scope' })
      res.steps.editClosed = await editCase(s, 'CLOSED', { field: 'Scope', value: `edited by ${tag}`, column: 'scope' })
      res.steps.statusMove = await statusCase(s, u.tyreOnly ? 'TYRE' : 'GENERAL', 'Awaiting Assignment')
      if (u.technician) res.steps.statusMoveAssigned = await statusCase(s, 'ASSIGNED', 'Waiting for Parts')
      // Delete: is the control offered, and for Admin does it work on the job this run created.
      await findRow(p, wo('GENERAL').no)
      res.steps.delete = { button: await btnState(p.locator(`button[aria-label="Delete work order ${wo('GENERAL').no}"]`)) }
      const made = R.sql(`select work_order_no from public.work_orders where description = 'R2NEW-${tag}-NORTH'`)
      if (made && res.steps.delete.button.present) {
        await findRow(p, made)
        await p.locator(`button[aria-label="Delete work order ${made}"]`).click(); await p.waitForTimeout(600)
        const dlg = p.locator('[role=dialog]').last()
        await dlg.locator('button').filter({ hasText: /delete/i }).first().click(); await p.waitForTimeout(2000)
        res.steps.delete.done = R.sql(`select count(*) from public.work_orders where work_order_no = '${made}'`) === '0'
      }
    }
    res.steps.liveControl = await liveCase(s)
    res.failedRequests = s.log.failed.filter((f) => !/user_view_prefs/.test(f)).slice(0, 30)
    res.consoleErrors = s.log.console.filter((c) => !/404 \(Not Found\)/.test(c)).slice(0, 10)
    res.pageErrors = s.log.pageErrors.slice(0, 10)
    res.alerts = s.alerts
  } catch (e) { res.error = String(e.message).slice(0, 600) }
  await s.context.close()
  // Remove what this run created so the next role starts from the same rows.
  reset()
  return res
}

;(async () => {
  snapshot()
  const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(USERS)
  const all = []
  for (const n of names) { const r = await runUser(n); all.push(r); R.save(`wo_${n.replace(/\W/g, '_')}${process.env.R2_TAG || ''}`, r); console.log(JSON.stringify(r)) }
  reset()
  await R.closeBrowser()
})()
