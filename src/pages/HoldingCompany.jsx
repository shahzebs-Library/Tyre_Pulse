/**
 * HoldingCompany (route /holding-company): group / parent-company
 * consolidation. Rolls every linked subsidiary into one command view: group
 * KPIs, a subsidiary register with fleet health, a ranked performance league,
 * spend by currency, inter-company asset transfers and a read-only access
 * matrix.
 *
 * Runs on the group RPCs and `holding_transfers` (V201). Zero subsidiaries is a
 * normal state: the group then holds only its own organisation, and every tab
 * still works on that one organisation with a link-a-subsidiary prompt.
 *
 * MONEY IS NEVER BLENDED. The consolidation RPC sums purchase orders that carry
 * no currency across every country the viewer can see, so the spend figure is
 * only printed as money when the viewer is scoped to exactly one country. An
 * org-wide or multi-country viewer sees "Mixed currencies" instead of a number
 * wearing the wrong label, and the spend ranking is disabled for them. The
 * decision lives in the pure src/lib/holdingCompanyAnalytics.js; the roll-up
 * primitives stay in src/lib/holdingCompany.js.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Building2, Network, Truck, CircleDot, AlertTriangle, ShieldAlert, Wallet,
  Trophy, ArrowRightLeft, Users, Search, X, Link2, Unlink, FileSpreadsheet,
  FileText, Plus, Pencil, Trash2, Activity, Layers, Sparkles, RotateCcw, Info,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Card from '../components/ui/Card'
import Modal from '../components/ui/Modal'
import StatTile from '../components/ui/StatTile'
import { Skeleton } from '../components/ui/Skeleton'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { useSettings } from '../contexts/SettingsContext'
import { useTenant } from '../contexts/TenantContext'
import { useAuth } from '../contexts/AuthContext'
import {
  getConsolidatedKpis, listSubsidiaries, linkSubsidiary, unlinkSubsidiary,
  listTransfers, createTransfer, updateTransfer, deleteTransfer,
} from '../lib/api/holdingCompany'
import { leagueTable, permissionMatrix, summariseHolding, LEAGUE_METRICS } from '../lib/holdingCompany'
import {
  ASSET_TYPES, TRANSFER_STATUSES, viewerCountries, spendCurrency, consolidateSpend,
  fmtSpend, fmtInt, groupHealth, healthBand, orgOptions as buildOrgOptions,
  filterTransfers, transferSummary, subsidiaryRows, subsidiaryExportRows,
} from '../lib/holdingCompanyAnalytics'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation, probeRelation } from '../lib/api/_client'

const ROLES = ['owner', 'admin', 'manager', 'viewer']
const TRANSFER_LIMIT = 500
const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-1'

const EMPTY_TRANSFER = {
  from_org_id: '', to_org_id: '', asset_type: 'tyre', asset_ref: '',
  quantity: '1', status: 'pending', notes: '',
}

const HEALTH_BAR = { good: 'bg-green-500', watch: 'bg-amber-500', risk: 'bg-red-500', none: 'bg-[var(--input-border)]' }
const STATUS_STYLE = {
  pending: 'text-amber-500 border-amber-500/40',
  in_transit: 'text-sky-500 border-sky-500/40',
  received: 'text-green-500 border-green-500/40',
  cancelled: 'text-[var(--text-muted)] border-[var(--input-border)]',
}
const ACCESS_STYLE = {
  full: 'text-green-500 border-green-500/40',
  write: 'text-sky-500 border-sky-500/40',
  read: 'text-amber-500 border-amber-500/40',
  none: 'text-[var(--text-muted)] border-[var(--input-border)]',
}

function fmtDate(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString()
}
const human = (s) => String(s || '').replace(/_/g, ' ')

function HealthBar({ score, label }) {
  const band = healthBand(score)
  return (
    <div className="flex items-center gap-2" role="img" aria-label={`${label}: ${score == null ? 'not measured' : `${score} of 100`}, ${band.label}`}>
      <div className="h-2 flex-1 rounded-full bg-[var(--input-bg)] overflow-hidden">
        {score != null && <div className={`h-full ${HEALTH_BAR[band.key]}`} style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />}
      </div>
      <span className="text-xs text-[var(--text-secondary)] whitespace-nowrap tabular-nums">{score == null ? 'N/A' : `${score}/100`} {band.label}</span>
    </div>
  )
}

function Heading({ icon: Icon, children, qualifier }) {
  return (
    <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex flex-wrap items-center gap-2">
      <Icon size={15} aria-hidden="true" /> {children}
      {qualifier && <span className="text-xs font-normal text-[var(--text-muted)]">{qualifier}</span>}
    </h2>
  )
}

export default function HoldingCompany() {
  const { activeCountry } = useSettings()
  const { orgName, branding } = useTenant() || {}
  const { profile, isSuperAdmin } = useAuth()

  const [tab, setTab] = useState('overview')
  const [dashboard, setDashboard] = useState(null)
  const [subsidiaries, setSubsidiaries] = useState([])
  const [transfers, setTransfers] = useState(null)
  const [transfersError, setTransfersError] = useState('')
  const [error, setError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  // Link / unlink
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkSlug, setLinkSlug] = useState('')
  const [linkError, setLinkError] = useState('')
  const [unlinkTarget, setUnlinkTarget] = useState(null)
  const [linking, setLinking] = useState(false)
  const [linkMsg, setLinkMsg] = useState('')

  const [metric, setMetric] = useState('fleet_health_score')
  const [subSearch, setSubSearch] = useState('')

  // Transfers filters + modal
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_TRANSFER)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setTransfersError(''); setNotProvisioned(false)
    try {
      const [dash, subs, tr] = await Promise.allSettled([
        getConsolidatedKpis(),
        listSubsidiaries(),
        listTransfers({ country: activeCountry, limit: TRANSFER_LIMIT }),
      ])
      if (dash.status === 'fulfilled') setDashboard(dash.value)
      else if (isMissingRelation(dash.reason)) { setDashboard(null); setNotProvisioned(true) }
      else { setDashboard(null); setError(toUserMessage(dash.reason, 'Could not load group consolidation.')) }
      setSubsidiaries(subs.status === 'fulfilled' && Array.isArray(subs.value) ? subs.value : [])
      if (tr.status === 'fulfilled') setTransfers(Array.isArray(tr.value) ? tr.value : [])
      else { setTransfers([]); setTransfersError(toUserMessage(tr.reason, 'Could not load inter-company transfers.')) }
      setUpdatedAt(new Date())
      // The services degrade a missing table to empty, so an empty group proves
      // nothing on its own. Only a DEFINITE missing relation shows the banner.
      const emptyGroup = dash.status === 'fulfilled' && (dash.value?.subsidiaries || []).length === 0
      if (emptyGroup && tr.status === 'fulfilled' && (tr.value || []).length === 0) {
        const { exists, checked } = await probeRelation('holding_transfers')
        if (checked && !exists) setNotProvisioned(true)
      }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summariseHolding(dashboard || {}), [dashboard])
  const subs = useMemo(() => dashboard?.subsidiaries || [], [dashboard])
  const rows = useMemo(() => subsidiaryRows(subs), [subs])
  const currency = useMemo(() => spendCurrency(viewerCountries({ ...(profile || {}), isSuperAdmin })), [profile, isSuperAdmin])
  const spend = useMemo(() => consolidateSpend(subs, currency), [subs, currency])
  const health = useMemo(() => groupHealth(subs), [subs])
  const effectiveMetric = !currency && metric === 'spend_30d' ? 'fleet_health_score' : metric
  const league = useMemo(() => leagueTable(subs, effectiveMetric), [subs, effectiveMetric])
  const matrix = useMemo(() => permissionMatrix(ROLES, subs), [subs])
  const orgs = useMemo(() => buildOrgOptions(subs, subsidiaries), [subs, subsidiaries])
  const nameOf = useCallback((id) => orgs.find((o) => o.id === String(id))?.name || id || 'N/A', [orgs])
  const tsum = useMemo(() => transferSummary(transfers), [transfers])
  const filteredTransfers = useMemo(
    () => filterTransfers(transfers, { status: statusFilter, search, nameOf }),
    [transfers, statusFilter, search, nameOf],
  )
  const filteredSubs = useMemo(() => {
    const q = subSearch.trim().toLowerCase()
    return q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows
  }, [rows, subSearch])

  const loading = dashboard === null && !error && !notProvisioned
  const failed = !!error
  const noSubsidiaries = !loading && !failed && !notProvisioned && summary.subsidiaryCount === 0
  const spendLabel = spend.single ? fmtSpend(spend.total, spend.single) : spend.undetermined ? 'Mixed currencies' : 'N/A'

  const tiles = [
    { label: 'Subsidiaries', value: failed ? 'N/A' : fmtInt(summary.subsidiaryCount), sub: `${rows.length} organisation${rows.length === 1 ? '' : 's'} in view`, icon: Network },
    { label: 'Fleet vehicles', value: failed ? 'N/A' : fmtInt(summary.totalVehicles), icon: Truck, tone: 'info' },
    { label: 'Tyres tracked', value: failed ? 'N/A' : fmtInt(summary.totalTyres), icon: CircleDot },
    { label: 'Open alerts', value: failed ? 'N/A' : fmtInt(summary.totalOpenAlerts), icon: AlertTriangle, tone: summary.totalOpenAlerts ? 'warn' : 'neutral' },
    { label: 'Critical alerts', value: failed ? 'N/A' : fmtInt(summary.totalCritical), icon: ShieldAlert, tone: summary.totalCritical ? 'crit' : 'neutral' },
    { label: 'Group spend (30d)', value: failed ? 'N/A' : spendLabel, sub: currency ? 'Purchase orders, last 30 days' : 'Several countries in scope; not summed', icon: Wallet, tone: 'accent' },
    { label: 'Group fleet health', value: failed || health == null ? 'N/A' : `${health}/100`, sub: healthBand(health).label, icon: Activity },
  ]

  // ── Exports (subsidiary register) ──────────────────────────────────────────
  const EXPORT_COLS = ['name', 'is_hq', 'vehicles', 'tyres', 'open_alerts', 'critical_alerts', 'low_tread', 'spend_30d', 'spend_currency', 'fleet_health_score']
  const EXPORT_HEADERS = ['Organisation', 'HQ', 'Vehicles', 'Tyres', 'Open alerts', 'Critical', 'Low tread', 'Spend 30d', 'Spend currency', 'Fleet health']
  const exportRows = useMemo(() => subsidiaryExportRows(filteredSubs, currency), [filteredSubs, currency])
  const fileBase = reportFileName('Group Consolidation')
  const exportExcel = async () => {
    try { await exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, fileBase, 'Organisations', { title: 'Group Consolidation', company: orgName, currency: currency || undefined }) }
    catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) }
  }
  const exportPdf = async () => {
    try {
      await exportToPdf(exportRows, EXPORT_COLS.map((key, i) => ({ key, header: EXPORT_HEADERS[i] })), 'Group Consolidation', fileBase, 'landscape', orgName || '', { currency: currency || undefined, branding })
    } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) }
  }

  // ── Link / unlink ──────────────────────────────────────────────────────────
  const doLink = useCallback(async (e) => {
    e?.preventDefault?.()
    const slug = linkSlug.trim()
    if (!slug) { setLinkError('Enter the organisation slug to link.'); return }
    setLinking(true); setLinkError('')
    try {
      const res = await linkSubsidiary(slug)
      setLinkMsg(`Linked ${res?.name || slug} as a subsidiary.`)
      setLinkOpen(false); setLinkSlug('')
      await load()
    } catch (err) {
      setLinkError(toUserMessage(err, 'Could not link that organisation.'))
    } finally {
      setLinking(false)
    }
  }, [linkSlug, load])

  const doUnlink = useCallback(async () => {
    const child = unlinkTarget
    if (!child?.tenant_id) return
    setLinking(true); setLinkError('')
    try {
      await unlinkSubsidiary(child.tenant_id)
      setLinkMsg(`Unlinked ${child.name}.`)
      setUnlinkTarget(null)
      await load()
    } catch (err) {
      setLinkError(toUserMessage(err, 'Could not unlink that organisation.'))
    } finally {
      setLinking(false)
    }
  }, [unlinkTarget, load])

  // ── Transfer modal ─────────────────────────────────────────────────────────
  const openCreate = () => { setEditing(null); setForm(EMPTY_TRANSFER); setFormError(''); setShowModal(true) }
  const openEdit = useCallback((t) => {
    setEditing(t)
    setForm({
      from_org_id: t.from_org_id || '', to_org_id: t.to_org_id || '',
      asset_type: t.asset_type || 'tyre', asset_ref: t.asset_ref || '',
      quantity: t.quantity ?? '1', status: t.status || 'pending', notes: t.notes || '',
    })
    setFormError(''); setShowModal(true)
  }, [])
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.from_org_id || !form.to_org_id) { setFormError('Both a source and destination organisation are required.'); return }
    if (form.from_org_id === form.to_org_id) { setFormError('Source and destination organisations must differ.'); return }
    setSaving(true)
    try {
      const payload = { ...form, country: activeCountry !== 'All' ? activeCountry : null }
      if (editing) await updateTransfer(editing.id, payload)
      else await createTransfer(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the transfer.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true); setDeleteError('')
    try {
      await deleteTransfer(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setDeleteError(toUserMessage(err, 'Could not delete the transfer.'))
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  // ── Tables ─────────────────────────────────────────────────────────────────
  const subColumns = useMemo(() => [
    {
      id: 'name', header: 'Organisation', accessorFn: (s) => s.name,
      cell: ({ row }) => (
        <div className="flex items-center gap-2 min-w-0">
          {row.original.logo_url
            ? <img src={row.original.logo_url} alt="" className="w-7 h-7 rounded object-cover shrink-0" />
            : <Building2 size={15} className="text-[var(--text-muted)] shrink-0" aria-hidden="true" />}
          <span className="font-medium text-[var(--text-primary)] truncate">{row.original.name}</span>
          {row.original.is_hq && <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--input-border)] text-[var(--text-secondary)]">Headquarters</span>}
        </div>
      ),
    },
    { id: 'health', header: 'Fleet health', accessorFn: (s) => s.fleet_health_score, cell: ({ row }) => <div className="min-w-[10rem]"><HealthBar score={row.original.fleet_health_score} label={`${row.original.name} fleet health`} /></div> },
    { id: 'vehicles', header: 'Vehicles', accessorFn: (s) => s.vehicles, meta: { align: 'right' }, cell: ({ getValue }) => <span className="tabular-nums">{fmtInt(getValue())}</span> },
    { id: 'tyres', header: 'Tyres', accessorFn: (s) => s.tyres, meta: { align: 'right' }, cell: ({ getValue }) => <span className="tabular-nums">{fmtInt(getValue())}</span> },
    { id: 'alerts', header: 'Open alerts', accessorFn: (s) => s.open_alerts, meta: { align: 'right' }, cell: ({ getValue }) => <span className="tabular-nums">{fmtInt(getValue())}</span> },
    { id: 'critical', header: 'Critical', accessorFn: (s) => s.critical_alerts, meta: { align: 'right' }, cell: ({ getValue }) => <span className={`tabular-nums ${getValue() ? 'text-red-400 font-semibold' : ''}`}>{fmtInt(getValue())}</span> },
    { id: 'lowTread', header: 'Low tread', accessorFn: (s) => s.low_tread, meta: { align: 'right' }, cell: ({ getValue }) => <span className="tabular-nums">{fmtInt(getValue())}</span> },
    { id: 'spend', header: 'Spend 30d', accessorFn: (s) => (currency ? s.spend_30d : null), meta: { align: 'right' }, cell: ({ row }) => <span className="tabular-nums">{fmtSpend(row.original.spend_30d, currency)}</span> },
    {
      id: 'actions', header: '', enableSorting: false, meta: { export: false },
      cell: ({ row }) => (row.original.is_hq ? null : (
        <button type="button" onClick={() => { setLinkError(''); setUnlinkTarget(row.original) }} className={`inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded hover:bg-red-500/10 text-[var(--text-muted)] hover:text-red-400 ${FOCUS}`} aria-label={`Unlink ${row.original.name}`} disabled={linking}>
          <Unlink size={14} aria-hidden="true" />
        </button>
      )),
    },
  ], [currency, linking])

  const matrixColumns = useMemo(() => [
    { id: 'role', header: 'Role', accessorFn: (r) => r.role, cell: ({ getValue }) => <span className="font-medium text-[var(--text-primary)] capitalize">{getValue()}</span> },
    ...subs.map((s, i) => ({
      id: `org_${i}`,
      header: `${s.name}${s.is_hq ? ' (HQ)' : ''}`,
      accessorFn: (r) => r.cells[i]?.level || 'none',
      enableSorting: false,
      cell: ({ getValue }) => <span className={`text-[11px] px-2 py-0.5 rounded-full border capitalize ${ACCESS_STYLE[getValue()]}`}>{getValue()}</span>,
    })),
  ], [subs])

  const transferColumns = useMemo(() => [
    { id: 'from', header: 'From', accessorFn: (t) => nameOf(t.from_org_id), cell: ({ getValue }) => <span className="text-[var(--text-primary)]">{getValue()}</span> },
    { id: 'to', header: 'To', accessorFn: (t) => nameOf(t.to_org_id), cell: ({ getValue }) => <span className="text-[var(--text-primary)]">{getValue()}</span> },
    { id: 'asset', header: 'Asset', accessorFn: (t) => t.asset_type || 'N/A', cell: ({ getValue }) => <span className="capitalize">{getValue()}</span> },
    { id: 'ref', header: 'Ref', accessorFn: (t) => t.asset_ref || 'N/A' },
    { id: 'qty', header: 'Qty', accessorFn: (t) => (t.quantity == null ? null : Number(t.quantity)), meta: { align: 'right' }, cell: ({ getValue }) => <span className="tabular-nums">{fmtInt(getValue())}</span> },
    { id: 'status', header: 'Status', accessorFn: (t) => human(t.status || 'pending'), cell: ({ row }) => <span className={`text-[11px] px-2 py-0.5 rounded-full border capitalize ${STATUS_STYLE[row.original.status] || STATUS_STYLE.pending}`}>{human(row.original.status || 'pending')}</span> },
    { id: 'date', header: 'Date', accessorFn: (t) => t.created_at || '', cell: ({ getValue }) => <span className="whitespace-nowrap">{fmtDate(getValue())}</span> },
    {
      id: 'actions', header: '', enableSorting: false, meta: { export: false },
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <button type="button" onClick={() => openEdit(row.original)} className={`inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)] ${FOCUS}`} aria-label="Edit transfer"><Pencil size={14} aria-hidden="true" /></button>
          <button type="button" onClick={() => { setDeleteError(''); setConfirmDelete(row.original) }} className={`inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded hover:bg-red-500/10 text-[var(--text-muted)] hover:text-red-400 ${FOCUS}`} aria-label="Delete transfer"><Trash2 size={14} aria-hidden="true" /></button>
        </div>
      ),
    },
  ], [nameOf, openEdit])

  const TABS = [
    { id: 'overview', label: 'Overview', icon: Layers, count: loading ? null : rows.length },
    { id: 'league', label: 'League table', icon: Trophy },
    { id: 'spend', label: 'Spend', icon: Wallet },
    { id: 'transfers', label: 'Transfers', icon: ArrowRightLeft, count: transfers && !transfersError ? transfers.length : null },
  ]
  const canTransfer = orgs.length >= 2

  return (
    <div className="space-y-6">
      <PageHeader
        title="Holding Company"
        subtitle="Consolidate every subsidiary into one group command view: fleet health, performance league, spend by currency and inter-company transfers."
        icon={Building2}
        badge={summary.subsidiaryCount ? `${summary.subsidiaryCount} subsidiaries` : undefined}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={exportExcel} className={`btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] ${FOCUS}`} disabled={!filteredSubs.length}>
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={exportPdf} className={`btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] ${FOCUS}`} disabled={!filteredSubs.length}>
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
            <button type="button" onClick={() => { setLinkError(''); setLinkOpen(true) }} className={`btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px] ${FOCUS}`} disabled={notProvisioned || linking}>
              <Link2 size={14} aria-hidden="true" /> Link subsidiary
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <Card tone="warn" className="items-start gap-[var(--space-3)]" style={{ flexDirection: 'row' }}>
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-[var(--text-primary)] font-medium">Group consolidation is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V201_HOLDING_COMPANY.sql</span>, then reload.
            </p>
          </div>
        </Card>
      )}

      {error && (
        <Card tone="crit" role="alert">
          <div className="flex flex-wrap items-start gap-[var(--space-3)]">
            <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
            <div className="flex-1 min-w-[12rem]"><p className="text-red-400 font-medium">Could not load group consolidation.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
            <button type="button" onClick={load} className={`btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] ${FOCUS}`}><RotateCcw size={14} aria-hidden="true" /> Retry</button>
          </div>
        </Card>
      )}

      {linkMsg && (
        <Card role="status" className="items-center justify-between gap-[var(--space-3)]" style={{ flexDirection: 'row' }}>
          <p className="text-sm text-[var(--text-secondary)] inline-flex items-center gap-2"><Sparkles size={14} aria-hidden="true" /> {linkMsg}</p>
          <button type="button" onClick={() => setLinkMsg('')} className={`inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] ${FOCUS}`} aria-label="Dismiss message"><X size={15} aria-hidden="true" /></button>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        {tiles.map((t, i) => (
          loading
            ? <div key={t.label} className="card !p-4 space-y-3"><Skeleton className="h-3 w-2/3" /><Skeleton className="h-7 w-1/2" /><Skeleton className="h-2.5 w-3/4" /></div>
            : <StatTile key={t.label} index={i} {...t} />
        ))}
      </div>

      {!currency && !loading && !failed && spend.any && (
        <p className="text-xs text-[var(--text-muted)] flex items-start gap-1.5">
          <Info size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
          Spend is recorded in each country's own currency (SAR, AED, EGP) with no currency on the purchase order, and your access spans more than one country, so spend is not added up or printed as money here. A user scoped to one country sees the figure in that currency.
        </p>
      )}

      {noSubsidiaries && (
        <Card className="items-center text-center" style={{ paddingBlock: 'var(--space-8)' }}>
          <Network size={26} className="mx-auto mb-3 text-[var(--text-muted)]" aria-hidden="true" />
          <h2 className="text-base font-bold text-[var(--text-primary)]">No subsidiaries linked yet</h2>
          <p className="text-sm text-[var(--text-muted)] mt-1 max-w-md mx-auto">
            The group currently holds only your own organisation, shown below. Link operating companies to roll their fleet, tyre, alert and spend data into this view.
          </p>
          <button type="button" onClick={() => { setLinkError(''); setLinkOpen(true) }} className={`btn-primary text-sm inline-flex items-center gap-1.5 mt-4 min-h-[44px] ${FOCUS}`} disabled={linking}>
            <Link2 size={14} aria-hidden="true" /> Link your first subsidiary
          </button>
        </Card>
      )}

      {!notProvisioned && (
        <>
          <div role="tablist" aria-label="Group sections" className="flex items-center gap-1 border-b border-[var(--input-border)] overflow-x-auto">
            {TABS.map((tb) => {
              const Icon = tb.icon
              const active = tab === tb.id
              return (
                <button key={tb.id} type="button" role="tab" aria-selected={active} onClick={() => setTab(tb.id)}
                  className={`inline-flex items-center gap-1.5 min-h-[44px] px-4 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${FOCUS} ${active ? 'border-[var(--accent)] text-[var(--text-primary)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>
                  <Icon size={15} aria-hidden="true" /> {tb.label}
                  {tb.count != null && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--input-bg)] text-[var(--text-secondary)] tabular-nums">{tb.count}</span>}
                </button>
              )
            })}
          </div>

          {tab === 'overview' && (
            <div className="space-y-4">
              <Card>
                <Heading icon={Building2}>Organisation register</Heading>
                <div className="relative max-w-md mb-3">
                  <label htmlFor="hc-sub-search" className="sr-only">Search organisations</label>
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
                  <input id="hc-sub-search" className={`input pl-9 w-full min-h-[44px] ${FOCUS}`} placeholder="Search organisation" value={subSearch} onChange={(e) => setSubSearch(e.target.value)} />
                </div>
                <EnterpriseTable
                  columns={subColumns}
                  data={filteredSubs}
                  getRowId={(s) => String(s.tenant_id)}
                  loading={loading}
                  error={failed ? error : null}
                  onRetry={load}
                  enableGlobalFilter={false}
                  enableExport={false}
                  emptyMessage={subSearch ? 'No organisation matches this search.' : 'No organisations in this group view.'}
                  initialPageSize={25}
                />
              </Card>

              <Card>
                <Heading icon={Users} qualifier="(role to subsidiary access, read-only; level shown as text)">Group access matrix</Heading>
                <EnterpriseTable
                  columns={matrixColumns}
                  data={matrix}
                  getRowId={(r) => r.role}
                  loading={loading}
                  error={failed ? error : null}
                  onRetry={load}
                  enableGlobalFilter={false}
                  enableColumnFilters={false}
                  exportFileName={reportFileName('Group Access Matrix')}
                  reportMeta={{ title: 'Group access matrix' }}
                  emptyMessage="No organisations to map access for."
                  initialPageSize={25}
                />
              </Card>
            </div>
          )}

          {tab === 'league' && (
            <Card>
              <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                <Heading icon={Trophy} qualifier="(headquarters excluded)">Subsidiary performance league</Heading>
                <div>
                  <label htmlFor="hc-metric" className="sr-only">League metric</label>
                  <select id="hc-metric" className={`input min-h-[44px] ${FOCUS}`} value={effectiveMetric} onChange={(e) => setMetric(e.target.value)}>
                    {Object.entries(LEAGUE_METRICS).map(([key, m]) => (
                      <option key={key} value={key} disabled={key === 'spend_30d' && !currency}>
                        {m.label} {m.dir === 'asc' ? '(lower is better)' : '(higher is better)'}{key === 'spend_30d' && !currency ? ' (needs a single currency)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {loading ? <Skeleton className="h-32 w-full" /> : failed ? (
                <p className="text-sm text-[var(--text-muted)] py-6 text-center">The league could not be built because the group did not load.</p>
              ) : league.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)] py-6 text-center">No subsidiaries to rank yet. The headquarters does not compete in its own league.</p>
              ) : (
                <ol className="space-y-2">
                  {(() => {
                    const max = Math.max(1, ...league.map((r) => r.metricValue))
                    const isMoney = effectiveMetric === 'spend_30d'
                    return league.map((r) => (
                      <li key={r.tenant_id} className="flex items-center gap-3">
                        <span className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 border border-[var(--input-border)] text-[var(--text-secondary)]" aria-label={`Rank ${r.rank}`}>{r.rank}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="text-sm font-medium text-[var(--text-primary)] truncate">{r.name}</span>
                            <span className="text-sm font-semibold text-[var(--text-secondary)] shrink-0 tabular-nums">{isMoney ? fmtSpend(r.metricValue, currency) : fmtInt(r.metricValue)}</span>
                          </div>
                          <div className="h-2 rounded-full bg-[var(--input-bg)] overflow-hidden" aria-hidden="true">
                            <div className="h-full bg-[var(--accent)]" style={{ width: `${Math.max(3, (r.metricValue / max) * 100)}%` }} />
                          </div>
                        </div>
                      </li>
                    ))
                  })()}
                </ol>
              )}
            </Card>
          )}

          {tab === 'spend' && (
            <Card>
              <Heading icon={Wallet} qualifier="(purchase orders, last 30 days)">Spend by currency</Heading>
              {loading ? <Skeleton className="h-32 w-full" /> : failed ? (
                <p className="text-sm text-[var(--text-muted)] py-6 text-center">Spend could not be shown because the group did not load.</p>
              ) : !spend.any ? (
                <p className="text-sm text-[var(--text-muted)] py-6 text-center">No spend recorded across the group in the last 30 days.</p>
              ) : (
                <div className="space-y-4">
                  {spend.byCurrency.map((b) => (
                    <div key={b.currency} className="rounded-lg border border-[var(--input-border)] p-3 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm text-[var(--text-secondary)]">{b.currency} across {b.orgs} organisation{b.orgs === 1 ? '' : 's'}</span>
                      <span className="text-lg font-bold text-[var(--text-primary)] tabular-nums">{fmtSpend(b.total, b.currency)}</span>
                    </div>
                  ))}
                  {spend.undetermined && (
                    <div className="rounded-lg border border-amber-500/40 p-3">
                      <p className="text-sm font-medium text-[var(--text-primary)]">Currency not determinable for {spend.undetermined.orgs} organisation{spend.undetermined.orgs === 1 ? '' : 's'}</p>
                      <p className="text-xs text-[var(--text-muted)] mt-1">These amounts mix SAR, AED and EGP, so no total is shown. Narrow your access to one country, or view per-country cost in the Expenses and CPK report.</p>
                    </div>
                  )}
                  {currency && (
                    <ul className="space-y-3">
                      {rows.filter((r) => r.spend_30d != null).sort((a, b) => b.spend_30d - a.spend_30d).map((r) => {
                        const pct = spend.total > 0 ? Math.round((r.spend_30d / spend.total) * 1000) / 10 : null
                        return (
                          <li key={r.tenant_id}>
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <span className="text-sm font-medium text-[var(--text-primary)] truncate">{r.name}</span>
                              <span className="text-sm font-semibold text-[var(--text-secondary)] shrink-0 tabular-nums">{fmtSpend(r.spend_30d, currency)} <span className="text-xs text-[var(--text-muted)]">({pct == null ? 'N/A' : `${pct}%`})</span></span>
                            </div>
                            <div className="h-2.5 rounded-full bg-[var(--input-bg)] overflow-hidden" aria-hidden="true">
                              <div className="h-full bg-[var(--accent)]" style={{ width: `${Math.max(2, pct || 0)}%` }} />
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              )}
            </Card>
          )}

          {tab === 'transfers' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatTile label="Transfers" value={transfersError ? 'N/A' : fmtInt(tsum.total)} sub={tsum.total >= TRANSFER_LIMIT ? `Latest ${TRANSFER_LIMIT} loaded` : ''} icon={ArrowRightLeft} />
                <StatTile label="Open movements" value={transfersError ? 'N/A' : fmtInt(tsum.open)} sub={`${tsum.byStatus.in_transit} in transit`} icon={Truck} tone={tsum.open ? 'warn' : 'neutral'} />
                <StatTile label="Received" value={transfersError ? 'N/A' : fmtInt(tsum.received)} icon={CircleDot} tone="accent" />
                <StatTile label="Units moved" value={transfersError ? 'N/A' : fmtInt(tsum.units)} sub="Excludes cancelled" icon={Layers} />
              </div>
              <Card>
                <div className="flex flex-wrap items-end gap-2 mb-3">
                  <div className="relative flex-1 min-w-[12rem]">
                    <label htmlFor="hc-tr-search" className="sr-only">Search transfers</label>
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
                    <input id="hc-tr-search" className={`input pl-9 w-full min-h-[44px] ${FOCUS}`} placeholder="Search organisation, asset ref, notes" value={search} onChange={(e) => setSearch(e.target.value)} />
                  </div>
                  <label htmlFor="hc-tr-status" className="sr-only">Status</label>
                  <select id="hc-tr-status" className={`input min-h-[44px] ${FOCUS}`} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                    <option value="">All statuses</option>
                    {TRANSFER_STATUSES.map((s) => <option key={s} value={s}>{human(s)}</option>)}
                  </select>
                  {(search || statusFilter) && <button type="button" onClick={() => { setSearch(''); setStatusFilter('') }} className={`btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] ${FOCUS}`}><X size={14} aria-hidden="true" /> Clear</button>}
                  <button type="button" onClick={openCreate} className={`btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px] ${FOCUS}`} disabled={!canTransfer} title={canTransfer ? undefined : 'Link a subsidiary first: a transfer needs two organisations.'}>
                    <Plus size={14} aria-hidden="true" /> New transfer
                  </button>
                  <span className="text-xs text-[var(--text-muted)] ml-auto self-center" aria-live="polite">{filteredTransfers.length} of {transfers?.length || 0}</span>
                </div>
                {!canTransfer && !loading && <p className="text-xs text-[var(--text-muted)] mb-3">A transfer moves assets between two organisations, so it needs at least one linked subsidiary.</p>}
                <EnterpriseTable
                  columns={transferColumns}
                  data={filteredTransfers}
                  getRowId={(t) => String(t.id)}
                  loading={transfers === null}
                  error={transfersError || null}
                  onRetry={load}
                  enableGlobalFilter={false}
                  exportFileName={reportFileName('Inter-company Transfers')}
                  reportMeta={{ title: 'Inter-company transfers' }}
                  emptyMessage={(transfers?.length || 0) === 0 ? 'No inter-company transfers yet.' : 'No transfers match these filters.'}
                  initialPageSize={25}
                />
              </Card>
            </div>
          )}
        </>
      )}

      {linkOpen && (
        <Modal open size="sm" onClose={() => { if (!linking) setLinkOpen(false) }} title="Link a subsidiary">
          <form onSubmit={doLink} className="space-y-4">
            <div>
              <label className="label" htmlFor="hc-link-slug">Organisation slug</label>
              <input id="hc-link-slug" className="input w-full min-h-[44px]" value={linkSlug} maxLength={200} onChange={(e) => setLinkSlug(e.target.value)} placeholder="e.g. green-concrete-uae" autoFocus />
              <p className="text-xs text-[var(--text-muted)] mt-1">The organisation must have opted in to being linked.</p>
            </div>
            {linkError && <p role="alert" className="text-sm text-red-400">{linkError}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setLinkOpen(false)} className="btn-secondary text-sm min-h-[44px]" disabled={linking}>Cancel</button>
              <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={linking}>
                <Link2 size={14} aria-hidden="true" /> {linking ? 'Linking...' : 'Link'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {unlinkTarget && (
        <Modal
          open
          size="sm"
          onClose={() => { if (!linking) setUnlinkTarget(null) }}
          title="Unlink this subsidiary?"
          footer={(
            <>
              <button type="button" onClick={() => setUnlinkTarget(null)} className="btn-secondary text-sm min-h-[44px]" disabled={linking}>Cancel</button>
              <button type="button" onClick={doUnlink} className="btn-danger text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={linking}>
                <Unlink size={14} aria-hidden="true" /> {linking ? 'Unlinking...' : 'Unlink'}
              </button>
            </>
          )}
        >
          <p className="text-sm text-[var(--text-secondary)]">Unlink {unlinkTarget.name} from the group? Its data will no longer roll up here.</p>
          {linkError && <p role="alert" className="mt-3 text-sm text-red-400">{linkError}</p>}
        </Modal>
      )}

      {showModal && (
        <Modal open onClose={closeModal} size="lg" title={editing ? 'Edit transfer' : 'Record inter-company transfer'}>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label" htmlFor="hc-from">From organisation</label>
                <select id="hc-from" className="input w-full min-h-[44px]" value={form.from_org_id} onChange={(e) => set('from_org_id', e.target.value)}>
                  <option value="">Select source...</option>
                  {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="hc-to">To organisation</label>
                <select id="hc-to" className="input w-full min-h-[44px]" value={form.to_org_id} onChange={(e) => set('to_org_id', e.target.value)}>
                  <option value="">Select destination...</option>
                  {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="label" htmlFor="hc-type">Asset type</label>
                <select id="hc-type" className="input w-full min-h-[44px]" value={form.asset_type} onChange={(e) => set('asset_type', e.target.value)}>
                  {ASSET_TYPES.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="hc-qty">Quantity</label>
                <input id="hc-qty" className="input w-full min-h-[44px]" type="number" step="1" min="0" value={form.quantity} onChange={(e) => set('quantity', e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="hc-status">Status</label>
                <select id="hc-status" className="input w-full min-h-[44px]" value={form.status} onChange={(e) => set('status', e.target.value)}>
                  {TRANSFER_STATUSES.map((s) => <option key={s} value={s}>{human(s)}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="label" htmlFor="hc-ref">Asset reference (optional)</label>
              <input id="hc-ref" className="input w-full min-h-[44px]" placeholder="e.g. tyre serial, plate or PO" value={form.asset_ref} maxLength={200} onChange={(e) => set('asset_ref', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="hc-notes">Notes (optional)</label>
              <textarea id="hc-notes" className="input w-full min-h-[80px] resize-y" placeholder="Reason, condition, approvals" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
            </div>

            {formError && (
              <div role="alert" className="flex items-start gap-2 text-sm text-red-400 border border-red-500/30 rounded-lg px-3 py-2">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {formError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button type="button" onClick={closeModal} className="btn-secondary text-sm min-h-[44px]" disabled={saving}>Cancel</button>
              <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={saving}>
                {saving ? 'Saving...' : editing ? 'Save changes' : 'Record transfer'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {confirmDelete && (
        <Modal
          open
          onClose={() => { if (!deleting) setConfirmDelete(null) }}
          size="sm"
          title="Delete this transfer?"
          footer={(
            <>
              <button type="button" onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm min-h-[44px]" disabled={deleting}>Cancel</button>
              <button type="button" onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={deleting}>
                <Trash2 size={14} aria-hidden="true" /> {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </>
          )}
        >
          <p className="text-sm text-[var(--text-muted)]">
            {nameOf(confirmDelete.from_org_id)} to {nameOf(confirmDelete.to_org_id)}, {confirmDelete.asset_type}, quantity {fmtInt(confirmDelete.quantity)}. This cannot be undone.
          </p>
          {deleteError && <p role="alert" className="mt-3 text-sm text-red-400">{deleteError}</p>}
        </Modal>
      )}
    </div>
  )
}
