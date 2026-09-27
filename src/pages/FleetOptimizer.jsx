/**
 * FleetOptimizer (route /fleet-optimizer) - Fleet Optimizer. A fleet
 * right-sizing / utilisation cockpit: for every asset it models utilisation vs
 * cost (annual km, annual cost, downtime, age, resale value) and drives a
 * keep / replace / redeploy / dispose decision with a projected saving and a
 * confidence level. It contrasts the recorded decision against a deterministic
 * suggestion so managers see where the data disagrees with the call on file.
 *
 * Runs on the `fleet_optimizer_scenarios` table (V192). Real data only: KPI
 * strip, recorded-vs-suggested comparison, utilisation bands, an under-used
 * attention list, findings, a sortable register (EnterpriseTable), search +
 * filters, create/edit/delete, Excel/PDF export, and loading / empty /
 * error+Retry / not-provisioned states.
 *
 * Right-sizing logic lives in src/lib/fleetOptimizer.js; KPI, filter, band and
 * export shaping in src/lib/fleetOptimizerAnalytics.js. Savings in different
 * currencies are never added together.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  SlidersHorizontal, Layers, Repeat, ArrowRightLeft, Trash2, Wallet, Percent,
  AlertTriangle, Search, X, Sparkles, FileSpreadsheet, FileText, Plus, Pencil,
  ShieldCheck, Target, RefreshCw, Lightbulb, GitCompare, BarChart3, Loader2, Save,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Modal from '../components/ui/Modal'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { useSettings } from '../contexts/SettingsContext'
import {
  listOptimizerScenarios, createOptimizerScenario, updateOptimizerScenario,
  deleteOptimizerScenario,
} from '../lib/api/fleetOptimizer'
import { suggestRecommendation, underutilised, costPerKm } from '../lib/fleetOptimizer'
import {
  REC_KEYS, CONFIDENCE_KEYS, UTIL_BANDS, recLabel, filterScenarios, enrichScenarios,
  buildOptimizerKpis, buildOptimizerInsights, recommendationMatrix, utilisationBands,
  optimizerExportRows, OPTIMIZER_EXPORT_COLUMNS,
} from '../lib/fleetOptimizerAnalytics'
import { compareValues } from '../lib/consoleTable'
import { colorAt } from '../lib/reportColors'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation } from '../lib/api/_client'

const EMPTY_FORM = {
  scenario_name: '', asset_no: '', asset_type: '', utilization_pct: '',
  annual_km: '', annual_cost: '', downtime_days: '', age_years: '',
  resale_value: '', currency: 'SAR', recommendation: '', projected_saving: '',
  confidence: '', rationale: '', notes: '',
}

// Semantic decision colours; every badge also carries its label and an icon.
const REC_META = {
  keep:     { cls: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/40', icon: ShieldCheck },
  replace:  { cls: 'bg-red-500/15 text-red-500 border-red-500/40', icon: Repeat },
  redeploy: { cls: 'bg-sky-500/15 text-sky-500 border-sky-500/40', icon: ArrowRightLeft },
  dispose:  { cls: 'bg-amber-500/15 text-amber-500 border-amber-500/40', icon: Trash2 },
  review:   { cls: 'bg-[var(--input-bg)] text-[var(--text-secondary)] border-[var(--input-border)]', icon: Target },
}
const CONF_CLS = {
  high: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/40',
  medium: 'bg-amber-500/15 text-amber-500 border-amber-500/40',
  low: 'bg-[var(--input-bg)] text-[var(--text-secondary)] border-[var(--input-border)]',
}

const ICON_BTN = 'inline-flex items-center justify-center h-11 w-11 sm:h-9 sm:w-9 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--input-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]'
const valueSort = (a, b, id) => compareValues(a.getValue(id), b.getValue(id))
const blank = (v) => (v === null || v === undefined || v === '' ? undefined : v)
const fmtNum = (v) => (v == null ? 'N/A' : Number(v).toLocaleString())
const fmtPct = (v) => (v == null ? 'N/A' : `${Math.round(Number(v) * 10) / 10}%`)
const fmtMoney = (v, cur) => (v == null ? 'N/A' : `${cur ? `${cur} ` : ''}${Math.round(Number(v)).toLocaleString()}`)
const fmtCpk = (v, cur) => (v == null ? 'N/A' : `${cur ? `${cur} ` : ''}${v.toFixed(2)}`)

function RecBadge({ value }) {
  const m = REC_META[value]
  if (!m) return <span className="text-[var(--text-muted)]">N/A</span>
  const Icon = m.icon
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${m.cls}`}>
      <Icon size={11} aria-hidden="true" /> {recLabel(value)}
    </span>
  )
}
function ConfBadge({ value }) {
  if (!value) return <span className="text-[var(--text-muted)]">N/A</span>
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold border capitalize ${CONF_CLS[value] || CONF_CLS.low}`}>{value}</span>
}
function Kpi({ label, value, sub, icon: Icon, tone }) {
  return (
    <div className="card min-w-0">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--text-muted)] truncate">{label}</p>
        <Icon size={16} className={tone} aria-hidden="true" />
      </div>
      <p className={`text-2xl font-bold mt-1 tabular-nums break-words ${tone}`}>{value}</p>
      {sub && <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{sub}</p>}
    </div>
  )
}

export default function FleetOptimizer() {
  const { activeCountry, activeCurrency } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [recFilter, setRecFilter] = useState('')
  const [confFilter, setConfFilter] = useState('')
  const [countryFilter, setCountryFilter] = useState('')
  const [bandFilter, setBandFilter] = useState('')
  const [mismatchOnly, setMismatchOnly] = useState(false)
  const [search, setSearch] = useState('')

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleteError, setDeleteError] = useState('')
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setNotProvisioned(false)
    try {
      const data = await listOptimizerScenarios({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) { setNotProvisioned(true); setRows([]) }
      else setError(toUserMessage(err, 'Could not load optimizer scenarios.'))
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const all = useMemo(() => rows || [], [rows])
  const loading = rows === null && !error
  const failedEmpty = rows === null && !!error

  // The currency a row without its own currency is reported in.
  const primaryCurrency = useMemo(
    () => all.find((r) => r.currency)?.currency || activeCurrency || 'SAR',
    [all, activeCurrency],
  )

  const kpi = useMemo(() => buildOptimizerKpis(all, primaryCurrency), [all, primaryCurrency])
  const insights = useMemo(() => buildOptimizerInsights(all, primaryCurrency), [all, primaryCurrency])
  const matrix = useMemo(() => recommendationMatrix(all), [all])
  const bands = useMemo(() => utilisationBands(all), [all])
  const idle = useMemo(() => underutilised(all), [all])

  const countryOptions = useMemo(
    () => [...new Set(all.map((r) => r.country).filter(Boolean))].sort(),
    [all],
  )

  const filtered = useMemo(() => filterScenarios(all, {
    rec: recFilter, confidence: confFilter, country: countryFilter, band: bandFilter, mismatchOnly, search,
  }), [all, recFilter, confFilter, countryFilter, bandFilter, mismatchOnly, search])
  const register = useMemo(() => enrichScenarios(filtered, primaryCurrency), [filtered, primaryCurrency])

  const savingValue = kpi.saving.total != null ? fmtMoney(kpi.saving.total, kpi.saving.currency) : 'N/A'
  const savingSub = kpi.saving.mixed
    ? kpi.saving.totals.map((t) => fmtMoney(t.total, t.currency)).join(' + ')
    : kpi.saving.counted ? `${kpi.saving.counted} scenario(s) costed` : 'No saving recorded'

  const kpis = [
    { label: 'Assets modelled', value: kpi.total.toLocaleString(), icon: Layers, tone: 'text-[var(--text-primary)]' },
    { label: 'Replace', value: kpi.counts.replace, icon: Repeat, tone: 'text-red-500' },
    { label: 'Dispose', value: kpi.counts.dispose, icon: Trash2, tone: 'text-amber-500' },
    { label: 'Redeploy', value: kpi.counts.redeploy, icon: ArrowRightLeft, tone: 'text-sky-500' },
    { label: 'Keep', value: kpi.counts.keep, icon: ShieldCheck, tone: 'text-emerald-500' },
    { label: 'Projected saving', value: savingValue, sub: savingSub, icon: Wallet, tone: 'text-emerald-500' },
    { label: 'Avg utilisation', value: fmtPct(kpi.avgUtilization), sub: kpi.utilCoverage != null && kpi.utilCoverage < 1 ? `${Math.round(kpi.utilCoverage * 100)}% report utilisation` : null, icon: Percent, tone: 'text-violet-500' },
    { label: 'Disagree with model', value: kpi.mismatches, sub: 'Recorded vs suggested', icon: Sparkles, tone: kpi.mismatches ? 'text-violet-500' : 'text-[var(--text-primary)]' },
  ]

  const exportRows = useMemo(() => optimizerExportRows(filtered, primaryCurrency), [filtered, primaryCurrency])
  const scopeLabel = activeCountry && activeCountry !== 'All' ? activeCountry : 'All countries'
  const doExcel = async () => {
    setActionError('')
    try {
      await exportToExcel(exportRows, OPTIMIZER_EXPORT_COLUMNS.map((c) => c.key), OPTIMIZER_EXPORT_COLUMNS.map((c) => c.header), reportFileName('Fleet Optimizer', scopeLabel))
    } catch (e) { setActionError(toUserMessage(e, 'Could not export. Try again.')) }
  }
  const doPdf = async () => {
    setActionError('')
    try {
      await exportToPdf(exportRows, OPTIMIZER_EXPORT_COLUMNS, `Fleet Optimizer (${scopeLabel})`, reportFileName('Fleet Optimizer', scopeLabel), 'landscape')
    } catch (e) { setActionError(toUserMessage(e, 'Could not export. Try again.')) }
  }

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null); setForm({ ...EMPTY_FORM, currency: primaryCurrency }); setFormError(''); setShowModal(true)
  }
  const openEdit = useCallback((r) => {
    setEditing(r)
    setForm({
      scenario_name: r.scenario_name || '', asset_no: r.asset_no || '',
      asset_type: r.asset_type || '', utilization_pct: r.utilization_pct ?? '',
      annual_km: r.annual_km ?? '', annual_cost: r.annual_cost ?? '',
      downtime_days: r.downtime_days ?? '', age_years: r.age_years ?? '',
      resale_value: r.resale_value ?? '', currency: r.currency || 'SAR',
      recommendation: r.recommendation || '', projected_saving: r.projected_saving ?? '',
      confidence: r.confidence || '', rationale: r.rationale || '', notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }, [])
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  // Live suggestion echoed in the modal so the recorded call can be checked
  // against the data as the user types.
  const liveSuggestion = useMemo(() => suggestRecommendation({
    utilization_pct: form.utilization_pct, age_years: form.age_years, downtime_days: form.downtime_days,
  }), [form.utilization_pct, form.age_years, form.downtime_days])

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.asset_no.trim()) { setFormError('An asset number is required.'); return }
    setSaving(true)
    try {
      const payload = {
        ...form,
        country: activeCountry !== 'All' ? activeCountry : null,
      }
      if (editing) await updateOptimizerScenario(editing.id, payload)
      else await createOptimizerScenario(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the scenario.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const closeDelete = () => { if (!deleting) { setConfirmDelete(null); setDeleteError('') } }
  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true); setDeleteError('')
    try {
      await deleteOptimizerScenario(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setDeleteError(toUserMessage(err, 'Could not delete the scenario.'))
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => { setRecFilter(''); setConfFilter(''); setCountryFilter(''); setBandFilter(''); setMismatchOnly(false); setSearch('') }
  const hasFilters = recFilter || confFilter || countryFilter || bandFilter || mismatchOnly || search

  const columns = useMemo(() => [
    {
      id: 'asset', header: 'Asset', accessorFn: (r) => blank(r.asset_no), sortingFn: valueSort, sortUndefined: 'last', size: 180,
      cell: ({ row }) => {
        const r = row.original
        return (
          <div className="min-w-0">
            <p className="font-medium text-[var(--text-primary)] truncate">{r.asset_no || 'N/A'}</p>
            {(r.asset_type || r.scenario_name) && <p className="text-[11px] text-[var(--text-muted)] truncate">{[r.asset_type, r.scenario_name].filter(Boolean).join(' | ')}</p>}
          </div>
        )
      },
    },
    { id: 'util', header: 'Utilisation', accessorFn: (r) => r.util ?? undefined, sortingFn: valueSort, sortUndefined: 'last', size: 110, meta: { align: 'right' }, cell: ({ row }) => <span className={`tabular-nums font-semibold ${row.original.util != null && row.original.util < 40 ? 'text-amber-500' : 'text-[var(--text-primary)]'}`}>{fmtPct(row.original.util)}</span> },
    { id: 'km', header: 'Annual km', accessorFn: (r) => r.km ?? undefined, sortingFn: valueSort, sortUndefined: 'last', size: 110, meta: { align: 'right' }, cell: ({ row }) => <span className="tabular-nums">{fmtNum(row.original.km)}</span> },
    { id: 'cost', header: 'Annual cost', accessorFn: (r) => r.cost ?? undefined, sortingFn: valueSort, sortUndefined: 'last', size: 130, meta: { align: 'right' }, cell: ({ row }) => <span className="tabular-nums whitespace-nowrap">{fmtMoney(row.original.cost, row.original.cur)}</span> },
    { id: 'cpk', header: 'Cost/km', accessorFn: (r) => r.cpk ?? undefined, sortingFn: valueSort, sortUndefined: 'last', size: 110, meta: { align: 'right' }, cell: ({ row }) => <span className="tabular-nums whitespace-nowrap">{fmtCpk(row.original.cpk, row.original.cur)}</span> },
    { id: 'age', header: 'Age', accessorFn: (r) => r.age ?? undefined, sortingFn: valueSort, sortUndefined: 'last', size: 80, meta: { align: 'right' }, cell: ({ row }) => <span className="tabular-nums">{row.original.age == null ? 'N/A' : `${row.original.age} yr`}</span> },
    { id: 'downtime', header: 'Downtime', accessorFn: (r) => r.downtime ?? undefined, sortingFn: valueSort, sortUndefined: 'last', size: 100, meta: { align: 'right' }, cell: ({ row }) => <span className="tabular-nums">{row.original.downtime == null ? 'N/A' : `${row.original.downtime} d`}</span> },
    { id: 'rec', header: 'Recommendation', accessorFn: (r) => (r.recommendation ? recLabel(r.recommendation) : undefined), sortingFn: valueSort, sortUndefined: 'last', size: 140, cell: ({ row }) => <RecBadge value={row.original.recommendation} /> },
    {
      id: 'suggested', header: 'Suggested', accessorFn: (r) => recLabel(r.suggested), sortingFn: valueSort, size: 150,
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-1">
          {row.original.mismatch && <Sparkles size={11} className="text-violet-500" aria-label="Differs from recorded decision" />}
          <RecBadge value={row.original.suggested} />
        </span>
      ),
    },
    { id: 'saving', header: 'Saving', accessorFn: (r) => r.saving ?? undefined, sortingFn: valueSort, sortUndefined: 'last', size: 130, meta: { align: 'right' }, cell: ({ row }) => <span className="tabular-nums font-semibold whitespace-nowrap text-emerald-500">{fmtMoney(row.original.saving, row.original.cur)}</span> },
    { id: 'confidence', header: 'Confidence', accessorFn: (r) => blank(r.confidence), sortingFn: valueSort, sortUndefined: 'last', size: 110, cell: ({ row }) => <ConfBadge value={row.original.confidence} /> },
    {
      id: 'actions', header: '', enableSorting: false, size: 100, meta: { export: false },
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <button type="button" onClick={() => openEdit(row.original)} className={ICON_BTN} aria-label={`Edit scenario for ${row.original.asset_no}`}><Pencil size={14} /></button>
          <button type="button" onClick={() => { setDeleteError(''); setConfirmDelete(row.original) }} className={`${ICON_BTN} hover:text-red-500`} aria-label={`Delete scenario for ${row.original.asset_no}`}><Trash2 size={14} /></button>
        </div>
      ),
    },
  ], [openEdit])

  const matrixMax = Math.max(1, ...matrix.flatMap((m) => [m.recorded, m.suggested]))
  const bandMax = Math.max(1, ...bands.bands.map((b) => b.count), bands.unknown)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fleet Optimizer"
        subtitle="Right-size the fleet: model utilisation vs cost per asset and drive keep, replace, redeploy or dispose decisions with a projected saving."
        icon={SlidersHorizontal}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={doExcel} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-0" disabled={!filtered.length}>
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={doPdf} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-0" disabled={!filtered.length}>
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
            <button type="button" onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-0" disabled={notProvisioned}>
              <Plus size={14} aria-hidden="true" /> New scenario
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-500/40 flex items-start gap-3" role="status">
          <AlertTriangle size={18} className="text-amber-500 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-[var(--text-primary)] font-medium">Fleet Optimizer is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V192_FLEET_OPTIMIZER_SCENARIOS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-500/40 flex flex-wrap items-start gap-3" role="alert">
          <AlertTriangle size={18} className="text-red-500 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="text-[var(--text-primary)] font-medium">Could not load optimizer scenarios.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">{error}</p>
          </div>
          <button type="button" onClick={load} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-0"><RefreshCw size={14} aria-hidden="true" /> Retry</button>
        </div>
      )}

      {actionError && (
        <div className="card border border-red-500/40 flex items-start gap-3" role="alert">
          <AlertTriangle size={18} className="text-red-500 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="text-sm text-[var(--text-secondary)] flex-1">{actionError}</p>
          <button type="button" onClick={() => setActionError('')} className={ICON_BTN} aria-label="Dismiss message"><X size={14} /></button>
        </div>
      )}

      <section aria-label="Optimizer figures">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {kpis.map((k) => <Kpi key={k.label} {...k} value={rows === null ? 'N/A' : k.value} sub={rows === null ? null : k.sub} />)}
        </div>
        <p className="text-[11px] text-[var(--text-muted)] mt-2">Figures cover all {kpi.total.toLocaleString()} scenario(s) in {scopeLabel}. Filters below narrow the register only.</p>
      </section>

      {!loading && insights.length > 0 && (
        <div className="card">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-2 flex items-center gap-2"><Lightbulb size={15} className="text-amber-500" aria-hidden="true" /> Findings</h2>
          <ul className="space-y-1.5">
            {insights.map((s) => (
              <li key={s} className="text-sm text-[var(--text-secondary)] flex items-start gap-2">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" aria-hidden="true" /> {s}
              </li>
            ))}
          </ul>
          {kpi.mismatches > 0 && (
            <button type="button" onClick={() => setMismatchOnly(true)} className="btn-secondary text-sm mt-3 inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-0">
              <Sparkles size={14} aria-hidden="true" /> Show the {kpi.mismatches} disagreement(s)
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Recorded vs suggested */}
        <div className="card min-w-0">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-1 flex items-center gap-2"><GitCompare size={15} aria-hidden="true" /> Recorded vs suggested</h2>
          <div className="flex items-center gap-3 text-[11px] text-[var(--text-muted)] mb-3">
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: colorAt(0) }} aria-hidden="true" /> Recorded</span>
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: colorAt(3) }} aria-hidden="true" /> Suggested by model</span>
          </div>
          {loading ? <div className="h-32 bg-[var(--input-bg)] rounded animate-pulse" /> : kpi.total === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No scenarios modelled yet.</p>
          ) : (
            <ul className="space-y-2.5">
              {matrix.map((m) => (
                <li key={m.key}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <button type="button" onClick={() => setRecFilter(m.key)} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:underline" aria-label={`Filter register to recorded ${m.label}`}>{m.label}</button>
                    <span className="tabular-nums text-[var(--text-muted)]">{m.recorded} recorded | {m.suggested} suggested</span>
                  </div>
                  <div className="space-y-1" aria-hidden="true">
                    <div className="h-1.5 rounded-full bg-[var(--input-bg)] overflow-hidden"><div className="h-full rounded-full" style={{ width: `${(m.recorded / matrixMax) * 100}%`, background: colorAt(0) }} /></div>
                    <div className="h-1.5 rounded-full bg-[var(--input-bg)] overflow-hidden"><div className="h-full rounded-full" style={{ width: `${(m.suggested / matrixMax) * 100}%`, background: colorAt(3) }} /></div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Utilisation bands */}
        <div className="card min-w-0">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2"><BarChart3 size={15} aria-hidden="true" /> Utilisation bands</h2>
          {loading ? <div className="h-32 bg-[var(--input-bg)] rounded animate-pulse" /> : kpi.total === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No scenarios modelled yet.</p>
          ) : (
            <ul className="space-y-2.5">
              {[...bands.bands, { key: 'unknown', label: 'Not recorded', count: bands.unknown }].map((b, i) => (
                <li key={b.key}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <button type="button" onClick={() => setBandFilter(b.key)} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:underline" aria-label={`Filter register to utilisation ${b.label}`}>{b.label}</button>
                    <span className="tabular-nums font-semibold text-[var(--text-primary)]">{b.count}</span>
                  </div>
                  <div className="h-2 rounded-full bg-[var(--input-bg)] overflow-hidden" aria-hidden="true">
                    <div className="h-full rounded-full" style={{ width: `${(b.count / bandMax) * 100}%`, background: b.key === 'unknown' ? 'var(--text-muted)' : colorAt(i) }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Under-used attention list */}
        <div className="card min-w-0">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
            <AlertTriangle size={15} className="text-amber-500" aria-hidden="true" /> Under-utilised assets ({rows === null ? 'N/A' : idle.length})
          </h2>
          {loading ? <div className="h-32 bg-[var(--input-bg)] rounded animate-pulse" /> : idle.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">{kpi.total === 0 ? 'No scenarios modelled yet.' : kpi.avgUtilization == null ? 'No scenario records utilisation yet.' : 'No assets below 40% utilisation.'}</p>
          ) : (
            <ul className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
              {idle.slice(0, 20).map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => openEdit(r)} className="w-full text-left flex items-center justify-between rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 px-3 py-2 min-h-[44px] hover:bg-[var(--input-bg)]">
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-[var(--text-primary)] truncate">{r.asset_no}{r.asset_type ? <span className="text-[var(--text-muted)] font-normal"> | {r.asset_type}</span> : null}</span>
                      <span className="block text-[11px] text-[var(--text-muted)]">Suggests <span className="font-semibold">{recLabel(suggestRecommendation(r))}</span> | {fmtCpk(costPerKm(r), r.currency || primaryCurrency)}/km</span>
                    </span>
                    <span className="text-sm font-bold text-amber-500 shrink-0 ml-2 tabular-nums">{fmtPct(r.utilization_pct)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {idle.length > 0 && <button type="button" onClick={() => setBandFilter('idle')} className="text-xs text-[var(--text-secondary)] hover:underline mt-2 min-h-[44px] sm:min-h-0">Show all in the register</button>}
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="flex flex-wrap items-end gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <label htmlFor="fo-search" className="sr-only">Search scenarios</label>
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
            <input id="fo-search" className="input pl-9 w-full" placeholder="Search asset, type, scenario, rationale..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input w-full sm:w-auto" value={recFilter} onChange={(e) => setRecFilter(e.target.value)} aria-label="Recommendation">
            <option value="">All recommendations</option>
            {REC_KEYS.map((r) => <option key={r} value={r}>{recLabel(r)}</option>)}
          </select>
          <select className="input w-full sm:w-auto" value={confFilter} onChange={(e) => setConfFilter(e.target.value)} aria-label="Confidence">
            <option value="">All confidence</option>
            {CONFIDENCE_KEYS.map((c) => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
          </select>
          <select className="input w-full sm:w-auto" value={bandFilter} onChange={(e) => setBandFilter(e.target.value)} aria-label="Utilisation band">
            <option value="">All utilisation</option>
            {UTIL_BANDS.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
            <option value="unknown">Not recorded</option>
          </select>
          {countryOptions.length > 0 && (
            <select className="input w-full sm:w-auto" value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)} aria-label="Country">
              <option value="">All countries</option>
              {countryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] min-h-[44px] cursor-pointer">
            <input type="checkbox" className="h-4 w-4" checked={mismatchOnly} onChange={(e) => setMismatchOnly(e.target.checked)} />
            Disagreements only
          </label>
          {hasFilters && <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-0"><X size={14} aria-hidden="true" /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">{filtered.length} of {kpi.total}</span>
        </div>
      </div>

      <EnterpriseTable
        columns={columns}
        data={register}
        getRowId={(r) => String(r.id)}
        loading={loading}
        error={failedEmpty ? error : null}
        onRetry={load}
        enableGlobalFilter={false}
        enableColumnFilters={false}
        enableExport={false}
        viewKey="fleet-optimizer"
        initialPageSize={25}
        emptyMessage={all.length === 0 && !notProvisioned ? 'No scenarios modelled yet. Create your first optimizer scenario.' : notProvisioned ? 'Fleet Optimizer is not enabled yet.' : 'No scenarios match these filters.'}
      />

      {showModal && (
        <Modal open onClose={closeModal} size="lg" title={editing ? 'Edit scenario' : 'New optimizer scenario'}>
          <form onSubmit={submit} className="space-y-4" noValidate>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label" htmlFor="fo-asset">Asset number *</label>
                <input id="fo-asset" className="input w-full" placeholder="e.g. TRK-1042" value={form.asset_no} maxLength={120} required onChange={(e) => set('asset_no', e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="fo-type">Asset type (optional)</label>
                <input id="fo-type" className="input w-full" placeholder="e.g. Tri-mixer" value={form.asset_type} maxLength={120} onChange={(e) => set('asset_type', e.target.value)} />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="fo-name">Scenario name (optional)</label>
              <input id="fo-name" className="input w-full" placeholder="e.g. 2026 right-sizing review" value={form.scenario_name} maxLength={200} onChange={(e) => set('scenario_name', e.target.value)} />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {[
                ['utilization_pct', 'Utilisation %', '0.1', '65'],
                ['annual_km', 'Annual km', '1', '60000'],
                ['annual_cost', 'Annual cost', '1', '42000'],
                ['downtime_days', 'Downtime days', '1', '12'],
                ['age_years', 'Age (years)', '0.1', '6'],
                ['resale_value', 'Resale value', '1', '35000'],
              ].map(([k, label, step, ph]) => (
                <div key={k}>
                  <label className="label" htmlFor={`fo-${k}`}>{label}</label>
                  <input id={`fo-${k}`} className="input w-full" type="number" step={step} min="0" inputMode="decimal" placeholder={ph} value={form[k]} onChange={(e) => set(k, e.target.value)} />
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="label" htmlFor="fo-rec">Recommendation</label>
                <select id="fo-rec" className="input w-full" value={form.recommendation} onChange={(e) => set('recommendation', e.target.value)}>
                  <option value="">Select</option>
                  {REC_KEYS.map((r) => <option key={r} value={r}>{recLabel(r)}</option>)}
                </select>
                <p className="text-[11px] text-[var(--text-muted)] mt-1 flex items-center gap-1" aria-live="polite">
                  <Sparkles size={11} className="text-violet-500" aria-hidden="true" /> Model suggests <span className="font-semibold text-[var(--text-primary)]">{recLabel(liveSuggestion)}</span>
                </p>
              </div>
              <div>
                <label className="label" htmlFor="fo-saving">Projected saving</label>
                <input id="fo-saving" className="input w-full" type="number" step="1" inputMode="decimal" placeholder="8000" value={form.projected_saving} onChange={(e) => set('projected_saving', e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="fo-conf">Confidence</label>
                <select id="fo-conf" className="input w-full" value={form.confidence} onChange={(e) => set('confidence', e.target.value)}>
                  <option value="">Select</option>
                  {CONFIDENCE_KEYS.map((c) => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div>
                <label className="label" htmlFor="fo-cur">Currency</label>
                <input id="fo-cur" className="input w-full" placeholder="SAR" value={form.currency} maxLength={12} onChange={(e) => set('currency', e.target.value)} />
              </div>
              <div className="sm:col-span-3">
                <label className="label" htmlFor="fo-rationale">Rationale (optional)</label>
                <input id="fo-rationale" className="input w-full" placeholder="e.g. idle 8 months, high downtime, low resale" value={form.rationale} maxLength={8000} onChange={(e) => set('rationale', e.target.value)} />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="fo-notes">Notes (optional)</label>
              <textarea id="fo-notes" className="input w-full min-h-[70px] resize-y" placeholder="e.g. redeploy to northern depot pending contract" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
            </div>

            {formError && (
              <div role="alert" className="flex items-start gap-2 text-sm text-red-500 bg-red-500/10 border border-red-500/40 rounded-lg px-3 py-2">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {formError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button type="button" onClick={closeModal} className="btn-secondary text-sm min-h-[44px] sm:min-h-0" disabled={saving}>Cancel</button>
              <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60 min-h-[44px] sm:min-h-0" disabled={saving}>
                {saving ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Save size={15} aria-hidden="true" />}
                {saving ? 'Saving...' : editing ? 'Save changes' : 'Create scenario'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {confirmDelete && (
        <Modal
          open
          onClose={closeDelete}
          size="sm"
          title="Delete this scenario?"
          footer={
            <>
              <button type="button" onClick={closeDelete} className="btn-secondary text-sm" disabled={deleting}>Cancel</button>
              <button type="button" onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={deleting}>
                {deleting ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Trash2 size={14} aria-hidden="true" />} {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </>
          }
        >
          <p className="text-sm text-[var(--text-secondary)]">
            <span className="font-medium text-[var(--text-primary)]">{confirmDelete.asset_no || 'Scenario'}</span>{confirmDelete.recommendation ? ` (${recLabel(confirmDelete.recommendation)})` : ''}. This cannot be undone.
          </p>
          {deleteError && (
            <p role="alert" className="flex items-start gap-2 text-sm text-red-500 mt-3">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {deleteError}
            </p>
          )}
        </Modal>
      )}
    </div>
  )
}
