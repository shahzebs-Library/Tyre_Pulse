import { describe, it, expect } from 'vitest'
import { KPI_REGISTRY, getKpi, listKpis } from '../lib/kpi/registry'
import * as kpiEngine from '../lib/kpiEngine'
import * as analyticsEngine from '../lib/analyticsEngine'

const REQUIRED = ['key', 'name', 'definition', 'formula', 'unit', 'sourceTables', 'filters', 'target', 'owner', 'direction']

describe('KPI registry — integrity', () => {
  it('has the 12 core KPIs with unique keys', () => {
    expect(KPI_REGISTRY.length).toBe(12)
    const keys = KPI_REGISTRY.map((k) => k.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('every KPI has all required fields with valid types', () => {
    for (const k of KPI_REGISTRY) {
      for (const f of REQUIRED) expect(k, `${k.key} missing ${f}`).toHaveProperty(f)
      expect(Array.isArray(k.sourceTables) && k.sourceTables.length > 0).toBe(true)
      expect(['higher_is_better', 'lower_is_better']).toContain(k.direction)
      expect(k.target === null || typeof k.target === 'number').toBe(true)
      expect(typeof k.owner).toBe('string')
    }
  })

  it('every non-null compute references a REAL exported engine function', () => {
    const mods = { kpiEngine, analyticsEngine }
    for (const k of KPI_REGISTRY) {
      if (k.compute == null) {
        // unresolved KPIs must be flagged, not silently broken
        expect(k.computeModule, `${k.key} null compute should have null module`).toBeNull()
        expect(typeof k.notes, `${k.key} null compute must carry notes`).toBe('string')
        continue
      }
      const mod = mods[k.computeModule]
      expect(mod, `${k.key} unknown computeModule ${k.computeModule}`).toBeTruthy()
      expect(typeof mod[k.compute], `${k.key} -> ${k.computeModule}.${k.compute} is not a function`).toBe('function')
    }
  })

  it('getKpi / listKpis resolvers behave', () => {
    expect(getKpi('tyre_cost_per_km').name).toContain('Cost per Km')
    expect(getKpi('nope')).toBeNull()
    expect(getKpi('')).toBeNull()
    expect(listKpis()).toBe(KPI_REGISTRY)
  })
})
