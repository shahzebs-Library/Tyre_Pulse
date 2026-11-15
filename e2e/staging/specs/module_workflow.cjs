// Browser workflow test for the 31 R1 modules. Real sign-in, real pages, real PostgREST, local database copy.
// Usage: node specs/module_workflow.cjs [module_id,module_id...]   (results: $E2E_RUN/results/<id>.json)
const fs = require('fs'); const path = require('path')
const L = require('../lib.cjs'); const mods = require('../modules.json')
const only = process.argv[2] ? process.argv[2].split(',') : null
const OUT = path.join(process.env.E2E_RUN, 'results'); fs.mkdirSync(OUT, { recursive: true })
const ALPHA = '00000000-0000-0000-0000-000000000001'
const brief = (st) => ({ url: st.url, heading: st.heading, errorBoundary: st.errorBoundary, accessDenied: st.accessDenied, moduleUnavailable: st.moduleUnavailable,
  consoleErrors: st.consoleErrors, failedRequests: st.failedRequests, pageErrors: st.pageErrors })
const cnt = (table, mark) => table ? Number(L.sql(`select count(*) from public.${table} t where organisation_id='${ALPHA}'` + (mark ? ` and row_to_json(t)::text like '%${mark}%'` : ''))) : null
const otherOrg = (table, mark) => table ? Number(L.sql(`select count(*) from public.${table} t where organisation_id<>'${ALPHA}' and row_to_json(t)::text like '%${mark}%'`)) : null

async function clickTab(page, name) {
  for (const loc of [page.locator('main').getByRole('tab', { name }), page.locator('main').getByRole('button', { name }), page.locator('main').getByText(name, { exact: false })]) {
    if (await loc.first().isVisible().catch(() => false)) { await loc.first().click({ timeout: 4000 }); await page.waitForTimeout(900); return true }
  }
  return false
}
async function scope(page) {
  const d = page.locator('[role=dialog]').last()
  if (await d.count() && await d.isVisible().catch(() => false)) return d
  return page.locator('main')
}
async function submitBtn(sc, m) {
  if (m.submit) return sc.getByRole('button', { name: m.submit }).last()
  return sc.locator('button[type=submit]').filter({ hasNotText: /^(Cancel|Close|Lookup|Skip tour|Next)$/ }).last()
}
async function messages(page) {
  return page.evaluate(() => {
    const out = new Set()
    document.querySelectorAll('[role=alert],[role=status],[aria-live],.text-red-400,.text-red-500,.text-red-600,.text-rose-400,.text-amber-400,[class*=error],[class*=toast]').forEach((e) => {
      const t = (e.innerText || '').trim().replace(/\s+/g, ' '); if (t && t.length < 300 && e.offsetParent) out.add(t) })
    const inv = document.querySelector('[role=dialog] :invalid, form :invalid')
    if (inv && inv.validationMessage) out.add('browser validation: ' + inv.validationMessage)
    return [...out].slice(0, 8)
  })
}
async function fill(sc, mark, upd, m = {}) {
  const ctrls = sc.locator('input:visible, select:visible, textarea:visible')
  const n = await ctrls.count(); let dt = 0, tm = 0; const filled = []
  for (let i = 0; i < n; i++) {
    const c = ctrls.nth(i)
    const info = await c.evaluate((e) => {
      let t = e.getAttribute('aria-label') || ''
      if (!t && e.id) { const l = document.querySelector(`label[for="${CSS.escape(e.id)}"]`); if (l) t = l.innerText }
      if (!t) { const l = e.closest('label'); if (l) t = l.innerText }
      if (!t) { let p = e.parentElement; for (let k = 0; k < 3 && p && !t; k++, p = p.parentElement) { const l = p.querySelector('label'); if (l && !l.contains(e)) t = l.innerText } }
      return { tag: e.tagName, type: e.type, label: (t || e.placeholder || '').trim().replace(/\s+/g, ' ').slice(0, 40), disabled: e.disabled || e.readOnly, value: e.value,
        opts: e.tagName === 'SELECT' ? [...e.options].map((o) => o.value) : null, inMain: !!e.closest('[role=dialog]') || !!e.closest('form') }
    }).catch(() => null)
    if (!info || info.disabled || !info.inMain) continue
    const lab = info.label.toLowerCase(); let v = null
    try {
      if (info.tag === 'SELECT') { if (!info.value) { const o = info.opts.find((x) => x); if (o) { await c.selectOption(o); v = o } } }
      else if (['checkbox', 'radio', 'file', 'search', 'hidden'].includes(info.type)) continue
      else if (info.type === 'number') v = /health|score|%/.test(lab) ? '80' : '5'
      else if (info.type === 'date') { const d = new Date(Date.now() + (/expiry|next|due|needed|end|return|renewal/.test(lab) ? 30 : 0) * 864e5); v = d.toISOString().slice(0, 10) }
      else if (info.type === 'datetime-local') { const d = new Date(Date.now() + (dt++) * 3600e3); v = d.toISOString().slice(0, 16) }
      else if (info.type === 'time') v = tm++ ? '17:00' : '08:00'
      else if (info.type === 'text' || info.type === 'textarea' || info.tag === 'TEXTAREA') {
        if (/rfr number/.test(lab)) continue
        const ovk = Object.keys(m.values || {}).find((k) => new RegExp(k).test(lab))
        if (ovk) v = m.values[ovk]
        else
        if (/asset|vehicle|prime mover|trailer|fleet no/.test(lab) && !/count/.test(lab)) v = /trailer/.test(lab) ? 'TM004' : 'TM001'
        else if (/serial/.test(lab) && !/prefix/.test(lab)) v = 'SYN-ALP-00001'
        else if (/site|location|depot/.test(lab)) v = 'ALPHA NORTH PLANT'
        else if (/currency/.test(lab)) v = 'SAR'
        else if (/url/.test(lab)) v = 'https://example.invalid/doc'
        else if (/size/.test(lab)) v = '315/80R22.5'
        else if (/prefix/.test(lab)) v = 'SYNA'
        else if (/odometer|hour meter|km/.test(lab)) v = '1000'
        else v = `${mark} ${info.label.replace(/[^A-Za-z ]/g, '').trim().slice(0, 14)}`.trim()
      }
      if (upd) continue
      if (v !== null && info.tag !== 'SELECT') { await c.fill(String(v)); if (/affected sizes|task checklist/.test(lab)) await c.press('Enter') }
      if (v !== null) filled.push(`${info.label}=${v}`)
    } catch (e) { filled.push(`${info.label}: FILL ERROR ${String(e.message).slice(0, 60)}`) }
  }
  return filled
}

async function runModule(m, S) {
  const R = { id: m.id, name: m.name, route: m.route, routeRoles: m.roles, table: m.table, startedAt: new Date().toISOString(), steps: {} }
  const mark = 'E2E' + Math.random().toString(36).slice(2, 7).toUpperCase()
  R.marker = mark
  const managerAllowed = m.roles.length === 0 || m.roles.includes('Manager')
  // 1. open as Alpha Manager
  R.steps.open_manager = brief(await L.openRoute(S['alpha.manager'].page, m.route, S['alpha.manager'].log))
  // 3. role access
  R.steps.open_tyreman = brief(await L.openRoute(S['alpha.tyreman'].page, m.route, S['alpha.tyreman'].log))
  const actorName = managerAllowed ? 'alpha.manager' : 'alpha.admin'
  const A = S[actorName]; R.actor = actorName
  const stAdmin = await L.openRoute(S['alpha.admin'].page, m.route, S['alpha.admin'].log)
  R.steps.open_admin = brief(stAdmin)
  R.emptyStateText = (managerAllowed ? null : stAdmin.text.replace(/\s+/g, ' ').slice(-500))
  // 2 + 5. create / validation / update
  const C = R.steps.crud = { attempted: false }
  if (m.createButton || m.submit) {
    C.attempted = true
    try {
      const page = A.page; const st0 = await L.openRoute(page, m.route, A.log)
      if (managerAllowed) R.emptyStateText = st0.text.replace(/\s+/g, ' ').slice(-500)
      const before = cnt(m.table)
      const open = async () => { if (m.createButton) { await page.locator('main').getByRole('button', { name: m.createButton }).first().click({ timeout: 6000 }); await page.waitForTimeout(700) } }
      await open()
      let sc = await scope(page)
      // validation: submit the empty form
      const f0 = A.log.failed.length
      await (await submitBtn(sc, m)).click({ timeout: 5000 }); await page.waitForTimeout(1200)
      const vmsg = await messages(page)
      const afterEmpty = cnt(m.table)
      C.validation = { messages: vmsg, rowsCreatedByEmptySubmit: afterEmpty - before, failedRequests: A.log.failed.slice(f0), rawSqlShown: vmsg.some((t) => L.RAW_SQL.test(t)) }
      await page.screenshot({ path: path.join(L.SCRATCH, `${m.id}_validation.png`) })
      sc = await scope(page)
      if (!(await (await submitBtn(sc, m)).isVisible().catch(() => false))) { await open(); sc = await scope(page) }
      // create
      C.filled = await fill(sc, mark, false, m)
      for (const b of m.postFillClicks || []) { await sc.getByRole('button', { name: b, exact: true }).first().click({ timeout: 4000 }).catch((e) => C.filled.push(`click ${b}: ${String(e.message).split('\n')[0].slice(0, 80)}`)); await page.waitForTimeout(1200) }
      const f1 = A.log.failed.length
      await (await submitBtn(sc, m)).click({ timeout: 5000 }); await page.waitForTimeout(2000)
      C.createMessages = await messages(page)
      C.createFailedRequests = A.log.failed.slice(f1)
      C.dbRowsWithMarker = cnt(m.table, mark)
      C.dbRowsOtherOrg = otherOrg(m.table, mark)
      C.created = C.dbRowsWithMarker > 0
      await page.screenshot({ path: path.join(L.SCRATCH, `${m.id}_after_create.png`) })
      // persistence after reload
      const st1 = await L.openRoute(page, m.route, A.log)
      C.visibleAfterReload = st1.text.includes(mark)
      if (!C.visibleAfterReload && m.tab) { await clickTab(page, m.tab); C.visibleAfterReload = ((await page.locator('body').innerText()) || '').includes(mark) }
      if (!C.visibleAfterReload && C.created && m.probeColumn) { const pv = L.sql(`select ${m.probeColumn} from public.${m.table} t where row_to_json(t)::text like '%${mark}%' limit 1`); C.visibleProbe = pv; C.visibleAfterReload = !!pv && st1.text.includes(pv) }
      const rowKey = C.visibleProbe || mark
      await page.screenshot({ path: path.join(C.created ? L.EVIDENCE : L.SCRATCH, `${m.id}.png`) })
      // update
      if (C.created && C.visibleAfterReload) {
        const U = C.update = {}
        try {
          if (m.tab) U.tabOpened = await clickTab(page, m.tab)
          const row = page.locator('tr, [role=row], li, article, .card').filter({ hasText: rowKey }).last()
          if (m.updateClick) {
            U.kind = `workflow action: ${m.updateClick}`
            U.statusBefore = L.sql(`select status from public.${m.table} t where row_to_json(t)::text like '%${mark}%' limit 1`)
            const f3 = A.log.failed.length
            const inRow = row.getByRole('button', { name: m.updateClick }).first()
            if (await inRow.count()) await inRow.click({ timeout: 4000 })
            else { await row.click({ timeout: 4000 }); await page.waitForTimeout(800); await page.locator('[role=dialog]').last().getByRole('button', { name: m.updateClick }).first().click({ timeout: 4000 }) }
            await page.waitForTimeout(1000)
            const d = page.locator('[role=dialog]').last()
            if (await d.count() && await d.isVisible().catch(() => false) && await d.locator('input:visible, textarea:visible, select:visible').count()) { U.dialogFilled = await fill(d, mark, false, m); await d.locator('button[type=submit]:visible, button:visible').filter({ hasText: /^(save|deploy|confirm|approve|record)/i }).last().click({ timeout: 4000 }); await page.waitForTimeout(1500) }
            U.messages = await messages(page); U.failedRequests = A.log.failed.slice(f3)
            U.statusAfter = L.sql(`select status from public.${m.table} t where row_to_json(t)::text like '%${mark}%' limit 1`)
            U.updated = !!U.statusAfter && U.statusAfter !== U.statusBefore
            throw { message: '__done__' }
          }
          const edit = row.getByRole('button', { name: /edit|update|open|view|manage/i }).first()
          if (await edit.count()) await edit.click({ timeout: 4000 }); else await row.click({ timeout: 4000 })
          await page.waitForTimeout(900)
          let sc2 = await scope(page)
          const eb = sc2.getByRole('button', { name: /^edit/i }).first()
          if (await eb.count() && await eb.isVisible().catch(() => false)) { await eb.click(); await page.waitForTimeout(700); sc2 = await scope(page) }
          const ta = sc2.locator('textarea:visible, input[type=text]:visible').last()
          const mark2 = mark + 'UPD'
          await ta.fill(`${mark2} edited`, { timeout: 4000 })
          const f2 = A.log.failed.length
          await sc2.locator('button[type=submit]:visible, button:visible').filter({ hasText: /^(save|update|record)/i }).last().click({ timeout: 4000 })
          await page.waitForTimeout(1800)
          U.messages = await messages(page); U.failedRequests = A.log.failed.slice(f2)
          U.dbRowsWithUpdateMarker = cnt(m.table, mark2); U.updated = U.dbRowsWithUpdateMarker > 0
          if (U.updated) { const st2 = await L.openRoute(page, m.route, A.log); U.visibleAfterReload = st2.text.includes(mark2) }
        } catch (e) { if (e.message !== '__done__') { U.error = String(e.message).split('\n')[0].slice(0, 200); U.updated = false } }
        await page.keyboard.press('Escape').catch(() => {})
      }
    } catch (e) { C.error = String(e.message).split('\n')[0].slice(0, 240); await A.page.screenshot({ path: path.join(L.SCRATCH, `${m.id}_error.png`) }).catch(() => {}) }
    await A.page.keyboard.press('Escape').catch(() => {})
  } else { C.note = 'no create action on this page (read-only report)' ; await S['alpha.admin'].page.screenshot({ path: path.join(L.EVIDENCE, `${m.id}.png`) }) }
  // 4. tenant
  const bName = managerAllowed ? 'beta.manager' : 'beta.admin'
  const stB = await L.openRoute(S[bName].page, m.route, S[bName].log)
  R.steps.tenant_beta = { user: bName, ...brief(stB), seesAlphaMarker: stB.text.includes(mark) }
  const stG = await L.openRoute(S['gamma.admin'].page, m.route, S['gamma.admin'].log)
  R.steps.tenant_gamma = { ...brief(stG), seesAlphaMarker: stG.text.includes(mark), tail: stG.text.replace(/\s+/g, ' ').slice(-400) }
  await S['gamma.admin'].page.screenshot({ path: path.join(L.SCRATCH, `${m.id}_gamma.png`) })
  if (m.table) R.gammaRowsInDb = Number(L.sql(`select count(*) from public.${m.table} where organisation_id='cccccccc-0000-4000-8000-000000000003'`))
  fs.writeFileSync(path.join(OUT, `${m.id}.json`), JSON.stringify(R, null, 1))
  console.log(`${m.id}: mgr=${R.steps.open_manager.accessDenied ? 'restricted' : 'open'} tyreman=${R.steps.open_tyreman.accessDenied ? 'restricted' : 'OPEN'} created=${C.created} reload=${C.visibleAfterReload} updated=${C.update?.updated} err=${C.error || C.update?.error || ''} beta=${R.steps.tenant_beta.seesAlphaMarker} gamma=${R.steps.tenant_gamma.seesAlphaMarker}`)
}
;(async () => {
  const S = {}
  for (const u of ['alpha.manager', 'alpha.admin', 'alpha.tyreman', 'beta.manager', 'beta.admin', 'gamma.admin']) S[u] = await L.signIn(u)
  for (const m of mods) { if (only && !only.includes(m.id)) continue
    try { await runModule(m, S) } catch (e) { console.log(`${m.id}: HARNESS ERROR ${String(e.message).split('\n')[0]}`) } }
  for (const s of Object.values(S)) await s.context.close()
  await L.closeBrowser()
})().catch((e) => { console.error(e); process.exit(1) })
