/**
 * FitmentValidation (route /fitment-validation), rebuilt on the Command Center
 * kit. The single home for fitment assurance, four tabs:
 *
 *   - Validate          Pre-installation check of one tyre on one asset. Every
 *                       check reads real records (tyre_records, vehicle_fleet,
 *                       tyre_specifications fitment specs, tyre_spec_catalog,
 *                       fitment_rules). A check with no source data shows
 *                       "Not checked" and is left out of the score. Preview
 *                       runs the checks; Validate fitment also saves to the
 *                       fitment_validations ledger.
 *   - Fleet Size Audit  Every asset's fitted tyre sizes against its spec size.
 *   - Rules             CRUD for fitment_rules (V208) with on/off toggles.
 *   - History           The recent validation ledger.
 *
 * Pure logic: src/lib/fitmentValidation.js (engine), fitmentValidationAnalytics.js
 * (audit/history/rule summaries, export shapes) and fitmentValidationView.js
 * (checks, score, audit status, categories). I/O: src/lib/api/fitmentValidation.js.
 * A failed read renders an error with Retry, never an empty list or 0.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ShieldCheck, CheckCircle2, AlertTriangle, HelpCircle, Percent, ListChecks,
  RefreshCw, Download, Plus, Search, FileSpreadsheet, FileText, Pencil, Trash2,
  X, Eye,
} from 'lucide-react'
import {
  Card, CardState, Kpi, KitTable, PageHero, Tabs, VehicleThumb, fmtInt,
} from '../components/commandCenter/kit'
import Modal from '../components/ui/Modal'
import FitmentRuleModals from '../components/fitment/FitmentRuleModals'
import FitmentResultCard from '../components/fitment/FitmentResultCard'
import { useSettings } from '../contexts/SettingsContext'
import {
  loadFitmentData, listRules, createRule, updateRule, deleteRule,
  listValidations, createValidation, findTyreBySerial, findVehicleByAsset,
  isFitmentProvisioned, listFitmentSpecs, listSpecCatalog, listActiveBySerial,
  setRuleActive,
} from '../lib/api/fitmentValidation'
import { summarizeFitments, validateFitment, matchRules } from '../lib/fitmentValidation'
import {
  vehicleLabel, auditSummary, auditExportRows, historyRows, filterHistory,
  historySummary, rulesSummary, filterRules,
} from '../lib/fitmentValidationAnalytics'
import {
  AXLE_ROLES, AUDIT_STATUS, SEVERITY_OPTIONS, auditStatus, filterAudit,
  distinctValues, complianceByCategory, fleetFootprint, buildFitmentChecks,
  scoreChecks, checksToLedger, duplicateFitments, catalogFor, catalogLoadSpeed,
  specsForVehicle, specForPosition, ruleScope, ruleEnforces,
} from '../lib/fitmentValidationView'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import './FitmentValidation.css'

const HISTORY_LIMIT = 100
const NA = <span className="cc-na">N/A</span>

const EMPTY_RULE = {
  rule_name: '', applies_to_vehicle_types: '', applies_to_axle_roles: '',
  approved_sizes: '', min_tread_depth_mm: '3', max_tyre_age_years: '6',
  allow_retread: true, max_retread_count: '2', require_matching_pair: true,
  max_tread_delta_dual_mm: '2', is_active: true, notes: '',
}
const EMPTY_V = { asset_no: '', tyre_serial: '', catalog_id: '', axle_role: '', position_code: '', load_speed: '', pressure: '' }

const csv = (v) => (Array.isArray(v) ? v.join(', ') : '')
const up = (v) => String(v ?? '').trim().toUpperCase()

const TABS = [
  { key: 'validate', label: 'Validate' },
  { key: 'audit', label: 'Fleet Size Audit' },
  { key: 'rules', label: 'Rules' },
  { key: 'history', label: 'History' },
]

export default function FitmentValidation() {
  const navigate = useNavigate()
  const { activeCountry } = useSettings()
  const countryParam = activeCountry && activeCountry !== 'All' ? activeCountry : null

  const [tab, setTab] = useState('validate')
  const [banner, setBanner] = useState('')

  // Fleet + fitted tyres
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  // Specs and catalogue
  const [specs, setSpecs] = useState(null)
  const [catalog, setCatalog] = useState(null)
  const [refError, setRefError] = useState('')
  // Rules + provisioning
  const [rules, setRules] = useState(null)
  const [rulesError, setRulesError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [ruleSearch, setRuleSearch] = useState('')
  const [ruleState, setRuleState] = useState('')
  const [togglingId, setTogglingId] = useState(null)
  // Ledger
  const [validations, setValidations] = useState(null)
  const [validationsError, setValidationsError] = useState('')
  const [historyResult, setHistoryResult] = useState('')
  const [historySearch, setHistorySearch] = useState('')
  // Audit filters
  const [aSite, setASite] = useState('')
  const [aType, setAType] = useState('')
  const [aSeverity, setASeverity] = useState('')
  const [aSearch, setASearch] = useState('')
  const [viewRow, setViewRow] = useState(null)
  // Validate form
  const [vForm, setVForm] = useState(EMPTY_V)
  const [vResult, setVResult] = useState(null)
  const [vContext, setVContext] = useState(null)
  const [vError, setVError] = useState('')
  const [vSimulating, setVSimulating] = useState(false)
  const [vSaving, setVSaving] = useState(false)
  // Rule CRUD
  const [showRuleModal, setShowRuleModal] = useState(false)
  const [editingRule, setEditingRule] = useState(null)
  const [ruleForm, setRuleForm] = useState(EMPTY_RULE)
  const [ruleSaving, setRuleSaving] = useState(false)
  const [ruleFormError, setRuleFormError] = useState('')
  const [confirmDeleteRule, setConfirmDeleteRule] = useState(null)
  const [deletingRule, setDeletingRule] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  // ── Loaders ────────────────────────────────────────────────────────────────
  const loadRules = useCallback(async () => {
    setRulesError('')
    try {
      const rows = await listRules({ country: activeCountry })
      setRules(Array.isArray(rows) ? rows : [])
    } catch (err) {
      setRules(null)
      setRulesError(toUserMessage(err, 'Could not load fitment rules.'))
    }
  }, [activeCountry])

  const loadValidations = useCallback(async () => {
    setValidationsError('')
    try {
      const rows = await listValidations({ country: activeCountry, limit: HISTORY_LIMIT })
      setValidations(Array.isArray(rows) ? rows : [])
    } catch (err) {
      setValidations(null)
      setValidationsError(toUserMessage(err, 'Could not load the validation history.'))
    }
  }, [activeCountry])

  const loadRefs = useCallback(async () => {
    setRefError('')
    try {
      const [s, c] = await Promise.all([listFitmentSpecs({ country: activeCountry }), listSpecCatalog({ country: activeCountry })])
      setSpecs(s); setCatalog(c)
    } catch (err) {
      setSpecs(null); setCatalog(null)
      setRefError(toUserMessage(err, 'Could not load tyre specifications.'))
    }
  }, [activeCountry])

  const loadFleet = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [res, provisioned] = await Promise.all([
        loadFitmentData({ country: activeCountry }),
        isFitmentProvisioned().catch(() => true),
      ])
      setData(res)
      setNotProvisioned(!provisioned)
    } catch (err) {
      setData(null)
      setError(toUserMessage(err, 'Could not load fleet or tyre data.'))
    } finally {
      setLoading(false)
    }
  }, [activeCountry])

  const load = useCallback(() => Promise.all([loadFleet(), loadRules(), loadValidations(), loadRefs()]), [loadFleet, loadRules, loadValidations, loadRefs])
  useEffect(() => { load() }, [load])

  // ── Derivations ────────────────────────────────────────────────────────────
  const { rows: enriched, counts } = useMemo(() => summarizeFitments(data?.vehicles || [], data?.tyres || []), [data])
  const audit = useMemo(() => auditSummary(counts), [counts])
  const foot = useMemo(() => fleetFootprint(data?.vehicles), [data])
  const siteOptions = useMemo(() => distinctValues(enriched, 'site'), [enriched])
  const typeOptions = useMemo(() => distinctValues(enriched, 'vehicle_type'), [enriched])
  const auditRows = useMemo(() => filterAudit(enriched, { site: aSite, vehicleType: aType, severity: aSeverity, search: aSearch }), [enriched, aSite, aType, aSeverity, aSearch])
  const categories = useMemo(() => complianceByCategory(enriched, 6), [enriched])
  const hist = useMemo(() => historySummary(validations || [], { now: new Date(), limit: HISTORY_LIMIT }), [validations])
  const histRows = useMemo(() => historyRows(validations || []), [validations])
  const histFiltered = useMemo(() => filterHistory(histRows, { result: historyResult, search: historySearch }), [histRows, historyResult, historySearch])
  const rs = useMemo(() => rulesSummary(rules || []), [rules])
  const rulesFiltered = useMemo(() => filterRules(rules || [], { state: ruleState, search: ruleSearch }), [rules, ruleState, ruleSearch])
  const fleetState = { loading, data, error, retry: loadFleet }

  // Selected asset for the Validate form (from the loaded fleet).
  const selectedVehicle = useMemo(() => {
    const a = up(vForm.asset_no)
    if (!a) return null
    return (data?.vehicles || []).find((v) => up(v.asset_no) === a) || null
  }, [vForm.asset_no, data])
  const vehicleSpecs = useMemo(() => specsForVehicle(specs || [], selectedVehicle?.vehicle_type), [specs, selectedVehicle])
  const positionSpec = useMemo(() => specForPosition(vehicleSpecs.rows, vForm.axle_role), [vehicleSpecs, vForm.axle_role])
  const chosenCatalog = useMemo(() => (catalog || []).find((c) => c.id === vForm.catalog_id) || null, [catalog, vForm.catalog_id])

  // ── Exports (audit: every filtered row) ────────────────────────────────────
  const EXPORT_COLS = ['asset_no', 'vehicle', 'site', 'spec', 'fitted', 'mismatch', 'fittedCount', 'status']
  const EXPORT_HEADERS = ['Asset', 'Vehicle', 'Site', 'Spec size', 'Fitted size(s)', 'Result', 'Fitted tyres', 'Status']
  const exportRows = useMemo(() => auditExportRows(auditRows), [auditRows])
  const fileBase = reportFileName('Fitment Size Audit', countryParam || '')
  const exportExcel = async () => {
    try { await exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, fileBase, 'Size audit', { title: 'Fitment Size Audit' }) } catch (e) { setBanner(toUserMessage(e, 'Could not export. Try again.')) }
  }
  const exportPdf = async () => {
    try { await exportToPdf(exportRows, EXPORT_COLS.map((key, i) => ({ key, header: EXPORT_HEADERS[i] })), 'Fitment Size Audit', fileBase, 'landscape') } catch (e) { setBanner(toUserMessage(e, 'Could not export. Try again.')) }
  }

  // ── Validate ───────────────────────────────────────────────────────────────
  const setV = (k, v) => setVForm((f) => ({ ...f, [k]: v }))
  const pickCatalog = (id) => {
    const row = (catalog || []).find((c) => c.id === id)
    setVForm((f) => ({ ...f, catalog_id: id, load_speed: row ? catalogLoadSpeed(row) : f.load_speed }))
  }

  const runValidation = useCallback(async (persist) => {
    setVError('')
    const serial = vForm.tyre_serial.trim()
    const asset = vForm.asset_no.trim()
    const position = vForm.position_code.trim()
    if (!serial) { setVError('Enter a tyre serial to validate.'); return }
    if (persist) setVSaving(true); else setVSimulating(true)
    try {
      const [tyre, active, vehicle] = await Promise.all([
        findTyreBySerial(serial, { country: activeCountry }),
        listActiveBySerial(serial, { country: activeCountry }),
        selectedVehicle ? Promise.resolve(selectedVehicle) : (asset ? findVehicleByAsset(asset, { country: activeCountry }) : Promise.resolve(null)),
      ])
      const rule = matchRules(rules || [], vehicle)[0]
      const engine = validateFitment(tyre, vehicle, rule)
      const size = chosenCatalog?.size || tyre?.size || ''
      const loadSpeed = vForm.load_speed.trim() || catalogLoadSpeed(catalogFor(catalog || [], size, tyre?.brand)[0] || catalogFor(catalog || [], size)[0])
      const { checks } = buildFitmentChecks({
        tyre, tyreLooked: true, vehicle, axleRole: vForm.axle_role, size, specs: specs || [], rule,
        loadSpeed, pressure: vForm.pressure, engine,
        duplicates: duplicateFitments(active, { assetNo: asset, position }),
      })
      const score = scoreChecks(checks)
      setVContext({ tyre, vehicle, rule })
      setVResult({ checks, score, preview: !persist })

      if (persist) {
        if (!tyre) { setVError(`No tyre matched serial "${serial}". Nothing was saved.`); return }
        const ledger = checksToLedger(checks)
        await createValidation({
          tyre_serial: serial,
          asset_no: asset || null,
          position_code: position || null,
          axle_role: vForm.axle_role || null,
          country: countryParam,
          is_valid: ledger.is_valid,
          violations: ledger.violations,
          warnings: ledger.warnings,
        })
        await loadValidations()
      }
    } catch (err) {
      setVError(toUserMessage(err, 'Validation failed. Try again.'))
    } finally {
      setVSaving(false); setVSimulating(false)
    }
  }, [vForm, rules, specs, catalog, chosenCatalog, selectedVehicle, activeCountry, countryParam, loadValidations])

  const busy = vSimulating || vSaving

  // Chips under the form, from the last result.
  const chips = useMemo(() => {
    if (!vResult) return []
    const by = Object.fromEntries(vResult.checks.map((c) => [c.key, c]))
    const out = []
    out.push(positionSpec || vehicleSpecs.rows.length ? { tone: 'good', text: 'Specification found' } : { tone: 'muted', text: 'No specification for this vehicle' })
    if (by.duplicate?.status === 'pass') out.push({ tone: 'good', text: 'Serial unique' })
    else if (by.duplicate?.status === 'fail') out.push({ tone: 'bad', text: 'Serial active elsewhere' })
    if (by.axle?.status === 'pass') out.push({ tone: 'good', text: 'Position supported' })
    else if (by.axle?.status === 'advisory') out.push({ tone: 'warn', text: 'Position has no spec' })
    if (by.pressure?.status === 'pass') out.push({ tone: 'good', text: 'Pressure on target' })
    else if (by.pressure?.status === 'advisory' || by.pressure?.status === 'fail') out.push({ tone: by.pressure.status === 'fail' ? 'bad' : 'warn', text: `Pressure ${by.pressure.value}` })
    return out
  }, [vResult, positionSpec, vehicleSpecs])

  // ── Rule CRUD ──────────────────────────────────────────────────────────────
  const openRuleCreate = (prefill = {}) => { setEditingRule(null); setRuleForm({ ...EMPTY_RULE, ...prefill }); setRuleFormError(''); setShowRuleModal(true) }
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

  const toggleRule = useCallback(async (r) => {
    setTogglingId(r.id); setBanner('')
    try {
      const saved = await setRuleActive(r.id, r.is_active === false)
      setRules((list) => (list || []).map((x) => (x.id === r.id ? { ...x, ...saved } : x)))
    } catch (err) {
      setBanner(toUserMessage(err, 'Could not change the rule. Try again.'))
    } finally {
      setTogglingId(null)
    }
  }, [])

  // ── Audit row actions ──────────────────────────────────────────────────────
  const resolveRow = (r) => {
    setVForm({ ...EMPTY_V, asset_no: r.asset_no || '' })
    setVResult(null); setVError('')
    setTab('validate')
    window.scrollTo?.({ top: 0, behavior: 'smooth' })
  }
  const createRuleFor = (r) => openRuleCreate({
    rule_name: `${r.vehicle_type || 'Vehicle'} approved sizes`,
    applies_to_vehicle_types: r.vehicle_type || '',
    approved_sizes: (r.fittedSizes || []).join(', '),
  })

  // ── Columns ────────────────────────────────────────────────────────────────
  const auditColumns = useMemo(() => [
    {
      key: 'vehicle', header: 'Vehicle', sortValue: (r) => r.asset_no,
      cell: (r) => (
        <span className="fv-veh"><VehicleThumb row={r} size="sm" />
          <span><b>{r.asset_no || 'N/A'}</b><small>{vehicleLabel(r) || 'N/A'}{r.site ? ` · ${r.site}` : ''}</small></span>
        </span>
      ),
    },
    { key: 'spec', header: 'Required size', cell: (r) => (r.spec ? <span className="fv-mono">{r.spec}</span> : NA) },
    {
      key: 'fitted', header: 'Fitted size', sortValue: (r) => r.fittedSizes.join(', '),
      cell: (r) => (r.fittedSizes.length ? <span className={`fv-mono ${r.band === 'mismatch' ? 'fv-bad' : ''}`}>{r.fittedSizes.join(', ')}</span> : NA),
    },
    {
      key: 'position', header: 'Position', sortable: false,
      cell: (r) => {
        if (r.band !== 'mismatch') return r.fittedCount ? `${r.fittedCount} tyres` : NA
        const pos = r.fitted.filter((t) => !t.matches && t.sizeNorm).map((t) => t.position).filter((p) => p && p !== 'N/A')
        return pos.length ? <span className="fv-mono">{[...new Set(pos)].slice(0, 4).join(', ')}</span> : NA
      },
    },
    { key: 'vehicle_type', header: 'Vehicle type', cell: (r) => r.vehicle_type || NA },
    {
      key: 'status', header: 'Status', sortValue: (r) => AUDIT_STATUS[auditStatus(r)].label,
      cell: (r) => { const m = AUDIT_STATUS[auditStatus(r)]; return <span className={`cc-pill ${m.tone}`}>{m.label}</span> },
    },
    {
      key: 'action', header: 'Action', sortable: false,
      cell: (r) => {
        const st = auditStatus(r)
        return (
          <span className="fv-actions">
            <button type="button" className="fv-link" onClick={() => setViewRow(r)}>View</button>
            {st === 'wrong_size' && <button type="button" className="fv-link" onClick={() => resolveRow(r)}>Resolve</button>}
            {st === 'no_spec' && !notProvisioned && <button type="button" className="fv-link" onClick={() => createRuleFor(r)}>Create rule</button>}
          </span>
        )
      },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [notProvisioned])

  const historyColumns = useMemo(() => [
    { key: 'result', header: 'Result', cell: (h) => <span className={`cc-pill ${h.is_valid ? 'good' : 'bad'}`}>{h.result}</span> },
    { key: 'tyre_serial', header: 'Serial', cell: (h) => (h.tyre_serial ? <span className="fv-mono">{h.tyre_serial}</span> : NA) },
    { key: 'asset_no', header: 'Asset', cell: (h) => h.asset_no || NA },
    { key: 'position_code', header: 'Position', cell: (h) => h.position_code || NA },
    { key: 'issueLabel', header: 'Issues', cell: (h) => <span className={h.violationCount ? 'fv-bad' : h.warningCount ? 'fv-warn' : 'fv-muted'}>{h.issueLabel}</span> },
    { key: 'validated_at', header: 'When', cell: (h) => (h.validated_at ? new Date(h.validated_at).toLocaleString() : NA) },
  ], [])

  const ruleColumns = useMemo(() => [
    { key: 'rule_name', header: 'Rule', cell: (r) => <span className="fv-rule-name"><b>{r.rule_name}</b>{r.notes && <small>{r.notes}</small>}</span> },
    { key: 'state', header: 'State', sortValue: (r) => (r.is_active !== false ? 'Active' : 'Inactive'), cell: (r) => <span className={`cc-pill ${r.is_active !== false ? 'good' : 'muted'}`}>{r.is_active !== false ? 'Active' : 'Inactive'}</span> },
    { key: 'types', header: 'Vehicle types', sortValue: (r) => csv(r.applies_to_vehicle_types), cell: (r) => csv(r.applies_to_vehicle_types) || 'All' },
    { key: 'axles', header: 'Axles', sortValue: (r) => csv(r.applies_to_axle_roles), cell: (r) => csv(r.applies_to_axle_roles) || 'All' },
    { key: 'min_tread_depth_mm', header: 'Min tread (mm)', numeric: true, sortValue: (r) => (r.min_tread_depth_mm == null ? null : Number(r.min_tread_depth_mm)), cell: (r) => (r.min_tread_depth_mm ?? NA) },
    { key: 'max_tyre_age_years', header: 'Max age (y)', numeric: true, sortValue: (r) => (r.max_tyre_age_years == null ? null : Number(r.max_tyre_age_years)), cell: (r) => (r.max_tyre_age_years ?? NA) },
    { key: 'sizes', header: 'Approved sizes', sortValue: (r) => csv(r.approved_sizes), cell: (r) => <span className="fv-mono">{r.approved_sizes?.length ? csv(r.approved_sizes) : 'Any'}</span> },
    { key: 'retread', header: 'Retread', sortValue: (r) => (r.allow_retread !== false ? 1 : 0), cell: (r) => (r.allow_retread !== false ? `Yes, max ${r.max_retread_count ?? 'N/A'}` : 'No') },
    {
      key: 'actions', header: '', sortable: false,
      cell: (r) => (
        <span className="fv-actions">
          <button type="button" className="cc-icon-btn" onClick={() => openRuleEdit(r)} aria-label={`Edit rule ${r.rule_name}`}><Pencil size={14} /></button>
          <button type="button" className="cc-icon-btn" onClick={() => { setDeleteError(''); setConfirmDeleteRule(r) }} aria-label={`Delete rule ${r.rule_name}`}><Trash2 size={14} /></button>
        </span>
      ),
    },
  ], [openRuleEdit])

  // ── KPIs ───────────────────────────────────────────────────────────────────
  const fleetFailed = !!error
  const activeRuleCount = rulesError || specs == null ? null : rs.active + specs.length
  const kpiLoading = loading && !data

  const auditCard = (
    <Card
      title="Fleet Size Audit"
      sub="Find wrong sizes, missing spec sizes and assets without tyre data across the fleet."
      action={(
        <span className="fv-tools">
          <button type="button" className="cc-btn-ghost" onClick={exportExcel} disabled={!auditRows.length}><FileSpreadsheet size={14} aria-hidden="true" /> Excel</button>
          <button type="button" className="cc-btn-ghost" onClick={exportPdf} disabled={!auditRows.length}><FileText size={14} aria-hidden="true" /> PDF</button>
        </span>
      )}
    >
      <div className="fv-filters">
        <select className="cc-select" aria-label="Site" value={aSite} onChange={(e) => setASite(e.target.value)}>
          <option value="">All sites</option>
          {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="cc-select" aria-label="Vehicle type" value={aType} onChange={(e) => setAType(e.target.value)}>
          <option value="">All vehicle types</option>
          {typeOptions.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="cc-select" aria-label="Severity" value={aSeverity} onChange={(e) => setASeverity(e.target.value)}>
          <option value="">All severities</option>
          {SEVERITY_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <div className="cc-search"><Search size={14} aria-hidden="true" /><input value={aSearch} onChange={(e) => setASearch(e.target.value)} placeholder="Search fleet no., make, model, size" aria-label="Search the fleet size audit" /></div>
        {(aSite || aType || aSeverity || aSearch) && (
          <button type="button" className="cc-btn-ghost" onClick={() => { setASite(''); setAType(''); setASeverity(''); setASearch('') }}><X size={14} aria-hidden="true" /> Clear</button>
        )}
      </div>
      <CardState state={fleetState}>
        <KitTable
          columns={auditColumns}
          rows={auditRows}
          empty={aSite || aType || aSeverity || aSearch ? 'No assets match these filters.' : 'No vehicles in scope.'}
        />
      </CardState>
    </Card>
  )

  return (
    <div className="cc fv-page">
      <div className="fv-hero">
        <PageHero
          hello="Tyre Management › Fitment & Rotation › Fitment Validation"
          title="Fitment Validation"
          lead="Validate a tyre before it goes on, audit fleet size compliance, and govern approved fitment rules."
          imgLight="/dashboard/hero-fitment-light.webp"
          imgDark="/dashboard/hero-fitment-dark.webp"
          stat={data && !fleetFailed ? { value: fmtInt(foot.vehicles), lines: ['Vehicles across', `${fmtInt(foot.sites)} sites`] } : null}
        />
        <div className="fv-hero-actions">
          <button type="button" className="cc-btn-ghost" onClick={load} disabled={loading}><RefreshCw size={14} aria-hidden="true" /> Refresh</button>
          <button type="button" className="cc-btn-ghost" onClick={exportExcel} disabled={!auditRows.length}><Download size={14} aria-hidden="true" /> Export</button>
          <button type="button" className="cc-btn-primary" onClick={() => openRuleCreate()} disabled={notProvisioned}><Plus size={14} aria-hidden="true" /> New Rule</button>
        </div>
      </div>

      {banner && (
        <div className="cc-card fv-banner" role="alert">
          <AlertTriangle size={16} aria-hidden="true" /><div>{banner}</div>
          <button type="button" className="cc-icon-btn" onClick={() => setBanner('')} aria-label="Dismiss message"><X size={14} /></button>
        </div>
      )}
      {notProvisioned && (
        <div className="cc-card fv-banner" role="status">
          <AlertTriangle size={16} aria-hidden="true" /><div>The fitment rules and history tables are not installed in this database yet (migration V208), so rules and saved validations are not available.</div>
        </div>
      )}

      <div className="cc-kpis">
        <Kpi icon={ShieldCheck} tone="t-green" display={fleetFailed ? 'N/A' : undefined} value={audit.total} label="Assets Checked" loading={kpiLoading} onClick={() => { setTab('audit'); setASeverity('') }} title={audit.coveragePct == null ? 'No fleet in scope' : `${audit.coveragePct}% have enough data to check`} />
        <Kpi icon={CheckCircle2} tone="t-green" display={fleetFailed ? 'N/A' : undefined} value={audit.match} label="Correct Size / Spec" loading={kpiLoading} onClick={() => { setTab('audit'); setASeverity('ok') }} />
        <Kpi icon={AlertTriangle} tone="t-red" display={fleetFailed ? 'N/A' : undefined} value={audit.mismatch} label="Non-compliant" danger={audit.mismatch > 0} loading={kpiLoading} onClick={() => { setTab('audit'); setASeverity('critical') }} />
        <Kpi icon={HelpCircle} tone="t-amber" display={fleetFailed ? 'N/A' : undefined} value={audit.unknown} label="Unclear / Missing Data" loading={kpiLoading} onClick={() => { setTab('audit'); setASeverity('data') }} title="No spec size on the vehicle or no fitted tyre recorded" />
        <Kpi icon={Percent} tone="t-blue" display={fleetFailed || audit.compliancePct == null ? 'N/A' : `${audit.compliancePct}%`} label="Fleet Compliance Rate" loading={kpiLoading} title="Correct size as a share of assets that could be checked" />
        <Kpi icon={ListChecks} tone="t-purple" display={activeRuleCount == null ? 'N/A' : undefined} value={activeRuleCount} label="Active Fitment Rules" onClick={() => setTab('rules')} title={activeRuleCount == null ? 'Rules could not be read' : `${rs.active} active policy rules and ${specs.length} specification rows from Tyre Specifications`} />
      </div>

      <Card className="fv-tabbar">
        <Tabs tabs={TABS.map((t) => ({
          ...t,
          count: t.key === 'audit' && data && !fleetFailed ? audit.mismatch || null
            : t.key === 'rules' && rules ? rs.total || null
              : t.key === 'history' && validations ? hist.total || null : null,
          countTone: t.key === 'audit' ? 'bad' : undefined,
        }))} value={tab} onChange={setTab} label="Fitment views" />
      </Card>

      {tab === 'validate' && (
        <>
          <div className="fv-validate">
            <Card
              title="Pre-installation Fitment Check"
              sub="Validate one tyre before installation against vehicle, axle, position and policy rules."
              action={<button type="button" className="cc-btn-primary" onClick={() => runValidation(true)} disabled={busy || notProvisioned}>{vSaving ? 'Validating...' : 'Validate Fitment'}</button>}
            >
              <label className="cc-field fv-asset-field">
                <span>Asset</span>
                <input className="fv-input" list="fv-assets" value={vForm.asset_no} onChange={(e) => setV('asset_no', e.target.value)} placeholder="Type or pick an asset number" maxLength={120} />
                <datalist id="fv-assets">{(data?.vehicles || []).slice(0, 3000).map((v) => <option key={v.id} value={v.asset_no}>{vehicleLabel(v)}</option>)}</datalist>
              </label>
              <div className="fv-asset-card">
                {selectedVehicle ? (
                  <>
                    <VehicleThumb row={selectedVehicle} size="md" />
                    <div className="fv-asset-main">
                      <b>{selectedVehicle.asset_no}{vehicleLabel(selectedVehicle) ? ` · ${vehicleLabel(selectedVehicle)}` : ''}</b>
                      <small>{[selectedVehicle.vehicle_type, selectedVehicle.site, selectedVehicle.tyre_size ? `Spec size ${selectedVehicle.tyre_size}` : 'No spec size recorded'].filter(Boolean).join(' · ')}</small>
                    </div>
                    {selectedVehicle.status && <span className={`cc-pill ${/active/i.test(selectedVehicle.status) ? 'good' : 'muted'}`}>{selectedVehicle.status}</span>}
                  </>
                ) : <span className="fv-muted">{vForm.asset_no ? 'Asset not found in the loaded fleet. It will be looked up when you validate.' : 'Pick an asset to see its details.'}</span>}
              </div>

              <div className="fv-form">
                <label className="cc-field"><span>Tyre serial / ID</span>
                  <input className="fv-input" value={vForm.tyre_serial} onChange={(e) => setV('tyre_serial', e.target.value)} placeholder="e.g. AA10293" maxLength={120} />
                </label>
                <label className="cc-field"><span>Tyre specification</span>
                  <select className="cc-select" value={vForm.catalog_id} onChange={(e) => pickCatalog(e.target.value)} disabled={!catalog}>
                    <option value="">{catalog ? 'Use the size on the tyre record' : 'Catalogue not loaded'}</option>
                    {(catalog || []).map((c) => <option key={c.id} value={c.id}>{[c.size, c.brand, c.pattern].filter(Boolean).join(' · ')}{c.approval_status && c.approval_status !== 'approved' ? ` (${c.approval_status.replace('_', ' ')})` : ''}</option>)}
                  </select>
                </label>
                <div className="fv-pos">
                  <label className="cc-field"><span>Axle</span>
                    <select className="cc-select" value={vForm.axle_role} onChange={(e) => setV('axle_role', e.target.value)}>
                      <option value="">Choose axle</option>
                      {AXLE_ROLES.map((a) => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </label>
                  <label className="cc-field"><span>Position code</span>
                    <input className="fv-input" value={vForm.position_code} onChange={(e) => setV('position_code', e.target.value)} placeholder="e.g. LHRO" maxLength={60} />
                  </label>
                </div>
                <label className="cc-field"><span>Load / speed index</span>
                  <input className="fv-input" value={vForm.load_speed} onChange={(e) => setV('load_speed', e.target.value)} placeholder={chosenCatalog ? 'Not in the catalogue' : 'e.g. 156/150 L'} maxLength={30} />
                </label>
                <div className="cc-field"><span>Rim / wheel</span>
                  <div className="fv-readonly">{chosenCatalog?.recommended_rim || 'N/A'}</div>
                </div>
                <label className="cc-field"><span>Current pressure (PSI){positionSpec?.recommended_pressure != null ? ` · Target ${positionSpec.recommended_pressure}` : ''}</span>
                  <input className="fv-input" type="number" min="0" step="1" value={vForm.pressure} onChange={(e) => setV('pressure', e.target.value)} placeholder="Optional" />
                </label>
              </div>

              {chips.length > 0 && (
                <div className="fv-chips">{chips.map((c) => <span key={c.text} className={`cc-pill ${c.tone}`}>{c.text}</span>)}</div>
              )}
              {refError && <p className="fv-err">{refError} <button type="button" className="fv-link" onClick={loadRefs}>Try again</button></p>}
              {vError && <p className="fv-err" role="alert">{vError}</p>}
              <div className="fv-form-foot">
                <button type="button" className="cc-btn-ghost" onClick={() => runValidation(false)} disabled={busy}>{vSimulating ? 'Checking...' : 'Preview only'}</button>
                <button type="button" className="cc-btn-ghost" onClick={() => { setVForm(EMPTY_V); setVResult(null); setVError('') }} disabled={busy}>Clear</button>
              </div>
            </Card>
            <FitmentResultCard result={vResult} context={vContext} busy={busy} />
          </div>

          <div className="fv-lower">
            {auditCard}
            <div className="fv-rail">
              <Card title="Compliance by Category" sub="Correct size share of checkable assets, by vehicle type">
                <CardState state={fleetState} empty={data && !categories.length ? 'No asset has both a spec size and fitted tyres yet.' : null}>
                  <div className="fv-bars">
                    {categories.map((c) => (
                      <div key={c.category} className="fv-bar" title={`${c.match} of ${c.checked} checkable assets`}>
                        <span>{c.category}</span>
                        <span className="cc-meter-track"><span style={{ width: `${c.pct}%`, background: c.pct >= 90 ? 'var(--cc-green)' : c.pct >= 70 ? 'var(--cc-amber)' : 'var(--cc-red)' }} /></span>
                        <b>{c.pct}%</b>
                      </div>
                    ))}
                  </div>
                </CardState>
              </Card>
              <ActiveRules
                rules={rules} rulesError={rulesError} onRetry={loadRules} specsCount={specs?.length}
                onToggle={toggleRule} togglingId={togglingId} onNew={() => openRuleCreate()}
                notProvisioned={notProvisioned} onOpenSpecs={() => navigate('/tyre-specifications')}
              />
            </div>
          </div>
        </>
      )}

      {tab === 'audit' && auditCard}

      {tab === 'rules' && (
        <Card
          title="Fitment Rules"
          sub="Size, tread and tyre condition are enforced by the check. Age, retread and dual-pair fields are stored for policy completeness only."
          action={!notProvisioned && <button type="button" className="cc-btn-primary" onClick={() => openRuleCreate()}><Plus size={14} aria-hidden="true" /> New Rule</button>}
        >
          <div className="fv-filters">
            <div className="cc-search"><Search size={14} aria-hidden="true" /><input value={ruleSearch} onChange={(e) => setRuleSearch(e.target.value)} placeholder="Search name, types, sizes, notes" aria-label="Search rules" /></div>
            <select className="cc-select" aria-label="Rule state" value={ruleState} onChange={(e) => setRuleState(e.target.value)}>
              <option value="">All states</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
            {(ruleSearch || ruleState) && <button type="button" className="cc-btn-ghost" onClick={() => { setRuleSearch(''); setRuleState('') }}><X size={14} aria-hidden="true" /> Clear</button>}
          </div>
          <KitTable
            columns={ruleColumns}
            rows={rulesFiltered}
            getRowId={(r) => String(r.id)}
            loading={rules === null && !rulesError}
            error={rulesError || null}
            onRetry={loadRules}
            enableExport
            exportFileName={reportFileName('Fitment Rules')}
            reportMeta={{ title: 'Fitment rules' }}
            empty={ruleSearch || ruleState ? 'No rules match these filters.' : notProvisioned ? 'Rules need the fitment tables (V208).' : 'No fitment rules yet. The check uses the built-in default policy and Tyre Specifications until you add one.'}
          />
        </Card>
      )}

      {tab === 'history' && (
        <Card title="Validation History" sub={hist.capped ? `Showing the latest ${HISTORY_LIMIT} validations. Older records exist but are not loaded here.` : `Latest validations, up to ${HISTORY_LIMIT}.`}>
          {validations && hist.total > 0 && (
            <dl className="fv-facts">
              <div><dt>Approved</dt><dd>{fmtInt(hist.approved)}</dd></div>
              <div><dt>Rejected</dt><dd>{fmtInt(hist.rejected)}</dd></div>
              <div><dt>Last 7 days</dt><dd>{fmtInt(hist.last7Days)}</dd></div>
              <div><dt>Approval rate</dt><dd>{hist.approvalRatePct == null ? 'N/A' : `${hist.approvalRatePct}%`}</dd></div>
              <div><dt>Most common issue</dt><dd>{hist.topViolation ? `${hist.topViolation.rule} (${hist.topViolation.count})` : 'None'}</dd></div>
            </dl>
          )}
          <div className="fv-filters">
            <div className="cc-search"><Search size={14} aria-hidden="true" /><input value={historySearch} onChange={(e) => setHistorySearch(e.target.value)} placeholder="Search serial, asset or position" aria-label="Search validations" /></div>
            <select className="cc-select" aria-label="Result" value={historyResult} onChange={(e) => setHistoryResult(e.target.value)}>
              <option value="">All results</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
            {(historySearch || historyResult) && <button type="button" className="cc-btn-ghost" onClick={() => { setHistorySearch(''); setHistoryResult('') }}><X size={14} aria-hidden="true" /> Clear</button>}
          </div>
          <KitTable
            columns={historyColumns}
            rows={histFiltered}
            getRowId={(h) => String(h.id)}
            loading={validations === null && !validationsError}
            error={validationsError || null}
            onRetry={loadValidations}
            enableExport
            exportFileName={reportFileName('Fitment Validation Ledger')}
            reportMeta={{ title: 'Fitment validation ledger' }}
            empty={historySearch || historyResult ? 'No validations match these filters.' : notProvisioned ? 'Saving validations needs the fitment tables (V208).' : 'No validations recorded yet. Run a check on the Validate tab.'}
          />
        </Card>
      )}

      {viewRow && (
        <Modal open onClose={() => setViewRow(null)} size="lg" title={`${viewRow.asset_no} fitted tyres`}>
          <p className="fv-modal-sub">{[vehicleLabel(viewRow), viewRow.site, viewRow.spec ? `Spec size ${viewRow.spec}` : 'No spec size recorded'].filter(Boolean).join(' · ')}</p>
          <KitTable
            compact
            columns={[
              { key: 'position', header: 'Position' },
              { key: 'serial', header: 'Serial', cell: (t) => <span className="fv-mono">{t.serial}</span> },
              { key: 'size', header: 'Size', cell: (t) => (t.size ? <span className={`fv-mono ${viewRow.specNorm && !t.matches ? 'fv-bad' : ''}`}>{t.size}</span> : NA) },
              { key: 'matches', header: 'Result', cell: (t) => (!viewRow.specNorm || !t.sizeNorm ? <span className="cc-pill muted">No data</span> : t.matches ? <span className="cc-pill good">Correct</span> : <span className="cc-pill bad">Wrong size</span>) },
            ]}
            rows={viewRow.fitted}
            getRowId={(t) => String(t.id)}
            empty="No fitted tyres recorded for this asset."
          />
          <div className="fv-form-foot">
            {auditStatus(viewRow) === 'wrong_size' && <button type="button" className="cc-btn-primary" onClick={() => { const r = viewRow; setViewRow(null); resolveRow(r) }}><Eye size={14} aria-hidden="true" /> Check a replacement tyre</button>}
          </div>
        </Modal>
      )}

      <FitmentRuleModals
        showRuleModal={showRuleModal} closeRuleModal={closeRuleModal} editingRule={editingRule}
        ruleForm={ruleForm} setRule={setRule} submitRule={submitRule} ruleSaving={ruleSaving} ruleFormError={ruleFormError}
        confirmDeleteRule={confirmDeleteRule} setConfirmDeleteRule={setConfirmDeleteRule}
        deletingRule={deletingRule} doDeleteRule={doDeleteRule} deleteError={deleteError}
      />
    </div>
  )
}

function ActiveRules({ rules, rulesError, onRetry, specsCount, onToggle, togglingId, onNew, notProvisioned, onOpenSpecs }) {
  const state = { loading: rules === null && !rulesError, data: rules, error: rulesError || null, retry: onRetry }
  return (
    <Card title="Active Fitment Rules" sub="Switch a rule off to stop the check from applying it">
      <CardState state={state} empty={rules && !rules.length ? (
        <div>
          {notProvisioned ? 'Rules need the fitment tables (V208).' : 'No fitment rules yet. The check applies the built-in default policy.'}
          {!notProvisioned && <><br /><button type="button" className="cc-btn" onClick={onNew}>New Rule</button></>}
        </div>
      ) : null}>
        <ul className="fv-rules">
          {(rules || []).map((r) => {
            const on = r.is_active !== false
            return (
              <li key={r.id}>
                <div>
                  <b>{r.rule_name}</b>
                  <small>{ruleScope(r)} · {ruleEnforces(r).slice(0, 2).join(' · ')}</small>
                </div>
                <button
                  type="button" role="switch" aria-checked={on} aria-label={`${on ? 'Turn off' : 'Turn on'} ${r.rule_name}`}
                  className={`fv-switch ${on ? 'on' : ''}`} disabled={togglingId === r.id} onClick={() => onToggle(r)}
                ><i /></button>
              </li>
            )
          })}
        </ul>
      </CardState>
      {specsCount != null && (
        <p className="fv-note">{fmtInt(specsCount)} specification rows (approved sizes, minimum load index and speed rating, target pressure by vehicle type and axle) also drive the check. <button type="button" className="fv-link" onClick={onOpenSpecs}>Open Tyre Specifications</button></p>
      )}
    </Card>
  )
}
