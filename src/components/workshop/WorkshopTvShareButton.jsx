/**
 * WorkshopTvShareButton - a compact "Share TV board" control for the Workshop
 * Live dashboard header. Opens a modal that mints a read-only, token-secured
 * workshop TV link (reusing the report_shares token infrastructure via
 * createWorkshopShare) and reveals the one-time link (buildWorkshopTvUrl).
 *
 * Self-gated to Admin / Manager / Director / super-admin (renders nothing for
 * other roles). The minted board is anonymous and PII-free; the plaintext token
 * lives in the URL by design, so the success card reconstructs the link locally.
 *
 * Mount this in the WorkshopLive dashboard header (the parent wires it in).
 */
import { useState, useCallback } from 'react'
import {
  Tv, Loader2, X, Copy, Check, ExternalLink, Lock, Clock, ShieldCheck, AlertCircle,
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { createWorkshopShare, buildWorkshopTvUrl } from '../../lib/api/reportShares'
import { toUserMessage } from '../../lib/safeError'

const ELEVATED_ROLES = new Set(['Admin', 'Manager', 'Director'])

const ROTATE_MIN = 5
const ROTATE_MAX = 600
const REFRESH_SEC_MIN = 30
const REFRESH_SEC_MAX = 3600

function clamp(n, lo, hi, fallback) {
  const v = Number(n)
  if (!Number.isFinite(v)) return fallback
  return Math.min(hi, Math.max(lo, v))
}

function endOfDayIso(dateStr) {
  if (!dateStr) return null
  const d = new Date(`${dateStr}T23:59:59`)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

const EMPTY_FORM = { name: 'Workshop live board', refreshSeconds: 60, password: '', expires: '' }

export default function WorkshopTvShareButton({ className = '' }) {
  const { profile } = useAuth()
  const elevated = ELEVATED_ROLES.has(profile?.role) || profile?.is_super_admin === true

  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [minted, setMinted] = useState(null) // { url }
  const [copied, setCopied] = useState(false)

  const reset = useCallback(() => {
    setForm(EMPTY_FORM); setError(''); setMinted(null); setCopied(false); setBusy(false)
  }, [])

  const close = useCallback(() => { setOpen(false); reset() }, [reset])

  const submit = useCallback(async (e) => {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      const res = await createWorkshopShare({
        name: form.name?.trim() || 'Workshop live board',
        refresh: clamp(form.refreshSeconds, REFRESH_SEC_MIN, REFRESH_SEC_MAX, 60),
        password: form.password || null,
        expires: endOfDayIso(form.expires),
      })
      const token = res?.token
      if (!token) throw new Error('No token returned')
      setMinted({ url: buildWorkshopTvUrl(token) })
    } catch (err) {
      setError(toUserMessage(err, 'Could not create the share link.'))
    } finally {
      setBusy(false)
    }
  }, [form])

  const copyLink = useCallback(async () => {
    if (!minted?.url) return
    try {
      await navigator.clipboard.writeText(minted.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch { /* clipboard blocked; the link is visible to copy manually */ }
  }, [minted])

  if (!elevated) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-slate-100 hover:bg-white/10 ${className}`}
      >
        <Tv size={16} />
        <span>Share TV board</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog" aria-modal="true" aria-label="Share workshop TV board"
          onClick={(e) => { if (e.target === e.currentTarget) close() }}
        >
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-bold text-white">
                <Tv size={20} className="text-indigo-400" /> Share workshop TV board
              </h2>
              <button type="button" onClick={close} className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white" aria-label="Close">
                <X size={18} />
              </button>
            </div>

            {minted ? (
              <div className="space-y-4">
                <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
                  <ShieldCheck size={18} className="mt-0.5 shrink-0" />
                  <span>Read-only link created. Copy it now; it opens the live board with no login. Revoke it any time from Report Sharing.</span>
                </div>
                <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/30 p-2">
                  <input readOnly value={minted.url} className="flex-1 bg-transparent px-2 text-sm text-slate-100 outline-none" aria-label="Share link" />
                  <button type="button" onClick={copyLink} className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500">
                    {copied ? <Check size={15} /> : <Copy size={15} />}
                    <span>{copied ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
                <div className="flex justify-between">
                  <a href={minted.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-indigo-300 hover:text-indigo-200">
                    <ExternalLink size={15} /> Open board
                  </a>
                  <button type="button" onClick={close} className="rounded-lg bg-white/10 px-3 py-1.5 text-sm font-semibold text-slate-100 hover:bg-white/20">Done</button>
                </div>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-4">
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-300">Board name</span>
                  <input
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-400"
                    placeholder="Workshop live board"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 flex items-center gap-1 text-sm font-medium text-slate-300"><Clock size={14} /> Refresh every (seconds)</span>
                  <input
                    type="number" min={REFRESH_SEC_MIN} max={REFRESH_SEC_MAX}
                    value={form.refreshSeconds}
                    onChange={(e) => setForm((f) => ({ ...f, refreshSeconds: e.target.value }))}
                    className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-400"
                  />
                  <span className="mt-1 block text-xs text-slate-500">The board reloads its numbers on this cadence ({REFRESH_SEC_MIN} to {REFRESH_SEC_MAX} seconds).</span>
                </label>

                <label className="block">
                  <span className="mb-1 flex items-center gap-1 text-sm font-medium text-slate-300"><Lock size={14} /> Viewer password (optional)</span>
                  <input
                    type="text" autoComplete="off"
                    value={form.password}
                    onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                    className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-400"
                    placeholder="Leave blank for no password"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-300">Expires on (optional)</span>
                  <input
                    type="date"
                    value={form.expires}
                    onChange={(e) => setForm((f) => ({ ...f, expires: e.target.value }))}
                    className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-400"
                  />
                </label>

                {error && (
                  <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
                    <AlertCircle size={16} className="mt-0.5 shrink-0" /> <span>{error}</span>
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-1">
                  <button type="button" onClick={close} className="rounded-lg bg-white/10 px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-white/20">Cancel</button>
                  <button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60">
                    {busy ? <Loader2 size={16} className="animate-spin" /> : <Tv size={16} />}
                    <span>Create link</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  )
}
