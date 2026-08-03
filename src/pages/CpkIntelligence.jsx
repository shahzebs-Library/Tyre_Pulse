/**
 * CpkIntelligence (route /cpk-intelligence) - the standalone CPK module.
 *
 * A dedicated home for Cost Per Km / Cost Per Hour, kept OUT of the Engineering
 * KPI page. It loads ONE country and ONE bounded period at a time (default the
 * current month) rather than the whole history, and splits the fleet into two
 * independent, advanced tables:
 *   - MOVABLE assets, measured per kilometre (trucks, mixers, road units)
 *   - NON-MOVABLE assets, measured per engine-hour (generators, pumps, plant)
 *
 * The four heavy "advanced" views (per-vehicle table, what-if scenario, brand
 * value, why-it-changed) are lazy tabs - only the open one fetches, so nothing
 * loads everything at once.
 *
 * All money is per country in its own currency (never blended); every CPK is
 * null -> "N/A" when its km/hours denominator is 0 (honest, never a fabricated 0).
 * Data: get_fleet_cpk / get_cpk_drivers / get_brand_size_cpk. Maths live in the
 * pure engines (cpkModule, fleetCpkView, costIntelligence, cpkScenario, cpkDrivers).
 */
import { useState, useEffect, useMemo, useCallback, lazy, Suspense } from 'react'
import {
  Gauge, Truck, Factory, FlaskConical, TrendingUp, Table2,
  FileSpreadsheet, FileText, RefreshCcw, Info, Milestone, Layers,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings, COUNTRIES } from '../contexts/SettingsContext'
import { getFleetCpk } from '../lib/api/fleetCpk'
import { getCpkDrivers } from '../lib/api/cpkDrivers'
import { getBrandSizeCpk } from '../lib/api/brandSizeCpk'
import {
  CPK_PERIODS, DEFAULT_PERIOD, periodBounds, periodLabel,
  MOBILITY_META, splitByMobility, fleetSideFor,
} from '../lib/cpkModule'
import { fmtCpkValue, fmtDistance, fmtMoney, fmtCoverage, sortByTypeWorstFirst } from '../lib/fleetCpkView'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import CpkDataTable from '../components/cpk/CpkDataTable'

const CpkScenarioPanel = lazy(() => import('../components/cpk/CpkScenarioPanel'))
const CpkDriversPanel = lazy(() => import('../components/cpk/CpkDriversPanel'))
const KmSourcePanel = lazy(() => import('../components/cpk/KmSourcePanel'))
const CpkUnitAuditPanel = lazy(() => import('../components/cpk/CpkUnitAuditPanel'))
const CpkReportPanel = lazy(() => import('../components/cpk/CpkReportPanel'))

const MOBILITIES = ['movable', 'non_movable']

const TABS = [
  { key: 'fleet', label: 'Fleet CPK', icon: Gauge },
  { key: 'vehicles', label: 'Per vehicle', icon: Table2 },
  { key: 'km_source', label: 'KM source', icon: Milestone },
  { key: 'units', label: 'Units & why different', icon: Layers },
  { key: 'report', label: 'Custom report', icon: FileText },
  { key: 'scenario', label: 'What-if scenario', icon: FlaskConical },
  { key: 'brand', label: 'Brand value', icon: TrendingUp },
  { key: 'drivers', label: 'Why it changed', icon: Info },
]

function num(v) { return Number.isFinite(Number(v)) ? Number(v) : 0 }

export default function CpkIntelligence() {
  const { activeCountry } = useSettings()

  const initialCountry = activeCountry && activeCountry !== 'All' ? activeCountry : COUNTRIES[0]
  const [country, setCountry] = useState(initialCountry)
  const [periodKey, setPeriodKey] = useState(DEFAULT_PERIOD)
  const [tab, setTab] = useState('fleet')

  const bounds = useMemo(() => periodBounds(periodKey, new Date()), [periodKey])

  // Core fleet CPK - loaded for every tab (small: one country + one bounded window).
  const [fleetCpk, setFleetCpk] = useState({ perVehicle: [], byType: [], fleet: [] })
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    let cancelled = false
    setLoading(true)
    getFleetCpk({ country, from: bounds.from, to: bounds.to })
      .then((res) => { if (!cancelled) setFleetCpk(res || { perVehicle: [], byType: [], fleet: [] }) })
      .catch(() => { if (!cancelled) setFleetCpk({ perVehicle: [], byType: [], fleet: [] }) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [country, bounds.from, bounds.to])

  useEffect(() => load(), [load])

  // Advanced tabs fetch only when opened.
  const [drivers, setDrivers] = useState({ ok: false, windows: null, segments: [] })
  const [brandRows, setBrandRows] = useState([])
  const [advLoading, setAdvLoading] = useState(false)

  useEffect(() => {
    if (tab !== 'drivers' && tab !== 'brand') return
    let cancelled = false
    setAdvLoading(true)
    Promise.all([
      tab === 'drivers'
        ? getCpkDrivers({ country, from: bounds.from, to: bounds.to }).catch(() => ({ ok: false, windows: null, segments: [] }))
        : Promise.resolve(null),
      getBrandSizeCpk({ country, from: bounds.from, to: bounds.to }).catch(() => []),
    ]).then(([d, b]) => {
      if (cancelled) return
      if (d) setDrivers(d)
      setBrandRows(Array.isArray(b) ? b : [])
    }).finally(() => { if (!cancelled) setAdvLoading(false) })
    return () => { cancelled = true }
  }, [tab, country, bounds.from, bounds.to])

  const currency = fleetCpk.fleet?.[0]?.currency || country

  // Split every source by mobility so movable / non-movable are independent.
  const byTypeSplit = useMemo(() => splitByMobility(fleetCpk.byType), [fleetCpk.byType])
  const perVehicleSplit = useMemo(() => splitByMobility(fleetCpk.perVehicle), [fleetCpk.perVehicle])
  const fleetRow = fleetCpk.fleet?.[0] || null

  function exportVehicles(mobility) {
    const rows = sortByTypeWorstFirst(perVehicleSplit[mobility]).map((r) => ({
      asset_no: r.asset_no ?? '',
      vehicle_type: r.vehicle_type ?? '',
      distance: Math.round(num(r.distance_or_hours)),
      tyre_cost: Math.round(num(r.tyre_cost)),
      total_cost: Math.round(num(r.total_cost)),
      cpk_tyre: r.cpk_tyre == null ? 'N/A' : Number(r.cpk_tyre).toFixed(4),
      cpk_total: r.cpk_total == null ? 'N/A' : Number(r.cpk_total).toFixed(4),
    }))
    if (!rows.length) return
    const unitLbl = MOBILITY_META[mobility].sublabel
    exportToExcel(
      rows,
      ['asset_no', 'vehicle_type', 'distance', 'tyre_cost', 'total_cost', 'cpk_tyre', 'cpk_total'],
      ['Asset', 'Type', mobility === 'movable' ? 'Km' : 'Hours', `Tyre Cost (${currency})`, `Total Cost (${currency})`, `CPK Tyre`, `CPK Total`],
      `TyrePulse_CPK_${country}_${mobility}`,
      `CPK ${MOBILITY_META[mobility].label} (${unitLbl})`,
    )
  }

  function exportByTypePdf(mobility) {
    const rows = sortByTypeWorstFirst(byTypeSplit[mobility]).map((r) => ({
      vehicle_type: r.vehicle_type ?? '',
      distance: Math.round(num(r.distance_or_hours)),
      tyre_cost: Math.round(num(r.tyre_cost)),
      total_cost: Math.round(num(r.total_cost)),
      cpk_tyre: r.cpk_tyre == null ? 'N/A' : Number(r.cpk_tyre).toFixed(4),
      cpk_total: r.cpk_total == null ? 'N/A' : Number(r.cpk_total).toFixed(4),
    }))
    if (!rows.length) return
    exportToPdf(
      rows,
      [
        { key: 'vehicle_type', header: 'Asset Type' },
        { key: 'distance', header: mobility === 'movable' ? 'Km' : 'Hours' },
        { key: 'tyre_cost', header: `Tyre Cost (${currency})` },
        { key: 'total_cost', header: `Total Cost (${currency})` },
        { key: 'cpk_tyre', header: 'CPK Tyre' },
        { key: 'cpk_total', header: 'CPK Total' },
      ],
      `${country} ${MOBILITY_META[mobility].label} CPK by type (${MOBILITY_META[mobility].sublabel})`,
      `TyrePulse_CPK_${country}_${mobility}`,
      'landscape',
    )
  }

  const vehicleColumns = (mobility) => ([
    { key: 'asset_no', header: 'Asset', align: 'left', kind: 'text' },
    { key: 'vehicle_type', header: 'Type', align: 'left', kind: 'text' },
    { key: 'distance_or_hours', header: mobility === 'movable' ? 'Km' : 'Hours', align: 'right', kind: 'int' },
    { key: 'tyre_cost', header: `Tyre (${currency})`, align: 'right', kind: 'money' },
    { key: 'maintenance_cost', header: `Maint (${currency})`, align: 'right', kind: 'money' },
    { key: 'total_cost', header: `Total (${currency})`, align: 'right', kind: 'money' },
    { key: 'cpk_tyre', header: 'CPK tyre', align: 'right', kind: 'cpk' },
    { key: 'cpk_total', header: 'CPK total', align: 'right', kind: 'cpk' },
  ])

  const typeColumns = (mobility) => ([
    { key: 'vehicle_type', header: 'Asset type', align: 'left', kind: 'text' },
    { key: 'distance_or_hours', header: mobility === 'movable' ? 'Km' : 'Hours', align: 'right', kind: 'int' },
    { key: 'tyre_cost', header: `Tyre (${currency})`, align: 'right', kind: 'money' },
    { key: 'total_cost', header: `Total (${currency})`, align: 'right', kind: 'money' },
    { key: 'cpk_tyre', header: 'CPK tyre', align: 'right', kind: 'cpk' },
    { key: 'cpk_total', header: 'CPK total', align: 'right', kind: 'cpk' },
  ])

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto">
      <PageHeader
        title="CPK Intelligence"
        subtitle="Cost per km (movable) and cost per hour (non-movable), by country and period"
        actions={
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-2 rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-sm"
          >
            <RefreshCcw size={14} /> Refresh
          </button>
        }
      />

      {/* Controls: country + period. Loads one bounded window at a time. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-[var(--border-subtle)] p-0.5">
          {COUNTRIES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCountry(c)}
              className={`px-3 py-1.5 text-sm rounded-md ${country === c ? 'bg-[var(--accent)] text-white' : ''}`}
              style={country === c ? undefined : { color: 'var(--text-secondary)' }}
            >{c}</button>
          ))}
        </div>
        <select
          value={periodKey}
          onChange={(e) => setPeriodKey(e.target.value)}
          className="rounded-md border border-[var(--border-subtle)] bg-transparent px-3 py-1.5 text-sm"
        >
          {CPK_PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          {periodLabel(bounds)}
        </span>
      </div>

      <p className="mb-4 text-xs" style={{ color: 'var(--text-secondary)' }}>
        Distance = total tyre-km (the sum of each tyre's total_km from the uploaded change data),
        matched to the tyre's change month. Cost is per country in its own currency.
      </p>

      {/* Tabs. Only the open tab's advanced data is fetched. */}
      <div className="mb-4 flex flex-wrap gap-1 border-b border-[var(--border-subtle)]">
        {TABS.map((t) => {
          const Icon = t.icon
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-2 px-3 py-2 text-sm border-b-2 -mb-px ${tab === t.key ? 'border-[var(--accent)] font-semibold' : 'border-transparent'}`}
              style={tab === t.key ? undefined : { color: 'var(--text-secondary)' }}
            >
              <Icon size={14} /> {t.label}
            </button>
          )
        })}
      </div>

      {tab === 'fleet' && (
        <div className="space-y-6">
          {MOBILITIES.map((mobility) => {
            const meta = MOBILITY_META[mobility]
            const side = fleetSideFor(fleetRow, mobility)
            const typeRows = sortByTypeWorstFirst(byTypeSplit[mobility])
            const Icon = mobility === 'movable' ? Truck : Factory
            return (
              <section key={mobility} className="rounded-xl border border-[var(--border-subtle)] p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-base font-semibold">
                    <Icon size={18} /> {meta.label} <span className="text-sm font-normal" style={{ color: 'var(--text-secondary)' }}>({meta.sublabel})</span>
                  </h3>
                  <button type="button" onClick={() => exportByTypePdf(mobility)} className="inline-flex items-center gap-1.5 text-xs rounded-md border border-[var(--border-subtle)] px-2.5 py-1">
                    <FileText size={12} /> PDF
                  </button>
                </div>

                {/* Fleet KPI strip for this mobility (single country -> one currency). */}
                <div className="mb-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Kpi label={`Fleet CPK (tyre)`} value={fmtCpkValue(side?.cpkTyre ?? null, currency, meta.unit)} />
                  <Kpi label={`Fleet CPK (total)`} value={fmtCpkValue(side?.cpkTotal ?? null, currency, meta.unit)} />
                  <Kpi label={mobility === 'movable' ? 'Total km' : 'Total hours'} value={fmtDistance(side?.distance ?? 0, meta.unit)} />
                  <Kpi label="Meter coverage" value={fmtCoverage(side?.coveragePct ?? null)} hint="share of this fleet's cost that has a measured km/hours denominator" />
                </div>
                {side && num(side.tyreCost) > 0 && (
                  <p className="mb-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    Tyre spend {fmtMoney(side.tyreCost, currency)} of total {fmtMoney(side.totalCost, currency)}.
                  </p>
                )}

                <CpkDataTable
                  columns={typeColumns(mobility)}
                  rows={typeRows}
                  loading={loading}
                  initialSort={{ key: 'cpk_total', dir: 'desc' }}
                  pageSize={10}
                  emptyText={`No ${meta.label.toLowerCase()} cost or meter data for ${country} in this period.`}
                  dense
                />
              </section>
            )
          })}
        </div>
      )}

      {tab === 'vehicles' && (
        <div className="space-y-6">
          {MOBILITIES.map((mobility) => {
            const meta = MOBILITY_META[mobility]
            const rows = perVehicleSplit[mobility]
            const Icon = mobility === 'movable' ? Truck : Factory
            return (
              <section key={mobility} className="rounded-xl border border-[var(--border-subtle)] p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-base font-semibold">
                    <Icon size={18} /> {meta.label} vehicles <span className="text-sm font-normal" style={{ color: 'var(--text-secondary)' }}>({meta.sublabel})</span>
                  </h3>
                  <button type="button" onClick={() => exportVehicles(mobility)} className="inline-flex items-center gap-1.5 text-xs rounded-md border border-[var(--border-subtle)] px-2.5 py-1">
                    <FileSpreadsheet size={12} /> Excel
                  </button>
                </div>
                <CpkDataTable
                  columns={vehicleColumns(mobility)}
                  rows={rows}
                  loading={loading}
                  searchKeys={['asset_no', 'vehicle_type']}
                  initialSort={{ key: 'cpk_total', dir: 'desc' }}
                  pageSize={25}
                  emptyText={`No ${meta.label.toLowerCase()} vehicles with cost or meter data for ${country} in this period.`}
                />
              </section>
            )
          })}
        </div>
      )}

      {tab === 'km_source' && (
        <Suspense fallback={<Loading />}>
          <KmSourcePanel country={country} from={bounds.from} to={bounds.to} currency={currency} />
        </Suspense>
      )}

      {tab === 'units' && (
        <Suspense fallback={<Loading />}>
          <CpkUnitAuditPanel country={country} from={bounds.from} to={bounds.to} currency={currency} />
        </Suspense>
      )}

      {tab === 'report' && (
        <Suspense fallback={<Loading />}>
          <CpkReportPanel
            country={country}
            from={bounds.from}
            to={bounds.to}
            currency={currency}
            perVehicle={fleetCpk.perVehicle}
            byType={fleetCpk.byType}
            fleet={fleetCpk.fleet}
          />
        </Suspense>
      )}

      {tab === 'scenario' && (
        <Suspense fallback={<Loading />}>
          <p className="mb-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
            Exclude a case (e.g. a wheel loader with cost but no measured km) and watch the fleet CPK move live.
          </p>
          <CpkScenarioPanel perVehicle={fleetCpk.perVehicle} loading={loading} />
        </Suspense>
      )}

      {tab === 'brand' && (
        <Suspense fallback={<Loading />}>
          <CpkDriversPanel
            drivers={{ ok: false, windows: null, segments: [] }}
            fleetCpk={fleetCpk}
            brandSizeRows={brandRows}
            currency={currency}
            loading={advLoading || loading}
          />
        </Suspense>
      )}

      {tab === 'drivers' && (
        <Suspense fallback={<Loading />}>
          <p className="mb-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
            The current period against the one before it, taken apart into what moved the cost per km / hour
            (tyre price, asset mix, new equipment, utilization).
          </p>
          <CpkDriversPanel
            drivers={drivers}
            fleetCpk={fleetCpk}
            brandSizeRows={brandRows}
            currency={currency}
            loading={advLoading || loading}
          />
        </Suspense>
      )}
    </div>
  )
}

function Kpi({ label, value, hint }) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] p-3" title={hint || undefined}>
      <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  )
}

function Loading() {
  return <div className="py-10 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>Loading...</div>
}
