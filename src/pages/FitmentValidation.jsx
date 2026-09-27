/**
 * FitmentValidation (route /fitment-validation): the single home for fitment
 * assurance. Four tabs:
 *
 *   - Validate         Single-tyre fitment ENGINE (ported from tyre_saas
 *                      fitment_engine.py). Resolve a tyre by serial and target
 *                      asset, run the org's fitment rule (lifecycle, size,
 *                      tread), and either Simulate (preview) or Validate
 *                      (persist to the fitment_validations ledger). Checks that
 *                      need data absent from this dataset (age, retread, dual
 *                      pairing) are surfaced honestly, never fabricated.
 *   - Fleet size audit Every asset's fitted tyre size against its spec.
 *   - Rules            CRUD for the org's fitment policy (fitment_rules, V208).
 *   - History          The recent validation ledger.
 *
 * A page-level KPI strip spans all four tabs. Classification and the
 * validation engine live in src/lib/fitmentValidation.js; audit filtering,
 * ledger and rule summaries and export shapes live in the pure
 * src/lib/fitmentValidationAnalytics.js; Supabase I/O lives in
 * src/lib/api/fitmentValidation.js. The provisioning probe keeps its
 * fail-open contract (`isFitmentProvisioned().catch(() => true)`): an
 * unreadable probe never claims the engine is missing. A failed rules or
 * ledger read renders an error with Retry, never "no rules".
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement,
  Tooltip, Legend,
} from 'chart.js'
import { Doughnut, Bar } from 'react-chartjs-2'
import {
  ShieldCheck, AlertTriangle, CheckCircle2, XCircle, HelpCircle, Search, X,
  FileSpreadsheet, FileText, Info, FlaskConical, Plus, Pencil, Trash2,
  History, ListChecks, Play, ScanLine, Gauge, RotateCcw, Percent,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Card, { CardHeader } from '../components/ui/Card'
import Modal from '../components/ui/Modal'
import StatTile from '../components/ui/StatTile'
import { Skeleton } from '../components/ui/Skeleton'
import EnterpriseTable from '../components/ui/EnterpriseTable'
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
import {
  vehicleLabel, auditSiteOptions, filterAuditRows, mismatchBySite, auditSummary,
  auditExportRows, historyRows, filterHistory, historySummary, rulesSummary, filterRules,
} from '../lib/fitmentValidationAnalytics'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend)

const HISTORY_LIMIT = 100
const GRID = 'rgba(148,163,184,0.14)'
const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-1'
// Semantic result colours: red = wrong size, green = correct, slate = no data.
// They carry meaning, so they deliberately do not follow the report palette.
const SEMANTIC = { mismatch: '#ef4444', match: '#22c55e', unknown: '#64748b' }

const BAND_STYLES = {
  mismatch: 'bg-red-500/15 text-red-400 border border-red-500/30',
  match: 'bg-green-500/15 text-green-500 border border-green-500/30',
  unknown: 'bg-[var(--input-bg)] text-[var(--text-muted)] border border-[var(--input-border)]',
}
const BAND_ICON = { mismatch: XCircle, match: CheckCircle2, unknown: HelpCircle }

const EMPTY_RULE = {
  rule_name: '', applies_to_vehicle_types: '', applies_to_axle_roles: '',
  approved_sizes: '', min_tread_depth_mm: '3', max_tyre_age_years: '6',
  allow_retread: true, max_retread_count: '2', require_matching_pair: true,
  max_tread_delta_dual_mm: '2', is_active: true, notes: '',
}

const csv = (v) => (Array.isArray(v) ? v.join(', ') : '')

function chartTextColor() {
  if (typeof document === 'undefined') return '#9ca3af'
  return getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim() || '#9ca3af'
}

function ErrorBanner({ title, message, onRetry }) {
  return (
    <Card tone="crit" role="alert">
      <div className="flex flex-wrap items-start gap-[var(--space-3)]">
        <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
        <div className="flex-1 min-w-[12rem]">
          <p className="text-red-300 font-medium">{title}</p>
          <p className="text-[var(--text-muted)] text-sm mt-1">{message}</p>
        </div>
        {onRetry && (
          <button type="button" onClick={onRetry} className={`btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] ${FOCUS}`}>
            <RotateCcw size={14} aria-hidden="true" /> Retry
          </button>
        )}
      </div>
    </Card>
  )
}

function SearchBox({ id, label, value, onChange, placeholder }) {
  return (
    <div className="relative flex-1 min-w-[12rem]">
      <label htmlFor={id} className="sr-only">{label}</label>
      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
      <input id={id} className={`input pl-9 w-full min-h-[44px] ${FOCUS}`} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

export default function FitmentValidation() {
  const { activeCountry } = useSettings()
  const countryParam = activeCountry && activeCountry !== 'All' ? activeCountry : null

  const [tab, setTab] = useState('validate')

  // Fleet size audit
  const [data, setData] = useState(null) // { vehicles, tyres }
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [bandFilter, setBandFilter] = useState('all')
  const [siteFilter, setSiteFilter] = useState('')
  const [search, setSearch] = useState('')

  // Engine: rules + provisioning
  const [rules, setRules] = useState(null)
  const [rulesError, setRulesError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [ruleSearch, setRuleSearch] = useState('')
  const [ruleState, setRuleState] = useState('')

  // Validate tab
  const [vForm, setVForm] = useState({ tyre_serial: '', asset_no: '', position_code: '' })
  const [vResult, setVResult] = useState(null)
  const [vContext, setVContext] = useState(null) // { tyre, vehicle, rule }
  const [vError, setVError] = useState('')
  const [vSimulating, setVSimulating] = useState(false)
  const [vSaving, setVSaving] = useState(false)

  // Rules tab (CRUD)
  const [showRuleModal, setShowRuleModal] = useState(false)
  const [editingRule, setEditingRule] = useState(null)
  const [ruleForm, setRuleForm] = useState(EMPTY_RULE)
  const [ruleSaving, setRuleSaving] = useState(false)
  const [ruleFormError, setRuleFormError] = useState('')
  const [confirmDeleteRule, setConfirmDeleteRule] = useState(null)
  const [deletingRule, setDeletingRule] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  // History tab
  const [validations, setValidations] = useState(null)
  const [validationsError, setValidationsError] = useState('')
  const [historyResult, setHistoryResult] = useState('')
  const [historySearch, setHistorySearch] = useState('')

  // ── Loaders ────────────────────────────────────────────────────────────────
  const loadRules = useCallback(async () => {
    setRulesError('')
    try {
      const rows = await listRules({ country: activeCountry })
      setRules(Array.isArray(rows) ? rows : [])
    } catch (err) {
      setRules([])
      setRulesError(toUserMessage(err, 'Could not load fitment rules.'))
    }
  }, [activeCountry])

  const loadValidations = useCallback(async () => {
    setValidationsError('')
    try {
      const rows = await listValidations({ country: activeCountry, limit: HISTORY_LIMIT })
      setValidations(Array.isArray(rows) ? rows : [])
    } catch (err) {
      setValidations([])
      setValidationsError(toUserMessage(err, 'Could not load the validation ledger.'))
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
    } catch (err) {
      setError(toUserMessage(err, 'Could not load fleet or tyre data.'))
      setData({ vehicles: [], tyres: [] })
    } finally {
      await Promise.all([loadRules(), loadValidations()])
      setRefreshing(false)
    }
  }, [activeCountry, loadRules, loadValidations])

  useEffect(() => { load() }, [load])

  // ── Audit derivations ──────────────────────────────────────────────────────
  const { rows: enriched, counts } = useMemo(
    () => summarizeFitments(data?.vehicles || [], data?.tyres || []),
    [data],
  )
  const audit = useMemo(() => auditSummary(counts), [counts])
  const siteOptions = useMemo(() => auditSiteOptions(enriched), [enriched])
  const filtered = useMemo(
    () => filterAuditRows(enriched, { band: bandFilter, site: siteFilter, search }),
    [enriched, bandFilter, siteFilter, search],
  )
  const bySiteMismatch = useMemo(() => mismatchBySite(enriched, 10), [enriched])
  const loaded = data !== null
  const auditFailed = !!error
  const hasAny = loaded && data.vehicles.length > 0

  const hist = useMemo(() => historySummary(validations, { now: new Date(), limit: HISTORY_LIMIT }), [validations])
  const histRows = useMemo(() => historyRows(validations), [validations])
  const histFiltered = useMemo(() => filterHistory(histRows, { result: historyResult, search: historySearch }), [histRows, historyResult, historySearch])
  const rs = useMemo(() => rulesSummary(rules), [rules])
  const rulesFiltered = useMemo(() => filterRules(rules, { state: ruleState, search: ruleSearch }), [rules, ruleState, ruleSearch])

  const chartText = chartTextColor()
  const donutData = {
    labels: ['Wrong size', 'Correct size', 'No data'],
    datasets: [{ data: [counts.mismatch, counts.match, counts.unknown], backgroundColor: [SEMANTIC.mismatch, SEMANTIC.match, SEMANTIC.unknown], borderWidth: 0 }],
  }
  const barData = {
    labels: bySiteMismatch.map((r) => r.site),
    datasets: [{ label: 'Wrong-size assets', data: bySiteMismatch.map((r) => r.count), backgroundColor: SEMANTIC.mismatch, borderRadius: 4 }],
  }
  const donutOpts = {
    responsive: true, maintainAspectRatio: false, cutout: '60%',
    plugins: { legend: { position: 'bottom', labels: { color: chartText, boxWidth: 12 } } },
  }
  const barOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: chartText }, grid: { color: GRID } },
      y: { ticks: { color: chartText, precision: 0 }, grid: { color: GRID }, title: { display: true, text: 'Assets', color: chartText } },
    },
  }

  // ── Exports (audit tab: every filtered row) ────────────────────────────────
  const EXPORT_COLS = ['asset_no', 'vehicle', 'site', 'spec', 'fitted', 'mismatch', 'fittedCount', 'status']
  const EXPORT_HEADERS = ['Asset', 'Vehicle', 'Site', 'Spec size', 'Fitted size(s)', 'Result', 'Fitted tyres', 'Status']
  const exportRows = useMemo(() => auditExportRows(filtered), [filtered])
  const fileBase = reportFileName('Fitment Size Audit', countryParam || '')

  const tiles = [
    { label: 'Assets checked', value: auditFailed ? 'N/A' : audit.total.toLocaleString(), sub: audit.coveragePct == null ? 'No fleet in scope' : `${audit.coveragePct}% checkable`, icon: ShieldCheck, tone: 'neutral' },
    { label: 'Correct size', value: auditFailed ? 'N/A' : audit.match.toLocaleString(), icon: CheckCircle2, tone: 'accent' },
    { label: 'Wrong size', value: auditFailed ? 'N/A' : audit.mismatch.toLocaleString(), sub: `${audit.unknown.toLocaleString()} without data`, icon: XCircle, tone: 'crit' },
    { label: 'Size compliance', value: auditFailed || audit.compliancePct == null ? 'N/A' : `${audit.compliancePct}%`, sub: 'Of checkable assets', icon: Percent, tone: 'info' },
    { label: 'Approval rate', value: validationsError || hist.approvalRatePct == null ? 'N/A' : `${hist.approvalRatePct}%`, sub: `${hist.total} recorded validations`, icon: History, tone: 'neutral' },
    { label: 'Active rules', value: rulesError ? 'N/A' : String(rs.active), sub: rs.total ? `${rs.inactive} inactive` : 'Default policy in use', icon: ListChecks, tone: 'neutral' },
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
        if (!tyre) { setVError(`No tyre matched serial "${serial}". Nothing was saved.`); return }
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
      setVError(toUserMessage(err, 'Validation failed. Try again.'))
    } finally {
      setVSaving(false); setVSimulating(false)
    }
  }, [vForm, rules, activeCountry, countryParam, loadValidations])

  // ── Rule CRUD handlers ─────────────────────────────────────────────────────
  const openRuleCreate = () => { setEditingRule(null); setRuleForm(EMPTY_RULE); setRuleFormError(''); setShowRuleModal(true) }
  const openRuleEdit = useCallback((r) => {
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
  }, [])
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
      setRuleFormError(toUserMessage(err, 'Could not save the rule.'))
    } finally {
      setRuleSaving(false)
    }
  }, [ruleForm, editingRule, countryParam, loadRules])

  const doDeleteRule = useCallback(async () => {
    if (!confirmDeleteRule) return
    setDeletingRule(true); setDeleteError('')
    try {
      await deleteRule(confirmDeleteRule.id)
      setConfirmDeleteRule(null)
      await loadRules()
    } catch (err) {
      setDeleteError(toUserMessage(err, 'Could not delete the rule.'))
    } finally {
      setDeletingRule(false)
    }
  }, [confirmDeleteRule, loadRules])

  const busy = vSimulating || vSaving

  // ── Table columns ──────────────────────────────────────────────────────────
  const auditColumns = useMemo(() => [
    { id: 'asset', header: 'Asset', accessorFn: (r) => r.asset_no || 'N/A', cell: ({ getValue }) => <span className="font-mono text-xs text-[var(--text-primary)]">{getValue()}</span> },
    { id: 'vehicle', header: 'Vehicle', accessorFn: (r) => vehicleLabel(r) || 'N/A' },
    { id: 'site', header: 'Site', accessorFn: (r) => r.site || 'N/A' },
    { id: 'spec', header: 'Spec size', accessorFn: (r) => r.spec || 'N/A', cell: ({ getValue }) => <span className="font-mono text-xs">{getValue()}</span> },
    {
      id: 'fitted', header: 'Fitted size(s)', accessorFn: (r) => r.fittedSizes.join(', '),
      cell: ({ row }) => {
        const r = row.original
        return (
          <div className="font-mono text-xs">
            {r.fittedSizes.length ? <span className={r.band === 'mismatch' ? 'text-red-400' : 'text-[var(--text-secondary)]'}>{r.fittedSizes.join(', ')}</span> : <span className="text-[var(--text-muted)]">N/A</span>}
            {r.band === 'mismatch' && r.mismatchSizes.length > 0 && <span className="block text-[11px] text-red-400 mt-0.5">Not spec: {r.mismatchSizes.join(', ')}</span>}
          </div>
        )
      },
    },
    { id: 'tyres', header: 'Tyres', accessorFn: (r) => r.fittedCount || 0, meta: { align: 'right' } },
    {
      id: 'result', header: 'Result', accessorFn: (r) => FITMENT_BAND_META[r.band]?.label || r.band,
      cell: ({ row }) => {
        const Icon = BAND_ICON[row.original.band] || HelpCircle
        return (
          <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded ${BAND_STYLES[row.original.band]}`}>
            <Icon size={12} aria-hidden="true" /> {FITMENT_BAND_META[row.original.band]?.label}
          </span>
        )
      },
    },
  ], [])

  const historyColumns = useMemo(() => [
    {
      id: 'result', header: 'Result', accessorFn: (h) => h.result,
      cell: ({ row }) => (
        <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${row.original.is_valid ? 'text-green-500' : 'text-red-400'}`}>
          {row.original.is_valid ? <CheckCircle2 size={14} aria-hidden="true" /> : <XCircle size={14} aria-hidden="true" />}
          {row.original.result}
        </span>
      ),
    },
    { id: 'serial', header: 'Serial', accessorFn: (h) => h.tyre_serial || 'N/A', cell: ({ getValue }) => <span className="font-mono text-xs text-[var(--text-primary)]">{getValue()}</span> },
    { id: 'asset', header: 'Asset', accessorFn: (h) => h.asset_no || 'N/A', cell: ({ getValue }) => <span className="font-mono text-xs">{getValue()}</span> },
    { id: 'position', header: 'Position', accessorFn: (h) => h.position_code || 'N/A' },
    { id: 'issues', header: 'Issues', accessorFn: (h) => h.issueLabel, cell: ({ row }) => <span className={`text-xs ${row.original.violationCount ? 'text-red-400' : row.original.warningCount ? 'text-amber-500' : 'text-[var(--text-muted)]'}`}>{row.original.issueLabel}</span> },
    { id: 'when', header: 'When', accessorFn: (h) => h.validated_at || '', cell: ({ getValue }) => <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">{getValue() ? new Date(getValue()).toLocaleString() : 'N/A'}</span> },
  ], [])

  const ruleColumns = useMemo(() => [
    {
      id: 'name', header: 'Rule', accessorFn: (r) => r.rule_name || '',
      cell: ({ row }) => (
        <div className="min-w-0 max-w-[22rem]">
          <p className="font-medium text-[var(--text-primary)]">{row.original.rule_name}</p>
          {row.original.notes && <p className="text-xs text-[var(--text-muted)] line-clamp-2">{row.original.notes}</p>}
        </div>
      ),
    },
    {
      id: 'state', header: 'State', accessorFn: (r) => (r.is_active !== false ? 'Active' : 'Inactive'),
      cell: ({ getValue }) => <span className={`text-[11px] px-2 py-0.5 rounded border ${getValue() === 'Active' ? 'border-green-500/30 text-green-500' : 'border-[var(--input-border)] text-[var(--text-muted)]'}`}>{getValue()}</span>,
    },
    { id: 'types', header: 'Vehicle types', accessorFn: (r) => csv(r.applies_to_vehicle_types) || 'All' },
    { id: 'axles', header: 'Axles', accessorFn: (r) => csv(r.applies_to_axle_roles) || 'All' },
    { id: 'tread', header: 'Min tread (mm)', accessorFn: (r) => (r.min_tread_depth_mm == null ? null : Number(r.min_tread_depth_mm)), meta: { align: 'right' } },
    { id: 'age', header: 'Max age (y)', accessorFn: (r) => (r.max_tyre_age_years == null ? null : Number(r.max_tyre_age_years)), meta: { align: 'right' } },
    { id: 'sizes', header: 'Approved sizes', accessorFn: (r) => (r.approved_sizes?.length ? csv(r.approved_sizes) : 'Any'), cell: ({ getValue }) => <span className="font-mono text-xs line-clamp-2 max-w-[16rem] block">{getValue()}</span> },
    { id: 'retread', header: 'Retread', accessorFn: (r) => (r.allow_retread !== false ? `Yes, max ${r.max_retread_count ?? 'N/A'}` : 'No') },
    {
      id: 'actions', header: '', enableSorting: false, meta: { export: false },
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <button type="button" onClick={() => openRuleEdit(row.original)} className={`inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)] ${FOCUS}`} aria-label={`Edit rule ${row.original.rule_name}`}><Pencil size={14} aria-hidden="true" /></button>
          <button type="button" onClick={() => { setDeleteError(''); setConfirmDeleteRule(row.original) }} className={`inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded hover:bg-red-500/10 text-[var(--text-muted)] hover:text-red-400 ${FOCUS}`} aria-label={`Delete rule ${row.original.rule_name}`}><Trash2 size={14} aria-hidden="true" /></button>
        </div>
      ),
    },
  ], [openRuleEdit])

  const TABS = [
    { key: 'validate', label: 'Validate', icon: ShieldCheck },
    { key: 'audit', label: 'Fleet size audit', icon: ScanLine, count: loaded && !auditFailed ? audit.mismatch : null },
    { key: 'rules', label: 'Rules', icon: ListChecks, count: rules && !rulesError ? rs.total : null },
    { key: 'history', label: 'History', icon: History, count: validations && !validationsError ? hist.total : null },
  ]

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
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={async () => { try { await exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, fileBase, 'Size audit', { title: 'Fitment Size Audit' }) } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) } }} className={`btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] ${FOCUS}`} disabled={!filtered.length}>
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={async () => { try { await exportToPdf(exportRows, EXPORT_COLS.map((key, i) => ({ key, header: EXPORT_HEADERS[i] })), 'Fitment Size Audit', fileBase, 'landscape') } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) } }} className={`btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] ${FOCUS}`} disabled={!filtered.length}>
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
          </div>
        ) : tab === 'rules' ? (
          <button type="button" onClick={openRuleCreate} className={`btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px] ${FOCUS}`} disabled={notProvisioned}>
            <Plus size={14} aria-hidden="true" /> New rule
          </button>
        ) : null}
      />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-[var(--gap-grid)]">
        {tiles.map((k, i) => (
          !loaded
            ? <div key={k.label} className="card !p-4 space-y-3"><Skeleton className="h-3 w-2/3" /><Skeleton className="h-7 w-1/2" /><Skeleton className="h-2.5 w-3/4" /></div>
            : <StatTile key={k.label} index={i} {...k} />
        ))}
      </div>

      <div role="tablist" aria-label="Fitment sections" className="flex gap-1 overflow-x-auto border-b border-[var(--input-border)]">
        {TABS.map((t) => {
          const Icon = t.icon
          const active = tab === t.key
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-1.5 min-h-[44px] px-4 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${FOCUS} ${active ? 'border-[var(--accent)] text-[var(--text-primary)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
            >
              <Icon size={15} aria-hidden="true" /> {t.label}
              {t.count != null && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--input-bg)] text-[var(--text-secondary)] tabular-nums">{t.count}</span>}
            </button>
          )
        })}
      </div>

      {error && <ErrorBanner title="Could not load fitment data." message={error} onRetry={load} />}

      {notProvisioned && (tab === 'rules' || tab === 'history') && (
        <Card tone="warn" className="items-start gap-[var(--space-3)]" style={{ flexDirection: 'row' }}>
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-[var(--text-primary)] font-medium">The fitment rule engine is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V208_FITMENT_RULES.sql</span>, then reload. The Validate tab still runs against the built-in default policy.
            </p>
          </div>
        </Card>
      )}

      {/* ── VALIDATE TAB ─────────────────────────────────────────────────────── */}
      {tab === 'validate' && (
        <div className="space-y-4">
          <Card>
            <CardHeader icon={Gauge} title="Pre-installation check" description={rules && rules.length ? `${rs.active} active rule${rs.active === 1 ? '' : 's'} available; the best match for the target vehicle is applied.` : 'No custom rules yet, so the built-in default policy applies.'} />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="label" htmlFor="fv-serial">Tyre serial (required)</label>
                <input id="fv-serial" className={`input w-full min-h-[44px] ${FOCUS}`} placeholder="e.g. AA10293" value={vForm.tyre_serial} maxLength={120} onChange={(e) => setV('tyre_serial', e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="fv-asset">Target asset no. (optional)</label>
                <input id="fv-asset" className={`input w-full min-h-[44px] ${FOCUS}`} placeholder="e.g. TM517" value={vForm.asset_no} maxLength={120} onChange={(e) => setV('asset_no', e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="fv-position">Position code (optional)</label>
                <input id="fv-position" className={`input w-full min-h-[44px] ${FOCUS}`} placeholder="e.g. A2LO" value={vForm.position_code} maxLength={60} onChange={(e) => setV('position_code', e.target.value)} />
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => runValidation(false)} className={`btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60 ${FOCUS}`} disabled={busy}>
                <FlaskConical size={14} aria-hidden="true" /> {vSimulating ? 'Simulating...' : 'Simulate'}
              </button>
              <button type="button" onClick={() => runValidation(true)} className={`btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60 ${FOCUS}`} disabled={busy}>
                <Play size={14} aria-hidden="true" /> {vSaving ? 'Validating...' : 'Validate and record'}
              </button>
              <span className="text-xs text-[var(--text-muted)] inline-flex items-center gap-1.5 ml-auto self-center">
                <Info size={12} aria-hidden="true" /> Simulate previews only. Validate and record writes to the ledger.
              </span>
            </div>
          </Card>

          {vError && (
            <Card tone="crit" role="alert" className="items-start gap-[var(--space-3)]" style={{ flexDirection: 'row' }}>
              <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
              <p className="text-red-400 text-sm">{vError}</p>
            </Card>
          )}

          {vResult && (
            <Card tone={vResult.is_valid ? 'good' : 'crit'} aria-live="polite">
              <div className="flex items-center gap-2 flex-wrap">
                {vResult.is_valid
                  ? <CheckCircle2 size={20} className="text-green-500" aria-hidden="true" />
                  : <XCircle size={20} className="text-red-400" aria-hidden="true" />}
                <span className={`text-base font-semibold ${vResult.is_valid ? 'text-green-500' : 'text-red-400'}`}>
                  {vResult.is_valid ? 'Fitment approved' : 'Fitment rejected'}
                </span>
                {vResult.preview && (
                  <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border border-[var(--input-border)] text-[var(--text-secondary)]">Preview, not saved</span>
                )}
                {vContext?.rule?._default && (
                  <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border border-[var(--input-border)] text-[var(--text-muted)]">Default policy</span>
                )}
              </div>

              <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 text-sm">
                {[
                  ['Serial', vForm.tyre_serial, true],
                  ['Size', vContext?.tyre?.size, true],
                  ['Tread', vContext?.tyre?.tread_depth != null ? `${vContext.tyre.tread_depth} mm` : null],
                  ['Status', vContext?.tyre?.status],
                  ['Target asset', vForm.asset_no, true],
                  ['Vehicle type', vContext?.vehicle?.vehicle_type],
                  ['Spec size', vContext?.vehicle?.tyre_size, true],
                  ['Rule', vContext?.rule?.rule_name],
                ].map(([label, value, mono]) => (
                  <div key={label}>
                    <dt className="text-[var(--text-muted)] text-xs">{label}</dt>
                    <dd className={`${mono ? 'font-mono' : ''} text-[var(--text-secondary)]`}>{value || 'N/A'}</dd>
                  </div>
                ))}
              </dl>

              {vResult.violations?.length > 0 && (
                <div className="mt-4 space-y-2">
                  <div className="text-xs font-semibold text-red-400 uppercase tracking-wide">Violations ({vResult.violations.length})</div>
                  {vResult.violations.map((v, i) => (
                    <div key={i} className="flex items-start gap-2 p-2.5 rounded border border-red-500/30">
                      <XCircle size={16} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
                      <div>
                        <div className="text-sm text-[var(--text-primary)]">{v.message}</div>
                        <span className="text-[11px] font-mono text-red-400">{v.rule}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {vResult.warnings?.length > 0 && (
                <div className="mt-4 space-y-2">
                  <div className="text-xs font-semibold text-amber-500 uppercase tracking-wide">Warnings ({vResult.warnings.length})</div>
                  {vResult.warnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-2 p-2.5 rounded border border-amber-500/30">
                      <AlertTriangle size={16} className="text-amber-500 mt-0.5 shrink-0" aria-hidden="true" />
                      <div>
                        <div className="text-sm text-[var(--text-primary)]">{w.message}</div>
                        <span className="text-[11px] font-mono text-amber-500">{w.rule}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {vResult.is_valid && !vResult.violations?.length && !vResult.warnings?.length && (
                <div className="mt-4 text-green-500 text-sm flex items-center gap-2">
                  <CheckCircle2 size={16} aria-hidden="true" /> All available checks passed. Safe to install.
                </div>
              )}

              <div className="mt-4 p-3 rounded border border-[var(--input-border)]">
                <div className="text-xs font-semibold text-[var(--text-secondary)] flex items-center gap-1.5 mb-1.5">
                  <Info size={13} aria-hidden="true" /> Not evaluated (data unavailable)
                </div>
                <p className="text-xs text-[var(--text-muted)] mb-2">{FITMENT_UNAVAILABLE_NOTE}</p>
                <ul className="flex flex-wrap gap-1.5">
                  {FITMENT_UNAVAILABLE_CHECKS.map((c) => (
                    <li key={c.rule} className="text-[11px] px-2 py-0.5 rounded border border-[var(--input-border)] text-[var(--text-muted)]" title={`needs ${c.needs}`}>
                      {c.label}
                    </li>
                  ))}
                </ul>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ── FLEET SIZE AUDIT TAB ─────────────────────────────────────────────── */}
      {tab === 'audit' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader title="Fitment breakdown" description={audit.compliancePct != null ? `Correct-size rate of checkable assets: ${audit.compliancePct}%` : 'No checkable assets yet'} />
              <div className="h-64" role="img" aria-label={`Fitment breakdown: ${audit.mismatch} wrong size, ${audit.match} correct size, ${audit.unknown} no data`}>
                {!loaded ? <Skeleton className="w-full h-full" /> : hasAny ? <Doughnut data={donutData} options={donutOpts} /> : <EmptyChart empty={auditFailed ? 'Could not load this chart.' : 'No fleet assets in scope.'} />}
              </div>
            </Card>
            <Card>
              <CardHeader title="Wrong-size assets by site" description="Top 10 sites" />
              <div className="h-64" role="img" aria-label={`Wrong-size assets by site, ${bySiteMismatch.length} sites`}>
                {!loaded ? <Skeleton className="w-full h-full" /> : bySiteMismatch.length ? <Bar data={barData} options={barOpts} /> : <EmptyChart empty={auditFailed ? 'Could not load this chart.' : 'No wrong-size fitments found.'} />}
              </div>
            </Card>
          </div>

          <Card>
            <CardHeader icon={ScanLine} title="Fleet size register" />
            <div className="flex flex-wrap items-end gap-2 mb-3">
              <SearchBox id="fv-audit-search" label="Search assets" value={search} onChange={setSearch} placeholder="Search asset, make or model, size" />
              <label htmlFor="fv-band" className="sr-only">Result</label>
              <select id="fv-band" className={`input min-h-[44px] ${FOCUS}`} value={bandFilter} onChange={(e) => setBandFilter(e.target.value)}>
                <option value="all">All results</option>
                <option value="mismatch">Wrong size</option>
                <option value="match">Correct size</option>
                <option value="unknown">No data</option>
              </select>
              <label htmlFor="fv-site" className="sr-only">Site</label>
              <select id="fv-site" className={`input min-h-[44px] ${FOCUS}`} value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)}>
                <option value="">All sites</option>
                {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              {hasFilters && <button type="button" onClick={clearFilters} className={`btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] ${FOCUS}`}><X size={14} aria-hidden="true" /> Clear</button>}
              <span className="text-xs text-[var(--text-muted)] ml-auto self-center" aria-live="polite">{filtered.length} of {counts.total}</span>
            </div>
            <EnterpriseTable
              columns={auditColumns}
              data={filtered}
              getRowId={(r, i) => String(r.asset_no || `row-${i}`)}
              loading={!loaded}
              error={auditFailed ? error : null}
              onRetry={load}
              enableGlobalFilter={false}
              enableExport={false}
              viewKey="fitment-size-audit"
              emptyMessage={hasAny ? 'No assets match these filters.' : 'No fleet assets found for this country.'}
              initialPageSize={25}
            />
          </Card>
        </div>
      )}

      {/* ── RULES TAB ────────────────────────────────────────────────────────── */}
      {tab === 'rules' && (
        <Card>
          <CardHeader icon={ListChecks} title="Fitment policy" description="Age, retread and dual-pair fields are stored for policy completeness; size, tread and lifecycle checks are enforced." />
          <div className="flex flex-wrap items-end gap-2 mb-3">
            <SearchBox id="fv-rule-search" label="Search rules" value={ruleSearch} onChange={setRuleSearch} placeholder="Search name, types, sizes, notes" />
            <label htmlFor="fv-rule-state" className="sr-only">Rule state</label>
            <select id="fv-rule-state" className={`input min-h-[44px] ${FOCUS}`} value={ruleState} onChange={(e) => setRuleState(e.target.value)}>
              <option value="">All rules</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
            {(ruleSearch || ruleState) && <button type="button" onClick={() => { setRuleSearch(''); setRuleState('') }} className={`btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] ${FOCUS}`}><X size={14} aria-hidden="true" /> Clear</button>}
            {!notProvisioned && (
              <button type="button" onClick={openRuleCreate} className={`btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px] ${FOCUS}`}><Plus size={14} aria-hidden="true" /> New rule</button>
            )}
          </div>
          <EnterpriseTable
            columns={ruleColumns}
            data={rulesFiltered}
            getRowId={(r) => String(r.id)}
            loading={rules === null}
            error={rulesError || null}
            onRetry={loadRules}
            enableGlobalFilter={false}
            exportFileName={reportFileName('Fitment Rules')}
            reportMeta={{ title: 'Fitment rules' }}
            emptyMessage={
              ruleSearch || ruleState ? 'No rules match these filters.'
                : notProvisioned ? 'Enable the engine (apply V208) to configure rules.'
                  : 'No fitment rules yet. The Validate tab uses a built-in default policy until you add one.'
            }
            initialPageSize={25}
          />
        </Card>
      )}

      {/* ── HISTORY TAB ──────────────────────────────────────────────────────── */}
      {tab === 'history' && (
        <Card>
          <CardHeader icon={History} title="Validation ledger" description={hist.capped ? `Showing the latest ${HISTORY_LIMIT} validations; older records exist but are not loaded here.` : `Latest validations (up to ${HISTORY_LIMIT}).`} />
          {validations && !validationsError && hist.total > 0 && (
            <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 text-sm">
              <div><dt className="text-xs text-[var(--text-muted)]">Approved</dt><dd className="font-semibold text-[var(--text-primary)] tabular-nums">{hist.approved}</dd></div>
              <div><dt className="text-xs text-[var(--text-muted)]">Rejected</dt><dd className="font-semibold text-[var(--text-primary)] tabular-nums">{hist.rejected}</dd></div>
              <div><dt className="text-xs text-[var(--text-muted)]">Last 7 days</dt><dd className="font-semibold text-[var(--text-primary)] tabular-nums">{hist.last7Days}</dd></div>
              <div><dt className="text-xs text-[var(--text-muted)]">Most common violation</dt><dd className="font-mono text-xs text-[var(--text-primary)]">{hist.topViolation ? `${hist.topViolation.rule} (${hist.topViolation.count})` : 'None'}</dd></div>
            </dl>
          )}
          <div className="flex flex-wrap items-end gap-2 mb-3">
            <SearchBox id="fv-hist-search" label="Search validations" value={historySearch} onChange={setHistorySearch} placeholder="Search serial, asset or position" />
            <label htmlFor="fv-hist-result" className="sr-only">Result</label>
            <select id="fv-hist-result" className={`input min-h-[44px] ${FOCUS}`} value={historyResult} onChange={(e) => setHistoryResult(e.target.value)}>
              <option value="">All results</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
            {(historySearch || historyResult) && <button type="button" onClick={() => { setHistorySearch(''); setHistoryResult('') }} className={`btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] ${FOCUS}`}><X size={14} aria-hidden="true" /> Clear</button>}
          </div>
          <EnterpriseTable
            columns={historyColumns}
            data={histFiltered}
            getRowId={(h) => String(h.id)}
            loading={validations === null}
            error={validationsError || null}
            onRetry={loadValidations}
            enableGlobalFilter={false}
            exportFileName={reportFileName('Fitment Validation Ledger')}
            reportMeta={{ title: 'Fitment validation ledger' }}
            emptyMessage={
              historySearch || historyResult ? 'No validations match these filters.'
                : notProvisioned ? 'Enable the engine (apply V208) to record validations.'
                  : 'No validations recorded yet. Run a check on the Validate tab.'
            }
            initialPageSize={25}
          />
        </Card>
      )}

      {/* Rule create / edit modal. The submit button stays INSIDE the form; Modal
          caps the panel to the viewport and scrolls the body only. */}
      {showRuleModal && (
        <Modal
          open
          onClose={closeRuleModal}
          size="lg"
          title={editingRule ? 'Edit fitment rule' : 'New fitment rule'}
        >
          <form onSubmit={submitRule} className="space-y-4">
            <div>
              <label className="label" htmlFor="fr-name">Rule name (required)</label>
              <input id="fr-name" className="input w-full min-h-[44px]" placeholder="e.g. Steer axle, highway tractors" value={ruleForm.rule_name} maxLength={200} onChange={(e) => setRule('rule_name', e.target.value)} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label" htmlFor="fr-types">Applies to vehicle types (comma-separated, blank = all)</label>
                <input id="fr-types" className="input w-full min-h-[44px]" placeholder="e.g. tractor, rigid_truck" value={ruleForm.applies_to_vehicle_types} onChange={(e) => setRule('applies_to_vehicle_types', e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="fr-axles">Applies to axle roles (comma-separated, blank = all)</label>
                <input id="fr-axles" className="input w-full min-h-[44px]" placeholder="e.g. steer, drive" value={ruleForm.applies_to_axle_roles} onChange={(e) => setRule('applies_to_axle_roles', e.target.value)} />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="fr-sizes">Approved sizes (comma-separated, blank = any)</label>
              <input id="fr-sizes" className="input w-full min-h-[44px]" placeholder="e.g. 315/80R22.5, 295/80R22.5" value={ruleForm.approved_sizes} onChange={(e) => setRule('approved_sizes', e.target.value)} />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <label className="label" htmlFor="fr-tread">Min tread (mm)</label>
                <input id="fr-tread" className="input w-full min-h-[44px]" type="number" step="0.1" min="0" value={ruleForm.min_tread_depth_mm} onChange={(e) => setRule('min_tread_depth_mm', e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="fr-age">Max age (years)</label>
                <input id="fr-age" className="input w-full min-h-[44px]" type="number" step="0.5" min="0" value={ruleForm.max_tyre_age_years} onChange={(e) => setRule('max_tyre_age_years', e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="fr-retreads">Max retreads</label>
                <input id="fr-retreads" className="input w-full min-h-[44px]" type="number" step="1" min="0" value={ruleForm.max_retread_count} onChange={(e) => setRule('max_retread_count', e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="fr-dual">Max dual difference (mm)</label>
                <input id="fr-dual" className="input w-full min-h-[44px]" type="number" step="0.1" min="0" value={ruleForm.max_tread_delta_dual_mm} onChange={(e) => setRule('max_tread_delta_dual_mm', e.target.value)} />
              </div>
            </div>
            <fieldset className="flex flex-wrap gap-4">
              <legend className="sr-only">Policy switches</legend>
              <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer min-h-[44px]">
                <input type="checkbox" className="accent-[var(--accent)] w-4 h-4" checked={ruleForm.allow_retread} onChange={(e) => setRule('allow_retread', e.target.checked)} /> Allow retread
              </label>
              <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer min-h-[44px]">
                <input type="checkbox" className="accent-[var(--accent)] w-4 h-4" checked={ruleForm.require_matching_pair} onChange={(e) => setRule('require_matching_pair', e.target.checked)} /> Require matching pair
              </label>
              <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer min-h-[44px]">
                <input type="checkbox" className="accent-[var(--accent)] w-4 h-4" checked={ruleForm.is_active} onChange={(e) => setRule('is_active', e.target.checked)} /> Active
              </label>
            </fieldset>
            <div>
              <label className="label" htmlFor="fr-notes">Notes (optional)</label>
              <textarea id="fr-notes" className="input w-full min-h-[60px] resize-y" placeholder="e.g. GCC steer-axle policy" value={ruleForm.notes} maxLength={8000} onChange={(e) => setRule('notes', e.target.value)} />
            </div>

            <p className="text-[11px] text-[var(--text-muted)] flex items-start gap-1.5">
              <Info size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
              Age, retread and dual-pair fields are stored for policy completeness but are not evaluated on this dataset (source data absent). Size, tread and lifecycle checks are enforced.
            </p>

            {ruleFormError && (
              <div role="alert" className="flex items-start gap-2 text-sm text-red-400 border border-red-500/30 rounded-lg px-3 py-2">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {ruleFormError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button type="button" onClick={closeRuleModal} className="btn-secondary text-sm min-h-[44px]" disabled={ruleSaving}>Cancel</button>
              <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={ruleSaving}>
                {ruleSaving ? 'Saving...' : editingRule ? 'Save changes' : 'Create rule'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {confirmDeleteRule && (
        <Modal
          open
          onClose={() => { if (!deletingRule) setConfirmDeleteRule(null) }}
          size="sm"
          title="Delete fitment rule"
          footer={(
            <>
              <button type="button" onClick={() => setConfirmDeleteRule(null)} className="btn-secondary text-sm min-h-[44px]" disabled={deletingRule}>Cancel</button>
              <button type="button" onClick={doDeleteRule} className="btn-danger text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={deletingRule}>
                {deletingRule ? 'Deleting...' : 'Delete rule'}
              </button>
            </>
          )}
        >
          <div className="flex items-start gap-3">
            <Trash2 size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
            <p className="text-sm text-[var(--text-secondary)]">Delete <span className="font-semibold text-[var(--text-primary)]">{confirmDeleteRule.rule_name}</span>? This cannot be undone.</p>
          </div>
          {deleteError && <p role="alert" className="mt-3 text-sm text-red-400">{deleteError}</p>}
        </Modal>
      )}
    </div>
  )
}

function EmptyChart({ empty = 'No data.' }) {
  return <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)] text-center px-4">{empty}</div>
}
