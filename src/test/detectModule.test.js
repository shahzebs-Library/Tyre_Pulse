import { describe, it, expect } from 'vitest'
import { detectModule, rankModules, DETECT_CONFIDENCE } from '../lib/import/detectModule.js'

describe('import/detectModule', () => {
  it('routes a tyre-shaped file to the tyre module', () => {
    const { module, confident, ranked } = detectModule([
      'Serial No', 'Asset No', 'Tyre Brand', 'Tread Depth', 'Pressure',
    ])
    expect(module).toBe('tyre')
    expect(confident).toBe(true)
    expect(ranked[0].module).toBe('tyre')
    expect(ranked[0].requiredCovered).toBe(ranked[0].requiredTotal)
  })

  it('routes a fleet-shaped file to the fleet module', () => {
    const { module } = detectModule([
      'Asset No', 'Registration No', 'Vehicle Type', 'Make', 'Model', 'Site',
    ])
    expect(module).toBe('fleet')
  })

  it('routes a stock-shaped file to the stock module', () => {
    const { module } = detectModule(['Site', 'Description', 'Stock Qty', 'Unit Price', 'Location'])
    expect(module).toBe('stock')
  })

  it('routes an accident-shaped file to the accident module', () => {
    const { module } = detectModule(['Asset No', 'Incident Date', 'Severity', 'Description'])
    expect(module).toBe('accident')
  })

  it('returns a null module with no headers', () => {
    expect(detectModule([]).module).toBeNull()
    expect(detectModule([]).ranked).toEqual([])
  })

  it('ranks every module and never throws on odd input', () => {
    const ranked = rankModules(['xyzzy', 'plugh', ''])
    expect(Array.isArray(ranked)).toBe(true)
    // Scores are clamped 0..100 and sorted descending.
    for (const r of ranked) {
      expect(r.score).toBeGreaterThanOrEqual(0)
      expect(r.score).toBeLessThanOrEqual(100)
    }
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1].score).toBeGreaterThanOrEqual(ranked[i].score)
    }
  })

  it('is not confident when the leader is weak', () => {
    // Garbage headers should not clear the confidence bar.
    const { confident, ranked } = detectModule(['foo', 'bar'])
    if (ranked.length && ranked[0].score < DETECT_CONFIDENCE) {
      expect(confident).toBe(false)
    }
  })

  it('accepts {index,header} column objects as well as strings', () => {
    const cols = [
      { index: 0, header: 'Serial No' },
      { index: 1, header: 'Asset No' },
      { index: 2, header: 'Tyre Brand' },
    ]
    expect(detectModule(cols).module).toBe('tyre')
  })
})
