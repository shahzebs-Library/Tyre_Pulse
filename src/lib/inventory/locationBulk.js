/**
 * Bulk location planning (pure, no I/O).
 *
 * The store keeper describes a layout once ("racks A to C, 5 shelves each,
 * 10 bins per shelf") and this builds every location the server would create,
 * so the screen can PREVIEW it before anything is saved. Nothing is invented:
 * every code comes from what the person typed (prefix, rack codes, counts),
 * and a code that already exists at the store is reused, never duplicated.
 *
 * The server (inv_location_bulk_create) re-checks everything; this only makes
 * the preview honest and stops an obviously bad plan from being sent.
 */

export const BULK_MAX_NODES = 500
export const BULK_TYPES = ['warehouse', 'zone', 'rack', 'shelf', 'bin']
const CODE_RE = /^[A-Z0-9][A-Z0-9._-]{0,39}$/
const MAX_COUNT = 99

/** MIRROR of app_is_elevated(), the server gate on both location writers. */
export function canManageLocations({ role, isSuperAdmin } = {}) {
  if (isSuperAdmin) return true
  return ['admin', 'manager', 'director'].includes(String(role || '').trim().toLowerCase())
}

/** A child type that usually sits under a parent type (form default only). */
export function suggestChildType(parentType) {
  switch (parentType) {
    case 'warehouse': return 'zone'
    case 'zone': return 'rack'
    case 'rack': return 'shelf'
    case 'shelf': return 'bin'
    default: return 'warehouse'
  }
}

const up = (v) => String(v ?? '').trim().toUpperCase()

/**
 * "A, B" -> [A, B]; "A-C" -> [A, B, C]; "1-3" -> [1, 2, 3].
 * Returns { codes, error } where error is an i18n key.
 */
export function parseRackList(text) {
  const raw = String(text || '').trim()
  if (!raw) return { codes: [], error: null }
  const out = []
  for (const part of raw.split(/[,;\s]+/).filter(Boolean)) {
    const p = up(part)
    const letters = /^([A-Z])-([A-Z])$/.exec(p)
    const nums = /^(\d{1,3})-(\d{1,3})$/.exec(p)
    if (letters) {
      const a = letters[1].charCodeAt(0); const b = letters[2].charCodeAt(0)
      if (b < a) return { codes: [], error: 'inventory.locations.bulk.errors.range' }
      for (let c = a; c <= b; c += 1) out.push(String.fromCharCode(c))
    } else if (nums) {
      const a = Number(nums[1]); const b = Number(nums[2])
      if (b < a || b - a > MAX_COUNT) return { codes: [], error: 'inventory.locations.bulk.errors.range' }
      const w = nums[1].length
      for (let n = a; n <= b; n += 1) out.push(String(n).padStart(w, '0'))
    } else if (/^[A-Z0-9][A-Z0-9._]*$/.test(p)) {
      out.push(p)
    } else {
      return { codes: [], error: 'inventory.locations.bulk.errors.rackCode' }
    }
  }
  return { codes: [...new Set(out)], error: null }
}

const join = (sep, ...parts) => parts.filter((x) => x !== '' && x != null).join(sep)
const count = (n) => {
  const v = Math.floor(Number(n))
  return Number.isFinite(v) && v > 0 ? Math.min(v, MAX_COUNT) : 0
}

/**
 * spec: { site, parentId, prefix, racks, shelves, bins, start, pad, sep,
 *         rackLabel, shelfLabel, binLabel }
 * existingRows: inventory_locations rows already loaded for the scope.
 * Returns { nodes, counts, errors } - nodes ordered parent before child.
 */
export function buildBulkPlan(spec = {}, existingRows = []) {
  const errors = []
  const site = up(spec.site)
  if (!site) errors.push('inventory.locations.bulk.errors.site')
  const sep = ['-', '.', '_', ''].includes(spec.sep) ? spec.sep : '-'
  const pad = Math.min(4, Math.max(1, Math.floor(Number(spec.pad) || 2)))
  const start = Math.max(0, Math.floor(Number(spec.start ?? 1)) || 0)
  const prefix = up(spec.prefix)
  const parent = spec.parentId ? (existingRows || []).find((r) => r.id === spec.parentId) : null
  if (spec.parentId && !parent) errors.push('inventory.locations.bulk.errors.parent')
  if (parent && up(parent.site) !== site) errors.push('inventory.locations.bulk.errors.parentSite')

  const { codes: racks, error: rackErr } = parseRackList(spec.racks)
  if (rackErr) errors.push(rackErr)
  const shelves = count(spec.shelves)
  const bins = count(spec.bins)
  if (!racks.length && !shelves && !bins) errors.push('inventory.locations.bulk.errors.nothing')
  if (!racks.length && !prefix) errors.push('inventory.locations.bulk.errors.prefix')

  const labels = {
    rack: String(spec.rackLabel || '').trim() || 'Rack',
    shelf: String(spec.shelfLabel || '').trim() || 'Shelf',
    bin: String(spec.binLabel || '').trim() || 'Bin',
  }
  const existing = new Map()
  for (const r of existingRows || []) {
    if (up(r.site) === site) existing.set(up(r.code), r)
  }
  const nodes = []
  const seen = new Set()
  const num = (i) => String(start + i).padStart(pad, '0')
  const push = (type, code, parentRef) => {
    const ref = `n${nodes.length + 1}`
    if (!CODE_RE.test(code)) errors.push('inventory.locations.bulk.errors.codeFormat')
    if (seen.has(code)) errors.push('inventory.locations.bulk.errors.duplicate')
    seen.add(code)
    const ex = existing.get(code)
    nodes.push({
      ref, parentRef, parentId: parentRef ? null : (parent?.id || null), location_type: type, code,
      name: `${labels[type]} ${code}`, existingId: ex?.id || null,
      depth: nodes.length ? (parentRef ? nodes.find((n) => n.ref === parentRef).depth + 1 : 0) : 0,
    })
    return ref
  }
  const addBins = (base, parentRef) => {
    for (let k = 0; k < bins; k += 1) push('bin', join(sep, base, num(k)), parentRef)
  }
  const addShelves = (base, parentRef) => {
    if (!shelves) { addBins(base, parentRef); return }
    for (let j = 0; j < shelves; j += 1) {
      const code = join(sep, base, num(j))
      const ref = push('shelf', code, parentRef)
      addBins(code, ref)
    }
  }
  if (!errors.length) {
    if (racks.length) {
      for (const r of racks) {
        const code = join(sep, prefix, r)
        const ref = push('rack', code, null)
        addShelves(code, ref)
        if (nodes.length > BULK_MAX_NODES) break
      }
    } else {
      addShelves(prefix, null)
    }
  }
  if (nodes.length > BULK_MAX_NODES) errors.push('inventory.locations.bulk.errors.tooMany')
  const uniq = [...new Set(errors)]
  const counts = { rack: 0, shelf: 0, bin: 0, total: nodes.length, new: 0, existing: 0 }
  for (const n of nodes) {
    counts[n.location_type] += 1
    if (n.existingId) counts.existing += 1; else counts.new += 1
  }
  return { nodes: uniq.length ? [] : nodes, counts: uniq.length ? { ...counts, total: 0, new: 0, existing: 0 } : counts, errors: uniq }
}

/** The server payload for a plan (no client-only fields). */
export function bulkPayload({ country, site, parentId, nodes }) {
  return {
    country: country || null,
    site: up(site),
    parent_id: parentId || null,
    nodes: (nodes || []).map((n) => ({ ref: n.ref, parent_ref: n.parentRef || null, code: n.code, name: n.name, location_type: n.location_type })),
  }
}
