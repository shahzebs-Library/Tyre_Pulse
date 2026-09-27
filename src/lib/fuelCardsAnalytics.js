/**
 * fuelCardsAnalytics - pure presentation engine for the Fuel Card Management
 * page (/fuel-cards). Built on ./fuelCards.js (masking, expiry banding,
 * assignment); this adds filtering, the KPI strip, provider / expiry
 * breakdowns, data-quality findings and the export shape.
 *
 * Rules:
 *   - Card numbers are PII: only the masked form ever leaves this module.
 *   - `now` is injected (Date or ms) so banding is deterministic.
 *   - fuel_cards carries no currency column; a card's limit is in its own
 *     country's currency. When the set spans more than one country the total
 *     limit is null (never a blend of currencies) and the per-country split is
 *     returned instead.
 */
import { maskCardNumber, cardExpiryStatus, isCardAssigned, EXPIRY_BAND_META, FUEL_CARD_STATUS_META } from './fuelCards'

const num = (v) => {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const str = (v) => (v == null ? '' : String(v))

export function statusLabel(s) {
  return FUEL_CARD_STATUS_META[s]?.label || (s ? String(s) : 'Unknown')
}
export function expiryLabel(b) {
  return EXPIRY_BAND_META[b]?.label || 'No expiry'
}

/** Attach expiry band/days, assignment and parsed limit to each card. */
export function enrichCards(rows = [], now = Date.now()) {
  return (Array.isArray(rows) ? rows : []).map((c) => {
    const exp = cardExpiryStatus(c, now)
    return {
      ...c,
      masked: maskCardNumber(c?.card_number),
      expiryBand: exp.band,
      expiryDays: exp.days,
      assigned: isCardAssigned(c),
      limitValue: num(c?.monthly_limit),
      // A card marked active whose expiry date has passed: the status is stale.
      staleActive: c?.status === 'active' && exp.band === 'expired',
    }
  })
}

/**
 * Filter enriched cards. `expiry` is an EXPIRY_BANDS key, `assignment` is
 * '' | 'assigned' | 'unassigned'. Search matches the FULL card number (operator
 * convenience) but the value is never rendered in full.
 */
export function filterCards(cards = [], { status = 'all', provider = '', expiry = '', assignment = '', search = '' } = {}) {
  const q = str(search).trim().toLowerCase()
  return (Array.isArray(cards) ? cards : []).filter((r) => {
    if (status !== 'all' && r?.status !== status) return false
    if (provider && r?.provider !== provider) return false
    if (expiry && r?.expiryBand !== expiry) return false
    if (assignment === 'assigned' && !r?.assigned) return false
    if (assignment === 'unassigned' && r?.assigned) return false
    if (q) {
      const hay = [r?.card_number, r?.provider, r?.asset_no, r?.driver_name, r?.notes].map(str).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Monthly limit per country; headline only when every card is one country. */
export function limitByCountry(cards = [], activeCountry = '') {
  const map = new Map()
  let withLimit = 0
  for (const c of Array.isArray(cards) ? cards : []) {
    const v = num(c?.monthly_limit)
    if (v == null) continue
    withLimit += 1
    const k = str(c?.country).trim() || (activeCountry && activeCountry !== 'All' ? activeCountry : 'Unspecified')
    map.set(k, (map.get(k) || 0) + v)
  }
  const totals = [...map.entries()].map(([country, total]) => ({ country, total })).sort((a, b) => b.total - a.total)
  return { totals, withLimit, mixed: totals.length > 1, total: totals.length === 1 ? totals[0].total : null }
}

/** Count cards by a key function, largest first. */
function countBy(list, fn, labelFn = (k) => k) {
  const map = new Map()
  for (const r of list) {
    const k = fn(r)
    map.set(k, (map.get(k) || 0) + 1)
  }
  return [...map.entries()].map(([key, count]) => ({ key, label: labelFn(key), count })).sort((a, b) => b.count - a.count)
}

export function providerBreakdown(cards = []) {
  return countBy(Array.isArray(cards) ? cards : [], (r) => str(r?.provider).trim() || 'Unspecified')
}

export function expiryBreakdown(cards = []) {
  const order = ['expired', 'expiring', 'valid', 'unknown']
  const list = Array.isArray(cards) ? cards : []
  return order.map((b) => ({ key: b, label: expiryLabel(b), count: list.filter((r) => r?.expiryBand === b).length }))
}

export function buildFuelCardKpis(cards = [], activeCountry = '') {
  const list = Array.isArray(cards) ? cards : []
  const by = (s) => list.filter((r) => r?.status === s).length
  return {
    total: list.length,
    active: by('active'),
    blocked: by('blocked'),
    unassigned: list.filter((r) => !r?.assigned).length,
    expiring: list.filter((r) => r?.expiryBand === 'expiring').length,
    expired: list.filter((r) => r?.expiryBand === 'expired').length,
    noExpiry: list.filter((r) => r?.expiryBand === 'unknown').length,
    staleActive: list.filter((r) => r?.staleActive).length,
    limit: limitByCountry(list, activeCountry),
  }
}

/** Duplicate card numbers (compared on digits) - one physical card twice. */
export function duplicateCards(cards = []) {
  const map = new Map()
  for (const c of Array.isArray(cards) ? cards : []) {
    const d = str(c?.card_number).replace(/\D/g, '')
    if (!d) continue
    map.set(d, (map.get(d) || 0) + 1)
  }
  return [...map.values()].filter((n) => n > 1).length
}

export function buildFuelCardInsights(cards = [], activeCountry = '') {
  const list = Array.isArray(cards) ? cards : []
  if (!list.length) return []
  const k = buildFuelCardKpis(list, activeCountry)
  const out = []
  if (k.staleActive) out.push(`${k.staleActive} card(s) are marked Active but their expiry date has passed. Update or block them.`)
  if (k.expiring) out.push(`${k.expiring} card(s) expire within 30 days.`)
  const dups = duplicateCards(list)
  if (dups) out.push(`${dups} card number(s) are registered more than once.`)
  const activeUnassigned = list.filter((r) => r?.status === 'active' && !r?.assigned).length
  if (activeUnassigned) out.push(`${activeUnassigned} active card(s) are not assigned to a vehicle or driver, which is an uncontrolled spend risk.`)
  if (k.noExpiry) out.push(`${k.noExpiry} card(s) have no expiry date recorded.`)
  if (k.limit.mixed) out.push(`Cards span ${k.limit.totals.length} countries, so limits are shown per country rather than as one total.`)
  return out
}

export const FUEL_CARD_EXPORT_COLUMNS = [
  { key: 'card', header: 'Card' },
  { key: 'provider', header: 'Provider' },
  { key: 'asset_no', header: 'Asset' },
  { key: 'driver_name', header: 'Driver' },
  { key: 'monthly_limit', header: 'Monthly limit' },
  { key: 'country', header: 'Country' },
  { key: 'status', header: 'Status' },
  { key: 'expiry_date', header: 'Expiry' },
  { key: 'expiry', header: 'Expiry status' },
  { key: 'days_left', header: 'Days to expiry' },
]

/** Export shape. Card numbers are masked here too - never exported in full. */
export function fuelCardExportRows(cards = []) {
  return (Array.isArray(cards) ? cards : []).map((r) => ({
    card: r.masked ?? maskCardNumber(r.card_number),
    provider: r.provider || '',
    asset_no: r.asset_no || '',
    driver_name: r.driver_name || '',
    monthly_limit: r.limitValue ?? '',
    country: r.country || '',
    status: statusLabel(r.status),
    expiry_date: /^\d{4}-\d{2}-\d{2}/.test(str(r.expiry_date)) ? str(r.expiry_date).slice(0, 10) : '',
    expiry: expiryLabel(r.expiryBand),
    days_left: r.expiryDays ?? '',
  }))
}
