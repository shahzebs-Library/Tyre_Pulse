/**
 * storageCenter.js - PURE helpers for the console Storage page. No I/O.
 * Unknowns come back as null and render "N/A" with a reason.
 */
import { fmtBytes, fmtInt } from './databaseCenter'

export { fmtBytes, fmtInt }

export const BUCKET_INFO = {
  'tyre-photos': { description: 'Tyre, inspection, module and checklist photos from phones', evidence: true },
  'import-files': { description: 'Uploaded ERP and data files', evidence: false },
  'tenant-exports': { description: 'Company data exports', evidence: false },
  'accident-photos': { description: 'Accident evidence', evidence: true },
  'vehicle-photos': { description: 'Vehicle pictures and company logo', evidence: false },
  'inspection-photos': { description: 'Unused, inspections save into tyre-photos', evidence: true },
  'driver-fine-evidence': { description: 'Driver fine proof', evidence: true },
}

export const FOLDER_INFO = {
  'tyre-photos/photos': 'Tyre photos taken during tyre work',
  'tyre-photos/modules': 'Photos attached in app modules',
  'tyre-photos/inspections': 'Inspection photos',
  'tyre-photos/checklists': 'Checklist photos',
  'accident-photos/accidents': 'Accident evidence photos',
}

/** Buckets whose files may never get an automatic delete rule from here. */
export function isEvidenceBucket(id) {
  return !!BUCKET_INFO[id]?.evidence
}

export function allowedTypesLabel(mimes) {
  if (!Array.isArray(mimes) || !mimes.length) return 'Any'
  const short = mimes.map((m) => String(m).split('/').pop().replace('vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx').replace('vnd.ms-excel', 'xls'))
  return [...new Set(short)].slice(0, 6).join(', ') + (short.length > 6 ? ` +${short.length - 6}` : '')
}

/** The retention text shown per bucket. */
export function retentionLabel(bucketId, rules, tenantExportDays) {
  if (bucketId === 'tenant-exports') {
    return tenantExportDays ? { text: `Delete after ${tenantExportDays} days`, runs: 'Nightly 05:40', applied: true } : { text: 'Keep forever', runs: 'No rule', applied: false }
  }
  const rule = (rules || []).find((r) => r.bucket === bucketId)
  if (rule) return { text: `Delete after ${rule.older_than_days} days${rule.prefix ? ` in ${rule.prefix}` : ''}`, runs: 'Saved, not applied yet', applied: false, rule }
  return { text: 'Keep forever', runs: 'No rule', applied: false }
}

/** Month labels for the last N months ending this month: ['2026-07', ...]. */
export function monthKeys(now = new Date(), n = 4) {
  const out = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function monthLabel(key) {
  const m = String(key || '').match(/^(\d{4})-(\d{2})$/)
  return m ? MONTHS[Number(m[2]) - 1] : String(key || '')
}

/**
 * Growth per month with a flat estimate for the next three months that
 * repeats the latest full month. The estimate is labelled as one.
 */
export function growthSeries(growth, now = new Date()) {
  const rows = Array.isArray(growth) ? growth : []
  const map = new Map(rows.map((g) => [g.month, g]))
  const first = rows.length ? rows[0].month : null
  const keys = monthKeys(now, 12).filter((k) => !first || k >= first)
  const actual = keys.map((k) => ({ key: k, label: monthLabel(k), bytes: Number(map.get(k)?.bytes) || 0, files: Number(map.get(k)?.files) || 0, estimate: false }))
  const base = actual.length ? actual[actual.length - 1] : null
  const est = []
  if (base) {
    for (let i = 1; i <= 3; i++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1))
      est.push({ key: `est-${i}`, label: `${MONTHS[d.getUTCMonth()]} est.`, bytes: base.bytes, files: base.files, estimate: true })
    }
  }
  return { points: [...actual, ...est], latest: base, yearPace: base ? base.bytes * 12 : null }
}

/**
 * The owner's work list, checked against every file. Each item says what to
 * do and where; nothing here acts on its own.
 */
export function buildRecommendations({ buckets = [], rules = [], tenantExportDays = null, growth = null } = {}) {
  const out = []
  const dupFiles = buckets.reduce((s, b) => s + (Number(b.duplicate_files) || 0), 0)
  const dupBytes = buckets.reduce((s, b) => s + (Number(b.duplicate_bytes) || 0), 0)
  if (dupFiles > 0) {
    const parts = buckets.filter((b) => Number(b.duplicate_files) > 0)
      .map((b) => `${fmtInt(b.duplicate_files)} in ${b.id} (${fmtBytes(b.duplicate_bytes)}${Number(b.bytes) ? `, ${Math.round(Number(b.duplicate_bytes) / Number(b.bytes) * 100)}% of that bucket` : ''})`)
    out.push({ key: 'dupes', tone: 'warning', title: `${fmtInt(dupFiles)} files are exact copies of another file`,
      body: `Same content twice: ${parts.join(' and ')}. ${fmtBytes(dupBytes)} in total.`, action: 'Review copies', target: 'duplicates' })
  }
  const withRule = buckets.filter((b) => retentionLabel(b.id, rules, tenantExportDays).applied || (rules || []).some((r) => r.bucket === b.id))
  const noRule = buckets.length - withRule.length
  if (noRule > 0) {
    const imp = buckets.find((b) => b.id === 'import-files')
    const detail = imp && Number(imp.older_60_files) > 0
      ? `import-files keeps ${fmtInt(imp.older_60_files)} uploads older than 60 days (${fmtBytes(imp.older_60_bytes)}) that are already imported.`
      : 'Files in those buckets are kept forever.'
    out.push({ key: 'rules', tone: 'warning', title: `${noRule} of ${buckets.length} buckets have no retention rule`, body: detail, action: 'Add rule', target: 'retention' })
  }
  const photos = buckets.find((b) => b.id === 'tyre-photos')
  if (photos && Number(photos.files) > 0) {
    out.push({ key: 'resize', tone: 'info', title: 'Photos are served at full upload size',
      body: 'Lists could load a small preview instead. Needs image resizing on the Pro plan: 100 free a month, then USD 5 per 1,000. The current plan tier is not readable here.',
      action: 'See option', target: 'buckets' })
  }
  if (growth?.latest && growth.latest.bytes > 0) {
    out.push({ key: 'growth', tone: 'info', title: `Storage grew ${fmtBytes(growth.latest.bytes)} in ${growth.latest.label}`,
      body: `At that pace about ${fmtBytes(growth.yearPace)} a year. No plan limit applies until billing is live.`, action: 'See growth', target: 'growth' })
  }
  return out
}

/** Filter chips for the bucket table. */
export function bucketChipCounts(buckets, rules, tenantExportDays) {
  const list = Array.isArray(buckets) ? buckets : []
  return {
    all: list.length,
    used: list.filter((b) => Number(b.files) > 0).length,
    empty: list.filter((b) => !Number(b.files)).length,
    rule: list.filter((b) => retentionLabel(b.id, rules, tenantExportDays).text !== 'Keep forever').length,
  }
}

/** A short readable name for a stored file path. */
export function fileTitle(bucket, name) {
  const base = String(name || '').split('/').pop()
  if (bucket === 'tenant-exports') return `Company export part (${base})`
  if (bucket === 'import-files') return `Upload: ${base}`
  return base
}

export const MB = 1024 * 1024
