import { describe, it, expect } from 'vitest'
import {
  wrongModuleWarning,
  duplicateRatio,
  naturalKeyLabel,
  hasNaturalKey,
  WRONG_MODULE_THRESHOLD,
} from '../lib/import'

/**
 * Granularity / "wrong module" heuristic.
 *
 * When >60% of a file's KEYED rows collapse onto an existing/repeated natural
 * key, the file is almost certainly finer-grained than the module (e.g. a
 * parts-consumption ledger staged as Work Orders). The wizard raises a
 * NON-BLOCKING warning. These helpers are the pure core behind that banner.
 */

describe('duplicateRatio', () => {
  it('is 0 when nothing is keyed (avoids divide-by-zero)', () => {
    expect(duplicateRatio({ keyed: 0, duplicate: 10 })).toBe(0)
    expect(duplicateRatio({})).toBe(0)
    expect(duplicateRatio(null)).toBe(0)
  })

  it('sums duplicate + conflict + liveDuplicate over keyed rows', () => {
    // 21268/24195 ≈ 0.879 - the real 2021.xlsx figure from QA.
    expect(duplicateRatio({ keyed: 24195, duplicate: 21268 })).toBeCloseTo(0.879, 3)
    expect(duplicateRatio({ keyed: 100, duplicate: 30, conflict: 10, liveDuplicate: 20 })).toBeCloseTo(0.6, 5)
  })

  it('clamps to [0,1]', () => {
    expect(duplicateRatio({ keyed: 10, duplicate: 999 })).toBe(1)
    expect(duplicateRatio({ keyed: 10, duplicate: -5 })).toBe(0)
  })
})

describe('naturalKeyLabel', () => {
  it('renders a human-readable key for keyed modules', () => {
    expect(naturalKeyLabel('workorder')).toMatch(/Work Order/i)
    expect(naturalKeyLabel('workorder')).toMatch(/^Country \+ /)
    expect(naturalKeyLabel('fleet')).toMatch(/^Country \+ /)
    expect(naturalKeyLabel('stock')).toContain('+')
  })

  it('returns null for an unknown module', () => {
    expect(naturalKeyLabel('nope')).toBeNull()
  })
})

describe('hasNaturalKey', () => {
  it('is true for modules with an identifying component beyond country', () => {
    for (const m of ['fleet', 'tyre', 'stock', 'workorder', 'accident', 'inspection', 'warranty', 'gatepass', 'supplier', 'driver']) {
      expect(hasNaturalKey(m)).toBe(true)
    }
  })

  it('is false for an unknown module', () => {
    expect(hasNaturalKey('nope')).toBe(false)
  })
})

describe('wrongModuleWarning', () => {
  const module = 'workorder'

  it('fires above the 60% threshold with the real QA figures', () => {
    const w = wrongModuleWarning({ keyed: 24195, duplicate: 21268 }, module)
    expect(w).not.toBeNull()
    expect(w.pct).toBe(88)
    expect(w.collapsed).toBe(21268)
    expect(w.keyed).toBe(24195)
    expect(w.keyLabel).toMatch(/Work Order/i)
  })

  it('does NOT fire at or below the threshold', () => {
    expect(wrongModuleWarning({ keyed: 100, duplicate: 60 }, module)).toBeNull() // exactly 0.6
    expect(wrongModuleWarning({ keyed: 100, duplicate: 10 }, module)).toBeNull()
  })

  it('fires just above the threshold', () => {
    expect(wrongModuleWarning({ keyed: 100, duplicate: 61 }, module)).not.toBeNull()
  })

  it('does not fire when no rows are keyed', () => {
    expect(wrongModuleWarning({ keyed: 0, duplicate: 0 }, module)).toBeNull()
  })

  it('honours a custom threshold', () => {
    expect(wrongModuleWarning({ keyed: 100, duplicate: 50 }, module, 0.4)).not.toBeNull()
    expect(wrongModuleWarning({ keyed: 100, duplicate: 50 }, module, 0.9)).toBeNull()
  })

  it('exports the default threshold as 0.6', () => {
    expect(WRONG_MODULE_THRESHOLD).toBe(0.6)
  })
})
