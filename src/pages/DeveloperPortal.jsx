/**
 * DeveloperPortal (route /developer-portal) — the integrator-facing control
 * surface. Two tabs on one page:
 *
 *   • API Keys  — issue, edit, and revoke API credential metadata (never raw
 *     secrets; only a display prefix + label are stored). KPI tiles, masked
 *     key display, status/environment badges, expiry awareness.
 *   • Webhooks  — register outbound event-delivery endpoints, track delivery
 *     health and failure counts, edit/remove. KPI tiles, health meter,
 *     status badges.
 *
 * Runs on the `api_keys` and `webhook_endpoints` tables (V194). Real data, KPI
 * tiles, create/edit modals, filters, search, delete/revoke confirm, Excel/PDF
 * export for the active tab, and loading/empty/error/not-provisioned states
 * throughout. All roll-up + display logic lives in the pure
 * `src/lib/developerPortal.js` helpers, and `Date.now()` is read exactly once
 * per render and injected into those deterministic functions.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  KeyRound, Webhook, ShieldCheck, Activity, Ban, Clock, Server,
  Radio, AlertTriangle, AlertOctagon, Search, X, Filter, FileSpreadsheet,
  FileText, Plus, Pencil, Trash2,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listApiKeys, createApiKey, updateApiKey, deleteApiKey,
  listWebhookEndpoints, createWebhookEndpoint, updateWebhookEndpoint, deleteWebhookEndpoint,
} from '../lib/api/developerPortal'
import {
  summariseKeys, summariseWebhooks, healthyWebhookRate, isKeyExpired, maskKey,
} from '../lib/developerPortal'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

const EMPTY_KEY_FORM = {
  key_name: '', key_prefix: '', scopes: '', environment: 'sandbox',
  status: 'active', rate_limit: '', expires_at: '', created_label: '', notes: '',
}
const EMPTY_HOOK_FORM = {
  endpoint_name: '', url: '', event_types: '', status: 'active',
  failure_count: '', secret_set: false, notes: '',
}

const KEY_STATUS_STYLE = {
  active: 'bg-green-900/30 text-green-300 border-green-800/50',
  revoked: 'bg-red-900/30 text-red-300 border-red-800/50',
  expired: 'bg-amber-900/30 text-amber-300 border-amber-800/50',
}
const ENV_STYLE = {
  production: 'bg-indigo-900/30 text-indigo-300 border-indigo-800/50',
  sandbox: 'bg-slate-700/40 text-[var(--text-secondary)] border-[var(--input-border)]',
}
const HOOK_STATUS_STYLE = {
  active: 'bg-green-900/30 text-green-300 border-green-800/50',
  paused: 'bg-slate-700/40 text-[var(--text-secondary)] border-[var(--input-border)]',
  failing: 'bg-red-900/30 text-red-300 border-red-800/50',
  disabled: 'bg-amber-900/30 text-amber-300 border-amber-800/50',
}

function Badge({ children, className }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${className || 'border-[var(--input-border)] text-[var(--text-secondary)]'}`}>
      {children}
    </span>
  )
}

function fmtDate(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}
function fmtDateTime(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') ||
    m.includes('schema cache') || m.includes('could not find the table')
}

export default function DeveloperPortal() {
  const { activeCountry } = useSettings()
  const nowMs = Date.now()

  const [tab, setTab] = useState('keys') // 'keys' | 'webhooks'

  const [keys, setKeys] = useState(null)
  const [hooks, setHooks] = useState(null)
  const [error, setError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [keyForm, setKeyForm] = useState(EMPTY_KEY_FORM)
  const [hookForm, setHookForm] = useState(EMPTY_HOOK_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setNotProvisioned(false)
    try {
      const [k, h] = await Promise.all([
        listApiKeys({ country: activeCountry }),
        listWebhookEndpoints({ country: activeCountry }),
      ])
      setKeys(Array.isArray(k) ? k : [])
      setHooks(Array.isArray(h) ? h : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(err?.message || 'Could not load the developer portal.')
      setKeys([]); setHooks([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // Reset filters when switching tabs (status vocabularies differ).
  useEffect(() => { setStatusFilter(''); setSearch('') }, [tab])

  const keySummary = useMemo(() => summariseKeys(keys || [], nowMs), [keys, nowMs])
  const hookSummary = useMemo(() => summariseWebhooks(hooks || []), [hooks])
  const hookHealth = useMemo(() => healthyWebhookRate(hooks || []), [hooks])

  // ── Filtering ──────────────────────────────────────────────────────────────
  const filteredKeys = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (keys || []).filter((r) => {
      const effStatus = isKeyExpired(r, nowMs) ? 'expired' : String(r.status || '').toLowerCase()
      if (statusFilter && effStatus !== statusFilter) return false
      if (q) {
        const hay = `${r.key_name || ''} ${r.key_prefix || ''} ${r.scopes || ''} ${r.environment || ''} ${r.created_label || ''} ${r.notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [keys, statusFilter, search, nowMs])

  const filteredHooks = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (hooks || []).filter((r) => {
      if (statusFilter && String(r.status || '').toLowerCase() !== statusFilter) return false
      if (q) {
        const hay = `${r.endpoint_name || ''} ${r.url || ''} ${r.event_types || ''} ${r.notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [hooks, statusFilter, search])

  const statusOptions = tab === 'keys'
    ? ['active', 'revoked', 'expired']
    : ['active', 'paused', 'failing', 'disabled']

  // ── KPI tiles ────────────────────────────────────────────────────────────
  const keyKpis = [
    { label: 'Total keys', value: keySummary.totalKeys, icon: KeyRound, tone: 'text-[var(--text-primary)]' },
    { label: 'Active', value: keySummary.activeCount, icon: ShieldCheck, tone: 'text-green-400' },
    { label: 'Production', value: keySummary.productionCount, icon: Server, tone: 'text-indigo-400' },
    { label: 'Expired', value: keySummary.expiredCount, icon: Clock, tone: 'text-amber-400' },
  ]
  const hookKpis = [
    { label: 'Endpoints', value: hookSummary.totalEndpoints, icon: Webhook, tone: 'text-[var(--text-primary)]' },
    { label: 'Active', value: hookSummary.activeCount, icon: Radio, tone: 'text-green-400' },
    { label: 'Failing', value: hookSummary.failingCount, icon: AlertOctagon, tone: 'text-red-400' },
    { label: 'Total failures', value: hookSummary.totalFailures, icon: AlertTriangle, tone: 'text-amber-400' },
  ]
  const kpis = tab === 'keys' ? keyKpis : hookKpis
  const loaded = tab === 'keys' ? keys : hooks

  // ── Export (active tab) ────────────────────────────────────────────────────
  const doExport = (kind) => {
    if (tab === 'keys') {
      const cols = ['key_name', 'key_prefix', 'environment', 'status', 'scopes', 'rate_limit', 'expires_at', 'last_used_at', 'created_at']
      const headers = ['Key name', 'Prefix', 'Environment', 'Status', 'Scopes', 'Rate limit', 'Expires', 'Last used', 'Created']
      const rows = filteredKeys.map((r) => ({
        key_name: r.key_name || '',
        key_prefix: r.key_prefix || '',
        environment: r.environment || '',
        status: isKeyExpired(r, nowMs) ? 'expired' : (r.status || ''),
        scopes: r.scopes || '',
        rate_limit: r.rate_limit ?? '',
        expires_at: r.expires_at ? fmtDate(r.expires_at) : '',
        last_used_at: r.last_used_at ? fmtDate(r.last_used_at) : '',
        created_at: r.created_at ? fmtDate(r.created_at) : '',
      }))
      if (kind === 'excel') exportToExcel(rows, cols, headers, 'api_keys')
      else exportToPdf(rows, cols.map((k, i) => ({ key: k, header: headers[i] })), 'API Keys', 'api_keys', 'landscape')
    } else {
      const cols = ['endpoint_name', 'url', 'status', 'event_types', 'failure_count', 'secret_set', 'last_delivery_at', 'created_at']
      const headers = ['Endpoint', 'URL', 'Status', 'Event types', 'Failures', 'Secret set', 'Last delivery', 'Created']
      const rows = filteredHooks.map((r) => ({
        endpoint_name: r.endpoint_name || '',
        url: r.url || '',
        status: r.status || '',
        event_types: r.event_types || '',
        failure_count: r.failure_count ?? '',
        secret_set: r.secret_set ? 'Yes' : 'No',
        last_delivery_at: r.last_delivery_at ? fmtDate(r.last_delivery_at) : '',
        created_at: r.created_at ? fmtDate(r.created_at) : '',
      }))
      if (kind === 'excel') exportToExcel(rows, cols, headers, 'webhook_endpoints')
      else exportToPdf(rows, cols.map((k, i) => ({ key: k, header: headers[i] })), 'Webhook Endpoints', 'webhook_endpoints', 'landscape')
    }
  }

  const activeFilteredCount = tab === 'keys' ? filteredKeys.length : filteredHooks.length
  const activeTotalCount = tab === 'keys' ? keySummary.totalKeys : hookSummary.totalEndpoints

  // ── Modal handlers ─────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null)
    setKeyForm(EMPTY_KEY_FORM)
    setHookForm(EMPTY_HOOK_FORM)
    setFormError(''); setShowModal(true)
  }
  const openEditKey = (r) => {
    setEditing(r)
    setKeyForm({
      key_name: r.key_name || '', key_prefix: r.key_prefix || '', scopes: r.scopes || '',
      environment: r.environment || 'sandbox', status: r.status || 'active',
      rate_limit: r.rate_limit ?? '', expires_at: r.expires_at ? r.expires_at.slice(0, 10) : '',
      created_label: r.created_label || '', notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }
  const openEditHook = (r) => {
    setEditing(r)
    setHookForm({
      endpoint_name: r.endpoint_name || '', url: r.url || '', event_types: r.event_types || '',
      status: r.status || 'active', failure_count: r.failure_count ?? '',
      secret_set: !!r.secret_set, notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const setKey = (k, v) => setKeyForm((f) => ({ ...f, [k]: v }))
  const setHook = (k, v) => setHookForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    const country = activeCountry !== 'All' ? activeCountry : null
    setSaving(true)
    try {
      if (tab === 'keys') {
        if (!keyForm.key_name.trim()) { setFormError('A key name is required.'); setSaving(false); return }
        const payload = { ...keyForm, country }
        if (editing) await updateApiKey(editing.id, payload)
        else await createApiKey(payload)
      } else {
        if (!hookForm.endpoint_name.trim()) { setFormError('An endpoint name is required.'); setSaving(false); return }
        const payload = { ...hookForm, country }
        if (editing) await updateWebhookEndpoint(editing.id, payload)
        else await createWebhookEndpoint(payload)
      }
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(err?.message || 'Could not save.')
    } finally {
      setSaving(false)
    }
  }, [tab, keyForm, hookForm, editing, activeCountry, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      if (confirmDelete._kind === 'key') await deleteApiKey(confirmDelete.id)
      else await deleteWebhookEndpoint(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setError(err?.message || 'Could not delete.')
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => { setStatusFilter(''); setSearch('') }
  const hasFilters = statusFilter || search

  const tabs = [
    { id: 'keys', label: 'API Keys', icon: KeyRound, count: keySummary.totalKeys },
    { id: 'webhooks', label: 'Webhooks', icon: Webhook, count: hookSummary.totalEndpoints },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Developer Portal"
        subtitle="Issue and manage API keys and webhook endpoints for the integrators and external systems that connect to Tyre Pulse. Secrets are never stored — only display prefixes and delivery metadata."
        icon={KeyRound}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => doExport('excel')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!activeFilteredCount}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => doExport('pdf')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!activeFilteredCount}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={notProvisioned}>
              <Plus size={14} /> {tab === 'keys' ? 'New key' : 'New webhook'}
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">The Developer Portal isn’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V194_DEVELOPER_PORTAL.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load the developer portal.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-[var(--input-border)]">
        {tabs.map((t) => {
          const Icon = t.icon
          const active = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${active ? 'border-indigo-500 text-[var(--text-primary)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
            >
              <Icon size={15} /> {t.label}
              <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[11px] ${active ? 'bg-indigo-900/40 text-indigo-300' : 'bg-[var(--input-bg)] text-[var(--text-muted)]'}`}>
                {loaded === null ? '—' : t.count}
              </span>
            </button>
          )
        })}
      </div>

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
              <p className={`text-3xl font-bold mt-1 ${k.tone}`}>{loaded === null ? '—' : k.value}</p>
            </div>
          )
        })}
      </div>

      {/* Webhook health meter (webhooks tab only) */}
      {tab === 'webhooks' && (
        <div className="card">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
              <Activity size={15} /> Delivery health
            </h3>
            <span className="text-sm font-semibold text-[var(--text-primary)]">{hooks === null ? '—' : `${hookHealth}%`}</span>
          </div>
          <div className="h-2.5 w-full rounded-full bg-[var(--input-bg)] overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${hookHealth >= 80 ? 'bg-green-500' : hookHealth >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
              style={{ width: `${hooks === null ? 0 : hookHealth}%` }}
            />
          </div>
          <p className="text-[11px] text-[var(--text-muted)] mt-2">
            Share of endpoints currently active. {hookSummary.failingCount} failing · {hookSummary.totalFailures} total failed deliveries.
          </p>
        </div>
      )}

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              className="input pl-9 w-full"
              placeholder={tab === 'keys' ? 'Search key name, prefix, scopes…' : 'Search endpoint, URL, events…'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {statusOptions.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
          </select>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{activeFilteredCount} of {activeTotalCount}</span>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          {tab === 'keys' ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                  {['Key name', 'Prefix', 'Environment', 'Status', 'Rate limit', 'Expires', 'Last used', ''].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {keys === null ? (
                  [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={8} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
                ) : filteredKeys.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-12 text-center text-[var(--text-muted)]">
                    <Filter size={22} className="mx-auto mb-2 opacity-60" />
                    {keys.length === 0 && !notProvisioned ? 'No API keys issued yet — create your first key.' : 'No keys match these filters.'}
                  </td></tr>
                ) : (
                  filteredKeys.slice(0, 500).map((r) => {
                    const expired = isKeyExpired(r, nowMs)
                    const effStatus = expired ? 'expired' : String(r.status || '').toLowerCase()
                    return (
                      <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                        <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">{r.key_name || '—'}</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-secondary)] whitespace-nowrap">{maskKey(r.key_prefix)}</td>
                        <td className="px-4 py-2.5"><Badge className={ENV_STYLE[r.environment] || ''}>{r.environment || '—'}</Badge></td>
                        <td className="px-4 py-2.5"><Badge className={KEY_STATUS_STYLE[effStatus] || ''}>{effStatus || '—'}</Badge></td>
                        <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.rate_limit != null ? `${Number(r.rate_limit).toLocaleString()}/min` : '—'}</td>
                        <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtDate(r.expires_at)}</td>
                        <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtDate(r.last_used_at)}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => openEditKey(r)} className="p-1.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Edit"><Pencil size={14} /></button>
                            <button onClick={() => setConfirmDelete({ ...r, _kind: 'key' })} className="p-1.5 rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" aria-label="Revoke"><Ban size={14} /></button>
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                  {['Endpoint', 'URL', 'Status', 'Events', 'Failures', 'Secret', 'Last delivery', ''].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {hooks === null ? (
                  [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={8} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
                ) : filteredHooks.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-12 text-center text-[var(--text-muted)]">
                    <Filter size={22} className="mx-auto mb-2 opacity-60" />
                    {hooks.length === 0 && !notProvisioned ? 'No webhook endpoints yet — register your first endpoint.' : 'No endpoints match these filters.'}
                  </td></tr>
                ) : (
                  filteredHooks.slice(0, 500).map((r) => {
                    const status = String(r.status || '').toLowerCase()
                    return (
                      <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                        <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">{r.endpoint_name || '—'}</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-secondary)] max-w-[280px] truncate" title={r.url || ''}>{r.url || '—'}</td>
                        <td className="px-4 py-2.5"><Badge className={HOOK_STATUS_STYLE[status] || ''}>{status || '—'}</Badge></td>
                        <td className="px-4 py-2.5 text-[var(--text-secondary)] max-w-[200px] truncate" title={r.event_types || ''}>{r.event_types || '—'}</td>
                        <td className="px-4 py-2.5">
                          <span className={(Number(r.failure_count) || 0) > 0 ? 'text-red-400 font-semibold' : 'text-[var(--text-secondary)]'}>
                            {r.failure_count != null ? Number(r.failure_count).toLocaleString() : '0'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          {r.secret_set
                            ? <Badge className="bg-green-900/30 text-green-300 border-green-800/50">Set</Badge>
                            : <Badge className="bg-amber-900/30 text-amber-300 border-amber-800/50">None</Badge>}
                        </td>
                        <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtDateTime(r.last_delivery_at)}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => openEditHook(r)} className="p-1.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Edit"><Pencil size={14} /></button>
                            <button onClick={() => setConfirmDelete({ ...r, _kind: 'hook' })} className="p-1.5 rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" aria-label="Delete"><Trash2 size={14} /></button>
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          )}
        </div>
        {activeFilteredCount > 500 && <p className="px-4 py-2 text-xs text-[var(--text-muted)] border-t border-[var(--input-border)]">Showing first 500 — refine filters or export for the full set.</p>}
      </div>

      {/* Create / Edit modal */}
      {showModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={closeModal}>
          <div className="card w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[var(--text-primary)] inline-flex items-center gap-2">
                {tab === 'keys' ? <KeyRound size={18} /> : <Webhook size={18} />}
                {editing ? (tab === 'keys' ? 'Edit API key' : 'Edit webhook') : (tab === 'keys' ? 'New API key' : 'New webhook')}
              </h3>
              <button onClick={closeModal} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>

            <form onSubmit={submit} className="space-y-4">
              {tab === 'keys' ? (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="label">Key name</label>
                      <input className="input w-full" placeholder="e.g. ERP sync (read-only)" value={keyForm.key_name} maxLength={200} onChange={(e) => setKey('key_name', e.target.value)} />
                    </div>
                    <div>
                      <label className="label">Key prefix (display hint)</label>
                      <input className="input w-full font-mono" placeholder="tp_live_9f3c" value={keyForm.key_prefix} maxLength={60} onChange={(e) => setKey('key_prefix', e.target.value)} />
                      <p className="text-[11px] text-[var(--text-muted)] mt-1">Never store the full secret — only a recognisable prefix.</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="label">Environment</label>
                      <select className="input w-full" value={keyForm.environment} onChange={(e) => setKey('environment', e.target.value)}>
                        <option value="sandbox">Sandbox</option>
                        <option value="production">Production</option>
                      </select>
                    </div>
                    <div>
                      <label className="label">Status</label>
                      <select className="input w-full" value={keyForm.status} onChange={(e) => setKey('status', e.target.value)}>
                        <option value="active">Active</option>
                        <option value="revoked">Revoked</option>
                        <option value="expired">Expired</option>
                      </select>
                    </div>
                    <div>
                      <label className="label">Rate limit (/min)</label>
                      <input className="input w-full" type="number" min="0" step="1" placeholder="600" value={keyForm.rate_limit} onChange={(e) => setKey('rate_limit', e.target.value)} />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="label">Expires at (optional)</label>
                      <input className="input w-full" type="date" value={keyForm.expires_at} onChange={(e) => setKey('expires_at', e.target.value)} />
                    </div>
                    <div>
                      <label className="label">Owner / label (optional)</label>
                      <input className="input w-full" placeholder="e.g. Integrations team" value={keyForm.created_label} maxLength={200} onChange={(e) => setKey('created_label', e.target.value)} />
                    </div>
                  </div>
                  <div>
                    <label className="label">Scopes (optional)</label>
                    <input className="input w-full" placeholder="tyres:read, vehicles:read, inspections:write" value={keyForm.scopes} maxLength={2000} onChange={(e) => setKey('scopes', e.target.value)} />
                  </div>
                  <div>
                    <label className="label">Notes (optional)</label>
                    <textarea className="input w-full min-h-[70px] resize-y" placeholder="Purpose, owning team, rotation policy…" value={keyForm.notes} maxLength={8000} onChange={(e) => setKey('notes', e.target.value)} />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="label">Endpoint name</label>
                    <input className="input w-full" placeholder="e.g. Ops alerting hook" value={hookForm.endpoint_name} maxLength={200} onChange={(e) => setHook('endpoint_name', e.target.value)} />
                  </div>
                  <div>
                    <label className="label">Delivery URL</label>
                    <input className="input w-full font-mono" placeholder="https://example.com/webhooks/tyre-pulse" value={hookForm.url} maxLength={2000} onChange={(e) => setHook('url', e.target.value)} />
                  </div>
                  <div>
                    <label className="label">Event types</label>
                    <input className="input w-full" placeholder="alert.created, inspection.completed, tyre.changed" value={hookForm.event_types} maxLength={2000} onChange={(e) => setHook('event_types', e.target.value)} />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="label">Status</label>
                      <select className="input w-full" value={hookForm.status} onChange={(e) => setHook('status', e.target.value)}>
                        <option value="active">Active</option>
                        <option value="paused">Paused</option>
                        <option value="failing">Failing</option>
                        <option value="disabled">Disabled</option>
                      </select>
                    </div>
                    <div>
                      <label className="label">Failure count</label>
                      <input className="input w-full" type="number" min="0" step="1" placeholder="0" value={hookForm.failure_count} onChange={(e) => setHook('failure_count', e.target.value)} />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer">
                    <input type="checkbox" checked={hookForm.secret_set} onChange={(e) => setHook('secret_set', e.target.checked)} className="accent-indigo-500" />
                    Signing secret configured
                    <span className="text-[11px] text-[var(--text-muted)]">(the secret value itself is never stored here)</span>
                  </label>
                  <div>
                    <label className="label">Notes (optional)</label>
                    <textarea className="input w-full min-h-[70px] resize-y" placeholder="Consumer system, retry policy, on-call owner…" value={hookForm.notes} maxLength={8000} onChange={(e) => setHook('notes', e.target.value)} />
                  </div>
                </>
              )}

              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : (tab === 'keys' ? 'Create key' : 'Create webhook')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete / Revoke confirm */}
      {confirmDelete && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={() => !deleting && setConfirmDelete(null)}>
          <div className="card w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-red-900/30 flex items-center justify-center shrink-0">
                {confirmDelete._kind === 'key' ? <Ban size={18} className="text-red-400" /> : <Trash2 size={18} className="text-red-400" />}
              </div>
              <div>
                <h3 className="text-[var(--text-primary)] font-semibold">
                  {confirmDelete._kind === 'key' ? 'Revoke this API key?' : 'Delete this webhook?'}
                </h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  {confirmDelete._kind === 'key'
                    ? <>{confirmDelete.key_name || 'Key'} · {maskKey(confirmDelete.key_prefix)}. Revoking permanently disables this credential and cannot be undone.</>
                    : <>{confirmDelete.endpoint_name || 'Endpoint'} · {confirmDelete.url || '—'}. This can’t be undone.</>}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-5">
              <button onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm" disabled={deleting}>Cancel</button>
              <button onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={deleting}>
                {confirmDelete._kind === 'key' ? <Ban size={14} /> : <Trash2 size={14} />}
                {deleting ? 'Working…' : (confirmDelete._kind === 'key' ? 'Revoke' : 'Delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
