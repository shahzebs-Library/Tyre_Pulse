import { useState, useEffect, useCallback } from 'react'
import {
  Webhook, Save, Loader2, Plus, Trash2, Pencil, SendHorizonal,
  ShieldCheck, AlertCircle, Info, KeyRound, X,
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { EVENT_TYPES } from '../../lib/events'
import {
  getWebhookEndpoints, saveWebhookEndpoints, validateWebhookUrl, sendTestEvent,
} from '../../lib/webhooks'

/**
 * Outbound webhooks — admin panel for the event-driven bus (roadmap #15+#25).
 * Register https endpoints, pick which business events they receive, optionally
 * sign deliveries with a shared secret, and send a test delivery. Honest about
 * the browser-side limitation: receivers must allow CORS or sit behind a relay
 * (n8n / edge function), and delivery happens while the app is open.
 */
const EMPTY_FORM = { id: null, url: '', events: ['*'], enabled: true, secret: '', description: '' }

export default function WebhooksPanel() {
  const { profile } = useAuth()
  const isAdmin = String(profile?.role || '').toLowerCase() === 'admin'

  const [endpoints, setEndpoints] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  const [form, setForm] = useState(null)        // null = list mode; object = add/edit mode
  const [testing, setTesting] = useState(null)  // endpoint id currently sending a test
  const [testResults, setTestResults] = useState({}) // id → { ok, reason }

  const load = useCallback(async () => {
    setLoading(true)
    try { setEndpoints(await getWebhookEndpoints({ force: true })) }
    catch { /* getWebhookEndpoints never throws; keep empty */ }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const toggleEvent = (type) => setForm((f) => {
    const has = f.events.includes(type)
    let next = has ? f.events.filter((e) => e !== type) : [...f.events.filter((e) => e !== '*'), type]
    if (next.length === 0) next = ['*']
    return { ...f, events: next }
  })

  async function persist(nextList, okText) {
    setSaving(true); setMsg(null)
    try {
      setEndpoints(await saveWebhookEndpoints(nextList))
      setMsg({ type: 'ok', text: okText })
      setForm(null)
    } catch (err) {
      setMsg({ type: 'err', text: err?.message || 'Could not save webhooks.' })
    } finally { setSaving(false) }
  }

  function submitForm(e) {
    e.preventDefault()
    const check = validateWebhookUrl(form.url)
    if (!check.ok) { setMsg({ type: 'err', text: check.reason }); return }
    const entry = {
      ...form,
      secret: form.secret || null,
      created_by: form.created_by ?? profile?.id ?? null,
    }
    const next = form.id
      ? endpoints.map((ep) => (ep.id === form.id ? { ...ep, ...entry } : ep))
      : [...endpoints, entry]
    persist(next, form.id ? 'Webhook updated.' : 'Webhook added.')
  }

  function removeEndpoint(id) {
    persist(endpoints.filter((ep) => ep.id !== id), 'Webhook removed.')
  }

  function toggleEnabled(ep) {
    persist(endpoints.map((e2) => (e2.id === ep.id ? { ...e2, enabled: !e2.enabled } : e2)),
      ep.enabled ? 'Webhook disabled.' : 'Webhook enabled.')
  }

  async function runTest(ep) {
    setTesting(ep.id)
    const type = (ep.events || []).find((t) => t !== '*') || 'workorder.created'
    const result = await sendTestEvent(ep, type)
    setTestResults((r) => ({ ...r, [ep.id]: result }))
    setTesting(null)
  }

  if (loading) return (
    <div className="card flex items-center gap-2 text-sm text-[var(--text-muted)]">
      <Loader2 size={15} className="animate-spin" /> Loading webhooks…
    </div>
  )

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <Webhook size={15} className="text-[var(--accent)]" /> Outbound webhooks
        </h2>
        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[var(--input-bg)] text-[var(--text-muted)]">
          {endpoints.filter((e) => e.enabled).length} active / {endpoints.length}
        </span>
      </div>

      <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
        Push TyrePulse business events (work orders, gate passes, imports…) to external systems the
        moment they happen. Endpoints must be <b>https</b> and public — internal/private addresses are blocked.
      </p>

      {msg && (
        <div className={`text-sm rounded-lg px-3 py-2 flex items-center gap-2 ${msg.type === 'ok' ? 'bg-emerald-950/30 border border-emerald-800/40 text-emerald-300' : 'bg-red-900/25 border border-red-700/40 text-red-300'}`}>
          {msg.type === 'ok' ? <ShieldCheck size={15} /> : <AlertCircle size={15} />} {msg.text}
        </div>
      )}

      {/* Endpoint list */}
      {endpoints.length === 0 && !form && (
        <div className="rounded-lg px-3 py-4 text-sm text-[var(--text-muted)] bg-[var(--input-bg)] border border-[var(--input-border)] text-center">
          No webhooks yet. Add one to start receiving events.
        </div>
      )}
      {endpoints.map((ep) => (
        <div key={ep.id} className="rounded-lg px-3 py-2.5 bg-[var(--input-bg)] border border-[var(--input-border)] space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-xs text-[var(--text-primary)] truncate" title={ep.url}>{ep.url}</span>
            <div className="flex items-center gap-1.5 shrink-0">
              {isAdmin && (
                <>
                  <button type="button" title="Send test event" disabled={testing === ep.id}
                    onClick={() => runTest(ep)}
                    className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--accent)] disabled:opacity-50">
                    {testing === ep.id ? <Loader2 size={14} className="animate-spin" /> : <SendHorizonal size={14} />}
                  </button>
                  <button type="button" title="Edit" onClick={() => { setForm({ ...EMPTY_FORM, ...ep, secret: ep.secret || '' }); setMsg(null) }}
                    className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--accent)]"><Pencil size={14} /></button>
                  <button type="button" title="Delete" disabled={saving} onClick={() => removeEndpoint(ep.id)}
                    className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-red-400 disabled:opacity-50"><Trash2 size={14} /></button>
                  <button type="button" role="switch" aria-checked={ep.enabled} disabled={saving} onClick={() => toggleEnabled(ep)}
                    className={`relative w-9 h-5 rounded-full transition-colors ${ep.enabled ? 'bg-[var(--accent)]' : 'bg-[var(--card-bg)] border border-[var(--input-border)]'}`}>
                    <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${ep.enabled ? 'translate-x-4' : ''}`} />
                  </button>
                </>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {(ep.events || []).map((t) => (
              <span key={t} className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[var(--card-bg)] border border-[var(--input-border)] text-[var(--text-secondary)]">
                {t === '*' ? 'All events' : (EVENT_TYPES[t]?.label || t)}
              </span>
            ))}
            {ep.secret && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--card-bg)] border border-[var(--input-border)] text-[var(--text-muted)] flex items-center gap-1"><KeyRound size={10} /> signed</span>}
          </div>
          {ep.description && <p className="text-[11px] text-[var(--text-muted)]">{ep.description}</p>}
          {testResults[ep.id] && (
            <p className={`text-[11px] ${testResults[ep.id].ok ? 'text-emerald-400' : 'text-red-400'}`}>
              {testResults[ep.id].ok ? 'Test delivered.' : `Test failed: ${testResults[ep.id].reason} (a CORS block on the receiver looks like a network failure — see the note below)`}
            </p>
          )}
        </div>
      ))}

      {/* Add / edit form */}
      {isAdmin && form && (
        <form onSubmit={submitForm} className="rounded-lg px-3 py-3 bg-[var(--input-bg)] border border-[var(--input-border)] space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--text-primary)]">{form.id ? 'Edit webhook' : 'New webhook'}</span>
            <button type="button" onClick={() => setForm(null)} className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={14} /></button>
          </div>
          <label className="block">
            <span className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Endpoint URL (https)</span>
            <input className="input w-full mt-1 font-mono text-sm" value={form.url} required
              onChange={(e) => setF('url', e.target.value)} placeholder="https://hooks.yourcompany.com/tyrepulse" />
          </label>
          <div>
            <span className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Events</span>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              <button type="button" onClick={() => setF('events', ['*'])}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors ${form.events.includes('*') ? 'bg-[var(--accent)] text-white border-transparent' : 'bg-[var(--card-bg)] text-[var(--text-muted)] border-[var(--input-border)]'}`}>
                All events
              </button>
              {Object.entries(EVENT_TYPES).map(([type, def]) => {
                const on = form.events.includes(type)
                return (
                  <button type="button" key={type} title={`Payload: ${def.fields}`} onClick={() => toggleEvent(type)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors ${on ? 'bg-[var(--accent)] text-white border-transparent' : 'bg-[var(--card-bg)] text-[var(--text-muted)] border-[var(--input-border)]'}`}>
                    {def.label}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Signing secret (optional)</span>
              <input className="input w-full mt-1 font-mono text-sm" type="password" value={form.secret} autoComplete="off"
                onChange={(e) => setF('secret', e.target.value)} placeholder="shared secret" />
            </label>
            <label className="block">
              <span className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Description</span>
              <input className="input w-full mt-1" value={form.description}
                onChange={(e) => setF('description', e.target.value)} placeholder="e.g. n8n fleet workflow" />
            </label>
          </div>
          <p className="text-[11px] text-[var(--text-muted)] flex items-start gap-1.5">
            <KeyRound size={12} className="mt-0.5 shrink-0" />
            With a secret set, every delivery carries <code className="font-mono">X-TyrePulse-Signature</code> — a hex
            HMAC-SHA256 of the JSON body — so your receiver can verify it came from TyrePulse.
          </p>
          <button type="submit" disabled={saving} className="btn-primary text-sm disabled:opacity-60">
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} {form.id ? 'Save changes' : 'Add webhook'}
          </button>
        </form>
      )}

      {isAdmin && !form && (
        <button type="button" onClick={() => { setForm({ ...EMPTY_FORM }); setMsg(null) }}
          className="btn-primary text-sm">
          <Plus size={15} /> Add webhook
        </button>
      )}
      {!isAdmin && (
        <p className="text-xs text-[var(--text-muted)]">Only an administrator can manage webhooks.</p>
      )}

      {/* Delivery-model explainer — the honest part */}
      <div className="rounded-lg px-3 py-3 text-xs leading-relaxed bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] space-y-1.5">
        <p className="flex items-center gap-2 font-semibold text-[var(--text-primary)]"><Info size={13} className="text-[var(--accent)]" /> How delivery works</p>
        <p>Deliveries are sent <b>from the browser</b> the moment an event happens, so they are best-effort:
          the receiving endpoint must allow cross-origin (CORS) POSTs from this app's domain, and events fire only
          while someone has TyrePulse open.</p>
        <p>For guaranteed, server-side delivery point the webhook at a relay — an <b>n8n webhook node</b>, a
          Supabase edge function, or any serverless proxy — which accepts the signed POST and forwards it to
          systems that don't allow CORS.</p>
      </div>
    </div>
  )
}
