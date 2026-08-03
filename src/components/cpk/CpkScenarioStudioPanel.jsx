/**
 * CpkScenarioStudioPanel - a fully customizable CPK "Scenario Studio".
 *
 * The headline feature: a manager can MANUALLY TYPE the km total (and the hours
 * total) as a plain number and watch fleet Cost-Per-Km recompute live. On top of
 * that they can scale tyre / maintenance / tyre-price cost, add a flat extra cost,
 * exclude individual assets, and SAVE named scenarios to compare side by side.
 * This is a what-if tool for demonstrating any scenario to management.
 *
 * All maths live in the pure engine src/lib/cpkScenarioStudio.js (this component
 * never re-derives a figure): buildBaseline turns the loaded CPK rows into a
 * baseline, applyLevers recomputes both sides live, scenarioRows builds the
 * comparison table. Money is per country in ONE currency (never blended); a null
 * CPK / denominator always reads "N/A", never 0 or NaN.
 *
 * Props:
 *   perVehicle - array of per-asset CPK rows { asset_no, vehicle_type, unit,
 *                distance_or_hours, tyre_cost, maintenance_cost, total_cost,
 *                cpk_tyre, cpk_total }
 *   byType     - array of per-type CPK rows (same shape, no asset_no)
 *   fleet      - array with the fleet row(s); fleet[0].currency drives money
 *   currency   - explicit currency label (overrides the fleet row)
 *   country    - active country label (for filenames + the money hint)
 */
import { useState, useMemo, useEffect, useCallback } from 'react'
import {
  SlidersHorizontal, FlaskConical, Save, Copy, Trash2, RefreshCcw,
  FileSpreadsheet, FileText, Search, Plus, X, Info,
  TrendingUp, TrendingDown, Minus, Gauge, Truck, Factory,
} from 'lucide-react'
import {
  DEFAULT_LEVERS, buildBaseline, applyLevers, scenarioRows, num,
} from '../../lib/cpkScenarioStudio'
import { exportToExcel, exportToPdf, reportFileName, reportDateLabel } from '../../lib/exportUtils'

const STORAGE_KEY = 'cpkScenarioStudio.v1'

/* ---------- formatting helpers (ASCII only, honest N/A) ---------- */

/** Integer with thousands separators; null/blank -> "N/A". */
function fmtInt(v) {
  const n = num(v)
  return n == null ? 'N/A' : Math.round(n).toLocaleString()
}

/** Money integer prefixed with the currency label; null -> "N/A". */
function fmtMoney(v, cur) {
  const n = num(v)
  if (n == null) return 'N/A'
  return `${cur} ${Math.round(n).toLocaleString()}`
}

/** CPK to 4 decimals; null -> "N/A" (never 0 / NaN / Infinity). */
function fmtCpk(v) {
  const n = num(v)
  return n == null ? 'N/A' : n.toFixed(4)
}

/** Signed CPK delta to 4 decimals; null -> "N/A". */
function fmtCpkDelta(v) {
  const n = num(v)
  if (n == null) return 'N/A'
  const s = Math.abs(n).toFixed(4)
  if (n > 0) return `+${s}`
  if (n < 0) return `-${s}`
  return s
}

/** Signed percent to 1 decimal; null -> "N/A". */
function fmtPct(v) {
  const n = num(v)
  if (n == null) return 'N/A'
  const s = Math.abs(n).toFixed(1)
  if (n > 0) return `+${s}%`
  if (n < 0) return `-${s}%`
  return `${s}%`
}

/** Direction word for a signed number (cost up is worse). */
function dirWord(v) {
  const n = num(v)
  if (n == null) return 'N/A'
  if (n > 0) return 'up'
  if (n < 0) return 'down'
  return 'same'
}

function unitLabel(unit) {
  if (unit === 'engine_hours') return 'Engine hours'
  if (unit === 'km') return 'Km'
  return unit == null || String(unit).trim() === '' ? 'N/A' : String(unit)
}

/* Semantic delta hues - colour carries meaning (cost up = bad). */
function deltaTone(v) {
  const n = num(v)
  if (n == null || n === 0) return { color: 'var(--text-secondary)', Icon: Minus }
  if (n > 0) return { color: '#dc2626', Icon: TrendingUp }
  return { color: '#16a34a', Icon: TrendingDown }
}

let SCENARIO_SEQ = 0
function nextId() {
  SCENARIO_SEQ += 1
  return `sc_${Date.now().toString(36)}_${SCENARIO_SEQ}`
}

/* ---------- localStorage (best effort, never throws) ---------- */

function loadScenarios() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((s) => s && typeof s === 'object' && s.levers)
      .map((s) => ({
        id: s.id || nextId(),
        name: typeof s.name === 'string' && s.name.trim() ? s.name : 'Scenario',
        levers: { ...DEFAULT_LEVERS, ...s.levers },
      }))
  } catch {
    return []
  }
}

function saveScenarios(list) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {
    /* storage unavailable - keep in memory only */
  }
}

/* ================================================================= */

export default function CpkScenarioStudioPanel({
  perVehicle = [], byType = [], fleet = [], currency, country,
} = {}) {
  const countryLabel = country && country !== 'All' ? country : 'All'

  /* ----- baseline (pure) ----- */
  const baseline = useMemo(
    () => buildBaseline({ perVehicle, byType, fleet }),
    [perVehicle, byType, fleet],
  )
  const cur = currency || baseline?.currency || country || 'SAR'

  /* ----- live levers ----- */
  const [levers, setLevers] = useState(DEFAULT_LEVERS)
  const result = useMemo(() => applyLevers(baseline, levers), [baseline, levers])

  /* ----- saved scenarios ----- */
  const [scenarios, setScenarios] = useState(() => loadScenarios())
  const [scenarioName, setScenarioName] = useState('')
  useEffect(() => { saveScenarios(scenarios) }, [scenarios])

  /* ----- asset include/exclude list ----- */
  const [assetQuery, setAssetQuery] = useState('')
  const assetList = useMemo(() => {
    const map = new Map()
    const add = (a) => {
      if (!a || !a.asset_no) return
      if (!map.has(a.asset_no)) {
        map.set(a.asset_no, {
          asset_no: a.asset_no,
          vehicle_type: a.vehicle_type,
          distance: num(a.distance),
          totalCost: num(a.totalCost),
        })
      }
    }
    ;(baseline?.km?.assets || []).forEach(add)
    ;(baseline?.hours?.assets || []).forEach(add)
    return Array.from(map.values()).sort((x, y) =>
      String(x.asset_no).localeCompare(String(y.asset_no)))
  }, [baseline])

  const excluded = useMemo(
    () => new Set(Array.isArray(levers.excludedAssets) ? levers.excludedAssets : []),
    [levers.excludedAssets],
  )

  const filteredAssets = useMemo(() => {
    const term = assetQuery.trim().toLowerCase()
    if (!term) return assetList
    return assetList.filter((a) =>
      String(a.asset_no).toLowerCase().includes(term) ||
      String(a.vehicle_type ?? '').toLowerCase().includes(term))
  }, [assetList, assetQuery])

  /* ----- lever setters ----- */
  const setLever = useCallback((key, value) => {
    setLevers((cur2) => ({ ...cur2, [key]: value }))
  }, [])

  function onOverrideChange(key, raw) {
    const t = String(raw).trim()
    setLever(key, t === '' ? null : num(t))
  }

  function onPctChange(key, raw) {
    const n = num(raw)
    setLever(key, n == null ? 0 : n)
  }

  function toggleAsset(assetNo) {
    setLevers((cur2) => {
      const set = new Set(Array.isArray(cur2.excludedAssets) ? cur2.excludedAssets : [])
      if (set.has(assetNo)) set.delete(assetNo)
      else set.add(assetNo)
      return { ...cur2, excludedAssets: Array.from(set) }
    })
  }

  function resetLevers() {
    setLevers(DEFAULT_LEVERS)
    setAssetQuery('')
  }

  /* ----- scenario actions ----- */
  function saveCurrent() {
    const name = scenarioName.trim() || `Scenario ${scenarios.length + 1}`
    setScenarios((list) => [...list, { id: nextId(), name, levers: { ...levers } }])
    setScenarioName('')
  }
  function loadScenario(sc) {
    setLevers({ ...DEFAULT_LEVERS, ...sc.levers })
  }
  function duplicateScenario(sc) {
    setScenarios((list) => [...list, { id: nextId(), name: `${sc.name} copy`, levers: { ...sc.levers } }])
  }
  function deleteScenario(id) {
    setScenarios((list) => list.filter((s) => s.id !== id))
  }

  /* ----- comparison rows (pure) ----- */
  const compareRows = useMemo(
    () => scenarioRows(baseline, scenarios),
    [baseline, scenarios],
  )

  /* ----- exports ----- */
  function exportCompare(kind) {
    const rows = compareRows.map((r) => ({
      name: r.name,
      km: fmtInt(r.kmDistance),
      km_cpk: fmtCpk(r.kmCpkTotal),
      hours: fmtInt(r.hoursDistance),
      hours_cpk: fmtCpk(r.hoursCpkTotal),
      note: r.note || '',
    }))
    if (!rows.length) return
    const name = reportFileName('TyrePulse CPK Scenario Studio', countryLabel, reportDateLabel())
    const colKeys = ['name', 'km', 'km_cpk', 'hours', 'hours_cpk', 'note']
    const headers = ['Scenario', 'Km', `Cost per km (${cur})`, 'Hours', `Cost per hour (${cur})`, 'Note']
    if (kind === 'excel') {
      exportToExcel(rows, colKeys, headers, name, 'CPK Scenarios')
    } else {
      exportToPdf(
        rows,
        colKeys.map((k, i) => ({ key: k, header: headers[i] })),
        `CPK scenario studio (${countryLabel})`,
        name,
        'landscape',
      )
    }
  }

  const hasData = assetList.length > 0

  return (
    <div className="w-full">
      {/* ---------- explainer ---------- */}
      <div
        className="mb-4 flex items-start gap-3 rounded-xl border p-4"
        style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-raised, var(--bg-elevated))' }}
      >
        <FlaskConical size={18} className="mt-0.5 shrink-0" style={{ color: 'var(--accent)' }} />
        <div className="text-sm">
          <div className="font-semibold mb-1">Scenario Studio</div>
          <p style={{ color: 'var(--text-secondary)' }}>
            Type a manual km total (or hours total) and watch fleet Cost-Per-Km recompute live. Scale
            tyre, maintenance and tyre-price cost, add a flat extra cost, or exclude assets, then save
            named scenarios to compare side by side. CPK = total cost / km (or hours); a null
            denominator reads N/A. Money is per country in {cur} and is never blended.
          </p>
        </div>
      </div>

      {!hasData && (
        <div
          className="mb-4 rounded-xl border p-6 text-center text-sm"
          style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
        >
          No CPK data loaded for {countryLabel} in this period. Load a country and period with tyre
          consumption to model a scenario.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* ================= LEVERS ================= */}
        <section
          className="rounded-xl border p-4"
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-raised, var(--bg-elevated))' }}
        >
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-base font-semibold">
              <SlidersHorizontal size={18} /> Levers
            </h3>
            <button
              type="button"
              onClick={resetLevers}
              className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs"
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              <RefreshCcw size={12} /> Reset to measured
            </button>
          </div>

          {/* ---- the star: manual km total ---- */}
          <div
            className="mb-3 rounded-lg border p-3"
            style={{ borderColor: 'var(--accent)', background: 'var(--bg-elevated)' }}
          >
            <label className="flex items-center gap-1.5 text-sm font-medium" htmlFor="cpk-km-total">
              <Truck size={14} /> Manual km total (override)
            </label>
            <p className="mt-0.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
              Measured: {fmtInt(baseline?.km?.distance)} km. Leave blank to use the measured km.
            </p>
            <input
              id="cpk-km-total"
              type="number"
              inputMode="numeric"
              aria-label="Manual km total override"
              value={levers.kmTotalOverride == null ? '' : levers.kmTotalOverride}
              onChange={(e) => onOverrideChange('kmTotalOverride', e.target.value)}
              placeholder={`${fmtInt(baseline?.km?.distance)} (measured)`}
              className="mt-2 w-full rounded-md border bg-transparent px-3 py-2 text-lg font-semibold tabular-nums"
              style={{ borderColor: 'var(--border-subtle)' }}
            />
          </div>

          {/* ---- manual hours total ---- */}
          <div className="mb-3 rounded-lg border p-3" style={{ borderColor: 'var(--border-subtle)' }}>
            <label className="flex items-center gap-1.5 text-sm font-medium" htmlFor="cpk-hours-total">
              <Factory size={14} /> Manual hours total (override)
            </label>
            <p className="mt-0.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
              Measured: {fmtInt(baseline?.hours?.distance)} hours. Leave blank to use the measured hours.
            </p>
            <input
              id="cpk-hours-total"
              type="number"
              inputMode="numeric"
              aria-label="Manual hours total override"
              value={levers.hoursTotalOverride == null ? '' : levers.hoursTotalOverride}
              onChange={(e) => onOverrideChange('hoursTotalOverride', e.target.value)}
              placeholder={`${fmtInt(baseline?.hours?.distance)} (measured)`}
              className="mt-2 w-full rounded-md border bg-transparent px-3 py-2 text-lg font-semibold tabular-nums"
              style={{ borderColor: 'var(--border-subtle)' }}
            />
          </div>

          {/* ---- cost scalers ---- */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <PctControl
              id="cpk-tyre-cost-pct" label="Tyre cost %"
              value={levers.tyreCostPct}
              onChange={(v) => onPctChange('tyreCostPct', v)}
            />
            <PctControl
              id="cpk-maint-cost-pct" label="Maintenance cost %"
              value={levers.maintCostPct}
              onChange={(v) => onPctChange('maintCostPct', v)}
            />
            <PctControl
              id="cpk-tyre-price-pct" label="Tyre price %"
              value={levers.tyrePricePct}
              onChange={(v) => onPctChange('tyrePricePct', v)}
            />
            <div>
              <label className="text-sm font-medium" htmlFor="cpk-extra-cost">
                Extra cost ({cur})
              </label>
              <input
                id="cpk-extra-cost"
                type="number"
                inputMode="numeric"
                aria-label="Extra flat cost"
                value={levers.extraCost == null ? '' : levers.extraCost}
                onChange={(e) => {
                  const n = num(e.target.value)
                  setLever('extraCost', n == null ? 0 : n)
                }}
                className="mt-1 w-full rounded-md border bg-transparent px-3 py-1.5 text-sm tabular-nums"
                style={{ borderColor: 'var(--border-subtle)' }}
              />
            </div>
          </div>

          {/* ---- asset include / exclude ---- */}
          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium">Include / exclude assets</span>
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                {excluded.size} excluded
              </span>
            </div>
            <div className="relative mb-2">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 opacity-50" />
              <input
                value={assetQuery}
                onChange={(e) => setAssetQuery(e.target.value)}
                placeholder="Search asset or type"
                aria-label="Search assets"
                className="w-full rounded-md border bg-transparent pl-8 pr-3 py-1.5 text-sm"
                style={{ borderColor: 'var(--border-subtle)' }}
              />
            </div>
            <div
              className="max-h-56 overflow-y-auto rounded-lg border"
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              {filteredAssets.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {assetList.length === 0 ? 'No assets to include.' : 'No assets match the search.'}
                </div>
              ) : (
                filteredAssets.map((a) => {
                  const isExcluded = excluded.has(a.asset_no)
                  return (
                    <label
                      key={a.asset_no}
                      className="flex cursor-pointer items-center gap-2 border-t px-3 py-1.5 text-sm first:border-t-0"
                      style={{ borderColor: 'var(--border-subtle)', opacity: isExcluded ? 0.55 : 1 }}
                    >
                      <input
                        type="checkbox"
                        checked={!isExcluded}
                        onChange={() => toggleAsset(a.asset_no)}
                        aria-label={`Include ${a.asset_no}`}
                      />
                      <span className="font-medium">{a.asset_no}</span>
                      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {a.vehicle_type == null || String(a.vehicle_type).trim() === '' ? 'N/A' : a.vehicle_type}
                      </span>
                      <span className="ml-auto text-xs tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                        {fmtInt(a.distance)} | {fmtMoney(a.totalCost, cur)}
                      </span>
                    </label>
                  )
                })
              )}
            </div>
          </div>
        </section>

        {/* ================= LIVE RESULT ================= */}
        <section
          className="rounded-xl border p-4"
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-raised, var(--bg-elevated))' }}
        >
          <h3 className="mb-3 flex items-center gap-2 text-base font-semibold">
            <Gauge size={18} /> Live result
            <span className="text-sm font-normal" style={{ color: 'var(--text-secondary)' }}>
              ({countryLabel})
            </span>
          </h3>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <ResultCard
              icon={Truck}
              title="Km side (cost per km)"
              side={result?.km}
              delta={result?.delta?.km}
              base={result?.base?.km}
              unitWord="km"
              cur={cur}
            />
            <ResultCard
              icon={Factory}
              title="Hours side (cost per hour)"
              side={result?.hours}
              delta={result?.delta?.hours}
              base={result?.base?.hours}
              unitWord="hours"
              cur={cur}
            />
          </div>

          <p className="mt-3 flex items-start gap-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
            <Info size={12} className="mt-0.5 shrink-0" />
            <span>
              The delta compares the scenario to the measured baseline. A "up" delta means cost per
              unit rose. A null CPK (no km/hours) reads N/A. Money is per country in {cur}.
            </span>
          </p>
        </section>
      </div>

      {/* ================= SCENARIOS ================= */}
      <section
        className="mt-4 rounded-xl border p-4"
        style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-raised, var(--bg-elevated))' }}
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <Save size={18} /> Saved scenarios
          </h3>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => exportCompare('excel')}
              disabled={compareRows.length === 0}
              className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs disabled:opacity-40"
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              <FileSpreadsheet size={12} /> Excel
            </button>
            <button
              type="button"
              onClick={() => exportCompare('pdf')}
              disabled={compareRows.length === 0}
              className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs disabled:opacity-40"
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              <FileText size={12} /> PDF
            </button>
          </div>
        </div>

        {/* save current */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
            value={scenarioName}
            onChange={(e) => setScenarioName(e.target.value)}
            placeholder="Name this scenario"
            aria-label="Scenario name"
            className="flex-1 min-w-[12rem] rounded-md border bg-transparent px-3 py-1.5 text-sm"
            style={{ borderColor: 'var(--border-subtle)' }}
          />
          <button
            type="button"
            onClick={saveCurrent}
            disabled={!hasData}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-40"
            style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
          >
            <Plus size={14} /> Save current levers
          </button>
        </div>

        {/* comparison table */}
        <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }}>
          <table className="w-full text-sm border-collapse">
            <thead style={{ background: 'var(--surface-raised, var(--bg-elevated))' }}>
              <tr>
                <th className="px-4 py-2.5 text-left font-semibold whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>Scenario</th>
                <th className="px-4 py-2.5 text-right font-semibold whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>Km</th>
                <th className="px-4 py-2.5 text-right font-semibold whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>Cost per km ({cur})</th>
                <th className="px-4 py-2.5 text-right font-semibold whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>Hours</th>
                <th className="px-4 py-2.5 text-right font-semibold whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>Cost per hour ({cur})</th>
                <th className="px-4 py-2.5 text-right font-semibold whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {compareRows.map((r, i) => {
                // row 0 = baseline (no matching saved scenario)
                const sc = i > 0 ? scenarios[i - 1] : null
                return (
                  <tr key={sc ? sc.id : `baseline-${i}`} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                    <td className="px-4 py-2.5 text-left whitespace-nowrap font-medium">
                      {r.name}
                      {!sc && (
                        <span className="ml-2 text-xs font-normal" style={{ color: 'var(--text-secondary)' }}>
                          (measured)
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">{fmtInt(r.kmDistance)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">{fmtCpk(r.kmCpkTotal)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">{fmtInt(r.hoursDistance)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">{fmtCpk(r.hoursCpkTotal)}</td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      {sc ? (
                        <span className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => loadScenario(sc)}
                            className="rounded border px-2 py-0.5 text-xs"
                            style={{ borderColor: 'var(--border-subtle)' }}
                            title="Load these levers"
                          >
                            Load
                          </button>
                          <button
                            type="button"
                            onClick={() => duplicateScenario(sc)}
                            className="rounded border px-1.5 py-0.5 text-xs"
                            style={{ borderColor: 'var(--border-subtle)' }}
                            title="Duplicate"
                          >
                            <Copy size={12} />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteScenario(sc.id)}
                            className="rounded border px-1.5 py-0.5 text-xs"
                            style={{ borderColor: 'var(--border-subtle)', color: '#dc2626' }}
                            title="Delete"
                          >
                            <Trash2 size={12} />
                          </button>
                        </span>
                      ) : (
                        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>-</span>
                      )}
                    </td>
                  </tr>
                )
              })}
              {compareRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
                    No baseline yet. Load CPK data to start comparing scenarios.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {scenarios.length === 0 && compareRows.length > 0 && (
          <p className="mt-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
            Save the current levers above to add a scenario row next to the measured baseline.
          </p>
        )}
      </section>
    </div>
  )
}

/* ---------- percent control (slider + number) ---------- */

function PctControl({ id, label, value, onChange }) {
  const v = num(value)
  const shown = v == null ? 100 : v
  return (
    <div>
      <label className="text-sm font-medium" htmlFor={id}>{label}</label>
      <div className="mt-1 flex items-center gap-2">
        <input
          type="range"
          min={0}
          max={300}
          step={5}
          value={Math.max(0, Math.min(300, shown))}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} slider`}
          className="flex-1"
          style={{ accentColor: 'var(--accent)' }}
        />
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={0}
          max={300}
          value={shown}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
          className="w-16 rounded-md border bg-transparent px-2 py-1 text-sm tabular-nums"
          style={{ borderColor: 'var(--border-subtle)' }}
        />
      </div>
    </div>
  )
}

/* ---------- live result card ---------- */

function ResultCard({ icon: Icon, title, side, delta, base, unitWord, cur }) {
  const distance = side ? side.distance : null
  const totalCost = side ? side.totalCost : null
  const cpkTotal = side ? side.cpkTotal : null
  const cpkTyre = side ? side.cpkTyre : null
  const cpkAbs = delta ? delta.cpkTotalAbs : null
  const cpkPct = delta ? delta.cpkTotalPct : null
  const baseCpk = base ? base.cpkTotal : null
  const tone = deltaTone(cpkAbs)

  return (
    <div className="rounded-lg border p-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
      <div className="flex items-center gap-1.5 text-sm font-medium">
        {Icon ? <Icon size={14} /> : null} {title}
      </div>

      <div className="mt-2 text-2xl font-semibold tabular-nums">
        {fmtCpk(cpkTotal)}
        <span className="ml-1 text-sm font-normal" style={{ color: 'var(--text-secondary)' }}>
          {cur} / {unitWord}
        </span>
      </div>

      {/* delta vs baseline */}
      <div className="mt-1 flex items-center gap-1.5 text-xs" style={{ color: tone.color }}>
        <tone.Icon size={13} />
        <span className="tabular-nums">
          {dirWord(cpkAbs)} {fmtCpkDelta(cpkAbs)} ({fmtPct(cpkPct)}) vs baseline {fmtCpk(baseCpk)}
        </span>
      </div>

      <div className="mt-2 space-y-1">
        <Line label={unitWord === 'km' ? 'Km' : 'Hours'} value={fmtInt(distance)} />
        <Line label="Total cost" value={fmtMoney(totalCost, cur)} />
        <Line label="CPK tyre" value={fmtCpk(cpkTyre)} />
      </div>
    </div>
  )
}

function Line({ label, value }) {
  return (
    <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-secondary)' }}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}
