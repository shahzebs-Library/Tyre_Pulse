/**
 * tyreExceptions.js - pure shaping of public.get_tyre_exceptions(country).
 *
 * The RPC returns one jsonb object; this turns it into the rows a person works
 * through. Nothing here changes data. Kinds:
 *   rotation_not_closed    same serial active on two wheels of one vehicle, the
 *                          later one dated later (a rotation nobody closed)
 *   same_day_double_entry  same serial on two wheels on the same day (one of the
 *                          two serials was typed wrong; a person must look)
 *   serial_priced_twice    one physical tyre carries two purchase prices
 *   weak_serial            active fitment whose serial is not a real serial
 *   serial_with_remark     real serial with a remark typed into the same cell
 */

export const EXCEPTION_LABEL = Object.freeze({
  rotation_not_closed: 'Rotation not closed',
  same_day_double_entry: 'Same serial on two wheels, same day',
  serial_priced_twice: 'One tyre priced twice',
  weak_serial: 'Not a real serial',
  serial_with_remark: 'Remark typed into the serial',
})

export const EXCEPTION_ACTION = Object.freeze({
  rotation_not_closed: 'Close the earlier position (Rotation closer, dry run first)',
  same_day_double_entry: 'Check the wheel and correct one serial',
  serial_priced_twice: 'Decide which upload keeps the price',
  weak_serial: 'Type the serial from the tyre sidewall',
  serial_with_remark: 'Move the remark to notes, keep the serial',
})

const arr = (v) => (Array.isArray(v) ? v : [])

/** Flatten the RPC payload into one list. Unknown/empty payload -> []. */
export function exceptionRows(payload) {
  if (!payload || typeof payload !== 'object') return []
  const out = []
  for (const g of arr(payload.same_vehicle)) {
    const positions = arr(g.rows).map((r) => r.position).filter(Boolean)
    const dates = arr(g.rows).map((r) => r.date).filter(Boolean)
    out.push({
      kind: g.kind === 'rotation_not_closed' ? 'rotation_not_closed' : 'same_day_double_entry',
      country: g.country || '', asset: g.asset || '', serial: g.serial || '',
      detail: `${positions.join(' / ')}${dates.length ? ` (${[...new Set(dates)].join(', ')})` : ''}`,
    })
  }
  for (const g of arr(payload.priced_twice)) {
    out.push({
      kind: 'serial_priced_twice', country: g.country || '', asset: arr(g.rows).map((r) => r.asset).join(' / '),
      serial: g.serial || '', detail: arr(g.rows).map((r) => `${r.asset}: ${r.cost}`).join(' | '),
    })
  }
  for (const g of arr(payload.weak_serials)) {
    out.push({ kind: 'weak_serial', country: g.country || '', asset: '', serial: g.serial || '', detail: `${g.rows} active fitment(s)` })
  }
  for (const g of arr(payload.serials_with_remark)) {
    out.push({ kind: 'serial_with_remark', country: g.country || '', asset: '', serial: g.serial || '', detail: `${g.rows} active fitment(s)` })
  }
  return out.map((r) => ({ ...r, label: EXCEPTION_LABEL[r.kind], action: EXCEPTION_ACTION[r.kind] }))
}

/** Counts block, with null for anything the RPC did not report (never 0). */
export function exceptionCounts(payload) {
  const c = payload?.counts || {}
  const n = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v))
  return {
    rotation_not_closed: n(c.rotation_not_closed),
    same_day_double_entry: n(c.same_day_double_entry),
    serial_priced_twice: n(c.serial_priced_twice),
    weak_serial: n(c.weak_serial_active),
    serial_with_remark: n(c.serial_with_remark),
    import_reviews_open: n(c.import_reviews_open),
  }
}
