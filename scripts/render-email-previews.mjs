// Renders every email template in EN and AR to docs/notifications/previews/
// and screenshots each with headless Chromium. Sample data only.
// Run: node scripts/render-email-previews.mjs [--no-png]
import { mkdir, writeFile } from 'node:fs/promises'
import { renderEmail, TEMPLATE_KEYS } from '../supabase/functions/_shared/email/render.ts'

const OUT = new URL('../docs/notifications/previews/', import.meta.url)
const SAMPLE = {
  'accident.reported': { entityType: 'accident', entityId: 'sample', data: { reference_no: 'ACC-2026-0148', asset_no: 'TM514', site: 'NHC', severity: 'severe', stage: 'reported', incident_date: '2026-11-27T08:15:00Z', driver_name: 'Sample Driver', description: 'Rear-ended at the plant gate. No injuries.', action: 'Site manager to review' } },
  'accident.update': { entityType: 'accident', entityId: 'sample', data: { reference_no: 'ACC-2026-0148', asset_no: 'TM514', site: 'NHC', severity: 'severe', stage: 'workshop_assessment', incident_date: '2026-11-27T08:15:00Z', action: 'Workshop to assess damage' } },
  'accident.escalation': { entityType: 'accident', entityId: 'sample', data: { reference_no: 'ACC-2026-0148', asset_no: 'TM514', site: 'NHC', severity: 'severe', stage: 'repair_in_progress', reason: 'vor_sla_breach', action: 'Workshop manager to confirm release date' } },
  'assignment.new': { entityType: 'work_order', entityId: 'sample', data: { title: 'Job card GCKR/JC/1021 assigned to you', body: 'Replace the front left tyre on MP083 before the evening shift.', item_label: 'GCKR/JC/1021', site: 'DIRIYAH-G1', due_at: '2026-11-28T14:00:00Z' } },
  'reminder.escalation': { entityType: 'action_item', data: { person_name: 'Sample Technician', count: 3, items: ['Job card GCKR/JC/1021', 'Parts request PR-0412', 'Inspection approval TM514'] } },
  'user.signup_pending': { entityType: 'signup', data: { full_name: 'Sample Person', username: 'sample.person', role: 'Inspector', country: 'KSA', signed_up_at: '2026-11-28T06:10:00Z' } },
  'website.enquiry': { audience: 'owner', data: { name: 'Sample Buyer', company: 'Sample Logistics', email: 'buyer@example.com', phone: '+966 50 000 0000', fleet_size: '120', message: 'We run 120 mixers in Riyadh and want a demo on our own data.' } },
  'digest.daily': { entityType: 'digest', data: { total: 9, sections: [
    { key: 'missed_upload', count: 2, items: ['KSA job cards: no file since 26 Nov', 'UAE expenses: no file since 25 Nov'] },
    { key: 'maintenance_due', count: 4, items: ['TM514 engine service due in 2 days', 'GN103 oil change overdue by 1 day', 'BP041 inspection due today', 'MP083 brake check due tomorrow'] },
    { key: 'low_stock', count: 2, items: ['315/80R22.5 at NHC store: 3 left (min 10)', 'Engine oil 15W-40: 40 L left (min 200 L)'] },
    { key: 'workshop_delays', count: 1, items: ['TM673 waiting parts for 9 days'] },
  ] } },
  'accident.step_assigned': { entityType: 'accident', entityId: 'sample', data: { reference_no: 'ACC-2026-0148', asset_no: 'TM514', site: 'NHC', severity: 'moderate', stage: 'workshop_assessment', incident_date: '2026-11-27T08:15:00Z', steps: ['assessment', 'repair'] } },
  'workshop.waiting': { entityType: 'workshop_intake', data: { count: 3, assets: ['TM514', 'MP083', 'GN103'] } },
  'summary.daily': { entityType: 'digest', data: { summary_label: '27 Nov 2026', inspections_done: 18, accidents_reported: 1, workshop_in: 6, workshop_released: 4, tyres_attention: 41, approvals_waiting: null } },
  test: { data: {} },
}

const files = []
for (const key of TEMPLATE_KEYS) {
  for (const locale of ['en', 'ar']) {
    const s = SAMPLE[key] || { data: {} }
    const r = renderEmail({ template: key, locale, data: s.data, entityType: s.entityType, entityId: s.entityId, audience: s.audience || 'staff' })
    const name = `${key.replace(/\./g, '_')}.${locale}`
    await mkdir(OUT, { recursive: true })
    await writeFile(new URL(`${name}.html`, OUT), r.html)
    await writeFile(new URL(`${name}.txt`, OUT), `Subject: ${r.subject}\n\n${r.text}\n`)
    files.push(name)
  }
}
// The external view of an accident (insurer / accident mailbox): no driver, no description.
{
  const s = SAMPLE['accident.reported']
  const r = renderEmail({ template: 'accident.reported', locale: 'en', data: s.data, entityType: 'accident', entityId: 'sample', audience: 'external' })
  await writeFile(new URL('accident_reported.external.en.html', OUT), r.html)
  files.push('accident_reported.external.en')
}

if (!process.argv.includes('--no-png')) {
  const { chromium } = await import('playwright')
  // Use the installed Playwright browser when it matches, else CHROME_PATH or local Chrome.
  const fallback = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  const browser = await chromium.launch().catch(() => chromium.launch({ executablePath: fallback }))
  const page = await browser.newPage({ viewport: { width: 680, height: 900 }, deviceScaleFactor: 1 })
  for (const name of files) {
    await page.goto(new URL(`${name}.html`, OUT).href)
    await page.screenshot({ path: new URL(`${name}.png`, OUT).pathname, fullPage: true })
  }
  await browser.close()
}
console.log(`${files.length} previews in docs/notifications/previews/`)
