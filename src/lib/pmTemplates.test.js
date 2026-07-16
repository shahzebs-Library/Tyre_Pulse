import { describe, it, expect } from 'vitest'
import { PM_TEMPLATES, templatesFor, applyTemplate } from './pmTemplates'
import { ASSET_CATEGORIES, PM_PRIORITIES, METER_SOURCES } from './pmVocab'

// Characters banned from report / UI strings by project rule: em dash, en dash,
// arrows, curly quotes, middle dot.
const BANNED = /[–—→←‘’“”·]/

const VALID_INTERVAL_TYPES = ['days', 'months']

describe('PM_TEMPLATES catalog integrity', () => {
  it('has a healthy library size spanning categories', () => {
    expect(PM_TEMPLATES.length).toBeGreaterThanOrEqual(8)
    expect(PM_TEMPLATES.length).toBeLessThanOrEqual(12)
  })

  it('covers every asset category at least once', () => {
    const seen = new Set(PM_TEMPLATES.map((t) => t.asset_category))
    for (const cat of ASSET_CATEGORIES) {
      expect(seen.has(cat)).toBe(true)
    }
  })

  it('uses only valid vocab tokens and shapes', () => {
    for (const t of PM_TEMPLATES) {
      expect(ASSET_CATEGORIES).toContain(t.asset_category)
      expect(PM_PRIORITIES).toContain(t.priority)
      expect(METER_SOURCES).toContain(t.meter_source)
      expect(VALID_INTERVAL_TYPES).toContain(t.interval_type)

      expect(Number.isInteger(t.interval_value)).toBe(true)
      expect(t.interval_value).toBeGreaterThan(0)

      expect(Number.isFinite(t.meter_interval)).toBe(true)
      expect(t.meter_interval).toBeGreaterThanOrEqual(0)

      // A meter axis must carry a positive interval; a 'none' axis must be 0.
      if (t.meter_source === 'none') {
        expect(t.meter_interval).toBe(0)
      } else {
        expect(t.meter_interval).toBeGreaterThan(0)
      }

      expect(Array.isArray(t.tasks)).toBe(true)
      expect(t.tasks.length).toBeGreaterThan(0)
      expect(typeof t.label).toBe('string')
      expect(t.label.length).toBeGreaterThan(0)
      expect(typeof t.notes).toBe('string')
    }
  })

  it('has unique ids', () => {
    const ids = PM_TEMPLATES.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('uses no banned punctuation in any string', () => {
    for (const t of PM_TEMPLATES) {
      expect(BANNED.test(t.label)).toBe(false)
      expect(BANNED.test(t.notes)).toBe(false)
      expect(BANNED.test(t.id)).toBe(false)
      for (const task of t.tasks) {
        expect(BANNED.test(task)).toBe(false)
      }
    }
  })
})

describe('templatesFor', () => {
  it('returns the full library when category is null or empty', () => {
    expect(templatesFor(null)).toHaveLength(PM_TEMPLATES.length)
    expect(templatesFor(undefined)).toHaveLength(PM_TEMPLATES.length)
    expect(templatesFor('')).toHaveLength(PM_TEMPLATES.length)
  })

  it('filters to a single category', () => {
    const gens = templatesFor('generator')
    expect(gens.length).toBeGreaterThan(0)
    expect(gens.every((t) => t.asset_category === 'generator')).toBe(true)
  })

  it('is case and whitespace insensitive', () => {
    expect(templatesFor(' Vehicle ')).toEqual(templatesFor('vehicle'))
  })

  it('returns an empty array for an unknown category', () => {
    expect(templatesFor('spaceship')).toEqual([])
  })

  it('returns a copy, not the internal array', () => {
    const all = templatesFor(null)
    all.push({ id: 'x' })
    expect(PM_TEMPLATES).toHaveLength(all.length - 1)
  })
})

describe('applyTemplate', () => {
  const tmpl = PM_TEMPLATES.find((t) => t.id === 'gen_250h_oil_filter')

  it('maps tasks to task_list and builds a pm_programs payload', () => {
    const payload = applyTemplate(tmpl)
    expect(payload.task_list).toEqual(tmpl.tasks)
    expect(payload.name).toBe(tmpl.label)
    expect(payload.asset_category).toBe('generator')
    expect(payload.meter_source).toBe('engine_hours')
    expect(payload.meter_interval).toBe(250)
    expect(payload.interval_type).toBe(tmpl.interval_type)
    expect(payload.interval_value).toBe(tmpl.interval_value)
    expect(payload.priority).toBe(tmpl.priority)
    expect(payload.notes).toBe(tmpl.notes)
  })

  it('sets no id or dates', () => {
    const payload = applyTemplate(tmpl)
    expect(payload).not.toHaveProperty('id')
    expect(payload).not.toHaveProperty('created_at')
    expect(payload).not.toHaveProperty('next_due')
  })

  it('honors overrides (overrides win)', () => {
    const payload = applyTemplate(tmpl, {
      name: 'GEN 07 250h service',
      asset_no: 'GEN-07',
      meter_interval: 300,
      priority: 'critical',
    })
    expect(payload.name).toBe('GEN 07 250h service')
    expect(payload.asset_no).toBe('GEN-07')
    expect(payload.meter_interval).toBe(300)
    expect(payload.priority).toBe('critical')
    // Untouched fields still come from the template.
    expect(payload.task_list).toEqual(tmpl.tasks)
    expect(payload.interval_type).toBe(tmpl.interval_type)
  })

  it('does not mutate the source template task array', () => {
    const before = tmpl.tasks.length
    const payload = applyTemplate(tmpl)
    payload.task_list.push('extra task')
    expect(tmpl.tasks).toHaveLength(before)
  })

  it('degrades honestly on a null template', () => {
    const payload = applyTemplate(null)
    expect(payload.task_list).toEqual([])
    expect(payload.asset_category).toBe('other')
    expect(payload.meter_source).toBe('none')
    expect(payload.priority).toBe('medium')
  })
})
