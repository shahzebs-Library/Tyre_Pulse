import { describe, it, expect } from 'vitest'
import { buildPolicySections, renderTyreSpecPolicyPdf } from './tyreSpecPolicy'

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
