/**
 * DeveloperPortal (route /developer-portal) — the integrator-facing control
 * surface. Two tabs on one page:
 *
 *   • API Keys  — issue and revoke REAL keys in the canonical `api_keys` table
 *     (the one the public API authenticates against; create_api_key /
 *     revoke_api_key). The plaintext key is shown ONCE on creation; only its
 *     sha256 is stored. The retired `developer_api_keys` table is not used.
 *   • Webhooks  — register outbound event-delivery endpoints, track delivery
 *     health and failure counts, edit/remove. KPI tiles, health meter,
 *     status badges.
 *
 * Runs on the canonical `api_keys` table (V99) and `webhook_endpoints` (V194). Real data, KPI
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
  FileText, Plus, Pencil, Trash2, Copy, CalendarClock, KeySquare, ShieldAlert, RefreshCw,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import Modal from '../components/ui/Modal'
import { useSettings } from '../contexts/SettingsContext'
import {
  listApiKeys, createApiKey, revokeApiKey,
  listWebhookEndpoints, createWebhookEndpoint, updateWebhookEndpoint, deleteWebhookEndpoint,
} from '../lib/api/developerPortal'
import {
  summariseKeys, summariseWebhooks, maskKey,
} from '../lib/developerPortal'
import {
  keyRows, hookRows, filterKeyRows, filterHookRows, keyInsights, hookInsights,
} from '../lib/developerPortalAnalytics'
import { compareValues } from '../lib/consoleTable'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation } from '../lib/api/_client'

const EMPTY_KEY_FORM = { key_name: '', expires_at: '' }
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
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString()
}
function fmtDateTime(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleString()
}
const pct = (r) => (r == null ? 'N/A' : `${Math.round(r * 100)}%`)
const sortCompare = (a, b, id) => compareValues(a.getValue(id), b.getValue(id))
const undef = (v) => (v === null || v === undefined || v === '' ? undefined : v)
const iconBtn = 'p-2.5 rounded-lg text-[var(--text-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500'


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
  // The plaintext of a just-minted key. Shown once, never stored in the page.
  const [newKey, setNewKey] = useState(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setNotProvisioned(false)
    try {
      const [k, h] = await Promise.all([
        listApiKeys(),
        listWebhookEndpoints({ country: activeCountry }),
      ])
      setKeys(Array.isArray(k) ? k : [])
      setHooks(Array.isArray(h) ? h : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(toUserMessage(err, 'Could not load the developer portal.'))
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
  // Insight + filter logic lives in developerPortalAnalytics (pure, tested).
  const keyInfo = useMemo(() => keyInsights(keys || [], nowMs), [keys, nowMs])
  const hookInfo = useMemo(() => hookInsights(hooks || []), [hooks])

  // ── Filtering ──────────────────────────────────────────────────────────────
  const filteredKeys = useMemo(
    () => filterKeyRows(keyRows(keys || [], nowMs), { status: statusFilter, query: search }),
    [keys, statusFilter, search, nowMs],
  )
  const filteredHooks = useMemo(
    () => filterHookRows(hookRows(hooks || []), { status: statusFilter, query: search }),
    [hooks, statusFilter, search],
  )

  const statusOptions = tab === 'keys'
    ? ['active', 'revoked', 'expired']
    : ['active', 'paused', 'failing', 'disabled']

  // ── KPI tiles ────────────────────────────────────────────────────────────
  // Status tiles double as filters (aria-pressed); the label, not the colour,
  // carries the meaning.
  const keyKpis = [
    { label: 'Total keys', value: keySummary.totalKeys, icon: KeyRound, tone: 'text-[var(--text-primary)]' },
    { label: 'Active', value: keySummary.activeCount, icon: ShieldCheck, tone: 'text-green-400', status: 'active' },
    { label: 'Expired', value: keySummary.expiredCount, icon: Clock, tone: 'text-amber-400', status: 'expired' },
    { label: 'Revoked', value: keySummary.revokedCount, icon: Ban, tone: 'text-red-400', status: 'revoked' },
    { label: 'Expiring in 30 days', value: keyInfo.expiringSoon, icon: CalendarClock, tone: 'text-amber-400', sub: 'live keys' },
    { label: 'Never used', value: keyInfo.neverUsed, icon: KeySquare, tone: 'text-[var(--text-secondary)]', sub: `${keyInfo.stale} unused for 90+ days` },
  ]
  const hookKpis = [
    { label: 'Endpoints', value: hookSummary.totalEndpoints, icon: Webhook, tone: 'text-[var(--text-primary)]' },
    { label: 'Active', value: hookSummary.activeCount, icon: Radio, tone: 'text-green-400', status: 'active' },
    { label: 'Failing', value: hookSummary.failingCount, icon: AlertOctagon, tone: 'text-red-400', status: 'failing' },
    { label: 'Total failures', value: hookSummary.totalFailures, icon: AlertTriangle, tone: 'text-amber-400' },
    { label: 'No signing secret', value: hookInfo.withoutSecret, icon: ShieldAlert, tone: 'text-amber-400' },
    { label: 'Production keys', value: keySummary.productionCount, icon: Server, tone: 'text-indigo-400', sub: 'live API credentials' },
  ]
  const kpis = tab === 'keys' ? keyKpis : hookKpis
  const loaded = tab === 'keys' ? keys : hooks
  // A failed read is not a count of zero.
  const readFailed = !!error || notProvisioned

  // ── Export (active tab) ────────────────────────────────────────────────────
  const [exportError, setExportError] = useState('')
  const doExport = async (kind) => {
    setExportError('')
    try { await runExport(kind) } catch (err) { setExportError(toUserMessage(err, 'Could not export. Try again.')) }
  }
  const runExport = async (kind) => {
    if (tab === 'keys') {
      const cols = ['key_name', 'key_prefix', 'environment', 'status', 'scopes', 'rate_limit', 'expires_at', 'last_used_at', 'created_at']
      const headers = ['Key name', 'Prefix', 'Environment', 'Status', 'Scopes', 'Rate limit', 'Expires', 'Last used', 'Created']
      const rows = filteredKeys.map((r) => ({
        key_name: r.key_name || '',
        key_prefix: r.key_prefix || '',
        environment: r.environment || '',
        status: r._status || 'N/A',
        scopes: r.scopes || '',
        rate_limit: r.rate_limit ?? '',
        expires_at: r.expires_at ? fmtDate(r.expires_at) : '',
        last_used_at: r.last_used_at ? fmtDate(r.last_used_at) : '',
        created_at: r.created_at ? fmtDate(r.created_at) : '',
      }))
      if (kind === 'excel') await exportToExcel(rows, cols, headers, reportFileName('API Keys'))
      else await exportToPdf(rows, cols.map((k, i) => ({ key: k, header: headers[i] })), 'API Keys', reportFileName('API Keys'), 'landscape')
    } else {
      const cols = ['endpoint_name', 'url', 'status', 'event_types', 'failure_count', 'secret_set', 'last_delivery_at', 'created_at']
      const headers = ['Endpoint', 'URL', 'Status', 'Event types', 'Failures', 'Secret set', 'Last delivery', 'Created']
      const rows = filteredHooks.map((r) => ({
        endpoint_name: r.endpoint_name || '',
        url: r.url || '',
        status: r.status || '',
        event_types: r.event_types || '',
        failure_count: r._failures ?? 'N/A',
        secret_set: r.secret_set ? 'Yes' : 'No',
        last_delivery_at: r.last_delivery_at ? fmtDate(r.last_delivery_at) : '',
        created_at: r.created_at ? fmtDate(r.created_at) : '',
      }))
      if (kind === 'excel') await exportToExcel(rows, cols, headers, reportFileName('Webhook Endpoints'))
      else await exportToPdf(rows, cols.map((k, i) => ({ key: k, header: headers[i] })), 'Webhook Endpoints', reportFileName('Webhook Endpoints'), 'landscape')
    }
  }

  // EnterpriseTable pages (and sorts) the WHOLE filtered list itself; the
  // exports above still cover every filtered row, never one page.
  const keyColumns = [
    { id: 'key_name', accessorFn: (r) => undef(r.key_name), header: 'Key name', sortingFn: sortCompare, sortUndefined: 'last', cell: ({ getValue }) => <span className="font-medium text-[var(--text-primary)]">{getValue() || 'N/A'}</span> },
    { id: 'key_prefix', accessorFn: (r) => undef(r.key_prefix), header: 'Prefix', enableSorting: false, cell: ({ row }) => <span className="font-mono text-xs whitespace-nowrap">{maskKey(row.original.key_prefix)}</span> },
    { id: 'environment', accessorFn: (r) => undef(r.environment), header: 'Environment', sortingFn: sortCompare, sortUndefined: 'last', cell: ({ getValue }) => <Badge className={ENV_STYLE[getValue()] || ''}>{getValue() || 'N/A'}</Badge> },
    { id: 'status', accessorFn: (r) => undef(r._status), header: 'Status', sortingFn: sortCompare, sortUndefined: 'last', cell: ({ getValue }) => <Badge className={KEY_STATUS_STYLE[getValue()] || ''}>{getValue() || 'N/A'}</Badge> },
    { id: 'rate_limit', accessorFn: (r) => undef(r.rate_limit), header: 'Rate limit', sortingFn: sortCompare, sortUndefined: 'last', meta: { align: 'right' }, cell: ({ getValue }) => (getValue() != null ? `${Number(getValue()).toLocaleString()}/min` : 'N/A') },
    { id: 'expires_at', accessorFn: (r) => undef(r.expires_at), header: 'Expires', sortingFn: sortCompare, sortUndefined: 'last', cell: ({ getValue }) => <span className="whitespace-nowrap">{getValue() ? fmtDate(getValue()) : 'Never'}</span> },
    { id: 'last_used_at', accessorFn: (r) => undef(r.last_used_at), header: 'Last used', sortingFn: sortCompare, sortUndefined: 'last', cell: ({ getValue }) => <span className="whitespace-nowrap">{getValue() ? fmtDate(getValue()) : 'Never used'}</span> },
    {
      id: 'actions', header: 'Actions', enableSorting: false, meta: { align: 'right', export: false },
      cell: ({ row }) => row.original._status !== 'revoked' ? (
        <button onClick={() => setConfirmDelete({ ...row.original, _kind: 'key' })} className={`${iconBtn} hover:bg-red-900/30 hover:text-red-400`} aria-label={`Revoke key ${row.original.key_name || ''}`.trim()}><Ban size={14} aria-hidden="true" /></button>
      ) : <span className="text-xs text-[var(--text-muted)]">Revoked</span>,
    },
  ]
  const hookColumns = [
    { id: 'endpoint_name', accessorFn: (r) => undef(r.endpoint_name), header: 'Endpoint', sortingFn: sortCompare, sortUndefined: 'last', cell: ({ getValue }) => <span className="font-medium text-[var(--text-primary)]">{getValue() || 'N/A'}</span> },
    { id: 'url', accessorFn: (r) => undef(r.url), header: 'URL', sortingFn: sortCompare, sortUndefined: 'last', cell: ({ getValue }) => <span className="block font-mono text-xs max-w-[280px] truncate" title={getValue() || ''}>{getValue() || 'N/A'}</span> },
    { id: 'status', accessorFn: (r) => undef(r._status), header: 'Status', sortingFn: sortCompare, sortUndefined: 'last', cell: ({ getValue }) => <Badge className={HOOK_STATUS_STYLE[getValue()] || ''}>{getValue() || 'N/A'}</Badge> },
    { id: 'event_types', accessorFn: (r) => undef(r.event_types), header: 'Events', sortingFn: sortCompare, sortUndefined: 'last', cell: ({ getValue }) => <span className="block max-w-[200px] truncate" title={getValue() || ''}>{getValue() || 'N/A'}</span> },
    {
      id: 'failures', accessorFn: (r) => undef(r._failures), header: 'Failures', sortingFn: sortCompare, sortUndefined: 'last', meta: { align: 'right' },
      cell: ({ getValue }) => getValue() == null ? 'N/A' : <span className={getValue() > 0 ? 'text-red-400 font-semibold' : ''}>{Number(getValue()).toLocaleString()}</span>,
    },
    { id: 'secret_set', accessorFn: (r) => (r.secret_set ? 'Set' : 'None'), header: 'Secret', sortingFn: sortCompare, cell: ({ getValue }) => getValue() === 'Set' ? <Badge className="bg-green-900/30 text-green-400 border-green-800/50">Set</Badge> : <Badge className="bg-amber-900/30 text-amber-400 border-amber-800/50">None</Badge> },
    { id: 'last_delivery_at', accessorFn: (r) => undef(r.last_delivery_at), header: 'Last delivery', sortingFn: sortCompare, sortUndefined: 'last', cell: ({ getValue }) => <span className="whitespace-nowrap">{fmtDateTime(getValue())}</span> },
    {
      id: 'actions', header: 'Actions', enableSorting: false, meta: { align: 'right', export: false },
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <button onClick={() => openEditHook(row.original)} className={`${iconBtn} hover:bg-[var(--input-bg)] hover:text-[var(--text-primary)]`} aria-label={`Edit webhook ${row.original.endpoint_name || ''}`.trim()}><Pencil size={14} aria-hidden="true" /></button>
          <button onClick={() => setConfirmDelete({ ...row.original, _kind: 'hook' })} className={`${iconBtn} hover:bg-red-900/30 hover:text-red-400`} aria-label={`Delete webhook ${row.original.endpoint_name || ''}`.trim()}><Trash2 size={14} aria-hidden="true" /></button>
        </div>
      ),
    },
  ]

  const activeFilteredCount = tab === 'keys' ? filteredKeys.length : filteredHooks.length
  const activeTotalCount = tab === 'keys' ? keySummary.totalKeys : hookSummary.totalEndpoints

  // ── Modal handlers ─────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null)
    setKeyForm(EMPTY_KEY_FORM)
    setHookForm(EMPTY_HOOK_FORM)
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
        const minted = await createApiKey(keyForm)
        setCopied(false)
        setNewKey(minted && minted.key ? { name: keyForm.key_name.trim(), key: minted.key, prefix: minted.prefix } : null)
      } else {
        if (!hookForm.endpoint_name.trim()) { setFormError('An endpoint name is required.'); setSaving(false); return }
        const payload = { ...hookForm, country }
        if (editing) await updateWebhookEndpoint(editing.id, payload)
        else await createWebhookEndpoint(payload)
      }
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save.'))
    } finally {
      setSaving(false)
    }
  }, [tab, keyForm, hookForm, editing, activeCountry, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      if (confirmDelete._kind === 'key') await revokeApiKey(confirmDelete.id)
      else await deleteWebhookEndpoint(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setError(toUserMessage(err, 'Could not delete.'))
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
        subtitle="Issue and revoke API keys for the Tyre Pulse public API. Webhook entries are records only: they do not start delivery."
        icon={KeyRound}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => doExport('excel')} className="btn-secondary min-h-[44px] text-sm inline-flex items-center gap-1.5" disabled={!activeFilteredCount || readFailed}>
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            <button onClick={() => doExport('pdf')} className="btn-secondary min-h-[44px] text-sm inline-flex items-center gap-1.5" disabled={!activeFilteredCount || readFailed}>
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary min-h-[44px] text-sm inline-flex items-center gap-1.5" disabled={notProvisioned}>
              <Plus size={14} aria-hidden="true" /> {tab === 'keys' ? 'Issue API key' : 'Register webhook'}
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-400 font-medium">The Developer Portal is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V194_DEVELOPER_PORTAL.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex flex-wrap items-start gap-3" role="alert">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-[200px]"><p className="text-red-400 font-medium">Could not load the developer portal, so the figures below are not counts.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
          <button onClick={load} disabled={refreshing} className="btn-secondary min-h-[44px] text-sm inline-flex items-center gap-1.5">
            <RefreshCw size={14} aria-hidden="true" /> Retry
          </button>
        </div>
      )}
      {exportError && (
        <div className="card border border-red-800/50 flex items-center gap-3" role="alert">
          <AlertTriangle size={16} className="text-red-400 shrink-0" aria-hidden="true" />
          <p className="text-sm text-red-400 flex-1">{exportError}</p>
          <button onClick={() => setExportError('')} className={iconBtn} aria-label="Dismiss export error"><X size={14} aria-hidden="true" /></button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-1 border-b border-[var(--input-border)]" role="tablist" aria-label="Developer portal sections">
        {tabs.map((t) => {
          const Icon = t.icon
          const active = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              role="tab"
              aria-selected={active}
              className={`inline-flex items-center gap-2 px-4 min-h-[44px] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 text-sm font-medium border-b-2 -mb-px transition-colors ${active ? 'border-indigo-500 text-[var(--text-primary)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
            >
              <Icon size={15} aria-hidden="true" /> {t.label}
              <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[11px] ${active ? 'bg-indigo-900/40 text-indigo-400' : 'bg-[var(--input-bg)] text-[var(--text-muted)]'}`}>
                {(tab === t.id ? loaded : true) === null || readFailed ? 'N/A' : t.count}
              </span>
            </button>
          )
        })}
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon
          const pressed = !!k.status && statusFilter === k.status
          const body = (
            <>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                <Icon size={16} className={k.tone} aria-hidden="true" />
              </div>
              <p className="text-3xl font-bold mt-1 text-[var(--text-primary)] tabular-nums">{loaded === null ? '...' : readFailed ? 'N/A' : k.value}</p>
              {k.sub && <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{k.sub}</p>}
            </>
          )
          return k.status ? (
            <button key={k.label} type="button" aria-pressed={pressed}
              onClick={() => setStatusFilter(pressed ? '' : k.status)}
              className={`card text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${pressed ? 'ring-2 ring-indigo-500' : ''}`}>
              {body}
            </button>
          ) : <div key={k.label} className="card">{body}</div>
        })}
      </div>

      {/* Webhook health meter (webhooks tab only) */}
      {tab === 'webhooks' && (
        <div className="card">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
              <Activity size={15} /> Delivery health
            </h3>
            <span className="text-sm font-semibold text-[var(--text-primary)]">{hooks === null || readFailed ? 'N/A' : pct(hookInfo.healthRate)}</span>
          </div>
          {(() => {
            const rate = hooks === null || readFailed ? null : hookInfo.healthRate
            const w = rate == null ? 0 : Math.round(rate * 100)
            return (
              <div className="h-2.5 w-full rounded-full bg-[var(--input-bg)] overflow-hidden" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={rate == null ? undefined : w} aria-valuetext={rate == null ? 'Not measurable' : `${w}% of endpoints active`} aria-label="Webhook delivery health">
                <div className={`h-full rounded-full transition-all ${w >= 80 ? 'bg-green-500' : w >= 50 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${w}%` }} />
              </div>
            )
          })()}
          <p className="text-[11px] text-[var(--text-muted)] mt-2">
            {hookInfo.total === 0
              ? 'No endpoints registered, so health is not measurable.'
              : `Share of endpoints currently active. ${hookSummary.failingCount} failing, ${hookSummary.totalFailures} total failed deliveries${hookInfo.worst ? `, most on ${hookInfo.worst.name || 'an unnamed endpoint'} (${hookInfo.worst.failures})` : ''}.`}
          </p>
        </div>
      )}

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
            <input
              type="search"
              aria-label={tab === 'keys' ? 'Search API keys' : 'Search webhooks'}
              className="input pl-9 w-full min-h-[44px]"
              placeholder={tab === 'keys' ? 'Search key name, prefix, scopes' : 'Search endpoint, URL, events'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select className="input min-h-[44px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {statusOptions.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
          </select>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary min-h-[44px] text-sm inline-flex items-center gap-1.5"><X size={14} aria-hidden="true" /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{activeFilteredCount} of {activeTotalCount}</span>
        </div>
      </div>

      {/* Table */}
      <div className="card">
        {tab === 'keys' ? (
          <EnterpriseTable
            key="keys"
            columns={keyColumns}
            data={filteredKeys}
            getRowId={(r) => String(r.id)}
            loading={keys === null}
            enableGlobalFilter={false}
            enableColumnFilters={false}
            enableExport={false}
            initialPageSize={50}
            emptyMessage={readFailed ? 'API keys could not be read.' : keys && keys.length === 0 ? 'No API keys issued yet. Issue your first key.' : 'No keys match these filters.'}
          />
        ) : (
          <EnterpriseTable
            key="hooks"
            columns={hookColumns}
            data={filteredHooks}
            getRowId={(r) => String(r.id)}
            loading={hooks === null}
            enableGlobalFilter={false}
            enableColumnFilters={false}
            enableExport={false}
            initialPageSize={50}
            emptyMessage={readFailed ? 'Webhook endpoints could not be read.' : hooks && hooks.length === 0 ? 'No webhook endpoints yet. Register your first endpoint.' : 'No endpoints match these filters.'}
          />
        )}
      </div>

      {/* Create / Edit modal */}
      <Modal
        open={showModal}
        onClose={closeModal}
        title={(
          <span className="inline-flex items-center gap-2">
            {tab === 'keys' ? <KeyRound size={18} aria-hidden="true" /> : <Webhook size={18} aria-hidden="true" />}
            {editing ? 'Edit webhook record' : (tab === 'keys' ? 'Issue API key' : 'New webhook record')}
          </span>
        )}
        size="md"
      >
            <form onSubmit={submit} className="space-y-4">
              {tab === 'keys' ? (
                <>
                  <div>
                    <label className="label" htmlFor="dp-key-name">Key name</label>
                    <input id="dp-key-name" className="input w-full" placeholder="e.g. ERP sync (read-only)" value={keyForm.key_name} maxLength={200} onChange={(e) => setKey('key_name', e.target.value)} />
                  </div>
                  <div>
                    <label className="label" htmlFor="dp-key-exp">Expires on (optional)</label>
                    <input id="dp-key-exp" className="input w-full" type="date" value={keyForm.expires_at} onChange={(e) => setKey('expires_at', e.target.value)} />
                  </div>
                  <p className="text-xs text-[var(--text-muted)]">
                    The key grants read-only access to this organisation&apos;s data through the public API. It is shown once after it is issued and cannot be recovered later, so copy it straight away.
                  </p>
                </>
              ) : (
                <>
                  <div>
                    <label className="label" htmlFor="dp-hook-name">Endpoint name</label>
                    <input id="dp-hook-name" className="input w-full" placeholder="e.g. Ops alerting hook" value={hookForm.endpoint_name} maxLength={200} onChange={(e) => setHook('endpoint_name', e.target.value)} />
                  </div>
                  <div>
                    <label className="label" htmlFor="dp-hook-url">Delivery URL</label>
                    <input id="dp-hook-url" className="input w-full font-mono" placeholder="https://example.com/webhooks/tyre-pulse" value={hookForm.url} maxLength={2000} onChange={(e) => setHook('url', e.target.value)} />
                  </div>
                  <div>
                    <label className="label" htmlFor="dp-hook-events">Event types</label>
                    <input id="dp-hook-events" className="input w-full" placeholder="alert.created, inspection.completed, tyre.changed" value={hookForm.event_types} maxLength={2000} onChange={(e) => setHook('event_types', e.target.value)} />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="label" htmlFor="dp-hook-status">Status</label>
                      <select id="dp-hook-status" className="input w-full" value={hookForm.status} onChange={(e) => setHook('status', e.target.value)}>
                        <option value="active">Active</option>
                        <option value="paused">Paused</option>
                        <option value="failing">Failing</option>
                        <option value="disabled">Disabled</option>
                      </select>
                    </div>
                    <div>
                      <label className="label" htmlFor="dp-hook-fail">Failure count</label>
                      <input id="dp-hook-fail" className="input w-full" type="number" min="0" step="1" placeholder="0" value={hookForm.failure_count} onChange={(e) => setHook('failure_count', e.target.value)} />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer">
                    <input type="checkbox" checked={hookForm.secret_set} onChange={(e) => setHook('secret_set', e.target.checked)} className="accent-indigo-500" />
                    Signing secret recorded as configured
                    <span className="text-[11px] text-[var(--text-muted)]">(the secret value itself is never stored here)</span>
                  </label>
                  <div>
                    <label className="label" htmlFor="dp-hook-notes">Notes (optional)</label>
                    <textarea id="dp-hook-notes" className="input w-full min-h-[70px] resize-y" placeholder="Consumer system, retry policy, on-call owner" value={hookForm.notes} maxLength={8000} onChange={(e) => setHook('notes', e.target.value)} />
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
                  {saving ? 'Saving...' : editing ? 'Save changes' : (tab === 'keys' ? 'Save key reference' : 'Save webhook record')}
                </button>
              </div>
            </form>
      </Modal>

      {/* One-time plaintext of a just-issued key */}
      {/* No onClose: this dialog only closes through the explicit acknowledgement,
          so Escape or a stray backdrop click can never discard the one-time key. */}
      <Modal
        open={Boolean(newKey)}
        title={newKey ? (
          <span className="inline-flex items-center gap-2"><KeyRound size={18} aria-hidden="true" /> API key issued: {newKey.name}</span>
        ) : ''}
        size="md"
        closeOnBackdrop={false}
        footer={(
          <button type="button" className="btn-primary text-sm min-h-[44px]" onClick={() => { setNewKey(null); setCopied(false) }}>I have copied it</button>
        )}
      >
        {newKey && (
          <>
            <p className="text-sm text-amber-300">Copy this key now. It is shown only once and cannot be recovered.</p>
            <div className="mt-3 flex items-center gap-2">
              <code className="flex-1 font-mono text-xs break-all bg-[var(--input-bg)] rounded px-2 py-2 text-[var(--text-primary)]" data-testid="new-api-key">{newKey.key}</code>
              <button
                type="button"
                className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"
                onClick={async () => { try { await navigator.clipboard.writeText(newKey.key); setCopied(true) } catch { setCopied(false) } }}
              ><Copy size={14} aria-hidden="true" /> {copied ? 'Copied' : 'Copy'}</button>
            </div>
          </>
        )}
      </Modal>

      {/* Delete / Revoke confirm */}
      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => { if (!deleting) setConfirmDelete(null) }}
        title={confirmDelete?._kind === 'key' ? 'Revoke this API key?' : 'Delete this webhook record?'}
        size="sm"
        footer={confirmDelete ? (
          <>
            <button type="button" onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm min-h-[44px]" disabled={deleting}>Cancel</button>
            <button type="button" onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={deleting}>
              {confirmDelete._kind === 'key' ? <Ban size={14} aria-hidden="true" /> : <Trash2 size={14} aria-hidden="true" />}
              {deleting ? 'Working...' : (confirmDelete._kind === 'key' ? 'Revoke key' : 'Delete record')}
            </button>
          </>
        ) : null}
      >
        {confirmDelete && (
          <p className="text-sm text-[var(--text-muted)]">
            {confirmDelete._kind === 'key'
              ? <>{confirmDelete.key_name || 'Key'} · {maskKey(confirmDelete.key_prefix)}. Any system using this key stops working immediately. The key stays listed as revoked.</>
              : <>{confirmDelete.endpoint_name || 'Endpoint'} · {confirmDelete.url || 'N/A'}. This cannot be undone.</>}
          </p>
        )}
      </Modal>
    </div>
  )
}
