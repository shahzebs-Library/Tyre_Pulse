// Round 2: the two new panels (closure review, checklist faults) at a 390 px phone width, in English and Arabic.
// Reads only: no button that writes is pressed. Run after round2_closure.cjs (it uses whatever state that left).
const R = require('./round2_lib.cjs')
const RAW_KEY = /\b[a-z][a-zA-Z]+(\.[a-zA-Z_]+){2,}\b/

async function measure(page, selector) {
  return page.evaluate((sel) => {
    const vw = window.innerWidth
    const el = document.querySelector(sel)
    if (!el) return { found: false }
    el.scrollIntoView({ block: 'center' })
    const over = []
    for (const n of el.querySelectorAll('*')) {
      const r = n.getBoundingClientRect()
      if (r.width > 0 && (r.right > vw + 1 || r.left < -1)) over.push(`${n.tagName.toLowerCase()} "${(n.innerText || n.getAttribute('aria-label') || '').trim().slice(0, 30)}" left=${Math.round(r.left)} right=${Math.round(r.right)}`)
    }
    const small = [...el.querySelectorAll('button, a, select, summary')].filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height < 32 }).map((b) => `${(b.innerText || '').trim().slice(0, 30)} h=${Math.round(b.getBoundingClientRect().height)}`)
    const text = el.innerText.replace(/\s+/g, ' ')
    const latin = (text.match(/[A-Za-z]{3,}/g) || []).length, arabic = (text.match(/[؀-ۿ]{2,}/g) || []).length
    return { found: true, viewport: vw, pageScrollWidth: document.documentElement.scrollWidth, panelWidth: Math.round(el.getBoundingClientRect().width),
      overflowing: over.slice(0, 8), tapTargetsUnder32px: small.slice(0, 8), dir: getComputedStyle(el).direction, htmlDir: document.documentElement.dir,
      latinWords: latin, arabicWords: arabic, text: text.slice(0, 500) }
  }, selector)
}

async function run(username, lang, kind, target) {
  const s = await R.session(username)
  const p = s.page
  await p.evaluate((l) => localStorage.setItem('tp_language', l), lang)
  await p.setViewportSize({ width: 390, height: 844 })
  const out = { username, lang, kind }
  if (kind === 'action') {
    await R.openRoute(p, '/actions', s.log)
    const card = p.locator('article', { hasText: target }).first()
    out.cardListed = await card.isVisible().catch(() => false)
    if (out.cardListed) { await card.locator('button').filter({ hasText: /Edit|تعديل|تحرير/ }).first().click().catch(() => {}); await p.waitForTimeout(1500) }
    Object.assign(out, await measure(p, '[data-testid="closure-review-panel"]'))
  } else {
    await R.openRoute(p, `/checklists/submission/${target}`, s.log); await p.waitForTimeout(1500)
    Object.assign(out, await measure(p, '[data-testid="checklist-fault-panel"]'))
  }
  out.rawKey = out.text ? (out.text.match(RAW_KEY) || [null])[0] : null
  if (out.found && (out.overflowing.length || out.pageScrollWidth > out.viewport + 1)) {
    out.screenshot = `${R.SCRATCH}/r2_${kind}_${lang}_${username.replace(/\W/g, '_')}.png`
    await p.screenshot({ path: out.screenshot })
  }
  out.pageErrors = s.log.pageErrors
  await s.context.close()
  return out
}

;(async () => {
  const res = []
  const submitted = R.sql(`select title from public.corrective_actions where review_status = 'submitted' and country = 'KSA' and organisation_id = '00000000-0000-0000-0000-000000000001' limit 1`)
  const open = R.sql(`select title from public.corrective_actions where status <> 'Closed' and review_status is null and country = 'KSA' and organisation_id = '00000000-0000-0000-0000-000000000001' limit 1`)
  const pendingSheet = R.sql(`select id from public.checklist_submissions where approval_status in ('pending','pending_area_manager') and answers::text like '%Not OK%' and organisation_id = '00000000-0000-0000-0000-000000000001' limit 1`)
  const ackSheet = R.sql(`select id from public.checklist_submissions where approval_status = 'acknowledged' limit 1`)
  for (const lang of ['en', 'ar']) {
    if (submitted) res.push(await run('alpha.manager', lang, 'action', submitted))     // reviewer controls
    if (open) res.push(await run('alpha.manager', lang, 'action', open))               // worker controls + exception link
    if (pendingSheet) res.push(await run('alpha.admin', lang, 'sheet', pendingSheet))  // acknowledge controls
    if (ackSheet) res.push(await run('alpha.admin', lang, 'sheet', ackSheet))          // acknowledged state
  }
  R.save('responsive', res); console.log(JSON.stringify(res, null, 1))
  await R.closeBrowser()
})()
