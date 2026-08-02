/**
 * CpkScenarioPanel - a live "what-if" simulator for fleet CPK.
 *
 * Management includes / excludes cases (whole asset types, brands, individual
 * assets, or every "cost-but-no-meter" case) and sees the fleet CPK move INSTANTLY.
 * All recompute is client-side (src/lib/cpkScenario), fed by the per-vehicle rows the
 * Fleet CPK RPC already returned - no extra fetch. CPK is null -> "N/A" (never a
 * fabricated 0); currencies are never blended (one card per country + unit).
 *
 * The driving example: a wheel loader is hour-metered, so under a cost-per-km lens it
 * shows tyre expense with no km. Toggle "Exclude assets with cost but no meter" and the
 * corrected CPK appears at once.
 */
import { useMemo, useState } from 'react'
import {
  recomputeFleetCpk, distinctTypes, distinctBrands, isNoMeter, rowUnit,
} from '../../lib/cpkScenario'
import { fmtCpkValue, fmtDistance, fmtMoney, unitLabel } from '../../lib/fleetCpkView'
import {
  SlidersHorizontal, Filter, X, TrendingDown, TrendingUp, Minus,
  Clock, Gauge, Search, ArrowRight, AlertTriangle, RotateCcw,
} from 'lucide-react'

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

/** Small toggle chip. */
function Chip({ active, onClick, children, title, danger }) {
  const base = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition-colors'
  const on = danger
    ? 'bg-amber-500/15 border-amber-500/50 text-amber-300'
    : 'bg-blue-500/15 border-blue-500/50 text-blue-300'
  const off = 'bg-gray-800/40 border-gray-700 text-gray-400 hover:border-gray-600'
  return (
    <button type="button" title={title} onClick={onClick} className={`${base} ${active ? on : off}`}>
      {children}
    </button>
  )
}

/** Render a CPK delta with a direction arrow (down = good, green). */
function DeltaBadge({ delta, pct }) {
  if (delta == null) return <span className="text-gray-600 text-xs">N/A</span>
  const eps = 1e-9
  const down = delta < -eps
  const up = delta > eps
  const Icon = down ? TrendingDown : up ? TrendingUp : Minus
  const cls = down ? 'text-emerald-400' : up ? 'text-rose-400' : 'text-gray-400'
  const pctTxt = pct == null ? '' : ` (${pct > 0 ? '+' : ''}${pct.toFixed(1)}%)`
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${cls}`}>
      <Icon size={13} />
      {down ? '' : up ? '+' : ''}{Math.abs(delta).toFixed(4)}{pctTxt}
    </span>
  )
}

export default function CpkScenarioPanel({ perVehicle = [], loading = false }) {
  const rows = Array.isArray(perVehicle) ? perVehicle : []

  const [excludedAssets, setExcludedAssets] = useState(() => new Set())
  const [excludedTypes, setExcludedTypes] = useState(() => new Set())
  const [excludedBrands, setExcludedBrands] = useState(() => new Set())
  const [onlyUnit, setOnlyUnit] = useState(null) // null | 'km' | 'engine_hours'
  const [excludeNoMeter, setExcludeNoMeter] = useState(false)
  const [search, setSearch] = useState('')

  const controls = useMemo(
    () => ({ excludedAssets, excludedTypes, excludedBrands, onlyUnit, excludeNoMeter }),
    [excludedAssets, excludedTypes, excludedBrands, onlyUnit, excludeNoMeter],
  )

  // LIVE recompute - pure, instant on every toggle.
  const result = useMemo(() => recomputeFleetCpk(rows, controls), [rows, controls])
  const types = useMemo(() => distinctTypes(rows), [rows])
  const brands = useMemo(() => distinctBrands(rows), [rows])
  const hasBrands = brands.length > 0

  const filteredVehicles = useMemo(() => {
    const q = String(search || '').trim().toLowerCase()
    const list = q
      ? rows.filter((r) =>
          String(r?.asset_no || '').toLowerCase().includes(q) ||
          String(r?.vehicle_type || '').toLowerCase().includes(q))
      : rows
    return [...list].sort((a, b) => num(b?.total_cost) - num(a?.total_cost))
  }, [rows, search])

  const toggleIn = (set, setter) => (val) => {
    const next = new Set(set)
    if (next.has(val)) next.delete(val)
    else next.add(val)
    setter(next)
  }
  const toggleAsset = toggleIn(excludedAssets, setExcludedAssets)
  const toggleType = toggleIn(excludedTypes, setExcludedTypes)
  const toggleBrand = toggleIn(excludedBrands, setExcludedBrands)

  const reset = () => {
    setExcludedAssets(new Set())
    setExcludedTypes(new Set())
    setExcludedBrands(new Set())
    setOnlyUnit(null)
    setExcludeNoMeter(false)
  }

  const anyExclusion =
    excludedAssets.size > 0 || excludedTypes.size > 0 || excludedBrands.size > 0 ||
    onlyUnit != null || excludeNoMeter

  if (loading) {
    return (
      <div className="card flex items-center justify-center py-10 text-gray-500 text-sm gap-3">
        <div className="w-5 h-5 rounded-full border-2 border-gray-700 border-t-blue-500 animate-spin" />
        Loading scenario data...
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="card flex flex-col items-center justify-center py-12 gap-3">
        <SlidersHorizontal size={30} className="text-gray-600" />
        <p className="text-gray-400 text-sm font-medium">No per-vehicle data to simulate</p>
        <p className="text-gray-500 text-xs text-center max-w-md">
          The what-if simulator uses the same per-vehicle CPK data as the Fleet CPK section above.
          Upload meter readings and expenses to include or exclude cases here.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header + presets */}
      <div className="card space-y-3">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <SlidersHorizontal size={16} className="text-blue-400" />
            <div>
              <h3 className="text-sm font-semibold text-gray-200">Scenario controls</h3>
              <p className="text-xs text-gray-500">
                {result.includedCount} of {result.totalCount} assets included
                {result.excludedCount > 0 ? ` (${result.excludedCount} excluded)` : ''}
                {result.noMeterCount > 0 ? ` | ${result.noMeterCount} have cost but no meter` : ''}
              </p>
            </div>
          </div>
          {anyExclusion && (
            <button
              type="button"
              onClick={reset}
              className="btn-secondary flex items-center gap-1.5 text-xs px-2.5 py-1.5"
            >
              <RotateCcw size={13} /> Reset
            </button>
          )}
        </div>

        {/* Quick presets */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-gray-500 uppercase tracking-wide mr-1">Quick:</span>
          <Chip
            active={excludeNoMeter}
            danger
            onClick={() => setExcludeNoMeter((v) => !v)}
            title="Remove every asset that has cost but zero km / hours (the wheel-loader case)"
          >
            <AlertTriangle size={12} /> Exclude cost-but-no-meter
          </Chip>
          <Chip active={onlyUnit === 'km'} onClick={() => setOnlyUnit((v) => (v === 'km' ? null : 'km'))} title="Show km assets only">
            <Gauge size={12} /> km assets only
          </Chip>
          <Chip active={onlyUnit === 'engine_hours'} onClick={() => setOnlyUnit((v) => (v === 'engine_hours' ? null : 'engine_hours'))} title="Show hour-metered assets only">
            <Clock size={12} /> hour assets only
          </Chip>
        </div>

        {/* Exclude by type */}
        {types.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-[11px] text-gray-500 uppercase tracking-wide">
              <Filter size={11} /> Exclude asset types
            </div>
            <div className="flex flex-wrap gap-1.5">
              {types.map((t) => (
                <Chip
                  key={t.type}
                  active={excludedTypes.has(t.type)}
                  danger
                  onClick={() => toggleType(t.type)}
                  title={t.noMeterCount > 0 ? `${t.noMeterCount} of ${t.count} have cost but no meter` : `${t.count} assets`}
                >
                  {excludedTypes.has(t.type) ? <X size={11} /> : null}
                  {t.type} <span className="opacity-60">{t.count}</span>
                  {t.noMeterCount > 0 ? <span className="text-amber-400" title="cost but no meter">*</span> : null}
                </Chip>
              ))}
            </div>
          </div>
        )}

        {/* Exclude by brand (only when rows carry a brand) */}
        {hasBrands && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-[11px] text-gray-500 uppercase tracking-wide">
              <Filter size={11} /> Exclude brands
            </div>
            <div className="flex flex-wrap gap-1.5">
              {brands.map((b) => (
                <Chip key={b.brand} active={excludedBrands.has(b.brand)} danger onClick={() => toggleBrand(b.brand)} title={`${b.count} assets`}>
                  {excludedBrands.has(b.brand) ? <X size={11} /> : null}
                  {b.brand} <span className="opacity-60">{b.count}</span>
                </Chip>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Before / after headline per country + unit */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {result.groups.map((g, i) => {
          const isHours = g.unit === 'engine_hours'
          return (
            <div key={`${g.country}-${g.unit}-${i}`} className="card border border-gray-700/60 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 min-w-0">
                  {isHours ? <Clock size={14} className="text-amber-400 shrink-0" /> : <Gauge size={14} className="text-blue-400 shrink-0" />}
                  <span className="text-xs text-gray-300 font-medium truncate">
                    {g.country || 'Fleet'} - {isHours ? 'per hour' : 'per km'}
                  </span>
                </div>
                <span className="text-[10px] text-gray-500 uppercase">{g.currency}</span>
              </div>

              {/* Total CPK before -> after */}
              <div>
                <p className="text-[10px] text-gray-500">Total CPK (baseline to scenario)</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-gray-400 line-through decoration-gray-600/70">
                    {fmtCpkValue(g.baseline.cpk_total, g.currency, g.unit)}
                  </span>
                  <ArrowRight size={13} className="text-gray-600 shrink-0" />
                  <span className="text-base font-bold text-white">
                    {fmtCpkValue(g.scenario.cpk_total, g.currency, g.unit)}
                  </span>
                </div>
                <div className="mt-0.5"><DeltaBadge delta={g.delta.cpk_total} pct={g.pctChange.cpk_total} /></div>
              </div>

              {/* Tyre CPK before -> after */}
              <div className="pt-1 border-t border-gray-800">
                <p className="text-[10px] text-gray-500">Tyre CPK</p>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs font-medium text-gray-500 line-through decoration-gray-700">
                    {fmtCpkValue(g.baseline.cpk_tyre, g.currency, g.unit)}
                  </span>
                  <ArrowRight size={11} className="text-gray-600 shrink-0" />
                  <span className="text-xs font-semibold text-gray-200">
                    {fmtCpkValue(g.scenario.cpk_tyre, g.currency, g.unit)}
                  </span>
                  <DeltaBadge delta={g.delta.cpk_tyre} pct={g.pctChange.cpk_tyre} />
                </div>
              </div>

              <p className="text-[10px] text-gray-500 pt-1">
                {g.scenario.assetCount}/{g.baseline.assetCount} assets |
                {' '}{fmtDistance(g.scenario.distance, g.unit)} |
                {' '}{fmtMoney(g.scenario.cost, g.currency)}
                {g.baseline.noMeterCount > 0 ? (
                  <span className="text-amber-500/80"> | {g.baseline.noMeterCount} no-meter</span>
                ) : null}
              </p>
            </div>
          )
        })}
      </div>

      {/* Per-vehicle include/exclude list */}
      <div className="card overflow-x-auto">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <SlidersHorizontal size={15} className="text-gray-400" />
          <h3 className="text-sm font-medium text-gray-300">Include / exclude by asset</h3>
          <div className="ml-auto flex items-center gap-2">
            <div className="relative">
              <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search asset or type"
                className="input text-xs pl-7 w-52"
              />
            </div>
            <span className="text-xs text-gray-500">{filteredVehicles.length} shown</span>
          </div>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left border-b border-gray-800">
              <th className="table-header pb-2 pr-3">Include</th>
              <th className="table-header pb-2 pr-3">Asset</th>
              <th className="table-header pb-2 pr-3">Type</th>
              <th className="table-header pb-2 pr-3">Unit</th>
              <th className="table-header pb-2 pr-3 text-right">Distance / Hours</th>
              <th className="table-header pb-2 pr-3 text-right">Total Cost</th>
              <th className="table-header pb-2 text-right">CPK Total</th>
            </tr>
          </thead>
          <tbody>
            {filteredVehicles.slice(0, 300).map((r, i) => {
              const cur = r.currency || r.country || ''
              const unit = rowUnit(r)
              const excluded = excludedAssets.has(String(r.asset_no))
              const noMeter = isNoMeter(r)
              return (
                <tr
                  key={`${r.asset_no}-${i}`}
                  className={`border-b border-gray-800/50 transition-colors ${excluded ? 'opacity-45' : 'hover:bg-gray-800/30'}`}
                >
                  <td className="table-cell py-2 pr-3">
                    <input
                      type="checkbox"
                      checked={!excluded}
                      onChange={() => toggleAsset(String(r.asset_no))}
                      className="w-4 h-4 accent-blue-500 cursor-pointer"
                      title={excluded ? 'Excluded - click to include' : 'Included - click to exclude'}
                    />
                  </td>
                  <td className="table-cell py-2 pr-3 font-mono text-gray-200">{r.asset_no}</td>
                  <td className="table-cell py-2 pr-3 text-gray-400">{r.vehicle_type || '-'}</td>
                  <td className="table-cell py-2 pr-3 text-gray-400">{unitLabel(unit)}</td>
                  <td className="table-cell py-2 pr-3 text-right text-gray-300">
                    {noMeter ? (
                      <span className="inline-flex items-center gap-1 text-amber-400" title="Has cost but no km / hours to divide by">
                        <AlertTriangle size={11} /> no meter
                      </span>
                    ) : (
                      fmtDistance(r.distance_or_hours, unit)
                    )}
                  </td>
                  <td className="table-cell py-2 pr-3 text-right text-gray-300">{fmtMoney(r.total_cost, cur)}</td>
                  <td className="table-cell py-2 text-right">
                    <span className={r.cpk_total == null ? 'text-gray-600' : 'font-medium text-gray-100'}>
                      {fmtCpkValue(r.cpk_total, cur, unit)}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {filteredVehicles.length > 300 && (
          <p className="text-[11px] text-gray-600 mt-2">
            Showing the 300 highest-cost assets. Refine with search, or use the type / brand / no-meter presets above to exclude in bulk.
          </p>
        )}
        <p className="text-[11px] text-gray-600 mt-2">
          Scenario CPK = included cost / included distance-or-hours, per country and unit. An asset with cost but no meter
          inflates the figure, so excluding it corrects the CPK. Currencies are never blended; a missing denominator shows N/A.
        </p>
      </div>
    </div>
  )
}
