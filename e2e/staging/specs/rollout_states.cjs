// Rollout rehearsal: the NEW web build (main + #519 + #520) against a database that does NOT yet carry the drafts.
// S1 = no draft applied (production today). S2 = only the six #519 work order drafts applied.
// Usage: E2E_DB=<db> RO_STATE=S1|S2 node specs/rollout_states.cjs [username ...]
// PostgREST must point at the same database (e2e/staging/switch_db.sh <db>).
// Every case reads the database before and after; money tables are hashed before and after the whole run.
const R = require('./round2_lib.cjs')
const W = require('./round2_work_orders.cjs')
const L3 = require('./round3_ledger.cjs')

const STATE = process.env.RO_STATE || 'S?'
const ROLES = {
  'alpha.manager': 'Manager',
  'r2.sup.all': 'Workshop Supervisor',
  'alpha.tyreman': 'Technician (Tyre Man)',
  'r2.monitor': 'Data Monitor Officer',
  'alpha.admin': 'Admin',
}
const has = (rel) => R.sql(`select to_regclass('${rel}') is not null`) === 't'
const hasFn = (fn) => R.sql(`select count(*) > 0 from pg_proc where proname = '${fn}' and pronamespace = 'public'::regnamespace`) === 't'

// Money and history fingerprints. Rows the run creates are removed by reset() before the "after" hash.
function hashes() {
  const h = {
    work_orders_cost: R.sql(`select count(*) || ':' || md5(coalesce(string_agg(id::text || '|' || coalesce(parts_cost::text,'') || '|' || coalesce(labour_cost::text,'') || '|' || coalesce(total_cost::text,''), ',' order by id), '')) from public.work_orders`),
    work_orders_rows: R.sql(`select count(*) || ':' || md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.work_orders t`),
    parts_consumption: R.sql(`select count(*) || ':' || md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.parts_consumption t`),
    approval_execution_requests: R.sql(`select count(*) || ':' || md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.approval_execution_requests t`),
  }
  for (const t of ['work_order_cost_entries', 'work_order_cost_entry_events']) {
    h[t] = has(`public.${t}`) ? R.sql(`select count(*) || ':' || md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.${t} t`) : 'table absent'
  }
  return h
}

function snapshot() {
  R.sql(`create schema if not exists _ro;
    create table if not exists _ro.wo as select * from public.work_orders where description like 'R2-%';
    create table if not exists _ro.asg as select id from public.wo_assignments;
    create or replace function _ro.reset(p_since timestamptz) returns void language plpgsql as $f$
    declare cols text;
    begin
      select string_agg(format('%I = s.%I', column_name, column_name), ', ') into cols from information_schema.columns
       where table_schema = 'public' and table_name = 'work_orders' and is_generated = 'NEVER' and column_name <> 'id';
      set local session_replication_role = replica;
      execute 'update public.work_orders w set ' || cols || ' from _ro.wo s where w.id = s.id';
      delete from public.wo_assignments a where not exists (select 1 from _ro.asg s where s.id = a.id);
      delete from public.work_orders where description like 'R2NEW-%';
      delete from public.tech_activity_events e where e.at >= p_since and e.job_id in (select id from _ro.wo);
      if to_regclass('public.work_order_cost_entries') is not null then
        execute 'delete from public.work_order_cost_entry_events e using public.work_order_cost_entries c where e.entry_id = c.id and c.description like ''RO-%''';
        execute 'delete from public.work_order_cost_entries where description like ''RO-%''';
      end if;
      set local session_replication_role = origin;
    end $f$;`)
}
let SINCE
const reset = () => R.sql(`select _ro.reset('${SINCE}')`)

async function screenCheck(s, label) {
  const t = await R.bodyText(s.page)
  return { label, rawDbText: R.rawSql(t), blank: t.trim().length < 40, errorScreen: /Something went wrong|ERR-[A-Z0-9]{4,}/.test(t) }
}

async function viewJob(s, w) {
  const st = await R.openRoute(s.page, '/work-orders', s.log)
  if (st.accessDenied) return { opened: false }
  const dlg = await L3.openView(s, w)
  if (!dlg) return { listed: false }
  const text = ((await dlg.innerText().catch(() => '')) || '').replace(/\s+/g, ' ')
  const panel = dlg.locator('section[aria-label="Cost ledger"]')
  const out = { opened: true, dialogChars: text.length, rawDbText: R.rawSql(text),
    ledgerPanel: await panel.isVisible().catch(() => false),
    ledgerText: ((await panel.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').slice(0, 300),
    costLines: (text.match(/(Parts|Labour|Total)[^A-Za-z]{0,4}(Cost)?[^A-Za-z]{0,30}[\d,.]+/g) || []).slice(0, 6) }
  await L3.closeAll(s.page)
  return out
}

async function myJobs(s, w) {
  const st = await R.openRoute(s.page, '/my-jobs', s.log)
  const out = { opened: !st.accessDenied && st.url === '/my-jobs', url: st.url, heading: st.heading }
  if (!out.opened) return out
  await s.page.waitForTimeout(1500)
  const card = s.page.locator('article, li, section').filter({ hasText: w.no }).first()
  out.listed = await card.isVisible().catch(() => false)
  if (!out.listed) { out.text = (await R.bodyText(s.page)).slice(0, 300); return out }
  await card.locator('textarea').first().fill(`Rollout ${STATE}: tyre changed and torqued`).catch(() => {})
  const b = card.getByRole('button', { name: 'Submit work done' })
  out.offered = (await b.count()) > 0
  if (out.offered && !(await b.first().isDisabled())) { await b.first().click(); await s.page.waitForTimeout(2500) }
  out.message = ((await card.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').match(/(could not|not allowed|failed|submitted|Quality)[^.]*\.?/i)?.[0] || ''
  out.dbStatus = R.sql(`select status from public.work_orders where id = '${w.id}'`)
  out.event = R.sql(`select coalesce(event_type,'') from public.tech_activity_events where job_id = '${w.id}' and at >= '${SINCE}' order by at desc limit 1`)
  return out
}

async function runRole(username) {
  const res = { state: STATE, username, role: ROLES[username], steps: {} }
  reset()
  const general = W.wo('GENERAL'), parts = W.wo('PARTS'), approved = W.wo('APPROVED'), assigned = W.wo('ASSIGNED')
  const importedBefore = R.sql(`select string_agg(work_order_no || '=' || coalesce(parts_cost::text,'null'), ' ' order by work_order_no) from public.work_orders where id in ('${parts.id}', '${approved.id}', '${general.id}')`)
  const s = await R.session(username)
  try {
    const links = await R.sidebarLinks(s.page)
    res.steps.sidebar = { workOrders: links.some((l) => l.href === '/work-orders'), myJobs: links.some((l) => l.href === '/my-jobs'), liveControl: links.some((l) => l.href === '/workshop-live') }
    const st = await R.openRoute(s.page, '/work-orders', s.log)
    res.steps.open = { opened: !st.accessDenied && st.url === '/work-orders', heading: st.heading, ...(await screenCheck(s, 'work orders')) }
    if (res.steps.open.opened) {
      res.steps.viewGeneral = await viewJob(s, general)
      res.steps.viewParts = await viewJob(s, parts)
      await R.openRoute(s.page, '/work-orders', s.log)
      res.steps.editScope = await W.editCase(s, 'GENERAL', { field: 'Scope', value: `rollout ${STATE}`, column: 'scope' })
      res.steps.editNotes = await W.editCase(s, 'GENERAL', { field: 'Job Repair Description', value: `rollout ${STATE} note by ${username}`, column: 'notes' })
      res.steps.statusMove = await W.statusCase(s, 'GENERAL', 'Awaiting Assignment')
      // Cost: add on the job that carries an imported parts cost; the author must not be able to approve it.
      const desc = `RO-${STATE}-${username.replace(/\W/g, '')}`
      const safe = async (fn) => { try { return await fn() } catch (e) { await L3.closeAll(s.page); return { dbReadAfter: String(e.message).split('\n').find((l) => /ERROR/.test(l)) || 'error' } } }
      res.steps.addCost = await safe(() => L3.addCost(s, parts, desc, 20))
      res.steps.selfApprove = await safe(() => L3.decide(s, parts, desc, 'Approve'))
      const entry = has('public.work_order_cost_entries') ? R.sql(`select id from public.work_order_cost_entries where description = '${desc}'`) : ''
      const uid = R.sql(`select id from public.profiles where username = '${username}'`)
      res.steps.selfApproveDb = entry && hasFn('work_order_cost_decide') ? L3.dbAs(uid, `select public.work_order_cost_decide('${entry}', 'approved', 'self')`) : (entry ? 'no decide function' : 'no entry created')
      res.steps.entryStatusAfter = entry ? R.sql(`select status from public.work_order_cost_entries where id = '${entry}'`) : ''
    }
    res.steps.liveControl = await W.liveCase(s)
    res.steps.myJobs = await myJobs(s, assigned)
    res.steps.importedAfter = R.sql(`select string_agg(work_order_no || '=' || coalesce(parts_cost::text,'null'), ' ' order by work_order_no) from public.work_orders where id in ('${parts.id}', '${approved.id}', '${general.id}')`)
    res.steps.importedBefore = importedBefore
    res.steps.importedUnchanged = res.steps.importedAfter === importedBefore
    res.failedRequests = s.log.failed.filter((f) => !/user_view_prefs/.test(f)).slice(0, 20)
    res.pageErrors = s.log.pageErrors.slice(0, 10)
    res.alerts = s.alerts
    res.rawDbTextInAlerts = s.alerts.some((a) => R.rawSql(a))
  } catch (e) { res.error = String(e.message).slice(0, 600) }
  await s.context.close()
  reset()
  return res
}

if (require.main === module) (async () => {
  snapshot()
  SINCE = R.sql('select now()')
  const before = hashes()
  const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(ROLES)
  const all = []
  for (const n of names) { const r = await runRole(n); all.push(r); console.log(JSON.stringify(r)) }
  reset()
  const after = hashes()
  const out = { state: STATE, db: process.env.E2E_DB, drafts: { ledger: has('public.work_order_cost_entries'), resolver: hasFn('wo_user_can') || hasFn('work_order_user_can') }, before, after,
    unchanged: Object.keys(before).every((k) => before[k] === after[k]), roles: all }
  R.save(`rollout_${STATE}`, out)
  console.log('HASHES ' + JSON.stringify({ before, after, unchanged: out.unchanged }))
  await R.closeBrowser()
})()
