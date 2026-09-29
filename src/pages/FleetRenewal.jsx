/**
 * FleetRenewal (route /fleet-renewal) - Fleet Renewal, rebuilt on the shared
 * page kit to the owner's light reference design.
 *
 * Two sources, kept apart on purpose:
 *   - The fleet register (vehicle_fleet) is the candidate list. Every current
 *     asset is assessed from its recorded model year, the breakdown register
 *     and its latest telematics utilisation, by the rule in
 *     src/lib/fleetRenewalView.js (stated on screen).
 *   - Renewal plans (fleet_renewal_plans, V159) carry the decision: budget,
 *     target date and status. An asset with no plan reads "No plan".
 *
 * Kept from the previous page: plan create / edit / delete, Excel and PDF
 * export (the planning register and the plans register), country scope and
 * the not-provisioned state. Money is never summed across currencies, and
 * nothing without a source (savings, procurement) is shown as a number.
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  Truck, Clock, Wallet, PiggyBank, CheckCircle2, ShoppingCart, Plus, Search, X,
  Pencil, Trash2, Loader2, Save, AlertTriangle, FileSpreadsheet, FileText, Send,
  Scale, Download, MoreHorizontal, RefreshCw, Filter, Info, ListChecks, Eye,
  AlertOctagon, Wrench, CalendarClock, Sparkles,
} from 'lucide-react'
import Modal from '../components/ui/Modal'
import {
  Card, CardState, Kpi, PageHero, Donut, Pager, MeterCell, KitTable, fmtInt, useCard,
} from '../components/commandCenter/kit'
import { useSettings } from '../contexts/SettingsContext'
import {
  listRenewalPlansEnriched, createRenewalPlan, updateRenewalPlan, deleteRenewalPlan,
} from '../lib/api/fleetRenewal'
import { loadRenewalFleet, loadRenewalUtilization, loadRenewalBreakdowns } from '../lib/api/fleetRenewalSignals'
import {
  RENEWAL_STATUSES, RENEWAL_PRIORITIES, RENEWAL_STATUS_META, RENEWAL_PRIORITY_META,
} from '../lib/fleetRenewal'
import { renewalExportRows, RENEWAL_EXPORT_COLUMNS } from '../lib/fleetRenewalAnalytics'
import {
  buildPlanningRows, sortPlanningRows, filterPlanningRows, ageDistribution, pipelineSegments,
  capexByQuarter, buildRenewalKpis, planningRules, presetCounts, remainingLifeLabel,
  planningExportRows, PLANNING_EXPORT_COLUMNS, PRIORITY_META, PRIORITY_KEYS, PLAN_STATUS_META,
  PLANNING_LIFE_YEARS, AGING_YEARS, currencyForCountry,
} from '../lib/fleetRenewalView'
import { formatCurrencyCompact } from '../lib/formatters'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation } from '../lib/api/_client'
import './FleetRenewal.css'

const EMPTY_FORM = {
  asset_no: '', current_km: '', age_years: '', recommendation: '',
  target_replace_date: '', est_cost: '', priority: 'medium', status: 'planned',
  site: '', notes: '', country: '',
}
const RULE_TEXT = `Age comes from the recorded model year (implausible years are ignored). Every asset is planned against a ${PLANNING_LIFE_YEARS}-year life, because the register records no useful life per asset. Health score = 70% age score (100 at new, 0 at ${PLANNING_LIFE_YEARS} years) + 30% reliability (0 with an open breakdown, else 100). Priority: marked Plan For Scrap or 1 year or less left = Critical; 2 years or less, or over ${AGING_YEARS} years with an open breakdown = High; 4 years or less = Medium; otherwise Low.`
const RULE_ICON = { scrap: AlertOctagon, past: AlertTriangle, bd: Wrench, noplan: CalendarClock, noage: Info }

const money = (amount, currency) => (amount == null ? 'N/A' : formatCurrencyCompact(amount, currency || ''))
const PRIORITY_TO_PLAN = { critical: 'high', high: 'high', medium: 'medium', low: 'low' }

/** Popover menu positioned against the viewport so a scrolling table never clips it. */
function RowMenu({ label, items }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const btn = useRef(null)
  const pop = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const r = btn.current?.getBoundingClientRect()
    if (r) setPos({ top: r.bottom + 4, right: window.innerWidth - r.right })
    const onDoc = (e) => { if (!pop.current?.contains(e.target) && !btn.current?.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus() } }
    const close = () => setOpen(false)
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [open])
  useEffect(() => { if (open && pos) pop.current?.querySelector('button,a')?.focus() }, [open, pos])
  return (
    <>
      <button ref={btn} type="button" className="fr-row-btn" aria-label={label} aria-haspopup="menu" aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}>
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
      {open && pos && (
        <div ref={pop} className="fr-menu" role="menu" style={{ top: pos.top, right: pos.right }}>
          {items.filter(Boolean).map((it) => (it.to
            ? <Link key={it.label} role="menuitem" className="fr-menu-item" to={it.to} onClick={() => setOpen(false)}>{it.icon && <it.icon size={14} aria-hidden="true" />} {it.label}</Link>
            : (
              <button key={it.label} type="button" role="menuitem" className={`fr-menu-item ${it.danger ? 'danger' : ''}`}
                onClick={() => { setOpen(false); it.onClick() }}>
                {it.icon && <it.icon size={14} aria-hidden="true" />} {it.label}
              </button>
            )))}
        </div>
      )}
    </>
  )
}

/** Vertical bars with a value on top of each. `fmt` formats labels on the bars. */
function Bars({ data, fmt = fmtInt, fill = 'var(--cc-green)', label }) {
  const W = 300; const H = 190; const L = 36; const B = 24; const T = 16
  const plotH = H - B - T
  const max = Math.max(1, ...data.map((d) => d.value || 0))
  const nice = (() => { const p = 10 ** Math.floor(Math.log10(max)); const m = Math.ceil(max / p); return (m <= 2 ? 2 : m <= 5 ? 5 : 10) * p })()
  const step = (W - L) / Math.max(data.length, 1)
  const barW = Math.min(40, step * 0.6)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="fr-bars" role="img" aria-label={`${label}: ${data.map((d) => `${d.label} ${d.value == null ? 'N/A' : fmt(d.value)}`).join(', ')}`}>
      {[0, 0.5, 1].map((f) => {
        const y = T + plotH - f * plotH
        return (
          <g key={f}>
            <line x1={L} x2={W} y1={y} y2={y} className="fr-grid" />
            <text x={L - 5} y={y + 3} textAnchor="end" className="fr-axis">{fmt(nice * f)}</text>
          </g>
        )
      })}
      {data.map((d, i) => {
        const x = L + i * step + (step - barW) / 2
        const h = d.value ? (d.value / nice) * plotH : 0
        return (
          <g key={d.key || d.label}>
            {d.value != null && <rect x={x} y={T + plotH - h} width={barW} height={Math.max(h, d.value ? 2 : 0)} rx="3" style={{ fill, opacity: 0.55 + 0.45 * (1 - i / Math.max(data.length, 1)) }} />}
            <text x={x + barW / 2} y={T + plotH - h - 4} textAnchor="middle" className="fr-val">{d.value == null ? 'N/A' : fmt(d.value)}</text>
            <text x={x + barW / 2} y={H - 6} textAnchor="middle" className="fr-axis">{d.label}</text>
          </g>
        )
      })}
    </svg>
  )
}

function HealthBadge({ value }) {
  if (value == null) return <span className="cc-na">N/A</span>
  const tone = value >= 70 ? 'good' : value >= 40 ? 'warn' : 'bad'
  return <span className={`fr-health ${tone}`} title="Health score under the planning rule">{value}</span>
}

export default function FleetRenewal() {
  const { activeCountry, activeCurrency } = useSettings()
  const countryScope = activeCountry && activeCountry !== 'All' ? activeCountry : ''
  const scopeLabel = countryScope || 'All countries'
  const now = useMemo(() => new Date(), [])

  // Plans (the decision layer). Kept in local state so CRUD updates in place.
  const [plans, setPlans] = useState(null)
  const [planError, setPlanError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [actionError, setActionError] = useState('')
  const loadPlans = useCallback(async () => {
    setPlanError(''); setNotProvisioned(false)
    try {
      const data = await listRenewalPlansEnriched({ country: activeCountry })
      setPlans(Array.isArray(data) ? data : [])
    } catch (err) {
      if (isMissingRelation(err)) { setNotProvisioned(true); setPlans([]) } else { setPlanError(toUserMessage(err, 'Could not load renewal plans.')); setPlans(null) }
    }
  }, [activeCountry])
  useEffect(() => { loadPlans() }, [loadPlans])

  // Register and optional signals: each loads and fails on its own.
  const fleetCard = useCard(() => loadRenewalFleet({ country: activeCountry }), [activeCountry])
  const utilCard = useCard(() => loadRenewalUtilization({ country: activeCountry }), [activeCountry])
  const bdCard = useCard(() => loadRenewalBreakdowns({ country: activeCountry }), [activeCountry])

  const allPlans = useMemo(() => plans || [], [plans])
  const plansLoading = plans === null && !planError
  const signalsLoading = utilCard.loading || bdCard.loading

  const rows = useMemo(() => {
    if (!fleetCard.data) return []
    return sortPlanningRows(buildPlanningRows({
      fleet: fleetCard.data.rows,
      plans: allPlans,
      utilRows: utilCard.loading ? null : utilCard.data,
      breakdownRows: bdCard.loading ? null : bdCard.data,
      now,
    }))
  }, [fleetCard.data, allPlans, utilCard.loading, utilCard.data, bdCard.loading, bdCard.data, now])

  const kpi = useMemo(() => buildRenewalKpis(rows, allPlans, now), [rows, allPlans, now])
  const rules = useMemo(() => planningRules(rows, now), [rows, now])
  const presets = useMemo(() => presetCounts(rows, now), [rows, now])
  const pipeline = useMemo(() => pipelineSegments(allPlans, now), [allPlans, now])
  const capex = useMemo(() => capexByQuarter(allPlans, now), [allPlans, now])

  // Age distribution card
  const [ageType, setAgeType] = useState('')
  const typeOptions = useMemo(() => [...new Set(rows.map((r) => r.vehicle_type).filter(Boolean))].sort(), [rows])
  const siteOptions = useMemo(() => [...new Set(rows.map((r) => r.site).filter(Boolean))].sort(), [rows])
  const ageDist = useMemo(() => ageDistribution(rows, ageType), [rows, ageType])

  // Planning table filters
  const [q, setQ] = useState('')
  const [site, setSite] = useState('')
  const [type, setType] = useState('')
  const [priority, setPriority] = useState('')
  const [status, setStatus] = useState('')
  const [preset, setPreset] = useState('')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(10)
  const [checked, setChecked] = useState(() => new Set())
  const filters = { q, site, type, priority, status, preset }
  const filtered = useMemo(() => filterPlanningRows(rows, { q, site, type, priority, status, preset }, now), [rows, q, site, type, priority, status, preset, now])
  useEffect(() => { setPage(0) }, [q, site, type, priority, status, preset, pageSize, activeCountry])
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pages - 1)
  const pageRows = filtered.slice(safePage * pageSize, safePage * pageSize + pageSize)
  const hasFilters = Object.values(filters).some(Boolean)
  const clearFilters = () => { setQ(''); setSite(''); setType(''); setPriority(''); setStatus(''); setPreset('') }
  const tableRef = useRef(null)
  const applyPreset = (key) => { setPreset((p) => (p === key ? '' : key)); tableRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }) }

  const toggle = (id) => setChecked((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const pageIds = pageRows.map((r) => r.id)
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => checked.has(id))
  const toggleAll = () => setChecked((prev) => {
    const n = new Set(prev)
    if (allOnPage) pageIds.forEach((id) => n.delete(id)); else pageIds.forEach((id) => n.add(id))
    return n
  })
  const checkedRows = rows.filter((r) => checked.has(r.id))

  // Exports
  const doExcel = async (list = filtered) => {
    try {
      await exportToExcel(planningExportRows(list), PLANNING_EXPORT_COLUMNS.map((c) => c.key), PLANNING_EXPORT_COLUMNS.map((c) => c.header), reportFileName('Fleet Renewal Planning', scopeLabel))
    } catch (e) { setActionError(toUserMessage(e, 'Could not export. Try again.')) }
  }
  const doPdf = async () => {
    try {
      await exportToPdf(planningExportRows(filtered), PLANNING_EXPORT_COLUMNS, `Fleet Renewal Planning (${scopeLabel})`, reportFileName('Fleet Renewal Planning', scopeLabel), 'landscape')
    } catch (e) { setActionError(toUserMessage(e, 'Could not export. Try again.')) }
  }
  const doPlansExcel = async () => {
    try {
      const ex = renewalExportRows(allPlans, now)
      await exportToExcel(ex, RENEWAL_EXPORT_COLUMNS.map((c) => c.key), RENEWAL_EXPORT_COLUMNS.map((c) => c.header), reportFileName('Fleet Renewal Plans', scopeLabel))
    } catch (e) { setActionError(toUserMessage(e, 'Could not export. Try again.')) }
  }

  // CRUD
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleteError, setDeleteError] = useState('')
  const [deleting, setDeleting] = useState(false)

  const openCreate = (row) => {
    setEditing(null)
    setForm(row ? {
      ...EMPTY_FORM,
      asset_no: row.asset_no || '', site: row.site || '', current_km: row.current_km ?? '', age_years: row.age ?? '',
      priority: PRIORITY_TO_PLAN[row.priority] || 'medium',
      recommendation: row.priority && row.priority !== 'unknown' ? row.recommendation : '',
      country: row.country || '',
    } : EMPTY_FORM)
    setFormError(''); setModalOpen(true)
  }
  const openEdit = (p) => {
    setEditing(p)
    setForm({
      asset_no: p.asset_no || '', current_km: p.current_km ?? '', age_years: p.age_years ?? '',
      recommendation: p.recommendation || '', target_replace_date: p.target_replace_date ? String(p.target_replace_date).slice(0, 10) : '',
      est_cost: p.est_cost ?? '', priority: p.priority || 'medium', status: p.status || 'planned',
      site: p.site || '', notes: p.notes || '', country: p.country || '',
    })
    setFormError(''); setModalOpen(true)
  }
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const formCurrency = currencyForCountry(form.country || countryScope) || activeCurrency

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.asset_no.trim()) { setFormError('An asset number is required.'); return }
    setSaving(true)
    try {
      const payload = { ...form, country: form.country || countryScope || null }
      if (editing) {
        const updated = await updateRenewalPlan(editing.id, payload)
        setPlans((prev) => (prev || []).map((r) => (r.id === updated.id ? { ...r, ...updated } : r)))
      } else {
        const created = await createRenewalPlan(payload)
        setPlans((prev) => [created, ...(prev || [])])
      }
      setModalOpen(false)
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the plan.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, countryScope])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true); setDeleteError('')
    try {
      await deleteRenewalPlan(confirmDelete.id)
      setPlans((prev) => (prev || []).filter((r) => r.id !== confirmDelete.id))
      setConfirmDelete(null)
    } catch (err) {
      setDeleteError(toUserMessage(err, 'Could not delete the plan.'))
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete])
  const closeForm = () => { if (!saving) setModalOpen(false) }
  const closeDelete = () => { if (!deleting) { setConfirmDelete(null); setDeleteError('') } }

  const refreshAll = () => { loadPlans(); fleetCard.retry(); utilCard.retry(); bdCard.retry() }

  // KPIs
  const regLoading = fleetCard.loading && !fleetCard.data
  const capexKpi = kpi.capex
  const capexTitle = capexKpi.mixed
    ? `Open plans span more than one currency, so no single total is shown: ${capexKpi.byCurrency.map((c) => money(c.amount, c.currency)).join(', ')}. Pick a country to see one figure.`
    : capexKpi.amount == null ? 'No open renewal plan with a cost targets the next 12 months.' : `${capexKpi.costed} open plan(s) with a cost and a target date within 12 months (overdue included).`
  const kpis = [
    { icon: Truck, tone: 't-red', value: kpi.due, display: fleetCard.error ? 'N/A' : undefined, label: 'Assets due for replacement', loading: regLoading, title: `Critical under the planning rule: marked for scrap, or 1 year or less of a ${PLANNING_LIFE_YEARS}-year planning life left.`, onClick: () => applyPreset('due') },
    { icon: Clock, tone: 't-amber', value: kpi.aging, display: fleetCard.error ? 'N/A' : undefined, label: `Aging assets (> ${AGING_YEARS} years)`, loading: regLoading, title: `${fmtInt(kpi.withAge)} of ${fmtInt(kpi.assets)} current assets have a usable model year.` },
    { icon: Wallet, tone: 't-green', label: 'Forecast CAPEX (next 12 months)', loading: plansLoading, display: planError ? 'N/A' : money(capexKpi.amount, capexKpi.currency), title: planError ? 'Renewal plans could not be read.' : capexTitle },
    { icon: PiggyBank, tone: 't-blue', label: 'Estimated savings', display: 'N/A', title: 'No source records savings. Renewal plans carry an estimated cost only, so a saving would be invented.' },
    { icon: CheckCircle2, tone: 't-green', value: kpi.approved, display: planError ? 'N/A' : undefined, label: 'Approved replacements', loading: plansLoading, title: 'Renewal plans with status Approved.', onClick: () => { setPreset(''); setStatus('approved') } },
    { icon: ShoppingCart, tone: 't-purple', label: 'In procurement', display: 'N/A', title: 'Renewal plans record Planned, Approved, Deferred or Completed. No procurement stage is recorded, so this cannot be counted.' },
  ]

  const na = (t = 'N/A') => <span className="cc-na">{t}</span>
  const columns = [
    {
      key: '_sel', sortable: false,
      header: <input type="checkbox" aria-label="Select all assets on this page" checked={allOnPage} onChange={toggleAll} />,
      cell: (r) => <input type="checkbox" aria-label={`Select ${r.asset_no}`} checked={checked.has(r.id)} onChange={() => toggle(r.id)} />,
    },
    {
      key: 'asset_no', header: 'Asset no',
      cell: (r) => (r.inRegister
        ? <Link className="fr-asset" to={`/asset-management/${encodeURIComponent(r.asset_no)}`}>{r.asset_no}</Link>
        : <span title="This plan's asset is not in the current fleet register">{r.asset_no} <span className="fr-sub">Not in register</span></span>),
    },
    { key: 'fleet_no', header: 'Fleet no', cell: (r) => r.fleet_no || na() },
    { key: 'make', header: 'Make / model', cell: (r) => [r.make, r.model].filter(Boolean).join(' ') || na() },
    { key: 'vehicle_type', header: 'Category', cell: (r) => r.vehicle_type || na() },
    { key: 'age', header: 'Age (years)', align: 'right', cell: (r) => (r.age == null ? <span className="cc-na" title={r.model_year ? `Model year ${r.model_year} is not usable` : 'No model year recorded'}>N/A</span> : r.age) },
    {
      key: 'utilization', header: 'Utilization',
      cell: (r) => (signalsLoading ? na('...') : <span title={utilCard.data == null ? 'Utilisation could not be read' : r.utilization == null ? 'No telematics snapshot' : 'Latest telematics snapshot'}><MeterCell value={r.utilization} suffix="%" /></span>),
    },
    { key: 'health', header: 'Health score', cell: (r) => (signalsLoading ? na('...') : <HealthBadge value={r.health} />) },
    { key: 'remaining', header: 'Remaining life', cell: (r) => remainingLifeLabel(r.remainingYears) },
    { key: 'priority', header: 'Priority', cell: (r) => <span className={`cc-pill ${PRIORITY_META[r.priority]?.tone || 'muted'}`}>{PRIORITY_META[r.priority]?.label || 'Unknown'}</span> },
    { key: 'recommendation', header: 'Recommendation', cell: (r) => <span title={r.plan?.recommendation ? `Plan: ${r.plan.recommendation}` : undefined}>{r.recommendation}</span> },
    {
      key: 'budget', header: 'Est. budget', align: 'right',
      cell: (r) => (!r.plan ? na('No plan') : r.budget == null ? na() : money(r.budget, r.currency)),
    },
    {
      key: 'status', header: 'Approval status',
      cell: (r) => (r.plan
        ? <span className={`cc-pill ${PLAN_STATUS_META[r.planStatus]?.tone || 'muted'}`} title={r.plan.target_replace_date ? `Target ${String(r.plan.target_replace_date).slice(0, 10)}` : 'No target date'}>{PLAN_STATUS_META[r.planStatus]?.label || r.planStatus}</span>
        : <span className="cc-pill muted">No plan</span>),
    },
    {
      key: '_actions', header: 'Actions', sortable: false,
      cell: (r) => (
        <RowMenu label={`Actions for ${r.asset_no}`} items={[
          r.inRegister && { label: 'View asset', icon: Eye, to: `/asset-management/${encodeURIComponent(r.asset_no)}` },
          r.plan ? { label: 'Edit plan', icon: Pencil, onClick: () => openEdit(r.plan) } : (!notProvisioned && { label: 'Add renewal plan', icon: Plus, onClick: () => openCreate(r) }),
          r.plan && { label: 'Delete plan', icon: Trash2, danger: true, onClick: () => { setDeleteError(''); setConfirmDelete(r.plan) } },
        ]} />
      ),
    },
  ]

  const tableState = {
    loading: fleetCard.loading || plansLoading,
    error: fleetCard.error || (planError ? `Renewal plans could not be read, so plan status would be wrong. ${planError}` : null),
    retry: () => { fleetCard.retry(); loadPlans() },
    data: fleetCard.data && plans ? true : null,
  }
  const plansState = { loading: plansLoading, error: planError || null, retry: loadPlans, data: plans }
  const pipeTotal = pipeline.reduce((s, x) => s + x.count, 0)

  return (
    <div className="cc fr-page">
      <PageHero
        title="Fleet Renewal"
        lead={<>Plan smarter. Replace at the right time. Maximize value.<span className="fr-lead-2">Replacement planning from the fleet register, the breakdown log and telematics, with every plan's budget and approval in one place.</span></>}
        imgLight="/dashboard/hero-renewal-light.webp"
        imgDark="/dashboard/hero-renewal-dark.webp"
      />

      {notProvisioned && (
        <div className="cc-card fr-banner warn" role="status">
          <AlertTriangle size={17} aria-hidden="true" />
          <div><b>Renewal plans are not enabled on this database yet.</b><p>Apply MIGRATIONS_V159_FLEET_RENEWAL.sql, then reload. The register assessment below still works.</p></div>
        </div>
      )}
      {actionError && (
        <div className="cc-card fr-banner bad" role="alert">
          <AlertTriangle size={17} aria-hidden="true" />
          <div><p>{actionError}</p></div>
          <button type="button" className="cc-icon-btn" onClick={() => setActionError('')} aria-label="Dismiss message"><X size={14} /></button>
        </div>
      )}
      {fleetCard.data?.truncated && (
        <div className="cc-card fr-banner warn" role="status">
          <AlertTriangle size={17} aria-hidden="true" />
          <div><p>The fleet register returned more assets than this page reads at once, so figures cover the first {fmtInt(fleetCard.data.rows.length)}. Pick a country to narrow it.</p></div>
        </div>
      )}

      <div className="cc-kpis">
        {kpis.map((k) => <Kpi key={k.label} {...k} />)}
      </div>

      <div className="fr-layout">
        <div className="fr-main">
          <div className="fr-charts">
            <Card
              title="Asset Age Distribution"
              sub={`Current assets by age. ${ageDist.unknown ? `${fmtInt(ageDist.unknown)} with no usable model year are not shown.` : ''}`}
              action={
                <select className="cc-select" aria-label="Asset type for age distribution" value={ageType} onChange={(e) => setAgeType(e.target.value)}>
                  <option value="">All asset types</option>
                  {typeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              }
            >
              <CardState state={fleetCard} empty={fleetCard.data && ageDist.total - ageDist.unknown === 0 ? (ageDist.total === 0 ? 'No current assets in this scope.' : 'None of these assets has a usable model year.') : null}>
                <Bars label="Assets by age in years" data={ageDist.bands.map((b) => ({ key: b.key, label: b.label, value: b.count }))} />
                <p className="fr-foot">Asset age (years), from the model year.</p>
              </CardState>
            </Card>

            <Card className="fr-pipe" title="Renewal Pipeline" sub="Renewal plans by status and target date.">
              <CardState state={plansState} empty={plans && pipeTotal === 0 ? (notProvisioned ? 'Renewal plans are not enabled yet.' : 'No renewal plans yet. Add one from the planning table.') : null}>
                <Donut segments={pipeline} total={pipeTotal} centerLabel="Plans"
                  onSelect={(s) => { setPreset(s.key === 'next12' ? 'next12' : ''); setStatus(s.key === 'approved' ? 'approved' : s.key === 'deferred' ? 'deferred' : s.key === 'completed' ? 'completed' : s.key === 'beyond' ? 'planned' : '') }} />
                <p className="fr-foot">No review or procurement stage is recorded on a plan, so none is drawn.</p>
              </CardState>
            </Card>

            <Card title="CAPEX Forecast by Quarter" sub={`Open plans with a cost and a target date, next 4 quarters${capex.currency ? ` (${capex.currency})` : ''}.`}>
              <CardState state={plansState}
                empty={plans && (capex.mixed ? 'Plans in this scope are in more than one currency, so quarters are not summed. Pick a country.' : !capex.hasData ? 'No open plan with a cost targets the next 4 quarters.' : null)}>
                <Bars label="Planned capital spend by quarter" fmt={(v) => (v ? formatCurrencyCompact(v, '') : '0')} data={capex.quarters.map((x) => ({ key: x.key, label: x.label, value: x.amount ?? 0 }))} />
                <p className="fr-foot">Sum of estimated cost of planned and approved plans.</p>
              </CardState>
            </Card>
          </div>

          <div ref={tableRef}>
            <Card
              title="Replacement Planning"
              sub={<span title={RULE_TEXT}>Every current asset, assessed by the planning rule, with its renewal plan. <Info size={12} aria-hidden="true" style={{ verticalAlign: '-2px' }} /></span>}
              action={
                <div className="fr-head-actions">
                  <button type="button" className="cc-btn-ghost" onClick={() => doExcel()} disabled={!filtered.length}><FileSpreadsheet size={14} aria-hidden="true" /> Excel</button>
                  <button type="button" className="cc-btn-ghost" onClick={doPdf} disabled={!filtered.length}><FileText size={14} aria-hidden="true" /> PDF</button>
                  <button type="button" className="cc-btn-primary" onClick={() => openCreate()} disabled={notProvisioned}><Plus size={15} aria-hidden="true" /> Add renewal plan</button>
                </div>
              }
            >
              <div className="cc-filters fr-filters">
                <div className="cc-search">
                  <Search size={15} aria-hidden="true" />
                  <label htmlFor="fr-search" className="sr-only">Search assets</label>
                  <input id="fr-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search asset, fleet no, make, model..." />
                </div>
                <select className="cc-select" aria-label="Site" value={site} onChange={(e) => setSite(e.target.value)}>
                  <option value="">All sites</option>
                  {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <select className="cc-select" aria-label="Asset type" value={type} onChange={(e) => setType(e.target.value)}>
                  <option value="">All asset types</option>
                  {typeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <select className="cc-select" aria-label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
                  <option value="">All priorities</option>
                  {PRIORITY_KEYS.map((p) => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}
                </select>
                <select className="cc-select" aria-label="Plan status" value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="">All statuses</option>
                  <option value="none">No plan</option>
                  {RENEWAL_STATUSES.map((s) => <option key={s} value={s}>{PLAN_STATUS_META[s].label}</option>)}
                </select>
                {hasFilters && <button type="button" className="cc-btn-ghost" onClick={clearFilters}><X size={13} aria-hidden="true" /> Reset</button>}
              </div>
              {preset && (
                <div className="cc-bulk">
                  <span className="cc-bulk-count"><Filter size={12} aria-hidden="true" /> Preset: {presets.find((p) => p.key === preset)?.label}</span>
                  <button type="button" className="cc-btn-ghost" onClick={() => setPreset('')}><X size={13} aria-hidden="true" /> Clear preset</button>
                </div>
              )}
              {checked.size > 0 && (
                <div className="cc-bulk">
                  <span className="cc-bulk-count">{checked.size} selected</span>
                  <button type="button" className="cc-btn-ghost" onClick={() => doExcel(checkedRows)}><FileSpreadsheet size={14} aria-hidden="true" /> Export selected</button>
                  <button type="button" className="cc-btn-ghost" onClick={() => setChecked(new Set())}>Clear selection</button>
                </div>
              )}
              <CardState state={tableState} lines={8}
                empty={rows.length === 0 ? 'No current assets or renewal plans in this scope.' : filtered.length === 0 ? 'No assets match these filters.' : null}>
                <KitTable className="fr-table" manualPagination showPagination={false} enableSorting={false}
                  pageIndex={safePage} pageSize={pageSize} pageCount={pages} totalRows={filtered.length}
                  getRowId={(r) => String(r.id)} rows={pageRows} columns={columns} />
                <Pager page={safePage} pageSize={pageSize} total={filtered.length} noun="assets"
                  onPage={setPage} onPageSize={setPageSize} sizes={[10, 25, 50, 100]} />
              </CardState>
              {(bdCard.data === null && !bdCard.loading) && <p className="fr-foot">The breakdown register could not be read, so health scores use age alone.</p>}
            </Card>
          </div>
        </div>

        <aside className="fr-rail" aria-label="Planning guidance">
          <Card title={<>Planning Rules <span className="fr-tag">Rule based</span></>} sub="Findings from the register. These are fixed rules, not AI."
            action={<button type="button" className="cc-icon-btn" onClick={refreshAll} aria-label="Refresh"><RefreshCw size={14} /></button>}>
            <CardState state={fleetCard} empty={fleetCard.data && rules.length === 0 ? 'Nothing needs attention under the planning rule.' : null}>
              <div className="fr-rules">
                {rules.map((r) => {
                  const Icon = RULE_ICON[r.key] || Sparkles
                  return (
                    <button key={r.key} type="button" className="cc-insight"
                      onClick={() => { if (r.preset) applyPreset(r.preset); else if (r.priority) { setPreset(''); setPriority(r.priority) } }}>
                      <span className={`fr-rule-ic ${r.tone}`}><Icon size={15} aria-hidden="true" /></span>
                      <span><b>{r.title}</b><small>{r.detail}</small></span>
                    </button>
                  )
                })}
              </div>
            </CardState>
          </Card>

          <Card title="Quick Actions">
            <div className="cc-quick">
              <button type="button" onClick={() => openCreate()} disabled={notProvisioned}><Plus size={17} aria-hidden="true" /> Add renewal plan</button>
              <button type="button" disabled title="Renewal plans have no submit or review step. Set a plan to Approved from Edit plan."><Send size={17} aria-hidden="true" /> Submit for approval</button>
              <Link to="/tco-calculator"><Scale size={17} aria-hidden="true" /> Compare options</Link>
              <button type="button" onClick={doPlansExcel} disabled={!allPlans.length} title="Excel of every renewal plan in this scope"><Download size={17} aria-hidden="true" /> Export plan</button>
            </div>
          </Card>

          <Card title="Filter Presets">
            <CardState state={fleetCard}>
              <div className="fr-presets">
                {presets.map((p) => (
                  <button key={p.key} type="button" className="fr-preset" aria-pressed={preset === p.key} onClick={() => applyPreset(p.key)}>
                    <ListChecks size={15} aria-hidden="true" />
                    <span><b>{p.label}</b><small>{p.sub}</small></span>
                    <span className="cc-count">{fmtInt(p.count)}</span>
                  </button>
                ))}
              </div>
            </CardState>
          </Card>
        </aside>
      </div>

      {modalOpen && (
        <Modal
          open
          onClose={closeForm}
          size="md"
          title={
            <span className="inline-flex items-center gap-2">
              {editing ? <><Pencil size={16} /> Edit renewal plan</> : <><Plus size={16} /> New renewal plan</>}
            </span>
          }
        >
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label" htmlFor="frf-asset">Asset number *</label>
                <input id="frf-asset" className="input w-full" value={form.asset_no} onChange={(e) => setField('asset_no', e.target.value)} placeholder="e.g. TRK-1042" maxLength={120} />
              </div>
              <div>
                <label className="label" htmlFor="frf-site">Site</label>
                <input id="frf-site" className="input w-full" value={form.site} onChange={(e) => setField('site', e.target.value)} placeholder="Depot / branch" />
              </div>
              <div>
                <label className="label" htmlFor="frf-km">Current km</label>
                <input id="frf-km" type="number" className="input w-full" value={form.current_km} onChange={(e) => setField('current_km', e.target.value)} placeholder="e.g. 385000" />
              </div>
              <div>
                <label className="label" htmlFor="frf-age">Age (years)</label>
                <input id="frf-age" type="number" step="0.1" className="input w-full" value={form.age_years} onChange={(e) => setField('age_years', e.target.value)} placeholder="e.g. 8" />
              </div>
              <div>
                <label className="label" htmlFor="frf-pri">Priority</label>
                <select id="frf-pri" className="input w-full" value={form.priority} onChange={(e) => setField('priority', e.target.value)}>
                  {RENEWAL_PRIORITIES.map((p) => <option key={p} value={p}>{RENEWAL_PRIORITY_META[p].label}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="frf-status">Status</label>
                <select id="frf-status" className="input w-full" value={form.status} onChange={(e) => setField('status', e.target.value)}>
                  {RENEWAL_STATUSES.map((s) => <option key={s} value={s}>{RENEWAL_STATUS_META[s].label}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="frf-date">Target replace date</label>
                <input id="frf-date" type="date" className="input w-full" value={form.target_replace_date} onChange={(e) => setField('target_replace_date', e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="frf-cost">Estimated cost ({formCurrency})</label>
                <input id="frf-cost" type="number" className="input w-full" value={form.est_cost} onChange={(e) => setField('est_cost', e.target.value)} placeholder="e.g. 250000" />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="frf-rec">Recommended action</label>
              <input id="frf-rec" className="input w-full" value={form.recommendation} onChange={(e) => setField('recommendation', e.target.value)} placeholder="e.g. Replace with EV tractor unit" maxLength={8000} />
            </div>
            <div>
              <label className="label" htmlFor="frf-notes">Notes</label>
              <textarea id="frf-notes" className="input w-full min-h-[80px] resize-y" value={form.notes} onChange={(e) => setField('notes', e.target.value)} placeholder="Justification, TCO context, procurement notes..." maxLength={8000} />
            </div>
            {formError && (
              <div role="alert" className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
              </div>
            )}
            <div className="flex items-center justify-end gap-3 pt-1">
              <button type="button" onClick={closeForm} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
              <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                {saving ? 'Saving...' : (editing ? 'Save changes' : 'Create plan')}
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
          title="Delete renewal plan?"
          footer={
            <>
              <button type="button" onClick={closeDelete} className="btn-secondary text-sm" disabled={deleting}>Cancel</button>
              <button type="button" onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={deleting}>
                {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </>
          }
        >
          <p className="text-sm text-[var(--text-muted)]">The plan for <span className="font-medium text-[var(--text-secondary)]">{confirmDelete.asset_no}</span> will be permanently removed.</p>
          {deleteError && (
            <p role="alert" className="flex items-start gap-2 text-sm text-red-400" style={{ marginTop: 'var(--space-3)' }}>
              <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {deleteError}
            </p>
          )}
        </Modal>
      )}
    </div>
  )
}
