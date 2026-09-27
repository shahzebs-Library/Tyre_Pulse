/**
 * IftaReporting (route /ifta-reporting) - IFTA Fuel Tax Reporting. Captures the
 * jurisdiction-by-jurisdiction distance (km) and fuel (litres/cost) data needed
 * to file quarterly International Fuel Tax Agreement (IFTA) returns. Every
 * record is org-isolated and country-scoped.
 *
 * Runs on the `ifta_records` table (V173). The base roll-ups live in
 * `src/lib/iftaRecords.js`; filtering, the per-currency cost split, the
 * quarter roll-up, filing gaps and the IFTA net-tax estimate live in the pure,
 * tested `src/lib/iftaReportingAnalytics.js`.
 *
 * Money is never summed across currencies: fuel cost is shown one line per
 * currency, and a single cost figure only appears when one currency is in view.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Fuel, Globe, Droplets, Coins, TrendingUp, Activity, AlertTriangle,
  Search, X, FileSpreadsheet, FileText, Plus, Pencil, Trash2, RefreshCw,
  Scale, CalendarClock, ListChecks,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import StatTile from '../components/ui/StatTile'
import Modal from '../components/ui/Modal'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { useSettings } from '../contexts/SettingsContext'
import {
  listIftaRecords, createIftaRecord, updateIftaRecord, deleteIftaRecord,
} from '../lib/api/iftaRecords'
import {
  filterIftaRecords, recordGaps, costByCurrency, quarterRollup, jurisdictionTax, iftaKpis,
  fuelEconomyKmPerL,
} from '../lib/iftaReportingAnalytics'
import { exportToExcel, exportToPdf, reportFileName, reportDateLabel } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation } from '../lib/api/_client'

const EMPTY_FORM = {
  asset_no: '', driver_name: '', jurisdiction: '', quarter: '', travel_date: '',
  distance_km: '', fuel_litres: '', fuel_cost: '', currency: '', tax_rate: '',
  taxable_km: '', notes: '',
}

const fmtNum = (v, unit) => (v == null || v === '' ? 'N/A' : `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 })}${unit ? ` ${unit}` : ''}`)
const fmtRatio = (v) => (v == null ? 'N/A' : Number(v).toFixed(2))
const fmtPct = (v) => (v == null ? 'N/A' : `${v}%`)

function fmtMoney(v, currency) {
  if (v == null || v === '' || !Number.isFinite(Number(v))) return 'N/A'
  return `${currency ? `${currency} ` : ''}${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

function fmtDate(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString()
}

const distinct = (list, key) => [...new Set(list.map((r) => r[key]).filter(Boolean))].sort()

const GAP_LABEL = { jurisdiction: 'Jurisdiction', quarter: 'Quarter', distance: 'Distance', fuel: 'Fuel', currency: 'Currency' }

const ICON_BTN = 'inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--input-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]'

export default function IftaReporting() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [countryFilter, setCountryFilter] = useState('')
  const [quarterFilter, setQuarterFilter] = useState('')
  const [jurisdictionFilter, setJurisdictionFilter] = useState('')
  const [currencyFilter, setCurrencyFilter] = useState('')
  const [incompleteOnly, setIncompleteOnly] = useState(false)
  const [search, setSearch] = useState('')

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setNotProvisioned(false)
    try {
      const data = await listIftaRecords({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) { setNotProvisioned(true); setRows([]) }
      else { setError(toUserMessage(err, 'Could not load IFTA records.')); setRows(null) }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const loading = rows === null && !error
  const all = useMemo(() => rows || [], [rows])
  const countryOptions = useMemo(() => distinct(all, 'country'), [all])
  const quarterOptions = useMemo(() => distinct(all, 'quarter'), [all])
  const jurisdictionOptions = useMemo(() => distinct(all, 'jurisdiction'), [all])
  const currencyOptions = useMemo(() => costByCurrency(all).map((c) => c.currency), [all])

  const filtered = useMemo(() => filterIftaRecords(all, {
    country: countryFilter, quarter: quarterFilter, jurisdiction: jurisdictionFilter,
    currency: currencyFilter, incompleteOnly, search,
  }), [all, countryFilter, quarterFilter, jurisdictionFilter, currencyFilter, incompleteOnly, search])

  const kpis = useMemo(() => iftaKpis(filtered), [filtered])
  const jurisdictions = useMemo(() => jurisdictionTax(filtered), [filtered])
  const quarters = useMemo(() => quarterRollup(filtered), [filtered])

  const hasFilters = countryFilter || quarterFilter || jurisdictionFilter || currencyFilter || incompleteOnly || search
  const clearFilters = () => {
    setCountryFilter(''); setQuarterFilter(''); setJurisdictionFilter(''); setCurrencyFilter(''); setIncompleteOnly(false); setSearch('')
  }

  // ── Export ───────────────────────────────────────────────────────────────
  const EXPORT_COLS = ['asset_no', 'driver_name', 'jurisdiction', 'quarter', 'travel_date', 'distance_km', 'fuel_litres', 'km_per_l', 'fuel_cost', 'currency', 'tax_rate', 'taxable_km', 'gaps', 'notes']
  const EXPORT_HEADERS = ['Asset', 'Driver', 'Jurisdiction', 'Quarter', 'Travel date', 'Distance (km)', 'Fuel (L)', 'km per L', 'Fuel cost', 'Currency', 'Tax rate', 'Taxable (km)', 'Filing gaps', 'Notes']
  const exportRows = () => filtered.map((r) => {
    const kpl = fuelEconomyKmPerL(r)
    return {
      asset_no: r.asset_no || '', driver_name: r.driver_name || '',
      jurisdiction: r.jurisdiction || '', quarter: r.quarter || '',
      travel_date: r.travel_date || '', distance_km: r.distance_km ?? '',
      fuel_litres: r.fuel_litres ?? '', km_per_l: kpl == null ? '' : Number(kpl.toFixed(2)),
      fuel_cost: r.fuel_cost ?? '', currency: r.currency || '', tax_rate: r.tax_rate ?? '',
      taxable_km: r.taxable_km ?? '', gaps: recordGaps(r).map((g) => GAP_LABEL[g]).join(', '),
      notes: r.notes || '',
    }
  })
  const fileName = () => reportFileName('TyrePulse IFTA Fuel Tax', activeCountry !== 'All' ? activeCountry : null, quarterFilter || null, reportDateLabel())
  const doExcel = async () => {
    setActionError('')
    try { await exportToExcel(exportRows(), EXPORT_COLS, EXPORT_HEADERS, fileName()) }
    catch (e) { setActionError(toUserMessage(e, 'Could not export. Try again.')) }
  }
  const doPdf = async () => {
    setActionError('')
    try { await exportToPdf(exportRows(), EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'IFTA Fuel Tax Reporting', fileName(), 'landscape') }
    catch (e) { setActionError(toUserMessage(e, 'Could not export. Try again.')) }
  }

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true) }
  const openEdit = useCallback((r) => {
    setEditing(r)
    setForm({
      asset_no: r.asset_no || '', driver_name: r.driver_name || '',
      jurisdiction: r.jurisdiction || '', quarter: r.quarter || '',
      travel_date: r.travel_date || '', distance_km: r.distance_km ?? '',
      fuel_litres: r.fuel_litres ?? '', fuel_cost: r.fuel_cost ?? '',
      currency: r.currency || '', tax_rate: r.tax_rate ?? '',
      taxable_km: r.taxable_km ?? '', notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }, [])
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.asset_no.trim()) { setFormError('An asset number is required.'); return }
    setSaving(true)
    try {
      const payload = { ...form, country: activeCountry !== 'All' ? activeCountry : null }
      if (editing) await updateIftaRecord(editing.id, payload)
      else await createIftaRecord(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the record.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteIftaRecord(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setActionError(toUserMessage(err, 'Could not delete the record.'))
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  // ── Columns ──────────────────────────────────────────────────────────────
  const jurisdictionColumns = useMemo(() => [
    { id: 'jurisdiction', header: 'Jurisdiction', accessorFn: (j) => j.jurisdiction, cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.jurisdiction}</span> },
    { id: 'distance', header: 'Distance (km)', accessorFn: (j) => j.distanceKm, meta: { align: 'right' }, cell: ({ row }) => Math.round(row.original.distanceKm).toLocaleString() },
    { id: 'taxable', header: 'Taxable (km)', accessorFn: (j) => j.taxableKm, meta: { align: 'right' }, cell: ({ row }) => Math.round(row.original.taxableKm).toLocaleString() },
    { id: 'fuel', header: 'Fuel bought (L)', accessorFn: (j) => j.fuelLitres, meta: { align: 'right' }, cell: ({ row }) => Math.round(row.original.fuelLitres).toLocaleString() },
    { id: 'kpl', header: 'km per L', accessorFn: (j) => j.kmPerL, meta: { align: 'right' }, cell: ({ row }) => fmtRatio(row.original.kmPerL) },
    { id: 'taxFuel', header: 'Taxable fuel (L)', accessorFn: (j) => j.taxableFuelL, meta: { align: 'right' }, cell: ({ row }) => fmtNum(row.original.taxableFuelL) },
    {
      id: 'rate', header: 'Tax rate', accessorFn: (j) => j.rate, meta: { align: 'right' },
      cell: ({ row }) => (row.original.rateConflict ? <span className="text-amber-300">Mixed rates</span> : row.original.rate == null ? 'N/A' : row.original.rate),
    },
    {
      id: 'net', header: 'Net tax (est.)', accessorFn: (j) => j.netTax, meta: { align: 'right' },
      cell: ({ row }) => {
        const j = row.original
        if (j.netTax == null) return <span className="text-[var(--text-muted)]">N/A</span>
        return (
          <span className={j.position === 'owed' ? 'text-red-400 font-semibold' : j.position === 'credit' ? 'text-green-400 font-semibold' : ''}>
            {Math.abs(j.netTax).toLocaleString(undefined, { maximumFractionDigits: 2 })} {j.position === 'owed' ? 'owed' : j.position === 'credit' ? 'credit' : ''}
          </span>
        )
      },
    },
  ], [])

  const quarterColumns = useMemo(() => [
    { id: 'quarter', header: 'Quarter', accessorFn: (q) => q.quarter, cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.quarter}</span> },
    { id: 'records', header: 'Records', accessorFn: (q) => q.records, meta: { align: 'right' } },
    { id: 'distance', header: 'Distance (km)', accessorFn: (q) => q.distanceKm, meta: { align: 'right' }, cell: ({ row }) => Math.round(row.original.distanceKm).toLocaleString() },
    { id: 'taxable', header: 'Taxable (km)', accessorFn: (q) => q.taxableKm, meta: { align: 'right' }, cell: ({ row }) => Math.round(row.original.taxableKm).toLocaleString() },
    { id: 'fuel', header: 'Fuel (L)', accessorFn: (q) => q.fuelLitres, meta: { align: 'right' }, cell: ({ row }) => Math.round(row.original.fuelLitres).toLocaleString() },
    { id: 'kpl', header: 'km per L', accessorFn: (q) => q.kmPerL, meta: { align: 'right' }, cell: ({ row }) => fmtRatio(row.original.kmPerL) },
  ], [])

  const recordColumns = useMemo(() => [
    { id: 'asset', header: 'Asset', accessorFn: (r) => r.asset_no || '', cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.asset_no || 'N/A'}</span> },
    { id: 'jurisdiction', header: 'Jurisdiction', accessorFn: (r) => r.jurisdiction || '', cell: ({ row }) => row.original.jurisdiction || 'N/A' },
    { id: 'quarter', header: 'Quarter', accessorFn: (r) => r.quarter || '', cell: ({ row }) => row.original.quarter || 'N/A' },
    { id: 'date', header: 'Travel date', accessorFn: (r) => r.travel_date || '', cell: ({ row }) => fmtDate(row.original.travel_date) },
    { id: 'distance', header: 'Distance', accessorFn: (r) => Number(r.distance_km) || null, meta: { align: 'right' }, cell: ({ row }) => fmtNum(row.original.distance_km, 'km') },
    { id: 'fuel', header: 'Fuel', accessorFn: (r) => Number(r.fuel_litres) || null, meta: { align: 'right' }, cell: ({ row }) => fmtNum(row.original.fuel_litres, 'L') },
    { id: 'cost', header: 'Fuel cost', accessorFn: (r) => Number(r.fuel_cost) || null, meta: { align: 'right' }, cell: ({ row }) => fmtMoney(row.original.fuel_cost, row.original.currency) },
    { id: 'kpl', header: 'km per L', accessorFn: (r) => fuelEconomyKmPerL(r), meta: { align: 'right' }, cell: ({ row }) => fmtRatio(fuelEconomyKmPerL(row.original)) },
    {
      id: 'gaps', header: 'Filing gaps', accessorFn: (r) => recordGaps(r).length,
      cell: ({ row }) => {
        const g = recordGaps(row.original)
        return g.length === 0
          ? <span className="text-green-400 text-xs">Complete</span>
          : <span className="text-amber-300 text-xs">Missing {g.map((x) => GAP_LABEL[x].toLowerCase()).join(', ')}</span>
      },
    },
    {
      id: 'actions', header: '', enableSorting: false, meta: { export: false },
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <button type="button" onClick={() => openEdit(row.original)} className={ICON_BTN} aria-label={`Edit record for ${row.original.asset_no || 'asset'}`}><Pencil size={15} /></button>
          <button type="button" onClick={() => setConfirmDelete(row.original)} className={`${ICON_BTN} hover:!text-red-400`} aria-label={`Delete record for ${row.original.asset_no || 'asset'}`}><Trash2 size={15} /></button>
        </div>
      ),
    },
  ], [openEdit])

  const na = (v) => (rows === null ? 'N/A' : v)
  const costTile = kpis.singleCurrencyCost
    ? { value: Math.round(kpis.singleCurrencyCost.cost).toLocaleString(), unit: kpis.singleCurrencyCost.currency, sub: 'one currency in view' }
    : { value: kpis.currencies.length ? 'Mixed' : 'N/A', unit: undefined, sub: kpis.currencies.length ? `${kpis.currencies.length} currencies, see split below` : 'no costs recorded' }

  return (
    <div className="space-y-6">
      <PageHeader
        title="IFTA Fuel Tax Reporting"
        subtitle="Jurisdiction-by-jurisdiction distance and fuel for quarterly IFTA filing: the basis for net taxable distance and tax-due settlements."
        icon={Fuel}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={doExcel} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={doPdf} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
            <button type="button" onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={notProvisioned || !!error}>
              <Plus size={14} aria-hidden="true" /> Add record
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3" role="status">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-amber-300 font-medium">IFTA fuel-tax reporting is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V173_IFTA_RECORDS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex flex-wrap items-start gap-3" role="alert">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-[200px]">
            <p className="text-red-300 font-medium">Could not load IFTA records.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">{error} Nothing below is a reading of your data until this loads.</p>
          </div>
          <button type="button" onClick={load} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]">
            <RefreshCw size={14} aria-hidden="true" /> Retry
          </button>
        </div>
      )}

      {actionError && (
        <div className="card border border-red-800/50 flex items-start gap-3" role="alert">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="flex-1 text-sm text-red-300">{actionError}</p>
          <button type="button" onClick={() => setActionError('')} className={ICON_BTN} aria-label="Dismiss message"><X size={15} /></button>
        </div>
      )}

      {/* Filters */}
      <section className="card space-y-3" aria-label="Filters">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="sm:col-span-2 lg:col-span-1">
            <label htmlFor="ifta-search" className="label">Search</label>
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
              <input id="ifta-search" className="input pl-9 w-full min-h-[44px]" placeholder="Asset, driver, jurisdiction" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          <div>
            <label htmlFor="ifta-quarter" className="label">Quarter</label>
            <select id="ifta-quarter" className="input w-full min-h-[44px]" value={quarterFilter} onChange={(e) => setQuarterFilter(e.target.value)}>
              <option value="">All quarters</option>
              {quarterOptions.map((q) => <option key={q} value={q}>{q}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="ifta-jur" className="label">Jurisdiction</label>
            <select id="ifta-jur" className="input w-full min-h-[44px]" value={jurisdictionFilter} onChange={(e) => setJurisdictionFilter(e.target.value)}>
              <option value="">All jurisdictions</option>
              {jurisdictionOptions.map((j) => <option key={j} value={j}>{j}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="ifta-country" className="label">Country</label>
            <select id="ifta-country" className="input w-full min-h-[44px]" value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)}>
              <option value="">All countries</option>
              {countryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="ifta-currency" className="label">Currency</label>
            <select id="ifta-currency" className="input w-full min-h-[44px]" value={currencyFilter} onChange={(e) => setCurrencyFilter(e.target.value)}>
              <option value="">All currencies</option>
              {currencyOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 min-h-[44px] cursor-pointer text-sm text-[var(--text-secondary)]">
            <input type="checkbox" className="h-4 w-4 accent-amber-500" checked={incompleteOnly} onChange={(e) => setIncompleteOnly(e.target.checked)} />
            Records with filing gaps only
          </label>
          {hasFilters && (
            <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]">
              <X size={14} aria-hidden="true" /> Clear filters
            </button>
          )}
          <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">
            {rows === null ? 'Not loaded' : `Figures below cover ${filtered.length.toLocaleString()} of ${all.length.toLocaleString()} records`}
          </span>
        </div>
      </section>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatTile label="Records" value={na(kpis.totalRecords.toLocaleString())} icon={Activity} sub={`${kpis.quarters} quarters`} index={0} />
        <StatTile label="Distance" value={na(Math.round(kpis.totalDistanceKm).toLocaleString())} unit="km" icon={TrendingUp} tone="info" index={1} />
        <StatTile label="Fuel" value={na(Math.round(kpis.totalFuelLitres).toLocaleString())} unit="L" icon={Droplets} index={2} />
        <StatTile label="Fleet km per L" value={na(fmtRatio(kpis.avgKmPerL))} icon={Scale} sub="IFTA fleet average" index={3} />
        <StatTile label="Fuel cost" value={na(costTile.value)} unit={costTile.unit} icon={Coins} sub={costTile.sub} index={4} />
        <StatTile label="Filing completeness" value={na(fmtPct(kpis.completeness))} icon={ListChecks} tone={kpis.gapRecords > 0 ? 'warn' : 'accent'} sub={`${kpis.gapRecords} records with gaps`} index={5} />
      </div>

      {/* Cost per currency */}
      <section className="card space-y-3" aria-labelledby="ifta-cur-title">
        <h3 id="ifta-cur-title" className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <Coins size={15} aria-hidden="true" /> Fuel cost by currency
          <span className="text-xs font-normal text-[var(--text-muted)]">never added across currencies</span>
        </h3>
        {loading ? <div className="h-10 bg-[var(--input-bg)] rounded animate-pulse" /> : kpis.currencies.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No fuel cost recorded in this selection.</p>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {kpis.currencies.map((c) => (
              <li key={c.currency} className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 p-3">
                <p className="text-xs text-[var(--text-muted)]">{c.currency === 'Unspecified' ? 'No currency recorded' : c.currency}</p>
                <p className="text-lg font-semibold tabular-nums text-[var(--text-primary)]">{fmtMoney(c.cost, c.currency === 'Unspecified' ? '' : c.currency)}</p>
                <p className="text-xs text-[var(--text-muted)]">{c.records} records, {c.costPerLitre == null ? 'N/A' : c.costPerLitre.toFixed(2)} per litre</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* By jurisdiction */}
      <section className="space-y-2" aria-labelledby="ifta-jur-title">
        <h3 id="ifta-jur-title" className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <Globe size={15} aria-hidden="true" /> Distance, fuel and net tax by jurisdiction
        </h3>
        <p className="text-xs text-[var(--text-muted)]">
          Net tax follows the IFTA method: taxable fuel = taxable distance / fleet km per L, then (taxable fuel minus fuel bought there) x rate.
          Shown in each jurisdiction&apos;s own rate units and never totalled across jurisdictions. N/A when the rate or fleet economy is not recorded.
        </p>
        <EnterpriseTable
          columns={jurisdictionColumns}
          data={jurisdictions}
          getRowId={(j) => j.jurisdiction}
          loading={loading}
          error={error || null}
          onRetry={load}
          enableGlobalFilter={false}
          enableColumnFilters={false}
          exportFileName={reportFileName('TyrePulse IFTA By Jurisdiction', reportDateLabel())}
          emptyMessage={all.length === 0 ? 'No IFTA records yet.' : 'No jurisdictions match these filters.'}
        />
      </section>

      {/* By quarter */}
      <section className="space-y-2" aria-labelledby="ifta-q-title">
        <h3 id="ifta-q-title" className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <CalendarClock size={15} aria-hidden="true" /> Filing quarters
        </h3>
        <EnterpriseTable
          columns={quarterColumns}
          data={quarters}
          getRowId={(q) => q.quarter}
          loading={loading}
          error={error || null}
          onRetry={load}
          enableGlobalFilter={false}
          enableColumnFilters={false}
          initialPageSize={10}
          pageSizeOptions={[10, 25, 50]}
          exportFileName={reportFileName('TyrePulse IFTA By Quarter', reportDateLabel())}
          emptyMessage={all.length === 0 ? 'No IFTA records yet.' : 'No quarters match these filters.'}
        />
      </section>

      {/* Records */}
      <section className="space-y-2" aria-labelledby="ifta-rec-title">
        <h3 id="ifta-rec-title" className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <Fuel size={15} aria-hidden="true" /> Trip records
        </h3>
        <EnterpriseTable
          columns={recordColumns}
          data={filtered}
          getRowId={(r) => String(r.id)}
          loading={loading}
          error={error || null}
          onRetry={load}
          enableGlobalFilter={false}
          enableColumnFilters={false}
          enableExport={false}
          viewKey="ifta-reporting"
          emptyMessage={all.length === 0 && !notProvisioned ? 'No IFTA records yet. Add the first record.' : 'No records match these filters.'}
        />
      </section>

      {/* Create / Edit */}
      <Modal
        open={showModal}
        onClose={closeModal}
        title={editing ? 'Edit IFTA record' : 'Add IFTA record'}
        size="lg"
        footer={(
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={closeModal} className="btn-secondary text-sm min-h-[44px]" disabled={saving}>Cancel</button>
            <button type="submit" form="ifta-form" className="btn-primary text-sm min-h-[44px] disabled:opacity-60" disabled={saving}>
              {saving ? 'Saving...' : editing ? 'Save changes' : 'Add record'}
            </button>
          </div>
        )}
      >
        <form id="ifta-form" onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="ifta-f-asset" className="label">Asset number *</label>
              <input id="ifta-f-asset" className="input w-full" required placeholder="e.g. TRK-1042" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />
            </div>
            <div>
              <label htmlFor="ifta-f-driver" className="label">Driver (optional)</label>
              <input id="ifta-f-driver" className="input w-full" placeholder="e.g. J. Smith" value={form.driver_name} maxLength={200} onChange={(e) => set('driver_name', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="ifta-f-jur" className="label">Jurisdiction</label>
              <input id="ifta-f-jur" className="input w-full" placeholder="e.g. TX or Ontario" value={form.jurisdiction} maxLength={120} onChange={(e) => set('jurisdiction', e.target.value)} />
            </div>
            <div>
              <label htmlFor="ifta-f-q" className="label">Quarter</label>
              <input id="ifta-f-q" className="input w-full" placeholder="e.g. 2026-Q1" value={form.quarter} maxLength={40} onChange={(e) => set('quarter', e.target.value)} />
            </div>
            <div>
              <label htmlFor="ifta-f-date" className="label">Travel date</label>
              <input id="ifta-f-date" className="input w-full" type="date" value={form.travel_date} onChange={(e) => set('travel_date', e.target.value)} />
              <p className="text-[11px] text-[var(--text-muted)] mt-1">Blank uses today.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="ifta-f-km" className="label">Distance (km)</label>
              <input id="ifta-f-km" className="input w-full" type="number" step="0.1" min="0" inputMode="decimal" placeholder="640" value={form.distance_km} onChange={(e) => set('distance_km', e.target.value)} />
            </div>
            <div>
              <label htmlFor="ifta-f-l" className="label">Fuel (litres)</label>
              <input id="ifta-f-l" className="input w-full" type="number" step="0.1" min="0" inputMode="decimal" placeholder="210" value={form.fuel_litres} onChange={(e) => set('fuel_litres', e.target.value)} />
            </div>
            <div>
              <label htmlFor="ifta-f-tkm" className="label">Taxable distance (km)</label>
              <input id="ifta-f-tkm" className="input w-full" type="number" step="0.1" min="0" inputMode="decimal" placeholder="640" value={form.taxable_km} onChange={(e) => set('taxable_km', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="ifta-f-cost" className="label">Fuel cost</label>
              <input id="ifta-f-cost" className="input w-full" type="number" step="0.01" min="0" inputMode="decimal" placeholder="315.00" value={form.fuel_cost} onChange={(e) => set('fuel_cost', e.target.value)} />
            </div>
            <div>
              <label htmlFor="ifta-f-cur" className="label">Currency</label>
              <input id="ifta-f-cur" className="input w-full" placeholder="USD, CAD or SAR" value={form.currency} maxLength={10} onChange={(e) => set('currency', e.target.value)} />
            </div>
            <div>
              <label htmlFor="ifta-f-rate" className="label">Tax rate (per litre)</label>
              <input id="ifta-f-rate" className="input w-full" type="number" step="0.0001" min="0" inputMode="decimal" placeholder="0.24" value={form.tax_rate} onChange={(e) => set('tax_rate', e.target.value)} />
            </div>
          </div>
          <div>
            <label htmlFor="ifta-f-notes" className="label">Notes (optional)</label>
            <textarea id="ifta-f-notes" className="input w-full min-h-[80px] resize-y" placeholder="e.g. interstate haul via I-35" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
          </div>
          {formError && (
            <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2" role="alert">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {formError}
            </div>
          )}
        </form>
      </Modal>

      <Modal
        open={!!confirmDelete}
        onClose={() => !deleting && setConfirmDelete(null)}
        title="Delete this record?"
        size="sm"
        footer={(
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm min-h-[44px]" disabled={deleting}>Cancel</button>
            <button type="button" onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={deleting}>
              <Trash2 size={14} aria-hidden="true" /> {deleting ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        )}
      >
        {confirmDelete && (
          <p className="text-sm text-[var(--text-muted)]">
            {confirmDelete.asset_no || 'Record'}, {confirmDelete.jurisdiction || 'N/A'}, {fmtDate(confirmDelete.travel_date)}. This cannot be undone.
          </p>
        )}
      </Modal>
    </div>
  )
}
