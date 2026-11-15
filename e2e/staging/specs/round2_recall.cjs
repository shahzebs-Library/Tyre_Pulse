// Round 2: Recall Tracker create on a single country view and on the All view, then open /recalls/:id.
const R = require('./round2_lib.cjs')
const ALPHA = '00000000-0000-0000-0000-000000000001'

async function setCountry(page, country) {
  await page.evaluate((c) => {
    if (c === 'All') { localStorage.removeItem('tp_working_context'); localStorage.setItem('tp_active_country', 'All') }
    else { localStorage.setItem('tp_working_context', JSON.stringify({ country: c })); localStorage.setItem('tp_active_country', c) }
  }, country)
}

async function createRecall(s, { view, number, pick }) {
  const p = s.page
  const out = { view, number }
  await setCountry(p, view)
  const st = await R.openRoute(p, '/recall-tracker', s.log)
  out.heading = st.heading
  out.contextShown = ((await R.bodyText(p)).match(/All countries|\bKSA\b|\bUAE\b|\bEgypt\b/) || [''])[0]
  await p.getByRole('button', { name: 'Add recall' }).first().click(); await p.waitForTimeout(600)
  const dlg = p.locator('[role=dialog]').last()
  out.countryPreset = await dlg.locator('#rc-country').inputValue()
  out.countryOptions = await dlg.locator('#rc-country option').allInnerTexts()
  await dlg.locator('#rc-number').fill(number)
  await dlg.locator('#rc-brand').fill('SYNBRAND')
  await dlg.locator('#rc-date').fill('2026-11-01')
  await dlg.locator('#rc-size').fill('315/80R22.5'); await dlg.locator('#rc-size').press('Enter')
  await dlg.locator('#rc-desc').fill(`Synthetic recall ${number}`)
  const saveBtn = dlg.getByRole('button', { name: 'Save recall' })
  await saveBtn.click(); await p.waitForTimeout(1800)
  out.firstSave = { formOpen: await saveBtn.isVisible().catch(() => false),
    message: (await dlg.locator('[role=alert], .text-red-400, .text-red-300').allInnerTexts().catch(() => [])).filter((t) => t.trim() && t.trim() !== '*').join(' | ').slice(0, 300),
    db: R.sql(`select count(*) from public.recalls where recall_number = '${number}'`) }
  if (out.firstSave.formOpen && pick) {
    await dlg.locator('#rc-country').selectOption(pick)
    await saveBtn.click(); await p.waitForTimeout(1800)
    out.secondSave = { formOpen: await saveBtn.isVisible().catch(() => false),
      message: (await dlg.locator('[role=alert], .text-red-400, .text-red-300').allInnerTexts().catch(() => [])).filter((t) => t.trim() && t.trim() !== '*').join(' | ').slice(0, 300) }
  }
  out.dbRow = R.sql(`select row_to_json(t) from (select id, recall_number, country, organisation_id = '${ALPHA}' as alpha_company, status from public.recalls where recall_number = '${number}') t`)
  out.rawSqlShown = R.rawSql(out.firstSave.message) || R.rawSql(out.secondSave?.message)
  if (out.dbRow) {
    const id = JSON.parse(out.dbRow).id
    const listed = await p.getByText(number).first().isVisible().catch(() => false)
    out.listedAfterSave = listed
    const d = await R.openRoute(p, `/recalls/${id}`, s.log)
    out.detail = { url: d.url, heading: d.heading, showsNumber: d.text.includes(number), accessDenied: d.accessDenied, errorBoundary: d.errorBoundary, failed: d.failedRequests }
  }
  return out
}

;(async () => {
  R.fixtureSql(`delete from public.recalls where recall_number like 'R2RC-%'`)
  const res = { cases: [] }
  const s = await R.session('alpha.admin')
  try {
    res.cases.push(await createRecall(s, { view: 'KSA', number: 'R2RC-KSA-1' }))
    res.cases.push(await createRecall(s, { view: 'All', number: 'R2RC-ALL-1', pick: 'UAE' }))
    // Other company and a low role.
    res.failed = s.log.failed.filter((f) => !/user_view_prefs/.test(f)); res.pageErrors = s.log.pageErrors
  } catch (e) { res.error = String(e.message).slice(0, 500) }
  await s.context.close()
  const b = await R.session('beta.admin')
  const st = await R.openRoute(b.page, '/recall-tracker', b.log)
  res.otherCompany = { sees: /R2RC-/.test(st.text) }
  const id = R.sql(`select id from public.recalls where recall_number = 'R2RC-KSA-1'`)
  if (id) { const d = await R.openRoute(b.page, `/recalls/${id}`, b.log); res.otherCompany.detailShowsRecord = d.text.includes('R2RC-KSA-1'); res.otherCompany.detailText = d.text.replace(/\s+/g, ' ').slice(-200) }
  await b.context.close()
  const m = await R.session('alpha.manager')
  const ms = await R.openRoute(m.page, '/recall-tracker', m.log)
  res.manager = { accessDenied: ms.accessDenied }
  await m.context.close()
  R.save('recall', res); console.log(JSON.stringify(res, null, 1))
  await R.closeBrowser()
})()
