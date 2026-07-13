/**
 * HoldingCompany (route /holding-company) — group / parent-company
 * consolidation. Rolls up every linked subsidiary into one command view:
 * grand-total KPIs, per-subsidiary fleet-health, a ranked performance league,
 * spend distribution, inter-company asset transfers, and a read-only access
 * matrix. This is where a holding company sees the whole portfolio at once and
 * decides where to intervene.
 *
 * Runs on the group RPCs + `holding_transfers` (V201). Real data, KPI tiles,
 * link/unlink actions, transfer create/edit modal, filters, search, delete
 * confirm, Excel/PDF export, and loading / empty / not-provisioned / error
 * states throughout. All roll-up maths live in the pure `src/lib/holdingCompany.js`
 * helpers.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Building2, Network, Truck, CircleDot, AlertTriangle, ShieldAlert, Wallet,
  Trophy, TrendingUp, ArrowRightLeft, Users, Search, X, Filter, Link2, Unlink,
  FileSpreadsheet, FileText, Plus, Pencil, Trash2, Activity, Layers, Sparkles,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import { useTenant } from '../contexts/TenantContext'
import {
  getConsolidatedKpis, listSubsidiaries, linkSubsidiary, unlinkSubsidiary,
  listTransfers, createTransfer, updateTransfer, deleteTransfer,
} from '../lib/api/holdingCompany'
import {
  leagueTable, spendBreakdown, permissionMatrix, summariseHolding, LEAGUE_METRICS,
} from '../lib/holdingCompany'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

const TABS = [
  { id: 'overview', label: 'Overview', icon: Layers },
  { id: 'league', label: 'League Table', icon: Trophy },
  { id: 'spend', label: 'Spend', icon: Wallet },
  { id: 'transfers', label: 'Transfers', icon: ArrowRightLeft },
]

const ASSET_TYPES = ['tyre', 'vehicle', 'part', 'other']
const TRANSFER_STATUSES = ['pending', 'in_transit', 'received', 'cancelled']
const ROLES = ['owner', 'admin', 'manager', 'viewer']

const EMPTY_TRANSFER = {
  from_org_id: '', to_org_id: '', asset_type: 'tyre', asset_ref: '',
  quantity: '1', status: 'pending', notes: '',
}

const fmtInt = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString())
const fmtMoney = (v, cur = 'SAR') =>
  v == null || v === '' ? '—' : `${cur} ${Math.round(Number(v)).toLocaleString()}`

function fmtDate(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') ||
    m.includes('schema cache') || m.includes('could not find')
}

// Health-score → tone (bar + text colour). 0–100 scale.
function healthTone(score) {
  const s = Number(score) || 0
  if (s >= 80) return { bar: 'bg-green-500', text: 'text-green-400', label: 'Healthy' }
  if (s >= 60) return { bar: 'bg-amber-500', text: 'text-amber-400', label: 'Watch' }
  return { bar: 'bg-red-500', text: 'text-red-400', label: 'At risk' }
}

const STATUS_STYLE = {
  pending: 'bg-amber-900/30 text-amber-300 border-amber-800/50',
  in_transit: 'bg-sky-900/30 text-sky-300 border-sky-800/50',
  received: 'bg-green-900/30 text-green-300 border-green-800/50',
  cancelled: 'bg-gray-800/50 text-gray-400 border-gray-700/50',
}

const ACCESS_STYLE = {
  full: 'bg-green-900/30 text-green-300',
  write: 'bg-sky-900/30 text-sky-300',
  read: 'bg-amber-900/30 text-amber-300',
  none: 'bg-gray-800/40 text-gray-500',
}

export default function HoldingCompany() {
  const { activeCountry, activeCurrency } = useSettings()
  const { orgName, branding } = useTenant()
  const currency = activeCurrency || 'SAR'

  const [tab, setTab] = useState('overview')
  const [dashboard, setDashboard] = useState(null)
  const [subsidiaries, setSubsidiaries] = useState([])
  const [transfers, setTransfers] = useState(null)
  const [error, setError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  // Link subsidiary
  const [linking, setLinking] = useState(false)
  const [linkMsg, setLinkMsg] = useState('')

  // League metric
  const [metric, setMetric] = useState('fleet_health_score')

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

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setNotProvisioned(false)
    try {
      const [dash, subs, tr] = await Promise.all([
        getConsolidatedKpis(),
        listSubsidiaries(),
        listTransfers({ country: activeCountry }),
      ])
      setDashboard(dash)
      setSubsidiaries(Array.isArray(subs) ? subs : [])
      setTransfers(Array.isArray(tr) ? tr : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(err?.message || 'Could not load group consolidation.')
      setDashboard(null); setSubsidiaries([]); setTransfers([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summariseHolding(dashboard || {}), [dashboard])
  const subs = useMemo(() => dashboard?.subsidiaries || [], [dashboard])
  const league = useMemo(() => leagueTable(subs, metric), [subs, metric])
  const spend = useMemo(() => spendBreakdown(subs), [subs])
  const matrix = useMemo(() => permissionMatrix(ROLES, subs), [subs])
  const maxSpend = useMemo(() => Math.max(1, ...spend.map((s) => s.spend)), [spend])

  const isEmpty = !notProvisioned && (dashboard != null) && summary.subsidiaryCount === 0

  // Org options for transfer from/to selects (linked subsidiaries + HQ).
  const orgOptions = useMemo(() => {
    const opts = subs.map((s) => ({ id: s.tenant_id, name: s.name }))
    // include linked-subsidiary roster too (covers not-yet-in-dashboard rows)
    for (const s of subsidiaries) {
      if (!opts.some((o) => o.id === s.id)) opts.push({ id: s.id, name: s.name })
    }
    return opts
  }, [subs, subsidiaries])
  const orgName_ = useCallback(
    (id) => orgOptions.find((o) => o.id === id)?.name || id || '—',
    [orgOptions],
  )

  // ── Transfers: filter + search ─────────────────────────────────────────────
  const filteredTransfers = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (transfers || []).filter((t) => {
      if (statusFilter && t.status !== statusFilter) return false
      if (q) {
        const hay = `${orgName_(t.from_org_id)} ${orgName_(t.to_org_id)} ${t.asset_type || ''} ${t.asset_ref || ''} ${t.notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [transfers, statusFilter, search, orgName_])

  // ── Exports (subsidiary KPI rows) ──────────────────────────────────────────
  const EXPORT_COLS = ['name', 'is_hq', 'vehicles', 'tyres', 'open_alerts', 'critical_alerts', 'low_tread', 'spend_30d', 'fleet_health_score']
  const EXPORT_HEADERS = ['Subsidiary', 'HQ', 'Vehicles', 'Tyres', 'Open Alerts', 'Critical', 'Low Tread', 'Spend 30d', 'Fleet Health']
  const exportRows = useMemo(
    () => subs.map((s) => ({
      name: s.name || '',
      is_hq: s.is_hq ? 'Yes' : 'No',
      vehicles: s.vehicles ?? 0,
      tyres: s.tyres ?? 0,
      open_alerts: s.open_alerts ?? 0,
      critical_alerts: s.critical_alerts ?? 0,
      low_tread: s.low_tread ?? 0,
      spend_30d: s.spend_30d ?? 0,
      fleet_health_score: s.fleet_health_score ?? 0,
    })),
    [subs],
  )
  const exportExcel = () =>
    exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'holding_consolidation', 'Subsidiaries', {
      title: 'Group Consolidation', company: orgName, currency,
    })
  const exportPdf = () =>
    exportToPdf(
      exportRows,
      EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })),
      'Group Consolidation', 'holding_consolidation', 'landscape', orgName || '',
      { currency, branding },
    )

  // ── Link / unlink subsidiaries ─────────────────────────────────────────────
  const doLink = useCallback(async () => {
    const slug = window.prompt('Enter the organisation slug to link as a subsidiary:')
    if (!slug || !slug.trim()) return
    setLinking(true); setLinkMsg('')
    try {
      const res = await linkSubsidiary(slug.trim())
      setLinkMsg(`Linked ${res?.name || slug} as a subsidiary.`)
      await load()
    } catch (err) {
      setLinkMsg(err?.message || 'Could not link that organisation.')
    } finally {
      setLinking(false)
    }
  }, [load])

  const doUnlink = useCallback(async (child) => {
    if (!child?.tenant_id) return
    if (!window.confirm(`Unlink ${child.name} from the group? Its data will no longer roll up here.`)) return
    setLinking(true); setLinkMsg('')
    try {
      await unlinkSubsidiary(child.tenant_id)
      setLinkMsg(`Unlinked ${child.name}.`)
      await load()
    } catch (err) {
      setLinkMsg(err?.message || 'Could not unlink that organisation.')
    } finally {
      setLinking(false)
    }
  }, [load])

  // ── Transfer modal ─────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null); setForm(EMPTY_TRANSFER); setFormError(''); setShowModal(true)
  }
  const openEdit = (t) => {
    setEditing(t)
    setForm({
      from_org_id: t.from_org_id || '', to_org_id: t.to_org_id || '',
      asset_type: t.asset_type || 'tyre', asset_ref: t.asset_ref || '',
      quantity: t.quantity ?? '1', status: t.status || 'pending', notes: t.notes || '',
    })
    setFormError(''); setShowModal(true)
  }
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
      setFormError(err?.message || 'Could not save the transfer.')
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteTransfer(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setError(err?.message || 'Could not delete the transfer.')
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => { setSearch(''); setStatusFilter('') }
  const hasFilters = search || statusFilter
  const loading = dashboard === null && !error && !notProvisioned

  // ── KPI tiles (grand total) ────────────────────────────────────────────────
  const kpis = [
    { label: 'Subsidiaries', value: fmtInt(summary.subsidiaryCount), icon: Network, tone: 'text-[var(--text-primary)]' },
    { label: 'Fleet vehicles', value: fmtInt(summary.totalVehicles), icon: Truck, tone: 'text-sky-400' },
    { label: 'Tyres tracked', value: fmtInt(summary.totalTyres), icon: CircleDot, tone: 'text-indigo-400' },
    { label: 'Open alerts', value: fmtInt(summary.totalOpenAlerts), icon: AlertTriangle, tone: 'text-amber-400' },
    { label: 'Critical alerts', value: fmtInt(summary.totalCritical), icon: ShieldAlert, tone: 'text-red-400' },
    { label: 'Group spend (30d)', value: fmtMoney(summary.totalSpend30d, currency), icon: Wallet, tone: 'text-green-400' },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Holding Company"
        subtitle="Consolidate every subsidiary into one group command view — fleet health, performance league, spend distribution, and inter-company transfers."
        icon={Building2}
        badge={summary.subsidiaryCount ? `${summary.subsidiaryCount} orgs` : undefined}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={exportExcel} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!subs.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={exportPdf} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!subs.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={doLink} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={notProvisioned || linking}>
              <Link2 size={14} /> {linking ? 'Working…' : 'Link subsidiary'}
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Group consolidation isn’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V201_HOLDING_COMPANY.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load group consolidation.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
        </div>
      )}

      {linkMsg && (
        <div className="card border border-[var(--input-border)] flex items-center justify-between gap-3">
          <p className="text-sm text-[var(--text-secondary)] inline-flex items-center gap-2"><Sparkles size={14} className="text-indigo-400" /> {linkMsg}</p>
          <button onClick={() => setLinkMsg('')} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={15} /></button>
        </div>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon
          return (
            <div key={k.label} className="card">
              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                <Icon size={16} className={k.tone} />
              </div>
              <p className={`text-2xl font-bold mt-1 ${k.tone}`}>{loading ? '—' : k.value}</p>
            </div>
          )
        })}
      </div>

      {/* Group-health strip */}
      {!loading && summary.subsidiaryCount > 0 && (
        <div className="card flex items-center gap-4">
          <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
            <Activity size={15} className="text-indigo-400" /> Group fleet health
          </div>
          <div className="flex-1 h-2.5 rounded-full bg-[var(--input-bg)] overflow-hidden">
            <div className={`h-full ${healthTone(summary.avgHealth).bar}`} style={{ width: `${Math.min(100, summary.avgHealth)}%` }} />
          </div>
          <span className={`text-sm font-semibold ${healthTone(summary.avgHealth).text}`}>{summary.avgHealth}/100 · {healthTone(summary.avgHealth).label}</span>
        </div>
      )}

      {/* Not-provisioned empty state / link CTA */}
      {isEmpty && (
        <div className="card flex flex-col items-center text-center py-12">
          <div className="w-14 h-14 rounded-2xl bg-indigo-900/30 border border-indigo-800/40 flex items-center justify-center mb-4">
            <Network size={26} className="text-indigo-400" />
          </div>
          <h3 className="text-lg font-bold text-[var(--text-primary)]">No subsidiaries linked yet</h3>
          <p className="text-sm text-[var(--text-muted)] mt-1 max-w-md">
            Link operating companies to this parent organisation to roll their fleet, tyre, alert, and spend data into one consolidated group view.
          </p>
          <button onClick={doLink} className="btn-primary text-sm inline-flex items-center gap-1.5 mt-5" disabled={linking}>
            <Link2 size={14} /> Link your first subsidiary
          </button>
        </div>
      )}

      {/* Tabs */}
      {!isEmpty && !notProvisioned && (
        <>
          <div className="flex items-center gap-1 border-b border-[var(--input-border)] overflow-x-auto">
            {TABS.map((tb) => {
              const Icon = tb.icon
              const active = tab === tb.id
              return (
                <button
                  key={tb.id}
                  onClick={() => setTab(tb.id)}
                  className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
                    active
                      ? 'border-indigo-500 text-[var(--text-primary)]'
                      : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <Icon size={15} /> {tb.label}
                  {tb.id === 'transfers' && (transfers?.length ? <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--input-bg)]">{transfers.length}</span> : null)}
                </button>
              )
            })}
          </div>

          {/* ── OVERVIEW ─────────────────────────────────────────────────── */}
          {tab === 'overview' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {subs.map((s) => {
                  const tone = healthTone(s.fleet_health_score)
                  return (
                    <div key={s.tenant_id} className="card">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {s.logo_url
                            ? <img src={s.logo_url} alt="" className="w-8 h-8 rounded-lg object-cover shrink-0" />
                            : <div className="w-8 h-8 rounded-lg bg-[var(--input-bg)] flex items-center justify-center shrink-0"><Building2 size={15} className="text-[var(--text-muted)]" /></div>}
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{s.name}</p>
                            {s.is_hq && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-900/30 text-indigo-300 border border-indigo-800/40">Headquarters</span>}
                          </div>
                        </div>
                        {!s.is_hq && (
                          <button onClick={() => doUnlink(s)} className="p-1.5 rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400 shrink-0" aria-label="Unlink" disabled={linking}>
                            <Unlink size={14} />
                          </button>
                        )}
                      </div>

                      <div className="flex items-center justify-between mt-3 mb-1.5">
                        <span className="text-xs text-[var(--text-muted)]">Fleet health</span>
                        <span className={`text-xs font-semibold ${tone.text}`}>{Number(s.fleet_health_score) || 0}/100</span>
                      </div>
                      <div className="h-2 rounded-full bg-[var(--input-bg)] overflow-hidden">
                        <div className={`h-full ${tone.bar}`} style={{ width: `${Math.min(100, Number(s.fleet_health_score) || 0)}%` }} />
                      </div>

                      <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                        <div><p className="text-xs text-[var(--text-muted)]">Vehicles</p><p className="text-sm font-semibold text-[var(--text-primary)]">{fmtInt(s.vehicles)}</p></div>
                        <div><p className="text-xs text-[var(--text-muted)]">Tyres</p><p className="text-sm font-semibold text-[var(--text-primary)]">{fmtInt(s.tyres)}</p></div>
                        <div><p className="text-xs text-[var(--text-muted)]">Alerts</p><p className="text-sm font-semibold text-amber-400">{fmtInt(s.open_alerts)}</p></div>
                        <div><p className="text-xs text-[var(--text-muted)]">Critical</p><p className="text-sm font-semibold text-red-400">{fmtInt(s.critical_alerts)}</p></div>
                        <div><p className="text-xs text-[var(--text-muted)]">Low tread</p><p className="text-sm font-semibold text-orange-400">{fmtInt(s.low_tread)}</p></div>
                        <div><p className="text-xs text-[var(--text-muted)]">Spend 30d</p><p className="text-sm font-semibold text-green-400">{fmtMoney(s.spend_30d, currency)}</p></div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Permission matrix (read-only) */}
              <div className="card">
                <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
                  <Users size={15} /> Group access matrix
                  <span className="text-xs font-normal text-[var(--text-muted)]">(role → subsidiary access, read-only)</span>
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                        <th className="px-3 py-2 font-semibold">Role</th>
                        {subs.map((s) => <th key={s.tenant_id} className="px-3 py-2 font-semibold whitespace-nowrap">{s.name}{s.is_hq ? ' (HQ)' : ''}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {matrix.map((row) => (
                        <tr key={row.role} className="border-b border-[var(--input-border)]/50">
                          <td className="px-3 py-2 font-medium text-[var(--text-primary)] capitalize">{row.role}</td>
                          {row.cells.map((c) => (
                            <td key={c.tenant_id} className="px-3 py-2">
                              <span className={`text-[11px] px-2 py-0.5 rounded-full capitalize ${ACCESS_STYLE[c.level]}`}>{c.level}</span>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ── LEAGUE TABLE ─────────────────────────────────────────────── */}
          {tab === 'league' && (
            <div className="card space-y-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2"><Trophy size={15} className="text-amber-400" /> Subsidiary performance league</h3>
                <select className="input" value={metric} onChange={(e) => setMetric(e.target.value)} aria-label="League metric">
                  {Object.entries(LEAGUE_METRICS).map(([k, m]) => (
                    <option key={k} value={k}>{m.label} {m.dir === 'asc' ? '(lower is better)' : '(higher is better)'}</option>
                  ))}
                </select>
              </div>
              {league.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)] py-6 text-center">No subsidiaries to rank yet.</p>
              ) : (
                <div className="space-y-2">
                  {(() => {
                    const max = Math.max(1, ...league.map((r) => r.metricValue))
                    const isMoney = metric === 'spend_30d'
                    return league.map((r) => (
                      <div key={r.tenant_id} className="flex items-center gap-3">
                        <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${r.rank === 1 ? 'bg-amber-500/20 text-amber-300' : r.rank === 2 ? 'bg-gray-400/20 text-gray-300' : r.rank === 3 ? 'bg-orange-700/30 text-orange-300' : 'bg-[var(--input-bg)] text-[var(--text-muted)]'}`}>{r.rank}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="text-sm font-medium text-[var(--text-primary)] truncate">{r.name}</span>
                            <span className="text-sm font-semibold text-[var(--text-secondary)] shrink-0">{isMoney ? fmtMoney(r.metricValue, currency) : fmtInt(r.metricValue)}</span>
                          </div>
                          <div className="h-2 rounded-full bg-[var(--input-bg)] overflow-hidden">
                            <div className="h-full bg-indigo-500" style={{ width: `${Math.max(3, (r.metricValue / max) * 100)}%` }} />
                          </div>
                        </div>
                      </div>
                    ))
                  })()}
                </div>
              )}
            </div>
          )}

          {/* ── SPEND ────────────────────────────────────────────────────── */}
          {tab === 'spend' && (
            <div className="card space-y-4">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2"><Wallet size={15} className="text-green-400" /> 30-day spend distribution</h3>
              {spend.length === 0 || spend.every((s) => s.spend === 0) ? (
                <p className="text-sm text-[var(--text-muted)] py-6 text-center">No spend recorded across the group in the last 30 days.</p>
              ) : (
                <div className="space-y-3">
                  {spend.map((s) => (
                    <div key={s.name} className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-sm font-medium text-[var(--text-primary)] truncate">{s.name}</span>
                          <span className="text-sm font-semibold text-green-400 shrink-0">{fmtMoney(s.spend, currency)} <span className="text-xs text-[var(--text-muted)]">({s.pct}%)</span></span>
                        </div>
                        <div className="h-2.5 rounded-full bg-[var(--input-bg)] overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-green-600 to-emerald-400" style={{ width: `${Math.max(2, (s.spend / maxSpend) * 100)}%` }} />
                        </div>
                      </div>
                    </div>
                  ))}
                  <div className="flex items-center justify-between pt-2 border-t border-[var(--input-border)] text-sm">
                    <span className="text-[var(--text-muted)] inline-flex items-center gap-1.5"><TrendingUp size={14} /> Group total</span>
                    <span className="font-bold text-[var(--text-primary)]">{fmtMoney(summary.totalSpend30d, currency)}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── TRANSFERS ────────────────────────────────────────────────── */}
          {tab === 'transfers' && (
            <div className="space-y-4">
              <div className="card space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative flex-1 min-w-[200px]">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                    <input className="input pl-9 w-full" placeholder="Search org, asset ref, notes…" value={search} onChange={(e) => setSearch(e.target.value)} />
                  </div>
                  <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
                    <option value="">All statuses</option>
                    {TRANSFER_STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                  </select>
                  {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
                  <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5"><Plus size={14} /> New transfer</button>
                  <span className="text-xs text-[var(--text-muted)] ml-auto">{filteredTransfers.length} of {transfers?.length || 0}</span>
                </div>
              </div>

              <div className="card overflow-hidden !p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                        {['From', 'To', 'Asset', 'Ref', 'Qty', 'Status', 'Date', ''].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {transfers === null ? (
                        [0, 1, 2, 3].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={8} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
                      ) : filteredTransfers.length === 0 ? (
                        <tr><td colSpan={8} className="px-4 py-12 text-center text-[var(--text-muted)]">
                          <Filter size={22} className="mx-auto mb-2 opacity-60" />
                          {(transfers?.length || 0) === 0 ? 'No inter-company transfers yet — record your first movement.' : 'No transfers match these filters.'}
                        </td></tr>
                      ) : (
                        filteredTransfers.slice(0, 500).map((t) => (
                          <tr key={t.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                            <td className="px-4 py-2.5 text-[var(--text-primary)]">{orgName_(t.from_org_id)}</td>
                            <td className="px-4 py-2.5 text-[var(--text-primary)]">{orgName_(t.to_org_id)}</td>
                            <td className="px-4 py-2.5 text-[var(--text-secondary)] capitalize">{t.asset_type || '—'}</td>
                            <td className="px-4 py-2.5 text-[var(--text-secondary)]">{t.asset_ref || '—'}</td>
                            <td className="px-4 py-2.5 text-[var(--text-secondary)]">{fmtInt(t.quantity)}</td>
                            <td className="px-4 py-2.5">
                              <span className={`text-[11px] px-2 py-0.5 rounded-full border capitalize ${STATUS_STYLE[t.status] || STATUS_STYLE.pending}`}>{(t.status || 'pending').replace('_', ' ')}</span>
                            </td>
                            <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtDate(t.created_at)}</td>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center justify-end gap-1">
                                <button onClick={() => openEdit(t)} className="p-1.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Edit"><Pencil size={14} /></button>
                                <button onClick={() => setConfirmDelete(t)} className="p-1.5 rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" aria-label="Delete"><Trash2 size={14} /></button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                {filteredTransfers.length > 500 && <p className="px-4 py-2 text-xs text-[var(--text-muted)] border-t border-[var(--input-border)]">Showing first 500 — refine filters or export for the full set.</p>}
              </div>
            </div>
          )}
        </>
      )}

      {/* Transfer create / edit modal */}
      {showModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={closeModal}>
          <div className="card w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[var(--text-primary)]">{editing ? 'Edit transfer' : 'Record inter-company transfer'}</h3>
              <button onClick={closeModal} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">From organisation</label>
                  <select className="input w-full" value={form.from_org_id} onChange={(e) => set('from_org_id', e.target.value)}>
                    <option value="">Select source…</option>
                    {orgOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">To organisation</label>
                  <select className="input w-full" value={form.to_org_id} onChange={(e) => set('to_org_id', e.target.value)}>
                    <option value="">Select destination…</option>
                    {orgOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="label">Asset type</label>
                  <select className="input w-full" value={form.asset_type} onChange={(e) => set('asset_type', e.target.value)}>
                    {ASSET_TYPES.map((a) => <option key={a} value={a} className="capitalize">{a}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Quantity</label>
                  <input className="input w-full" type="number" step="1" min="0" value={form.quantity} onChange={(e) => set('quantity', e.target.value)} />
                </div>
                <div>
                  <label className="label">Status</label>
                  <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                    {TRANSFER_STATUSES.map((s) => <option key={s} value={s} className="capitalize">{s.replace('_', ' ')}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="label">Asset reference (optional)</label>
                <input className="input w-full" placeholder="e.g. tyre serial / plate / PO" value={form.asset_ref} maxLength={200} onChange={(e) => set('asset_ref', e.target.value)} />
              </div>
              <div>
                <label className="label">Notes (optional)</label>
                <textarea className="input w-full min-h-[80px] resize-y" placeholder="Reason, condition, approvals…" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
              </div>

              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Record transfer'}
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
                <h3 className="text-[var(--text-primary)] font-semibold">Delete this transfer?</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  {orgName_(confirmDelete.from_org_id)} → {orgName_(confirmDelete.to_org_id)} · {confirmDelete.asset_type} · {fmtInt(confirmDelete.quantity)}. This can’t be undone.
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
