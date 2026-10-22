import { describe, it, expect } from 'vitest'
import en from '../locales/en/workforce.json'
import ar from '../locales/ar/workforce.json'
import { ASSIGNMENT_STATUSES, ASSIGNMENT_PRIORITIES } from '../lib/workforceAssignmentFilter'

const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) =>
  v && typeof v === 'object' ? flat(v, `${p}${k}.`) : [[`${p}${k}`, v]])

describe('workforce web strings: English / Arabic parity', () => {
  it('both languages carry exactly the same keys, all non-empty strings', () => {
    const a = flat(en), b = flat(ar)
    expect(b.map(x => x[0]).sort()).toEqual(a.map(x => x[0]).sort())
    for (const [k, v] of [...a, ...b]) expect(typeof v === 'string' && v.trim().length > 0, k).toBe(true)
  })
  it('Arabic is translated, not a copy of English', () => {
    const e = Object.fromEntries(flat(en))
    for (const [k, v] of flat(ar)) expect(v, k).not.toBe(e[k])
  })
  it('every status and priority the filter offers has a label', () => {
    for (const s of ASSIGNMENT_STATUSES) { expect(en.status[s], s).toBeTruthy(); expect(ar.status[s], s).toBeTruthy() }
    for (const p of ASSIGNMENT_PRIORITIES) { expect(en.priority[p], p).toBeTruthy(); expect(ar.priority[p], p).toBeTruthy() }
  })
  it('interpolation placeholders match across languages', () => {
    const ph = s => (s.match(/\{\w+\}/g) || []).sort().join()
    const e = Object.fromEntries(flat(en))
    for (const [k, v] of flat(ar)) expect(ph(v), k).toBe(ph(e[k]))
  })
})
