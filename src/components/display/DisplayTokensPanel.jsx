/**
 * DisplayTokensPanel — elevated-user management card for roadmap item 21's
 * Executive TV Display share links (backend: MIGRATIONS_V103_EXECUTIVE_DISPLAY.sql).
 *
 * Mint high-entropy 'disp_' tokens that render the anon board at /display/<token>
 * on lobby / control-room TVs (no login). The plaintext token + full shareable
 * URL are shown ONCE on creation (they live in the URL by design and are never
 * re-derivable). Optional viewer password, refresh/rotate cadence, template
 * (which boards cycle), and expiry. List active tokens and revoke.
 *
 * Gated to elevated roles (Admin / Manager / Director — matches the server-side
 * is_elevated_user() RLS on display_tokens). Theme-token classes only; the sole
 * hardcoded colours are white-on-solid-button text.
 *
 * Mount point: Settings (alongside Integrations / Branding) or as a management
 * strip on the authed DisplayDashboard. The anon route is /display/:token.
 */
import { useState, useEffect, useCallback } from 'react'
import {
  Tv, Plus, Loader2, ShieldCheck, AlertCircle, Copy, Check, Trash2, X, Lock,
  Clock, ExternalLink, KeyRound,
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import {
  listDisplayTokens, createDisplayToken, revokeDisplayToken, buildDisplayUrl,
} from '../../lib/api/displayTokens'

const ELEVATED_ROLES = new Set(['admin', 'manager', 'director'])

// Board templates the anon page (DisplayShare) knows how to render.
const TEMPLATE_PAGES = [
  { key: 'overview', label: 'Fleet Overview' },
  { key: 'spend', label: 'Spend Trend' },
  { key: 'risk', label: 'Risk & Activity' },
]

const EMPTY_FORM = {
  name: '',
  pages: ['overview'],
  refreshSeconds: 60,
  rotateSeconds: 15,
  password: '',
  expiresAt: '',
}

function isActive(t) {
  if (!t.active) return false
  if (t.expires_at && new Date(t.expires_at).getTime() < Date.now()) return false
  return true
}

export default function DisplayTokensPanel() {
  const { profile } = useAuth()
  const elevated = ELEVATED_ROLES.has(String(profile?.role || '').toLowerCase())

  const [tokens, setTokens] = useState([])
  const [available, setAvailable] = useState(true)
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState(null) // { token, url } shown ONCE
  const [copied, setCopied] = useState(null)    // 'token' | 'url'
  const [revoking, setRevoking] = useState(null) // token id in-flight

  const load = useCallback(async () => {
    setLoading(true)
    const res = await listDisplayTokens()
    setAvailable(res.available)
    setTokens(res.tokens || [])
    if (res.error) setMsg({ type: 'err', text: res.error })
    setLoading(false)
  }, [])

  useEffect(() => { if (elevated) load() }, [elevated, load])

  const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const togglePage = (key) => setForm((f) => {
    const has = f.pages.includes(key)
    let next = has ? f.pages.filter((p) => p !== key) : [...f.pages, key]
    if (next.length === 0) next = ['overview']
    // Preserve the canonical order for a stable rotation.
    next = TEMPLATE_PAGES.map((p) => p.key).filter((k2) => next.includes(k2))
    return { ...f, pages: next }
  })

  async function submit(e) {
    e.preventDefault()
    if (creating) return
    if (!form.name.trim()) { setMsg({ type: 'err', text: 'A display name is required.' }); return }
    setCreating(true); setMsg(null); setCreated(null)
    const res = await createDisplayToken({
      name: form.name.trim(),
      template: { pages: form.pages },
      refreshSeconds: Number(form.refreshSeconds) || 60,
      rotateSeconds: Number(form.rotateSeconds) || 15,
      password: form.password.trim() || null,
      expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
    })
    setCreating(false)
    if (!res.available) { setAvailable(false); return }
    if (res.error) { setMsg({ type: 'err', text: res.error }); return }
    if (res.token) {
      setCreated({ token: res.token, url: buildDisplayUrl(res.token) })
      setMsg({ type: 'ok', text: 'Display link created. Copy it now; the token is shown only once.' })
      setShowForm(false)
      setForm(EMPTY_FORM)
      load()
    }
  }

  async function revoke(id) {
    setRevoking(id); setMsg(null)
    const res = await revokeDisplayToken(id)
    setRevoking(null)
    if (!res.available) { setAvailable(false); return }
    if (res.error) { setMsg({ type: 'err', text: res.error }); return }
    setMsg({ type: 'ok', text: 'Display link revoked.' })
    load()
  }

  function copy(text, kind) {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(kind)
      setTimeout(() => setCopied((c) => (c === kind ? null : c)), 1800)
    })
  }

  // ── Access gate ────────────────────────────────────────────────────────────
  if (!elevated) return null

  if (loading) return (
    <div className="card flex items-center gap-2 text-sm text-[var(--text-muted)]">
      <Loader2 size={15} className="animate-spin" /> Loading display links…
    </div>
  )

  const activeTokens = tokens.filter(isActive)

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <Tv size={15} className="text-[var(--accent)]" /> Executive display links
        </h2>
        {available && (
          <button type="button" onClick={() => { setShowForm((v) => !v); setMsg(null); setCreated(null) }}
            className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-[var(--accent)] text-white flex items-center gap-1.5 hover:opacity-90 transition-opacity">
            {showForm ? <X size={13} /> : <Plus size={13} />}
            {showForm ? 'Cancel' : 'Create link'}
          </button>
        )}
      </div>

      <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
        Share a secure, read-only board for lobby and control-room TVs, no login required. The link
        shows only aggregate KPIs and branding (never raw records). Boards render at{' '}
        <span className="font-mono text-[var(--text-primary)]">/display/&lt;token&gt;</span>.
      </p>

      {/* Backend-not-applied empty state */}
      {!available && (
        <div className="rounded-lg px-3 py-4 text-sm text-[var(--text-muted)] bg-[var(--input-bg)] border border-[var(--input-border)] flex items-start gap-2.5">
          <AlertCircle size={16} className="text-amber-500 shrink-0 mt-0.5" />
          <span>
            The display backend isn&apos;t provisioned on this environment. Apply migration{' '}
            <span className="font-mono text-[var(--text-primary)]">V103</span> (Executive Display) to enable shared TV boards.
          </span>
        </div>
      )}

      {msg && (
        <div className={`text-sm rounded-lg px-3 py-2 flex items-center gap-2 ${msg.type === 'ok' ? 'bg-emerald-950/30 border border-emerald-800/40 text-emerald-300' : 'bg-red-900/25 border border-red-700/40 text-red-300'}`}>
          {msg.type === 'ok' ? <ShieldCheck size={15} /> : <AlertCircle size={15} />} {msg.text}
        </div>
      )}

      {/* One-time reveal of the plaintext token + URL */}
      {created && (
        <div className="rounded-lg px-3 py-3 bg-[var(--input-bg)] border border-[var(--accent)] space-y-3">
          <p className="text-xs font-semibold text-[var(--accent)] flex items-center gap-1.5">
            <KeyRound size={13} /> Shareable link: shown once, copy it now
          </p>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <input readOnly value={created.url}
                className="flex-1 font-mono text-xs px-2.5 py-2 rounded-md bg-[var(--card-bg)] border border-[var(--input-border)] text-[var(--text-primary)] truncate" />
              <button type="button" onClick={() => copy(created.url, 'url')}
                className="p-2 rounded-md bg-[var(--accent)] text-white shrink-0 hover:opacity-90" title="Copy URL">
                {copied === 'url' ? <Check size={14} /> : <Copy size={14} />}
              </button>
              <a href={created.url} target="_blank" rel="noopener noreferrer"
                className="p-2 rounded-md bg-[var(--card-bg)] border border-[var(--input-border)] text-[var(--text-muted)] shrink-0 hover:text-[var(--accent)]" title="Open board">
                <ExternalLink size={14} />
              </a>
            </div>
            <div className="flex items-center gap-2">
              <input readOnly value={created.token}
                className="flex-1 font-mono text-xs px-2.5 py-2 rounded-md bg-[var(--card-bg)] border border-[var(--input-border)] text-[var(--text-muted)] truncate" />
              <button type="button" onClick={() => copy(created.token, 'token')}
                className="p-2 rounded-md bg-[var(--card-bg)] border border-[var(--input-border)] text-[var(--text-muted)] shrink-0 hover:text-[var(--accent)]" title="Copy token">
                {copied === 'token' ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create form */}
      {available && showForm && (
        <form onSubmit={submit} className="rounded-lg px-3 py-3 bg-[var(--input-bg)] border border-[var(--input-border)] space-y-3">
          <div>
            <label className="text-xs font-semibold text-[var(--text-secondary)] block mb-1">Display name</label>
            <input value={form.name} onChange={(e) => setF('name', e.target.value)} placeholder="Reception lobby TV"
              className="w-full text-sm px-2.5 py-2 rounded-md bg-[var(--card-bg)] border border-[var(--input-border)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]" />
          </div>

          <div>
            <label className="text-xs font-semibold text-[var(--text-secondary)] block mb-1.5">Boards to rotate</label>
            <div className="flex flex-wrap gap-1.5">
              {TEMPLATE_PAGES.map((p) => {
                const on = form.pages.includes(p.key)
                return (
                  <button key={p.key} type="button" onClick={() => togglePage(p.key)}
                    className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-colors ${on ? 'bg-[var(--accent)] text-white border-transparent' : 'bg-[var(--card-bg)] border-[var(--input-border)] text-[var(--text-muted)]'}`}>
                    {p.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-[var(--text-secondary)] block mb-1">Refresh (sec)</label>
              <input type="number" min={10} max={3600} value={form.refreshSeconds}
                onChange={(e) => setF('refreshSeconds', e.target.value)}
                className="w-full text-sm px-2.5 py-2 rounded-md bg-[var(--card-bg)] border border-[var(--input-border)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]" />
            </div>
            <div>
              <label className="text-xs font-semibold text-[var(--text-secondary)] block mb-1">Rotate (sec)</label>
              <input type="number" min={5} max={600} value={form.rotateSeconds}
                onChange={(e) => setF('rotateSeconds', e.target.value)}
                className="w-full text-sm px-2.5 py-2 rounded-md bg-[var(--card-bg)] border border-[var(--input-border)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-[var(--text-secondary)] block mb-1 flex items-center gap-1">
                <Lock size={11} /> Viewer password <span className="text-[var(--text-muted)] font-normal">(optional)</span>
              </label>
              <input type="text" value={form.password} onChange={(e) => setF('password', e.target.value)} placeholder="None"
                className="w-full text-sm px-2.5 py-2 rounded-md bg-[var(--card-bg)] border border-[var(--input-border)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]" />
            </div>
            <div>
              <label className="text-xs font-semibold text-[var(--text-secondary)] block mb-1 flex items-center gap-1">
                <Clock size={11} /> Expires <span className="text-[var(--text-muted)] font-normal">(optional)</span>
              </label>
              <input type="datetime-local" value={form.expiresAt} onChange={(e) => setF('expiresAt', e.target.value)}
                className="w-full text-sm px-2.5 py-2 rounded-md bg-[var(--card-bg)] border border-[var(--input-border)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]" />
            </div>
          </div>

          <button type="submit" disabled={creating}
            className="w-full text-sm font-semibold px-3 py-2.5 rounded-lg bg-[var(--accent)] text-white flex items-center justify-center gap-2 disabled:opacity-50 hover:opacity-90 transition-opacity">
            {creating ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
            Create display link
          </button>
        </form>
      )}

      {/* Active tokens list */}
      {available && (
        <div className="space-y-2">
          {activeTokens.length === 0 && !showForm && (
            <div className="rounded-lg px-3 py-4 text-sm text-[var(--text-muted)] bg-[var(--input-bg)] border border-[var(--input-border)] text-center">
              No display links yet. Create one to put a board on a lobby TV.
            </div>
          )}
          {activeTokens.map((t) => (
            <div key={t.id} className="rounded-lg px-3 py-2.5 bg-[var(--input-bg)] border border-[var(--input-border)] flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-[var(--text-primary)] truncate">{t.name}</span>
                  {t.expires_at && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--card-bg)] border border-[var(--input-border)] text-[var(--text-muted)] flex items-center gap-1">
                      <Clock size={9} /> {new Date(t.expires_at).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-[var(--text-muted)] mt-0.5 flex flex-wrap items-center gap-x-2">
                  <span>{(t.template?.pages || []).length || 1} board{((t.template?.pages || []).length || 1) === 1 ? '' : 's'}</span>
                  <span>· refresh {t.refresh_seconds}s</span>
                  <span>· rotate {t.rotate_seconds}s</span>
                  <span>· {(t.view_count ?? 0).toLocaleString()} views</span>
                  {t.last_viewed_at && <span>· last {new Date(t.last_viewed_at).toLocaleDateString()}</span>}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button type="button" title="Copy link"
                  onClick={() => copy(buildDisplayUrl(t.token), `list-${t.id}`)}
                  className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--accent)]">
                  {copied === `list-${t.id}` ? <Check size={14} /> : <Copy size={14} />}
                </button>
                <button type="button" title="Revoke" disabled={revoking === t.id} onClick={() => revoke(t.id)}
                  className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-red-400 disabled:opacity-50">
                  {revoking === t.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
