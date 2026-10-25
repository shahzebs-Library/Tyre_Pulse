import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isDueAlert, dueAlertLink, dueAlertSeverity } from '../lib/dueAlertLinks'

const read = (f) => readFileSync(resolve(process.cwd(), 'supabase/migrations/' + f), 'utf8').replace(/\r/g, '')
const sql = read('20261025090000_due_alerts_engine.sql')
const sql2 = read('20261025100000_due_alerts_tyre_end_of_life.sql')

describe('due alert links', () => {
  it('every seeded rule has a link and a severity', () => {
    const keys = [...sql.matchAll(/^ \('(\w+)',/gm), ...sql2.matchAll(/^values \('(\w+)',/gm)].map(m => m[1])
    expect(keys.length).toBe(7)
    for (const k of keys) {
      expect(isDueAlert('due_' + k)).toBe(true)
      expect(dueAlertLink('due_' + k)).toMatch(/^\//)
      expect(['Critical', 'High']).toContain(dueAlertSeverity('due_' + k))
    }
  })
  it('ignores other notification types', () => {
    expect(isDueAlert('approval')).toBe(false)
    expect(dueAlertLink('approval')).toBeNull()
  })
})
