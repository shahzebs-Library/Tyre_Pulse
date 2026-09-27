/**
 * CustomerPortal (route /customer-portal) — Customer Portal admin surface. The
 * internal control panel for a customer-facing portal: manage external customer
 * accounts (fleet operators, distributors, B2B clients), grant or revoke portal
 * access, and track their linked assets and open service requests.
 *
 * Runs on the new `customer_accounts` table (V193). Real data, KPI tiles, a
 * by-tier breakdown, a needs-attention list, create/edit modal, filters,
 * search, delete confirm, Excel/PDF export, and loading/empty/error/
 * not-provisioned states throughout. Adoption, tier, and attention roll-ups
 * live in the pure `src/lib/customerPortal.js` helpers.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Building2, Users, UserCheck, Globe, ShieldCheck, Clock, Layers,
  AlertTriangle, Search, X, FileSpreadsheet, FileText, Plus,
  Pencil, Trash2, ToggleLeft, ToggleRight, Crown, Star, Boxes, RotateCcw, Timer,
} from 'lucide-react'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import Modal from '../components/ui/Modal'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listCustomerAccounts, createCustomerAccount, updateCustomerAccount, deleteCustomerAccount,
} from '../lib/api/customerPortal'
import {
  filterAccounts, accountKpis, tierBreakdown, attentionList, accountExport,
  countryOptions as buildCountryOptions, portalOn, BACKLOG_THRESHOLD,
} from '../lib/customerPortalAnalytics'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation } from '../lib/api/_client'

const EMPTY_FORM = {
  company_name: '', account_code: '', contact_name: '', email: '', phone: '',
  tier: '', status: 'onboarding', portal_enabled: false, account_manager: '',
  sla_hours: '', assets_linked: '', open_requests: '', contract_ref: '', notes: '',
}

const TIER_META = {
  enterprise: { label: 'Enterprise', cls: 'bg-violet-500/15 text-violet-300 border-violet-500/30', Icon: Crown },
  premium: { label: 'Premium', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30', Icon: Star },
  standard: { label: 'Standard', cls: 'bg-slate-500/15 text-slate-300 border-slate-500/30', Icon: Layers },
}
const STATUS_META = {
  active: { label: 'Active', cls: 'bg-green-500/15 text-green-300 border-green-500/30' },
  onboarding: { label: 'Onboarding', cls: 'bg-sky-500/15 text-sky-300 border-sky-500/30' },
  suspended: { label: 'Suspended', cls: 'bg-red-500/15 text-red-300 border-red-500/30' },
  churned: { label: 'Churned', cls: 'bg-slate-500/15 text-slate-400 border-slate-500/30' },
}

function TierBadge({ tier }) {
  const m = TIER_META[String(tier || '').toLowerCase()]
  if (!m) return <span className="text-[var(--text-muted)]">N/A</span>
  const { Icon } = m
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium ${m.cls}`}>
      <Icon size={11} aria-hidden="true" /> {m.label}
    </span>
  )
}

function StatusBadge({ status }) {
  const m = STATUS_META[String(status || '').toLowerCase()]
  if (!m) return <span className="text-[var(--text-muted)]">N/A</span>
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-medium ${m.cls}`}>{m.label}</span>
}

const fmtNum = (v) => (v == null || v === '' ? 'N/A' : Number(v).toLocaleString())
const fmtHours = (v) => (v == null || v === '' ? 'N/A' : `${Number(v).toLocaleString()} h`)


export default function CustomerPortal() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [statusFilter, setStatusFilter] = useState('')
  const [tierFilter, setTierFilter] = useState('')
  const [countryFilter, setCountryFilter] = useState('')
  const [portalFilter, setPortalFilter] = useState('')
  const [search, setSearch] = useState('')
  const [loadError, setLoadError] = useState('')

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setLoadError(''); setNotProvisioned(false)
    try {
      const data = await listCustomerAccounts({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) { setNotProvisioned(true); setRows([]) }
      // A failed read is not "no accounts": keep rows null so figures read N/A.
      else { setLoadError(toUserMessage(err, 'Could not load customer accounts.')); setRows(null) }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const kpi = useMemo(() => accountKpis(rows || []), [rows])
  const tiers = useMemo(() => tierBreakdown(rows || []), [rows])
  const attention = useMemo(() => attentionList(rows || []), [rows])
  const countryOptions = useMemo(() => buildCountryOptions(rows || []), [rows])
  const filtered = useMemo(
    () => filterAccounts(rows || [], { status: statusFilter, tier: tierFilter, country: countryFilter, portal: portalFilter, search }),
    [rows, statusFilter, tierFilter, countryFilter, portalFilter, search],
  )

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const ready = rows !== null
  const n = (v) => (!ready || v == null ? 'N/A' : Number(v).toLocaleString())
  const kpis = [
    { label: 'Customer accounts', value: n(kpi.total), icon: Building2, tone: 'text-[var(--text-primary)]', onClick: () => setStatusFilter('') },
    { label: 'Active', value: n(kpi.active), icon: UserCheck, tone: 'text-green-400', onClick: () => setStatusFilter('active'), active: statusFilter === 'active' },
    { label: 'Portal adoption', value: ready && kpi.adoptionPct != null ? `${kpi.adoptionPct}%` : 'N/A', icon: ShieldCheck, tone: 'text-violet-400', sub: ready ? `${kpi.portalEnabled} of ${kpi.total} enabled` : null, onClick: () => setPortalFilter('on'), active: portalFilter === 'on' },
    { label: 'Onboarding', value: n(kpi.onboarding), icon: Users, tone: 'text-sky-400', onClick: () => setStatusFilter('onboarding'), active: statusFilter === 'onboarding' },
    { label: 'Open requests', value: n(kpi.openRequests), icon: Clock, tone: 'text-amber-400', sub: ready ? `${kpi.backlogged} account${kpi.backlogged === 1 ? '' : 's'} over ${BACKLOG_THRESHOLD}` : null },
    { label: 'Linked assets', value: n(kpi.linkedAssets), icon: Boxes, tone: 'text-teal-400' },
    { label: 'Average SLA', value: ready && kpi.avgSlaHours != null ? `${kpi.avgSlaHours} h` : 'N/A', icon: Timer, tone: 'text-[var(--text-primary)]', sub: ready ? `Recorded on ${kpi.slaCoverage} account${kpi.slaCoverage === 1 ? '' : 's'}` : null },
    { label: 'Suspended', value: n(kpi.suspended), icon: AlertTriangle, tone: 'text-red-400', onClick: () => setStatusFilter('suspended'), active: statusFilter === 'suspended' },
  ]

  // ── Export (full filtered set) ───────────────────────────────────────────
  const doExport = async (format) => {
    const shaped = accountExport(filtered)
    const file = reportFileName('Customer Portal Accounts', activeCountry !== 'All' ? activeCountry : '')
    try {
      if (format === 'pdf') await exportToPdf(shaped.rows, shaped.keys.map((k, i) => ({ key: k, header: shaped.headers[i] })), 'Customer Portal Accounts', file, 'landscape')
      else await exportToExcel(shaped.rows, shaped.keys, shaped.headers, file)
    } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) }
  }

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true)
  }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      company_name: r.company_name || '', account_code: r.account_code || '',
      contact_name: r.contact_name || '', email: r.email || '', phone: r.phone || '',
      tier: r.tier || '', status: r.status || '', portal_enabled: !!r.portal_enabled,
      account_manager: r.account_manager || '', sla_hours: r.sla_hours ?? '',
      assets_linked: r.assets_linked ?? '', open_requests: r.open_requests ?? '',
      contract_ref: r.contract_ref || '', notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.company_name.trim()) { setFormError('A company name is required.'); return }
    setSaving(true)
    try {
      const payload = {
        ...form,
        country: activeCountry !== 'All' ? activeCountry : (editing?.country ?? null),
      }
      if (editing) await updateCustomerAccount(editing.id, payload)
      else await createCustomerAccount(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the account.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteCustomerAccount(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setError(toUserMessage(err, 'Could not delete the account.'))
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const togglePortal = useCallback(async (r) => {
    try {
      await updateCustomerAccount(r.id, { portal_enabled: !r.portal_enabled })
      await load()
    } catch (err) {
      setError(toUserMessage(err, 'Could not update portal access.'))
    }
  }, [load])

  const clearFilters = () => { setStatusFilter(''); setTierFilter(''); setCountryFilter(''); setPortalFilter(''); setSearch('') }
  const hasFilters = !!(statusFilter || tierFilter || countryFilter || portalFilter || search)

  const columns = [
    {
      id: 'company', header: 'Company', accessorFn: (r) => r.company_name || '', size: 220,
      cell: ({ row }) => {
        const r = row.original
        return (
          <div>
            <div className="font-medium text-[var(--text-primary)]">{r.company_name || 'N/A'}</div>
            <div className="text-[11px] text-[var(--text-muted)] flex items-center gap-2">
              {r.account_code && <span className="font-mono">{r.account_code}</span>}
              {r.country && <span className="inline-flex items-center gap-0.5"><Globe size={10} aria-hidden="true" /> {r.country}</span>}
            </div>
          </div>
        )
      },
    },
    {
      id: 'contact', header: 'Contact', accessorFn: (r) => r.contact_name || '', size: 200,
      cell: ({ row }) => (
        <div className="text-[var(--text-secondary)]">
          <div>{row.original.contact_name || 'N/A'}</div>
          {row.original.email && <div className="text-[11px] text-[var(--text-muted)] truncate max-w-[180px]" title={row.original.email}>{row.original.email}</div>}
        </div>
      ),
    },
    { id: 'tier', header: 'Tier', accessorFn: (r) => r.tier || '', size: 120, cell: ({ row }) => <TierBadge tier={row.original.tier} /> },
    { id: 'status', header: 'Status', accessorFn: (r) => r.status || '', size: 120, cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    {
      id: 'portal', header: 'Portal', accessorFn: (r) => (portalOn(r) ? 1 : 0), size: 100,
      meta: { exportValue: (r) => (portalOn(r) ? 'Enabled' : 'Disabled') },
      cell: ({ row }) => {
        const r = row.original
        const on = portalOn(r)
        return (
          <button onClick={() => togglePortal(r)} className="inline-flex items-center gap-1.5 text-xs min-h-[44px]" aria-pressed={on}
            aria-label={`Portal access for ${r.company_name || 'account'}: ${on ? 'on' : 'off'}. Toggle`}>
            {on
              ? <><ToggleRight size={22} className="text-green-400" aria-hidden="true" /> <span className="text-green-400">On</span></>
              : <><ToggleLeft size={22} className="text-[var(--text-muted)]" aria-hidden="true" /> <span className="text-[var(--text-muted)]">Off</span></>}
          </button>
        )
      },
    },
    { id: 'assets', header: 'Assets', accessorFn: (r) => Number(r.assets_linked) || 0, size: 90, meta: { align: 'right' }, cell: ({ row }) => <span className="tabular-nums">{fmtNum(row.original.assets_linked)}</span> },
    {
      id: 'open', header: 'Open', accessorFn: (r) => Number(r.open_requests) || 0, size: 90, meta: { align: 'right' },
      cell: ({ row }) => {
        const hi = Number(row.original.open_requests) > BACKLOG_THRESHOLD
        return <span className={`tabular-nums ${hi ? 'text-amber-400 font-semibold' : 'text-[var(--text-secondary)]'}`}>{fmtNum(row.original.open_requests)}{hi && <span className="sr-only"> (backlog)</span>}</span>
      },
    },
    { id: 'sla', header: 'SLA', accessorFn: (r) => (r.sla_hours == null || r.sla_hours === '' ? -1 : Number(r.sla_hours)), size: 90, meta: { align: 'right' }, cell: ({ row }) => fmtHours(row.original.sla_hours) },
    { id: 'manager', header: 'Account manager', accessorFn: (r) => r.account_manager || 'N/A', size: 160 },
    {
      id: 'actions', header: '', enableSorting: false, size: 110, meta: { export: false },
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <button onClick={() => openEdit(row.original)} className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label={`Edit ${row.original.company_name || 'account'}`}><Pencil size={15} /></button>
          <button onClick={() => setConfirmDelete(row.original)} className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" aria-label={`Delete ${row.original.company_name || 'account'}`}><Trash2 size={15} /></button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customer Portal"
        subtitle="Manage external customer accounts, grant portal access, and track their linked assets and open service requests: the admin control panel behind your customer-facing portal."
        icon={Building2}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => doExport('excel')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => doExport('pdf')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={notProvisioned}>
              <Plus size={14} /> New account
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">The customer portal is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V193_CUSTOMER_ACCOUNTS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {loadError && (
        <div role="alert" className="card border border-red-800/50 flex flex-wrap items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-[200px]">
            <p className="text-red-300 font-medium">Customer accounts could not be loaded.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">{loadError} The figures below are not available until the accounts load.</p>
          </div>
          <button onClick={load} disabled={refreshing} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><RotateCcw size={14} /> Retry</button>
        </div>
      )}

      {error && (
        <div role="alert" className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1"><p className="text-red-300 font-medium">That action did not complete.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
          <button onClick={() => setError('')} className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg hover:bg-[var(--input-bg)] text-[var(--text-muted)]" aria-label="Dismiss message"><X size={16} /></button>
        </div>
      )}

      {ready && (kpi.invalidEmail > 0 || kpi.noContact > 0) && (
        <div className="card border border-amber-800/50 flex items-start gap-3 !py-3">
          <AlertTriangle size={16} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="text-sm text-[var(--text-secondary)]">
            Contact data gaps: {kpi.invalidEmail} account{kpi.invalidEmail === 1 ? '' : 's'} with an email that does not look valid, {kpi.noContact} with no email or phone on file. Portal invitations cannot reach these customers.
          </p>
        </div>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon
          const body = (
            <>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                <Icon size={16} className={k.tone} aria-hidden="true" />
              </div>
              <p className={`text-2xl sm:text-3xl font-bold mt-1 tabular-nums ${k.tone}`}>{k.value}</p>
              {k.sub && <p className="text-[11px] text-[var(--text-muted)] mt-1">{k.sub}</p>}
            </>
          )
          return k.onClick ? (
            <button key={k.label} type="button" onClick={k.onClick} aria-pressed={!!k.active}
              className={`card text-left min-h-[44px] transition-colors hover:border-[var(--accent)] ${k.active ? 'ring-2 ring-[var(--accent)]' : ''}`}>{body}</button>
          ) : <div key={k.label} className="card">{body}</div>
        })}
      </div>

      {/* By-tier breakdown + Needs-attention */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
            <Layers size={15} aria-hidden="true" /> Accounts by tier
          </h3>
          {rows === null ? (
            loadError ? <p className="text-sm text-[var(--text-muted)]">Not available</p> : <div className="h-24 bg-[var(--input-bg)] rounded animate-pulse" />
          ) : tiers.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No accounts to break down yet.</p>
          ) : (
            <div className="space-y-2.5">
              {tiers.map((t) => (
                <div key={t.tier}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <button type="button" onClick={() => setTierFilter(t.tier)} className="inline-flex items-center gap-1.5 min-h-[32px]" aria-label={`Filter to ${t.tier} tier`}>
                      {t.tier === 'unspecified' ? <span className="text-[var(--text-muted)]">Unspecified</span> : <TierBadge tier={t.tier} />}
                    </button>
                    <span className="text-[var(--text-muted)]">
                      <span className="font-semibold text-[var(--text-primary)]">{t.count}</span> account{t.count === 1 ? '' : 's'}, {t.linkedAssets.toLocaleString()} assets
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-[var(--input-bg)] overflow-hidden">
                    <div className="h-full rounded-full bg-violet-500/70" style={{ width: `${t.pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
            <AlertTriangle size={15} className="text-amber-400" aria-hidden="true" /> Needs attention {ready && <span className="text-xs font-normal text-[var(--text-muted)]">({attention.length})</span>}
          </h3>
          {rows === null ? (
            loadError ? <p className="text-sm text-[var(--text-muted)]">Not available</p> : <div className="h-24 bg-[var(--input-bg)] rounded animate-pulse" />
          ) : attention.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">All accounts are healthy. None suspended, onboarding, or backlogged.</p>
          ) : (
            <div className="space-y-2 max-h-56 overflow-y-auto">
              {attention.slice(0, 12).map((r) => (
                <button key={r.id} onClick={() => openEdit(r)} aria-label={`Open ${r.company_name || 'account'}: ${r._reasons.join(', ')}`} className="w-full text-left min-h-[44px] rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 px-3 py-2 hover:bg-[var(--input-bg)]/70 transition-colors">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-[var(--text-primary)] truncate">{r.company_name}</span>
                    <StatusBadge status={r.status} />
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-[var(--text-muted)] mt-0.5">
                    <span className="inline-flex items-center gap-1"><Clock size={11} aria-hidden="true" /> {fmtNum(r.open_requests)} open</span>
                    <span className="inline-flex items-center gap-1"><Boxes size={11} aria-hidden="true" /> {fmtNum(r.assets_linked)} assets</span>
                    <span className="text-amber-400">{r._reasons.join(', ')}</span>
                    {r.account_manager && <span className="truncate">AM: {r.account_manager}</span>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
            <input className="input pl-9 w-full min-h-[44px]" aria-label="Search accounts" placeholder="Search company, contact, email, code, manager" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input min-h-[44px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {Object.entries(STATUS_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
          </select>
          <select className="input min-h-[44px]" value={tierFilter} onChange={(e) => setTierFilter(e.target.value)} aria-label="Tier">
            <option value="">All tiers</option>
            {Object.entries(TIER_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
            <option value="unspecified">Unspecified</option>
          </select>
          <select className="input min-h-[44px]" value={portalFilter} onChange={(e) => setPortalFilter(e.target.value)} aria-label="Portal access">
            <option value="">Portal: any</option>
            <option value="on">Portal enabled</option>
            <option value="off">Portal disabled</option>
          </select>
          {countryOptions.length > 0 && (
            <select className="input min-h-[44px]" value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)} aria-label="Country">
              <option value="">All countries</option>
              {countryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">{ready ? `${filtered.length} of ${kpi.total}` : 'N/A'}</span>
        </div>
      </div>

      {/* Register */}
      {!loadError && (
        <EnterpriseTable
          columns={columns}
          data={filtered}
          getRowId={(r) => String(r.id)}
          loading={!ready}
          enableGlobalFilter={false}
          enableColumnFilters={false}
          enableExport={false}
          initialPageSize={25}
          emptyMessage={hasFilters ? 'No accounts match these filters.' : notProvisioned ? 'The customer portal is not enabled on this database yet.' : 'No customer accounts yet. Add your first account with New account.'}
        />
      )}

      {/* Create / Edit modal. The shared Modal owns Escape, the backdrop,
          the focus trap and focus return (none of which the hand-rolled one
          had); closeModal already refuses while a save is in flight. */}
      <Modal
        open={showModal}
        onClose={closeModal}
        size="lg"
        title={editing ? 'Edit customer account' : 'New customer account'}
      >
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="cp-f1" className="label">Company name</label>
                  <input id="cp-f1" className="input w-full" placeholder="e.g. Gulf Logistics Co." value={form.company_name} maxLength={200} onChange={(e) => set('company_name', e.target.value)} />
                </div>
                <div>
                  <label htmlFor="cp-f2" className="label">Account code (optional)</label>
                  <input id="cp-f2" className="input w-full" placeholder="e.g. CUST-0142" value={form.account_code} maxLength={60} onChange={(e) => set('account_code', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="cp-f3" className="label">Contact name (optional)</label>
                  <input id="cp-f3" className="input w-full" placeholder="e.g. Sara Ahmed" value={form.contact_name} maxLength={160} onChange={(e) => set('contact_name', e.target.value)} />
                </div>
                <div>
                  <label htmlFor="cp-f4" className="label">Email (optional)</label>
                  <input id="cp-f4" className="input w-full" type="email" placeholder="ops@customer.com" value={form.email} maxLength={254} onChange={(e) => set('email', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="cp-f5" className="label">Phone (optional)</label>
                  <input id="cp-f5" className="input w-full" placeholder="+966" value={form.phone} maxLength={60} onChange={(e) => set('phone', e.target.value)} />
                </div>
                <div>
                  <label htmlFor="cp-f6" className="label">Account manager (optional)</label>
                  <input id="cp-f6" className="input w-full" placeholder="Internal owner" value={form.account_manager} maxLength={160} onChange={(e) => set('account_manager', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="cp-f7" className="label">Tier</label>
                  <select id="cp-f7" className="input w-full" value={form.tier} onChange={(e) => set('tier', e.target.value)}>
                    <option value="">Unspecified</option>
                    <option value="standard">Standard</option>
                    <option value="premium">Premium</option>
                    <option value="enterprise">Enterprise</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="cp-f8" className="label">Status</label>
                  <select id="cp-f8" className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                    <option value="">Unspecified</option>
                    <option value="onboarding">Onboarding</option>
                    <option value="active">Active</option>
                    <option value="suspended">Suspended</option>
                    <option value="churned">Churned</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="cp-f9" className="label">SLA (hours)</label>
                  <input id="cp-f9" className="input w-full" type="number" step="0.5" min="0" placeholder="24" value={form.sla_hours} onChange={(e) => set('sla_hours', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="cp-f10" className="label">Linked assets</label>
                  <input id="cp-f10" className="input w-full" type="number" step="1" min="0" placeholder="0" value={form.assets_linked} onChange={(e) => set('assets_linked', e.target.value)} />
                </div>
                <div>
                  <label htmlFor="cp-f11" className="label">Open requests</label>
                  <input id="cp-f11" className="input w-full" type="number" step="1" min="0" placeholder="0" value={form.open_requests} onChange={(e) => set('open_requests', e.target.value)} />
                </div>
                <div>
                  <label htmlFor="cp-f12" className="label">Contract ref (optional)</label>
                  <input id="cp-f12" className="input w-full" placeholder="e.g. MSA-2026-014" value={form.contract_ref} maxLength={120} onChange={(e) => set('contract_ref', e.target.value)} />
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <ShieldCheck size={16} className={form.portal_enabled ? 'text-green-400' : 'text-[var(--text-muted)]'} />
                  <div>
                    <p className="text-sm font-medium text-[var(--text-primary)]">Portal access</p>
                    <p className="text-[11px] text-[var(--text-muted)]">Allow this customer's staff to sign in and view their assets and service history.</p>
                  </div>
                </div>
                <button type="button" onClick={() => set('portal_enabled', !form.portal_enabled)} className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center" aria-pressed={!!form.portal_enabled} aria-label="Portal access">
                  {form.portal_enabled ? <ToggleRight size={30} className="text-green-400" /> : <ToggleLeft size={30} className="text-[var(--text-muted)]" />}
                </button>
              </div>
              <div>
                <label htmlFor="cp-f13" className="label">Notes (optional)</label>
                <textarea id="cp-f13" className="input w-full min-h-[70px] resize-y" placeholder="Onboarding notes, contract terms, escalation contacts" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
              </div>

              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? 'Saving' : editing ? 'Save changes' : 'Create account'}
                </button>
              </div>
            </form>
      </Modal>

      {/* Delete confirm */}
      <Modal
        open={!!confirmDelete}
        onClose={() => { if (!deleting) setConfirmDelete(null) }}
        size="sm"
        labelledBy="cp-delete-title"
      >
        {confirmDelete && (
          <>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-red-900/30 flex items-center justify-center shrink-0"><Trash2 size={18} className="text-red-400" /></div>
              <div>
                <h3 id="cp-delete-title" className="text-[var(--text-primary)] font-semibold">Delete this account?</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  {confirmDelete.company_name || 'Account'}{confirmDelete.account_code ? ` (${confirmDelete.account_code})` : ''}. This cannot be undone and revokes portal access.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-5">
              <button onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm" disabled={deleting}>Cancel</button>
              <button onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={deleting}>
                <Trash2 size={14} /> {deleting ? 'Deleting' : 'Delete'}
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}
