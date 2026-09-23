import { describe, it, expect } from 'vitest'
import { buildPolicySections, renderTyreSpecPolicyPdf, buildSizeInventoryRows } from './tyreSpecPolicy'

// ASCII-only guard: reject em/en dashes, arrows, curly quotes, middle dots.
const BANNED = /[–—→←‘’“”·]/

const SAMPLE_SPECS = [
  {
    vehicle_type: 'Rigid Truck',
    position: 'Steer',
    approved_sizes: ['315/80R22.5'],
    approved_brands: ['Michelin', 'Bridgestone'],
    ply: '16 PR',
    min_load_index: 154,
    min_speed_index: 'M',
    recommended_pressure: 120,
    min_tread_depth: 3,
  },
  {
    vehicle_type: 'Bus',
    position: 'Drive',
    approved_sizes: ['295/80R22.5'],
    approved_brands: ['Continental'],
    ply: null,
    min_load_index: null,
    min_speed_index: null,
    recommended_pressure: 110,
    min_tread_depth: 3,
  },
]

describe('buildPolicySections', () => {
  it('returns >= 10 sections in order with numeric n', () => {
    const sections = buildPolicySections({ specs: SAMPLE_SPECS, company: 'Acme' })
    expect(sections.length).toBeGreaterThanOrEqual(10)
    const nums = sections.map((s) => Number(s.n))
    expect(nums).toEqual([...nums].sort((a, b) => a - b))
    expect(nums[0]).toBe(1)
    for (const s of sections) {
      expect(Number.isFinite(Number(s.n))).toBe(true)
      expect(typeof s.title).toBe('string')
    }
  })

  it('includes an Approved Fitment Standards section with a 9-column table head', () => {
    const sections = buildPolicySections({ specs: SAMPLE_SPECS })
    const fitment = sections.find((s) => /Approved Fitment Standards/.test(s.title))
    expect(fitment).toBeTruthy()
    expect(fitment.table).toBeTruthy()
    expect(fitment.table.head).toHaveLength(9)
    expect(fitment.table.head).toEqual([
      'Vehicle Type', 'Position', 'Approved Sizes', 'Approved Brands',
      'Ply', 'Load Idx', 'Speed', 'Pressure (PSI)', 'Min Tread (mm)',
    ])
    expect(fitment.table.rows.length).toBe(SAMPLE_SPECS.length)
  })

  it('sorts fitment rows by vehicle type then position', () => {
    const sections = buildPolicySections({ specs: SAMPLE_SPECS })
    const fitment = sections.find((s) => /Approved Fitment Standards/.test(s.title))
    // Bus sorts before Rigid Truck.
    expect(fitment.table.rows[0][0]).toBe('Bus')
    expect(fitment.table.rows[1][0]).toBe('Rigid Truck')
  })

  it('with specs=[] still returns governance sections and an honest no-specs note (no throw)', () => {
    const sections = buildPolicySections({ specs: [] })
    expect(sections.length).toBeGreaterThanOrEqual(10)
    const fitment = sections.find((s) => /Approved Fitment Standards/.test(s.title))
    expect(fitment.table.rows).toHaveLength(1)
    expect(fitment.table.rows[0][0]).toMatch(/No approved specifications defined yet/i)
    // Governance sections still present.
    expect(sections.some((s) => /Document Control/.test(s.title))).toBe(true)
    expect(sections.some((s) => /Non-Conformance/.test(s.title))).toBe(true)
  })

  it('renders N/A for null ply/load/speed and never emits an em dash or arrow', () => {
    const sections = buildPolicySections({ specs: SAMPLE_SPECS })
    const fitment = sections.find((s) => /Approved Fitment Standards/.test(s.title))
    const busRow = fitment.table.rows.find((r) => r[0] === 'Bus')
    expect(busRow[4]).toBe('N/A') // ply
    expect(busRow[5]).toBe('N/A') // load idx
    expect(busRow[6]).toBe('N/A') // speed
    // Scan every string in every section for banned characters.
    const all = JSON.stringify(sections)
    expect(BANNED.test(all)).toBe(false)
  })

  it('roles section mentions Procurement and Driver', () => {
    const sections = buildPolicySections({ specs: SAMPLE_SPECS })
    const roles = sections.find((s) => /Roles and Responsibilities/.test(s.title))
    expect(roles).toBeTruthy()
    const text = (roles.body || []).join(' ')
    expect(text).toMatch(/Procurement/)
    expect(text).toMatch(/Driver/)
  })
})

describe('renderTyreSpecPolicyPdf', () => {
  it('is a function', () => {
    expect(typeof renderTyreSpecPolicyPdf).toBe('function')
  })
})

// ── Current fleet tyre inventory by size ────────────────────────────────────

const SAMPLE_FITMENTS = [
  { size: '315/80R22.5', brand: 'Michelin', vehicleType: 'Rigid Truck', position: 'Steer', site: 'Riyadh', specStatus: 'Approved' },
  { size: '315/80 R22.5', brand: 'Bridgestone', vehicleType: 'Rigid Truck', position: 'Steer', site: 'Riyadh', specStatus: 'Approved' },
  { size: '315/80r22.5', brand: 'CheapCo', vehicleType: 'Tr-Mixer', position: 'Drive', site: 'Jeddah', specStatus: 'Non-Approved Brand' },
  { size: '295/80R22.5', brand: 'Continental', vehicleType: 'Bus', position: 'Drive', site: 'Riyadh', specStatus: 'Approved' },
  { size: '', brand: 'NoSizeCo', vehicleType: 'Bus', position: 'Drive', site: 'Riyadh', specStatus: 'No Spec Defined' },
  { size: '11R22.5', brand: 'Unknown', vehicleType: null, position: 'Trailer', site: null, specStatus: 'No Spec Defined' },
]

describe('buildSizeInventoryRows', () => {
  it('groups fitments by normalised size regardless of spacing/case', () => {
    const rows = buildSizeInventoryRows({ complianceRows: SAMPLE_FITMENTS, specs: SAMPLE_SPECS })
    const big = rows.find((r) => r.size.replace(/\s/g, '').toUpperCase() === '315/80R22.5')
    expect(big).toBeTruthy()
    expect(big.count).toBe(3) // three differently-spelled 315/80R22.5 fitments collapse to one row
  })

  it('cross-references approved brands, ply, tread, load and speed from matching specs', () => {
    const rows = buildSizeInventoryRows({ complianceRows: SAMPLE_FITMENTS, specs: SAMPLE_SPECS })
    const big = rows.find((r) => r.count === 3)
    expect(big.approvedBrands).toEqual(['Bridgestone', 'Michelin'])
    expect(big.plyRating).toBe('16 PR')
    expect(big.minTreadDepth).toBe('3')
    expect(big.minLoadIndex).toBe('154')
    expect(big.minSpeedIndex).toBe('M')
    expect(big.specCount).toBe(1)
  })

  it('flags a brand fitted at a size but not on the approved list for that size', () => {
    const rows = buildSizeInventoryRows({ complianceRows: SAMPLE_FITMENTS, specs: SAMPLE_SPECS })
    const big = rows.find((r) => r.count === 3)
    expect(big.brandsFittedNotApproved).toEqual(['CheapCo'])
    expect(big.compliance.nonApprovedBrand).toBe(1)
    expect(big.compliance.approved).toBe(2)
    expect(big.nonConformingCount).toBe(1)
  })

  it('renders N/A (never fabricates) for a size with no matching specification', () => {
    const rows = buildSizeInventoryRows({ complianceRows: SAMPLE_FITMENTS, specs: SAMPLE_SPECS })
    const orphan = rows.find((r) => r.size === '11R22.5')
    expect(orphan).toBeTruthy()
    expect(orphan.plyRating).toBe('N/A')
    expect(orphan.approvedBrandsLabel).toBe('N/A')
    expect(orphan.vehicleTypesLabel).toBe('N/A') // vehicleType was null on that fitment
    expect(orphan.brandsFittedNotApproved).toEqual([]) // no approved list -> nothing to flag
  })

  it('ignores fitments with no size and sorts by fitted quantity descending', () => {
    const rows = buildSizeInventoryRows({ complianceRows: SAMPLE_FITMENTS, specs: SAMPLE_SPECS })
    expect(rows.every((r) => r.size !== '')).toBe(true)
    expect(rows[0].count).toBeGreaterThanOrEqual(rows[1].count)
  })

  it('with no fitments or no specs returns [] without throwing', () => {
    expect(buildSizeInventoryRows()).toEqual([])
    expect(buildSizeInventoryRows({ complianceRows: [], specs: SAMPLE_SPECS })).toEqual([])
    // 3 distinct non-empty sizes across SAMPLE_FITMENTS: 315/80R22.5, 295/80R22.5, 11R22.5.
    expect(buildSizeInventoryRows({ complianceRows: SAMPLE_FITMENTS, specs: [] })).toHaveLength(3)
  })
})

describe('buildPolicySections appendix (current fleet tyre inventory)', () => {
  it('adds an appendix section built from the compliance rows, never fabricating values', () => {
    const sections = buildPolicySections({ specs: SAMPLE_SPECS, complianceRows: SAMPLE_FITMENTS })
    const appendix = sections.find((s) => /Current Fleet Tyre Inventory by Size/.test(s.title))
    expect(appendix).toBeTruthy()
    expect(appendix.table.head).toEqual([
      'Tyre Size', 'Fitted Qty', 'Brands In Use', 'Approved Brands',
      'Ply Rating', 'Min Tread (mm)', 'Load Idx', 'Speed', 'Pressure (PSI)', 'Non-Conforming',
    ])
    expect(appendix.table.rows.length).toBe(3)
    const all = JSON.stringify(sections)
    expect(BANNED.test(all)).toBe(false)
  })

  it('with no compliance rows shows an honest empty appendix, no throw, count unchanged', () => {
    const sections = buildPolicySections({ specs: SAMPLE_SPECS })
    const appendix = sections.find((s) => /Current Fleet Tyre Inventory by Size/.test(s.title))
    expect(appendix).toBeTruthy()
    expect(appendix.table.rows).toHaveLength(1)
    expect(appendix.table.rows[0][0]).toMatch(/No current tyre fitments on record/i)
  })
})
