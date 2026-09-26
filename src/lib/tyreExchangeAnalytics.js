/**
 * tyreExchangeAnalytics - the pure engine behind the Tyre Exchange & Transfer
 * page (src/pages/TyreExchange.jsx).
 *
 * Every figure on that page is derived from tyre_records grouped by serial:
 * a serial that appears on a later record against a different asset or site
 * is a transfer; a serial whose latest record is a retread / repair / scrap
 * category is a pending return. These rules used to live inline in the page;
 * they live here so they can be tested and so the page is presentation only.
 *
 * Rules:
 *  - PURE. No I/O, no Date.now(): anything time-based takes an injectable `now`.
 *  - HONEST NULLS. A value that was never recorded is `null`, never 0 and never
 *    a placeholder string. The page renders null as "N/A".
 *  - NO MONEY. Transfers and returns carry no currency, so nothing here sums a
 *    cost; the one cost on this page (replacement cost) is shown per record.
 */

const DAY_MS = 1000 * 60 * 60 * 24

export const TRANSFER_TYPES = ['Inter-Vehicle', 'Inter-Site', 'Retread', 'Repair']
export const RETREAD_OVERDUE_DAYS = 60
export const PENDING_WARN_DAYS = 30
export const PENDING_CRITICAL_DAYS = 60
/** Net flow above this (either direction) marks a site as a sender / receiver. */
export const NET_FLOW_THRESHOLD = 2

const blank = (v) => v == null || String(v).trim() === ''
const orNull = (v) => (blank(v) ? null : v)
const numOrNull = (v) => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** The serial of a record: canonical `serial_no`, legacy `serial_number`. */
export function serialOf(r) {
  const s = r?.serial_number || r?.serial_no
  return blank(s) ? null : String(s)
}

function toTime(d) {
  if (!d) return 0
  const t = new Date(d).getTime()
  return Number.isFinite(t) ? t : 0
}

/** Oldest first by issue_date; an undated record sorts first. Stable. */
export function sortByIssueDate(recs) {
  return [...(recs || [])].sort((a, b) => toTime(a?.issue_date) - toTime(b?.issue_date))
}

/** Whole days between `date` and `now`, or null when either is unreadable. */
export function daysSince(date, now = new Date()) {
  if (!date) return null
  const t = new Date(date).getTime()
  const n = now instanceof Date ? now.getTime() : new Date(now).getTime()
  if (!Number.isFinite(t) || !Number.isFinite(n)) return null
  return Math.floor((n - t) / DAY_MS)
}

/** Map serial -> records (oldest first). Records with no serial are skipped. */
export function groupBySerial(records) {
  const by = new Map()
  for (const r of records || []) {
    const sn = serialOf(r)
    if (!sn) continue
    if (!by.has(sn)) by.set(sn, [])
    by.get(sn).push(r)
  }
  for (const [k, v] of by) by.set(k, sortByIssueDate(v))
  return by
}

const cat = (r) => String(r?.category || '').toLowerCase()

/** Transfer events: consecutive records of one serial on a different asset or site. */
export function deriveTransfers(records) {
  const transfers = []
  for (const [serial, sorted] of groupBySerial(records)) {
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]
      const curr = sorted[i]
      const fromAsset = orNull(prev.asset_no)
      const toAsset = orNull(curr.asset_no)
      const fromSite = orNull(prev.site)
      const toSite = orNull(curr.site)

      const isVehicleTransfer = !!(fromAsset && toAsset && fromAsset !== toAsset)
      const isSiteTransfer = !!(fromSite && toSite && fromSite !== toSite)
      if (!isVehicleTransfer && !isSiteTransfer) continue

      let transferType = 'Inter-Vehicle'
      if (isSiteTransfer) transferType = 'Inter-Site'
      else if (cat(curr).includes('retread')) transferType = 'Retread'
      else if (cat(curr).includes('repair')) transferType = 'Repair'

      const kmAtRemoval = numOrNull(prev.km_at_removal) || null
      const kmAtFitment = numOrNull(prev.km_at_fitment) || null
      const kmRun = kmAtRemoval && kmAtFitment ? kmAtRemoval - kmAtFitment : null

      transfers.push({
        id: `${serial}-${i}`,
        serial,
        brand: orNull(prev.brand) || orNull(curr.brand),
        size: orNull(prev.size) || orNull(curr.size),
        fromAsset,
        toAsset,
        fromSite,
        toSite,
        transferDate: orNull(curr.issue_date),
        kmAtTransfer: kmAtRemoval,
        kmRun,
        category: orNull(curr.category) || orNull(prev.category),
        treadAtTransfer: numOrNull(prev.tread_depth),
        transferType,
        prevRecord: prev,
        currRecord: curr,
      })
    }
  }
  return transfers
}

/** Every record of one serial (case-insensitive), oldest first. */
export function deriveCustody(records, serial) {
  const sn = String(serial || '').trim().toLowerCase()
  if (!sn) return []
  return sortByIssueDate((records || []).filter((r) => (serialOf(r) || '').toLowerCase() === sn))
}

/** Retread send-outs and whether a later record shows the tyre came back. */
export function deriveRetreads(records, { now = new Date(), overdueDays = RETREAD_OVERDUE_DAYS } = {}) {
  const out = []
  for (const [serial, sorted] of groupBySerial(records)) {
    for (let i = 0; i < sorted.length; i++) {
      const r = sorted[i]
      if (!cat(r).includes('retread')) continue
      const next = sorted[i + 1] || null
      const returned = !!(next && next.asset_no)
      const daysSent = daysSince(r.issue_date, now)
      out.push({
        serial,
        brand: orNull(r.brand),
        size: orNull(r.size),
        sentFromAsset: orNull(r.asset_no),
        sentFromSite: orNull(r.site),
        sendDate: orNull(r.issue_date),
        kmAtRemoval: numOrNull(r.km_at_removal),
        treadAtSend: numOrNull(r.tread_depth),
        returnStatus: returned ? 'Returned' : 'Pending Return',
        returnDate: returned ? orNull(next.issue_date) : null,
        returnAsset: returned ? orNull(next.asset_no) : null,
        daysSent,
        overdue: !returned && daysSent != null && daysSent > overdueDays,
      })
    }
  }
  return out
}

/** Serials whose LATEST record is a retread / repair / scrap removal. */
export function derivePendingReturns(records, { now = new Date() } = {}) {
  const out = []
  for (const [serial, sorted] of groupBySerial(records)) {
    const last = sorted[sorted.length - 1]
    const c = cat(last)
    if (!(c.includes('retread') || c.includes('repair') || c.includes('scrap'))) continue
    out.push({
      serial,
      brand: orNull(last.brand),
      size: orNull(last.size),
      removedFrom: orNull(last.asset_no),
      site: orNull(last.site),
      removalDate: orNull(last.issue_date),
      daysPending: daysSince(last.issue_date, now),
      category: orNull(last.category),
      treadAtRemoval: numOrNull(last.tread_depth),
      lastRecord: last,
    })
  }
  return out
}

/** Drop serials already marked returned or written off. */
export function excludeMarked(pending, returned = [], writtenOff = []) {
  const skip = new Set([...(returned || []), ...(writtenOff || [])])
  return (pending || []).filter((p) => !skip.has(p.serial))
}

/** Headline KPIs. avgKm is null when no transfer recorded a removal km. */
export function exchangeKpis(records, transfers, retreads = [], pending = []) {
  const bySerial = new Map()
  for (const r of records || []) {
    const sn = serialOf(r)
    if (!sn) continue
    if (!bySerial.has(sn)) bySerial.set(sn, { assets: new Set(), sites: new Set() })
    if (r.asset_no) bySerial.get(sn).assets.add(r.asset_no)
    if (r.site) bySerial.get(sn).sites.add(r.site)
  }
  const groups = [...bySerial.values()]
  const withKm = (transfers || []).filter((t) => t.kmAtTransfer != null)
  return {
    serials: bySerial.size,
    transfers: (transfers || []).length,
    interVehicle: groups.filter((g) => g.assets.size >= 2).length,
    interSite: groups.filter((g) => g.sites.size >= 2).length,
    retreadCount: (retreads || []).length,
    avgKm: withKm.length ? Math.round(withKm.reduce((s, t) => s + t.kmAtTransfer, 0) / withKm.length) : null,
    kmSample: withKm.length,
    pendingReturns: (pending || []).length,
    pendingOverdue: (pending || []).filter((p) => p.daysPending != null && p.daysPending > PENDING_WARN_DAYS).length,
  }
}

/** Sorted distinct option lists for the transfer filters. */
export function transferFilterOptions(records, transfers) {
  const uniq = (arr) => [...new Set(arr.filter((v) => !blank(v)))].sort()
  return {
    sites: uniq((records || []).map((r) => r.site)),
    brands: uniq((records || []).map((r) => r.brand)),
    categories: uniq((transfers || []).map((t) => t.category)),
  }
}

export const EMPTY_TRANSFER_FILTERS = Object.freeze({
  fromSite: '', toSite: '', brand: '', dateFrom: '', dateTo: '', category: '', transferType: '', search: '',
})

export function hasTransferFilters(f = {}) {
  return Object.keys(EMPTY_TRANSFER_FILTERS).some((k) => !blank(f[k]))
}

/** Apply the transfer filters. Search matches serial, assets, sites and brand. */
export function filterTransfers(transfers, f = {}) {
  const q = String(f.search || '').trim().toLowerCase()
  return (transfers || []).filter((t) => {
    if (f.fromSite && t.fromSite !== f.fromSite) return false
    if (f.toSite && t.toSite !== f.toSite) return false
    if (f.brand && t.brand !== f.brand) return false
    if (f.dateFrom && t.transferDate && t.transferDate < f.dateFrom) return false
    if (f.dateTo && t.transferDate && t.transferDate > f.dateTo) return false
    if (f.category && t.category !== f.category) return false
    if (f.transferType && t.transferType !== f.transferType) return false
    if (q) {
      const hay = [t.serial, t.fromAsset, t.toAsset, t.fromSite, t.toSite, t.brand, t.size]
        .filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Site x site transfer counts, with row/column totals and the max cell. */
export function siteFlowMatrix(transfers) {
  const sites = [...new Set((transfers || []).flatMap((t) => [t.fromSite, t.toSite]).filter(Boolean))].sort()
  const matrix = {}
  for (const from of sites) {
    matrix[from] = {}
    for (const to of sites) matrix[from][to] = 0
  }
  for (const t of transfers || []) {
    if (t.fromSite && t.toSite && t.fromSite !== t.toSite) matrix[t.fromSite][t.toSite] += 1
  }
  let max = 0
  const out = {}
  const inn = {}
  for (const s of sites) { out[s] = 0; inn[s] = 0 }
  for (const from of sites) {
    for (const to of sites) {
      const v = matrix[from][to]
      if (v > max) max = v
      out[from] += v
      inn[to] += v
    }
  }
  return { sites, matrix, max, totalOut: out, totalIn: inn }
}

/** 0 (no flow) .. 4 (heaviest) intensity band for a flow cell. */
export function flowIntensity(value, max) {
  if (!value || !max) return 0
  const r = value / max
  if (r > 0.75) return 4
  if (r > 0.5) return 3
  if (r > 0.25) return 2
  return 1
}

/** Per-site out / in / net and a role label. */
export function siteNetFlow(flow, { threshold = NET_FLOW_THRESHOLD } = {}) {
  return (flow?.sites || []).map((site) => {
    const out = flow.totalOut[site] || 0
    const inn = flow.totalIn[site] || 0
    const net = inn - out
    const role = net > threshold ? 'Net Receiver' : net < -threshold ? 'Net Sender' : 'Balanced'
    return { site, out, in: inn, net, role }
  })
}

function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Transfer counts for the last `months` calendar months ending at `now`. */
export function monthlyTransferCounts(transfers, { now = new Date(), months = 12 } = {}) {
  const base = now instanceof Date ? now : new Date(now)
  const list = []
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(base.getFullYear(), base.getMonth() - i, 1)
    list.push({
      key: monthKey(d),
      label: d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }),
      count: 0,
    })
  }
  const idx = new Map(list.map((m, i) => [m.key, i]))
  for (const t of transfers || []) {
    if (!t.transferDate) continue
    const i = idx.get(String(t.transferDate).slice(0, 7))
    if (i != null) list[i].count += 1
  }
  return list
}

/** Count per transfer type; an unrecognised type counts as Inter-Vehicle. */
export function transferTypeCounts(transfers) {
  const counts = Object.fromEntries(TRANSFER_TYPES.map((t) => [t, 0]))
  for (const t of transfers || []) {
    if (counts[t.transferType] !== undefined) counts[t.transferType] += 1
    else counts['Inter-Vehicle'] += 1
  }
  return counts
}

/** The most-moved serials, with the brand read from the records. */
export function topTransferredSerials(transfers, records, limit = 10) {
  const counts = new Map()
  for (const t of transfers || []) counts.set(t.serial, (counts.get(t.serial) || 0) + 1)
  const brandOf = new Map()
  for (const r of records || []) {
    const sn = serialOf(r)
    if (sn && !brandOf.has(sn) && !blank(r.brand)) brandOf.set(sn, r.brand)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, limit)
    .map(([serial, count]) => ({ serial, count, brand: brandOf.get(serial) || null }))
}

/** Transfer count per brand; a transfer with no brand is "Unknown". */
export function transfersByBrand(transfers, limit = 8) {
  const counts = new Map()
  for (const t of transfers || []) {
    const b = t.brand || 'Unknown'
    counts.set(b, (counts.get(b) || 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([brand, count]) => ({ brand, count }))
}

/** One-line summary of a custody chain. */
export function custodySummary(chain) {
  const c = chain || []
  if (!c.length) return null
  return {
    records: c.length,
    brand: orNull(c[0].brand),
    size: orNull(c[0].size),
    uniqueVehicles: new Set(c.map((r) => r.asset_no).filter(Boolean)).size,
    uniqueSites: new Set(c.map((r) => r.site).filter(Boolean)).size,
    firstSeen: orNull(c[0].issue_date),
    lastRecord: orNull(c[c.length - 1].issue_date),
  }
}

/** Custody rows with sequence number and km run (null when not measurable). */
export function custodyRows(chain) {
  return (chain || []).map((r, i) => {
    const start = numOrNull(r.km_at_fitment)
    const end = numOrNull(r.km_at_removal)
    return {
      key: r.id || `row-${i}`,
      seq: i + 1,
      date: orNull(r.issue_date),
      asset: orNull(r.asset_no),
      site: orNull(r.site),
      position: orNull(r.position),
      kmStart: start,
      kmEnd: end,
      kmRun: start != null && end != null ? end - start : null,
      tread: numOrNull(r.tread_depth),
      category: orNull(r.category),
      risk: orNull(r.risk_level),
    }
  })
}

export function retreadSummary(retreads) {
  const r = retreads || []
  return {
    total: r.length,
    returned: r.filter((x) => x.returnStatus === 'Returned').length,
    pending: r.filter((x) => x.returnStatus === 'Pending Return').length,
    overdue: r.filter((x) => x.overdue).length,
  }
}

export function pendingSummary(pending) {
  const p = pending || []
  const over = (d) => p.filter((x) => x.daysPending != null && x.daysPending > d).length
  return {
    total: p.length,
    over30: over(PENDING_WARN_DAYS),
    over60: over(PENDING_CRITICAL_DAYS),
    undated: p.filter((x) => x.daysPending == null).length,
  }
}

/** Age band of a pending return: 'critical' | 'warn' | 'ok' | 'unknown'. */
export function pendingBand(days) {
  if (days == null) return 'unknown'
  if (days > PENDING_CRITICAL_DAYS) return 'critical'
  if (days > PENDING_WARN_DAYS) return 'warn'
  return 'ok'
}

// ── Export shapes ─────────────────────────────────────────────────────────────
const na = (v) => (v == null || v === '' ? 'N/A' : v)

export const RETREAD_EXPORT_COLUMNS = [
  { key: 'serial', header: 'Serial' },
  { key: 'brand', header: 'Brand' },
  { key: 'size', header: 'Size' },
  { key: 'sentFromAsset', header: 'Sent From Asset' },
  { key: 'sentFromSite', header: 'Site' },
  { key: 'sendDate', header: 'Send Date' },
  { key: 'kmAtRemoval', header: 'KM at Removal' },
  { key: 'treadAtSend', header: 'Tread Sent (mm)' },
  { key: 'returnStatus', header: 'Status' },
  { key: 'daysSent', header: 'Days Since Sent' },
  { key: 'returnDate', header: 'Return Date' },
  { key: 'returnAsset', header: 'Return Asset' },
]

export const PENDING_EXPORT_COLUMNS = [
  { key: 'serial', header: 'Serial' },
  { key: 'brand', header: 'Brand' },
  { key: 'size', header: 'Size' },
  { key: 'removedFrom', header: 'Removed From' },
  { key: 'site', header: 'Site' },
  { key: 'removalDate', header: 'Removal Date' },
  { key: 'category', header: 'Category' },
  { key: 'daysPending', header: 'Days Pending' },
]

export const NET_FLOW_EXPORT_COLUMNS = [
  { key: 'site', header: 'Site' },
  { key: 'out', header: 'Transfers Out' },
  { key: 'in', header: 'Transfers In' },
  { key: 'net', header: 'Net Flow' },
  { key: 'role', header: 'Role' },
]

/** Rows for an export: every null becomes "N/A" so a blank cell is never read as zero. */
export function exportRows(rows, columns) {
  return (rows || []).map((r) => Object.fromEntries(columns.map((c) => [c.key, na(r[c.key])])))
}

/**
 * A transfer plus text twins of its nullable fields for the PDF export. The
 * PDF engine sums the first numeric column it finds and prints the total as
 * money, so the km and tread go out as text: a transfer register must not grow
 * a "Total KM" line labelled in a currency.
 */
export function transferExportView(t) {
  const txt = (v) => (v == null || v === '' ? 'N/A' : String(v))
  return {
    ...t,
    x_brand: txt(t.brand),
    x_size: txt(t.size),
    x_fromAsset: txt(t.fromAsset),
    x_toAsset: txt(t.toAsset),
    x_fromSite: txt(t.fromSite),
    x_toSite: txt(t.toSite),
    x_date: txt(t.transferDate),
    x_km: t.kmAtTransfer == null ? 'N/A' : Number(t.kmAtTransfer).toLocaleString('en-US'),
    x_tread: t.treadAtTransfer == null ? 'N/A' : `${t.treadAtTransfer} mm`,
    x_category: txt(t.category),
  }
}
