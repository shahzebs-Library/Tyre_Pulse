/**
 * CpkKmIntelligencePanel - "Km Intelligence" for the Fleet CPK module.
 *
 * CPK measures km two ways and this panel reconciles them per asset so a user can
 * SEE and JUDGE the km quality behind the number:
 *   - tyre-km : the sum of each tyre's life in the period (the current CPK basis),
 *     from the monthly tyre consumption.
 *   - odometer km : the vehicle's actual distance from the master meter readings,
 *     smoothed over ALL history.
 * They measure different things. The odometer ALSO covers assets that have no tyre
 * changes (odo-only), so it shows where each source is strong and where tyre-km
 * has blind spots. Each odometer figure carries a confidence based on how many
 * readings, resets and months back it.
 *
 * Data comes ONLY from the fleetCpk service (getCpkKmIntelligence), which degrades
 * to { ok:false } and never throws. This component is presentational + fetches on
 * mount; it never queries Supabase.
 *
 * Props:
 *   country  - 'KSA' | 'UAE' | 'Egypt' | 'All'
 *   from,to  - ISO YYYY-MM-DD period bounds
 *   currency - currency label (kept for signature parity; little money shown here)
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Gauge, Milestone, Layers, Search, FileSpreadsheet, FileText, RefreshCcw,
  Info, AlertTriangle, CheckCircle2, Truck, ChevronUp, ChevronDown, X,
} from 'lucide-react'
import { getCpkKmIntelligence } from '../../lib/api/fleetCpk'
import { exportToExcel, exportToPdf, reportFileName, reportDateLabel } from '../../lib/exportUtils'

/* ---------- formatting helpers (ASCII only, honest N/A) ---------- */

function num(v) {
  return Number.isFinite(Number(v)) ? Number(v) : null
}

/** Integer with thousands separators; null/0-absent -> "N/A". */
function fmtInt(v) {
  const n = num(v)
  return n == null ? 'N/A' : Math.round(n).toLocaleString()
}

/** Integer that legitimately can be 0 (counts of readings/resets/months). */
function fmtCount(v) {
  const n = num(v)
  return n == null ? 'N/A' : Math.round(n).toLocaleString()
}

/** Any plain text value; blank -> "N/A". */
function fmtText(v) {
  return v == null || String(v).trim() === '' ? 'N/A' : String(v)
}

/** A percentage where null means "cannot compare" -> "N/A". */
function fmtPct(v) {
  const n = num(v)
  return n == null ? 'N/A' : `${Math.round(n)}%`
}

/** The unit an asset is measured in, in plain words. */
function unitLabel(unit) {
  if (unit === 'engine_hours') return 'Engine hours'
  if (unit === 'km') return 'Km'
  return fmtText(unit)
}

/* ---------- confidence vocabulary (labelled badges + rank for sort) ---------- */

const CONFIDENCE_META = {
  high: { label: 'High', tone: 'good', rank: 3 },
  medium: { label: 'Medium', tone: 'warn', rank: 2 },
  low: { label: 'Low', tone: 'bad', rank: 1 },
  none: { label: 'None', tone: 'neutral', rank: 0 },
}

function confidenceMeta(conf) {
  return CONFIDENCE_META[conf] || { label: fmtText(conf), tone: 'neutral', rank: -1 }
}

/* ---------- coverage vocabulary ---------- */

const COVERAGE_META = {
  both: { label: 'Both sources', rank: 3 },
  odo_only: { label: 'Odometer only', rank: 2 },
  tyre_only: { label: 'Tyre-km only', rank: 1 },
  neither: { label: 'Neither', rank: 0 },
}

function coverageMeta(cov) {
  return COVERAGE_META[cov] || { label: fmtText(cov), rank: -1 }
}

/* Semantic hues - explicit colours because the colour carries meaning
 * (good / warning / problem). Soft alpha backgrounds read on both themes. */
const TONE_STYLE = {
  good: { color: '#16a34a', bg: 'rgba(22,163,74,0.12)' },
  warn: { color: '#d97706', bg: 'rgba(217,119,6,0.14)' },
  bad: { color: '#dc2626', bg: 'rgba(220,38,38,0.12)' },
  neutral: { color: 'var(--text-secondary)', bg: 'var(--bg-elevated)' },
}

function ConfidenceBadge({ confidence }) {
  const meta = confidenceMeta(confidence)
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

const COVERAGE_FILTERS = [
  { key: 'all', label: 'All coverage' },
  { key: 'both', label: 'Both sources' },
  { key: 'odo_only', label: 'Odometer only' },
  { key: 'tyre_only', label: 'Tyre-km only' },
]

const CONFIDENCE_FILTERS = [
  { key: 'all', label: 'All confidence' },
  { key: 'high', label: 'High' },
  { key: 'medium', label: 'Medium' },
  { key: 'low', label: 'Low' },
  { key: 'none', label: 'None' },
]

export default function CpkKmIntelligencePanel({ country, from, to, currency } = {}) {
  const countryLabel = country && country !== 'All' ? country : 'All'

  /* ----- data ----- */
  const [intel, setIntel] = useState({ ok: false })
  const [loading, setLoading] = useState(true)
  const [errored, setErrored] = useState(false)

  /* ----- table controls ----- */
  const [q, setQ] = useState('')
  const [coverageFilter, setCoverageFilter] = useState('all')
  const [confidenceFilter, setConfidenceFilter] = useState('all')
  const [page, setPage] = useState(0)
  const [sort, setSort] = useState({ key: 'odo_km', dir: 'desc' })

  const loadIntel = useCallback(() => {
    let cancelled = false
    setLoading(true)
    setErrored(false)
    getCpkKmIntelligence({ country, from, to })
      .then((res) => {
        if (cancelled) return
        if (res && res.ok) {
          setIntel(res)
        } else {
          setIntel({ ok: false })
          if (res && res.reason && res.reason !== 'empty') setErrored(true)
        }
      })
      .catch(() => {
        if (cancelled) return
        setIntel({ ok: false })
        setErrored(true)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [country, from, to])

  useEffect(() => loadIntel(), [loadIntel])

  const assets = useMemo(
    () => (intel.ok && Array.isArray(intel.per_asset) ? intel.per_asset : []),
    [intel],
  )
  const summary = (intel.ok && intel.summary) || {}
  const note = (intel.ok && intel.summary && intel.summary.note) || ''

  /* ----- filter + search + sort ----- */
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    let rows = assets.slice()
    if (coverageFilter !== 'all') rows = rows.filter((r) => r?.coverage === coverageFilter)
    if (confidenceFilter !== 'all') rows = rows.filter((r) => r?.odo_confidence === confidenceFilter)
    if (term) {
      rows = rows.filter((r) =>
        String(r?.asset_no ?? '').toLowerCase().includes(term) ||
        String(r?.vehicle_type ?? '').toLowerCase().includes(term))
    }
    const { key, dir } = sort
    const mul = dir === 'asc' ? 1 : -1
    const numericKeys = ['tyre_km', 'odo_km', 'eng_hours', 'meter_hours', 'odo_vs_tyre_pct', 'odo_readings', 'odo_resets']
    rows.sort((a, b) => {
      let av
      let bv
      if (numericKeys.includes(key)) {
        av = num(a?.[key]); bv = num(b?.[key])
        av = av == null ? -1 : av; bv = bv == null ? -1 : bv
        if (av !== bv) return (av - bv) * mul
      } else if (key === 'odo_confidence') {
        av = confidenceMeta(a?.odo_confidence).rank; bv = confidenceMeta(b?.odo_confidence).rank
        if (av !== bv) return (av - bv) * mul
      } else if (key === 'coverage') {
        av = coverageMeta(a?.coverage).rank; bv = coverageMeta(b?.coverage).rank
        if (av !== bv) return (av - bv) * mul
      } else {
        av = String(a?.[key] ?? '').toLowerCase(); bv = String(b?.[key] ?? '').toLowerCase()
        if (av !== bv) return av < bv ? -1 * mul : 1 * mul
      }
      // stable tiebreak on asset
      return String(a?.asset_no ?? '').localeCompare(String(b?.asset_no ?? ''))
    })
    return rows
  }, [assets, q, coverageFilter, confidenceFilter, sort])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const pageRows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)

  function toggleSort(key) {
    setSort((cur) => (cur.key === key
      ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: key === 'asset_no' || key === 'vehicle_type' ? 'asc' : 'desc' }))
    setPage(0)
  }

  function clearFilters() {
    setCoverageFilter('all')
    setConfidenceFilter('all')
    setQ('')
    setPage(0)
  }

  const filtersActive = coverageFilter !== 'all' || confidenceFilter !== 'all' || q.trim() !== ''

  /* ----- exports ----- */
  function exportIntel(kind) {
    const rows = filtered.map((r) => ({
      asset_no: fmtText(r.asset_no),
      vehicle_type: fmtText(r.vehicle_type),
      unit: unitLabel(r.unit),
      tyre_km: num(r.tyre_km) == null ? 'N/A' : Math.round(num(r.tyre_km)),
      odo_km: num(r.odo_km) == null ? 'N/A' : Math.round(num(r.odo_km)),
      odo_vs_tyre_pct: num(r.odo_vs_tyre_pct) == null ? 'N/A' : Math.round(num(r.odo_vs_tyre_pct)),
      odo_confidence: confidenceMeta(r.odo_confidence).label,
      coverage: coverageMeta(r.coverage).label,
      odo_readings: fmtCount(r.odo_readings),
      odo_resets: fmtCount(r.odo_resets),
    }))
    if (!rows.length) return
    const name = reportFileName('TyrePulse CPK Km Intelligence', countryLabel, reportDateLabel())
    const colKeys = ['asset_no', 'vehicle_type', 'unit', 'tyre_km', 'odo_km', 'odo_vs_tyre_pct', 'odo_confidence', 'coverage', 'odo_readings', 'odo_resets']
    const headers = ['Asset', 'Type', 'Unit', 'Tyre km', 'Odometer km', 'Odo vs tyre %', 'Confidence', 'Coverage', 'Readings', 'Resets']
    if (kind === 'excel') {
      exportToExcel(rows, colKeys, headers, name, 'CPK Km Intelligence')
    } else {
      exportToPdf(
        rows,
        colKeys.map((k, i) => ({ key: k, header: headers[i] })),
        `CPK km intelligence (${countryLabel})`,
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

  return (
    <div className="w-full">
      {/* ---------- explainer banner ---------- */}
      <div
        className="mb-4 flex items-start gap-3 rounded-xl border p-4"
        style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-raised, var(--bg-elevated))' }}
      >
        <Info size={18} className="mt-0.5 shrink-0" style={{ color: 'var(--accent)' }} />
        <div className="text-sm">
          <div className="font-semibold mb-1">Km measured two ways</div>
          <p style={{ color: 'var(--text-secondary)' }}>
            CPK measures km two ways. tyre-km = the sum of each tyre's life in the period (the current
            CPK basis). Odometer km = the vehicle's actual distance from the master meter readings
            (smoothed, all history). They measure different things. The odometer also covers assets
            that have no tyre changes - use this to see where each source is strong.
          </p>
          {note && (
            <p className="mt-2 text-xs" style={{ color: 'var(--text-secondary)' }}>{note}</p>
          )}
        </div>
      </div>

      {/* ---------- summary tiles ---------- */}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        <InfoTile icon={Gauge} label="Assets with km" value={fmtInt(summary.assets)} />
        <InfoTile icon={Layers} label="Both sources" value={fmtInt(summary.both)} />
        <InfoTile
          icon={Milestone}
          label="Odometer-only"
          value={fmtInt(summary.odo_only)}
          highlight
          hint="assets the odometer adds that tyre-km misses"
        />
        <InfoTile icon={CheckCircle2} label="High-confidence odo" value={fmtInt(summary.odo_high_conf)} />
        <InfoTile icon={Truck} label="Total tyre-km" value={fmtInt(summary.tyre_km_total)} />
        <InfoTile icon={Milestone} label="Total odometer-km" value={fmtInt(summary.odo_km_total)} />
        <InfoTile icon={Gauge} label="Total engine-hours" value={fmtInt(summary.eng_hours_total)} />
      </div>

      {/* ---------- header + exports ---------- */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-base font-semibold">
          <Milestone size={18} /> Km source reconciliation
          <span className="text-sm font-normal" style={{ color: 'var(--text-secondary)' }}>
            ({countryLabel})
          </span>
        </h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadIntel}
            className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            <RefreshCcw size={12} /> Refresh
          </button>
          <button
            type="button"
            onClick={() => exportIntel('excel')}
            disabled={!filtered.length}
            className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs disabled:opacity-40"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            <FileSpreadsheet size={12} /> Excel
          </button>
          <button
            type="button"
            onClick={() => exportIntel('pdf')}
            disabled={!filtered.length}
            className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs disabled:opacity-40"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            <FileText size={12} /> PDF
          </button>
        </div>
      </div>

      {/* ---------- search + filters + totals ---------- */}
      {intel.ok && assets.length > 0 && (
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
          <select
            value={coverageFilter}
            onChange={(e) => { setCoverageFilter(e.target.value); setPage(0) }}
            className="rounded-md border bg-transparent px-2.5 py-1.5 text-sm"
            style={{ borderColor: 'var(--border-subtle)' }}
            aria-label="Coverage filter"
          >
            {COVERAGE_FILTERS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
          <select
            value={confidenceFilter}
            onChange={(e) => { setConfidenceFilter(e.target.value); setPage(0) }}
            className="rounded-md border bg-transparent px-2.5 py-1.5 text-sm"
            style={{ borderColor: 'var(--border-subtle)' }}
            aria-label="Confidence filter"
          >
            {CONFIDENCE_FILTERS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
          {filtersActive && (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs"
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              Clear <X size={12} />
            </button>
          )}
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {filtered.length.toLocaleString()} asset{filtered.length === 1 ? '' : 's'}
          </span>
        </div>
      )}

      {/* ---------- table / states ---------- */}
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
              <Th onClick={() => toggleSort('tyre_km')} align="right">Tyre km {sortIcon('tyre_km')}</Th>
              <Th onClick={() => toggleSort('odo_km')} align="right">Odometer km {sortIcon('odo_km')}</Th>
              <Th onClick={() => toggleSort('odo_vs_tyre_pct')} align="right">Odo vs tyre % {sortIcon('odo_vs_tyre_pct')}</Th>
              <Th onClick={() => toggleSort('odo_confidence')} align="left">Confidence {sortIcon('odo_confidence')}</Th>
              <Th onClick={() => toggleSort('coverage')} align="left">Coverage {sortIcon('coverage')}</Th>
              <Th onClick={() => toggleSort('odo_readings')} align="right">Readings {sortIcon('odo_readings')}</Th>
              <Th onClick={() => toggleSort('odo_resets')} align="right">Resets {sortIcon('odo_resets')}</Th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} className="px-4 py-8 text-center" style={{ color: 'var(--text-secondary)' }}>Loading...</td></tr>
            ) : errored ? (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center">
                  <div className="inline-flex flex-col items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                    <AlertTriangle size={20} />
                    <span>Could not load km intelligence.</span>
                    <button
                      type="button"
                      onClick={loadIntel}
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
                <td colSpan={10} className="px-4 py-8 text-center" style={{ color: 'var(--text-secondary)' }}>
                  {assets.length === 0
                    ? `No assets with a km source in this period for ${countryLabel}.`
                    : 'No assets match the current filter.'}
                </td>
              </tr>
            ) : (
              pageRows.map((r, i) => (
                <tr
                  key={r.asset_no || i}
                  className="border-t"
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  <td className="px-4 py-2.5 text-left whitespace-nowrap font-medium">{fmtText(r.asset_no)}</td>
                  <td className="px-4 py-2.5 text-left whitespace-nowrap">{fmtText(r.vehicle_type)}</td>
                  <td className="px-4 py-2.5 text-left whitespace-nowrap">{unitLabel(r.unit)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">{fmtInt(r.tyre_km)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">{fmtInt(r.odo_km)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">{fmtPct(r.odo_vs_tyre_pct)}</td>
                  <td className="px-4 py-2.5 text-left whitespace-nowrap"><ConfidenceBadge confidence={r.odo_confidence} /></td>
                  <td className="px-4 py-2.5 text-left whitespace-nowrap">{coverageMeta(r.coverage).label}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">{fmtCount(r.odo_readings)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">{fmtCount(r.odo_resets)}</td>
                </tr>
              ))
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

      {currency && (
        <p className="mt-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
          Figures are counts and km; any money is per country in {currency}.
        </p>
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

/* ---------- summary tile ---------- */

function InfoTile({ icon: Icon, label, value, highlight, hint }) {
  return (
    <div
      className="rounded-lg border p-3"
      style={{
        borderColor: highlight ? 'var(--accent)' : 'var(--border-subtle)',
        background: highlight ? 'var(--surface-raised, var(--bg-elevated))' : undefined,
      }}
      title={hint || undefined}
    >
      <div className="flex items-center gap-1.5 text-xs" style={{ color: highlight ? 'var(--accent)' : 'var(--text-secondary)' }}>
        {Icon ? <Icon size={13} /> : null} {label}
      </div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  )
}
