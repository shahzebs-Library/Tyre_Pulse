/**
 * Tyre Passport — pure builder (no I/O) that assembles a single tyre's complete
 * lifecycle from its `tyre_records` rows (ported concept from tyre_saas's
 * TyrePassport). One physical tyre may appear across several records (fitment,
 * rotation to another asset/position, removal, retread). This collapses them
 * into an identity header, a chronological event timeline, and lifetime totals
 * (km, hours, cost, CPK). Unit-tested; the page consumes it directly.
 */

export const serialOfRecord = (r) =>
  (r?.serial_no || r?.serial_number || r?.tyre_serial || '').toString().trim()

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : null
}
const firstNonEmpty = (rows, key) => {
  for (const r of rows) { const v = r?.[key]; if (v != null && String(v).trim() !== '') return v }
  return null
}
const eventDate = (r) => r?.fitment_date || r?.issue_date || r?.removal_date || r?.created_at || null

/**
 * @param {object[]} records  tyre_records rows for ONE serial
 * @returns {object|null} passport, or null when there are no records
 */
export function buildPassport(records) {
  const rows = (Array.isArray(records) ? records : []).filter(Boolean)
  if (!rows.length) return null

  // Chronological (oldest → newest) by the record's effective date.
  const sorted = [...rows].sort((a, b) => {
    const da = new Date(eventDate(a) || 0).getTime()
    const db = new Date(eventDate(b) || 0).getTime()
    return da - db
  })

  const serial = serialOfRecord(sorted.find((r) => serialOfRecord(r)) || sorted[0])

  const events = sorted.map((r) => ({
    id: r.id,
    date: eventDate(r),
    fitment_date: r.fitment_date || null,
    removal_date: r.removal_date || null,
    asset_no: r.asset_no || r.asset_number || null,
    site: r.site || null,
    position: r.position || r.tyre_position || null,
    km: num(r.total_km) ?? (num(r.km_at_removal) != null && num(r.km_at_fitment) != null ? num(r.km_at_removal) - num(r.km_at_fitment) : null),
    hrs: num(r.total_hrs),
    cost: num(r.cost_per_tyre),
    reason: r.reason_for_removal || r.removal_reason || null,
    status: r.status || null,
    tread_depth: num(r.tread_depth),
  }))

  const sum = (key) => events.reduce((acc, e) => acc + (num(e[key]) || 0), 0)
  const totalKm = sum('km')
  const totalHrs = sum('hrs')
  const totalCost = sum('cost')
  // Lifetime CPK across the tyre (cost / km) — the core tyre-economics metric.
  const cpk = totalKm > 0 ? Math.round((totalCost / totalKm) * 1000) / 1000 : null

  const removed = events.some((e) => e.removal_date) || /scrap|remov/i.test(String(firstNonEmpty(sorted, 'status') || ''))

  return {
    serial,
    brand: firstNonEmpty(sorted, 'brand'),
    size: firstNonEmpty(sorted, 'size'),
    supplier: firstNonEmpty(sorted, 'supplier'),
    status: firstNonEmpty([...sorted].reverse(), 'status') || (removed ? 'removed' : 'in_service'),
    recordCount: rows.length,
    firstDate: events[0]?.date || null,
    lastDate: events[events.length - 1]?.date || null,
    assets: [...new Set(events.map((e) => e.asset_no).filter(Boolean))],
    totals: { km: totalKm, hrs: totalHrs, cost: Math.round(totalCost * 100) / 100, cpk },
    events,
  }
}
