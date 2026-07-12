/**
 * RFID Registry — pure helpers (no I/O) for the RFID module. Tag-id
 * normalisation (the identity key used for registration + scan lookup) and
 * registry summarisation live here so the page, service and tests share one
 * implementation. Fully unit-tested.
 */

export const RFID_STATUSES = ['active', 'unassigned', 'retired']

export const RFID_STATUS_META = {
  active: { label: 'Active', tone: 'green' },
  unassigned: { label: 'Unassigned', tone: 'amber' },
  retired: { label: 'Retired', tone: 'slate' },
}

/**
 * Normalise a raw RFID tag id into its canonical form: trimmed, uppercased,
 * with internal whitespace removed. RFID EPCs/UIDs are case-insensitive hex/
 * alnum strings, so canonicalising avoids duplicate registrations and makes
 * scan lookups deterministic. Returns '' for nullish/blank input.
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeTagId(raw) {
  if (raw == null) return ''
  return String(raw).trim().replace(/\s+/g, '').toUpperCase()
}

/**
 * Summarise a set of registry rows for the KPI header:
 *   - byStatus: counts per status (active/unassigned/retired)
 *   - total
 *   - assigned:   rows mapped to a tyre serial OR an asset
 *   - unassigned: rows with neither mapping (operational "spare tag" view;
 *                 independent of the status field)
 *   - assets:     distinct assets covered by the registry
 * Defensive against non-array input and unknown status values.
 * @param {Array<object>} rows
 */
export function summarizeTags(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const byStatus = { active: 0, unassigned: 0, retired: 0 }
  const assetSet = new Set()
  let assigned = 0
  let unassigned = 0

  for (const r of list) {
    if (byStatus[r?.status] != null) byStatus[r.status] += 1

    const serial = String(r?.tyre_serial ?? '').trim()
    const asset = String(r?.asset_no ?? '').trim()
    if (serial || asset) assigned += 1
    else unassigned += 1
    if (asset) assetSet.add(asset.toUpperCase())
  }

  return {
    byStatus,
    total: list.length,
    assigned,
    unassigned,
    assets: assetSet.size,
  }
}
