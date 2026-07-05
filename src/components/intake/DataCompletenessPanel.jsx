import { useState, useEffect, useCallback } from 'react'
import { Gauge, ChevronDown, ChevronRight, RefreshCw, Loader2, AlertCircle } from 'lucide-react'
import * as imports from '../../lib/api/imports'

/**
 * Data Completeness — per-field fill scorecard for the Data Intake Center.
 * Makes it obvious which analytics pages are starving (e.g. brand/site/km at 0%)
 * and which upload would fix them, so gaps stay visible until solved.
 */
const TYRE_FIELDS = [
  ['cost', 'Cost', 'Cost KPIs, budgets, forecasts'],
  ['brand', 'Brand', 'Brand Performance, supplier ranking'],
  ['site', 'Site', 'Site Comparison, branch costs'],
  ['position', 'Position', 'Position Intelligence'],
  ['km', 'KM readings', 'CPK, tyre life, forecasting'],
  ['serial', 'Serial No', 'Lifecycle & warranty tracking'],
  ['removal', 'Removal date', 'Removal & scrap analysis'],
  ['removal_reason', 'Removal reason', 'Root-cause analysis'],
]
const FLEET_FIELDS = [
  ['vehicle_type', 'Vehicle type', 'Type breakdowns'],
  ['make', 'Make', 'Fleet composition'],
  ['site', 'Site', 'Branch views'],
  ['km', 'Current KM', 'Utilisation & life'],
  ['budget', 'Monthly budget', 'Budget vs actual'],
]

function Bar({ pct }) {
  const color = pct >= 80 ? 'bg-green-500' : pct >= 40 ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div className="w-full bg-gray-800 rounded h-1.5">
      <div className={`${color} h-1.5 rounded`} style={{ width: `${Math.max(pct, 2)}%` }} />
    </div>
  )
}

function FieldRows({ fields, stats }) {
  const total = stats?.total ?? 0
  return fields.map(([key, label, powers]) => {
    const n = stats?.[key] ?? 0
    const pct = total ? Math.round((n / total) * 100) : 0
    return (
      <div key={key} className="grid grid-cols-[7.5rem_1fr_3rem] items-center gap-2 py-1">
        <span className="text-xs text-[var(--text-secondary)] truncate" title={`Powers: ${powers}`}>{label}</span>
        <Bar pct={pct} />
        <span className={`text-xs text-right font-semibold ${pct >= 80 ? 'text-green-400' : pct >= 40 ? 'text-amber-400' : 'text-red-400'}`}>{pct}%</span>
      </div>
    )
  })
}

export default function DataCompletenessPanel() {
  const [open, setOpen] = useState(false)
  const [stats, setStats] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    try { setStats(await imports.dataCompleteness()) }
    catch (e) { setError(e?.message || 'Could not load completeness stats.'); setStats({}) }
  }, [])
  useEffect(() => { load() }, [load])

  const tyre = stats?.tyres
  const fleet = stats?.fleet
  const worst = tyre?.total
    ? TYRE_FIELDS.filter(([k]) => ((tyre[k] ?? 0) / tyre.total) < 0.4).length
    : 0

  return (
    <div className="card p-0 overflow-hidden">
      <button onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-gray-800/40 transition-colors">
        {open ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
        <Gauge size={16} className="text-[var(--accent)]" />
        <span className="text-sm font-semibold text-[var(--text-primary)]">Data completeness</span>
        {stats == null ? <span className="text-xs text-[var(--text-muted)]">…</span>
          : worst > 0
            ? <span className="text-xs text-amber-400">{worst} field(s) under 40%</span>
            : <span className="text-xs text-green-400">healthy</span>}
        <span className="ml-auto" />
        <RefreshCw size={14} className="text-gray-500 hover:text-gray-300"
          onClick={(e) => { e.stopPropagation(); setStats(null); load() }} title="Refresh" />
      </button>

      {open && (
        <div className="border-t border-[var(--card-border)] p-4 space-y-4">
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-300 bg-red-900/30 border border-red-700 rounded-lg px-3 py-2">
              <AlertCircle size={15} /> {error}
            </div>
          )}
          {stats == null ? (
            <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]"><Loader2 size={15} className="animate-spin" /> Scanning fields…</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)] mb-2">
                  Tyre records · {Number(tyre?.total ?? 0).toLocaleString('en-US')} rows
                </p>
                <FieldRows fields={TYRE_FIELDS} stats={tyre} />
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)] mb-2">
                  Fleet · {Number(fleet?.total ?? 0).toLocaleString('en-US')} vehicles
                </p>
                <FieldRows fields={FLEET_FIELDS} stats={fleet} />
              </div>
              <p className="md:col-span-2 text-[11px] text-gray-500">
                Fields under 40% leave their analytics pages empty. Fill them by uploading a file that
                contains the column with <span className="text-gray-300">Enrich existing records</span> on —
                values merge into the same rows by Serial / Asset No, never overwriting existing data.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
