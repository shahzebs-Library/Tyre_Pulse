/**
 * Import Center — per-row transform / normalise engine.
 *
 * Applies a confirmed mapping to a raw row and produces three views:
 *   - mapped       : source-header → target-key rename (raw values, no coercion).
 *   - transformed  : trimmed / typed / date-normalised / unit-normalised values,
 *                    plus original-preserving fields for currency + units.
 *   - custom       : unmapped source columns preserved verbatim (NEVER dropped).
 *
 * Money is never silently converted: amount_original + currency_original are
 * preserved. Units keep both original and normalised values with the conversion
 * factor noted, supporting PSI/kPa/bar, km/miles, kg/tonnes.
 *
 * @module import/transform
 */

import { fieldDef } from './synonyms.js'

/**
 * @typedef {import('./mapping.js').MappingSuggestion} MappingSuggestion
 */

/**
 * @typedef {Object} UnitSettings
 * @property {'psi'|'kpa'|'bar'} [pressure]   Target pressure unit (default psi).
 * @property {'km'|'miles'} [distance]        Target distance unit (default km).
 * @property {'kg'|'tonnes'} [mass]           Target mass unit (default kg).
 * @property {string} [currency]              Default currency code when none in cell.
 */

/**
 * @typedef {Object} TransformOptions
 * @property {string} [dateFormat]            Hint: 'DMY' | 'MDY' | 'YMD' (default 'DMY').
 * @property {UnitSettings} [unitSettings]
 * @property {'fleet'|'tyre'|'stock'} [module]
 */

/**
 * @typedef {Object} TransformedRow
 * @property {Record<string,*>} mapped       target → raw value.
 * @property {Record<string,*>} transformed  target → cleaned/typed value (+ *_original, *_unit, *_conversion).
 * @property {Record<string,*>} custom       unmapped source header → raw value.
 */

/* ── Primitive coercers ─────────────────────────────────────────────────────── */

/** Trim a value to a clean string, or null when empty. */
function cleanString(v) {
  if (v == null) return null
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10)
  const s = String(v).trim()
  return s === '' ? null : s
}

/**
 * Parse a numeric cell that may carry separators/units, e.g. "3,940.00",
 * "240 M/H", "132282.0", "PSI 110".
 * @param {*} v
 * @returns {number|null}
 */
function parseNumeric(v) {
  if (v == null || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const m = String(v).replace(/,/g, '').match(/-?\d+(\.\d+)?/)
  return m ? parseFloat(m[0]) : null
}

/**
 * Parse a date cell honouring the supplied day/month order; returns an ISO
 * date string (YYYY-MM-DD) or null when unparseable.
 * @param {*} v
 * @param {'DMY'|'MDY'|'YMD'} order
 * @returns {string|null}
 */
function parseDate(v, order = 'DMY') {
  if (v == null || v === '') return null
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10)
  const s = String(v).trim()
  if (!s) return null

  // Numeric-only token of reasonable magnitude → Excel serial date.
  if (/^\d+(\.\d+)?$/.test(s)) {
    const serial = parseFloat(s)
    if (serial > 59 && serial < 60000) {
      // Excel epoch 1899-12-30 (accounts for the 1900 leap-year bug).
      const ms = Math.round((serial - 25569) * 86400 * 1000)
      const d = new Date(ms)
      if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10)
    }
  }

  // Explicit ISO.
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (iso) {
    const [, y, mo, da] = iso
    return `${y}-${mo.padStart(2, '0')}-${da.padStart(2, '0')}`
  }

  // Delimited numeric parts.
  const parts = s.split(/[/\-.]/).map((p) => p.trim())
  if (parts.length === 3 && parts.every((p) => /^\d+$/.test(p))) {
    let [a, b, c] = parts
    let year
    let month
    let day
    if (a.length === 4) {
      year = +a
      month = +b
      day = +c
    } else if (c.length === 4) {
      year = +c
      if (order === 'MDY') {
        month = +a
        day = +b
      } else {
        day = +a
        month = +b
      }
    } else {
      // Two-digit year: assume 2000s for <=69 else 1900s.
      year = +c <= 69 ? 2000 + +c : 1900 + +c
      if (order === 'MDY') {
        month = +a
        day = +b
      } else {
        day = +a
        month = +b
      }
    }
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    }
    return null
  }

  // Last resort: native parser (handles "12 Jan 2024" etc.).
  const d = new Date(s)
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  return null
}

/* ── Unit normalisation ─────────────────────────────────────────────────────── */

/** Pressure → PSI base factors. */
const PSI_PER = { psi: 1, kpa: 0.1450377, bar: 14.5037738 }
/** Distance → km base factors. */
const KM_PER = { km: 1, miles: 1.609344 }
/** Mass → kg base factors. */
const KG_PER = { kg: 1, tonnes: 1000, tonne: 1000, t: 1000 }

const round = (n, p = 4) => (n == null ? null : Math.round(n * 10 ** p) / 10 ** p)

/** Detect an explicit unit token inside a cell string. */
function detectUnit(raw, map) {
  if (raw == null) return null
  const s = String(raw).toLowerCase()
  for (const u of Object.keys(map)) {
    if (s.includes(u)) return u
  }
  return null
}

/**
 * Normalise a pressure value to the target unit, preserving the original.
 * @returns {{ value:number|null, original:number|null, originalUnit:string, unit:string, conversion:number }|null}
 */
function normalisePressure(raw, targetUnit) {
  const num = parseNumeric(raw)
  if (num == null) return null
  const target = PSI_PER[targetUnit] ? targetUnit : 'psi'
  const srcUnit = detectUnit(raw, PSI_PER) || target
  const psi = num * PSI_PER[srcUnit]
  const value = psi / PSI_PER[target]
  return {
    value: round(value),
    original: num,
    originalUnit: srcUnit,
    unit: target,
    conversion: round(PSI_PER[srcUnit] / PSI_PER[target], 6),
  }
}

/** Normalise a distance value to the target unit, preserving the original. */
function normaliseDistance(raw, targetUnit) {
  const num = parseNumeric(raw)
  if (num == null) return null
  const target = KM_PER[targetUnit] ? targetUnit : 'km'
  const srcUnit = detectUnit(raw, { mi: 1.609344, miles: 1.609344, km: 1 }) ? (String(raw).toLowerCase().includes('mi') ? 'miles' : 'km') : target
  const km = num * KM_PER[srcUnit]
  const value = km / KM_PER[target]
  return {
    value: round(value, 3),
    original: num,
    originalUnit: srcUnit,
    unit: target,
    conversion: round(KM_PER[srcUnit] / KM_PER[target], 6),
  }
}

/** Normalise a mass value to the target unit, preserving the original. */
function normaliseMass(raw, targetUnit) {
  const num = parseNumeric(raw)
  if (num == null) return null
  const target = KG_PER[targetUnit] ? targetUnit : 'kg'
  const srcUnit = detectUnit(raw, KG_PER) || target
  const kg = num * KG_PER[srcUnit]
  const value = kg / KG_PER[target]
  return {
    value: round(value, 3),
    original: num,
    originalUnit: srcUnit,
    unit: target,
    conversion: round(KG_PER[srcUnit] / KG_PER[target], 6),
  }
}

/** Parse a currency cell into amount + detected currency code (never converts). */
function parseCurrency(raw, defaultCurrency) {
  if (raw == null || raw === '') return null
  const s = String(raw).trim()
  const symbolMap = { $: 'USD', '€': 'EUR', '£': 'GBP', '₹': 'INR' }
  const codeMatch = s.match(/\b(USD|EUR|GBP|SAR|AED|QAR|KWD|OMR|BHD|INR|EGP|JOD)\b/i)
  let currency = codeMatch ? codeMatch[1].toUpperCase() : null
  if (!currency) {
    for (const sym of Object.keys(symbolMap)) {
      if (s.includes(sym)) {
        currency = symbolMap[sym]
        break
      }
    }
  }
  const amount = parseNumeric(s)
  if (amount == null) return null
  return { amount, currency: currency || defaultCurrency || null }
}

/* ── Public API ─────────────────────────────────────────────────────────────── */

/**
 * Transform a raw row using a confirmed mapping.
 *
 * @param {Record<string,*>} rawRow                    Header-keyed raw row.
 * @param {MappingSuggestion[]|Record<string,string>} mapping
 *   Either an array of suggestions or a plain { sourceHeader: target } map.
 * @param {TransformOptions} [options]
 * @returns {TransformedRow}
 */
export function transformRow(rawRow, mapping, options = {}) {
  const dateOrder = options.dateFormat || 'DMY'
  const units = options.unitSettings || {}
  const module = options.module || 'tyre'

  // Normalise the mapping into source→target pairs, ignoring custom/null targets.
  /** @type {Array<[string,string]>} */
  const pairs = []
  /** @type {Set<string>} */
  const mappedSources = new Set()
  if (Array.isArray(mapping)) {
    for (const m of mapping) {
      if (m && m.target && m.sourceHeader != null) {
        pairs.push([m.sourceHeader, m.target])
        mappedSources.add(m.sourceHeader)
      }
    }
  } else if (mapping && typeof mapping === 'object') {
    for (const [src, target] of Object.entries(mapping)) {
      if (target) {
        pairs.push([src, target])
        mappedSources.add(src)
      }
    }
  }

  /** @type {Record<string,*>} */
  const mapped = {}
  /** @type {Record<string,*>} */
  const transformed = {}

  for (const [src, target] of pairs) {
    const raw = rawRow[src]
    // mapped keeps the raw value; when many sources combine into one target the
    // first non-empty wins and later non-empty values are space-joined.
    if (mapped[target] == null || mapped[target] === '') mapped[target] = raw
    else if (raw != null && String(raw).trim() !== '') mapped[target] = `${mapped[target]} ${raw}`.trim()

    const def = fieldDef(target, module)
    const type = def ? def.type : 'string'

    switch (type) {
      case 'date': {
        const iso = parseDate(raw, dateOrder)
        transformed[target] = iso
        transformed[`${target}_original`] = cleanString(raw)
        break
      }
      case 'integer': {
        const n = parseNumeric(raw)
        transformed[target] = n == null ? null : Math.trunc(n)
        break
      }
      case 'number': {
        transformed[target] = parseNumeric(raw)
        break
      }
      case 'currency': {
        const c = parseCurrency(raw, units.currency)
        if (c) {
          transformed[target] = c.amount
          transformed.amount_original = c.amount
          transformed.currency_original = c.currency
          transformed[`${target}_currency`] = c.currency
        } else {
          transformed[target] = null
        }
        break
      }
      case 'pressure': {
        const r = normalisePressure(raw, units.pressure || 'psi')
        if (r) {
          transformed[target] = r.value
          transformed[`${target}_original`] = r.original
          transformed[`${target}_original_unit`] = r.originalUnit
          transformed[`${target}_unit`] = r.unit
          transformed[`${target}_conversion`] = r.conversion
        } else transformed[target] = null
        break
      }
      case 'distance': {
        const r = normaliseDistance(raw, units.distance || 'km')
        if (r) {
          transformed[target] = r.value
          transformed[`${target}_original`] = r.original
          transformed[`${target}_original_unit`] = r.originalUnit
          transformed[`${target}_unit`] = r.unit
          transformed[`${target}_conversion`] = r.conversion
        } else transformed[target] = null
        break
      }
      case 'mass': {
        const r = normaliseMass(raw, units.mass || 'kg')
        if (r) {
          transformed[target] = r.value
          transformed[`${target}_original`] = r.original
          transformed[`${target}_original_unit`] = r.originalUnit
          transformed[`${target}_unit`] = r.unit
          transformed[`${target}_conversion`] = r.conversion
        } else transformed[target] = null
        break
      }
      default: {
        transformed[target] = cleanString(raw)
      }
    }
  }

  // Preserve every unmapped source column verbatim.
  /** @type {Record<string,*>} */
  const custom = {}
  for (const [key, value] of Object.entries(rawRow)) {
    if (mappedSources.has(key)) continue
    if (value === '' || value == null) continue
    custom[key] = value
  }

  return { mapped, transformed, custom }
}

export { parseDate, parseNumeric, normalisePressure, normaliseDistance, normaliseMass, parseCurrency }
