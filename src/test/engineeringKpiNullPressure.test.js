import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { computePressureCompliance } from '../lib/kpiEngine.js'

/**
 * Regression guard for the live crash logged at /kpi-engine (system_logs,
 * ERR-I3LGRUW8 / ERR-R3GKNSYP / ERR-3VALEIDI, 2026-08-15):
 *
 *   TypeError: Cannot read properties of null (reading 'toFixed')
 *
 * V494 correctly made computePressureCompliance return `null` when no pressure
 * was recorded. EngineeringKpi still guarded only on `inspections.length === 0`,
 * so with 388 inspections and 0 recorded PSI the guard passed, the null reached
 * `fmtPct`, and `null.toFixed(1)` took the whole page down behind the error
 * boundary on every single load.
 */

const SRC = fs.readFileSync(
  path.resolve(__dirname, '../pages/EngineeringKpi.jsx'), 'utf8'
)

describe('pressure compliance is null when nothing was measured', () => {
  it('returns null - never a flattering zero - with inspections but no readings', () => {
    // The live shape: real inspections, none carrying a pressure reading.
    const inspections = Array.from({ length: 5 }, (_, i) => ({
      id: `i${i}`, status: 'Done', site: 'NHC', tyre_conditions: [],
    }))
    const out = computePressureCompliance(inspections)

    expect(out.compliancePct).toBeNull()
    expect(out.compliancePct).not.toBe(0)
    expect(out.readings).toBe(0)
    // The consumer needs a non-null signal to branch on.
    expect(out.basis).toBeTruthy()
  })

  it('still measures normally once real readings exist', () => {
    const out = computePressureCompliance([{
      id: 'a', status: 'Done', site: 'NHC',
      tyre_conditions: [
        { pressure_psi: 100 }, { pressure_psi: 100 },
        { pressure_psi: 100 }, { pressure_psi: 100 },
      ],
    }])
    expect(out.compliancePct).toBe(100)
  })
})

describe('EngineeringKpi never dereferences a nullable KPI', () => {
  it('fmtPct guards null before calling toFixed', () => {
    const fn = SRC.match(/function fmtPct\s*\([^)]*\)\s*\{[\s\S]*?\n\}/)
    expect(fn, 'fmtPct must exist').toBeTruthy()
    const body = fn[0]
    // Must bail out on null/non-finite before formatting (directly or via isMeasured).
    expect(body).toMatch(/==\s*null|Number\.isFinite|isMeasured/)
    expect(body).toMatch(/return\s+'N\/A'/)
    // and the shared predicate it delegates to must really test both.
    const guard = SRC.match(/function isMeasured\s*\([^)]*\)\s*\{[\s\S]*?\n\}/)
    expect(guard, 'isMeasured must exist').toBeTruthy()
    expect(guard[0]).toMatch(/!=\s*null/)
    expect(guard[0]).toMatch(/Number\.isFinite/)
  })

  it('does not call .toFixed directly on the nullable pressure compliance', () => {
    // pressureCompliance.compliancePct is nullable; a bare `.toFixed` throws.
    // (inspectionCompliance.compliancePct is NOT nullable - the engine returns 0 -
    // so its direct .toFixed calls are deliberately left alone.)
    expect(SRC).not.toMatch(/pressureCompliance\.compliancePct\.toFixed\(/)
    expect(SRC).not.toMatch(/\bpressPct\.toFixed\(/)
  })

  it('does not treat an unmeasured pressure reading as critical', () => {
    // `null > 60` is false, which used to paint "critical" on a metric nobody
    // measured. The status must branch on measured-ness first.
    expect(SRC).toMatch(/pressMeasured/)
  })
})
