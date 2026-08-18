import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  MARK_ICONS, markMeta, blockingMarks, noteRequiredMarks, fieldOptionSet,
  blockingAnswers, missingNotes, unsatisfiedGroups, canClose,
  resolveAutoFill, isFieldLocked, autoFillAnswers, recurrenceNotice,
  AUTO_FILL_SOURCES,
} from '../lib/checklist/checklistMarks'

// The legend exactly as V595 wrote it to the live database.
const LEGEND = {
  options: ['OK', 'Not OK', 'Not applicable', 'Changed', 'Repaired', 'Added / Top-Up', 'Adjusted', 'Lubricated'],
  meta: [
    { value: 'OK', icon: 'ok', tone: 'good', meaning: 'Checked and correct. Nothing needed.' },
    { value: 'Not OK', icon: 'fault', tone: 'bad', meaning: 'A fault is present and has NOT been put right. Say what is wrong.' },
    { value: 'Not applicable', icon: 'na', tone: 'muted', meaning: 'This machine does not have this item.' },
    { value: 'Changed', icon: 'swap', tone: 'fixed', meaning: 'The part was replaced.' },
    { value: 'Repaired', icon: 'repair', tone: 'fixed', meaning: 'The fault was found and repaired.' },
    { value: 'Added / Top-Up', icon: 'topup', tone: 'fixed', meaning: 'Fluid or consumable was topped up.' },
    { value: 'Adjusted', icon: 'adjust', tone: 'fixed', meaning: 'Set back within limits without replacing anything.' },
    { value: 'Lubricated', icon: 'lubricant', tone: 'fixed', meaning: 'Greased or oiled as part of the check.' },
  ],
  blocking: ['Not OK'],
  require_note: ['Not OK'],
}

const TEMPLATE = {
  option_sets: { legend: LEGEND },
  fields: [
    { id: 's1', type: 'section', label: 'Identification' },
    { id: 'f_ws_date', type: 'date', label: 'Date', locked: true, autoValue: 'today' },
    { id: 'f_ws_asset', type: 'asset', label: 'Asset / GCC code', required: true },
    { id: 'f_ws_site', type: 'site', label: 'Location', autoFrom: 'asset.site', readOnly: true },
    { id: 'f_ws_reg', type: 'text', label: 'Registration / fleet No', autoFrom: 'asset.fleet_no', readOnly: true },
    { id: 'f_ws_chassis', type: 'text', label: 'Chassis / serial No', autoFrom: 'asset.chassis_no' },
    { id: 'f_ws_km', type: 'number', label: 'Km reading', group_require_one: 'meter' },
    { id: 'f_ws_hr', type: 'number', label: 'Hour meter reading', group_require_one: 'meter' },
    { id: 'c1', type: 'select', label: 'Glasses and mirrors', options_ref: 'legend', require_note_when: ['Not OK'] },
    { id: 'c2', type: 'select', label: 'Tyres and wheel bolts', options_ref: 'legend', require_note_when: ['Not OK'] },
  ],
}

describe('what a mark means', () => {
  it('every mark the live legend declares maps to a real icon', () => {
    for (const m of LEGEND.meta) expect(MARK_ICONS[m.icon]).toBeTruthy()
  })

  it('carries the meaning through, because a mark nobody can explain gets picked at random', () => {
    expect(markMeta(LEGEND, 'Adjusted').meaning).toMatch(/without replacing/)
    expect(markMeta(LEGEND, 'Not OK').tone).toBe('bad')
  })

  it('an answer recorded before the meta existed still renders', () => {
    // The six original marks were stored for months with no meta at all. A row
    // carrying an unknown value must degrade, never crash the line it sits on.
    const r = markMeta({ options: ['OK'] }, 'OK')
    expect(r.known).toBe(false)
    expect(MARK_ICONS[r.icon]).toBeTruthy()
    expect(r.meaning).toBe('')
  })

  it('a legend with no blocking list blocks nothing', () => {
    expect(blockingMarks({ options: ['a'] })).toEqual([])
    expect(noteRequiredMarks({ options: ['a'] })).toEqual([])
    expect(blockingMarks(LEGEND)).toEqual(['Not OK'])
  })

  it('resolves the shared option set, falling back to the field own copy', () => {
    expect(fieldOptionSet(TEMPLATE, TEMPLATE.fields[8])).toBe(LEGEND)
    expect(fieldOptionSet(TEMPLATE, { id: 'x', options: ['Yes', 'No'] })).toEqual({ options: ['Yes', 'No'] })
    expect(fieldOptionSet(TEMPLATE, { id: 'x' })).toBeNull()
  })
})

describe('nobody closes a sheet that still has a fault on it', () => {
  it('names the lines that block, not just that something does', () => {
    const b = blockingAnswers(TEMPLATE, { c1: 'Not OK', c2: 'OK' })
    expect(b).toEqual([{ id: 'c1', label: 'Glasses and mirrors', value: 'Not OK' }])
    expect(canClose(TEMPLATE, { c1: 'Not OK' }).ok).toBe(false)
  })

  it('a corrected item stops blocking', () => {
    expect(canClose(TEMPLATE, { c1: 'Repaired', c2: 'Adjusted' }).ok).toBe(true)
    expect(canClose(TEMPLATE, { c1: 'Lubricated' }).ok).toBe(true)
  })

  it('an unanswered sheet does not block on emptiness', () => {
    // Missing answers are a REQUIRED-fields problem, a different message. This
    // function only reports faults that were recorded and left uncorrected.
    expect(canClose(TEMPLATE, {}).ok).toBe(true)
  })

  it('mirrors what the database will do, so the refusal is explained before signing', () => {
    // guard_checklist_approval_stages refuses the same set. If these two ever
    // disagree the user signs, then gets a raw 22023 they cannot act on.
    const blocking = new Set(blockingMarks(LEGEND))
    const answers = { c1: 'Not OK', c2: 'Repaired' }
    const dbWouldRefuse = Object.values(answers).some((v) => blocking.has(v))
    expect(dbWouldRefuse).toBe(canClose(TEMPLATE, answers).ok === false)
  })
})

describe('a fault must say what is wrong', () => {
  it('demands a remark on Not OK and on nothing else', () => {
    expect(missingNotes(TEMPLATE, { c1: 'Not OK' }, {}).map((x) => x.id)).toEqual(['c1'])
    expect(missingNotes(TEMPLATE, { c1: 'Not OK' }, { c1: 'Wiper motor seized' })).toEqual([])
    expect(missingNotes(TEMPLATE, { c1: 'OK' }, {})).toEqual([])
  })

  it('whitespace is not a remark', () => {
    expect(missingNotes(TEMPLATE, { c1: 'Not OK' }, { c1: '   ' }).map((x) => x.id)).toEqual(['c1'])
  })
})

describe('km and hour meter', () => {
  it('accepts either reading but not neither', () => {
    // 98 of 227 KSA transit mixers carry NO odometer while every one has engine
    // hours. Requiring km would make the sheet unfillable for them; requiring
    // neither loses the reading the owner asked for.
    expect(unsatisfiedGroups(TEMPLATE, { f_ws_km: 120345 })).toEqual([])
    expect(unsatisfiedGroups(TEMPLATE, { f_ws_hr: 8100 })).toEqual([])
    const missing = unsatisfiedGroups(TEMPLATE, {})
    expect(missing).toHaveLength(1)
    expect(missing[0].fields.map((f) => f.id)).toEqual(['f_ws_km', 'f_ws_hr'])
  })

  it('a blank string is not a reading', () => {
    expect(unsatisfiedGroups(TEMPLATE, { f_ws_km: '  ' })).toHaveLength(1)
  })

  it('zero IS a reading', () => {
    // A brand-new machine genuinely reads 0. Number(0) is falsy, which is how a
    // real reading gets silently treated as missing.
    expect(unsatisfiedGroups(TEMPLATE, { f_ws_hr: 0 })).toEqual([])
  })
})

describe('auto-fill from the asset', () => {
  const asset = {
    site: 'NHC', fleet_number: 'FL-4412', registration_no: '8448 GXA',
    chassis_no: 'JTEB123456', current_km: 120345, vehicle_type: 'TR-MIXER',
  }

  it('registration takes the FLEET number, which is the owner rule', () => {
    expect(resolveAutoFill({ autoFrom: 'asset.fleet_no' }, asset)).toBe('FL-4412')
    // ...and falls back to the plate when the register carries only that.
    expect(resolveAutoFill({ autoFrom: 'asset.fleet_no' }, { registration_no: '8448 GXA' })).toBe('8448 GXA')
  })

  it('an unknown source resolves to nothing rather than to a guess', () => {
    expect(resolveAutoFill({ autoFrom: 'asset.invented' }, asset)).toBe('')
    expect(Object.keys(AUTO_FILL_SOURCES)).toContain('asset.site')
  })

  it('READ-ONLY IS CONDITIONAL - this is the part that matters', () => {
    // fleet_number is populated on 398 of 1,030 KSA assets and on NONE of the
    // 452 UAE or 135 Egypt ones. A field that is read-only whatever the register
    // holds would be permanently blank AND unfillable for most of the fleet.
    const field = { autoFrom: 'asset.fleet_no', readOnly: true }
    expect(isFieldLocked(field, 'FL-4412')).toBe(true)
    expect(isFieldLocked(field, '')).toBe(false)
    expect(isFieldLocked(field, '   ')).toBe(false)
    // A field marked locked outright (the date) is always locked.
    expect(isFieldLocked({ locked: true }, '')).toBe(true)
  })

  it('never overwrites something the user typed into an editable field', () => {
    const patch = autoFillAnswers(TEMPLATE, asset, { f_ws_chassis: 'typed by hand' })
    expect(patch.f_ws_chassis).toBeUndefined()
    expect(patch.f_ws_site).toBe('NHC')
  })

  it('a read-only field DOES take the register value, because that is its source', () => {
    const patch = autoFillAnswers(TEMPLATE, asset, { f_ws_site: 'stale' })
    expect(patch.f_ws_site).toBe('NHC')
  })

  it('an asset the register knows nothing about fills nothing, silently', () => {
    expect(autoFillAnswers(TEMPLATE, { site: '' }, {})).toEqual({})
    expect(autoFillAnswers(TEMPLATE, null, {})).toEqual({})
  })
})

describe('the 10-day rule', () => {
  const min = 10
  it('warns when the machine came back early', () => {
    const n = recurrenceNotice({ found: true, days_ago: 3, document_no: 'WDC-TM514-2026-0001' }, min)
    expect(n).toMatchObject({ early: true, daysAgo: 3, dueInDays: 7, documentNo: 'WDC-TM514-2026-0001' })
  })

  it('says nothing when it is due, or when we could not look', () => {
    expect(recurrenceNotice({ found: true, days_ago: 10 }, min)).toBeNull()
    expect(recurrenceNotice({ found: false }, min)).toBeNull()
    // Offline: no answer at all is NOT the same as "it is not due".
    expect(recurrenceNotice(null, min)).toBeNull()
  })

  it('a template with no interval never warns', () => {
    expect(recurrenceNotice({ found: true, days_ago: 1 }, null)).toBeNull()
    expect(recurrenceNotice({ found: true, days_ago: 1 }, 0)).toBeNull()
  })
})

describe('a hidden line must not demand the impossible, but must still block', () => {
  // A conditional sheet - the Predictive Maintenance template already uses
  // visibleWhen on 197 fields, so this is not hypothetical.
  const COND = {
    option_sets: { legend: LEGEND },
    fields: [
      { id: 'interval', type: 'select', label: 'Interval', options: ['250h', '500h'] },
      { id: 'c500', type: 'select', label: '500h only check', options_ref: 'legend',
        require_note_when: ['Not OK'], visibleWhen: { field: 'interval', op: '=', value: '500h' } },
      { id: 'km500', type: 'number', label: 'Km', group_require_one: 'meter',
        visibleWhen: { field: 'interval', op: '=', value: '500h' } },
    ],
  }

  it('does not demand a remark on a line the operator cannot see', () => {
    // The stale 'Not OK' is left over from when 500h was selected. Demanding a
    // remark for it now is a demand nobody can satisfy: the row is not on screen.
    const answers = { interval: '250h', c500: 'Not OK' }
    expect(missingNotes(COND, answers, {})).toEqual([])
    // ...and it IS demanded once the line is visible again.
    expect(missingNotes(COND, { interval: '500h', c500: 'Not OK' }, {}).map((x) => x.id)).toEqual(['c500'])
  })

  it('does not demand a meter reading from a hidden group', () => {
    expect(unsatisfiedGroups(COND, { interval: '250h' })).toEqual([])
    expect(unsatisfiedGroups(COND, { interval: '500h' })).toHaveLength(1)
  })

  it('BUT a hidden answer still blocks the close, because the database says so', () => {
    // guard_checklist_approval_stages scans the whole answers object and knows
    // nothing about visibility. If this side skipped the hidden line, the screen
    // would say "closable" and the server would refuse with a raw 22023 the
    // approver cannot act on. Agreeing with the database beats being clever.
    expect(canClose(COND, { interval: '250h', c500: 'Not OK' }).ok).toBe(false)
    expect(blockingAnswers(COND, { interval: '250h', c500: 'Not OK' }).map((x) => x.id)).toEqual(['c500'])
  })
})

describe('the mobile mirror does not drift', () => {
  const web = readFileSync(resolve(__dirname, '../lib/checklist/checklistMarks.js'), 'utf8')
  const mob = readFileSync(resolve(__dirname, '../../mobile/lib/checklistMarks.ts'), 'utf8')

  it('declares the same mark tokens on both stacks', () => {
    const tokens = (s) => [...s.matchAll(/^\s{2}(\w+):\s*\{\s*(?:lucide|ionicon):/gm)].map((m) => m[1])
    const w = tokens(web)
    const m = tokens(mob)
    expect(w.length).toBeGreaterThanOrEqual(8)
    expect(m).toEqual(w)
  })

  it('exports the same decision functions on both stacks', () => {
    const fns = (s) => [...s.matchAll(/export function (\w+)/g)].map((x) => x[1]).sort()
    expect(fns(mob)).toEqual(fns(web))
  })

  it('declares the same auto-fill sources on both stacks', () => {
    const srcs = (s) => [...s.matchAll(/'(asset\.\w+)':/g)].map((x) => x[1]).sort()
    expect(srcs(mob)).toEqual(srcs(web))
  })
})
