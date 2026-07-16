import { describe, it, expect } from 'vitest'
import {
  VEHICLE_TYPES,
  POSITIONS,
  SPEED_INDICES,
  SPEED_INDEX_KMH,
  speedIndexKmh,
  LOAD_INDEX_KG,
  loadIndexKg,
  PLY_RATINGS,
  APPROVED_BRANDS,
  CHINESE_BRANDS,
  REFERENCE_BRANDS,
  SMART_DEFAULTS,
  defaultsForVehicleType,
  BRAND_META,
  brandMeta,
  BRAND_TIERS,
} from './tyreSpecCatalog'

// Characters banned from report/UI strings (em/en dash, arrows, curly quotes, middle dot).
const BANNED = /[—–→←‘’“”·]/

describe('VEHICLE_TYPES', () => {
  it('includes on-road and off-road required types', () => {
    for (const t of [
      'Rigid Truck', 'Mixer', 'Tipper', 'Semi-Trailer', 'Tanker', 'Flat Bed',
      'Bus', 'Pickup', 'Trailer', 'Concrete Pump', 'Boom Pump Truck',
      'Wheel Loader', 'Motor Grader', 'Excavator', 'Bulldozer', 'Backhoe Loader',
      'Forklift', 'Reach Stacker', 'Rigid Dump Truck', 'Mobile Crane', 'Other',
    ]) {
      expect(VEHICLE_TYPES).toContain(t)
    }
  })
  it('specifically includes Concrete Pump and Wheel Loader', () => {
    expect(VEHICLE_TYPES).toContain('Concrete Pump')
    expect(VEHICLE_TYPES).toContain('Wheel Loader')
  })
})

describe('POSITIONS', () => {
  it('carries axle and OTR positions', () => {
    expect(POSITIONS).toEqual([
      'Steer', 'Drive', 'Trailer', 'Lift Axle', 'Tag Axle',
      'Front (OTR)', 'Rear (OTR)', 'All Positions',
    ])
  })
})

describe('SPEED_INDICES / SPEED_INDEX_KMH', () => {
  it('keeps the existing speed letter set', () => {
    expect(SPEED_INDICES).toEqual(['J', 'K', 'L', 'M', 'N', 'P', 'Q', 'R', 'S', 'T', 'U', 'H', 'V', 'W', 'Y'])
  })
  it('maps letters to numeric km/h', () => {
    expect(SPEED_INDEX_KMH.K).toBe(110)
    expect(speedIndexKmh('M')).toBe(130)
    expect(typeof speedIndexKmh('L')).toBe('number')
    expect(speedIndexKmh('k')).toBe(110)
    expect(speedIndexKmh('ZZ')).toBeNull()
    expect(speedIndexKmh(null)).toBeNull()
  })
})

describe('LOAD_INDEX_KG / loadIndexKg', () => {
  it('uses correct ISO load-index values', () => {
    expect(LOAD_INDEX_KG[150]).toBe(3350)
    expect(LOAD_INDEX_KG[152]).toBe(3550)
    expect(LOAD_INDEX_KG[154]).toBe(3750)
    expect(LOAD_INDEX_KG[156]).toBe(4000)
    expect(LOAD_INDEX_KG[158]).toBe(4250)
    expect(LOAD_INDEX_KG[160]).toBe(4500)
    expect(LOAD_INDEX_KG[164]).toBe(5000)
    expect(LOAD_INDEX_KG[166]).toBe(5300)
    expect(LOAD_INDEX_KG[170]).toBe(6000)
    expect(LOAD_INDEX_KG[176]).toBe(7100)
    expect(LOAD_INDEX_KG[180]).toBe(8000)
  })
  it('covers the 120..180 range', () => {
    for (let n = 120; n <= 180; n += 1) {
      expect(typeof loadIndexKg(n)).toBe('number')
    }
  })
  it('returns numbers for known keys and null otherwise', () => {
    expect(typeof loadIndexKg(154)).toBe('number')
    expect(loadIndexKg(999)).toBeNull()
    expect(loadIndexKg(null)).toBeNull()
  })
})

describe('PLY_RATINGS', () => {
  it('carries numeric and OTR star ratings', () => {
    for (const p of ['6PR', '16PR', '20PR', '32PR', '*', '**', '***']) {
      expect(PLY_RATINGS).toContain(p)
    }
  })
})

describe('brands', () => {
  it('lists Double Coin first among approved brands', () => {
    expect(APPROVED_BRANDS[0]).toBe('Double Coin')
  })
  it('includes Double Coin in the Chinese subset', () => {
    expect(CHINESE_BRANDS).toContain('Double Coin')
    expect(CHINESE_BRANDS).toContain('Triangle')
    expect(CHINESE_BRANDS).toContain('Aeolus')
  })
  it('composes APPROVED_BRANDS from Chinese then reference brands', () => {
    expect(APPROVED_BRANDS).toEqual([...CHINESE_BRANDS, ...REFERENCE_BRANDS])
  })
})

describe('SMART_DEFAULTS', () => {
  it('every entry has the exact expected shape', () => {
    for (const d of SMART_DEFAULTS) {
      expect(typeof d.vehicle_type).toBe('string')
      expect(d.vehicle_type.length).toBeGreaterThan(0)
      expect(typeof d.position).toBe('string')
      expect(Array.isArray(d.approved_sizes)).toBe(true)
      expect(d.approved_sizes.length).toBeGreaterThan(0)
      expect(Array.isArray(d.approved_brands)).toBe(true)
      expect(d.approved_brands.length).toBeGreaterThan(0)
      expect(typeof d.min_load_index).toBe('number')
      expect(typeof d.min_speed_index).toBe('string')
      expect(typeof d.ply_rating).toBe('string')
      expect(d.ply_rating.length).toBeGreaterThan(0)
      expect(typeof d.recommended_pressure).toBe('number')
      expect(typeof d.min_tread_depth).toBe('number')
      expect(typeof d.notes).toBe('string')
    }
  })
  it('every ply_rating is a valid catalog code', () => {
    for (const d of SMART_DEFAULTS) {
      expect(PLY_RATINGS).toContain(d.ply_rating)
    }
  })
  it('references only approved brands', () => {
    for (const d of SMART_DEFAULTS) {
      for (const b of d.approved_brands) {
        expect(APPROVED_BRANDS).toContain(b)
      }
    }
  })
  it('references only known positions and vehicle types', () => {
    for (const d of SMART_DEFAULTS) {
      expect(POSITIONS).toContain(d.position)
      expect(VEHICLE_TYPES).toContain(d.vehicle_type)
    }
  })
  it('has at least one Front (OTR) default', () => {
    expect(SMART_DEFAULTS.some((d) => d.position === 'Front (OTR)')).toBe(true)
  })
  it('covers concrete pump and wheel loader profiles', () => {
    expect(SMART_DEFAULTS.some((d) => d.vehicle_type === 'Concrete Pump')).toBe(true)
    expect(SMART_DEFAULTS.some((d) => d.vehicle_type === 'Wheel Loader')).toBe(true)
  })
  it('prioritises Double Coin in approved brands', () => {
    for (const d of SMART_DEFAULTS) {
      expect(d.approved_brands[0]).toBe('Double Coin')
    }
  })
  it('has no banned punctuation in notes (no em dash or arrow)', () => {
    for (const d of SMART_DEFAULTS) {
      expect(BANNED.test(d.notes)).toBe(false)
    }
  })
})

describe('BRAND_META / brandMeta', () => {
  it('exposes the tier ordering helper', () => {
    expect(BRAND_TIERS).toEqual(['premium', 'mid', 'value'])
  })
  it('covers every approved brand with a valid tier', () => {
    for (const b of APPROVED_BRANDS) {
      const meta = BRAND_META[b]
      expect(meta, `missing BRAND_META for ${b}`).toBeDefined()
      expect(BRAND_TIERS).toContain(meta.tier)
      expect(typeof meta.origin).toBe('string')
      expect(typeof meta.retreadable).toBe('boolean')
      expect(['excellent', 'good', 'fair']).toContain(meta.casing)
      expect(typeof meta.priceIndex).toBe('number')
      expect(typeof meta.durabilityIndex).toBe('number')
      expect(Array.isArray(meta.application)).toBe(true)
      expect(meta.application.length).toBeGreaterThan(0)
      expect(typeof meta.note).toBe('string')
    }
  })
  it('classifies Double Coin as a retreadable value casing', () => {
    expect(BRAND_META['Double Coin'].tier).toBe('value')
    expect(BRAND_META['Double Coin'].retreadable).toBe(true)
  })
  it('prices premium brands above value brands on average', () => {
    const meanFor = (tier) => {
      const vals = APPROVED_BRANDS
        .map((b) => BRAND_META[b])
        .filter((m) => m.tier === tier)
        .map((m) => m.priceIndex)
      return vals.reduce((s, v) => s + v, 0) / vals.length
    }
    expect(meanFor('premium')).toBeGreaterThan(meanFor('value'))
  })
  it('resolves case-insensitively', () => {
    expect(brandMeta('double coin')).toBe(BRAND_META['Double Coin'])
    expect(brandMeta('MICHELIN')).toBe(BRAND_META.Michelin)
  })
  it('returns a safe honest default for unknown brands', () => {
    expect(brandMeta('NoSuchBrand').tier).toBe('unknown')
    expect(brandMeta(null).tier).toBe('unknown')
    expect(brandMeta('NoSuchBrand').priceIndex).toBeNull()
    expect(brandMeta('NoSuchBrand').application).toEqual([])
  })
  it('has no banned punctuation in any note', () => {
    for (const b of APPROVED_BRANDS) {
      expect(BANNED.test(BRAND_META[b].note)).toBe(false)
    }
  })
})

describe('defaultsForVehicleType', () => {
  it('filters SMART_DEFAULTS by vehicle type', () => {
    const loader = defaultsForVehicleType('Wheel Loader')
    expect(loader.length).toBeGreaterThan(0)
    expect(loader.every((d) => d.vehicle_type === 'Wheel Loader')).toBe(true)
  })
  it('is case-insensitive and honest on unknown types', () => {
    expect(defaultsForVehicleType('rigid truck').length).toBeGreaterThan(0)
    expect(defaultsForVehicleType('Nonexistent')).toEqual([])
    expect(defaultsForVehicleType(null)).toEqual([])
  })
})
