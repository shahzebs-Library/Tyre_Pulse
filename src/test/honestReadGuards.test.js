// Source-scan guards for the honest-read rule: a failed read or a refused
// write must say so, never render as an empty list, a zero or raw DB text.
// Each case names the defect it pins, so a revert is unmistakable.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8').replace(/\r/g, '')

describe('honest reads', () => {
  it('Tyre Records checks the list error instead of showing an empty grid', () => {
    const s = read('src/pages/TyreRecords.jsx')
    expect(s).toMatch(/const \{ data, count, error \} = await tyreRecordsApi\.listRecords/)
    expect(s).toMatch(/setLoadError\(toUserMessage\(/)
  })

  it('an incident delete confirms a row was actually removed', () => {
    expect(read('src/lib/api/accidents.js')).toMatch(/\.delete\(\)\.eq\('id', id\)\.select\('id'\)/)
    expect(read('src/pages/Accidents.jsx')).toMatch(/setDeleteOneError\(toUserMessage\(/)
  })

  it('the board overview does not turn an unread source into zero', () => {
    const s = read('src/pages/BoardOverview.jsx')
    expect(s).not.toMatch(/listWorkOrdersForPage\([^)]*\)\.catch\(\(\) => \[\]\)/)
    expect(s).not.toMatch(/listStockRecords\([^)]*\)\.catch\(\(\) => \[\]\)/)
  })

  it('Executive Analytics never prints a raw error object', () => {
    expect(read('src/pages/ExecutiveAnalytics.jsx')).not.toMatch(/\{String\(error\)\}/)
  })

  it('last-year comparison and per-country totals surface their own failures', () => {
    expect(read('src/pages/KpiScorecard.jsx')).toMatch(/setYoyError\(toUserMessage\(/)
    expect(read('src/pages/ExpenseReport.jsx')).not.toMatch(/getExpenseByCountry\([^)]*\)\.catch\(\(\) => \[\]\)/)
  })
})
