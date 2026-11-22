/**
 * Material Master and Initial Physical Inventory view helpers (pure, no I/O).
 *
 * Every figure here is derived from what the server returned
 * (inv_material_search, inv_pi_dashboard, inventory_audits). Nothing is
 * invented: an unknown value comes back as null so the screen prints N/A.
 */

export const MM_FILTERS = ['all', 'genuine', 'aftermarket', 'unverified']

const num = (v) => {
  if (v === null || v === undefined || v === '') return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

const isGenuine = (cls) => cls === 'genuine' || cls === 'oes'

/** Which identification systems a search result carries. */
export function classifyMaterial(result) {
  const variants = Array.isArray(result?.variants) ? result.variants : []
  const live = variants.filter((v) => v && v.status !== 'rejected' && v.status !== 'retired')
  const genuine = live.some((v) => isGenuine(v.classification) && v.status === 'active')
  const aftermarket = live.some((v) => v.classification === 'aftermarket' && v.status === 'active')
  const unverified = result?.status === 'proposed'
    || live.some((v) => v.status === 'proposed' || v.classification === 'unknown')
    || (!genuine && !aftermarket)
  return { genuine, aftermarket, unverified }
}

/** Counts for the filter chips. A result can be both genuine and aftermarket. */
export function filterCounts(results) {
  const rows = Array.isArray(results) ? results : []
  const out = { all: rows.length, genuine: 0, aftermarket: 0, unverified: 0 }
  for (const r of rows) {
    const c = classifyMaterial(r)
    if (c.genuine) out.genuine += 1
    if (c.aftermarket) out.aftermarket += 1
    if (c.unverified) out.unverified += 1
  }
  return out
}

export function categoriesOf(results) {
  const set = new Set()
  for (const r of results || []) if (r?.category) set.add(String(r.category))
  return [...set].sort((a, b) => a.localeCompare(b))
}

export function applyMaterialFilter(results, filter = 'all', category = 'all') {
  return (results || []).filter((r) => {
    if (category !== 'all' && String(r?.category || '') !== category) return false
    if (filter === 'all') return true
    return !!classifyMaterial(r)[filter]
  })
}

/** First active reference of a type, else the first of that type, else null. */
export function referenceOf(result, type) {
  const refs = (result?.references || []).filter((r) => r && r.type === type)
  const pick = refs.find((r) => r.status === 'active') || refs[0]
  return pick?.value || null
}

/** OEM part number: an OEM reference, else a genuine variant's part number. */
export function oemPartNumber(result) {
  const ref = referenceOf(result, 'oem')
  if (ref) return ref
  const v = (result?.variants || []).find((x) => isGenuine(x?.classification) && x.part_number)
  return v?.part_number || null
}

/** Manufacturer part number: the matched variant first, then any variant. */
export function manufacturerPartNumber(result) {
  const variants = result?.variants || []
  const v = variants.find((x) => x?.matched && x.part_number) || variants.find((x) => x?.part_number)
  return v?.part_number || null
}

/** Verified aftermarket / alternative references for the references table. */
export function alternativeReferences(result) {
  const refs = (result?.references || [])
    .filter((r) => r && (r.type === 'aftermarket' || r.type === 'alternative'))
    .map((r) => ({ manufacturer: r.manufacturer || null, partNumber: r.value, verified: !!r.verified, status: r.status || null }))
  const fromVariants = (result?.variants || [])
    .filter((v) => v?.classification === 'aftermarket' && v.part_number)
    .map((v) => ({ manufacturer: v.manufacturer || v.brand || null, partNumber: v.part_number, verified: v.status === 'active', status: v.status || null }))
  const seen = new Set()
  return [...refs, ...fromVariants].filter((r) => {
    const k = `${r.manufacturer || ''}|${r.partNumber}`.toUpperCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

const AVAIL_KEYS = ['available', 'reserved', 'in_transit', 'damaged', 'quarantined']

function siteRows(result) {
  const out = []
  for (const v of result?.variants || []) {
    for (const a of v?.availability || []) out.push({ ...a, cls: v.classification })
  }
  for (const a of result?.availability_unassigned || []) out.push({ ...a, cls: null })
  return out
}

/**
 * Available stock per store split by genuine and aftermarket. Stock held on an
 * unassigned or unknown-classification line counts in Total only, so Total can
 * be larger than Genuine plus Aftermarket (shown as `other`).
 */
export function storeAvailability(result) {
  const bySite = new Map()
  for (const r of siteRows(result)) {
    const site = String(r.site || '').trim() || 'N/A'
    const row = bySite.get(site) || { site, genuine: 0, aftermarket: 0, other: 0, total: 0 }
    const qty = num(r.available)
    if (isGenuine(r.cls)) row.genuine += qty
    else if (r.cls === 'aftermarket') row.aftermarket += qty
    else row.other += qty
    row.total += qty
    bySite.set(site, row)
  }
  const rows = [...bySite.values()].sort((a, b) => a.site.localeCompare(b.site))
  const totals = rows.reduce((t, r) => ({
    genuine: t.genuine + r.genuine, aftermarket: t.aftermarket + r.aftermarket, other: t.other + r.other, total: t.total + r.total,
  }), { genuine: 0, aftermarket: 0, other: 0, total: 0 })
  return { rows, totals }
}

/** Available / reserved / in transit / damaged / quarantined per store. */
export function crossLocationStock(result) {
  const bySite = new Map()
  for (const r of siteRows(result)) {
    const site = String(r.site || '').trim() || 'N/A'
    const row = bySite.get(site) || { site, ...Object.fromEntries(AVAIL_KEYS.map((k) => [k, 0])), total: 0 }
    for (const k of AVAIL_KEYS) row[k] += num(r[k])
    row.total = AVAIL_KEYS.reduce((s, k) => s + row[k], 0)
    bySite.set(site, row)
  }
  const rows = [...bySite.values()].sort((a, b) => a.site.localeCompare(b.site))
  const totals = { ...Object.fromEntries(AVAIL_KEYS.map((k) => [k, rows.reduce((s, r) => s + r[k], 0)])) }
  totals.total = AVAIL_KEYS.reduce((s, k) => s + totals[k], 0)
  return { rows, totals }
}

/**
 * The four headline tiles of the Inventory Control Center. `dashboard` is the
 * inv_pi_dashboard payload (or { status: 'not_provisioned' } / null).
 */
export function inventoryKpis(dashboard) {
  if (!dashboard || dashboard.status !== 'ok') {
    return { identified: null, unidentified: null, pendingCorrections: null, captures: null }
  }
  const captures = num(dashboard.captures)
  const identified = num(dashboard.identified)
  const rejected = num(dashboard.rejected)
  return {
    captures,
    identified,
    unidentified: Math.max(0, captures - identified - rejected),
    pendingCorrections: num(dashboard.pending_corrections),
  }
}

const DONE = new Set(['closed', 'adjustment_posted'])
const EXCLUDED = new Set(['cancelled', 'rejected'])

/**
 * Audit completion: closed (or adjustment posted) audits over every audit that
 * was not cancelled or rejected. No audits -> pct null (N/A), never 0 or 100.
 */
export function auditCompletion(audits) {
  const rows = (audits || []).filter((a) => a && !EXCLUDED.has(a.status))
  const bySite = new Map()
  for (const a of rows) {
    const site = String(a.site || '').trim() || 'N/A'
    const s = bySite.get(site) || { site, done: 0, total: 0 }
    s.total += 1
    if (DONE.has(a.status)) s.done += 1
    bySite.set(site, s)
  }
  const sites = [...bySite.values()]
    .map((s) => ({ ...s, pct: s.total ? Math.round((s.done / s.total) * 100) : null }))
    .sort((a, b) => a.site.localeCompare(b.site))
  const done = sites.reduce((n, s) => n + s.done, 0)
  const total = sites.reduce((n, s) => n + s.total, 0)
  return { done, total, pct: total ? Math.round((done / total) * 100) : null, sites }
}

/** Corrections that concern one material (its canonical id or any variant id). */
export function correctionsFor(result, corrections) {
  const ids = new Set([result?.canonical_id, ...(result?.variants || []).map((v) => v?.variant_id)].filter(Boolean))
  return (corrections || []).filter((c) => c && ids.has(c.target_id))
}
