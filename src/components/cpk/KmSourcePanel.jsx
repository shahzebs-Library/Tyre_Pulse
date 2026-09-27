/**
 * KmSourcePanel - the "KM Source" explorer for the Fleet CPK module.
 *
 * Fleet CPK's km side is the SUM of each tyre's `total_km` taken from the MONTHLY
 * TYRE CONSUMPTION data, matched to the tyre's change month by
 * coalesce(removal_date, issue_date) - the identical filter get_fleet_cpk uses.
 * So every asset's CPK km is fully traceable to its individual tyre rows. This
 * panel makes that visible and reconciling:
 *
 *   1. A per-asset summary (asset, tyre count, km) = the km that feeds CPK.
 *   2. Click an asset to open its exact contributing tyres, whose total_km sums
 *      to the asset's CPK km (shown as an explicit subtotal row).
 *   3. Excel + PDF export of both the summary and the open asset's tyre detail.
 *
 * Data comes ONLY from getCpkKmSource (src/lib/api/fleetCpk.js), which degrades
 * to { ok:false } and never throws. This component is presentational + fetches
 * asset detail on demand; it never queries Supabase directly.
 *
 * Props:
 *   country  - 'KSA' | 'UAE' | 'Egypt' | 'All'
 *   from,to  - ISO YYYY-MM-DD period bounds
 *   currency - currency label for the cost-per-tyre column
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Layers, Milestone, Search, FileSpreadsheet, FileText, RefreshCcw,
  Info, ChevronRight,
} from 'lucide-react'
import { getCpkKmSource } from '../../lib/api/fleetCpk'
import { exportToExcel, exportToPdf, reportFileName, reportDateLabel } from '../../lib/exportUtils'
import { compareValues, isBlank } from '../../lib/consoleTable'
import EnterpriseTable from '../ui/EnterpriseTable'
import Modal from '../ui/Modal'

const valueSort = (a, b, id) => compareValues(a.getValue(id), b.getValue(id))
const blank = (v) => (isBlank(v) ? undefined : v)
const sortable = { sortingFn: valueSort, sortUndefined: 'last' }
const BTN = 'inline-flex min-h-[44px] items-center gap-1.5 rounded-md border px-3 py-1 text-xs disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]'

/**
 * Only an explicit "empty" answer is an empty period. Any other refusal
 * (an RPC error, a scope refusal, an unreachable backend) means the km is
 * NOT KNOWN, and rendering it as "no tyre km" would state a fact nobody
 * measured.
 */
export function kmSourceOutcome(res) {
  if (res && res.ok) return 'ok'
  if (res && res.reason === 'empty') return 'empty'
  return 'failed'
}

/* ---------- formatting helpers (ASCII only, honest N/A) ---------- */

function num(v) {
  return Number.isFinite(Number(v)) ? Number(v) : null
}

/** Integer with thousands separators; null/blank -> "N/A". */
function fmtInt(v) {
  const n = num(v)
  return n == null ? 'N/A' : Math.round(n).toLocaleString()
}

/** Money with thousands separators; null/blank -> "N/A". */
function fmtMoney(v) {
  const n = num(v)
  return n == null ? 'N/A' : Math.round(n).toLocaleString()
}

/** Date rendered as a short label; blank -> "N/A". */
function fmtDate(v) {
  if (v == null || v === '') return 'N/A'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v)
  return reportDateLabel(d)
}

/** Any plain text value; blank -> "N/A". */
function fmtText(v) {
  return v == null || String(v).trim() === '' ? 'N/A' : String(v)
}


export default function KmSourcePanel({ country, from, to, currency } = {}) {
  const countryLabel = country && country !== 'All' ? country : 'All'
  const cur = currency || countryLabel

  /* ----- per-asset summary (the km that feeds CPK) ----- */
  const [summary, setSummary] = useState({ ok: false })
  const [loading, setLoading] = useState(true)
  const [errored, setErrored] = useState(false)

  const [q, setQ] = useState('')

  /* ----- open asset detail (contributing tyres) ----- */
  const [openAsset, setOpenAsset] = useState(null) // asset_no string
  const [detail, setDetail] = useState(null)       // { ok, km, tyre_count, tyres, basis }
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailErrored, setDetailErrored] = useState(false)

  const loadSummary = useCallback(() => {
    let cancelled = false
    setLoading(true)
    setErrored(false)
    // Reset any open drawer when the window changes.
    setOpenAsset(null)
    setDetail(null)
    getCpkKmSource({ country, from, to })
      .then((res) => {
        if (cancelled) return
        const outcome = kmSourceOutcome(res)
        if (outcome === 'ok') setSummary(res)
        else {
          setSummary({ ok: false })
          if (outcome === 'failed') setErrored(true)
        }
      })
      .catch(() => {
        if (cancelled) return
        setSummary({ ok: false })
        setErrored(true)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [country, from, to])

  useEffect(() => loadSummary(), [loadSummary])

  const byAsset = useMemo(
    () => (summary.ok && Array.isArray(summary.by_asset) ? summary.by_asset : []),
    [summary],
  )

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    const base = byAsset
    const rows = term
      ? base.filter((r) => String(r?.asset_no ?? '').toLowerCase().includes(term))
      : base.slice()
    // km descending by default.
    return rows.sort((a, b) => (num(b?.km) || 0) - (num(a?.km) || 0))
  }, [byAsset, q])

  const summaryColumns = [
    { id: 'asset_no', header: 'Asset', accessorFn: (r) => blank(r.asset_no), ...sortable, meta: { exportValue: (r) => fmtText(r.asset_no) }, cell: ({ row: { original: r } }) => <span className="font-medium whitespace-nowrap">{fmtText(r.asset_no)}</span> },
    { id: 'tyres', header: 'Tyres', accessorFn: (r) => num(r.tyres) ?? undefined, ...sortable, meta: { align: 'right' }, cell: ({ row: { original: r } }) => <span className="tabular-nums">{fmtInt(r.tyres)}</span> },
    { id: 'km', header: 'CPK Km', accessorFn: (r) => num(r.km) ?? undefined, ...sortable, meta: { align: 'right' }, cell: ({ row: { original: r } }) => <span className="tabular-nums">{fmtInt(r.km)}</span> },
    {
      id: 'view', header: 'View', enableSorting: false, meta: { align: 'right', export: false },
      cell: ({ row: { original: r } }) => (
        <button type="button" onClick={(e) => { e.stopPropagation(); openAssetDetail(r.asset_no) }}
          aria-label={`View tyres for ${fmtText(r.asset_no)}`}
          className="inline-flex min-h-[36px] items-center gap-1 text-xs" style={{ color: 'var(--accent)' }}>
          View tyres <ChevronRight size={13} aria-hidden="true" />
        </button>
      ),
    },
  ]

  const totalKm = useMemo(() => filtered.reduce((s, r) => s + (num(r?.km) || 0), 0), [filtered])
  const totalTyres = useMemo(() => filtered.reduce((s, r) => s + (num(r?.tyres) || 0), 0), [filtered])

  function openAssetDetail(assetNo) {
    if (!assetNo) return
    setOpenAsset(assetNo)
    setDetail(null)
    setDetailErrored(false)
    setDetailLoading(true)
    getCpkKmSource({ country, from, to, asset: assetNo })
      .then((res) => {
        if (res && res.ok) setDetail(res)
        else { setDetail(null); setDetailErrored(true) }
      })
      .catch(() => { setDetail(null); setDetailErrored(true) })
      .finally(() => setDetailLoading(false))
  }

  function closeDetail() {
    setOpenAsset(null)
    setDetail(null)
    setDetailErrored(false)
  }

  /* ---------- exports ---------- */

  function exportSummary(kind) {
    const rows = filtered.map((r) => ({
      asset_no: fmtText(r.asset_no),
      tyres: num(r.tyres) == null ? 'N/A' : Math.round(num(r.tyres)),
      km: num(r.km) == null ? 'N/A' : Math.round(num(r.km)),
    }))
    if (!rows.length) return
    const name = reportFileName('TyrePulse CPK KM Source', countryLabel, reportDateLabel())
    if (kind === 'excel') {
      exportToExcel(
        rows,
        ['asset_no', 'tyres', 'km'],
        ['Asset', 'Tyres', 'CPK Km'],
        name,
        'CPK KM Source',
      )
    } else {
      exportToPdf(
        rows,
        [
          { key: 'asset_no', header: 'Asset' },
          { key: 'tyres', header: 'Tyres' },
          { key: 'km', header: 'CPK Km' },
        ],
        `CPK KM Source by asset (${countryLabel})`,
        name,
        'landscape',
      )
    }
  }

  function exportDetail(kind) {
    if (!detail || !Array.isArray(detail.tyres) || !detail.tyres.length) return
    const rows = detail.tyres.map((t) => ({
      serial_no: fmtText(t.serial_no),
      position: fmtText(t.position),
      brand: fmtText(t.brand),
      size: fmtText(t.size),
      job_card: fmtText(t.job_card),
      fitment_date: fmtDate(t.fitment_date),
      removal_date: fmtDate(t.removal_date),
      effective_date: fmtDate(t.effective_date),
      km_at_fitment: num(t.km_at_fitment) == null ? 'N/A' : Math.round(num(t.km_at_fitment)),
      km_at_removal: num(t.km_at_removal) == null ? 'N/A' : Math.round(num(t.km_at_removal)),
      total_km: num(t.total_km) == null ? 'N/A' : Math.round(num(t.total_km)),
      cost_per_tyre: num(t.cost_per_tyre) == null ? 'N/A' : Math.round(num(t.cost_per_tyre)),
      data_source: fmtText(t.data_source),
    }))
    // Subtotal row = the km used in CPK for this asset.
    rows.push({
      serial_no: 'SUBTOTAL (CPK km for this asset)',
      position: '', brand: '', size: '', job_card: '',
      fitment_date: '', removal_date: '', effective_date: '',
      km_at_fitment: '', km_at_removal: '',
      total_km: num(detail.km) == null ? 'N/A' : Math.round(num(detail.km)),
      cost_per_tyre: '', data_source: '',
    })
    const name = reportFileName('TyrePulse CPK KM Source', countryLabel, openAsset, reportDateLabel())
    if (kind === 'excel') {
      exportToExcel(
        rows,
        ['serial_no', 'position', 'brand', 'size', 'job_card', 'fitment_date', 'removal_date', 'effective_date', 'km_at_fitment', 'km_at_removal', 'total_km', 'cost_per_tyre', 'data_source'],
        ['Serial', 'Position', 'Brand', 'Size', 'Job Card', 'Fitment', 'Removal', 'Effective', 'Km at Fitment', 'Km at Removal', 'Total Km', `Cost per Tyre (${cur})`, 'Source'],
        name,
        'CPK KM Tyres',
      )
    } else {
      exportToPdf(
        rows,
        [
          { key: 'serial_no', header: 'Serial' },
          { key: 'position', header: 'Position' },
          { key: 'brand', header: 'Brand' },
          { key: 'size', header: 'Size' },
          { key: 'job_card', header: 'Job Card' },
          { key: 'fitment_date', header: 'Fitment' },
          { key: 'removal_date', header: 'Removal' },
          { key: 'effective_date', header: 'Effective' },
          { key: 'km_at_fitment', header: 'Km Fit' },
          { key: 'km_at_removal', header: 'Km Rem' },
          { key: 'total_km', header: 'Total Km' },
          { key: 'cost_per_tyre', header: `Cost (${cur})` },
          { key: 'data_source', header: 'Source' },
        ],
        `CPK KM tyres for ${openAsset} (${countryLabel})`,
        name,
        'landscape',
      )
    }
  }

  const basisText = summary.ok && summary.basis ? summary.basis : null

  return (
    <div className="w-full">
      {/* ---------- explainer banner ---------- */}
      <div
        className="mb-4 flex items-start gap-3 rounded-xl border p-4"
        style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-raised, var(--bg-elevated))' }}
      >
        <Info size={18} className="mt-0.5 shrink-0" style={{ color: 'var(--accent)' }} />
        <div className="text-sm">
          <div className="font-semibold mb-1">KM source: monthly tyre consumption</div>
          <p style={{ color: 'var(--text-secondary)' }}>
            Each tyre carries its own total km. An asset's CPK km is the sum of its tyres' total km within
            this period, matched to the tyre's change month by removal date (or issue date if the tyre is
            still fitted). Every km below traces back to individual tyre rows, so the CPK km reconciles
            exactly to these figures.
          </p>
          {basisText && (
            <p className="mt-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
              Basis: {basisText}
            </p>
          )}
        </div>
      </div>

      {/* ---------- header + summary export ---------- */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-base font-semibold">
          <Layers size={18} /> KM by asset
          <span className="text-sm font-normal" style={{ color: 'var(--text-secondary)' }}>
            ({countryLabel})
          </span>
        </h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadSummary}
            className={BTN}
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            <RefreshCcw size={12} /> Refresh
          </button>
          <button
            type="button"
            onClick={() => exportSummary('excel')}
            disabled={!filtered.length}
            className={BTN}
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            <FileSpreadsheet size={12} /> Excel
          </button>
          <button
            type="button"
            onClick={() => exportSummary('pdf')}
            disabled={!filtered.length}
            className={BTN}
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            <FileText size={12} /> PDF
          </button>
        </div>
      </div>

      {/* ---------- search + totals ---------- */}
      {summary.ok && byAsset.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 opacity-50" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search asset"
              placeholder="Search asset"
              className="w-full min-h-[44px] rounded-md border bg-transparent pl-8 pr-3 py-1.5 text-sm"
              style={{ borderColor: 'var(--border-subtle)' }}
            />
          </div>
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {filtered.length.toLocaleString()} asset{filtered.length === 1 ? '' : 's'} |{' '}
            {fmtInt(totalTyres)} tyres | {fmtInt(totalKm)} km
          </span>
        </div>
      )}

      {/* ---------- summary table / states ---------- */}
      <EnterpriseTable
        columns={summaryColumns}
        data={filtered}
        getRowId={(r, i) => String(r.asset_no ?? i)}
        loading={loading}
        error={errored ? 'Could not load the KM source. The km is not known, which is not the same as zero.' : null}
        onRetry={loadSummary}
        enableGlobalFilter={false}
        enableColumnFilters={false}
        enableExport={false}
        resetPageKey={`${country}|${from}|${to}|${q}`}
        onRowClick={(r) => openAssetDetail(r.asset_no)}
        emptyMessage="No tyre km recorded for this period."
      />

      {/* ---------- asset detail (contributing tyres) ---------- */}
      {openAsset && (
        <AssetDetail
          assetNo={openAsset}
          detail={detail}
          loading={detailLoading}
          errored={detailErrored}
          currency={cur}
          onClose={closeDetail}
          onRetry={() => openAssetDetail(openAsset)}
          onExport={exportDetail}
        />
      )}
    </div>
  )
}

const DETAIL_COLUMNS = (currency) => [
  { id: 'serial_no', header: 'Serial', accessorFn: (t) => blank(t.serial_no), ...sortable, meta: { exportValue: (t) => fmtText(t.serial_no) }, cell: ({ row: { original: t } }) => <span className="font-medium whitespace-nowrap">{fmtText(t.serial_no)}</span> },
  ...[['position', 'Position'], ['brand', 'Brand'], ['size', 'Size'], ['job_card', 'Job Card']].map(([key, header]) => ({
    id: key, header, accessorFn: (t) => blank(t[key]), ...sortable, meta: { exportValue: (t) => fmtText(t[key]) },
    cell: ({ row: { original: t } }) => <span className="whitespace-nowrap">{fmtText(t[key])}</span>,
  })),
  ...[['fitment_date', 'Fitment'], ['removal_date', 'Removal'], ['effective_date', 'Effective']].map(([key, header]) => ({
    id: key, header, accessorFn: (t) => blank(t[key]), ...sortable, meta: { exportValue: (t) => fmtDate(t[key]) },
    cell: ({ row: { original: t } }) => <span className="whitespace-nowrap">{fmtDate(t[key])}</span>,
  })),
  ...[['km_at_fitment', 'Km at Fitment'], ['km_at_removal', 'Km at Removal'], ['total_km', 'Total Km']].map(([key, header]) => ({
    id: key, header, accessorFn: (t) => num(t[key]) ?? undefined, ...sortable, meta: { align: 'right', exportValue: (t) => num(t[key]) ?? 'N/A' },
    cell: ({ row: { original: t } }) => <span className={`tabular-nums ${key === 'total_km' ? 'font-semibold' : ''}`}>{fmtInt(t[key])}</span>,
  })),
  {
    id: 'cost_per_tyre', header: `Cost/Tyre (${currency})`, accessorFn: (t) => num(t.cost_per_tyre) ?? undefined, ...sortable,
    meta: { align: 'right', exportValue: (t) => num(t.cost_per_tyre) ?? 'N/A' },
    cell: ({ row: { original: t } }) => <span className="tabular-nums">{fmtMoney(t.cost_per_tyre)}</span>,
  },
  { id: 'data_source', header: 'Source', accessorFn: (t) => blank(t.data_source), ...sortable, meta: { exportValue: (t) => fmtText(t.data_source) }, cell: ({ row: { original: t } }) => fmtText(t.data_source) },
]

/* ---------- asset detail dialog (contributing tyres + subtotal) ---------- */

function AssetDetail({ assetNo, detail, loading, errored, currency, onClose, onRetry, onExport }) {
  const tyres = detail && Array.isArray(detail.tyres) ? detail.tyres : []
  const km = detail ? detail.km : null
  // The tyres' total_km sums to this; show it and prove it against detail.km.
  const summed = tyres.reduce((s, t) => s + (num(t?.total_km) || 0), 0)
  const columns = useMemo(() => DETAIL_COLUMNS(currency), [currency])

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={<span className="inline-flex items-center gap-2"><Milestone size={18} aria-hidden="true" /> Contributing tyres</span>}
      subtitle={`Asset ${fmtText(assetNo)}`}
      headerExtra={(
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => onExport('excel')} disabled={!tyres.length} className={BTN} style={{ borderColor: 'var(--border-subtle)' }}>
            <FileSpreadsheet size={12} aria-hidden="true" /> Excel
          </button>
          <button type="button" onClick={() => onExport('pdf')} disabled={!tyres.length} className={BTN} style={{ borderColor: 'var(--border-subtle)' }}>
            <FileText size={12} aria-hidden="true" /> PDF
          </button>
        </div>
      )}
    >
      <EnterpriseTable
        columns={columns}
        data={tyres}
        getRowId={(t, i) => `${t.serial_no || ''}-${t.position || ''}-${i}`}
        loading={loading}
        error={errored ? 'Could not load this asset\'s tyres. Their km is not known, which is not the same as zero.' : null}
        onRetry={onRetry}
        enableColumnFilters={false}
        enableExport={false}
        searchPlaceholder="Search serial, brand, job card..."
        emptyMessage="No contributing tyres recorded for this asset in this period."
      />
      {!loading && !errored && tyres.length > 0 && (
        <>
          {/* Subtotal = the km used in CPK for this asset. */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border-t-2 px-3 py-2 text-sm"
            style={{ borderColor: 'var(--accent)', background: 'var(--surface-raised, var(--bg-elevated))' }}>
            <span className="font-semibold">Subtotal (sum of total km)</span>
            <span className="tabular-nums font-bold">{fmtInt(summed)}</span>
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
            <Info size={12} className="shrink-0" aria-hidden="true" />
            This subtotal ({fmtInt(km)} km) is the km used in CPK for this asset.
            {km != null && Math.round(summed) !== Math.round(num(km) || 0) && (
              <span> Displayed tyre rows sum to {fmtInt(summed)} km.</span>
            )}
          </p>
        </>
      )}
    </Modal>
  )
}
