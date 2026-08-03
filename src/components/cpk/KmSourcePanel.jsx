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
  Layers, Route, Search, FileSpreadsheet, FileText, RefreshCcw,
  Info, X, ChevronRight, AlertCircle,
} from 'lucide-react'
import { getCpkKmSource } from '../../lib/api/fleetCpk'
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

const PAGE_SIZE = 25

export default function KmSourcePanel({ country, from, to, currency } = {}) {
  const countryLabel = country && country !== 'All' ? country : 'All'
  const cur = currency || countryLabel

  /* ----- per-asset summary (the km that feeds CPK) ----- */
  const [summary, setSummary] = useState({ ok: false })
  const [loading, setLoading] = useState(true)
  const [errored, setErrored] = useState(false)

  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)

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
        if (res && res.ok) {
          setSummary(res)
        } else {
          setSummary({ ok: false })
          if (res && res.reason && res.reason !== 'empty') setErrored(true)
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

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const pageRows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)

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
            className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            <RefreshCcw size={12} /> Refresh
          </button>
          <button
            type="button"
            onClick={() => exportSummary('excel')}
            disabled={!filtered.length}
            className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs disabled:opacity-40"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            <FileSpreadsheet size={12} /> Excel
          </button>
          <button
            type="button"
            onClick={() => exportSummary('pdf')}
            disabled={!filtered.length}
            className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs disabled:opacity-40"
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
              onChange={(e) => { setQ(e.target.value); setPage(0) }}
              placeholder="Search asset"
              className="w-full rounded-md border bg-transparent pl-8 pr-3 py-1.5 text-sm"
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
      <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }}>
        <table className="w-full text-sm border-collapse">
          <thead
            className="sticky top-0 z-10"
            style={{ background: 'var(--surface-raised, var(--bg-elevated))' }}
          >
            <tr>
              <th className="px-4 py-2.5 text-left font-semibold whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>Asset</th>
              <th className="px-4 py-2.5 text-right font-semibold whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>Tyres</th>
              <th className="px-4 py-2.5 text-right font-semibold whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>CPK Km</th>
              <th className="px-4 py-2.5 text-right font-semibold whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>View</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center" style={{ color: 'var(--text-secondary)' }}>Loading...</td></tr>
            ) : errored ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center">
                  <div className="inline-flex flex-col items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                    <AlertCircle size={20} />
                    <span>Could not load the KM source.</span>
                    <button
                      type="button"
                      onClick={loadSummary}
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
                <td colSpan={4} className="px-4 py-8 text-center" style={{ color: 'var(--text-secondary)' }}>
                  No tyre km recorded for this period.
                </td>
              </tr>
            ) : (
              pageRows.map((r, i) => {
                const isOpen = openAsset === r.asset_no
                return (
                  <tr
                    key={r.asset_no || i}
                    onClick={() => openAssetDetail(r.asset_no)}
                    className="cursor-pointer border-t"
                    style={{
                      borderColor: 'var(--border-subtle)',
                      background: isOpen ? 'var(--surface-raised, var(--bg-elevated))' : undefined,
                    }}
                  >
                    <td className="px-4 py-2.5 text-left whitespace-nowrap font-medium">{fmtText(r.asset_no)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">{fmtInt(r.tyres)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">{fmtInt(r.km)}</td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <span className="inline-flex items-center gap-1 text-xs" style={{ color: 'var(--accent)' }}>
                        View tyres <ChevronRight size={13} />
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

/* ---------- asset detail sub-view (inline, contributing tyres + subtotal) ---------- */

function AssetDetail({ assetNo, detail, loading, errored, currency, onClose, onRetry, onExport }) {
  const tyres = detail && Array.isArray(detail.tyres) ? detail.tyres : []
  const km = detail ? detail.km : null
  // The tyres' total_km sums to this; show it and prove it against detail.km.
  const summed = tyres.reduce((s, t) => s + (num(t?.total_km) || 0), 0)

  return (
    <section
      className="mt-5 rounded-xl border p-4"
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-raised, var(--bg-elevated))' }}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-2 text-base font-semibold">
          <Route size={18} /> Contributing tyres
          <span className="text-sm font-normal" style={{ color: 'var(--text-secondary)' }}>
            (asset {fmtText(assetNo)})
          </span>
        </h4>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onExport('excel')}
            disabled={!tyres.length}
            className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs disabled:opacity-40"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            <FileSpreadsheet size={12} /> Excel
          </button>
          <button
            type="button"
            onClick={() => onExport('pdf')}
            disabled={!tyres.length}
            className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs disabled:opacity-40"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            <FileText size={12} /> PDF
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            <X size={12} /> Close
          </button>
        </div>
      </div>

      {loading ? (
        <div className="py-8 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>Loading tyres...</div>
      ) : errored ? (
        <div className="py-8 text-center">
          <div className="inline-flex flex-col items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
            <AlertCircle size={20} />
            <span>Could not load this asset's tyres.</span>
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
      ) : tyres.length === 0 ? (
        <div className="py-8 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
          No contributing tyres recorded for this asset in this period.
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }}>
            <table className="w-full text-sm border-collapse">
              <thead style={{ background: 'var(--bg-elevated)' }}>
                <tr>
                  {['Serial', 'Position', 'Brand', 'Size', 'Job Card', 'Fitment', 'Removal', 'Effective'].map((h) => (
                    <th key={h} className="px-3 py-2 text-left font-semibold whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{h}</th>
                  ))}
                  {['Km at Fitment', 'Km at Removal', 'Total Km', `Cost/Tyre (${currency})`, 'Source'].map((h) => (
                    <th key={h} className="px-3 py-2 text-right font-semibold whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tyres.map((t, i) => (
                  <tr key={(t.serial_no || '') + '-' + (t.position || '') + '-' + i} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                    <td className="px-3 py-1.5 text-left whitespace-nowrap font-medium">{fmtText(t.serial_no)}</td>
                    <td className="px-3 py-1.5 text-left whitespace-nowrap">{fmtText(t.position)}</td>
                    <td className="px-3 py-1.5 text-left whitespace-nowrap">{fmtText(t.brand)}</td>
                    <td className="px-3 py-1.5 text-left whitespace-nowrap">{fmtText(t.size)}</td>
                    <td className="px-3 py-1.5 text-left whitespace-nowrap">{fmtText(t.job_card)}</td>
                    <td className="px-3 py-1.5 text-left whitespace-nowrap">{fmtDate(t.fitment_date)}</td>
                    <td className="px-3 py-1.5 text-left whitespace-nowrap">{fmtDate(t.removal_date)}</td>
                    <td className="px-3 py-1.5 text-left whitespace-nowrap">{fmtDate(t.effective_date)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">{fmtInt(t.km_at_fitment)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">{fmtInt(t.km_at_removal)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap font-semibold">{fmtInt(t.total_km)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">{fmtMoney(t.cost_per_tyre)}</td>
                    <td className="px-3 py-1.5 text-right whitespace-nowrap">{fmtText(t.data_source)}</td>
                  </tr>
                ))}
                {/* Subtotal row = the km used in CPK for this asset. */}
                <tr className="border-t-2" style={{ borderColor: 'var(--accent)', background: 'var(--bg-elevated)' }}>
                  <td colSpan={10} className="px-3 py-2 text-right font-semibold whitespace-nowrap">
                    Subtotal (sum of total km)
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap font-bold">{fmtInt(summed)}</td>
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2" />
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
            <Info size={12} className="shrink-0" />
            This subtotal ({fmtInt(km)} km) is the km used in CPK for this asset.
            {km != null && Math.round(summed) !== Math.round(num(km) || 0) && (
              <span> Displayed tyre rows sum to {fmtInt(summed)} km.</span>
            )}
          </p>
        </>
      )}
    </section>
  )
}
