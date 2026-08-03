/**
 * CpkUnitAuditPanel - "Units & Why Different" for the Fleet CPK module.
 *
 * CPK measures every asset in ONE unit, chosen by its vehicle TYPE:
 *   - plant (pump, generator, loader, crane, excavator, forklift, dozer, grader,
 *     roller, compressor, batching / concrete / water-treatment) -> ENGINE HOURS
 *   - everything else -> KM
 * KM comes from the monthly tyre consumption (each tyre's total_km); HOURS from
 * engine-hour readings (span = max - min). An asset can hold data for BOTH units,
 * but CPK only ever uses its own type's unit, so the "other" figure is recorded
 * yet ignored. This panel exposes that so a user can see WHERE each asset's
 * measure comes from, WHY, and how having both units affects the number.
 *
 * Data comes ONLY from the fleetCpk service (getCpkUnitAudit for the audit,
 * getCpkKmSource + getCpkHoursSource for the per-asset both-ways drill-down),
 * each of which degrades to { ok:false } and never throws. This component is
 * presentational + fetches asset detail on demand; it never queries Supabase.
 *
 * Props:
 *   country  - 'KSA' | 'UAE' | 'Egypt' | 'All'
 *   from,to  - ISO YYYY-MM-DD period bounds
 *   currency - currency label (unused in figures here, kept for signature parity)
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Layers, Search, FileSpreadsheet, FileText, RefreshCcw, Info, X,
  AlertTriangle, Truck, Factory, Gauge, ChevronRight, ChevronDown, ChevronUp,
} from 'lucide-react'
import { getCpkUnitAudit, getCpkKmSource, getCpkHoursSource } from '../../lib/api/fleetCpk'
import { exportToExcel, exportToPdf, reportFileName, reportDateLabel } from '../../lib/exportUtils'

/* ---------- formatting helpers (ASCII only, honest N/A) ---------- */

function num(v) {
  return Number.isFinite(Number(v)) ? Number(v) : null
}

/** Integer with thousands separators; null/blank -> "N/A". */
function fmtInt(v) {
  const n = num(v)
  return n == null ? 'N/A' : Math.round(n).toLocaleString()
}

/** Any plain text value; blank -> "N/A". */
function fmtText(v) {
  return v == null || String(v).trim() === '' ? 'N/A' : String(v)
}

/** The unit an asset is measured in, in plain words. */
function unitLabel(unit) {
  if (unit === 'engine_hours') return 'Engine hours'
  if (unit === 'km') return 'Km'
  return fmtText(unit)
}

/** The mobility side, in plain words. */
function sideLabel(side) {
  if (side === 'movable') return 'Movable'
  if (side === 'non_movable') return 'Non-movable'
  return fmtText(side)
}

/* ---------- status vocabulary (labelled badges + severity for sort) ---------- */

const STATUS_META = {
  ok: { label: 'OK', tone: 'good', rank: 0 },
  both_present: { label: 'Both km and hours', tone: 'warn', rank: 1 },
  off_unit_only: { label: 'Only other-unit data', tone: 'bad', rank: 3 },
  used_unit_no_data: { label: 'No data for its unit', tone: 'bad', rank: 2 },
}

function statusMeta(status) {
  return STATUS_META[status] || { label: fmtText(status), tone: 'neutral', rank: -1 }
}

/* Semantic status hues - kept as explicit colours because the colour carries
 * meaning (good / warning / problem). Soft alpha backgrounds read on both themes. */
const TONE_STYLE = {
  good: { color: '#16a34a', bg: 'rgba(22,163,74,0.12)' },
  warn: { color: '#d97706', bg: 'rgba(217,119,6,0.14)' },
  bad: { color: '#dc2626', bg: 'rgba(220,38,38,0.12)' },
  neutral: { color: 'var(--text-secondary)', bg: 'var(--bg-elevated)' },
}

function StatusBadge({ status }) {
  const meta = statusMeta(status)
  const tone = TONE_STYLE[meta.tone] || TONE_STYLE.neutral
  return (
    <span
      className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap"
      style={{ color: tone.color, background: tone.bg }}
    >
      {meta.label}
    </span>
  )
}

const PAGE_SIZE = 25

/* Flag tiles map 1:1 to a filterable status. */
const FLAG_TILES = [
  { key: 'both_present', label: 'Both km and hours', tone: 'warn' },
  { key: 'off_unit_only', label: 'Only other-unit data', tone: 'bad' },
  { key: 'used_unit_no_data', label: 'Used-unit has no data', tone: 'bad' },
]

export default function CpkUnitAuditPanel({ country, from, to, currency } = {}) {
  const countryLabel = country && country !== 'All' ? country : 'All'

  /* ----- audit ----- */
  const [audit, setAudit] = useState({ ok: false })
  const [loading, setLoading] = useState(true)
  const [errored, setErrored] = useState(false)

  /* ----- table controls ----- */
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [page, setPage] = useState(0)
  const [sort, setSort] = useState({ key: 'status', dir: 'desc' })

  /* ----- open asset (both-ways drill-down) ----- */
  const [openRow, setOpenRow] = useState(null) // the asset row object
  const [kmDetail, setKmDetail] = useState(null)
  const [hoursDetail, setHoursDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailErrored, setDetailErrored] = useState(false)

  const loadAudit = useCallback(() => {
    let cancelled = false
    setLoading(true)
    setErrored(false)
    setOpenRow(null)
    setKmDetail(null)
    setHoursDetail(null)
    getCpkUnitAudit({ country, from, to })
      .then((res) => {
        if (cancelled) return
        if (res && res.ok) {
          setAudit(res)
        } else {
          setAudit({ ok: false })
          if (res && res.reason && res.reason !== 'empty') setErrored(true)
        }
      })
      .catch(() => {
        if (cancelled) return
        setAudit({ ok: false })
        setErrored(true)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [country, from, to])

  useEffect(() => loadAudit(), [loadAudit])

  const assets = useMemo(
    () => (audit.ok && Array.isArray(audit.assets) ? audit.assets : []),
    [audit],
  )
  const summary = (audit.ok && audit.summary) || {}
  const note = (audit.ok && audit.note) || ''

  /* ----- filter + search + sort ----- */
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    let rows = assets.slice()
    if (statusFilter !== 'all') rows = rows.filter((r) => r?.status === statusFilter)
    if (term) {
      rows = rows.filter((r) =>
        String(r?.asset_no ?? '').toLowerCase().includes(term) ||
        String(r?.vehicle_type ?? '').toLowerCase().includes(term))
    }
    const { key, dir } = sort
    const mul = dir === 'asc' ? 1 : -1
    rows.sort((a, b) => {
      let av
      let bv
      if (key === 'km' || key === 'hours') {
        av = num(a?.[key]); bv = num(b?.[key])
        av = av == null ? -1 : av; bv = bv == null ? -1 : bv
        if (av !== bv) return (av - bv) * mul
      } else if (key === 'status') {
        av = statusMeta(a?.status).rank; bv = statusMeta(b?.status).rank
        if (av !== bv) return (av - bv) * mul
      } else {
        av = String(a?.[key] ?? '').toLowerCase(); bv = String(b?.[key] ?? '').toLowerCase()
        if (av !== bv) return av < bv ? -1 * mul : 1 * mul
      }
      // tiebreak on asset for stable order
      return String(a?.asset_no ?? '').localeCompare(String(b?.asset_no ?? ''))
    })
    return rows
  }, [assets, q, statusFilter, sort])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const pageRows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)

  function toggleStatus(key) {
    setStatusFilter((cur) => (cur === key ? 'all' : key))
    setPage(0)
  }

  function toggleSort(key) {
    setSort((cur) => (cur.key === key
      ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: key === 'asset_no' || key === 'vehicle_type' ? 'asc' : 'desc' }))
    setPage(0)
  }

  /* ----- both-ways drill-down ----- */
  function openAsset(row) {
    if (!row || !row.asset_no) return
    setOpenRow(row)
    setKmDetail(null)
    setHoursDetail(null)
    setDetailErrored(false)
    setDetailLoading(true)
    Promise.all([
      getCpkKmSource({ country, from, to, asset: row.asset_no }).catch(() => ({ ok: false })),
      getCpkHoursSource({ country, from, to, asset: row.asset_no }).catch(() => ({ ok: false })),
    ]).then(([km, hours]) => {
      const kmOk = km && km.ok
      const hoursOk = hours && hours.ok
      setKmDetail(kmOk ? km : null)
      setHoursDetail(hoursOk ? hours : null)
      if (!kmOk && !hoursOk) setDetailErrored(true)
    }).finally(() => setDetailLoading(false))
  }

  function closeAsset() {
    setOpenRow(null)
    setKmDetail(null)
    setHoursDetail(null)
    setDetailErrored(false)
  }

  /* ----- exports ----- */
  function exportAudit(kind) {
    const rows = filtered.map((r) => ({
      asset_no: fmtText(r.asset_no),
      vehicle_type: fmtText(r.vehicle_type),
      unit: unitLabel(r.unit),
      side: sideLabel(r.side),
      km: num(r.km) == null ? 'N/A' : Math.round(num(r.km)),
      hours: num(r.hours) == null ? 'N/A' : Math.round(num(r.hours)),
      status: statusMeta(r.status).label,
    }))
    if (!rows.length) return
    const name = reportFileName('TyrePulse CPK Unit Audit', countryLabel, reportDateLabel())
    if (kind === 'excel') {
      exportToExcel(
        rows,
        ['asset_no', 'vehicle_type', 'unit', 'side', 'km', 'hours', 'status'],
        ['Asset', 'Type', 'Unit', 'Side', 'Km', 'Hours', 'Status'],
        name,
        'CPK Unit Audit',
      )
    } else {
      exportToPdf(
        rows,
        [
          { key: 'asset_no', header: 'Asset' },
          { key: 'vehicle_type', header: 'Type' },
          { key: 'unit', header: 'Unit' },
          { key: 'side', header: 'Side' },
          { key: 'km', header: 'Km' },
          { key: 'hours', header: 'Hours' },
          { key: 'status', header: 'Status' },
        ],
        `CPK unit audit (${countryLabel})`,
        name,
        'landscape',
      )
    }
  }

  const sortIcon = (key) => {
    if (sort.key !== key) return null
    return sort.dir === 'asc'
      ? <ChevronUp size={12} className="inline" />
      : <ChevronDown size={12} className="inline" />
  }

  const cur = currency || countryLabel

  return (
    <div className="w-full">
      {/* ---------- explainer banner ---------- */}
      <div
        className="mb-4 flex items-start gap-3 rounded-xl border p-4"
        style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-raised, var(--bg-elevated))' }}
      >
        <Info size={18} className="mt-0.5 shrink-0" style={{ color: 'var(--accent)' }} />
        <div className="text-sm">
          <div className="font-semibold mb-1">Units and why they differ</div>
          <p style={{ color: 'var(--text-secondary)' }}>
            {note || (
              'CPK measures every asset in ONE unit chosen by its type: plant (pumps, generators, '
              + 'loaders, cranes and other machinery) is measured per engine hour; everything else is '
              + 'measured per km. An asset can hold data for both units, but CPK uses only its own '
              + "type's unit, so the other figure is recorded yet ignored. The flags below mark assets "
              + 'where that matters.'
            )}
          </p>
          <p className="mt-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
            Km comes from the monthly tyre consumption (each tyre's total km). Hours come from
            engine-hour readings (span = max - min). Click any asset to see it BOTH ways.
          </p>
        </div>
      </div>

      {/* ---------- summary tiles ---------- */}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <InfoTile icon={Gauge} label="Total assets" value={fmtInt(summary.assets)} />
        <InfoTile icon={Truck} label="Movable (km)" value={fmtInt(summary.movable)} />
        <InfoTile icon={Factory} label="Non-movable (hours)" value={fmtInt(summary.non_movable)} />
        {FLAG_TILES.map((f) => (
          <FlagTile
            key={f.key}
            label={f.label}
            value={fmtInt(summary[f.key])}
            tone={f.tone}
            active={statusFilter === f.key}
            onClick={() => toggleStatus(f.key)}
          />
        ))}
      </div>

      {/* ---------- header + exports ---------- */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-base font-semibold">
          <Layers size={18} /> Asset unit audit
          <span className="text-sm font-normal" style={{ color: 'var(--text-secondary)' }}>
            ({countryLabel})
          </span>
        </h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadAudit}
            className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            <RefreshCcw size={12} /> Refresh
          </button>
          <button
            type="button"
            onClick={() => exportAudit('excel')}
            disabled={!filtered.length}
            className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs disabled:opacity-40"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            <FileSpreadsheet size={12} /> Excel
          </button>
          <button
            type="button"
            onClick={() => exportAudit('pdf')}
            disabled={!filtered.length}
            className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs disabled:opacity-40"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            <FileText size={12} /> PDF
          </button>
        </div>
      </div>

      {/* ---------- search + active filter + totals ---------- */}
      {audit.ok && assets.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 opacity-50" />
            <input
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(0) }}
              placeholder="Search asset or type"
              className="w-full rounded-md border bg-transparent pl-8 pr-3 py-1.5 text-sm"
              style={{ borderColor: 'var(--border-subtle)' }}
            />
          </div>
          {statusFilter !== 'all' && (
            <button
              type="button"
              onClick={() => toggleStatus(statusFilter)}
              className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs"
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              Filter: {statusMeta(statusFilter).label} <X size={12} />
            </button>
          )}
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {filtered.length.toLocaleString()} asset{filtered.length === 1 ? '' : 's'}
          </span>
        </div>
      )}

      {/* ---------- audit table / states ---------- */}
      <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }}>
        <table className="w-full text-sm border-collapse">
          <thead
            className="sticky top-0 z-10"
            style={{ background: 'var(--surface-raised, var(--bg-elevated))' }}
          >
            <tr>
              <Th onClick={() => toggleSort('asset_no')} align="left">Asset {sortIcon('asset_no')}</Th>
              <Th onClick={() => toggleSort('vehicle_type')} align="left">Type {sortIcon('vehicle_type')}</Th>
              <Th onClick={() => toggleSort('unit')} align="left">Unit {sortIcon('unit')}</Th>
              <Th onClick={() => toggleSort('side')} align="left">Side {sortIcon('side')}</Th>
              <Th onClick={() => toggleSort('km')} align="right">Km {sortIcon('km')}</Th>
              <Th onClick={() => toggleSort('hours')} align="right">Hours {sortIcon('hours')}</Th>
              <Th onClick={() => toggleSort('status')} align="left">Status {sortIcon('status')}</Th>
              <th className="px-4 py-2.5 text-right font-semibold whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>View</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center" style={{ color: 'var(--text-secondary)' }}>Loading...</td></tr>
            ) : errored ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center">
                  <div className="inline-flex flex-col items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                    <AlertTriangle size={20} />
                    <span>Could not load the unit audit.</span>
                    <button
                      type="button"
                      onClick={loadAudit}
                      className="mt-1 inline-flex items-center gap-1.5 rounded-md border px-3 py-1 text-xs"
                      style={{ borderColor: 'var(--border-subtle)' }}
                    >
                      <RefreshCcw size={12} /> Retry
                    </button>
                  </div>
                </td>
              </tr>
            ) : pageRows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center" style={{ color: 'var(--text-secondary)' }}>
                  {assets.length === 0
                    ? `No assets with km or hours in this period for ${countryLabel}.`
                    : 'No assets match the current filter.'}
                </td>
              </tr>
            ) : (
              pageRows.map((r, i) => {
                const isOpen = openRow && openRow.asset_no === r.asset_no
                return (
                  <tr
                    key={r.asset_no || i}
                    onClick={() => openAsset(r)}
                    className="cursor-pointer border-t"
                    style={{
                      borderColor: 'var(--border-subtle)',
                      background: isOpen ? 'var(--surface-raised, var(--bg-elevated))' : undefined,
                    }}
                  >
                    <td className="px-4 py-2.5 text-left whitespace-nowrap font-medium">{fmtText(r.asset_no)}</td>
                    <td className="px-4 py-2.5 text-left whitespace-nowrap">{fmtText(r.vehicle_type)}</td>
                    <td className="px-4 py-2.5 text-left whitespace-nowrap">{unitLabel(r.unit)}</td>
                    <td className="px-4 py-2.5 text-left whitespace-nowrap">{sideLabel(r.side)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">{fmtInt(r.km)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">{fmtInt(r.hours)}</td>
                    <td className="px-4 py-2.5 text-left whitespace-nowrap"><StatusBadge status={r.status} /></td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <span className="inline-flex items-center gap-1 text-xs" style={{ color: 'var(--accent)' }}>
                        Both ways <ChevronRight size={13} />
                      </span>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div className="mt-3 flex items-center justify-between text-xs" style={{ color: 'var(--text-secondary)' }}>
          <span>Page {safePage + 1} of {pageCount}</span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={safePage === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="rounded-md border px-3 py-1 disabled:opacity-40"
              style={{ borderColor: 'var(--border-subtle)' }}
            >Prev</button>
            <button
              type="button"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              className="rounded-md border px-3 py-1 disabled:opacity-40"
              style={{ borderColor: 'var(--border-subtle)' }}
            >Next</button>
          </div>
        </div>
      )}

      {/* ---------- both-ways drill-down ---------- */}
      {openRow && (
        <BothWays
          row={openRow}
          kmDetail={kmDetail}
          hoursDetail={hoursDetail}
          loading={detailLoading}
          errored={detailErrored}
          currency={cur}
          onClose={closeAsset}
          onRetry={() => openAsset(openRow)}
        />
      )}
    </div>
  )
}

/* ---------- sortable header cell ---------- */

function Th({ children, align = 'left', onClick }) {
  return (
    <th
      onClick={onClick}
      className={`px-4 py-2.5 font-semibold whitespace-nowrap cursor-pointer select-none text-${align}`}
      style={{ color: 'var(--text-secondary)' }}
    >
      {children}
    </th>
  )
}

/* ---------- summary tiles ---------- */

function InfoTile({ icon: Icon, label, value }) {
  return (
    <div className="rounded-lg border p-3" style={{ borderColor: 'var(--border-subtle)' }}>
      <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
        {Icon ? <Icon size={13} /> : null} {label}
      </div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  )
}

function FlagTile({ label, value, tone, active, onClick }) {
  const t = TONE_STYLE[tone] || TONE_STYLE.neutral
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border p-3 text-left transition"
      style={{
        borderColor: active ? t.color : 'var(--border-subtle)',
        background: active ? t.bg : undefined,
      }}
      title="Click to filter the table to this status"
    >
      <div className="flex items-center gap-1.5 text-xs" style={{ color: t.color }}>
        <AlertTriangle size={13} /> {label}
      </div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </button>
  )
}

/* ---------- both-ways drill-down (km side by side with hours) ---------- */

/** First array-valued property of an object (used to count readings/tyres). */
function firstArrayLen(obj) {
  if (!obj || typeof obj !== 'object') return null
  for (const k of Object.keys(obj)) {
    if (Array.isArray(obj[k])) return obj[k].length
  }
  return null
}

function BothWays({ row, kmDetail, hoursDetail, loading, errored, currency, onClose, onRetry }) {
  const usesKm = row.unit === 'km'
  const typeLbl = fmtText(row.vehicle_type)

  // km side figures
  const km = kmDetail ? num(kmDetail.km) : (num(row.km) != null ? num(row.km) : null)
  const tyreCount = kmDetail && kmDetail.tyre_count != null
    ? num(kmDetail.tyre_count)
    : firstArrayLen(kmDetail)

  // hours side figures
  const hours = hoursDetail ? num(hoursDetail.hours) : (num(row.hours) != null ? num(row.hours) : null)
  const readingCount = firstArrayLen(hoursDetail)
  const hoursMin = hoursDetail ? num(hoursDetail.hours_min ?? hoursDetail.min) : null
  const hoursMax = hoursDetail ? num(hoursDetail.hours_max ?? hoursDetail.max) : null

  return (
    <section
      className="mt-5 rounded-xl border p-4"
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-raised, var(--bg-elevated))' }}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-2 text-base font-semibold">
          <Gauge size={18} /> Asset {fmtText(row.asset_no)} both ways
          <span className="text-sm font-normal" style={{ color: 'var(--text-secondary)' }}>
            ({typeLbl})
          </span>
        </h4>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <X size={12} /> Close
        </button>
      </div>

      {loading ? (
        <div className="py-8 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>Loading both units...</div>
      ) : errored ? (
        <div className="py-8 text-center">
          <div className="inline-flex flex-col items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
            <AlertTriangle size={20} />
            <span>Could not load this asset's figures.</span>
            <button
              type="button"
              onClick={onRetry}
              className="mt-1 inline-flex items-center gap-1.5 rounded-md border px-3 py-1 text-xs"
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              <RefreshCcw size={12} /> Retry
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {/* KM side */}
            <UnitCard
              icon={Truck}
              title="Km (from tyre consumption)"
              used={usesKm}
              primary={fmtInt(km)}
              primaryUnit="km"
              lines={[
                { label: 'Contributing tyres', value: fmtInt(tyreCount) },
              ]}
            />
            {/* HOURS side */}
            <UnitCard
              icon={Factory}
              title="Engine hours (from readings)"
              used={!usesKm}
              primary={fmtInt(hours)}
              primaryUnit="hours"
              lines={[
                { label: 'Readings', value: fmtInt(readingCount) },
                (hoursMin != null || hoursMax != null)
                  ? { label: 'Span (min to max)', value: `${fmtInt(hoursMin)} to ${fmtInt(hoursMax)}` }
                  : null,
              ].filter(Boolean)}
            />
          </div>

          <p className="mt-3 flex items-start gap-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
            <Info size={12} className="mt-0.5 shrink-0" />
            <span>
              CPK uses {unitLabel(row.unit).toLowerCase()} because this asset's type is {typeLbl};
              the other figure is recorded but not used in this asset's CPK.
              {row.status === 'both_present' && (
                <> Both units carry data here, so the {usesKm ? 'engine-hour' : 'km'} figure is available but ignored.</>
              )}
              {row.status === 'off_unit_only' && (
                <> This asset only has data on the other unit, so its CPK cannot be measured - check the type classification.</>
              )}
              {row.status === 'used_unit_no_data' && (
                <> There is no data for its own unit in this period, so its CPK reads N/A.</>
              )}
            </span>
          </p>
          <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
            Money is per country in {currency}.
          </p>
        </>
      )}
    </section>
  )
}

function UnitCard({ icon: Icon, title, used, primary, primaryUnit, lines }) {
  return (
    <div
      className="rounded-lg border p-3"
      style={{
        borderColor: used ? 'var(--accent)' : 'var(--border-subtle)',
        background: 'var(--bg-elevated)',
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          {Icon ? <Icon size={14} /> : null} {title}
        </div>
        <span
          className="rounded px-1.5 py-0.5 text-xs font-medium"
          style={used
            ? { color: '#fff', background: 'var(--accent)' }
            : { color: 'var(--text-secondary)', background: 'transparent' }}
        >
          {used ? 'Used by CPK' : 'Not used'}
        </span>
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">
        {primary} <span className="text-sm font-normal" style={{ color: 'var(--text-secondary)' }}>{primaryUnit}</span>
      </div>
      <div className="mt-2 space-y-1">
        {lines.map((l, i) => (
          <div key={i} className="flex items-center justify-between text-xs" style={{ color: 'var(--text-secondary)' }}>
            <span>{l.label}</span>
            <span className="tabular-nums">{l.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
