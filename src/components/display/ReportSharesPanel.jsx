/**
 * ReportSharesPanel - elevated-user manager for shareable PUBLIC report links.
 *
 * Mirrors DisplayTokensPanel: Admin / Manager / Director / super-admin mint,
 * list, copy, and revoke read-only report share tokens that render live board
 * reports at /report/<token> on a TV or a shared link (no login required).
 *
 * The plaintext token lives in the URL by design, so the one-time success card
 * and every list row can reconstruct the shareable link via buildShareUrl.
 *
 * Mount inside the app (Settings) so it renders in the normal dark app theme.
 * Backend service: src/lib/api/reportShares.js (RPCs create/revoke/list).
 */
import { useState, useEffect, useCallback } from 'react'
import {
  Share2, Plus, Loader2, ShieldCheck, AlertCircle, Copy, Check, Trash2, X,
  Lock, Clock, ExternalLink, Tv,
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import {
  REPORT_PAGES, DEFAULT_PAGES,
  listReportShares, createReportShare, revokeReportShare, buildShareUrl,
} from '../../lib/api/reportShares'
import { toUserMessage } from '../../lib/safeError'

const ELEVATED_ROLES = new Set(['Admin', 'Manager', 'Director'])

const PAGE_LABEL = REPORT_PAGES.reduce((m, p) => { m[p.key] = p.label; return m }, {})

const ROTATE_MIN = 5
const ROTATE_MAX = 600
const REFRESH_SEC_MIN = 30
const REFRESH_SEC_MAX = 3600

const EMPTY_FORM = {
  name: 'Shared report',
  pages: [...DEFAULT_PAGES],
  rotateSeconds: 30,
  refreshMinutes: 5,
  password: '',
  expires: '',
}

function clamp(n, lo, hi, fallback) {
  const v = Number(n)
  if (!Number.isFinite(v)) return fallback
  return Math.min(hi, Math.max(lo, v))
}

/** Format a timestamp as a short local string, or a friendly fallback. */
function fmtDate(v, fallback) {
  if (!v) return fallback
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return fallback
  return d.toLocaleDateString()
}

/** Convert a chosen calendar date to an end-of-day ISO string (or null). */
function endOfDayIso(dateStr) {
  if (!dateStr) return null
  const d = new Date(`${dateStr}T23:59:59`)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

export default function ReportSharesPanel() {
  const { profile } = useAuth()
  const elevated = ELEVATED_ROLES.has(profile?.role) || profile?.is_super_admin === true

  const [shares, setShares] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [msg, setMsg] = useState(null)          // { type: 'ok'|'err', text }
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState(null)  // { url } shown ONCE
  const [copied, setCopied] = useState(null)    // key of the copied control
  const [revoking, setRevoking] = useState(null)
  const [confirmId, setConfirmId] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const rows = await listReportShares()
      setShares(Array.isArray(rows) ? rows : [])
    } catch (err) {
      setLoadError(toUserMessage(err, 'Could not load report links.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (elevated) load() }, [elevated, load])

  const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const togglePage = (key) => setForm((f) => {
    const has = f.pages.includes(key)
    let next = has ? f.pages.filter((p) => p !== key) : [...f.pages, key]
    // Preserve canonical order for a stable rotation.
    next = DEFAULT_PAGES.filter((k2) => next.includes(k2))
    return { ...f, pages: next }
  })

  function copy(text, key) {
    if (!navigator.clipboard?.writeText) return
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key)
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1800)
    }).catch(() => {})
  }

  async function submit(e) {
    e.preventDefault()
    if (creating) return
    const name = form.name.trim()
    if (!name) { setMsg({ type: 'err', text: 'A report link name is required.' }); return }
    if (form.pages.length === 0) { setMsg({ type: 'err', text: 'Select at least one report page.' }); return }

    setCreating(true); setMsg(null); setCreated(null)
    try {
      const rotate = clamp(form.rotateSeconds, ROTATE_MIN, ROTATE_MAX, 30)
      const refresh = clamp(Number(form.refreshMinutes) * 60, REFRESH_SEC_MIN, REFRESH_SEC_MAX, 300)
      const res = await createReportShare({
        name,
        pages: form.pages,
        rotate,
        refresh,
        password: form.password.trim() || null,
        expires: endOfDayIso(form.expires),
      })
      if (res?.token) {
        setCreated({ url: buildShareUrl(res.token) })
        setMsg({ type: 'ok', text: 'Report link created. Copy it now: anyone with the link can view this report.' })
        setShowForm(false)
        setForm(EMPTY_FORM)
        load()
      } else {
        setMsg({ type: 'err', text: 'Report link was not created. Please try again.' })
      }
    } catch (err) {
      setMsg({ type: 'err', text: toUserMessage(err, 'Could not create the report link.') })
    } finally {
      setCreating(false)
    }
  }

  async function revoke(id) {
    setRevoking(id); setMsg(null)
    try {
      await revokeReportShare(id)
      setMsg({ type: 'ok', text: 'Report link revoked.' })
      setConfirmId(null)
      load()
    } catch (err) {
      setMsg({ type: 'err', text: toUserMessage(err, 'Could not revoke the report link.') })
    } finally {
      setRevoking(null)
    }
  }

  // Access gate (parent should also gate, but guard defensively).
  if (!elevated) return null

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <Share2 size={15} className="text-[var(--accent)]" /> Shared report links
        </h2>
        <button type="button"
          onClick={() => { setShowForm((v) => !v); setMsg(null); setCreated(null) }}
          className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-[var(--accent)] text-white flex items-center gap-1.5 hover:opacity-90 transition-opacity">
          {showForm ? <X size={13} /> : <Plus size={13} />}
          {showForm ? 'Cancel' : 'Create link'}
        </button>
      </div>

      <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
        Share a secure, read-only report for a TV or a public link, no login required. The link shows only
        aggregate report pages (never raw records) and rotates through the pages you choose. Reports render at{' '}
        <span className="font-mono text-[var(--text-primary)]">/report/&lt;token&gt;</span>.
      </p>

      {msg && (
        <div className={`text-sm rounded-lg px-3 py-2 flex items-center gap-2 ${msg.type === 'ok' ? 'bg-emerald-950/30 border border-emerald-800/40 text-emerald-300' : 'bg-red-900/25 border border-red-700/40 text-red-300'}`}>
          {msg.type === 'ok' ? <ShieldCheck size={15} /> : <AlertCircle size={15} />} {msg.text}
        </div>
      )}

      {/* One-time reveal of the full share URL */}
      {created && (
        <div className="rounded-lg px-3 py-3 bg-[var(--input-bg)] border border-[var(--accent)] space-y-3">
          <p className="text-xs font-semibold text-[var(--accent)] flex items-center gap-1.5">
            <Share2 size={13} /> Copy this link now. Anyone with the link can view this report.
          </p>
          <div className="flex items-center gap-2">
            <input readOnly value={created.url}
              className="flex-1 font-mono text-xs px-2.5 py-2 rounded-md bg-[var(--card-bg)] border border-[var(--input-border)] text-[var(--text-primary)] truncate" />
            <button type="button" onClick={() => copy(created.url, 'created')}
              className="p-2 rounded-md bg-[var(--accent)] text-white shrink-0 hover:opacity-90" title="Copy link">
              {copied === 'created' ? <Check size={14} /> : <Copy size={14} />}
            </button>
            <a href={created.url} target="_blank" rel="noopener noreferrer"
              className="p-2 rounded-md bg-[var(--card-bg)] border border-[var(--input-border)] text-[var(--text-muted)] shrink-0 hover:text-[var(--accent)]" title="Open report">
              <ExternalLink size={14} />
            </a>
          </div>
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <form onSubmit={submit} className="rounded-lg px-3 py-3 bg-[var(--input-bg)] border border-[var(--input-border)] space-y-3">
          <div>
            <label className="text-xs font-semibold text-[var(--text-secondary)] block mb-1">Name</label>
            <input value={form.name} onChange={(e) => setF('name', e.target.value)} placeholder="Shared report" required
              className="w-full text-sm px-2.5 py-2 rounded-md bg-[var(--card-bg)] border border-[var(--input-border)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]" />
          </div>

          <div>
            <label className="text-xs font-semibold text-[var(--text-secondary)] block mb-1.5">Report pages to rotate</label>
            <div className="space-y-1.5">
              {REPORT_PAGES.map((p) => {
                const on = form.pages.includes(p.key)
                return (
                  <label key={p.key}
                    className={`flex items-start gap-2.5 px-2.5 py-2 rounded-md border cursor-pointer transition-colors ${on ? 'bg-[var(--card-bg)] border-[var(--accent)]' : 'bg-[var(--card-bg)] border-[var(--input-border)]'}`}>
                    <input type="checkbox" checked={on} onChange={() => togglePage(p.key)}
                      className="mt-0.5 accent-[var(--accent)]" />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-[var(--text-primary)]">{p.label}</span>
                      <span className="block text-[11px] text-[var(--text-muted)]">{p.desc}</span>
                    </span>
                  </label>
                )
              })}
            </div>
            {form.pages.length === 0 && (
              <p className="text-[11px] text-red-300 mt-1">Select at least one report page.</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-[var(--text-secondary)] block mb-1 flex items-center gap-1">
                <Tv size={11} /> Rotate (sec)
              </label>
              <input type="number" min={ROTATE_MIN} max={ROTATE_MAX} value={form.rotateSeconds}
                onChange={(e) => setF('rotateSeconds', e.target.value)}
                className="w-full text-sm px-2.5 py-2 rounded-md bg-[var(--card-bg)] border border-[var(--input-border)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]" />
              <p className="text-[10px] text-[var(--text-muted)] mt-1">Seconds each report page shows before rotating.</p>
            </div>
            <div>
              <label className="text-xs font-semibold text-[var(--text-secondary)] block mb-1 flex items-center gap-1">
                <Clock size={11} /> Refresh (min)
              </label>
              <input type="number" min={1} max={60} value={form.refreshMinutes}
                onChange={(e) => setF('refreshMinutes', e.target.value)}
                className="w-full text-sm px-2.5 py-2 rounded-md bg-[var(--card-bg)] border border-[var(--input-border)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]" />
              <p className="text-[10px] text-[var(--text-muted)] mt-1">How often the live numbers refresh.</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-[var(--text-secondary)] block mb-1 flex items-center gap-1">
                <Lock size={11} /> Password <span className="text-[var(--text-muted)] font-normal">(optional)</span>
              </label>
              <input type="text" value={form.password} onChange={(e) => setF('password', e.target.value)} placeholder="None"
                className="w-full text-sm px-2.5 py-2 rounded-md bg-[var(--card-bg)] border border-[var(--input-border)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]" />
              <p className="text-[10px] text-[var(--text-muted)] mt-1">Leave blank for no password.</p>
            </div>
            <div>
              <label className="text-xs font-semibold text-[var(--text-secondary)] block mb-1 flex items-center gap-1">
                <Clock size={11} /> Expires <span className="text-[var(--text-muted)] font-normal">(optional)</span>
              </label>
              <input type="date" value={form.expires} onChange={(e) => setF('expires', e.target.value)}
                className="w-full text-sm px-2.5 py-2 rounded-md bg-[var(--card-bg)] border border-[var(--input-border)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]" />
              <p className="text-[10px] text-[var(--text-muted)] mt-1">Link stops working after this day.</p>
            </div>
          </div>

          <button type="submit" disabled={creating || form.pages.length === 0}
            className="w-full text-sm font-semibold px-3 py-2.5 rounded-lg bg-[var(--accent)] text-white flex items-center justify-center gap-2 disabled:opacity-50 hover:opacity-90 transition-opacity">
            {creating ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
            Create report link
          </button>
        </form>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <div key={i} className="rounded-lg px-3 py-3 bg-[var(--input-bg)] border border-[var(--input-border)] animate-pulse">
              <div className="h-3.5 w-40 rounded bg-[var(--card-bg)]" />
              <div className="h-2.5 w-56 rounded bg-[var(--card-bg)] mt-2" />
            </div>
          ))}
        </div>
      )}

      {/* Load error + Retry */}
      {!loading && loadError && (
        <div className="rounded-lg px-3 py-4 text-sm bg-red-900/25 border border-red-700/40 text-red-300 flex items-center justify-between gap-3">
          <span className="flex items-center gap-2"><AlertCircle size={15} /> {loadError}</span>
          <button type="button" onClick={load}
            className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-[var(--card-bg)] border border-[var(--input-border)] text-[var(--text-primary)] hover:border-[var(--accent)]">
            Retry
          </button>
        </div>
      )}

      {/* List */}
      {!loading && !loadError && (
        <div className="space-y-2">
          {shares.length === 0 && !showForm && (
            <div className="rounded-lg px-3 py-4 text-sm text-[var(--text-muted)] bg-[var(--input-bg)] border border-[var(--input-border)] text-center">
              No shared report links yet. Create one to show live reports on a TV or share read-only.
            </div>
          )}

          {shares.map((row) => {
            const url = buildShareUrl(row.token)
            const pages = Array.isArray(row.pages) ? row.pages : []
            return (
              <div key={row.id} className="rounded-lg px-3 py-2.5 bg-[var(--input-bg)] border border-[var(--input-border)] space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-[var(--text-primary)] truncate">{row.name || 'Shared report'}</span>
                      {pages.map((k) => (
                        <span key={k} className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--card-bg)] border border-[var(--input-border)] text-[var(--text-secondary)]">
                          {PAGE_LABEL[k] || k}
                        </span>
                      ))}
                    </div>
                    <p className="text-[11px] text-[var(--text-muted)] mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span>rotate {row.rotate_seconds ?? 30}s</span>
                      <span>| {(row.view_count ?? 0).toLocaleString()} views</span>
                      <span>| last viewed {fmtDate(row.last_viewed_at, 'Never')}</span>
                      <span>| created {fmtDate(row.created_at, 'N/A')}</span>
                      <span>| {row.expires_at ? `expires ${fmtDate(row.expires_at, 'N/A')}` : 'No expiry'}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button type="button" title="Copy link" onClick={() => copy(url, `row-${row.id}`)}
                      className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--accent)]">
                      {copied === `row-${row.id}` ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                    <a href={url} target="_blank" rel="noopener noreferrer" title="Open in new tab"
                      className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--accent)]">
                      <ExternalLink size={14} />
                    </a>
                    <button type="button" title="Revoke" disabled={revoking === row.id}
                      onClick={() => setConfirmId((c) => (c === row.id ? null : row.id))}
                      className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-red-400 disabled:opacity-50">
                      {revoking === row.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    </button>
                  </div>
                </div>

                {confirmId === row.id && (
                  <div className="flex items-center justify-between gap-3 rounded-md px-2.5 py-2 bg-red-900/20 border border-red-700/40">
                    <span className="text-xs text-red-300">Revoke this link? The URL will stop working immediately.</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button type="button" onClick={() => revoke(row.id)} disabled={revoking === row.id}
                        className="text-xs font-semibold px-2.5 py-1 rounded-md bg-red-600 text-white hover:opacity-90 disabled:opacity-50">
                        Revoke
                      </button>
                      <button type="button" onClick={() => setConfirmId(null)}
                        className="text-xs font-semibold px-2.5 py-1 rounded-md bg-[var(--card-bg)] border border-[var(--input-border)] text-[var(--text-secondary)]">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
