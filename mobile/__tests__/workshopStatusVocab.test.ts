/**
 * DRIFT GUARD: the mobile Workshop Status vocabularies must equal the web source
 * of truth (src/lib/workshopStatus/vocab.js) value for value, in order. The
 * update RPC refuses any off-list value, so a drifted phone list would offer a
 * choice the server rejects. The web file is ESM and outside this runner's
 * roots, so it is PARSED as text rather than imported.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  CURRENT_STAGES, SELECTABLE_STAGES, DELAY_REASONS, PARTS_STATUSES, RELEASED_STAGE,
  DELAY_REASON_OTHER, needsDetailedReason, vocabKey,
} from '../lib/workshopStatusVocab'

const WEB = readFileSync(join(__dirname, '..', '..', 'src', 'lib', 'workshopStatus', 'vocab.js'), 'utf8')
  .replace(/\r\n/g, '\n')

function webList(name: string): string[] {
  const start = WEB.indexOf(`export const ${name} = Object.freeze([`)
  expect(start).toBeGreaterThan(-1)
  const end = WEB.indexOf('])', start)
  return [...WEB.slice(start, end).matchAll(/'([^']*)'/g)].map((m) => m[1])
}

const en = require('../locales/en.json')
const ar = require('../locales/ar.json')

describe('Workshop Status vocab mirrors the web source of truth', () => {
  it('parsed the web lists (not vacuous)', () => {
    expect(webList('CURRENT_STAGES').length).toBeGreaterThan(10)
    expect(webList('DELAY_REASONS').length).toBeGreaterThan(20)
    expect(webList('PARTS_STATUSES').length).toBeGreaterThan(10)
  })

  it('stages, delay reasons and parts statuses are identical and in the same order', () => {
    expect([...CURRENT_STAGES]).toEqual(webList('CURRENT_STAGES'))
    expect([...DELAY_REASONS]).toEqual(webList('DELAY_REASONS'))
    expect([...PARTS_STATUSES]).toEqual(webList('PARTS_STATUSES'))
  })

  it('the selectable stages exclude only the released (upload-set) stage, as on the web', () => {
    expect(WEB).toContain(`(s) => s !== '${RELEASED_STAGE}'`)
    expect([...SELECTABLE_STAGES]).toEqual(webList('CURRENT_STAGES').filter((s) => s !== RELEASED_STAGE))
  })

  it('"Other" needs a detailed reason, as on the web', () => {
    expect(WEB).toContain(`DELAY_REASON_OTHER = '${DELAY_REASON_OTHER}'`)
    expect(needsDetailedReason('Other')).toBe(true)
    expect(needsDetailedReason(' Other ')).toBe(true)
    expect(needsDetailedReason('MR Pending')).toBe(false)
    expect(needsDetailedReason(null)).toBe(false)
  })
})

describe('every vocabulary value has an English and Arabic display label', () => {
  const lists: [string, readonly string[]][] = [
    ['stages', CURRENT_STAGES], ['delayReasons', DELAY_REASONS], ['partsStatuses', PARTS_STATUSES],
  ]
  it.each(lists)('%s', (name, values) => {
    const keys = values.map(vocabKey)
    expect(new Set(keys).size).toBe(keys.length)
    for (const k of keys) {
      expect(typeof en.modules.workshopStatus[name][k]).toBe('string')
      expect(typeof ar.modules.workshopStatus[name][k]).toBe('string')
    }
  })

  it('a vehicle that left the daily file reads "Released", never "removed"', () => {
    const k = vocabKey(RELEASED_STAGE)
    expect(en.modules.workshopStatus.stages[k]).toBe('Released')
    expect(String(en.modules.workshopStatus.stages[k]).toLowerCase()).not.toContain('remov')
    expect(en.modules.workshopStatus.released).toBe('Released')
  })

  it('the en and ar workshopStatus blocks carry the same keys', () => {
    const flat = (o: any, p = ''): string[] => Object.entries(o).flatMap(([k, v]) =>
      v && typeof v === 'object' ? flat(v, `${p}${k}.`) : [`${p}${k}`])
    expect(flat(ar.modules.workshopStatus).sort()).toEqual(flat(en.modules.workshopStatus).sort())
  })
})
