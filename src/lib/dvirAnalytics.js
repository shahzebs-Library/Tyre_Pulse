/**
 * dvirAnalytics - pure analytics for the DVIR register (/dvir). Builds on the
 * DVIR vocabulary in `src/lib/dvir.js`; adds filtering, defect-rate, open-age,
 * repeat-defect assets and a monthly trend. No I/O; `now` is injectable.
 * Honest nulls: a rate with no denominator is null (N/A), never 0.
 */

const DAY_MS = 86_400_000
const lower = (v) => (v == null ? '' : String(v).trim().toLowerCase())
const dayKey = (v) => {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}
const on = (v) => v != null && v !== '' && v !== 'all'

/**
 * @param {Array<object>} rows
 * @param {{status?,type?,asset?,site?,defects?:'yes'|'no',safe?:'yes'|'no',from?,to?,search?}} f
 */
export function filterDvir(rows = [], f = {}) {
  const q = lower(f.search)
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (on(f.status) && r?.status !== f.status) return false
    if (on(f.type) && r?.inspection_type !== f.type) return false
    if (on(f.asset) && r?.asset_no !== f.asset) return false
    if (on(f.site) && r?.site !== f.site) return false
    if (on(f.defects) && !!r?.defects_found !== (f.defects === 'yes')) return false
    if (on(f.safe) && !!r?.safe_to_operate !== (f.safe === 'yes')) return false
    const d = dayKey(r?.inspection_date)
    if (f.from && (!d || d < f.from)) return false
    if (f.to && (!d || d > f.to)) return false
    if (q) {
      const hay = [r?.asset_no, r?.driver_name, r?.site, r?.defect_notes].map(lower).join(' ')
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Distinct sorted non-blank values of a key. */
export function distinctValues(rows = [], key) {
  return [...new Set((Array.isArray(rows) ? rows : []).map((r) => r?.[key]).filter(Boolean))].sort()
}

/**
 * @param {Array<object>} rows
 * @param {{now?:Date|number, months?:number}} opts
 */
export function analyzeDvir(rows = [], { now = Date.now(), months = 12 } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const nowMs = now instanceof Date ? now.getTime() : Number(now)
  const assets = new Set()
  const defectsByAsset = new Map()
  let withDefects = 0
  let unsafe = 0
  let open = 0
  let openUnsafe = 0
  let preTrip = 0
  let postTrip = 0
  let oldestOpenDays = null

  for (const r of list) {
    if (r?.asset_no) assets.add(r.asset_no)
    if (r?.defects_found) {
      withDefects += 1
      if (r?.asset_no) defectsByAsset.set(r.asset_no, (defectsByAsset.get(r.asset_no) || 0) + 1)
    }
    const isUnsafe = r?.safe_to_operate === false
    if (isUnsafe) unsafe += 1
    if (r?.status === 'open') {
      open += 1
      if (isUnsafe) openUnsafe += 1
      const d = dayKey(r?.inspection_date)
      if (d) {
        const age = Math.floor((nowMs - Date.parse(`${d}T00:00:00Z`)) / DAY_MS)
        if (age >= 0 && (oldestOpenDays == null || age > oldestOpenDays)) oldestOpenDays = age
      }
    }
    if (r?.inspection_type === 'pre_trip') preTrip += 1
    else if (r?.inspection_type === 'post_trip') postTrip += 1
  }

  // Monthly trend (UTC months ending at `now`).
  const end = new Date(nowMs)
  const trend = []
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - i, 1))
    const key = d.toISOString().slice(0, 7)
    trend.push({ key, label: d.toLocaleString('en', { month: 'short', year: '2-digit', timeZone: 'UTC' }), total: 0, defects: 0 })
  }
  const idx = new Map(trend.map((t, i) => [t.key, i]))
  for (const r of list) {
    const d = dayKey(r?.inspection_date)
    if (!d) continue
    const i = idx.get(d.slice(0, 7))
    if (i == null) continue
    trend[i].total += 1
    if (r?.defects_found) trend[i].defects += 1
  }

  const repeatAssets = [...defectsByAsset.entries()]
    .filter(([, n]) => n >= 2)
    .map(([asset_no, defects]) => ({ asset_no, defects }))
    .sort((a, b) => b.defects - a.defects || String(a.asset_no).localeCompare(String(b.asset_no)))

  const pct = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null)
  return {
    kpis: {
      total: list.length,
      withDefects,
      clean: list.length - withDefects,
      defectRate: pct(withDefects, list.length),
      unsafe,
      open,
      openUnsafe,
      oldestOpenDays,
      distinctAssets: assets.size,
      repeatDefectAssets: repeatAssets.length,
      preTrip,
      postTrip,
    },
    trend,
    repeatAssets,
  }
}
