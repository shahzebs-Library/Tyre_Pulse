import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import en from '../locales/en/inventory.json'
import ar from '../locales/ar/inventory.json'
import { SECTION_KEYS, GROUPS, INVENTORY_CAPABILITIES } from '../lib/inventory/hubSections'
import { AUDIT_TYPES, AUDIT_STATUSES, DISCREPANCY_CATEGORIES, DISCREPANCY_STATUSES } from '../lib/inventory/auditView'
import { LOCATION_TYPES } from '../lib/inventory/locationTree'
import { CUSTODY_STATES } from '../lib/inventory/tyreInventoryView'
import { OB_FIELDS, OB_STATUSES } from '../lib/inventory/openingBalance'
import { REPORTS } from '../lib/inventory/reportCatalog'
import { CORE_OBJECTS } from '../lib/api/inventory'

const leaves = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? leaves(v, `${p}${k}.`) : [`${p}${k}`]))
const get = (o, path) => path.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o)

describe('inventory locale', () => {
  it('has identical key sets in English and Arabic', () => {
    expect(leaves(ar).sort()).toEqual(leaves(en).sort())
  })

  it('uses single-brace placeholders that match between languages', () => {
    for (const k of leaves(en)) {
      const a = get(en, k)
      const b = get(ar, k)
      expect(a).not.toMatch(/\{\{/)
      const ph = (s) => (s.match(/\{(\w+)\}/g) || []).sort()
      expect(ph(b), k).toEqual(ph(a))
      expect(a, k).not.toMatch(/[–—]/)
    }
  })

  it('covers every dynamic key family the hub renders', () => {
    const families = {
      sections: SECTION_KEYS, auditTypes: AUDIT_TYPES, auditStatus: AUDIT_STATUSES, discCategories: DISCREPANCY_CATEGORIES,
      discStatus: DISCREPANCY_STATUSES, locationTypes: LOCATION_TYPES, custody: CUSTODY_STATES, caps: INVENTORY_CAPABILITIES,
      'opening.field': OB_FIELDS.map((f) => f.key), 'opening.status': OB_STATUSES, objects: CORE_OBJECTS,
      groups: GROUPS.map((g) => g.key),
    }
    for (const [prefix, keys] of Object.entries(families)) {
      for (const k of keys) expect(typeof get(en, `${prefix}.${k}`), `${prefix}.${k}`).toBe('string')
    }
    for (const r of REPORTS) expect(typeof get({ inventory: en }, r.titleKey)).toBe('string')
  })

  it('every literal inventory key used in the hub source resolves', () => {
    const dirs = ['src/components/inventory', 'src/lib/inventory']
    const files = dirs.flatMap((d) => readdirSync(resolve(d)).map((f) => join(d, f))).concat(['src/pages/StockManagement.jsx'])
    const missing = []
    for (const f of files.filter((x) => /\.(js|jsx)$/.test(x))) {
      const src = readFileSync(resolve(f), 'utf8')
      for (const m of src.matchAll(/['`](inventory\.[A-Za-z0-9_.]+)['`]/g)) {
        const key = m[1]
        if (key.endsWith('.')) continue
        if (typeof get({ inventory: en }, key) !== 'string') missing.push(`${f}: ${key}`)
      }
    }
    expect(missing).toEqual([])
  })
})
