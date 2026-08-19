/**
 * The printed checklist is an EXCEPTION report.
 *
 * A 31-check machine used to produce three pages in which 28 rows said OK and
 * the three that mattered were buried. The sheet now prints only the lines that
 * are neither OK nor Not applicable - which keeps every reported fault AND every
 * completed action, because work that was carried out has to stay traceable.
 *
 * The tally is the load-bearing half: dropping the OK rows without saying how
 * many there were would leave a sheet that cannot show the other checks happened
 * at all. An unrecorded line is counted on its own, because rolling it into "OK"
 * would assert a check nobody made.
 */

import { describe, it, expect } from 'vitest'
import { isOk, isNotApplicable, needsAttention } from '../lib/checklistMonthly'
import { renderChecklistPdf } from '../lib/checklistPdf'

// The live legend, verbatim from the two published templates.
const LEGEND = ['OK', 'Not OK', 'Not applicable', 'Changed', 'Repaired', 'Added / Top-Up', 'Adjusted', 'Lubricated']

const TEMPLATE = {
  name: 'Workshop Daily Checklist',
  option_sets: { legend: { options: LEGEND } },
  fields: [
    { id: 'sec_id', type: 'section', label: 'Identification' },
    { id: 'f_date', type: 'date', label: 'Date' },
    { id: 'f_site', type: 'site', label: 'Location' },
    { id: 'sec_gen', type: 'section', label: 'I. Interior and exterior - general' },
    { id: 'g1', type: 'select', options_ref: 'legend', label: 'Glasses and mirrors' },
    { id: 'g2', type: 'select', options_ref: 'legend', label: 'Safety guards' },
    { id: 'g3', type: 'select', options_ref: 'legend', label: 'All lights and horn' },
    { id: 'g4', type: 'select', options_ref: 'legend', label: 'PTO shaft' },
    { id: 'sec_sign', type: 'section', label: 'Sign off' },
    { id: 'mech', type: 'text', label: 'Mechanic name' },
  ],
}

const base = {
  id: 'sub1', document_no: 'WDC-TM660-2026-0001', asset_no: 'TM660',
  site: 'DIRIYAH-G1', country: 'KSA', template_name: 'Workshop Daily Checklist',
  submitted_at: '2026-08-19T06:09:01Z',
}

/**
 * The strings the page actually carries. jsPDF writes uncompressed content here,
 * so the text operators can be read back - which is the only way to assert what
 * a reader sees rather than what the code intended.
 */
async function printed(submission) {
  const { doc } = await renderChecklistPdf({ submission, template: TEMPLATE, save: false })
  const raw = doc.output()
  return Array.from(raw.matchAll(/\((.*?)\)\s*Tj/g)).map((m) => m[1])
}
const joined = (lines) => lines.join('\n')

describe('answer classifiers', () => {
  it('splits the live legend into pass, not-applicable and needs-attention', () => {
    expect(LEGEND.filter(isOk)).toEqual(['OK'])
    expect(LEGEND.filter(isNotApplicable)).toEqual(['Not applicable'])
    expect(LEGEND.filter(needsAttention))
      .toEqual(['Not OK', 'Changed', 'Repaired', 'Added / Top-Up', 'Adjusted', 'Lubricated'])
  })

  it('a completed action is an exception, not a pass', () => {
    // Repaired means somebody did work. Hiding it with the OK rows loses the
    // record of that work, which is the opposite of what this sheet is for.
    expect(needsAttention('Repaired')).toBe(true)
    expect(needsAttention('Lubricated')).toBe(true)
  })

  it('an unanswered line is neither a finding nor a pass', () => {
    expect(needsAttention('')).toBe(false)
    expect(needsAttention(null)).toBe(false)
    expect(isOk('')).toBe(false)
  })
})

describe('the printed sheet', () => {
  it('prints the exceptions and leaves the OK lines out', async () => {
    const lines = await printed({
      ...base,
      answers: { f_date: '2026-08-19', f_site: 'DIRIYAH-G1', g1: 'OK', g2: 'Not OK', g3: 'Repaired', g4: 'Not applicable', mech: 'ALI' },
      notes: { g2: 'Broken' },
    })
    const text = joined(lines)
    expect(text).toContain('Safety guards')      // Not OK
    expect(text).toContain('Broken')             // its remark
    expect(text).toContain('All lights and horn')// Repaired
    expect(text).not.toContain('Glasses and mirrors') // OK, omitted
    expect(text).not.toContain('PTO shaft')           // Not applicable, omitted
  })

  it('states how many lines it left out, so the omission is not silent', async () => {
    const text = joined(await printed({
      ...base,
      answers: { f_date: '2026-08-19', g1: 'OK', g2: 'Not OK', g3: 'Repaired', g4: 'Not applicable' },
    }))
    expect(text).toContain('4 checks on this sheet: 1 OK, 1 not applicable, 2 needing attention.')
  })

  it('counts an unrecorded line separately, never as OK', async () => {
    const text = joined(await printed({
      ...base,
      answers: { f_date: '2026-08-19', g1: 'OK', g2: 'Not OK' },
    }))
    expect(text).toContain('2 not recorded')
    expect(text).toContain('1 OK')
  })

  it('says so plainly when nothing needed attention, and prints no table', async () => {
    const text = joined(await printed({
      ...base,
      answers: { f_date: '2026-08-19', g1: 'OK', g2: 'OK', g3: 'OK', g4: 'OK' },
    }))
    expect(text).toContain('Nothing needed attention')
    expect(text).toContain('4 checks on this sheet: 4 OK.')
    expect(text).not.toContain('Items needing attention')
  })

  it('drops the section headings and the status legend', async () => {
    const text = joined(await printed({
      ...base,
      answers: { f_date: '2026-08-19', g2: 'Not OK' },
    }))
    expect(text).not.toContain('Interior and exterior')
    expect(text).not.toContain('Status legend')
  })
})

describe('identification', () => {
  it('does not print the site twice under two labels', async () => {
    const lines = await printed({
      ...base,
      answers: { f_date: '2026-08-19', f_site: 'DIRIYAH-G1', g1: 'OK' },
    })
    expect(lines.filter((l) => l === 'DIRIYAH-G1')).toHaveLength(1)
    expect(lines).not.toContain('Site')
  })

  it('still prints the row site when the sheet did not ask for one', async () => {
    const lines = await printed({ ...base, answers: { f_date: '2026-08-19', g1: 'OK' } })
    expect(lines).toContain('Site')
    expect(lines).toContain('DIRIYAH-G1')
  })

  it('keeps the sign-off names out of identification, beside their signatures instead', async () => {
    const lines = await printed({
      ...base,
      answers: { f_date: '2026-08-19', f_site: 'DIRIYAH-G1', g1: 'OK', mech: 'ALI' },
    })
    const idIdx = lines.indexOf('Identification')
    const signIdx = lines.indexOf('Sign off')
    const mechIdx = lines.indexOf('Mechanic name')
    expect(signIdx).toBeGreaterThan(idIdx)
    // The name sits under Sign off, not under Identification.
    expect(mechIdx).toBeGreaterThan(signIdx)
    expect(lines.indexOf('Signatures')).toBeGreaterThan(mechIdx)
  })
})
