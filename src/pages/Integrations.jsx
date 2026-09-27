import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Webhook, KeyRound, Plus, Trash2, Edit2, X, Save, Loader2, Search,
  ToggleLeft, ToggleRight, XCircle, Copy, Check, AlertTriangle,
  ShieldCheck, Clock, Send, CheckCircle, Ban, Eye, EyeOff, RefreshCw,
} from 'lucide-react'
import * as integrations from '../lib/api/integrations'
import { canAddResource } from '../lib/api/billing'
import { formatDistanceToNow } from 'date-fns'
import { formatDateTime } from '../lib/formatters'
import { toUserMessage } from '../lib/safeError'
import PageHeader from '../components/ui/PageHeader'
import StatTile from '../components/ui/StatTile'
import Modal from '../components/ui/Modal'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import {
  apiKeyStatus, summarizeApiKeys, filterApiKeys, daysToExpiry, KEY_STATUS_LABEL,
  webhookHealth, summarizeWebhooks, filterWebhooks, HOOK_HEALTH_LABEL,
  summarizeDeliveries, filterDeliveries, eventTypeBreakdown, DELIVERY_STATUS_LABEL, fmtRate,
  EXPIRING_SOON_DAYS, STALE_KEY_DAYS,
} from '../lib/integrationsAnalytics'

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50

const WEBHOOK_EVENTS = [
  'inspection.completed',
  'tyre.installed',
  'accident.reported',
  'accident.closure_changed',
  'workorder.created',
  'workorder.status_changed',
  'corrective_action.created',
  'purchase.order_created',
  'stock.movement',
  'threshold.triggered',
  'knowledge.document_added',
  'workflow.started',
  'workflow.step_advanced',
  'workflow.approved',
  'workflow.rejected',
  'workflow.cancelled',
  'workflow.escalated',
  'rule.threshold.triggered',
]

// Semantic status colours stay; each badge also carries an icon + text so
// colour is never the only signal.
const DELIVERY_BADGE = {
  pending:   { badge: 'bg-yellow-500/15 text-yellow-500 border-yellow-500/30', icon: Clock },
  delivered: { badge: 'bg-green-500/15 text-green-500 border-green-500/30',   icon: CheckCircle },
  failed:    { badge: 'bg-red-500/15 text-red-500 border-red-500/30',         icon: AlertTriangle },
}

const KEY_BADGE = {
  active:  { badge: 'bg-green-500/15 text-green-500 border-green-500/30', icon: ShieldCheck },
  expired: { badge: 'bg-yellow-500/15 text-yellow-500 border-yellow-500/30', icon: Clock },
  revoked: { badge: 'bg-[var(--surface-2)] text-[var(--text-muted)] border-[var(--border-bright)]', icon: Ban },
}

const HOOK_BADGE = {
  healthy:  { badge: 'bg-green-500/15 text-green-500 border-green-500/30', icon: CheckCircle },
  failing:  { badge: 'bg-yellow-500/15 text-yellow-500 border-yellow-500/30', icon: AlertTriangle },
  disabled: { badge: 'bg-red-500/15 text-red-500 border-red-500/30', icon: Ban },
  inactive: { badge: 'bg-[var(--surface-2)] text-[var(--text-muted)] border-[var(--border-bright)]', icon: ToggleLeft },
}

const INPUT = 'w-full min-h-[44px] bg-[var(--surface-1)] border border-[var(--border-bright)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-dim)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500'
const LABEL = 'block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1.5'
const BTN_PRIMARY = 'inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2 rounded-lg font-semibold text-sm text-white bg-orange-600 hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 transition-colors'
const BTN_SECONDARY = 'inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2 rounded-lg text-sm font-medium text-[var(--text-secondary)] bg-[var(--surface-2)] hover:bg-[var(--surface-3)] border border-[var(--border-bright)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 transition-colors'
const PANEL = 'bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl'

function relativeTime(ts) {
  if (!ts) return null
  try { return formatDistanceToNow(new Date(ts), { addSuffix: true }) }
  catch { return null }
}

function Badge({ meta, label }) {
  const Icon = meta.icon
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold whitespace-nowrap ${meta.badge}`}>
      <Icon className="w-3 h-3" aria-hidden="true" /> {label}
    </span>
  )
}

// ─── Copy button ──────────────────────────────────────────────────────────────

function CopyButton({ value, label = 'Copy' }) {
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true); setFailed(false)
      setTimeout(() => setCopied(false), 1800)
    } catch { setFailed(true) }
  }
  return (
    <button
      onClick={copy}
      type="button"
      className="inline-flex items-center gap-1.5 min-h-[36px] px-2.5 py-1 rounded-lg text-xs font-semibold text-[var(--text-secondary)] bg-[var(--surface-2)] hover:bg-[var(--surface-3)] border border-[var(--border-bright)] shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-500" aria-hidden="true" /> : <Copy className="w-3.5 h-3.5" aria-hidden="true" />}
      {copied ? 'Copied' : failed ? 'Copy blocked, select text' : label}
    </button>
  )
}

// ─── Shared error banner ──────────────────────────────────────────────────────

function ErrorBanner({ message, onRetry }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2.5 p-4 rounded-xl bg-red-500/10 border border-red-500/30">
      <XCircle className="w-4 h-4 text-red-500 shrink-0" aria-hidden="true" />
      <p className="text-red-500 text-sm flex-1 min-w-0">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="inline-flex items-center gap-1.5 min-h-[36px] shrink-0 px-3 py-1 text-xs font-semibold text-red-500 bg-red-500/10 hover:bg-red-500/20 rounded-lg border border-red-500/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400">
          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> Retry
        </button>
      )}
    </div>
  )
}

function FilterSelect({ id, label, value, onChange, children }) {
  return (
    <div className="min-w-[160px]">
      <label htmlFor={id} className={LABEL}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={`${INPUT} cursor-pointer`}>
        {children}
      </select>
    </div>
  )
}

// ─── API Keys tab ─────────────────────────────────────────────────────────────

function ApiKeysTab({ search }) {
  const [keys, setKeys]           = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [actionError, setActionError] = useState(null)
  const [showForm, setShowForm]   = useState(false)
  const [name, setName]           = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [formError, setFormError] = useState(null)
  const [creating, setCreating]   = useState(false)
  const [newKey, setNewKey]       = useState(null)   // { name, key, prefix }
  const [revoking, setRevoking]   = useState(null)
  const [status, setStatus]       = useState('all')
  const [now] = useState(() => new Date())

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const rows = await integrations.listApiKeys()
      setKeys(rows || [])
    } catch (err) { setError(toUserMessage(err, 'Failed to load API keys')) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetch() }, [fetch])

  async function handleCreate(e) {
    e.preventDefault()
    if (!name.trim()) { setFormError('Key name is required'); return }
    if (expiresAt && new Date(expiresAt) <= new Date()) { setFormError('Expiry must be in the future'); return }
    setCreating(true)
    setFormError(null)
    try {
      // Plan entitlement: block minting beyond the org's API-key cap.
      // Server-authoritative (org_can_add); fails open on RPC error.
      if (!(await canAddResource('api_keys'))) {
        setFormError("Your plan's API-key limit has been reached. Upgrade in Billing & Subscription to mint more keys.")
        setCreating(false)
        return
      }
      const result = await integrations.createApiKey({
        name: name.trim(),
        scopes: ['read'],
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      })
      setNewKey({ name: name.trim(), ...result })
      setName('')
      setExpiresAt('')
      setShowForm(false)
      fetch()
    } catch (err) { setFormError(toUserMessage(err, 'Failed to create key')) }
    finally { setCreating(false) }
  }

  const handleRevoke = useCallback(async (k) => {
    if (!window.confirm(`Revoke API key "${k.name}"? Integrations using it will stop working immediately.`)) return
    setRevoking(k.id)
    setActionError(null)
    try {
      await integrations.revokeApiKey(k.id)
      fetch()
    } catch (err) { setActionError(toUserMessage(err, 'Revoke failed')) }
    finally { setRevoking(null) }
  }, [fetch])

  const summary = useMemo(() => summarizeApiKeys(keys, now), [keys, now])
  const visible = useMemo(() => filterApiKeys(keys, { search, status }, now), [keys, search, status, now])
  const filtersActive = !!search.trim() || status !== 'all'

  const columns = useMemo(() => [
    { id: 'name', header: 'Name', accessorFn: (k) => k.name || '', size: 200,
      cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.name}</span> },
    { id: 'prefix', header: 'Key', accessorFn: (k) => k.key_prefix || '', size: 140,
      cell: ({ row }) => <code className="text-xs font-mono text-[var(--text-secondary)]">{row.original.key_prefix}...</code> },
    { id: 'scopes', header: 'Scopes', accessorFn: (k) => (k.scopes || []).join(', '), size: 120,
      cell: ({ row }) => (
        <div className="flex gap-1 flex-wrap">
          {(row.original.scopes || []).map((s) => (
            <span key={s} className="px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-500 text-[10px] font-semibold">{s}</span>
          ))}
        </div>
      ) },
    { id: 'rate', header: 'Rate/min', accessorFn: (k) => Number(k.rate_per_minute) || 0, size: 90, meta: { align: 'right' },
      cell: ({ row }) => row.original.rate_per_minute ?? 'N/A' },
    { id: 'status', header: 'Status', accessorFn: (k) => KEY_STATUS_LABEL[apiKeyStatus(k, now)], size: 110,
      cell: ({ row }) => { const st = apiKeyStatus(row.original, now); return <Badge meta={KEY_BADGE[st]} label={KEY_STATUS_LABEL[st]} /> } },
    { id: 'last_used', header: 'Last Used', accessorFn: (k) => k.last_used_at || '', size: 140,
      meta: { exportValue: (k) => (k.last_used_at ? formatDateTime(k.last_used_at) : 'Never') },
      cell: ({ row }) => <span className="text-[var(--text-muted)] whitespace-nowrap">{row.original.last_used_at ? relativeTime(row.original.last_used_at) : 'Never'}</span> },
    { id: 'expires', header: 'Expires', accessorFn: (k) => k.expires_at || '', size: 170,
      meta: { exportValue: (k) => (k.expires_at ? formatDateTime(k.expires_at) : 'Never') },
      cell: ({ row }) => {
        const k = row.original
        if (!k.expires_at) return <span className="text-[var(--text-muted)]">Never</span>
        const d = daysToExpiry(k, now)
        const soon = apiKeyStatus(k, now) === 'active' && d != null && d <= EXPIRING_SOON_DAYS
        return (
          <span className="whitespace-nowrap text-[var(--text-muted)]">
            {formatDateTime(k.expires_at)}
            {soon && <span className="ml-1.5 text-yellow-500 font-semibold">({d} day{d === 1 ? '' : 's'} left)</span>}
          </span>
        )
      } },
    { id: 'actions', header: '', enableSorting: false, size: 110, meta: { export: false, align: 'right' },
      cell: ({ row }) => {
        const k = row.original
        if (!k.active) return null
        return (
          <button
            onClick={() => handleRevoke(k)}
            disabled={revoking === k.id}
            className="inline-flex items-center gap-1 min-h-[36px] px-2.5 py-1 rounded-lg text-[11px] font-semibold text-red-500 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
          >
            {revoking === k.id ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" /> : <Ban className="w-3 h-3" aria-hidden="true" />} Revoke
          </button>
        )
      } },
  ], [now, revoking, handleRevoke])

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} onRetry={fetch} />}
      {actionError && <ErrorBanner message={actionError} />}

      {!error && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <StatTile label="API keys" value={loading ? '...' : summary.total} icon={KeyRound} />
          <StatTile label="Active" value={loading ? '...' : summary.active} tone="accent" icon={ShieldCheck} />
          <StatTile label={`Expiring in ${EXPIRING_SOON_DAYS}d`} value={loading ? '...' : summary.expiringSoon} tone={summary.expiringSoon ? 'warn' : 'neutral'} icon={Clock} />
          <StatTile label="Active, never used" value={loading ? '...' : summary.neverUsed} sub={`Unused over ${STALE_KEY_DAYS}d: ${loading ? '...' : summary.stale}`} tone={summary.neverUsed ? 'info' : 'neutral'} icon={Eye} />
          <StatTile label="Expired / revoked" value={loading ? '...' : summary.expired + summary.revoked} icon={Ban} />
        </div>
      )}

      {/* One-time plaintext key callout */}
      {newKey && (
        <div role="status" className="p-4 rounded-xl bg-orange-500/10 border border-orange-500/40 space-y-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-orange-500 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-orange-500 text-sm font-semibold">API key &ldquo;{newKey.name}&rdquo; created. Copy it now.</p>
              <p className="text-[var(--text-secondary)] text-xs mt-0.5">
                This is the only time the full key is shown. It cannot be recovered, only revoked and re-issued.
              </p>
            </div>
            <button onClick={() => setNewKey(null)} className="p-2 -m-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400" aria-label="Dismiss new key notice">
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2 bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg px-3 py-2.5">
            <code className="flex-1 min-w-0 text-[var(--text-primary)] text-xs font-mono break-all">{newKey.key}</code>
            <CopyButton value={newKey.key} label="Copy key" />
          </div>
        </div>
      )}

      {/* Filters + create */}
      <div className="flex flex-wrap items-end gap-3">
        <FilterSelect id="key-status" label="Status" value={status} onChange={setStatus}>
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="expired">Expired</option>
          <option value="revoked">Revoked</option>
        </FilterSelect>
        {filtersActive && (
          <p className="text-xs text-[var(--text-muted)] pb-3">{visible.length} of {keys.length} key(s) shown</p>
        )}
        <div className="flex-1" />
        <button onClick={fetch} disabled={loading} className={BTN_SECONDARY}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /> Refresh
        </button>
        <button onClick={() => setShowForm((v) => !v)} aria-expanded={showForm} className={BTN_PRIMARY}>
          <Plus className="w-4 h-4" aria-hidden="true" /> Create Key
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className={`${PANEL} p-4 grid grid-cols-1 sm:grid-cols-[1fr,200px,auto] gap-3 items-end`}>
          <div>
            <label htmlFor="key-name" className={LABEL}>
              Key Name <span className="text-orange-500" aria-hidden="true">*</span>
            </label>
            <input
              id="key-name"
              type="text"
              required
              value={name}
              onChange={(e) => { setName(e.target.value); setFormError(null) }}
              placeholder="e.g. ERP integration"
              className={INPUT}
            />
          </div>
          <div>
            <label htmlFor="key-expiry" className={LABEL}>
              Expires <span className="text-[var(--text-dim)] font-normal normal-case">(optional)</span>
            </label>
            <input
              id="key-expiry"
              type="date"
              value={expiresAt}
              onChange={(e) => { setExpiresAt(e.target.value); setFormError(null) }}
              className={INPUT}
            />
          </div>
          <button type="submit" disabled={creating} className={BTN_PRIMARY}>
            {creating ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <KeyRound className="w-4 h-4" aria-hidden="true" />} Mint Key
          </button>
          {formError && <p role="alert" className="text-red-500 text-xs sm:col-span-3">{formError}</p>}
        </form>
      )}

      {!error && (
        <EnterpriseTable
          columns={columns}
          data={visible}
          getRowId={(k) => String(k.id)}
          loading={loading}
          enableGlobalFilter={false}
          enableColumnFilters={false}
          initialPageSize={25}
          exportFileName="API Keys"
          reportMeta={{ title: 'API Keys' }}
          emptyMessage={filtersActive ? 'No keys match your search or filter.' : 'No API keys yet. Mint a read-only key to let external systems query the TyrePulse API.'}
        />
      )}
    </div>
  )
}

// ─── Webhook modal ────────────────────────────────────────────────────────────

function WebhookModal({ mode, initial, onSave, onClose, saving }) {
  const [form, setForm] = useState(() => ({
    name: initial?.name || '',
    url: initial?.url || '',
    allEvents: !initial?.event_types?.length,
    event_types: initial?.event_types || [],
    active: initial?.active ?? true,
  }))
  const [errors, setErrors] = useState({})

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }))
    setErrors((e) => { const n = { ...e }; delete n[key]; return n })
  }

  function toggleEvent(ev) {
    setForm((f) => ({
      ...f,
      event_types: f.event_types.includes(ev) ? f.event_types.filter((x) => x !== ev) : [...f.event_types, ev],
    }))
    setErrors((e) => { const n = { ...e }; delete n.event_types; return n })
  }

  function validate() {
    const e = {}
    if (!form.name.trim()) e.name = 'Name is required'
    if (!/^https:\/\/.+\..+/i.test(form.url.trim())) e.url = 'A valid https:// URL is required'
    if (!form.allEvents && form.event_types.length === 0) e.event_types = 'Select at least one event type, or subscribe to all'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (!validate()) return
    onSave({
      name: form.name.trim(),
      url: form.url.trim(),
      event_types: form.allEvents ? null : form.event_types,
      active: form.active,
    })
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === 'edit' ? 'Edit Webhook' : 'New Webhook'}
      size="md"
      closeOnBackdrop={!saving}
      footer={
        <div className="flex flex-wrap gap-3 justify-end w-full">
          <button type="button" onClick={onClose} className={BTN_SECONDARY}>Cancel</button>
          <button type="submit" form="webhook-form" disabled={saving} className={BTN_PRIMARY}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Save className="w-4 h-4" aria-hidden="true" />}
            {mode === 'edit' ? 'Save Changes' : 'Create Webhook'}
          </button>
        </div>
      }
    >
      <form id="webhook-form" onSubmit={handleSubmit} noValidate className="space-y-5">
        <div>
          <label htmlFor="hook-name" className={LABEL}>
            Name <span className="text-orange-500" aria-hidden="true">*</span>
          </label>
          <input
            id="hook-name"
            type="text"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="e.g. ERP notifier"
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? 'hook-name-err' : undefined}
            className={`${INPUT} ${errors.name ? '!border-red-500' : ''}`}
          />
          {errors.name && <p id="hook-name-err" role="alert" className="text-red-500 text-xs mt-1">{errors.name}</p>}
        </div>

        <div>
          <label htmlFor="hook-url" className={LABEL}>
            Endpoint URL <span className="text-orange-500" aria-hidden="true">*</span> <span className="text-[var(--text-dim)] font-normal normal-case">(https only)</span>
          </label>
          <input
            id="hook-url"
            type="url"
            value={form.url}
            onChange={(e) => set('url', e.target.value)}
            placeholder="https://example.com/hooks/tyrepulse"
            aria-invalid={!!errors.url}
            aria-describedby={errors.url ? 'hook-url-err' : undefined}
            className={`${INPUT} font-mono ${errors.url ? '!border-red-500' : ''}`}
          />
          {errors.url && <p id="hook-url-err" role="alert" className="text-red-500 text-xs mt-1">{errors.url}</p>}
        </div>

        <fieldset>
          <div className="flex items-center justify-between mb-2">
            <legend className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Event Types</legend>
            <label className="flex items-center gap-2 cursor-pointer select-none min-h-[36px]">
              <input
                type="checkbox"
                checked={form.allEvents}
                onChange={(e) => set('allEvents', e.target.checked)}
                className="w-4 h-4 rounded accent-orange-500 cursor-pointer"
              />
              <span className="text-[var(--text-secondary)] text-xs">All events</span>
            </label>
          </div>
          {!form.allEvents && (
            <div className="flex flex-wrap gap-1.5 p-3 rounded-xl bg-[var(--surface-2)] border border-[var(--border-bright)] max-h-44 overflow-y-auto">
              {WEBHOOK_EVENTS.map((ev) => {
                const on = form.event_types.includes(ev)
                return (
                  <button
                    key={ev}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleEvent(ev)}
                    className={`inline-flex items-center gap-1 min-h-[32px] px-2 py-1 rounded-md text-[11px] font-mono border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 ${
                      on ? 'bg-orange-500/15 text-orange-500 border-orange-500/40' : 'bg-[var(--surface-1)] text-[var(--text-muted)] border-[var(--border-bright)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {on && <Check className="w-3 h-3" aria-hidden="true" />}{ev}
                  </button>
                )
              })}
            </div>
          )}
          {errors.event_types && <p role="alert" className="text-red-500 text-xs mt-1">{errors.event_types}</p>}
        </fieldset>

        <div className="flex items-center justify-between gap-3 py-3 px-4 rounded-xl bg-[var(--surface-2)] border border-[var(--border-bright)]">
          <div>
            <p className="text-[var(--text-primary)] text-sm font-medium">Webhook active</p>
            <p className="text-[var(--text-muted)] text-xs">Inactive webhooks skip all deliveries</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={form.active}
            onClick={() => set('active', !form.active)}
            className="p-1.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
            aria-label="Webhook active"
          >
            {form.active ? <ToggleRight className="w-8 h-8 text-orange-500" aria-hidden="true" /> : <ToggleLeft className="w-8 h-8 text-[var(--text-muted)]" aria-hidden="true" />}
          </button>
        </div>

        <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border-dim)]">
          <ShieldCheck className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-[var(--text-secondary)] text-xs leading-relaxed">
            Every delivery is signed: <code className="font-mono">X-TyrePulse-Signature: sha256=&lt;hex&gt;</code>,
            an HMAC-SHA256 of the raw request body using this webhook&rsquo;s signing secret. Verify it before trusting payloads.
          </p>
        </div>
      </form>
    </Modal>
  )
}

// ─── Webhooks tab ─────────────────────────────────────────────────────────────

function WebhookCard({ hook, onEdit, onDelete, onToggle }) {
  const [deleting, setDeleting] = useState(false)
  const [toggling, setToggling] = useState(false)
  const [showSecret, setShowSecret] = useState(false)
  const health = webhookHealth(hook)

  async function handleDelete() {
    if (!window.confirm(`Delete webhook "${hook.name}"? Delivery history for it will also be removed.`)) return
    setDeleting(true)
    await onDelete(hook.id)
    setDeleting(false)
  }

  async function handleToggle() {
    setToggling(true)
    await onToggle(hook.id, !hook.active)
    setToggling(false)
  }

  return (
    <article className={`${PANEL} overflow-hidden ${hook.active ? '' : 'opacity-80'}`} aria-label={`Webhook ${hook.name}`}>
      <div className="p-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[var(--text-primary)] font-semibold text-sm truncate">{hook.name}</p>
              <Badge meta={HOOK_BADGE[health]} label={HOOK_HEALTH_LABEL[health]} />
            </div>
            <p className="text-[var(--text-muted)] text-xs font-mono mt-0.5 break-all">{hook.url}</p>
          </div>
          <button
            onClick={handleToggle}
            disabled={toggling}
            role="switch"
            aria-checked={!!hook.active}
            aria-label={hook.active ? `Deactivate ${hook.name}` : `Activate ${hook.name}`}
            className="shrink-0 p-2 -m-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
          >
            {toggling
              ? <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
              : hook.active ? <ToggleRight className="w-6 h-6 text-orange-500" aria-hidden="true" /> : <ToggleLeft className="w-6 h-6" aria-hidden="true" />}
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {hook.event_types?.length
            ? hook.event_types.map((ev) => (
              <span key={ev} className="px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-500 text-[10px] font-mono">{ev}</span>
            ))
            : <span className="px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-500 text-[10px] font-semibold">all events</span>}
        </div>

        {hook.disabled_reason && (
          <div className="flex items-center gap-1.5 mt-2.5 px-2.5 py-1.5 rounded-lg bg-red-500/10 border border-red-500/25">
            <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0" aria-hidden="true" />
            <p className="text-red-500 text-[11px]">{hook.disabled_reason}</p>
          </div>
        )}

        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5 text-[11px] text-[var(--text-muted)]">
          {hook.consecutive_failures > 0 && (
            <span className="text-yellow-500 font-semibold">{hook.consecutive_failures} consecutive failure{hook.consecutive_failures !== 1 ? 's' : ''}</span>
          )}
          <span>Last success: <span className="text-[var(--text-secondary)]">{hook.last_success_at ? relativeTime(hook.last_success_at) : 'never'}</span></span>
          <span>Last failure: <span className="text-[var(--text-secondary)]">{hook.last_failure_at ? relativeTime(hook.last_failure_at) : 'never'}</span></span>
        </div>

        {/* Signing secret */}
        <div className="flex items-center gap-2 mt-3 bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg px-3 py-1.5">
          <code className="flex-1 min-w-0 text-[var(--text-secondary)] text-[11px] font-mono truncate">
            {showSecret ? (hook.secret || 'N/A') : '••••••••••••••••••••••••'}
          </code>
          <button
            type="button"
            onClick={() => setShowSecret((v) => !v)}
            className="p-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
            aria-label={showSecret ? 'Hide signing secret' : 'Show signing secret'}
          >
            {showSecret ? <EyeOff className="w-3.5 h-3.5" aria-hidden="true" /> : <Eye className="w-3.5 h-3.5" aria-hidden="true" />}
          </button>
          {hook.secret && <CopyButton value={hook.secret} label="Copy secret" />}
        </div>
        <p className="text-[var(--text-dim)] text-[10px] mt-1.5">
          HMAC-SHA256 of the raw body, in header <code className="font-mono">X-TyrePulse-Signature: sha256=&lt;hex&gt;</code>
        </p>
      </div>

      <div className="px-4 py-2 border-t border-[var(--border-dim)] flex items-center justify-end gap-1">
        <button onClick={() => onEdit(hook)} className="p-2.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400" aria-label={`Edit ${hook.name}`}>
          <Edit2 className="w-4 h-4" aria-hidden="true" />
        </button>
        <button onClick={handleDelete} disabled={deleting} className="p-2.5 rounded-lg text-[var(--text-muted)] hover:text-red-500 hover:bg-red-500/10 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400" aria-label={`Delete ${hook.name}`}>
          {deleting ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Trash2 className="w-4 h-4" aria-hidden="true" />}
        </button>
      </div>
    </article>
  )
}

function WebhooksTab({ search }) {
  const [hooks, setHooks]     = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [actionError, setActionError] = useState(null)
  const [modal, setModal]     = useState(null)
  const [saving, setSaving]   = useState(false)
  const [health, setHealth]   = useState('all')

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const rows = await integrations.listWebhooks()
      setHooks(rows || [])
    } catch (err) { setError(toUserMessage(err, 'Failed to load webhooks')) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetch() }, [fetch])

  async function handleSave(values) {
    setSaving(true)
    setActionError(null)
    try {
      if (modal.mode === 'edit') await integrations.updateWebhook(modal.initial.id, values)
      else await integrations.createWebhook(values)
      setModal(null)
      fetch()
    } catch (err) { setActionError(toUserMessage(err, 'Save failed')) }
    finally { setSaving(false) }
  }

  async function handleDelete(id) {
    setActionError(null)
    try {
      await integrations.deleteWebhook(id)
      setHooks((prev) => prev.filter((h) => h.id !== id))
    } catch (err) { setActionError(toUserMessage(err, 'Delete failed')) }
  }

  async function handleToggle(id, active) {
    setActionError(null)
    try {
      await integrations.updateWebhook(id, { active })
      setHooks((prev) => prev.map((h) => (h.id === id ? { ...h, active } : h)))
    } catch (err) { setActionError(toUserMessage(err, 'Update failed')) }
  }

  const summary = useMemo(() => summarizeWebhooks(hooks), [hooks])
  const visible = useMemo(() => filterWebhooks(hooks, { search, health }), [hooks, search, health])
  const filtersActive = !!search.trim() || health !== 'all'

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} onRetry={fetch} />}
      {actionError && <ErrorBanner message={actionError} />}

      {!error && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <StatTile label="Webhooks" value={loading ? '...' : summary.total} icon={Webhook} />
          <StatTile label="Healthy" value={loading ? '...' : summary.healthy} tone="accent" icon={CheckCircle} />
          <StatTile label="Failing" value={loading ? '...' : summary.failing} tone={summary.failing ? 'warn' : 'neutral'} icon={AlertTriangle} />
          <StatTile label="Auto-disabled / off" value={loading ? '...' : summary.disabled + summary.inactive} tone={summary.disabled ? 'crit' : 'neutral'} icon={Ban} />
          <StatTile label="All-event subscribers" value={loading ? '...' : summary.allEvents} sub={`Specific events covered: ${loading ? '...' : summary.subscribedEvents}`} icon={Send} />
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <FilterSelect id="hook-health" label="Health" value={health} onChange={setHealth}>
          <option value="all">All webhooks</option>
          <option value="healthy">Healthy</option>
          <option value="failing">Failing</option>
          <option value="disabled">Auto-disabled</option>
          <option value="inactive">Inactive</option>
        </FilterSelect>
        {filtersActive && <p className="text-xs text-[var(--text-muted)] pb-3">{visible.length} of {hooks.length} webhook(s) shown</p>}
        <div className="flex-1" />
        <button onClick={fetch} disabled={loading} className={BTN_SECONDARY}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /> Refresh
        </button>
        <button onClick={() => setModal({ mode: 'create', initial: null })} className={BTN_PRIMARY}>
          <Plus className="w-4 h-4" aria-hidden="true" /> New Webhook
        </button>
      </div>

      {error ? null : loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4" aria-busy="true">
          {Array.from({ length: 2 }).map((_, i) => <div key={i} className={`h-48 animate-pulse ${PANEL}`} />)}
        </div>
      ) : visible.length === 0 ? (
        <div className={`${PANEL} flex flex-col items-center justify-center py-16 gap-3 px-4 text-center`}>
          <Webhook className="w-8 h-8 text-[var(--text-dim)]" aria-hidden="true" />
          <p className="text-[var(--text-primary)] text-sm font-medium">{filtersActive ? 'No webhooks match your search or filter' : 'No webhooks configured'}</p>
          <p className="text-[var(--text-muted)] text-xs max-w-sm">
            {filtersActive ? 'Try a different search term or widen the health filter.' : 'Push domain events (inspections, accidents, work orders, workflow decisions) to external systems in real time.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {visible.map((h) => (
            <WebhookCard key={h.id} hook={h} onEdit={(hook) => setModal({ mode: 'edit', initial: hook })} onDelete={handleDelete} onToggle={handleToggle} />
          ))}
        </div>
      )}

      {modal && (
        <WebhookModal mode={modal.mode} initial={modal.initial} onSave={handleSave} onClose={() => setModal(null)} saving={saving} />
      )}
    </div>
  )
}

// ─── Deliveries tab ───────────────────────────────────────────────────────────

function DeliveriesTab({ search }) {
  const [rows, setRows]         = useState([])
  const [count, setCount]       = useState(0)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [page, setPage]         = useState(0)
  const [subId, setSubId]       = useState('all')
  const [status, setStatus]     = useState('all')
  const [subs, setSubs]         = useState([])
  const [subsError, setSubsError] = useState(false)

  useEffect(() => {
    (async () => {
      try { setSubs(await integrations.listWebhooks() || []) } catch { setSubsError(true) }
    })()
  }, [])

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { rows: data, count: total } = await integrations.listWebhookDeliveries({
        subscriptionId: subId === 'all' ? null : subId,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      })
      setRows(data || [])
      setCount(total || 0)
    } catch (err) { setError(toUserMessage(err, 'Failed to load deliveries')) }
    finally { setLoading(false) }
  }, [subId, page])

  useEffect(() => { fetch() }, [fetch])

  const subName = useCallback((id) => subs.find((s) => s.id === id)?.name || 'N/A', [subs])
  const visible = useMemo(() => filterDeliveries(rows, { search, status }, subName), [rows, search, status, subName])
  const summary = useMemo(() => summarizeDeliveries(rows), [rows])
  const topEvents = useMemo(() => eventTypeBreakdown(rows).slice(0, 5), [rows])
  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE))
  const filtersActive = subId !== 'all' || status !== 'all' || !!search.trim()

  const columns = useMemo(() => [
    { id: 'time', header: 'Time', accessorFn: (d) => d.created_at || '', size: 170,
      meta: { exportValue: (d) => formatDateTime(d.created_at) },
      cell: ({ row }) => <span className="whitespace-nowrap text-[var(--text-secondary)]">{formatDateTime(row.original.created_at)}</span> },
    { id: 'event', header: 'Event Type', accessorFn: (d) => d.event_type || '', size: 200,
      cell: ({ row }) => <code className="text-purple-500 text-[11px] font-mono">{row.original.event_type}</code> },
    { id: 'webhook', header: 'Webhook', accessorFn: (d) => subName(d.subscription_id), size: 160 },
    { id: 'status', header: 'Status', accessorFn: (d) => DELIVERY_STATUS_LABEL[d.status] || 'Pending', size: 120,
      cell: ({ row }) => {
        const st = DELIVERY_BADGE[row.original.status] ? row.original.status : 'pending'
        return <Badge meta={DELIVERY_BADGE[st]} label={DELIVERY_STATUS_LABEL[st]} />
      } },
    { id: 'attempts', header: 'Attempts', accessorFn: (d) => Number(d.attempts) || 0, size: 90, meta: { align: 'right' } },
    { id: 'http', header: 'HTTP', accessorFn: (d) => d.response_status ?? '', size: 80, meta: { align: 'right', exportValue: (d) => d.response_status ?? 'N/A' },
      cell: ({ row }) => {
        const c = row.original.response_status
        if (!c) return <span className="text-[var(--text-dim)]">N/A</span>
        return <span className={`font-semibold ${c < 300 ? 'text-green-500' : 'text-red-500'}`}>{c}{c < 300 ? '' : ' (error)'}</span>
      } },
    { id: 'detail', header: 'Error / Next Attempt', accessorFn: (d) => d.last_error || '', size: 260,
      meta: { exportValue: (d) => d.last_error || (d.status === 'pending' && d.next_attempt_at ? `Retry ${formatDateTime(d.next_attempt_at)}` : 'N/A') },
      cell: ({ row }) => {
        const d = row.original
        return (
          <div className="max-w-[260px]">
            {d.last_error && <p className="text-red-500 text-[11px] truncate" title={d.last_error}>{d.last_error}</p>}
            {d.status === 'pending' && d.next_attempt_at && <p className="text-[var(--text-muted)] text-[10px]">retries {relativeTime(d.next_attempt_at)}</p>}
            {!d.last_error && d.status !== 'pending' && <span className="text-[var(--text-dim)]">N/A</span>}
          </div>
        )
      } },
  ], [subName])

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} onRetry={fetch} />}

      {!error && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <StatTile label="Deliveries (all time)" value={loading ? '...' : count.toLocaleString()} icon={Send} />
            <StatTile label="Success rate (this page)" value={loading ? '...' : fmtRate(summary.successRate)} tone={summary.successRate != null && summary.successRate < 90 ? 'warn' : 'accent'} icon={CheckCircle} />
            <StatTile label="Failed (this page)" value={loading ? '...' : summary.failed} tone={summary.failed ? 'crit' : 'neutral'} icon={AlertTriangle} />
            <StatTile label="Pending (this page)" value={loading ? '...' : summary.pending} tone={summary.pending ? 'warn' : 'neutral'} icon={Clock} />
            <StatTile label="Avg attempts (this page)" value={loading ? '...' : (summary.avgAttempts ?? 'N/A')} icon={RefreshCw} />
          </div>
          {!loading && topEvents.length > 0 && (
            <p className="text-xs text-[var(--text-muted)]">
              Most frequent events on this page: {topEvents.map((e) => `${e.event} (${e.count})`).join(', ')}
            </p>
          )}
        </>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <FilterSelect id="del-hook" label="Webhook" value={subId} onChange={(v) => { setSubId(v); setPage(0) }}>
          <option value="all">All Webhooks</option>
          {subs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </FilterSelect>
        <FilterSelect id="del-status" label="Status" value={status} onChange={setStatus}>
          <option value="all">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="delivered">Delivered</option>
          <option value="failed">Failed</option>
        </FilterSelect>
        <div className="flex-1" />
        <button onClick={fetch} disabled={loading} className={BTN_SECONDARY}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /> Refresh
        </button>
      </div>
      {subsError && <p className="text-xs text-yellow-500">Webhook names could not be loaded, so the Webhook column reads N/A and the webhook filter is empty.</p>}
      {(status !== 'all' || search.trim()) && !loading && (
        <p className="text-xs text-[var(--text-muted)]">Status and search filter the {rows.length} deliveries on this page. Use the Webhook filter to narrow the server query.</p>
      )}

      {!error && (
        <EnterpriseTable
          columns={columns}
          data={visible}
          getRowId={(d) => String(d.id)}
          loading={loading}
          enableGlobalFilter={false}
          enableColumnFilters={false}
          manualPagination
          pageIndex={page}
          pageCount={totalPages}
          totalRows={count}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
          exportFileName="Webhook Deliveries"
          reportMeta={{ title: 'Webhook Deliveries' }}
          emptyMessage={filtersActive ? 'No deliveries match these filters. Try widening them.' : 'Delivery attempts appear here once an active webhook receives its first event.'}
        />
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const TABS = [
  { key: 'keys',       label: 'API Keys',   icon: KeyRound },
  { key: 'webhooks',   label: 'Webhooks',   icon: Webhook },
  { key: 'deliveries', label: 'Deliveries', icon: Send },
]

export default function Integrations() {
  const [tab, setTab] = useState('keys')
  const [search, setSearch] = useState('')

  return (
    <div className="text-[var(--text-primary)] space-y-6">
      <PageHeader
        title="API & Webhooks"
        subtitle="External API access keys, event webhooks, and delivery logs"
        icon={Webhook}
      />

      {/* ── Tabs + search ── */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <div role="tablist" aria-label="Integration sections" className="flex flex-wrap gap-1 bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl p-1 self-start">
          {TABS.map((t) => {
            const Icon = t.icon
            const active = tab === t.key
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.key)}
                className={`inline-flex items-center gap-1.5 min-h-[40px] px-4 py-1.5 rounded-lg text-xs font-semibold border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 transition-colors ${
                  active ? 'bg-orange-500/15 text-orange-500 border-orange-500/30' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] border-transparent'
                }`}
              >
                <Icon className="w-3.5 h-3.5" aria-hidden="true" /> {t.label}
              </button>
            )
          })}
        </div>
        <div className="relative sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" aria-hidden="true" />
          <input
            type="search"
            aria-label={tab === 'deliveries' ? 'Search deliveries' : tab === 'webhooks' ? 'Search webhooks' : 'Search API keys'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tab === 'deliveries' ? 'Search deliveries...' : tab === 'webhooks' ? 'Search webhooks...' : 'Search keys...'}
            className={`${INPUT} pl-9 pr-9`}
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-1 top-1/2 -translate-y-1/2 p-2.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400" aria-label="Clear search">
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <div role="tabpanel">
        {tab === 'keys' && <ApiKeysTab search={search} />}
        {tab === 'webhooks' && <WebhooksTab search={search} />}
        {tab === 'deliveries' && <DeliveriesTab search={search} />}
      </div>
    </div>
  )
}
