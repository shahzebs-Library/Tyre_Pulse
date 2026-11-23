/**
 * Material Master catalogue view helpers (pure, no I/O).
 *
 * The catalogue list shows, for every company material, what the data actually
 * states: brand, part type, fitment, key specs, posted stock and the opening
 * stock still waiting for approval. Nothing is invented: an unknown value comes
 * back as null (the screen prints "Not stated" / N/A), and a part type is only
 * shown when a variant of the material carries it.
 *
 * Data sources (see src/lib/api/physicalInventory.js listMaterialCatalog):
 *  - material_canonical: brand / manufacturer / specs (specs.brand, fits_vehicle ...)
 *  - material_variants.part_classification: genuine | oes | aftermarket | unknown
 *  - material_aliases alias_type 'oem': OEM part numbers
 *  - v_inv_balances (stock_records): posted stock, matched on item_code = company SKU
 *  - opening_balance_lines in draft / submitted batches: pending opening stock
 */

/**
 * Part types the badge can show, strongest first. `local` is accepted if a
 * future vocabulary adds it, but the live CHECK (genuine / oes / aftermarket /
 * unknown) has no local meaning, so today it is never derived.
 */
export const PART_TYPES = ['genuine', 'oes', 'aftermarket', 'local', 'not_stated']
/** Filter values offered in the list. */
export const PART_TYPE_FILTERS = ['all', 'genuine', 'oes', 'aftermarket', 'not_stated']
/** Database classifications counted as a stated part type. */
export const STATED_CLASSES = ['genuine', 'oes', 'aftermarket', 'local']
export const MATERIAL_STATUSES = ['proposed', 'active', 'rejected']
export const STOCK_FILTERS = ['all', 'posted', 'pending']
/** Opening batches whose lines are not yet posted stock. */
export const PENDING_BATCH_STATUSES = ['draft', 'submitted']
/** Key specs shown when present, in this order. */
export const SPEC_KEYS = ['size', 'side', 'position', 'electrical', 'capacity', 'pack', 'colour', 'material']

const LIVE_VARIANT = (v) => v && v.status !== 'rejected' && v.status !== 'retired'
const RANK = { genuine: 0, oes: 1, aftermarket: 2, local: 3 }

const clean = (v) => {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s && s.toLowerCase() !== 'null' && s.toLowerCase() !== 'undefined' ? s : null
}
const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
export const skuKey = (v) => (clean(v) || '').toUpperCase()

/** Normalise one stored classification to a badge key ('not_stated' when unknown or missing). */
export function partTypeKey(classification) {
  const c = clean(classification)?.toLowerCase()
  return c && Object.hasOwn(RANK, c) ? c : 'not_stated'
}

/** Every distinct stated part type over a material's live variants, strongest first. */
export function partTypesOf(variants) {
  const set = new Set()
  for (const v of variants || []) {
    if (!LIVE_VARIANT(v)) continue
    const k = partTypeKey(v.part_classification ?? v.classification)
    if (k !== 'not_stated') set.add(k)
  }
  return [...set].sort((a, b) => RANK[a] - RANK[b])
}

/** The single badge for a material: the strongest stated part type, else 'not_stated'. */
export function partTypeOf(variants) {
  return partTypesOf(variants)[0] || 'not_stated'
}

export function partTypeTone(key) {
  if (key === 'genuine' || key === 'oes') return 'good'
  if (key === 'aftermarket' || key === 'local') return 'warn'
  return 'muted'
}

const specsOf = (m) => (m?.specs && typeof m.specs === 'object' && !Array.isArray(m.specs) ? m.specs : {})

/** Brand: the brand column, then specs.brand, then the manufacturer. Null when none is stated. */
export function brandOf(m) {
  return clean(m?.brand) || clean(specsOf(m).brand) || clean(m?.manufacturer)
}

/**
 * Brand line for display: the brand, plus the manufacturer when it differs
 * ("Fleetguard (Cummins)"). Null when neither is stated.
 */
export function brandLine(m) {
  const brand = clean(m?.brand) || clean(specsOf(m).brand)
  const maker = clean(m?.manufacturer)
  if (brand && maker && brand.toLowerCase() !== maker.toLowerCase()) return `${brand} (${maker})`
  return brand || maker
}

export const subCategoryOf = (m) => clean(specsOf(m).sub_category)
export const fitsVehicleOf = (m) => clean(specsOf(m).fits_vehicle)
export const itemTypeOf = (m) => clean(specsOf(m).item_type)
export const originalDescriptionOf = (m) => clean(specsOf(m).original_description)

/** Present key specs as [key, value] pairs in SPEC_KEYS order. */
export function keySpecs(m) {
  const s = specsOf(m)
  const out = []
  for (const k of SPEC_KEYS) {
    const v = s[k]
    const text = Array.isArray(v) ? v.map(clean).filter(Boolean).join(', ') : clean(v)
    if (text) out.push([k, text])
  }
  return out
}

/** OEM part numbers: OEM aliases, then genuine / OES variant part numbers. Distinct, in order. */
export function oemNumbers(aliases, variants) {
  const seen = new Set()
  const out = []
  const add = (v) => {
    const s = clean(v)
    if (!s || seen.has(s.toUpperCase())) return
    seen.add(s.toUpperCase())
    out.push(s)
  }
  for (const a of aliases || []) if (a && (a.alias_type || 'oem') === 'oem' && a.ref_status !== 'historical') add(a.value)
  for (const v of variants || []) {
    if (LIVE_VARIANT(v) && ['genuine', 'oes'].includes(partTypeKey(v.part_classification ?? v.classification))) add(v.part_number)
  }
  return out
}

/** Posted stock from balance lines: per store on hand / reserved, summed. */
export function postedStock(balances) {
  const bySite = new Map()
  const uoms = new Set()
  for (const b of balances || []) {
    if (!b) continue
    const site = clean(b.site) || 'N/A'
    const row = bySite.get(site) || { site, country: clean(b.country), onHand: 0, reserved: 0, lines: 0 }
    row.onHand += num(b.qty_on_hand)
    row.reserved += num(b.qty_reserved)
    row.lines += 1
    bySite.set(site, row)
    if (clean(b.uom)) uoms.add(clean(b.uom))
  }
  const sites = [...bySite.values()].sort((a, b) => a.site.localeCompare(b.site))
  return {
    sites,
    onHand: sites.reduce((s, r) => s + r.onHand, 0),
    reserved: sites.reduce((s, r) => s + r.reserved, 0),
    uom: uoms.size === 1 ? [...uoms][0] : null,
    mixedUom: uoms.size > 1,
  }
}

/**
 * Opening stock not yet approved: lines in draft or submitted batches only.
 * Approved / rejected / cancelled batches are ignored (approved lines are
 * already posted stock; the others will never be).
 */
export function pendingOpening(lines) {
  const bySite = new Map()
  const batches = new Set()
  const statuses = new Set()
  const uoms = new Set()
  for (const l of lines || []) {
    const status = clean(l?.batch?.status ?? l?.batch_status)
    if (!l || !PENDING_BATCH_STATUSES.includes(status)) continue
    const site = clean(l.batch?.site ?? l.site) || 'N/A'
    const row = bySite.get(site) || { site, country: clean(l.batch?.country ?? l.country), qty: 0, lines: 0, statuses: [] }
    row.qty += num(l.qty)
    row.lines += 1
    if (!row.statuses.includes(status)) row.statuses.push(status)
    bySite.set(site, row)
    if (l.batch_id) batches.add(l.batch_id)
    statuses.add(status)
    if (clean(l.uom)) uoms.add(clean(l.uom))
  }
  const sites = [...bySite.values()].sort((a, b) => a.site.localeCompare(b.site))
  return {
    sites,
    qty: sites.reduce((s, r) => s + r.qty, 0),
    lines: sites.reduce((s, r) => s + r.lines, 0),
    batches: batches.size,
    statuses: [...statuses].sort(),
    uom: uoms.size === 1 ? [...uoms][0] : null,
    mixedUom: uoms.size > 1,
  }
}

const groupBy = (rows, key) => {
  const m = new Map()
  for (const r of rows || []) {
    const k = key(r)
    if (!k) continue
    const list = m.get(k)
    if (list) list.push(r)
    else m.set(k, [r])
  }
  return m
}

/**
 * Join one page of materials with its batched lookups. A lookup passed as null
 * means "could not be read": the matching fields come back null (N/A), never 0.
 */
export function enrichMaterials(materials, { variants, aliases, balances, openingLines } = {}) {
  const vBy = variants ? groupBy(variants, (v) => v.canonical_id) : null
  const aBy = aliases ? groupBy(aliases, (a) => a.canonical_id) : null
  const bBy = balances ? groupBy(balances, (b) => skuKey(b.item_code)) : null
  const lBy = openingLines ? groupBy(openingLines, (l) => skuKey(l.item_code_raw ?? l.item_code)) : null
  return (materials || []).map((m) => {
    const vs = vBy ? vBy.get(m.id) || [] : null
    const sku = skuKey(m.company_sku)
    return {
      ...m,
      brandLine: brandLine(m),
      subCategory: subCategoryOf(m),
      fitsVehicle: fitsVehicleOf(m),
      itemType: itemTypeOf(m),
      originalDescription: originalDescriptionOf(m),
      specList: keySpecs(m),
      variantRows: vs,
      partType: vs ? partTypeOf(vs) : null,
      partTypes: vs ? partTypesOf(vs) : null,
      oem: vs && aBy ? oemNumbers(aBy.get(m.id) || [], vs) : null,
      posted: bBy ? postedStock(sku ? bBy.get(sku) || [] : []) : null,
      pending: lBy ? pendingOpening(sku ? lBy.get(sku) || [] : []) : null,
    }
  })
}

/** Distinct brands and categories for the filter dropdowns. */
export function catalogFacets(rows) {
  const brands = new Set()
  const cats = new Set()
  for (const r of rows || []) {
    for (const b of [r?.brand, r?.manufacturer, r?.spec_brand]) if (clean(b)) brands.add(clean(b))
    if (clean(r?.category)) cats.add(clean(r.category))
  }
  const sort = (s) => [...s].sort((a, b) => a.localeCompare(b))
  return { brands: sort(brands), categories: sort(cats) }
}

/** PostgREST-safe quoted literal for an `.or()` filter value. */
export function quoteFilterValue(v) {
  return `"${String(v ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}
