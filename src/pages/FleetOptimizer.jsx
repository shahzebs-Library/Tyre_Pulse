/**
 * FleetOptimizer (route /fleet-optimizer) — Fleet Optimizer. A fleet
 * right-sizing / utilisation cockpit: for every asset it models utilisation vs
 * cost (annual km, annual cost, downtime, age, resale value) and drives a
 * keep / replace / redeploy / dispose decision with a projected saving and a
 * confidence level. It contrasts the recorded decision against a deterministic
 * suggestion so managers see where the data disagrees with the call on file.
 *
 * Runs on the new `fleet_optimizer_scenarios` table (V192). Real data, KPI
 * tiles, a recommendation breakdown, an under-utilisation attention list,
 * suggested-vs-recorded hints, create/edit modal, filters, search, delete
 * confirm, Excel/PDF export, and loading/empty/error/not-provisioned states
 * throughout. Portfolio roll-ups and the right-sizing logic live in the pure
 * `src/lib/fleetOptimizer.js` helpers.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  SlidersHorizontal, Layers, Repeat, ArrowRightLeft, Trash2, Wallet,
  TrendingDown, Percent, AlertTriangle, Search, X, Filter, Sparkles,
  FileSpreadsheet, FileText, Plus, Pencil, ShieldCheck, Target,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listOptimizerScenarios, createOptimizerScenario, updateOptimizerScenario,
  deleteOptimizerScenario,
} from '../lib/api/fleetOptimizer'
import {
  summariseOptimizer, byRecommendation, underutilised, costPerKm,
  suggestRecommendation,
} from '../lib/fleetOptimizer'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'

const EMPTY_FORM = {
  scenario_name: '', asset_no: '', asset_type: '', utilization_pct: '',
  annual_km: '', annual_cost: '', downtime_days: '', age_years: '',
  resale_value: '', currency: 'SAR', recommendation: '', projected_saving: '',
  confidence: '', rationale: '', notes: '',
}

const REC_META = {
  keep:     { label: 'Keep',     cls: 'bg-emerald-900/30 text-emerald-300 border-emerald-800/50', icon: ShieldCheck },
  replace:  { label: 'Replace',  cls: 'bg-red-900/30 text-red-300 border-red-800/50',             icon: Repeat },
  redeploy: { label: 'Redeploy', cls: 'bg-sky-900/30 text-sky-300 border-sky-800/50',             icon: ArrowRightLeft },
  dispose:  { label: 'Dispose',  cls: 'bg-amber-900/30 text-amber-300 border-amber-800/50',       icon: Trash2 },
  review:   { label: 'Review',   cls: 'bg-slate-800/60 text-slate-300 border-slate-700/60',       icon: Target },
}
const CONF_META = {
  high:   'bg-emerald-900/30 text-emerald-300 border-emerald-800/50',
  medium: 'bg-amber-900/30 text-amber-300 border-amber-800/50',
  low:    'bg-slate-800/60 text-slate-300 border-slate-700/60',
}
const REC_FILTERS = ['keep', 'replace', 'redeploy', 'dispose', 'review']
const CONF_FILTERS = ['high', 'medium', 'low']

const fmtNum = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString())
const fmtPct = (v) => (v == null || v === '' ? '—' : `${Number(v).toLocaleString()}%`)
const fmtMoney = (v, cur = 'SAR') =>
  v == null || v === '' ? '—' : `${cur} ${Math.round(Number(v)).toLocaleString()}`
const fmtCpk = (v, cur = 'SAR') => (v == null ? '—' : `${cur} ${v.toFixed(2)}`)

function RecBadge({ value }) {
  const m = REC_META[value]
  if (!m) return <span className="text-[var(--text-muted)]">—</span>
  const Icon = m.icon
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${m.cls}`}>
      <Icon size={11} /> {m.label}
    </span>
  )
}
function ConfBadge({ value }) {
  if (!value) return <span className="text-[var(--text-muted)]">—</span>
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold border capitalize ${CONF_META[value] || CONF_META.low}`}>
      {value}
    </span>
  )
}

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') ||
    m.includes('schema cache') || m.includes('could not find the table')
}

export default function FleetOptimizer() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [recFilter, setRecFilter] = useState('')
  const [confFilter, setConfFilter] = useState('')
  const [countryFilter, setCountryFilter] = useState('')
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
      const data = await listOptimizerScenarios({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(toUserMessage(err, 'Could not load optimizer scenarios.'))
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summariseOptimizer(rows || []), [rows])
  const breakdown = useMemo(() => byRecommendation(rows || []), [rows])
  const idle = useMemo(() => underutilised(rows || []), [rows])

  // Scenarios where the recorded recommendation disagrees with the suggested
  // one — the highest-signal review queue for managers.
  const mismatches = useMemo(
    () => (rows || []).filter((r) => r.recommendation && suggestRecommendation(r) !== r.recommendation),
    [rows],
  )

  const primaryCurrency = useMemo(() => {
    const c = (rows || []).find((r) => r.currency)?.currency
    return c || 'SAR'
  }, [rows])

  const countryOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.country).filter(Boolean))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (recFilter && r.recommendation !== recFilter) return false
      if (confFilter && r.confidence !== confFilter) return false
      if (countryFilter && r.country !== countryFilter) return false
      if (q) {
        const hay = `${r.asset_no || ''} ${r.scenario_name || ''} ${r.asset_type || ''} ${r.rationale || ''} ${r.notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, recFilter, confFilter, countryFilter, search])

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const kpis = [
    { label: 'Assets modelled', value: summary.totalAssets, icon: Layers, tone: 'text-[var(--text-primary)]' },
    { label: 'Replace', value: summary.replaceCount, icon: Repeat, tone: 'text-red-400' },
    { label: 'Dispose', value: summary.disposeCount, icon: Trash2, tone: 'text-amber-400' },
    { label: 'Redeploy', value: summary.redeployCount, icon: ArrowRightLeft, tone: 'text-sky-400' },
    { label: 'Keep', value: summary.keepCount, icon: ShieldCheck, tone: 'text-emerald-400' },
    { label: 'Projected saving', value: fmtMoney(summary.totalProjectedSaving, primaryCurrency), icon: Wallet, tone: 'text-green-400' },
    { label: 'Avg utilisation', value: `${Math.round(summary.avgUtilization)}%`, icon: Percent, tone: 'text-violet-400' },
  ]

  // ── Export ───────────────────────────────────────────────────────────────
  const EXPORT_COLS = ['asset_no', 'asset_type', 'utilization_pct', 'annual_km', 'annual_cost', 'cost_per_km', 'downtime_days', 'age_years', 'resale_value', 'recommendation', 'suggested', 'projected_saving', 'confidence', 'currency', 'scenario_name']
  const EXPORT_HEADERS = ['Asset', 'Type', 'Utilisation %', 'Annual km', 'Annual cost', 'Cost/km', 'Downtime days', 'Age (yrs)', 'Resale value', 'Recommendation', 'Suggested', 'Projected saving', 'Confidence', 'Currency', 'Scenario']
  const exportRows = filtered.map((r) => {
    const cpk = costPerKm(r)
    return {
      asset_no: r.asset_no || '',
      asset_type: r.asset_type || '',
      utilization_pct: r.utilization_pct ?? '',
      annual_km: r.annual_km ?? '',
      annual_cost: r.annual_cost ?? '',
      cost_per_km: cpk == null ? '' : Math.round(cpk * 100) / 100,
      downtime_days: r.downtime_days ?? '',
      age_years: r.age_years ?? '',
      resale_value: r.resale_value ?? '',
      recommendation: r.recommendation || '',
      suggested: suggestRecommendation(r),
      projected_saving: r.projected_saving ?? '',
      confidence: r.confidence || '',
      currency: r.currency || '',
      scenario_name: r.scenario_name || '',
    }
  })

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null); setForm({ ...EMPTY_FORM, currency: primaryCurrency }); setFormError(''); setShowModal(true)
  }
  const openEdit = (r) => {
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
  }
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

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteOptimizerScenario(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setError(toUserMessage(err, 'Could not delete the scenario.'))
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => { setRecFilter(''); setConfFilter(''); setCountryFilter(''); setSearch('') }
  const hasFilters = recFilter || confFilter || countryFilter || search

  const maxBreakdownSaving = Math.max(1, ...breakdown.map((b) => Math.abs(b.saving)))

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
          <div className="flex items-center gap-2">
            <button onClick={async () => { try { await exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'fleet_optimizer') } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) } }} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={async () => { try { await exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Fleet Optimizer', 'fleet_optimizer', 'landscape') } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) } }} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={notProvisioned}>
              <Plus size={14} /> New scenario
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Fleet Optimizer isn’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V192_FLEET_OPTIMIZER_SCENARIOS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load optimizer scenarios.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
        </div>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon
          return (
            <div key={k.label} className="card">
              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                <Icon size={16} className={k.tone} />
              </div>
              <p className={`text-2xl font-bold mt-1 ${k.tone}`}>{rows === null ? '—' : k.value}</p>
            </div>
          )
        })}
      </div>

      {/* Recommendation breakdown + under-utilised attention list */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
            <TrendingDown size={15} /> Recommendation breakdown
          </h3>
          {rows === null ? (
            <div className="h-24 bg-[var(--input-bg)] rounded animate-pulse" />
          ) : breakdown.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No scenarios modelled yet.</p>
          ) : (
            <div className="space-y-2.5">
              {breakdown.map((b) => {
                const m = REC_META[b.recommendation] || REC_META.review
                const w = Math.max(3, Math.round((Math.abs(b.saving) / maxBreakdownSaving) * 100))
                return (
                  <div key={b.recommendation}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="flex items-center gap-2"><RecBadge value={b.recommendation} /><span className="text-[var(--text-muted)]">{b.count} asset{b.count === 1 ? '' : 's'}</span></span>
                      <span className="font-semibold text-[var(--text-primary)]">{fmtMoney(b.saving, primaryCurrency)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-[var(--input-bg)] overflow-hidden">
                      <div className={`h-full rounded-full ${m.cls.split(' ').find((c) => c.startsWith('bg-')) || 'bg-slate-600'}`} style={{ width: `${w}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
            <AlertTriangle size={15} className="text-amber-400" /> Under-utilised assets ({rows === null ? '—' : idle.length})
          </h3>
          {rows === null ? (
            <div className="h-24 bg-[var(--input-bg)] rounded animate-pulse" />
          ) : idle.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No assets below 40% utilisation. Fleet utilisation is healthy.</p>
          ) : (
            <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
              {idle.slice(0, 20).map((r) => (
                <div key={r.id} className="flex items-center justify-between rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--text-primary)] truncate">{r.asset_no}{r.asset_type ? <span className="text-[var(--text-muted)] font-normal"> · {r.asset_type}</span> : null}</p>
                    <p className="text-[11px] text-[var(--text-muted)]">Suggests <span className="font-semibold">{REC_META[suggestRecommendation(r)]?.label}</span> · {fmtCpk(costPerKm(r), r.currency || primaryCurrency)}/km</p>
                  </div>
                  <span className="text-sm font-bold text-amber-400 shrink-0 ml-2">{fmtPct(r.utilization_pct)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Suggested-vs-recorded mismatch hint */}
      {rows !== null && mismatches.length > 0 && (
        <div className="card border border-violet-800/40 flex items-start gap-3">
          <Sparkles size={18} className="text-violet-400 mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-violet-300 font-medium">{mismatches.length} scenario{mismatches.length === 1 ? '' : 's'} disagree with the data-driven suggestion.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              The recorded decision differs from the utilisation/age/downtime model for{' '}
              {mismatches.slice(0, 6).map((r, i) => (
                <span key={r.id}>
                  {i > 0 ? ', ' : ''}
                  <button onClick={() => openEdit(r)} className="font-mono text-[var(--text-primary)] hover:text-violet-300 underline decoration-dotted">{r.asset_no}</button>
                  <span className="text-[var(--text-muted)]"> ({REC_META[r.recommendation]?.label} → {REC_META[suggestRecommendation(r)]?.label})</span>
                </span>
              ))}
              {mismatches.length > 6 ? ` and ${mismatches.length - 6} more` : ''}. Review before acting.
            </p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search asset, type, scenario, rationale…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={recFilter} onChange={(e) => setRecFilter(e.target.value)} aria-label="Recommendation">
            <option value="">All recommendations</option>
            {REC_FILTERS.map((r) => <option key={r} value={r}>{REC_META[r].label}</option>)}
          </select>
          <select className="input" value={confFilter} onChange={(e) => setConfFilter(e.target.value)} aria-label="Confidence">
            <option value="">All confidence</option>
            {CONF_FILTERS.map((c) => <option key={c} value={c} className="capitalize">{c}</option>)}
          </select>
          {countryOptions.length > 0 && (
            <select className="input" value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)} aria-label="Country">
              <option value="">All countries</option>
              {countryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {summary.totalAssets}</span>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['Asset', 'Utilisation', 'Annual km', 'Annual cost', 'Cost/km', 'Age', 'Downtime', 'Recommendation', 'Suggested', 'Saving', 'Confidence', ''].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={12} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={12} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  <Filter size={22} className="mx-auto mb-2 opacity-60" />
                  {rows.length === 0 && !notProvisioned ? 'No scenarios modelled yet — create your first optimizer scenario.' : 'No scenarios match these filters.'}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => {
                  const suggested = suggestRecommendation(r)
                  const mismatch = r.recommendation && suggested !== r.recommendation
                  const cur = r.currency || primaryCurrency
                  return (
                    <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-[var(--text-primary)]">{r.asset_no || '—'}</p>
                        {(r.asset_type || r.scenario_name) && <p className="text-[11px] text-[var(--text-muted)]">{[r.asset_type, r.scenario_name].filter(Boolean).join(' · ')}</p>}
                      </td>
                      <td className="px-4 py-2.5 font-semibold text-[var(--text-primary)]">{fmtPct(r.utilization_pct)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtNum(r.annual_km)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtMoney(r.annual_cost, cur)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtCpk(costPerKm(r), cur)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{r.age_years == null || r.age_years === '' ? '—' : `${Number(r.age_years)} yr`}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{r.downtime_days == null || r.downtime_days === '' ? '—' : `${Number(r.downtime_days)} d`}</td>
                      <td className="px-4 py-2.5"><RecBadge value={r.recommendation} /></td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex items-center gap-1 ${mismatch ? 'text-violet-300' : 'text-[var(--text-muted)]'}`}>
                          {mismatch && <Sparkles size={11} />}<RecBadge value={suggested} />
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-semibold whitespace-nowrap text-green-400">{fmtMoney(r.projected_saving, cur)}</td>
                      <td className="px-4 py-2.5"><ConfBadge value={r.confidence} /></td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => openEdit(r)} className="p-1.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Edit"><Pencil size={14} /></button>
                          <button onClick={() => setConfirmDelete(r)} className="p-1.5 rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" aria-label="Delete"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > 500 && <p className="px-4 py-2 text-xs text-[var(--text-muted)] border-t border-[var(--input-border)]">Showing first 500 — refine filters or export for the full set.</p>}
      </div>

      {/* Create / Edit modal */}
      {showModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={closeModal}>
          <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[var(--text-primary)]">{editing ? 'Edit scenario' : 'New optimizer scenario'}</h3>
              <button onClick={closeModal} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Asset number</label>
                  <input className="input w-full" placeholder="e.g. TRK-1042" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />
                </div>
                <div>
                  <label className="label">Asset type (optional)</label>
                  <input className="input w-full" placeholder="e.g. Tri-mixer" value={form.asset_type} maxLength={120} onChange={(e) => set('asset_type', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label">Scenario name (optional)</label>
                <input className="input w-full" placeholder="e.g. 2026 right-sizing review" value={form.scenario_name} maxLength={200} onChange={(e) => set('scenario_name', e.target.value)} />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div>
                  <label className="label">Utilisation %</label>
                  <input className="input w-full" type="number" step="0.1" min="0" placeholder="65" value={form.utilization_pct} onChange={(e) => set('utilization_pct', e.target.value)} />
                </div>
                <div>
                  <label className="label">Annual km</label>
                  <input className="input w-full" type="number" step="1" min="0" placeholder="60000" value={form.annual_km} onChange={(e) => set('annual_km', e.target.value)} />
                </div>
                <div>
                  <label className="label">Annual cost</label>
                  <input className="input w-full" type="number" step="1" min="0" placeholder="42000" value={form.annual_cost} onChange={(e) => set('annual_cost', e.target.value)} />
                </div>
                <div>
                  <label className="label">Downtime days</label>
                  <input className="input w-full" type="number" step="1" min="0" placeholder="12" value={form.downtime_days} onChange={(e) => set('downtime_days', e.target.value)} />
                </div>
                <div>
                  <label className="label">Age (years)</label>
                  <input className="input w-full" type="number" step="0.1" min="0" placeholder="6" value={form.age_years} onChange={(e) => set('age_years', e.target.value)} />
                </div>
                <div>
                  <label className="label">Resale value</label>
                  <input className="input w-full" type="number" step="1" min="0" placeholder="35000" value={form.resale_value} onChange={(e) => set('resale_value', e.target.value)} />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="label">Recommendation</label>
                  <select className="input w-full" value={form.recommendation} onChange={(e) => set('recommendation', e.target.value)}>
                    <option value="">— select —</option>
                    {REC_FILTERS.map((r) => <option key={r} value={r}>{REC_META[r].label}</option>)}
                  </select>
                  <p className="text-[11px] text-[var(--text-muted)] mt-1 flex items-center gap-1">
                    <Sparkles size={11} className="text-violet-400" /> Suggests <span className="font-semibold text-[var(--text-primary)]">{REC_META[liveSuggestion]?.label}</span>
                  </p>
                </div>
                <div>
                  <label className="label">Projected saving</label>
                  <input className="input w-full" type="number" step="1" placeholder="8000" value={form.projected_saving} onChange={(e) => set('projected_saving', e.target.value)} />
                </div>
                <div>
                  <label className="label">Confidence</label>
                  <select className="input w-full" value={form.confidence} onChange={(e) => set('confidence', e.target.value)}>
                    <option value="">— select —</option>
                    {CONF_FILTERS.map((c) => <option key={c} value={c} className="capitalize">{c}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <div>
                  <label className="label">Currency</label>
                  <input className="input w-full" placeholder="SAR" value={form.currency} maxLength={12} onChange={(e) => set('currency', e.target.value)} />
                </div>
                <div className="sm:col-span-3">
                  <label className="label">Rationale (optional)</label>
                  <input className="input w-full" placeholder="e.g. idle 8 months, high downtime, low resale" value={form.rationale} maxLength={8000} onChange={(e) => set('rationale', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label">Notes (optional)</label>
                <textarea className="input w-full min-h-[70px] resize-y" placeholder="e.g. redeploy to northern depot pending contract" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
              </div>

              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Create scenario'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={() => !deleting && setConfirmDelete(null)}>
          <div className="card w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-red-900/30 flex items-center justify-center shrink-0"><Trash2 size={18} className="text-red-400" /></div>
              <div>
                <h3 className="text-[var(--text-primary)] font-semibold">Delete this scenario?</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  {confirmDelete.asset_no || 'Scenario'}{confirmDelete.recommendation ? ` · ${REC_META[confirmDelete.recommendation]?.label}` : ''}. This can’t be undone.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-5">
              <button onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm" disabled={deleting}>Cancel</button>
              <button onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={deleting}>
                <Trash2 size={14} /> {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
