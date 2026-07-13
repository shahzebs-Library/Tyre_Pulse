import { describe, it, expect } from 'vitest'
import {
  validateFitment, matchRules, defaultRule,
  checkSize, checkTread, checkLifecycle, checkAge, checkRetread, checkDualPair,
  FITMENT_ENGINE_DEFAULTS, FITMENT_UNAVAILABLE_CHECKS,
} from '../lib/fitmentValidation'

// A permissive rule with an approved-size whitelist for size tests.
const sizeRule = {
  rule_name: 'Size policy',
  approved_sizes: ['315/80R22.5', '295/80 R22.5'],
  min_tread_depth_mm: 3.0,
  is_active: true,
}

describe('checkSize', () => {
  it('flags a size not in the approved list (normalisation-tolerant)', () => {
    const v = []
    checkSize({ size: '11R22.5' }, sizeRule, v)
    expect(v).toHaveLength(1)
    expect(v[0].rule).toBe('size_mismatch')
    expect(v[0].severity).toBe('critical')
  })

  it('accepts an approved size regardless of spacing/case', () => {
    const v = []
    checkSize({ size: '295/80 r22.5' }, sizeRule, v)
    expect(v).toHaveLength(0)
  })

  it('skips when the rule has no approved list or the tyre has no size', () => {
    const a = []; checkSize({ size: '11R22.5' }, { approved_sizes: [] }, a)
    expect(a).toHaveLength(0)
    const b = []; checkSize({ size: '' }, sizeRule, b)
    expect(b).toHaveLength(0)
  })
})

describe('checkTread', () => {
  it('critical at or below the minimum', () => {
    const v = []; const w = []
    checkTread({ tread_depth: 3 }, { min_tread_depth_mm: 3 }, {}, v, w)
    expect(v).toHaveLength(1)
    expect(v[0].rule).toBe('below_min_tread')
    expect(w).toHaveLength(0)
  })

  it('warning inside the buffer above the minimum', () => {
    const v = []; const w = []
    // min 3, buffer 2 → 4mm is a warning (3 < 4 <= 5)
    checkTread({ tread_depth: 4 }, { min_tread_depth_mm: 3 }, {}, v, w)
    expect(v).toHaveLength(0)
    expect(w).toHaveLength(1)
    expect(w[0].rule).toBe('low_tread_warning')
    expect(w[0].severity).toBe('warning')
  })

  it('clean above the buffer, and skips when tread is null', () => {
    const v = []; const w = []
    checkTread({ tread_depth: 9 }, { min_tread_depth_mm: 3 }, {}, v, w)
    expect(v).toHaveLength(0); expect(w).toHaveLength(0)
    const v2 = []; const w2 = []
    checkTread({ tread_depth: null }, { min_tread_depth_mm: 3 }, {}, v2, w2)
    expect(v2).toHaveLength(0); expect(w2).toHaveLength(0)
  })

  it('falls back to engine default minimum when the rule omits it', () => {
    const v = []; const w = []
    checkTread({ tread_depth: FITMENT_ENGINE_DEFAULTS.min_tread_depth_mm }, {}, {}, v, w)
    expect(v[0].rule).toBe('below_min_tread')
  })
})

describe('checkLifecycle', () => {
  it.each(['scrapped', 'Removed', 'DAMAGED beyond repair'])('flags unfit status %s', (status) => {
    const v = []; checkLifecycle({ status }, v)
    expect(v).toHaveLength(1)
    expect(v[0].rule).toBe('unfit_condition')
    expect(v[0].severity).toBe('critical')
  })

  it('passes an in-service status and skips a blank status', () => {
    const a = []; checkLifecycle({ status: 'in_service' }, a); expect(a).toHaveLength(0)
    const b = []; checkLifecycle({ status: '' }, b); expect(b).toHaveLength(0)
  })
})

describe('checkAge / checkRetread — honest no-ops (data absent)', () => {
  it('never raise anything on this dataset', () => {
    expect(checkAge()).toBeNull()
    expect(checkRetread()).toBeNull()
  })
})

describe('checkDualPair', () => {
  it('no-ops when there is no partner (no wheel-position data here)', () => {
    const v = []; const w = []
    expect(checkDualPair({ size: '11R22.5' }, null, { require_matching_pair: true }, {}, v, w)).toBeNull()
    expect(v).toHaveLength(0); expect(w).toHaveLength(0)
  })

  it('flags a size mismatch and a tread imbalance when a partner is supplied', () => {
    const v = []; const w = []
    checkDualPair(
      { size: '11R22.5', tread_depth: 10 },
      { size: '295/80R22.5', tread_depth: 6 },
      { require_matching_pair: true, max_tread_delta_dual_mm: 2 },
      {}, v, w,
    )
    expect(v.map((x) => x.rule)).toContain('dual_size_mismatch')
    expect(w.map((x) => x.rule)).toContain('dual_tread_imbalance')
  })
})

describe('matchRules', () => {
  const rules = [
    { rule_name: 'Tractors', applies_to_vehicle_types: ['tractor'], is_active: true },
    { rule_name: 'All', applies_to_vehicle_types: [], is_active: true },
    { rule_name: 'Inactive', applies_to_vehicle_types: ['tractor'], is_active: false },
  ]

  it('keeps active rules matching the vehicle type or applying to all', () => {
    const matched = matchRules(rules, { vehicle_type: 'tractor' })
    const names = matched.map((r) => r.rule_name)
    expect(names).toContain('Tractors')
    expect(names).toContain('All')
    expect(names).not.toContain('Inactive')
  })

  it('keeps only the catch-all rule for an unlisted type', () => {
    const matched = matchRules(rules, { vehicle_type: 'trailer' })
    expect(matched.map((r) => r.rule_name)).toEqual(['All'])
  })

  it('returns the default rule when nothing matches', () => {
    const matched = matchRules([], { vehicle_type: 'trailer' })
    expect(matched).toHaveLength(1)
    expect(matched[0]._default).toBe(true)
    expect(matched[0]).toMatchObject(defaultRule())
  })
})

describe('validateFitment', () => {
  it('is_valid true with only warnings (warnings do not block)', () => {
    const res = validateFitment(
      { size: '295/80R22.5', tread_depth: 4, status: 'in_service' },
      { vehicle_type: 'tractor' },
      sizeRule,
    )
    expect(res.is_valid).toBe(true)
    expect(res.violations).toHaveLength(0)
    expect(res.warnings.map((w) => w.rule)).toContain('low_tread_warning')
  })

  it('is_valid false when any critical violation is present', () => {
    const res = validateFitment(
      { size: '11R22.5', tread_depth: 2, status: 'scrapped' },
      { vehicle_type: 'tractor' },
      sizeRule,
    )
    expect(res.is_valid).toBe(false)
    const rules = res.violations.map((v) => v.rule)
    expect(rules).toContain('size_mismatch')
    expect(rules).toContain('below_min_tread')
    expect(rules).toContain('unfit_condition')
  })

  it('returns a tyre_not_found critical when the tyre is missing', () => {
    const res = validateFitment(null, { vehicle_type: 'tractor' }, sizeRule)
    expect(res.is_valid).toBe(false)
    expect(res.violations[0].rule).toBe('tyre_not_found')
  })

  it('always surfaces the unavailable-checks list (never fabricated)', () => {
    const res = validateFitment({ size: '295/80R22.5', tread_depth: 9, status: 'in_service' }, {}, sizeRule)
    expect(res.is_valid).toBe(true)
    expect(res.unavailable).toBe(FITMENT_UNAVAILABLE_CHECKS)
    expect(res.unavailable.map((c) => c.rule)).toEqual(['age', 'retread', 'dual_pair'])
  })

  it('falls back to the default rule when none is supplied', () => {
    const res = validateFitment({ size: 'anything', tread_depth: 9, status: 'in_service' }, {})
    // default rule has no approved-size whitelist → size not checked → valid
    expect(res.is_valid).toBe(true)
  })
})
