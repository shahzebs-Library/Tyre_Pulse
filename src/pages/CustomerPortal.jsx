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
  AlertTriangle, Search, X, Filter, FileSpreadsheet, FileText, Plus,
  Pencil, Trash2, ToggleLeft, ToggleRight, Crown, Star, Boxes,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listCustomerAccounts, createCustomerAccount, updateCustomerAccount, deleteCustomerAccount,
} from '../lib/api/customerPortal'
import {
  summariseAccounts, byTier, needsAttention, portalAdoptionRate,
} from '../lib/customerPortal'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

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
  if (!m) return <span className="text-[var(--text-muted)]">—</span>
  const { Icon } = m
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium ${m.cls}`}>
      <Icon size={11} /> {m.label}
    </span>
  )
}

function StatusBadge({ status }) {
  const m = STATUS_META[String(status || '').toLowerCase()]
  if (!m) return <span className="text-[var(--text-muted)]">—</span>
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-medium ${m.cls}`}>{m.label}</span>
}

const fmtNum = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString())
const fmtHours = (v) => (v == null || v === '' ? '—' : `${Number(v).toLocaleString()} h`)

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') ||
    m.includes('schema cache') || m.includes('could not find the table')
}

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
      const data = await listCustomerAccounts({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(err?.message || 'Could not load customer accounts.')
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summariseAccounts(rows || []), [rows])
  const adoption = useMemo(() => portalAdoptionRate(rows || []), [rows])
  const tiers = useMemo(() => byTier(rows || []), [rows])
  const attention = useMemo(() => needsAttention(rows || []), [rows])

  const countryOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.country).filter(Boolean))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (statusFilter && String(r.status || '').toLowerCase() !== statusFilter) return false
      if (tierFilter && String(r.tier || '').toLowerCase() !== tierFilter) return false
      if (countryFilter && r.country !== countryFilter) return false
      if (q) {
        const hay = `${r.company_name || ''} ${r.contact_name || ''} ${r.email || ''} ${r.account_code || ''} ${r.account_manager || ''} ${r.contract_ref || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, statusFilter, tierFilter, countryFilter, search])

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const kpis = [
    { label: 'Customer accounts', value: summary.totalAccounts, icon: Building2, tone: 'text-[var(--text-primary)]' },
    { label: 'Active', value: summary.activeCount, icon: UserCheck, tone: 'text-green-400' },
    { label: 'Portal adoption', value: `${adoption}%`, icon: ShieldCheck, tone: 'text-violet-400' },
    { label: 'Onboarding', value: summary.onboardingCount, icon: Users, tone: 'text-sky-400' },
    { label: 'Open requests', value: summary.totalOpenRequests, icon: Clock, tone: 'text-amber-400' },
    { label: 'Linked assets', value: summary.totalLinkedAssets, icon: Boxes, tone: 'text-teal-400' },
  ]

  // ── Export ───────────────────────────────────────────────────────────────
  const EXPORT_COLS = ['company_name', 'account_code', 'contact_name', 'email', 'phone', 'tier', 'status', 'portal_enabled', 'assets_linked', 'open_requests', 'sla_hours', 'account_manager', 'contract_ref', 'country']
  const EXPORT_HEADERS = ['Company', 'Account code', 'Contact', 'Email', 'Phone', 'Tier', 'Status', 'Portal', 'Linked assets', 'Open requests', 'SLA (h)', 'Account manager', 'Contract ref', 'Country']
  const exportRows = filtered.map((r) => ({
    company_name: r.company_name || '', account_code: r.account_code || '',
    contact_name: r.contact_name || '', email: r.email || '', phone: r.phone || '',
    tier: r.tier || '', status: r.status || '',
    portal_enabled: r.portal_enabled ? 'Enabled' : 'Disabled',
    assets_linked: r.assets_linked ?? '', open_requests: r.open_requests ?? '',
    sla_hours: r.sla_hours ?? '', account_manager: r.account_manager || '',
    contract_ref: r.contract_ref || '', country: r.country || '',
  }))

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
      setFormError(err?.message || 'Could not save the account.')
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
      setError(err?.message || 'Could not delete the account.')
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const togglePortal = useCallback(async (r) => {
    try {
      await updateCustomerAccount(r.id, { portal_enabled: !r.portal_enabled })
      await load()
    } catch (err) {
      setError(err?.message || 'Could not update portal access.')
    }
  }, [load])

  const clearFilters = () => { setStatusFilter(''); setTierFilter(''); setCountryFilter(''); setSearch('') }
  const hasFilters = statusFilter || tierFilter || countryFilter || search
  const maxTier = tiers.reduce((m, t) => Math.max(m, t.count), 0)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customer Portal"
        subtitle="Manage external customer accounts, grant portal access, and track their linked assets and open service requests — the admin control panel behind your customer-facing portal."
        icon={Building2}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'customer_accounts')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Customer Portal Accounts', 'customer_accounts', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={notProvisioned}>
              <Plus size={14} /> New account
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">The customer portal isn’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V193_CUSTOMER_ACCOUNTS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load customer accounts.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
        </div>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon
          return (
            <div key={k.label} className="card">
              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                <Icon size={16} className={k.tone} />
              </div>
              <p className={`text-3xl font-bold mt-1 ${k.tone}`}>{rows === null ? '—' : k.value}</p>
            </div>
          )
        })}
      </div>

      {/* By-tier breakdown + Needs-attention */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
            <Layers size={15} /> Accounts by tier
          </h3>
          {rows === null ? (
            <div className="h-24 bg-[var(--input-bg)] rounded animate-pulse" />
          ) : tiers.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No accounts to break down yet.</p>
          ) : (
            <div className="space-y-2.5">
              {tiers.map((t) => (
                <div key={t.tier}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="inline-flex items-center gap-1.5">
                      <TierBadge tier={t.tier} />
                    </span>
                    <span className="text-[var(--text-muted)]">
                      <span className="font-semibold text-[var(--text-primary)]">{t.count}</span> account{t.count === 1 ? '' : 's'} · {t.linkedAssets.toLocaleString()} assets
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-[var(--input-bg)] overflow-hidden">
                    <div className="h-full rounded-full bg-violet-500/70" style={{ width: `${maxTier ? (t.count / maxTier) * 100 : 0}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
            <AlertTriangle size={15} className="text-amber-400" /> Needs attention
          </h3>
          {rows === null ? (
            <div className="h-24 bg-[var(--input-bg)] rounded animate-pulse" />
          ) : attention.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">All accounts are healthy — none suspended, onboarding, or backlogged.</p>
          ) : (
            <div className="space-y-2 max-h-56 overflow-y-auto">
              {attention.slice(0, 12).map((r) => (
                <button key={r.id} onClick={() => openEdit(r)} className="w-full text-left rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 px-3 py-2 hover:bg-[var(--input-bg)]/70 transition-colors">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-[var(--text-primary)] truncate">{r.company_name}</span>
                    <StatusBadge status={r.status} />
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-[var(--text-muted)] mt-0.5">
                    <span className="inline-flex items-center gap-1"><Clock size={11} /> {fmtNum(r.open_requests)} open</span>
                    <span className="inline-flex items-center gap-1"><Boxes size={11} /> {fmtNum(r.assets_linked)} assets</span>
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
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search company, contact, email, code, manager…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {Object.entries(STATUS_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
          </select>
          <select className="input" value={tierFilter} onChange={(e) => setTierFilter(e.target.value)} aria-label="Tier">
            <option value="">All tiers</option>
            {Object.entries(TIER_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
          </select>
          {countryOptions.length > 0 && (
            <select className="input" value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)} aria-label="Country">
              <option value="">All countries</option>
              {countryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {summary.totalAccounts}</span>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['Company', 'Contact', 'Tier', 'Status', 'Portal', 'Assets', 'Open', 'SLA', 'Account manager', ''].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={10} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  <Filter size={22} className="mx-auto mb-2 opacity-60" />
                  {rows.length === 0 && !notProvisioned ? 'No customer accounts yet — add your first account.' : 'No accounts match these filters.'}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => (
                  <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-[var(--text-primary)]">{r.company_name || '—'}</div>
                      <div className="text-[11px] text-[var(--text-muted)] flex items-center gap-2">
                        {r.account_code && <span className="font-mono">{r.account_code}</span>}
                        {r.country && <span className="inline-flex items-center gap-0.5"><Globe size={10} /> {r.country}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                      <div>{r.contact_name || '—'}</div>
                      {r.email && <div className="text-[11px] text-[var(--text-muted)] truncate max-w-[180px]">{r.email}</div>}
                    </td>
                    <td className="px-4 py-2.5"><TierBadge tier={r.tier} /></td>
                    <td className="px-4 py-2.5"><StatusBadge status={r.status} /></td>
                    <td className="px-4 py-2.5">
                      <button onClick={() => togglePortal(r)} className="inline-flex items-center gap-1.5 text-xs" aria-label="Toggle portal access" title={r.portal_enabled ? 'Portal enabled — click to disable' : 'Portal disabled — click to enable'}>
                        {r.portal_enabled
                          ? <><ToggleRight size={22} className="text-green-400" /> <span className="text-green-300">On</span></>
                          : <><ToggleLeft size={22} className="text-[var(--text-muted)]" /> <span className="text-[var(--text-muted)]">Off</span></>}
                      </button>
                    </td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{fmtNum(r.assets_linked)}</td>
                    <td className="px-4 py-2.5">
                      <span className={Number(r.open_requests) > 5 ? 'text-amber-300 font-semibold' : 'text-[var(--text-secondary)]'}>{fmtNum(r.open_requests)}</span>
                    </td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtHours(r.sla_hours)}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.account_manager || '—'}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openEdit(r)} className="p-1.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Edit"><Pencil size={14} /></button>
                        <button onClick={() => setConfirmDelete(r)} className="p-1.5 rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" aria-label="Delete"><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))
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
              <h3 className="text-lg font-bold text-[var(--text-primary)]">{editing ? 'Edit customer account' : 'New customer account'}</h3>
              <button onClick={closeModal} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Company name</label>
                  <input className="input w-full" placeholder="e.g. Gulf Logistics Co." value={form.company_name} maxLength={200} onChange={(e) => set('company_name', e.target.value)} />
                </div>
                <div>
                  <label className="label">Account code (optional)</label>
                  <input className="input w-full" placeholder="e.g. CUST-0142" value={form.account_code} maxLength={60} onChange={(e) => set('account_code', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Contact name (optional)</label>
                  <input className="input w-full" placeholder="e.g. Sara Ahmed" value={form.contact_name} maxLength={160} onChange={(e) => set('contact_name', e.target.value)} />
                </div>
                <div>
                  <label className="label">Email (optional)</label>
                  <input className="input w-full" type="email" placeholder="ops@customer.com" value={form.email} maxLength={254} onChange={(e) => set('email', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Phone (optional)</label>
                  <input className="input w-full" placeholder="+966 …" value={form.phone} maxLength={60} onChange={(e) => set('phone', e.target.value)} />
                </div>
                <div>
                  <label className="label">Account manager (optional)</label>
                  <input className="input w-full" placeholder="Internal owner" value={form.account_manager} maxLength={160} onChange={(e) => set('account_manager', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="label">Tier</label>
                  <select className="input w-full" value={form.tier} onChange={(e) => set('tier', e.target.value)}>
                    <option value="">Unspecified</option>
                    <option value="standard">Standard</option>
                    <option value="premium">Premium</option>
                    <option value="enterprise">Enterprise</option>
                  </select>
                </div>
                <div>
                  <label className="label">Status</label>
                  <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                    <option value="">Unspecified</option>
                    <option value="onboarding">Onboarding</option>
                    <option value="active">Active</option>
                    <option value="suspended">Suspended</option>
                    <option value="churned">Churned</option>
                  </select>
                </div>
                <div>
                  <label className="label">SLA (hours)</label>
                  <input className="input w-full" type="number" step="0.5" min="0" placeholder="24" value={form.sla_hours} onChange={(e) => set('sla_hours', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="label">Linked assets</label>
                  <input className="input w-full" type="number" step="1" min="0" placeholder="0" value={form.assets_linked} onChange={(e) => set('assets_linked', e.target.value)} />
                </div>
                <div>
                  <label className="label">Open requests</label>
                  <input className="input w-full" type="number" step="1" min="0" placeholder="0" value={form.open_requests} onChange={(e) => set('open_requests', e.target.value)} />
                </div>
                <div>
                  <label className="label">Contract ref (optional)</label>
                  <input className="input w-full" placeholder="e.g. MSA-2026-014" value={form.contract_ref} maxLength={120} onChange={(e) => set('contract_ref', e.target.value)} />
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <ShieldCheck size={16} className={form.portal_enabled ? 'text-green-400' : 'text-[var(--text-muted)]'} />
                  <div>
                    <p className="text-sm font-medium text-[var(--text-primary)]">Portal access</p>
                    <p className="text-[11px] text-[var(--text-muted)]">Allow this customer’s staff to sign in and view their assets and service history.</p>
                  </div>
                </div>
                <button type="button" onClick={() => set('portal_enabled', !form.portal_enabled)} aria-label="Toggle portal access">
                  {form.portal_enabled ? <ToggleRight size={30} className="text-green-400" /> : <ToggleLeft size={30} className="text-[var(--text-muted)]" />}
                </button>
              </div>
              <div>
                <label className="label">Notes (optional)</label>
                <textarea className="input w-full min-h-[70px] resize-y" placeholder="Onboarding notes, contract terms, escalation contacts…" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
              </div>

              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Create account'}
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
                <h3 className="text-[var(--text-primary)] font-semibold">Delete this account?</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  {confirmDelete.company_name || 'Account'}{confirmDelete.account_code ? ` · ${confirmDelete.account_code}` : ''}. This can’t be undone and revokes portal access.
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
