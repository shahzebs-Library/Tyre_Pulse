/**
 * TyreRunningLife - "Running & Remaining" section (mounted on /tyre-lifecycle).
 * Per ACTIVE tyre, against the asset's CURRENT meters (km AND engine hours):
 * how far it has run since fitment, and the projected remaining km from the
 * fleet's own measured life for that tyre size. Honest N/A when a meter or
 * baseline is missing - nothing is fabricated.
 */
import { useEffect, useMemo, useState } from 'react'
import { Gauge, Search, X, FileSpreadsheet, FileText, RefreshCw } from 'lucide-react'
import { useSettings } from '../../contexts/SettingsContext'
import { getTyreRunningLife } from '../../lib/api/tyreRunningLife'
import {
  shapeRunningLife, filterRows, bandFor, BAND_META, fmtNum,
} from '../../lib/tyreRunningLife'
import { exportToExcel, exportToPdf, reportFileName } from '../../lib/exportUtils'

const PAGE_SIZE = 25

const TONE_STYLE = {
  danger: { color: '#f87171', background: 'rgba(248,113,113,0.12)' },
  warning: { color: '#fbbf24', background: 'rgba(251,191,36,0.12)' },
  info: { color: '#60a5fa', background: 'rgba(96,165,250,0.12)' },
  good: { color: '#34d399', background: 'rgba(52,211,153,0.12)' },
  quiet: { color: 'var(--text-dim)', background: 'rgba(148,163,184,0.12)' },
}

const EXPORT_COLS = [
  ['serial', 'Serial'], ['asset', 'Asset'], ['position', 'Position'],
  ['vehicleType', 'Type'], ['site', 'Site'], ['brand', 'Brand'], ['size', 'Size'],
  ['fittedOn', 'Fitted on'], ['kmAtFitment', 'Km at fitment'], ['currentKm', 'Current km'],
  ['kmRun', 'Km run'], ['currentHours', 'Current hours'], ['hoursRun', 'Hours run'],
  ['expectedLifeKm', 'Expected life (km)'], ['remainingKm', 'Remaining km'],
  ['lifeUsedPct', 'Life used %'],
]

export default function TyreRunningLife() {
  const { activeCountry } = useSettings()
  const [state, setState] = useState({ loading: true, ok: true, rows: [], summary: null })
  const [search, setSearch] = useState('')
  const [band, setBand] = useState('all')
  const [unit, setUnit] = useState('all')
  const [page, setPage] = useState(0)

  async function load() {
    setState((s) => ({ ...s, loading: true }))
    const payload = await getTyreRunningLife({ country: activeCountry })
    const shaped = shapeRunningLife(payload)
    setState({ loading: false, ok: shaped.ok, rows: shaped.rows, summary: shaped.summary })
    setPage(0)
  }
  useEffect(() => { load() }, [activeCountry]) // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(
    () => filterRows(state.rows, { search, band, unit }),
    [state.rows, search, band, unit],
  )
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const shown = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const s = state.summary

  function doExport(kind) {
    if (!filtered.length) return
    const keys = EXPORT_COLS.map(([k]) => k)
    const headers = EXPORT_COLS.map(([, h]) => h)
    const rows = filtered.map((r) => {
      const o = {}
      for (const k of keys) o[k] = r[k] ?? ''
      return o
    })
    const name = reportFileName('TyrePulse Tyre Running Life', activeCountry || 'All')
    if (kind === 'xlsx') exportToExcel(rows, keys, headers, `${name}.xlsx`)
    else exportToPdf(rows, keys.map((k, i) => ({ key: k, header: headers[i] })), 'Tyre Running Life', `${name}.pdf`, 'landscape')
  }

  return (
    <div className="card p-5 mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Gauge size={18} style={{ color: 'var(--brand)' }} />
          <div>
            <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Running and Remaining</h2>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Each active tyre against its vehicle's current km and hour meter, with the projected
              remaining km from your fleet's own measured life for that size.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={load} className="px-2 py-1.5 rounded-md border border-[var(--border-subtle)] text-xs flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
            <RefreshCw size={13} /> Refresh
          </button>
          <button type="button" onClick={() => doExport('xlsx')} className="px-2 py-1.5 rounded-md border border-[var(--border-subtle)] text-xs flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
            <FileSpreadsheet size={13} /> Excel
          </button>
          <button type="button" onClick={() => doExport('pdf')} className="px-2 py-1.5 rounded-md border border-[var(--border-subtle)] text-xs flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
            <FileText size={13} /> PDF
          </button>
        </div>
      </div>

      {state.loading ? (
        <div className="py-10 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>Loading tyre running life...</div>
      ) : !state.ok ? (
        <div className="py-8 text-center">
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Could not load the running-life data.</p>
          <button type="button" onClick={load} className="mt-2 px-3 py-1.5 rounded-md border border-[var(--border-subtle)] text-xs" style={{ color: 'var(--text-primary)' }}>Retry</button>
        </div>
      ) : !state.rows.length ? (
        <p className="py-8 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
          No active tyres in this view.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-4">
            {[
              ['Active tyres', fmtNum(s.total)],
              ['Measured vs km', fmtNum(s.measurableKm)],
              ['Measured vs hours', fmtNum(s.measurableHours)],
              ['Past expected life', fmtNum(s.overdue)],
              ['Due soon', fmtNum(s.dueSoon)],
              ['Avg life used', s.avgUsedPct == null ? 'N/A' : `${s.avgUsedPct}%`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-[var(--border-subtle)] p-3">
                <div className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{value}</div>
                <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{label}</div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 mb-3">
            <div className="flex items-center gap-1 rounded-md border border-[var(--border-subtle)] px-2 py-1.5">
              <Search size={14} style={{ color: 'var(--text-dim)' }} />
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(0) }}
                placeholder="Search serial, asset, site, brand, size"
                className="bg-transparent text-xs outline-none w-56"
                style={{ color: 'var(--text-primary)' }}
              />
              {search && (
                <button type="button" onClick={() => setSearch('')}><X size={13} style={{ color: 'var(--text-dim)' }} /></button>
              )}
            </div>
            <select value={band} onChange={(e) => { setBand(e.target.value); setPage(0) }}
              className="rounded-md border border-[var(--border-subtle)] bg-transparent px-2 py-1.5 text-xs" style={{ color: 'var(--text-primary)' }}>
              <option value="all">All states</option>
              <option value="overdue">Past expected life</option>
              <option value="due-soon">Due soon</option>
              <option value="mid-life">Mid life</option>
              <option value="healthy">Healthy</option>
              <option value="unknown">Not measurable</option>
            </select>
            <select value={unit} onChange={(e) => { setUnit(e.target.value); setPage(0) }}
              className="rounded-md border border-[var(--border-subtle)] bg-transparent px-2 py-1.5 text-xs" style={{ color: 'var(--text-primary)' }}>
              <option value="all">Km and hours assets</option>
              <option value="km">Km-measured assets</option>
              <option value="hours">Hour-measured assets</option>
            </select>
            <span className="text-[11px]" style={{ color: 'var(--text-dim)' }}>{filtered.length} tyres</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ color: 'var(--text-secondary)' }} className="text-left border-b border-[var(--border-subtle)]">
                  <th className="py-2 pr-2">Serial</th>
                  <th className="py-2 pr-2">Asset</th>
                  <th className="py-2 pr-2">Pos</th>
                  <th className="py-2 pr-2">Site</th>
                  <th className="py-2 pr-2">Size</th>
                  <th className="py-2 pr-2 text-right">Fit km</th>
                  <th className="py-2 pr-2 text-right">Current km</th>
                  <th className="py-2 pr-2 text-right">Km run</th>
                  <th className="py-2 pr-2 text-right">Hours run</th>
                  <th className="py-2 pr-2 text-right">Expected life</th>
                  <th className="py-2 pr-2 text-right">Remaining km</th>
                  <th className="py-2 pr-2">State</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const b = bandFor(r)
                  const meta = BAND_META[b]
                  const tone = TONE_STYLE[meta.tone] || TONE_STYLE.quiet
                  return (
                    <tr key={`${r.serial}|${r.asset}|${r.position}`} className="border-b border-[var(--border-subtle)]" style={{ color: 'var(--text-primary)' }}>
                      <td className="py-1.5 pr-2 font-medium">{r.serial || 'N/A'}</td>
                      <td className="py-1.5 pr-2">{r.asset}{r.unit === 'hours' ? ' (hrs)' : ''}</td>
                      <td className="py-1.5 pr-2">{r.position || 'N/A'}</td>
                      <td className="py-1.5 pr-2">{r.site || 'N/A'}</td>
                      <td className="py-1.5 pr-2">{r.size || 'N/A'}</td>
                      <td className="py-1.5 pr-2 text-right">{fmtNum(r.kmAtFitment)}</td>
                      <td className="py-1.5 pr-2 text-right">{fmtNum(r.currentKm)}</td>
                      <td className="py-1.5 pr-2 text-right font-medium">{fmtNum(r.kmRun)}</td>
                      <td className="py-1.5 pr-2 text-right">{fmtNum(r.hoursRun)}</td>
                      <td className="py-1.5 pr-2 text-right" title={r.lifeSample ? `From ${r.lifeSample} removed tyres of this size` : ''}>{fmtNum(r.expectedLifeKm)}</td>
                      <td className="py-1.5 pr-2 text-right font-semibold">{fmtNum(r.remainingKm)}</td>
                      <td className="py-1.5 pr-2">
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={tone}>
                          {meta.label}{r.lifeUsedPct != null ? ` ${r.lifeUsedPct}%` : ''}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {pages > 1 && (
            <div className="flex items-center justify-end gap-2 mt-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
              <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)} className="px-2 py-1 rounded border border-[var(--border-subtle)] disabled:opacity-40">Prev</button>
              <span>Page {page + 1} of {pages}</span>
              <button type="button" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} className="px-2 py-1 rounded border border-[var(--border-subtle)] disabled:opacity-40">Next</button>
            </div>
          )}

          <p className="mt-3 text-[11px]" style={{ color: 'var(--text-dim)' }}>
            Expected life = the average measured life of your own removed tyres of the same size in this
            country (hover the figure for the sample size). Remaining km is a guide from that average, not
            a promise. A tyre shows "Not measurable" when the vehicle has no current meter reading or the
            fitment km is missing - meter logs and inspections make more tyres measurable.
          </p>
        </>
      )}
    </div>
  )
}
