/**
 * FitmentValidation (route /fitment-validation) — the single home for fitment
 * assurance. Four tabs:
 *
 *   • Validate         — single-tyre fitment ENGINE (ported from tyre_saas
 *                        fitment_engine.py). Resolve a tyre by serial + target
 *                        asset, run the org's fitment rule (lifecycle, size,
 *                        tread), and either Simulate (preview) or Validate
 *                        (persist to the fitment_validations ledger). Checks that
 *                        need data absent from this dataset (age, retread, dual
 *                        pairing) are surfaced honestly, never fabricated.
 *   • Fleet size audit — the fleet-wide scanner: every asset's fitted tyre size
 *                        vs its specified size (preserved in full).
 *   • Rules            — CRUD for the org's fitment policy (fitment_rules, V208).
 *   • History          — the recent validation ledger.
 *
 * Real data only, honest empty/loading/error/not-provisioned states throughout.
 * Classification + the validation engine live in `src/lib/fitmentValidation.js`;
 * Supabase I/O lives in `src/lib/api/fitmentValidation.js`.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement,
  Tooltip, Legend,
} from 'chart.js'
import { Doughnut, Bar } from 'react-chartjs-2'
import {
  ShieldCheck, AlertTriangle, CheckCircle2, XCircle, HelpCircle, Search, X,
  Filter, FileSpreadsheet, FileText, Info, FlaskConical, Plus, Pencil, Trash2,
  History, ListChecks, Play, ScanLine, Layers, Gauge,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  loadFitmentData, listRules, createRule, updateRule, deleteRule,
  listValidations, createValidation, findTyreBySerial, findVehicleByAsset,
  isFitmentProvisioned,
} from '../lib/api/fitmentValidation'
import {
  summarizeFitments, FITMENT_BAND_META, validateFitment, matchRules,
  FITMENT_UNAVAILABLE_CHECKS, FITMENT_UNAVAILABLE_NOTE,
} from '../lib/fitmentValidation'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend)

const BAND_STYLES = {
  mismatch: 'bg-red-900/40 text-red-300 border border-red-700/50',
  match: 'bg-green-900/40 text-green-300 border border-green-700/50',
  unknown: 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]',
}

const TABS = [
  { key: 'validate', label: 'Validate', icon: ShieldCheck },
  { key: 'audit', label: 'Fleet size audit', icon: ScanLine },
  { key: 'rules', label: 'Rules', icon: ListChecks },
  { key: 'history', label: 'History', icon: History },
]

const EMPTY_RULE = {
  rule_name: '', applies_to_vehicle_types: '', applies_to_axle_roles: '',
  approved_sizes: '', min_tread_depth_mm: '3', max_tyre_age_years: '6',
  allow_retread: true, max_retread_count: '2', require_matching_pair: true,
  max_tread_delta_dual_mm: '2', is_active: true, notes: '',
}

const csv = (v) => (Array.isArray(v) ? v.join(', ') : '')

export default function FitmentValidation() {
  const { activeCountry } = useSettings()
  const countryParam = activeCountry && activeCountry !== 'All' ? activeCountry : null

  const [tab, setTab] = useState('validate')

  // ── Fleet size audit (preserved) ───────────────────────────────────────────
  const [data, setData] = useState(null) // { vehicles, tyres }
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [bandFilter, setBandFilter] = useState('all')
  const [siteFilter, setSiteFilter] = useState('')
  const [search, setSearch] = useState('')

  // ── Engine: rules + provisioning ───────────────────────────────────────────
  const [rules, setRules] = useState(null)
  const [notProvisioned, setNotProvisioned] = useState(false)

  // ── Validate tab ───────────────────────────────────────────────────────────
  const [vForm, setVForm] = useState({ tyre_serial: '', asset_no: '', position_code: '' })
  const [vResult, setVResult] = useState(null)
  const [vContext, setVContext] = useState(null) // { tyre, vehicle, rule }
  const [vError, setVError] = useState('')
  const [vSimulating, setVSimulating] = useState(false)
  const [vSaving, setVSaving] = useState(false)

  // ── Rules tab (CRUD) ───────────────────────────────────────────────────────
  const [showRuleModal, setShowRuleModal] = useState(false)
  const [editingRule, setEditingRule] = useState(null)
  const [ruleForm, setRuleForm] = useState(EMPTY_RULE)
  const [ruleSaving, setRuleSaving] = useState(false)
  const [ruleFormError, setRuleFormError] = useState('')
  const [confirmDeleteRule, setConfirmDeleteRule] = useState(null)
  const [deletingRule, setDeletingRule] = useState(false)

  // ── History tab ────────────────────────────────────────────────────────────
  const [validations, setValidations] = useState(null)

  // ── Loaders ────────────────────────────────────────────────────────────────
  const loadRules = useCallback(async () => {
    try {
      const rows = await listRules({ country: activeCountry })
      setRules(Array.isArray(rows) ? rows : [])
    } catch {
      setRules([])
    }
  }, [activeCountry])

  const loadValidations = useCallback(async () => {
    try {
      const rows = await listValidations({ country: activeCountry, limit: 100 })
      setValidations(Array.isArray(rows) ? rows : [])
    } catch {
      setValidations([])
    }
  }, [activeCountry])

  const load = useCallback(async () => {
    setRefreshing(true); setError('')
    try {
      const [res, provisioned] = await Promise.all([
        loadFitmentData({ country: activeCountry }),
        isFitmentProvisioned().catch(() => true),
      ])
      setData(res)
      setNotProvisioned(!provisioned)
      setUpdatedAt(new Date())
      await Promise.all([loadRules(), loadValidations()])
    } catch (err) {
      setError(err?.message || 'Could not load fleet or tyre data.')
      setData({ vehicles: [], tyres: [] })
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry, loadRules, loadValidations])

  useEffect(() => { load() }, [load])

  // ── Audit derivations (preserved) ──────────────────────────────────────────
  const { rows: enriched, counts, compliancePct } = useMemo(
    () => summarizeFitments(data?.vehicles || [], data?.tyres || []),
    [data],
  )

  const siteOptions = useMemo(
    () => [...new Set((enriched || []).map((r) => r.site).filter(Boolean))].sort(),
    [enriched],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (enriched || []).filter((r) => {
      if (bandFilter !== 'all' && r.band !== bandFilter) return false
      if (siteFilter && r.site !== siteFilter) return false
      if (q) {
        const hay = `${r.asset_no} ${r.make} ${r.model} ${r.vehicle_type} ${r.spec} ${r.fittedSizes.join(' ')}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [enriched, bandFilter, siteFilter, search])

  const chartText = getComputedStyle(document.documentElement).getPropertyValue('--text-muted') || '#9ca3af'
  const loaded = data !== null
  const hasAny = loaded && (data.vehicles.length > 0)

  const donutData = {
    labels: ['Wrong size', 'Correct size', 'No data'],
    datasets: [{
      data: [counts.mismatch, counts.match, counts.unknown],
      backgroundColor: ['#ef4444', '#22c55e', '#64748b'],
      borderWidth: 0,
    }],
  }
  const bySiteMismatch = useMemo(() => {
    const m = new Map()
    for (const r of enriched) {
      if (r.band !== 'mismatch') continue
      const k = r.site || 'Unassigned'
      m.set(k, (m.get(k) || 0) + 1)
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
  }, [enriched])
  const barData = {
    labels: bySiteMismatch.map(([s]) => s),
    datasets: [{ label: 'Wrong-size assets', data: bySiteMismatch.map(([, n]) => n), backgroundColor: '#ef4444', borderRadius: 4 }],
  }
  const chartOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: chartText, boxWidth: 12 } } },
    scales: { x: { ticks: { color: chartText }, grid: { color: 'rgba(148,163,184,0.12)' } }, y: { ticks: { color: chartText }, grid: { color: 'rgba(148,163,184,0.12)' } } },
  }

  const EXPORT_COLS = ['asset_no', 'vehicle', 'site', 'spec', 'fitted', 'mismatch', 'fittedCount', 'status']
  const exportRows = filtered.map((r) => ({
    asset_no: r.asset_no || '',
    vehicle: [r.make, r.model].filter(Boolean).join(' ') || r.vehicle_type || '',
    site: r.site || '',
    spec: r.spec || '',
    fitted: r.fittedSizes.join(', '),
    mismatch: FITMENT_BAND_META[r.band]?.label || r.band,
    fittedCount: r.fittedCount,
    status: r.status || '',
  }))
  const EXPORT_HEADERS = ['Asset', 'Vehicle', 'Site', 'Spec size', 'Fitted size(s)', 'Result', 'Fitted tyres', 'Status']

  const kpis = [
    { label: 'Assets checked', value: counts.total, icon: ShieldCheck, tone: 'text-[var(--text-primary)]' },
    { label: 'Correct size', value: counts.match, icon: CheckCircle2, tone: 'text-green-400' },
    { label: 'Wrong size', value: counts.mismatch, icon: XCircle, tone: 'text-red-400' },
    { label: 'No data', value: counts.unknown, icon: HelpCircle, tone: 'text-[var(--text-muted)]' },
  ]

  const clearFilters = () => { setBandFilter('all'); setSiteFilter(''); setSearch('') }
  const hasFilters = bandFilter !== 'all' || siteFilter || search

  // ── Validate handlers ──────────────────────────────────────────────────────
  const setV = (k, v) => setVForm((f) => ({ ...f, [k]: v }))

  const runValidation = useCallback(async (persist) => {
    setVError('')
    const serial = vForm.tyre_serial.trim()
    const asset = vForm.asset_no.trim()
    const position = vForm.position_code.trim()
    if (!serial) { setVError('Enter a tyre serial to validate.'); return }
    persist ? setVSaving(true) : setVSimulating(true)
    try {
      const [tyre, vehicle] = await Promise.all([
        findTyreBySerial(serial, { country: activeCountry }),
        asset ? findVehicleByAsset(asset, { country: activeCountry }) : Promise.resolve(null),
      ])
      const rule = matchRules(rules || [], vehicle)[0]
      const result = validateFitment(tyre, vehicle, rule)
      setVContext({ tyre, vehicle, rule })
      setVResult({ ...result, preview: !persist })

      if (persist) {
        if (!tyre) { setVError(`No tyre matched serial "${serial}" — nothing was saved.`); return }
        await createValidation({
          tyre_serial: serial,
          asset_no: asset || null,
          position_code: position || null,
          axle_role: null,
          country: countryParam,
          result,
        })
        await loadValidations()
      }
    } catch (err) {
      setVError(err?.message || 'Validation failed.')
    } finally {
      setVSaving(false); setVSimulating(false)
    }
  }, [vForm, rules, activeCountry, countryParam, loadValidations])

  // ── Rule CRUD handlers ─────────────────────────────────────────────────────
  const openRuleCreate = () => { setEditingRule(null); setRuleForm(EMPTY_RULE); setRuleFormError(''); setShowRuleModal(true) }
  const openRuleEdit = (r) => {
    setEditingRule(r)
    setRuleForm({
      rule_name: r.rule_name || '',
      applies_to_vehicle_types: csv(r.applies_to_vehicle_types),
      applies_to_axle_roles: csv(r.applies_to_axle_roles),
      approved_sizes: csv(r.approved_sizes),
      min_tread_depth_mm: r.min_tread_depth_mm ?? '3',
      max_tyre_age_years: r.max_tyre_age_years ?? '6',
      allow_retread: r.allow_retread !== false,
      max_retread_count: r.max_retread_count ?? '2',
      require_matching_pair: r.require_matching_pair !== false,
      max_tread_delta_dual_mm: r.max_tread_delta_dual_mm ?? '2',
      is_active: r.is_active !== false,
      notes: r.notes || '',
    })
    setRuleFormError(''); setShowRuleModal(true)
  }
  const closeRuleModal = () => { if (!ruleSaving) { setShowRuleModal(false); setEditingRule(null) } }
  const setRule = (k, v) => setRuleForm((f) => ({ ...f, [k]: v }))

  const submitRule = useCallback(async (e) => {
    e?.preventDefault?.()
    setRuleFormError('')
    if (!ruleForm.rule_name.trim()) { setRuleFormError('A rule name is required.'); return }
    setRuleSaving(true)
    try {
      const payload = { ...ruleForm, country: countryParam }
      if (editingRule) await updateRule(editingRule.id, payload)
      else await createRule(payload)
      setShowRuleModal(false); setEditingRule(null)
      await loadRules()
    } catch (err) {
      setRuleFormError(err?.message || 'Could not save the rule.')
    } finally {
      setRuleSaving(false)
    }
  }, [ruleForm, editingRule, countryParam, loadRules])

  const doDeleteRule = useCallback(async () => {
    if (!confirmDeleteRule) return
    setDeletingRule(true)
    try {
      await deleteRule(confirmDeleteRule.id)
      setConfirmDeleteRule(null)
      await loadRules()
    } catch (err) {
      setRuleFormError(err?.message || 'Could not delete the rule.')
    } finally {
      setDeletingRule(false)
    }
  }, [confirmDeleteRule, loadRules])

  const busy = vSimulating || vSaving

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fitment Validation"
        subtitle="Validate a single tyre before it goes on, audit the whole fleet's sizes, and govern the fitment policy that drives both."
        icon={ShieldCheck}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={tab === 'audit' ? (
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'fitment_validation')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Fitment Validation', 'fitment_validation', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
          </div>
        ) : tab === 'rules' ? (
          <button onClick={openRuleCreate} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={notProvisioned}>
            <Plus size={14} /> New rule
          </button>
        ) : null}
      />

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-[var(--input-border)]">
        {TABS.map((t) => {
          const Icon = t.icon
          const active = tab === t.key
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${active ? 'border-indigo-500 text-[var(--text-primary)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
            >
              <Icon size={15} /> {t.label}
            </button>
          )
        })}
      </div>

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn't load fitment data.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
        </div>
      )}

      {notProvisioned && (tab === 'rules' || tab === 'history') && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">The fitment rule engine isn't enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V208_FITMENT_RULES.sql</span>, then reload. The Validate tab still runs against the built-in default policy.
            </p>
          </div>
        </div>
      )}

      {/* ── VALIDATE TAB ─────────────────────────────────────────────────────── */}
      {tab === 'validate' && (
        <div className="space-y-4">
          <div className="card">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
              <Gauge size={15} /> Pre-installation check
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="label">Tyre serial</label>
                <input className="input w-full" placeholder="e.g. AA10293" value={vForm.tyre_serial} maxLength={120} onChange={(e) => setV('tyre_serial', e.target.value)} />
              </div>
              <div>
                <label className="label">Target asset no. (optional)</label>
                <input className="input w-full" placeholder="e.g. TM517" value={vForm.asset_no} maxLength={120} onChange={(e) => setV('asset_no', e.target.value)} />
              </div>
              <div>
                <label className="label">Position code (optional)</label>
                <input className="input w-full" placeholder="e.g. A2LO" value={vForm.position_code} maxLength={60} onChange={(e) => setV('position_code', e.target.value)} />
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button onClick={() => runValidation(false)} className="btn-secondary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={busy}>
                <FlaskConical size={14} /> {vSimulating ? 'Simulating…' : 'Simulate'}
              </button>
              <button onClick={() => runValidation(true)} className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={busy}>
                <Play size={14} /> {vSaving ? 'Validating…' : 'Validate & record'}
              </button>
              <span className="text-xs text-[var(--text-muted)] inline-flex items-center gap-1.5 ml-auto self-center">
                <Info size={12} /> Simulate previews only. Validate & record writes to the ledger.
              </span>
            </div>
          </div>

          {vError && (
            <div className="card border border-red-800/50 flex items-start gap-3">
              <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
              <p className="text-red-300 text-sm">{vError}</p>
            </div>
          )}

          {vResult && (
            <div className={`card border-2 ${vResult.is_valid ? 'border-emerald-600/40' : 'border-red-600/40'}`}>
              <div className="flex items-center gap-2 flex-wrap">
                {vResult.is_valid
                  ? <CheckCircle2 size={20} className="text-emerald-400" />
                  : <XCircle size={20} className="text-red-400" />}
                <span className={`text-base font-semibold ${vResult.is_valid ? 'text-emerald-300' : 'text-red-300'}`}>
                  {vResult.is_valid ? 'Fitment approved' : 'Fitment rejected'}
                </span>
                {vResult.preview && (
                  <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                    Preview — not saved
                  </span>
                )}
                {vContext?.rule?._default && (
                  <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-slate-500/15 text-slate-300 border border-slate-500/30">
                    Default policy
                  </span>
                )}
              </div>

              {/* Resolved context */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 text-sm">
                <div><span className="text-[var(--text-muted)] block text-xs">Serial</span><span className="font-mono text-[var(--text-primary)]">{vForm.tyre_serial || '—'}</span></div>
                <div><span className="text-[var(--text-muted)] block text-xs">Size</span><span className="font-mono text-[var(--text-secondary)]">{vContext?.tyre?.size || '—'}</span></div>
                <div><span className="text-[var(--text-muted)] block text-xs">Tread</span><span className="text-[var(--text-secondary)]">{vContext?.tyre?.tread_depth != null ? `${vContext.tyre.tread_depth} mm` : '—'}</span></div>
                <div><span className="text-[var(--text-muted)] block text-xs">Status</span><span className="text-[var(--text-secondary)]">{vContext?.tyre?.status || '—'}</span></div>
                <div><span className="text-[var(--text-muted)] block text-xs">Target asset</span><span className="font-mono text-[var(--text-secondary)]">{vForm.asset_no || '—'}</span></div>
                <div><span className="text-[var(--text-muted)] block text-xs">Vehicle type</span><span className="text-[var(--text-secondary)]">{vContext?.vehicle?.vehicle_type || '—'}</span></div>
                <div><span className="text-[var(--text-muted)] block text-xs">Spec size</span><span className="font-mono text-[var(--text-secondary)]">{vContext?.vehicle?.tyre_size || '—'}</span></div>
                <div><span className="text-[var(--text-muted)] block text-xs">Rule</span><span className="text-[var(--text-secondary)]">{vContext?.rule?.rule_name || '—'}</span></div>
              </div>

              {/* Violations */}
              {vResult.violations?.length > 0 && (
                <div className="mt-4 space-y-2">
                  <div className="text-xs font-semibold text-red-400 uppercase tracking-wide">Violations ({vResult.violations.length})</div>
                  {vResult.violations.map((v, i) => (
                    <div key={i} className="flex items-start gap-2 p-2.5 rounded bg-red-900/20 border border-red-800/40">
                      <XCircle size={16} className="text-red-400 mt-0.5 shrink-0" />
                      <div>
                        <div className="text-sm text-[var(--text-primary)]">{v.message}</div>
                        <span className="text-[10px] font-mono text-red-400/80">{v.rule}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Warnings */}
              {vResult.warnings?.length > 0 && (
                <div className="mt-4 space-y-2">
                  <div className="text-xs font-semibold text-amber-400 uppercase tracking-wide">Warnings ({vResult.warnings.length})</div>
                  {vResult.warnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-2 p-2.5 rounded bg-amber-900/20 border border-amber-800/40">
                      <AlertTriangle size={16} className="text-amber-400 mt-0.5 shrink-0" />
                      <div>
                        <div className="text-sm text-[var(--text-primary)]">{w.message}</div>
                        <span className="text-[10px] font-mono text-amber-400/80">{w.rule}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {vResult.is_valid && !vResult.violations?.length && !vResult.warnings?.length && (
                <div className="mt-4 text-emerald-300 text-sm flex items-center gap-2">
                  <CheckCircle2 size={16} /> All available checks passed — safe to install.
                </div>
              )}

              {/* Honest note about checks that cannot run on this dataset */}
              <div className="mt-4 p-3 rounded bg-[var(--input-bg)]/60 border border-[var(--input-border)]">
                <div className="text-xs font-semibold text-[var(--text-secondary)] flex items-center gap-1.5 mb-1.5">
                  <Info size={13} /> Not evaluated (data unavailable)
                </div>
                <p className="text-xs text-[var(--text-muted)] mb-2">{FITMENT_UNAVAILABLE_NOTE}</p>
                <ul className="flex flex-wrap gap-1.5">
                  {FITMENT_UNAVAILABLE_CHECKS.map((c) => (
                    <li key={c.rule} className="text-[10px] px-2 py-0.5 rounded border border-[var(--input-border)] text-[var(--text-muted)]" title={`needs ${c.needs}`}>
                      {c.label}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── FLEET SIZE AUDIT TAB (preserved) ─────────────────────────────────── */}
      {tab === 'audit' && (
        <div className="space-y-6">
          {/* KPI tiles */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {kpis.map((k) => {
              const Icon = k.icon
              return (
                <div key={k.label} className="card">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                    <Icon size={16} className={k.tone} />
                  </div>
                  <p className={`text-3xl font-bold mt-1 ${k.tone}`}>{!loaded ? '—' : k.value}</p>
                </div>
              )
            })}
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Fitment breakdown</h3>
              <div className="h-64">{hasAny ? <Doughnut data={donutData} options={{ ...chartOpts, scales: undefined }} /> : <EmptyChart loading={!loaded} empty="No fleet assets in scope." />}</div>
              {compliancePct != null && <p className="text-xs text-[var(--text-muted)] mt-3 flex items-center gap-1.5"><Info size={12} /> Correct-size rate (of checkable assets): <span className="font-semibold text-[var(--text-secondary)]">{compliancePct}%</span></p>}
            </div>
            <div className="card">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Wrong-size assets by site (top 10)</h3>
              <div className="h-64">{bySiteMismatch.length ? <Bar data={barData} options={chartOpts} /> : <EmptyChart loading={!loaded} empty="No wrong-size fitments found." />}</div>
            </div>
          </div>

          {/* Filters */}
          <div className="card space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input className="input pl-9 w-full" placeholder="Search asset, make/model, size…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <select className="input" value={bandFilter} onChange={(e) => setBandFilter(e.target.value)} aria-label="Result">
                <option value="all">All results</option>
                <option value="mismatch">Wrong size</option>
                <option value="match">Correct size</option>
                <option value="unknown">No data</option>
              </select>
              <select className="input" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} aria-label="Site">
                <option value="">All sites</option>
                {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
              <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {counts.total}</span>
            </div>
          </div>

          {/* Table */}
          <div className="card overflow-hidden !p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                    {['Asset', 'Vehicle', 'Site', 'Spec size', 'Fitted size(s)', 'Tyres', 'Result'].map((h) => <th key={h} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {!loaded ? (
                    [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={7} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
                  ) : filtered.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-12 text-center text-[var(--text-muted)]"><Filter size={22} className="mx-auto mb-2 opacity-60" />{hasAny ? 'No assets match these filters.' : 'No fleet assets found for this country.'}</td></tr>
                  ) : (
                    filtered.slice(0, 500).map((r) => (
                      <tr key={r.asset_no || Math.random()} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                        <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-primary)]">{r.asset_no || '—'}</td>
                        <td className="px-4 py-2.5 text-[var(--text-secondary)]">{[r.make, r.model].filter(Boolean).join(' ') || r.vehicle_type || '—'}</td>
                        <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.site || '—'}</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-secondary)]">{r.spec || '—'}</td>
                        <td className="px-4 py-2.5 font-mono text-xs">
                          {r.fittedSizes.length ? (
                            <span className={r.band === 'mismatch' ? 'text-red-300' : 'text-[var(--text-secondary)]'}>{r.fittedSizes.join(', ')}</span>
                          ) : <span className="text-[var(--text-muted)]">—</span>}
                          {r.band === 'mismatch' && r.mismatchSizes.length > 0 && (
                            <span className="block text-[10px] text-red-400/80 mt-0.5">≠ spec: {r.mismatchSizes.join(', ')}</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.fittedCount || 0}</td>
                        <td className="px-4 py-2.5"><span className={`badge text-[11px] px-2 py-0.5 rounded ${BAND_STYLES[r.band]}`}>{FITMENT_BAND_META[r.band]?.label}</span></td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {filtered.length > 500 && <p className="px-4 py-2 text-xs text-[var(--text-muted)] border-t border-[var(--input-border)]">Showing first 500 — refine filters or export for the full set.</p>}
          </div>
        </div>
      )}

      {/* ── RULES TAB ────────────────────────────────────────────────────────── */}
      {tab === 'rules' && (
        <div className="space-y-3">
          {rules === null ? (
            <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-20 bg-[var(--input-bg)] rounded animate-pulse" />)}</div>
          ) : rules.length === 0 ? (
            <div className="card py-12 text-center text-[var(--text-muted)]">
              <ListChecks size={26} className="mx-auto mb-2 opacity-60" />
              <p className="text-sm">{notProvisioned ? 'Enable the engine (apply V208) to configure rules.' : 'No fitment rules yet — the Validate tab uses a built-in default policy until you add one.'}</p>
              {!notProvisioned && (
                <button onClick={openRuleCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 mt-4">
                  <Plus size={14} /> Create the first rule
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {rules.map((r) => (
                <div key={r.id} className="card">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-[var(--text-primary)]">{r.rule_name}</span>
                        <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded border ${r.is_active !== false ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'text-[var(--text-muted)] border-[var(--input-border)]'}`}>
                          {r.is_active !== false ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <div className="text-xs text-[var(--text-muted)] mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                        <span className="inline-flex items-center gap-1"><Layers size={11} /> Types: {csv(r.applies_to_vehicle_types) || 'All'}</span>
                        <span>Axles: {csv(r.applies_to_axle_roles) || 'All'}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => openRuleEdit(r)} className="p-1.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Edit rule"><Pencil size={14} /></button>
                      <button onClick={() => setConfirmDeleteRule(r)} className="p-1.5 rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" aria-label="Delete rule"><Trash2 size={14} /></button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3 text-xs">
                    <RuleStat label="Min tread" value={`${r.min_tread_depth_mm} mm`} />
                    <RuleStat label="Max age" value={`${r.max_tyre_age_years} y`} />
                    <RuleStat label="Approved sizes" value={r.approved_sizes?.length ? String(r.approved_sizes.length) : 'Any'} />
                    <RuleStat label="Allow retread" value={r.allow_retread !== false ? 'Yes' : 'No'} />
                    <RuleStat label="Max retreads" value={String(r.max_retread_count)} />
                    <RuleStat label="Match pair" value={r.require_matching_pair !== false ? 'Yes' : 'No'} />
                  </div>
                  {r.approved_sizes?.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {r.approved_sizes.slice(0, 8).map((s) => <span key={s} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--input-bg)] text-[var(--text-secondary)] border border-[var(--input-border)]">{s}</span>)}
                      {r.approved_sizes.length > 8 && <span className="text-[10px] text-[var(--text-muted)]">+{r.approved_sizes.length - 8} more</span>}
                    </div>
                  )}
                  {r.notes && <p className="text-xs text-[var(--text-muted)] mt-2">{r.notes}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── HISTORY TAB ──────────────────────────────────────────────────────── */}
      {tab === 'history' && (
        <div className="card overflow-hidden !p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                  {['Result', 'Serial', 'Asset', 'Position', 'Issues', 'When'].map((h) => <th key={h} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {validations === null ? (
                  [0, 1, 2, 3].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={6} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
                ) : validations.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-12 text-center text-[var(--text-muted)]"><History size={22} className="mx-auto mb-2 opacity-60" />{notProvisioned ? 'Enable the engine (apply V208) to record validations.' : 'No validations recorded yet — run a check on the Validate tab.'}</td></tr>
                ) : (
                  validations.map((h) => {
                    const vCount = Array.isArray(h.violations) ? h.violations.length : 0
                    const wCount = Array.isArray(h.warnings) ? h.warnings.length : 0
                    return (
                      <tr key={h.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${h.is_valid ? 'text-emerald-300' : 'text-red-300'}`}>
                            {h.is_valid ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                            {h.is_valid ? 'Approved' : 'Rejected'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-primary)]">{h.tyre_serial || '—'}</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-secondary)]">{h.asset_no || '—'}</td>
                        <td className="px-4 py-2.5 text-[var(--text-secondary)]">{h.position_code || '—'}</td>
                        <td className="px-4 py-2.5 text-xs">
                          {vCount > 0 && <span className="text-red-400 mr-2">{vCount} violation{vCount === 1 ? '' : 's'}</span>}
                          {wCount > 0 && <span className="text-amber-400">{wCount} warning{wCount === 1 ? '' : 's'}</span>}
                          {vCount === 0 && wCount === 0 && <span className="text-[var(--text-muted)]">Clean</span>}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-[var(--text-muted)] whitespace-nowrap">{h.validated_at ? new Date(h.validated_at).toLocaleString() : '—'}</td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Rule create / edit modal */}
      {showRuleModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={closeRuleModal}>
          <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[var(--text-primary)]">{editingRule ? 'Edit fitment rule' : 'New fitment rule'}</h3>
              <button onClick={closeRuleModal} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>
            <form onSubmit={submitRule} className="space-y-4">
              <div>
                <label className="label">Rule name</label>
                <input className="input w-full" placeholder="e.g. Steer axle — highway tractors" value={ruleForm.rule_name} maxLength={200} onChange={(e) => setRule('rule_name', e.target.value)} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Applies to vehicle types (comma-separated, blank = all)</label>
                  <input className="input w-full" placeholder="e.g. tractor, rigid_truck" value={ruleForm.applies_to_vehicle_types} onChange={(e) => setRule('applies_to_vehicle_types', e.target.value)} />
                </div>
                <div>
                  <label className="label">Applies to axle roles (comma-separated, blank = all)</label>
                  <input className="input w-full" placeholder="e.g. steer, drive" value={ruleForm.applies_to_axle_roles} onChange={(e) => setRule('applies_to_axle_roles', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label">Approved sizes (comma-separated, blank = any)</label>
                <input className="input w-full" placeholder="e.g. 315/80R22.5, 295/80R22.5" value={ruleForm.approved_sizes} onChange={(e) => setRule('approved_sizes', e.target.value)} />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <label className="label">Min tread (mm)</label>
                  <input className="input w-full" type="number" step="0.1" min="0" value={ruleForm.min_tread_depth_mm} onChange={(e) => setRule('min_tread_depth_mm', e.target.value)} />
                </div>
                <div>
                  <label className="label">Max age (years)</label>
                  <input className="input w-full" type="number" step="0.5" min="0" value={ruleForm.max_tyre_age_years} onChange={(e) => setRule('max_tyre_age_years', e.target.value)} />
                </div>
                <div>
                  <label className="label">Max retreads</label>
                  <input className="input w-full" type="number" step="1" min="0" value={ruleForm.max_retread_count} onChange={(e) => setRule('max_retread_count', e.target.value)} />
                </div>
                <div>
                  <label className="label">Max dual Δ (mm)</label>
                  <input className="input w-full" type="number" step="0.1" min="0" value={ruleForm.max_tread_delta_dual_mm} onChange={(e) => setRule('max_tread_delta_dual_mm', e.target.value)} />
                </div>
              </div>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer">
                  <input type="checkbox" className="accent-indigo-500" checked={ruleForm.allow_retread} onChange={(e) => setRule('allow_retread', e.target.checked)} /> Allow retread
                </label>
                <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer">
                  <input type="checkbox" className="accent-indigo-500" checked={ruleForm.require_matching_pair} onChange={(e) => setRule('require_matching_pair', e.target.checked)} /> Require matching pair
                </label>
                <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer">
                  <input type="checkbox" className="accent-indigo-500" checked={ruleForm.is_active} onChange={(e) => setRule('is_active', e.target.checked)} /> Active
                </label>
              </div>
              <div>
                <label className="label">Notes (optional)</label>
                <textarea className="input w-full min-h-[60px] resize-y" placeholder="e.g. GCC steer-axle policy" value={ruleForm.notes} maxLength={8000} onChange={(e) => setRule('notes', e.target.value)} />
              </div>

              <p className="text-[11px] text-[var(--text-muted)] flex items-start gap-1.5">
                <Info size={12} className="mt-0.5 shrink-0" />
                Age, retread and dual-pair fields are stored for policy completeness but are not evaluated on this dataset (source data absent). Size, tread and lifecycle checks are enforced.
              </p>

              {ruleFormError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {ruleFormError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={closeRuleModal} className="btn-secondary text-sm" disabled={ruleSaving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={ruleSaving}>
                  {ruleSaving ? 'Saving…' : editingRule ? 'Save changes' : 'Create rule'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete rule confirm */}
      {confirmDeleteRule && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={() => !deletingRule && setConfirmDeleteRule(null)}>
          <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-3">
              <Trash2 size={18} className="text-red-400" />
              <h3 className="text-base font-bold text-[var(--text-primary)]">Delete fitment rule</h3>
            </div>
            <p className="text-sm text-[var(--text-secondary)]">Delete <span className="font-semibold text-[var(--text-primary)]">{confirmDeleteRule.rule_name}</span>? This cannot be undone.</p>
            <div className="flex items-center justify-end gap-2 mt-4">
              <button onClick={() => setConfirmDeleteRule(null)} className="btn-secondary text-sm" disabled={deletingRule}>Cancel</button>
              <button onClick={doDeleteRule} className="btn-danger text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={deletingRule}>
                {deletingRule ? 'Deleting…' : 'Delete rule'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function RuleStat({ label, value }) {
  return (
    <div className="rounded bg-[var(--input-bg)]/50 border border-[var(--input-border)] px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{label}</div>
      <div className="text-[var(--text-primary)] font-medium">{value}</div>
    </div>
  )
}

function EmptyChart({ loading, empty = 'No data.' }) {
  return (
    <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">
      {loading ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" /> : empty}
    </div>
  )
}
