import { useState, useEffect, useCallback } from 'react'
import {
  Webhook, KeyRound, Plus, Trash2, Edit2, X, Save, Loader2, Search,
  ToggleLeft, ToggleRight, XCircle, Copy, Check, AlertTriangle,
  ShieldCheck, Clock, ChevronLeft, ChevronRight, Send,
  CheckCircle, Ban, Eye, EyeOff,
} from 'lucide-react'
import * as integrations from '../lib/api/integrations'
import { canAddResource } from '../lib/api/billing'
import { formatDistanceToNow } from 'date-fns'
import { formatDateTime } from '../lib/formatters'
import { toUserMessage } from '../lib/safeError'

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

const DELIVERY_STATUS = {
  pending:   { label: 'Pending',   badge: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', icon: Clock },
  delivered: { label: 'Delivered', badge: 'bg-green-500/20 text-green-400 border-green-500/30',    icon: CheckCircle },
  failed:    { label: 'Failed',    badge: 'bg-red-500/20 text-red-400 border-red-500/30',          icon: AlertTriangle },
}

function relativeTime(ts) {
  if (!ts) return null
  try { return formatDistanceToNow(new Date(ts), { addSuffix: true }) }
  catch { return null }
}

// ─── Copy button ──────────────────────────────────────────────────────────────

function CopyButton({ value, label = 'Copy' }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch { /* clipboard unavailable */ }
  }
  return (
    <button
      onClick={copy}
      type="button"
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold text-gray-300 bg-gray-700 hover:bg-gray-600 border border-gray-600 transition-all shrink-0"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? 'Copied' : label}
    </button>
  )
}

// ─── Shared error banner ──────────────────────────────────────────────────────

function ErrorBanner({ message, onRetry }) {
  return (
    <div className="flex items-center gap-2.5 p-4 rounded-xl bg-red-500/10 border border-red-500/30">
      <XCircle className="w-4 h-4 text-red-400 shrink-0" />
      <p className="text-red-400 text-sm">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="ml-auto shrink-0 px-3 py-1 text-xs font-semibold text-red-300 bg-red-500/15 hover:bg-red-500/25 rounded-lg border border-red-500/30 transition-all">
          Retry
        </button>
      )}
    </div>
  )
}

// ─── API Keys tab ─────────────────────────────────────────────────────────────

function ApiKeysTab({ search }) {
  const [keys, setKeys]           = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [showForm, setShowForm]   = useState(false)
  const [name, setName]           = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [formError, setFormError] = useState(null)
  const [creating, setCreating]   = useState(false)
  const [newKey, setNewKey]       = useState(null)   // { name, key, prefix }
  const [revoking, setRevoking]   = useState(null)

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

  async function handleRevoke(k) {
    if (!window.confirm(`Revoke API key "${k.name}"? Integrations using it will stop working immediately.`)) return
    setRevoking(k.id)
    setError(null)
    try {
      await integrations.revokeApiKey(k.id)
      fetch()
    } catch (err) { setError(toUserMessage(err, 'Revoke failed')) }
    finally { setRevoking(null) }
  }

  const q = search.trim().toLowerCase()
  const visible = keys.filter(k => !q || (k.name || '').toLowerCase().includes(q) || (k.key_prefix || '').toLowerCase().includes(q))

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} onRetry={fetch} />}

      {/* One-time plaintext key callout */}
      {newKey && (
        <div className="p-4 rounded-xl bg-orange-500/10 border border-orange-500/40 space-y-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-orange-400 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-orange-300 text-sm font-semibold">API key &ldquo;{newKey.name}&rdquo; created. Copy it now.</p>
              <p className="text-orange-400/80 text-xs mt-0.5">
                This is the only time the full key is shown. It cannot be recovered, only revoked and re-issued.
              </p>
            </div>
            <button onClick={() => setNewKey(null)} className="text-orange-400 hover:text-white transition-colors" aria-label="Dismiss">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center gap-2 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2.5">
            <code className="flex-1 text-orange-200 text-xs font-mono break-all">{newKey.key}</code>
            <CopyButton value={newKey.key} label="Copy key" />
          </div>
        </div>
      )}

      {/* Create form */}
      <div className="flex justify-end">
        <button
          onClick={() => setShowForm(v => !v)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-sm text-white bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 shadow-lg shadow-orange-500/25 transition-all"
        >
          <Plus className="w-4 h-4" /> Create Key
        </button>
      </div>
      {showForm && (
        <form onSubmit={handleCreate} className="p-4 rounded-xl bg-gray-800 border border-gray-700 grid grid-cols-1 sm:grid-cols-[1fr,200px,auto] gap-3 items-end">
          <div>
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
              Key Name <span className="text-orange-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={e => { setName(e.target.value); setFormError(null) }}
              placeholder="e.g. ERP integration"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
              Expires <span className="text-gray-600 font-normal normal-case">(optional)</span>
            </label>
            <input
              type="date"
              value={expiresAt}
              onChange={e => { setExpiresAt(e.target.value); setFormError(null) }}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all"
            />
          </div>
          <button
            type="submit"
            disabled={creating}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 rounded-lg disabled:opacity-50 transition-all"
          >
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />} Mint Key
          </button>
          {formError && <p className="text-red-400 text-xs sm:col-span-3">{formError}</p>}
        </form>
      )}

      {/* Table */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-11 rounded-lg bg-gray-700/50 animate-pulse" />)}
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <KeyRound className="w-8 h-8 text-gray-600" />
            <p className="text-gray-300 text-sm font-medium">{q ? 'No keys match your search' : 'No API keys yet'}</p>
            <p className="text-gray-500 text-xs">
              {q ? 'Try a different search term.' : 'Mint a read-only key to let external systems query the TyrePulse API.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-left">
                  {['Name', 'Key', 'Scopes', 'Rate/min', 'Status', 'Last Used', 'Expires', ''].map((h, i) => (
                    <th key={i} className="px-3 py-2.5 text-gray-400 text-xs font-semibold uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/60">
                {visible.map(k => {
                  const expired = k.expires_at && new Date(k.expires_at) < new Date()
                  return (
                    <tr key={k.id} className="hover:bg-gray-700/30 transition-colors">
                      <td className="px-3 py-2.5 text-white text-xs font-medium">{k.name}</td>
                      <td className="px-3 py-2.5"><code className="text-gray-300 text-xs font-mono">{k.key_prefix}…</code></td>
                      <td className="px-3 py-2.5">
                        <div className="flex gap-1">
                          {(k.scopes || []).map(s => (
                            <span key={s} className="px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300 text-[10px] font-semibold">{s}</span>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-gray-400 text-xs">{k.rate_per_minute}</td>
                      <td className="px-3 py-2.5">
                        {!k.active ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-600/40 text-gray-400 text-[11px] font-semibold border border-gray-600/50"><Ban className="w-3 h-3" /> Revoked</span>
                        ) : expired ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400 text-[11px] font-semibold border border-yellow-500/30"><Clock className="w-3 h-3" /> Expired</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 text-[11px] font-semibold border border-green-500/30"><ShieldCheck className="w-3 h-3" /> Active</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-gray-500 text-xs whitespace-nowrap">{k.last_used_at ? relativeTime(k.last_used_at) : 'Never'}</td>
                      <td className="px-3 py-2.5 text-gray-500 text-xs whitespace-nowrap">{k.expires_at ? formatDateTime(k.expires_at) : '—'}</td>
                      <td className="px-3 py-2.5 text-right">
                        {k.active && (
                          <button
                            onClick={() => handleRevoke(k)}
                            disabled={revoking === k.id}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 disabled:opacity-50 transition-all"
                          >
                            {revoking === k.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Ban className="w-3 h-3" />} Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
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
    setForm(f => ({ ...f, [key]: value }))
    setErrors(e => { const n = { ...e }; delete n[key]; return n })
  }

  function toggleEvent(ev) {
    setForm(f => ({
      ...f,
      event_types: f.event_types.includes(ev) ? f.event_types.filter(x => x !== ev) : [...f.event_types, ev],
    }))
    setErrors(e => { const n = { ...e }; delete n.event_types; return n })
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <h2 className="text-white font-semibold text-base">{mode === 'edit' ? 'Edit Webhook' : 'New Webhook'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-gray-800" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="overflow-y-auto flex-1">
          <div className="px-6 py-5 space-y-5">
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                Name <span className="text-orange-500">*</span>
              </label>
              <input
                type="text"
                value={form.name}
                onChange={e => set('name', e.target.value)}
                placeholder="e.g. ERP notifier"
                className={`w-full bg-gray-800 border rounded-lg px-3 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all ${errors.name ? 'border-red-500' : 'border-gray-700'}`}
              />
              {errors.name && <p className="text-red-400 text-xs mt-1">{errors.name}</p>}
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                Endpoint URL <span className="text-orange-500">*</span> <span className="text-gray-600 font-normal normal-case">(https only)</span>
              </label>
              <input
                type="url"
                value={form.url}
                onChange={e => set('url', e.target.value)}
                placeholder="https://example.com/hooks/tyrepulse"
                className={`w-full bg-gray-800 border rounded-lg px-3 py-2.5 text-white text-sm font-mono placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all ${errors.url ? 'border-red-500' : 'border-gray-700'}`}
              />
              {errors.url && <p className="text-red-400 text-xs mt-1">{errors.url}</p>}
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider">Event Types</label>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={form.allEvents}
                    onChange={e => set('allEvents', e.target.checked)}
                    className="w-4 h-4 rounded accent-orange-500 cursor-pointer"
                  />
                  <span className="text-gray-300 text-xs">All events</span>
                </label>
              </div>
              {!form.allEvents && (
                <div className="flex flex-wrap gap-1.5 p-3 rounded-xl bg-gray-800 border border-gray-700 max-h-44 overflow-y-auto">
                  {WEBHOOK_EVENTS.map(ev => {
                    const on = form.event_types.includes(ev)
                    return (
                      <button
                        key={ev}
                        type="button"
                        onClick={() => toggleEvent(ev)}
                        className={`px-2 py-1 rounded-md text-[11px] font-mono border transition-all ${
                          on ? 'bg-orange-500/20 text-orange-300 border-orange-500/40' : 'bg-gray-900 text-gray-500 border-gray-700 hover:text-gray-300'
                        }`}
                      >
                        {ev}
                      </button>
                    )
                  })}
                </div>
              )}
              {errors.event_types && <p className="text-red-400 text-xs mt-1">{errors.event_types}</p>}
            </div>

            <div className="flex items-center justify-between py-3 px-4 rounded-xl bg-gray-800 border border-gray-700">
              <div>
                <p className="text-white text-sm font-medium">Webhook active</p>
                <p className="text-gray-500 text-xs">Inactive webhooks skip all deliveries</p>
              </div>
              <button type="button" onClick={() => set('active', !form.active)} className="transition-colors" aria-label="Toggle active">
                {form.active ? <ToggleRight className="w-8 h-8 text-orange-500" /> : <ToggleLeft className="w-8 h-8 text-gray-500" />}
              </button>
            </div>

            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-gray-800/60 border border-gray-700/50">
              <ShieldCheck className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
              <p className="text-gray-400 text-xs leading-relaxed">
                Every delivery is signed: <code className="text-gray-300 font-mono">X-TyrePulse-Signature: sha256=&lt;hex&gt;</code>,
                an HMAC-SHA256 of the raw request body using this webhook&rsquo;s signing secret. Verify it before trusting payloads.
              </p>
            </div>
          </div>

          <div className="px-6 py-4 border-t border-gray-800 flex gap-3 justify-end bg-gray-900/80">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg border border-gray-700 transition-all">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 rounded-lg disabled:opacity-50 transition-all shadow-lg shadow-orange-500/20"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {mode === 'edit' ? 'Save Changes' : 'Create Webhook'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Webhooks tab ─────────────────────────────────────────────────────────────

function WebhookCard({ hook, onEdit, onDelete, onToggle }) {
  const [deleting, setDeleting] = useState(false)
  const [toggling, setToggling] = useState(false)
  const [showSecret, setShowSecret] = useState(false)

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
    <div className="relative bg-gray-800 rounded-xl border border-gray-700 border-l-4 border-l-blue-500 overflow-hidden hover:border-gray-600 transition-all">
      <div className="p-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-white font-semibold text-sm truncate">{hook.name}</p>
            <p className="text-gray-500 text-xs font-mono mt-0.5 truncate">{hook.url}</p>
          </div>
          <button
            onClick={handleToggle}
            disabled={toggling}
            title={hook.active ? 'Deactivate' : 'Activate'}
            className="shrink-0 text-gray-400 hover:text-white transition-colors disabled:opacity-50"
          >
            {toggling
              ? <Loader2 className="w-5 h-5 animate-spin" />
              : hook.active ? <ToggleRight className="w-6 h-6 text-orange-500" /> : <ToggleLeft className="w-6 h-6" />}
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {hook.event_types?.length
            ? hook.event_types.map(ev => (
              <span key={ev} className="px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300 text-[10px] font-mono">{ev}</span>
            ))
            : <span className="px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300 text-[10px] font-semibold">all events</span>}
        </div>

        {hook.disabled_reason && (
          <div className="flex items-center gap-1.5 mt-2.5 px-2.5 py-1.5 rounded-lg bg-red-500/10 border border-red-500/25">
            <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
            <p className="text-red-300 text-[11px]">{hook.disabled_reason}</p>
          </div>
        )}

        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5 text-[11px] text-gray-500">
          {hook.consecutive_failures > 0 && (
            <span className="text-yellow-400 font-semibold">{hook.consecutive_failures} consecutive failure{hook.consecutive_failures !== 1 ? 's' : ''}</span>
          )}
          <span>Last success: <span className="text-gray-400">{hook.last_success_at ? relativeTime(hook.last_success_at) : 'never'}</span></span>
          <span>Last failure: <span className="text-gray-400">{hook.last_failure_at ? relativeTime(hook.last_failure_at) : 'never'}</span></span>
        </div>

        {/* Signing secret */}
        <div className="flex items-center gap-2 mt-3 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2">
          <code className="flex-1 text-gray-400 text-[11px] font-mono truncate">
            {showSecret ? hook.secret : '••••••••••••••••••••••••'}
          </code>
          <button
            type="button"
            onClick={() => setShowSecret(v => !v)}
            className="text-gray-500 hover:text-white transition-colors shrink-0"
            title={showSecret ? 'Hide secret' : 'Show secret'}
            aria-label={showSecret ? 'Hide signing secret' : 'Show signing secret'}
          >
            {showSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
          {hook.secret && <CopyButton value={hook.secret} label="Copy secret" />}
        </div>
        <p className="text-gray-600 text-[10px] mt-1.5">
          HMAC-SHA256 of the raw body, in header <code className="font-mono">X-TyrePulse-Signature: sha256=&lt;hex&gt;</code>
        </p>
      </div>

      <div className="px-4 py-2.5 border-t border-gray-700/60 flex items-center justify-end gap-1">
        <button onClick={() => onEdit(hook)} className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 transition-all" title="Edit">
          <Edit2 className="w-3.5 h-3.5" />
        </button>
        <button onClick={handleDelete} disabled={deleting} className="p-1.5 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-50" title="Delete">
          {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
        </button>
      </div>

      {!hook.active && <div className="absolute inset-0 bg-gray-900/40 rounded-xl pointer-events-none" />}
    </div>
  )
}

function WebhooksTab({ search }) {
  const [hooks, setHooks]     = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [modal, setModal]     = useState(null)
  const [saving, setSaving]   = useState(false)

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
    setError(null)
    try {
      if (modal.mode === 'edit') await integrations.updateWebhook(modal.initial.id, values)
      else await integrations.createWebhook(values)
      setModal(null)
      fetch()
    } catch (err) { setError(toUserMessage(err, 'Save failed')) }
    finally { setSaving(false) }
  }

  async function handleDelete(id) {
    setError(null)
    try {
      await integrations.deleteWebhook(id)
      setHooks(prev => prev.filter(h => h.id !== id))
    } catch (err) { setError(toUserMessage(err, 'Delete failed')) }
  }

  async function handleToggle(id, active) {
    setError(null)
    try {
      await integrations.updateWebhook(id, { active })
      setHooks(prev => prev.map(h => h.id === id ? { ...h, active } : h))
    } catch (err) { setError(toUserMessage(err, 'Update failed')) }
  }

  const q = search.trim().toLowerCase()
  const visible = hooks.filter(h => !q || (h.name || '').toLowerCase().includes(q) || (h.url || '').toLowerCase().includes(q))

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} onRetry={fetch} />}

      <div className="flex justify-end">
        <button
          onClick={() => setModal({ mode: 'create', initial: null })}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-sm text-white bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 shadow-lg shadow-orange-500/25 transition-all"
        >
          <Plus className="w-4 h-4" /> New Webhook
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-48 rounded-xl bg-gray-800 border border-gray-700 animate-pulse" />)}
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Webhook className="w-8 h-8 text-gray-600" />
          <p className="text-gray-300 text-sm font-medium">{q ? 'No webhooks match your search' : 'No webhooks configured'}</p>
          <p className="text-gray-500 text-xs max-w-sm text-center">
            {q ? 'Try a different search term.' : 'Push domain events (inspections, accidents, work orders, workflow decisions) to external systems in real time.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {visible.map(h => (
            <WebhookCard key={h.id} hook={h} onEdit={hook => setModal({ mode: 'edit', initial: hook })} onDelete={handleDelete} onToggle={handleToggle} />
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

  useEffect(() => {
    (async () => {
      try { setSubs(await integrations.listWebhooks() || []) } catch { /* filter dropdown stays empty */ }
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

  const subName = id => subs.find(s => s.id === id)?.name || '—'
  const q = search.trim().toLowerCase()
  const visible = rows.filter(d => {
    const matchStatus = status === 'all' || d.status === status
    const matchSearch = !q
      || (d.event_type || '').toLowerCase().includes(q)
      || subName(d.subscription_id).toLowerCase().includes(q)
      || (d.last_error || '').toLowerCase().includes(q)
    return matchStatus && matchSearch
  })
  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE))

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} onRetry={fetch} />}

      <div className="flex flex-col sm:flex-row gap-3">
        <select
          value={subId}
          onChange={e => { setSubId(e.target.value); setPage(0) }}
          className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all appearance-none cursor-pointer"
        >
          <option value="all">All Webhooks</option>
          {subs.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select
          value={status}
          onChange={e => setStatus(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all appearance-none cursor-pointer"
        >
          <option value="all">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="delivered">Delivered</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-11 rounded-lg bg-gray-700/50 animate-pulse" />)}
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Send className="w-8 h-8 text-gray-600" />
            <p className="text-gray-300 text-sm font-medium">No deliveries found</p>
            <p className="text-gray-500 text-xs">
              {subId !== 'all' || status !== 'all' || q
                ? 'Try widening the filters.'
                : 'Delivery attempts appear here once an active webhook receives its first event.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-left">
                  {['Time', 'Event Type', 'Webhook', 'Status', 'Attempts', 'HTTP', 'Error / Next Attempt'].map((h, i) => (
                    <th key={i} className="px-3 py-2.5 text-gray-400 text-xs font-semibold uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/60">
                {visible.map(d => {
                  const meta = DELIVERY_STATUS[d.status] || DELIVERY_STATUS.pending
                  const Icon = meta.icon
                  return (
                    <tr key={d.id} className="hover:bg-gray-700/30 transition-colors">
                      <td className="px-3 py-2.5 text-gray-300 text-xs whitespace-nowrap">{formatDateTime(d.created_at)}</td>
                      <td className="px-3 py-2.5"><code className="text-purple-300 text-[11px] font-mono">{d.event_type}</code></td>
                      <td className="px-3 py-2.5 text-gray-300 text-xs">{subName(d.subscription_id)}</td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold ${meta.badge}`}>
                          <Icon className="w-3 h-3" /> {meta.label}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-gray-400 text-xs">{d.attempts}</td>
                      <td className="px-3 py-2.5">
                        {d.response_status
                          ? <span className={`text-xs font-semibold ${d.response_status < 300 ? 'text-green-400' : 'text-red-400'}`}>{d.response_status}</span>
                          : <span className="text-gray-600 text-xs">—</span>}
                      </td>
                      <td className="px-3 py-2.5 max-w-[260px]">
                        {d.last_error && <p className="text-red-300 text-[11px] truncate" title={d.last_error}>{d.last_error}</p>}
                        {d.status === 'pending' && d.next_attempt_at && (
                          <p className="text-gray-500 text-[10px]">retries {relativeTime(d.next_attempt_at)}</p>
                        )}
                        {!d.last_error && d.status !== 'pending' && <span className="text-gray-600 text-xs">—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {!loading && count > 0 && (
          <div className="px-4 py-3 border-t border-gray-700 flex items-center justify-between gap-3">
            <p className="text-gray-500 text-xs">
              {page * PAGE_SIZE + 1} to {Math.min((page + 1) * PAGE_SIZE, count)} of {count.toLocaleString()} deliveries
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-300 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 transition-all"
              >
                <ChevronLeft className="w-3.5 h-3.5" /> Prev
              </button>
              <span className="text-gray-500 text-xs">Page {page + 1} / {totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-300 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 transition-all"
              >
                Next <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
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
    <div className="text-white space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="p-2 rounded-lg bg-orange-500/20">
              <Webhook className="w-5 h-5 text-orange-400" />
            </div>
            <h1 className="text-2xl font-bold text-white">API &amp; Webhooks</h1>
          </div>
          <p className="text-gray-400 text-sm ml-11">External API access keys, event webhooks, and delivery logs</p>
        </div>
      </div>

      {/* ── Tabs + search ── */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <div className="flex gap-1 bg-gray-800 border border-gray-700 rounded-xl p-1 self-start">
          {TABS.map(t => {
            const Icon = t.icon
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  tab === t.key ? 'bg-orange-500/20 text-orange-300 border border-orange-500/30' : 'text-gray-400 hover:text-white border border-transparent'
                }`}
              >
                <Icon className="w-3.5 h-3.5" /> {t.label}
              </button>
            )
          })}
        </div>
        <div className="relative sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={tab === 'deliveries' ? 'Search deliveries...' : tab === 'webhooks' ? 'Search webhooks...' : 'Search keys...'}
            className="w-full bg-gray-800 border border-gray-700 rounded-xl pl-9 pr-4 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white" aria-label="Clear search">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {tab === 'keys' && <ApiKeysTab search={search} />}
      {tab === 'webhooks' && <WebhooksTab search={search} />}
      {tab === 'deliveries' && <DeliveriesTab search={search} />}
    </div>
  )
}
