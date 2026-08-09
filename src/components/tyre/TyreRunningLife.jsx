/**
 * TyreRunningLife - "Running & Remaining" section (mounted on /tyre-lifecycle).
 * Per ACTIVE tyre, against the asset's CURRENT meters (km AND engine hours):
 * how far it has run since fitment, and the projected remaining km from the
 * fleet's own measured life for that tyre size. Honest N/A when a meter or
 * baseline is missing - nothing is fabricated.
 */
import { useEffect, useMemo, useState } from 'react'
import { Gauge, Search, X, FileSpreadsheet, FileText, RefreshCw, Target, Trash2 } from 'lucide-react'
import { useSettings } from '../../contexts/SettingsContext'
import { useAuth } from '../../contexts/AuthContext'
import {
  getTyreRunningLife, listTyreLifeTargets, saveTyreLifeTarget, deleteTyreLifeTarget,
} from '../../lib/api/tyreRunningLife'
import {
  shapeRunningLife, filterRows, bandFor, BAND_META, fmtNum, basisLabel, dueLabel,
} from '../../lib/tyreRunningLife'
import { toUserMessage } from '../../lib/safeError'
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
  ['fittedOn', 'Fitted on'], ['daysOn', 'Days on vehicle'],
  ['kmAtFitment', 'Km at fitment'], ['currentKm', 'Current km'],
  ['kmRun', 'Km run'], ['currentHours', 'Current hours'], ['hoursRun', 'Hours run'],
  ['expectedLifeKm', 'Expected life (km)'],
  ['remainingKm', 'Remaining km'], ['remainingDays', 'Remaining days'],
  ['due', 'Due?'], ['lifeUsedPct', 'Life used %'],
]

export default function TyreRunningLife() {
  const { activeCountry } = useSettings()
  const { profile, isSuperAdmin } = useAuth()
  const [state, setState] = useState({ loading: true, ok: true, rows: [], summary: null })
  const [search, setSearch] = useState('')
  const [band, setBand] = useState('all')
  const [unit, setUnit] = useState('all')
  const [page, setPage] = useState(0)
  const [targetsOpen, setTargetsOpen] = useState(false)
  const canSetTargets = isSuperAdmin || ['Admin', 'Manager', 'Director'].includes(profile?.role)

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
      for (const k of keys) o[k] = k === 'due' ? dueLabel(r) : (r[k] ?? '')
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
          {canSetTargets && (
            <button type="button" onClick={() => setTargetsOpen(true)} className="px-2 py-1.5 rounded-md border border-[var(--border-subtle)] text-xs flex items-center gap-1" style={{ color: 'var(--text-primary)' }}>
              <Target size={13} /> Life targets
            </button>
          )}
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

          {/* Overall life-history strip (replaces the per-row Basis column):
              where the expected-life figures come from, in one line. Hover any
              Expected life value for that tyre's exact basis. */}
          {(() => {
            const counts = { manual: 0, measured_type: 0, measured_size: 0, none: 0 }
            let samples = 0
            for (const r of state.rows) {
              if (r.lifeBasis && counts[r.lifeBasis] != null) counts[r.lifeBasis] += 1
              else counts.none += 1
              if (r.lifeSample) samples = Math.max(samples, r.lifeSample)
            }
            const bits = []
            if (counts.manual) bits.push(`${fmtNum(counts.manual)} on your targets`)
            if (counts.measured_type) bits.push(`${fmtNum(counts.measured_type)} on measured vehicle-type history`)
            if (counts.measured_size) bits.push(`${fmtNum(counts.measured_size)} on measured size history`)
            if (counts.none) bits.push(`${fmtNum(counts.none)} with no history yet`)
            return (
              <div className="mb-4 rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>Life history: </span>
                expected life comes from your own fleet's completed tyre lives{bits.length ? ` - ${bits.join(', ')}` : ''}.
                Hover any Expected life figure for that tyre's exact basis.
              </div>
            )
          })()}

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
                  <th className="py-2 pr-2 text-right">Days on</th>
                  <th className="py-2 pr-2 text-right">Fit km</th>
                  <th className="py-2 pr-2 text-right">Current km</th>
                  <th className="py-2 pr-2 text-right">Km run</th>
                  <th className="py-2 pr-2 text-right">Hours run</th>
                  <th className="py-2 pr-2 text-right">Expected life</th>
                  <th className="py-2 pr-2 text-right">Remaining km</th>
                  <th className="py-2 pr-2 text-right">Remaining days</th>
                  <th className="py-2 pr-2">Due?</th>
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
                      <td className="py-1.5 pr-2 text-right" title={r.fittedOn ? `Fitted ${r.fittedOn}` : ''}>{fmtNum(r.daysOn)}</td>
                      <td className="py-1.5 pr-2 text-right">{fmtNum(r.kmAtFitment)}</td>
                      <td className="py-1.5 pr-2 text-right">{fmtNum(r.currentKm)}</td>
                      <td className="py-1.5 pr-2 text-right font-medium">{fmtNum(r.kmRun)}</td>
                      <td className="py-1.5 pr-2 text-right">{fmtNum(r.hoursRun)}</td>
                      <td className="py-1.5 pr-2 text-right" title={basisLabel(r)}>{fmtNum(r.expectedLifeKm)}</td>
                      <td className="py-1.5 pr-2 text-right font-semibold">{fmtNum(r.remainingKm)}</td>
                      <td className="py-1.5 pr-2 text-right" title={r.daySample ? `Day life from ${r.daySample} removed tyres` : ''}>{fmtNum(r.remainingDays)}</td>
                      <td className="py-1.5 pr-2 font-semibold" style={{ color: dueLabel(r) === 'Due' ? '#f87171' : dueLabel(r) === 'Not due' ? '#34d399' : 'var(--text-dim)' }}>
                        {dueLabel(r)}
                      </td>
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
            Remaining figures are a guide from your fleet's own measured life (or your set
            targets), not a promise. "Not measurable" = the vehicle has no current meter reading or
            the fitment km is missing - meter logs and inspections make more tyres measurable.
          </p>
        </>
      )}

      {targetsOpen && (
        <LifeTargetsModal
          rows={state.rows}
          country={activeCountry}
          onClose={(changed) => { setTargetsOpen(false); if (changed) load() }}
        />
      )}
    </div>
  )
}

/**
 * Admin modal: force your own expected-life numbers per tyre size (optionally
 * per vehicle type / country). A manual target OVERRIDES the measured average
 * on every matching tyre, so life-used % then tracks improvement against YOUR
 * number instead of history.
 */
function LifeTargetsModal({ rows, country, onClose }) {
  const [targets, setTargets] = useState(null)
  const [form, setForm] = useState({ size: '', vehicle_type: '', target_km: '', note: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [changed, setChanged] = useState(false)

  const sizes = useMemo(() => [...new Set(rows.map((r) => r.size).filter(Boolean))].sort(), [rows])
  const types = useMemo(() => [...new Set(rows.map((r) => r.vehicleType).filter(Boolean))].sort(), [rows])

  async function loadTargets() { setTargets(await listTyreLifeTargets()) }
  useEffect(() => { loadTargets() }, [])

  async function save() {
    setBusy(true); setError('')
    try {
      await saveTyreLifeTarget({
        country,
        size: form.size,
        vehicle_type: form.vehicle_type || null,
        target_km: form.target_km,
        note: form.note,
      })
      setForm({ size: '', vehicle_type: '', target_km: '', note: '' })
      setChanged(true)
      await loadTargets()
    } catch (e) { setError(toUserMessage(e)) } finally { setBusy(false) }
  }

  async function remove(id) {
    try { await deleteTyreLifeTarget(id); setChanged(true); await loadTargets() } catch (e) { setError(toUserMessage(e)) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={() => onClose(changed)}>
      <div className="card w-full max-w-xl p-5 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Target size={15} /> Tyre life targets
          </h3>
          <button type="button" onClick={() => onClose(changed)}><X size={16} style={{ color: 'var(--text-dim)' }} /></button>
        </div>
        <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
          Set the km life YOU expect per tyre size (optionally only for one vehicle type). A target
          overrides the measured average on every matching tyre, so the Remaining and Life-used figures
          then measure your fleet against your own standard.
        </p>

        <div className="grid grid-cols-2 gap-2 mb-2">
          <label className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>Tyre size *
            <select value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value })}
              className="mt-1 w-full rounded-md border border-[var(--border-subtle)] bg-transparent px-2 py-1.5 text-xs" style={{ color: 'var(--text-primary)' }}>
              <option value="">Pick a size</option>
              {sizes.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>Vehicle type (optional)
            <select value={form.vehicle_type} onChange={(e) => setForm({ ...form, vehicle_type: e.target.value })}
              className="mt-1 w-full rounded-md border border-[var(--border-subtle)] bg-transparent px-2 py-1.5 text-xs" style={{ color: 'var(--text-primary)' }}>
              <option value="">All vehicle types</option>
              {types.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>Target life (km) *
            <input type="number" min="1000" max="400000" value={form.target_km}
              onChange={(e) => setForm({ ...form, target_km: e.target.value })}
              className="mt-1 w-full rounded-md border border-[var(--border-subtle)] bg-transparent px-2 py-1.5 text-xs" style={{ color: 'var(--text-primary)' }} />
          </label>
          <label className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>Note
            <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
              className="mt-1 w-full rounded-md border border-[var(--border-subtle)] bg-transparent px-2 py-1.5 text-xs" style={{ color: 'var(--text-primary)' }} />
          </label>
        </div>
        {error && <p className="text-xs mb-2" style={{ color: '#f87171' }}>{error}</p>}
        <button type="button" disabled={busy || !form.size || !form.target_km} onClick={save}
          className="px-3 py-1.5 rounded-md text-xs font-medium disabled:opacity-40"
          style={{ background: 'var(--brand)', color: '#fff' }}>
          {busy ? 'Saving...' : 'Save target'}
        </button>

        <div className="mt-4">
          <h4 className="text-xs font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Current targets</h4>
          {targets == null ? (
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Loading...</p>
          ) : !targets.length ? (
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              No targets set - every tyre uses its measured fleet average.
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left border-b border-[var(--border-subtle)]" style={{ color: 'var(--text-secondary)' }}>
                  <th className="py-1.5 pr-2">Size</th>
                  <th className="py-1.5 pr-2">Vehicle type</th>
                  <th className="py-1.5 pr-2">Country</th>
                  <th className="py-1.5 pr-2 text-right">Target km</th>
                  <th className="py-1.5 pr-2" />
                </tr>
              </thead>
              <tbody>
                {targets.map((t) => (
                  <tr key={t.id} className="border-b border-[var(--border-subtle)]" style={{ color: 'var(--text-primary)' }}>
                    <td className="py-1.5 pr-2">{t.size}</td>
                    <td className="py-1.5 pr-2">{t.vehicle_type || 'All types'}</td>
                    <td className="py-1.5 pr-2">{t.country || 'All'}</td>
                    <td className="py-1.5 pr-2 text-right">{fmtNum(t.target_km)}</td>
                    <td className="py-1.5 pr-2 text-right">
                      <button type="button" onClick={() => remove(t.id)} title="Remove target">
                        <Trash2 size={13} style={{ color: 'var(--text-dim)' }} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
