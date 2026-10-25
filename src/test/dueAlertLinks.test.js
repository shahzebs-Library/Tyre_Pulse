import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isDueAlert, dueAlertLink, dueAlertSeverity } from '../lib/dueAlertLinks'

const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261025090000_due_alerts_engine.sql'), 'utf8').replace(/\r/g, '')

describe('due alert links', () => {
  it('every seeded rule has a link and a severity', () => {
    const keys = [...sql.matchAll(/^ \('(\w+)',/gm)].map(m => m[1])
    expect(keys.length).toBe(6)
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
