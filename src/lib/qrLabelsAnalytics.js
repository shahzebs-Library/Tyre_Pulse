/**
 * qrLabelsAnalytics - pure helpers behind the QR label generator.
 *
 * The label geometry lives in qrLabelLayout.js and the bulk code matching in
 * qrBulkMatch.js; this file owns only the register around them: which text a
 * label encodes, the register filter, and the headline counts. A tyre with no
 * serial falls back to its asset code (so the label still resolves to the
 * vehicle) and is COUNTED as such, because a label that encodes the asset
 * instead of the tyre is a weaker label and the page should say how many.
 * No I/O.
 */

/** Text a label encodes. Tyres: serial, else asset code, else the row id. */
export function labelCode(item, mode) {
  if (mode === 'tyres') return item?.serial_number ?? item?.asset_no ?? (item?.id != null ? String(item.id) : '')
  return item?.asset_no ?? ''
}

/** Secondary line printed under the code (ASCII separator, it goes on paper). */
export function labelSub(item, mode) {
  return mode === 'tyres'
    ? [item?.brand, item?.site].filter(Boolean).join(' - ')
    : [item?.vehicle_type, item?.site].filter(Boolean).join(' - ')
}

/** 'ready' | 'pending' (selected, no QR yet) | 'idle' */
export function qrState(item, selected, qrImages) {
  if (qrImages && qrImages[item?.id]) return 'ready'
  if (selected && selected.has(item?.id)) return 'pending'
  return 'idle'
}

export const QR_STATE_OPTIONS = [
  { key: 'ready', label: 'QR ready' },
  { key: 'pending', label: 'Selected, not generated' },
  { key: 'idle', label: 'Not selected' },
]

export function filterLabelRows(rows, { mode, search = '', site = 'all', qr = 'all' } = {}, ctx = {}) {
  const q = String(search).toLowerCase()
  return (Array.isArray(rows) ? rows : []).filter(r => {
    const val = mode === 'tyres' ? r.serial_number : r.asset_no
    const matchSearch = !q
      || val?.toLowerCase().includes(q)
      || r.asset_no?.toLowerCase().includes(q)
      || r.brand?.toLowerCase().includes(q)
      || r.site?.toLowerCase().includes(q)
      || r.vehicle_type?.toLowerCase().includes(q)
    if (!matchSearch) return false
    if (site !== 'all' && r.site !== site) return false
    if (qr !== 'all' && qrState(r, ctx.selected, ctx.qrImages) !== qr) return false
    return true
  })
}

export function summarizeLabels(rows, mode, selected = new Set(), qrImages = {}) {
  const list = Array.isArray(rows) ? rows : []
  let noSerial = 0
  let ready = 0
  let pending = 0
  const sites = new Set()
  for (const r of list) {
    if (mode === 'tyres' && !r.serial_number) noSerial += 1
    const st = qrState(r, selected, qrImages)
    if (st === 'ready') ready += 1
    if (st === 'pending') pending += 1
    if (r.site) sites.add(r.site)
  }
  return {
    total: list.length,
    selected: list.filter(r => selected.has(r.id)).length,
    ready,
    pending,
    sites: sites.size,
    // Only meaningful for tyres; vehicles always carry their asset code.
    noSerial: mode === 'tyres' ? noSerial : null,
  }
}
