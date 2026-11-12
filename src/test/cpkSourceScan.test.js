import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * F-A-02 ratchet. Per-fitment CPK has ONE home: fitmentCpk() / fmtCpk() in
 * tyreLifetime.js over the tyreKm rule. This guard forbids a NEW file from
 * computing a stint's km as a raw `km_at_removal - km_at_fitment` (ignores the
 * placeholder/factory/cap rules) or a per-row CPK as a raw `cost_per_tyre /`
 * divide. It does NOT fail on the files already doing so (the migration backlog
 * below): a ratchet blocks regressions, it does not require the whole sweep at
 * once. When you migrate a backlog file onto fitmentCpk, delete it from the list.
 *
 * Sanctioned math home: src/lib/tyreKm.js, src/lib/tyreLifetime.js.
 */
const ROOTS = ['src/lib', 'src/pages', 'src/components']
const SANCTIONED = new Set(['src/lib/tyreKm.js', 'src/lib/tyreLifetime.js'])

// Known divergent files to migrate onto fitmentCpk(). Shrink toward empty.
// tyreBay.js and analyticsEngine.js carry labelled per-stint uses (see F-A-02).
const KM_DIFF_BACKLOG = new Set([
  'src/lib/advancedAnalyticsAnalytics.js',
  'src/lib/continuousImprovementAnalytics.js',
  'src/lib/fuelEfficiencyAnalytics.js',
  'src/lib/tyreBay.js',
  'src/pages/VehicleHistory.jsx',
])
const CPK_DIVIDE_BACKLOG = new Set([
  'src/lib/anomalyEngine.js',
  'src/lib/fleetRisk.js',
  'src/lib/tyreBay.js',
  'src/lib/tyreScrapView.js',
  'src/pages/UploadData.jsx',
])

const KM_DIFF = /\bkm_at_removal\b[^\n]*-[^\n]*\bkm_at_fitment\b/
const CPK_DIVIDE = /\bcost_per_tyre\b[^\n]*\)\s*\/|\bcost_per_tyre\s*\//

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(js|jsx)$/.test(name)) out.push(p)
  }
  return out
}

function filesMatching(re) {
  const hits = new Set()
  for (const root of ROOTS) {
    for (const f of walk(root)) {
      if (SANCTIONED.has(f)) continue
      const text = readFileSync(f, 'utf8')
      if (text.split('\n').some((line) => re.test(line))) hits.add(f)
    }
  }
  return hits
}

describe('per-fitment CPK has one source (F-A-02 ratchet)', () => {
  it('no NEW file computes a raw km_at_removal - km_at_fitment stint', () => {
    const newViolators = [...filesMatching(KM_DIFF)].filter((f) => !KM_DIFF_BACKLOG.has(f))
    expect(newViolators, 'use fitmentCpk()/fitmentKm() from tyreLifetime.js').toEqual([])
  })

  it('no NEW file computes a raw cost_per_tyre / divide', () => {
    const newViolators = [...filesMatching(CPK_DIVIDE)].filter((f) => !CPK_DIVIDE_BACKLOG.has(f))
    expect(newViolators, 'use fitmentCpk() from tyreLifetime.js').toEqual([])
  })

  it('the backlog is honest: every listed file still matches (prune when migrated)', () => {
    const km = filesMatching(KM_DIFF)
    const cpk = filesMatching(CPK_DIVIDE)
    const staleKm = [...KM_DIFF_BACKLOG].filter((f) => !km.has(f))
    const staleCpk = [...CPK_DIVIDE_BACKLOG].filter((f) => !cpk.has(f))
    expect(staleKm, 'remove migrated files from KM_DIFF_BACKLOG').toEqual([])
    expect(staleCpk, 'remove migrated files from CPK_DIVIDE_BACKLOG').toEqual([])
  })
})
