/**
 * Inventory location hierarchy (pure).
 *
 * `inventory_locations` is a flat table with `parent_id`. This builds the tree
 * the Locations section draws, the readable path ("Main store / Zone A / R1"),
 * and the QR label code `TP:LOC:<id>` every printed bin label carries.
 *
 * Defensive by design: an orphan (parent missing or in another site) becomes a
 * root instead of disappearing, and a parent cycle is cut rather than looping.
 */

export const LOCATION_TYPES = [
  'warehouse', 'zone', 'rack', 'shelf', 'bin', 'in_transit', 'quarantine', 'damaged', 'scrap',
  'warranty', 'repairable', 'supplier_custody', 'vehicle_custody', 'consignment',
  // 20261124133000 (NOT APPLIED): saving these fails on the old CHECK until it is.
  'receiving', 'inspection', 'service_van', 'workshop_store', 'bulk_tank',
]

/** Types that hold stock that is NOT available to issue. */
export const NON_AVAILABLE_TYPES = new Set([
  'in_transit', 'quarantine', 'damaged', 'scrap', 'warranty', 'repairable', 'supplier_custody', 'vehicle_custody',
  'receiving', 'inspection',
])

export const LABEL_PREFIX = 'TP:LOC:'

export const labelCode = (id) => (id ? `${LABEL_PREFIX}${id}` : '')

/** Read a scanned label. Accepts the bare code or a URL carrying it. */
export function parseLabelCode(text) {
  const s = String(text || '').trim()
  const i = s.toUpperCase().indexOf(LABEL_PREFIX)
  if (i < 0) return null
  const id = s.slice(i + LABEL_PREFIX.length).split(/[\s/?#&]/)[0]
  return id || null
}

const byCode = (a, b) => String(a.code || '').localeCompare(String(b.code || ''), 'en', { numeric: true })

/** Flat rows -> roots with `children`, each node carrying depth and path. */
export function buildTree(rows) {
  const nodes = new Map()
  for (const r of rows || []) {
    if (r?.id) nodes.set(r.id, { ...r, children: [] })
  }
  const roots = []
  for (const node of nodes.values()) {
    const parent = node.parent_id ? nodes.get(node.parent_id) : null
    // An orphan, or a parent whose chain leads back to this node, becomes a root.
    if (!parent || leadsTo(nodes, node.parent_id, node.id)) roots.push(node)
    else parent.children.push(node)
  }
  const walk = (list, depth, prefix) => {
    list.sort(byCode)
    for (const n of list) {
      n.depth = depth
      n.path = prefix ? `${prefix} / ${n.name || n.code}` : (n.name || n.code || '')
      walk(n.children, depth + 1, n.path)
    }
  }
  walk(roots, 0, '')
  return roots
}

function leadsTo(nodes, startId, targetId) {
  const seen = new Set()
  let cur = startId
  while (cur && !seen.has(cur)) {
    if (cur === targetId) return true
    seen.add(cur)
    cur = nodes.get(cur)?.parent_id
  }
  return false
}

/** Depth-first flattening for a table or a label sheet. */
export function flattenTree(roots) {
  const out = []
  const walk = (list) => { for (const n of list) { out.push(n); walk(n.children || []) } }
  walk(roots || [])
  return out
}

/** Filter that keeps ancestors of every match so the path stays readable. */
export function filterTree(roots, term) {
  const q = String(term || '').trim().toLowerCase()
  if (!q) return roots
  const keep = (n) => {
    const kids = (n.children || []).map(keep).filter(Boolean)
    const hit = [n.code, n.name, n.location_type].some((v) => String(v || '').toLowerCase().includes(q))
    return hit || kids.length ? { ...n, children: kids } : null
  }
  return (roots || []).map(keep).filter(Boolean)
}

/** Validate the add/edit location form. */
export function validateLocationDraft(d, existingRows = []) {
  const errors = {}
  const code = String(d?.code || '').trim()
  if (!code) errors.code = 'inventory.locations.errors.code'
  else if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(code)) errors.code = 'inventory.locations.errors.codeFormat'
  else if ((existingRows || []).some((r) => r.id !== d?.id && r.site === d?.site
    && String(r.code || '').toUpperCase() === code.toUpperCase())) errors.code = 'inventory.locations.errors.codeTaken'
  if (!String(d?.name || '').trim()) errors.name = 'inventory.locations.errors.name'
  if (!LOCATION_TYPES.includes(d?.location_type)) errors.location_type = 'inventory.locations.errors.type'
  if (!String(d?.site || '').trim()) errors.site = 'inventory.locations.errors.site'
  if (d?.id && d?.parent_id === d.id) errors.parent_id = 'inventory.locations.errors.selfParent'
  return { ok: Object.keys(errors).length === 0, errors }
}
