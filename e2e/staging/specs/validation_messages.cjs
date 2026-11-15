// Second pass for error handling: open the create form, submit it empty, and record exactly what text appears.
// Usage: node specs/validation_messages.cjs id,id,...   (merges into $E2E_RUN/results/<id>.json as steps.crud.validation.diff)
const fs = require('fs'); const path = require('path')
const L = require('../lib.cjs'); const mods = require('../modules.json')
const ids = process.argv[2].split(','); const OUT = path.join(process.env.E2E_RUN, 'results')
;(async () => {
  const s = await L.signIn('alpha.admin')
  for (const id of ids) {
    const m = mods.find((x) => x.id === id); const f = path.join(OUT, `${id}.json`); const R = JSON.parse(fs.readFileSync(f))
    try {
      await L.openRoute(s.page, m.route, s.log)
      const before = Number(L.sql(`select count(*) from public.${m.table}`))
      await s.page.locator('main').getByRole('button', { name: m.createButton }).first().click({ timeout: 6000 }); await s.page.waitForTimeout(700)
      const d = s.page.locator('[role=dialog]').last()
      const t0 = new Set((await d.innerText()).split('\n').map((x) => x.trim()).filter(Boolean))
      await d.locator('button[type=submit]').filter({ hasNotText: /^(Cancel|Close|Lookup)$/ }).last().click({ timeout: 5000 }); await s.page.waitForTimeout(1200)
      const open = await d.isVisible().catch(() => false)
      const t1 = open ? (await d.innerText()).split('\n').map((x) => x.trim()).filter(Boolean) : []
      const native = await s.page.evaluate(() => { const e = document.querySelector('[role=dialog] :invalid'); return e && e.tagName !== 'FORM' ? e.validationMessage : '' })
      const diff = t1.filter((x) => !t0.has(x)).slice(0, 6)
      if (native) diff.push('browser validation: ' + native)
      const after = Number(L.sql(`select count(*) from public.${m.table}`))
      R.steps.crud.validation.diff = { dialogStayedOpen: open, newText: diff, rowsCreated: after - before, rawSqlShown: diff.some((x) => L.RAW_SQL.test(x)) }
      await s.page.screenshot({ path: path.join(L.SCRATCH, `${id}_validation2.png`) })
      console.log(id, JSON.stringify(R.steps.crud.validation.diff))
    } catch (e) { R.steps.crud.validation.diff = { error: String(e.message).split('\n')[0].slice(0, 160) }; console.log(id, 'ERR', e.message.split('\n')[0]) }
    fs.writeFileSync(f, JSON.stringify(R, null, 1)); await s.page.keyboard.press('Escape')
  }
  await s.context.close(); await L.closeBrowser()
})()
