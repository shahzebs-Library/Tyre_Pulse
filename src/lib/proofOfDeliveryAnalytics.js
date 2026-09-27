/**
 * proofOfDeliveryAnalytics - pure engine behind the Proof of Delivery register.
 *
 * Builds on the podRecords primitives (summarisePods / byStatus / byDriver) so
 * the status roll-up keeps one definition, and adds what the register needs on
 * top: rates that are N/A (null) when nothing was measured instead of a
 * flattering 0%, evidence coverage (a delivery with no signature and no photo
 * is not proof of anything), per-driver reliability, and the shared filter.
 * No I/O; `now` is injectable.
 */
import { summarisePods, byStatus, byDriver } from './podRecords'

const EXCEPTION = new Set(['failed', 'returned', 'partial'])
const DAY = 86400000

function status(r) {
  return r?.status != null ? String(r.status).trim().toLowerCase() : ''
}

function pct(n, d) {
  if (!d) return null
  return Math.round((n / d) * 1000) / 10
}

function ts(v) {
  if (!v) return null
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}

/** 'both' | 'signature' | 'photo' | 'none' */
export function evidenceOf(r) {
  const sig = !!(r?.signature_url && String(r.signature_url).trim())
  const photo = !!(r?.photo_url && String(r.photo_url).trim())
  if (sig && photo) return 'both'
  if (sig) return 'signature'
  if (photo) return 'photo'
  return 'none'
}

export const EVIDENCE_OPTIONS = [
  { key: 'both', label: 'Signature and photo' },
  { key: 'signature', label: 'Signature only' },
  { key: 'photo', label: 'Photo only' },
  { key: 'none', label: 'No evidence' },
]

export function summarizePodRegister(rows, now = Date.now()) {
  const list = Array.isArray(rows) ? rows : []
  const base = summarisePods(list)
  const counts = byStatus(list)
  let exceptions = 0
  let evidenced = 0
  let noEvidence = 0
  let items = 0
  let itemsRows = 0
  let last30 = 0
  const cutoff = now - 30 * DAY
  for (const r of list) {
    if (EXCEPTION.has(status(r))) exceptions += 1
    if (evidenceOf(r) === 'none') noEvidence += 1
    else evidenced += 1
    const n = r?.items_count
    if (n !== '' && n != null && Number.isFinite(Number(n))) { items += Number(n); itemsRows += 1 }
    const t = ts(r?.delivered_at)
    if (t != null && t >= cutoff && t <= now) last30 += 1
  }
  // Decided = anything that is not still pending.
  const decided = list.length - counts.pending
  return {
    ...base,
    counts,
    // Rate over decided deliveries; N/A until at least one is decided.
    deliveryRate: pct(base.deliveredCount, decided),
    exceptionRate: pct(exceptions, decided),
    exceptions,
    evidenced,
    noEvidence,
    evidenceRate: pct(evidenced, list.length),
    itemsTotal: itemsRows ? items : null,
    last30,
  }
}

/** Per-driver reliability: delivered / (delivered + failed), N/A when neither. */
export function driverReliability(rows) {
  return byDriver(rows).map(d => ({
    ...d,
    successRate: pct(d.deliveries, d.deliveries + d.failed),
  }))
}

export function filterPods(rows, f = {}) {
  const list = Array.isArray(rows) ? rows : []
  const q = String(f.search || '').trim().toLowerCase()
  const from = f.from ? ts(`${f.from}T00:00:00`) : null
  const to = f.to ? ts(`${f.to}T23:59:59.999`) : null
  return list.filter(r => {
    if (f.status && status(r) !== f.status) return false
    if (f.driver && String(r.driver_name || '').trim() !== f.driver) return false
    if (f.evidence && evidenceOf(r) !== f.evidence) return false
    if (from != null || to != null) {
      const t = ts(r.delivered_at)
      if (t == null) return false
      if (from != null && t < from) return false
      if (to != null && t > to) return false
    }
    if (q) {
      const hay = `${r.pod_no || ''} ${r.asset_no || ''} ${r.driver_name || ''} ${r.customer_name || ''} ${r.delivery_address || ''} ${r.order_ref || ''} ${r.received_by || ''} ${r.notes || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}
