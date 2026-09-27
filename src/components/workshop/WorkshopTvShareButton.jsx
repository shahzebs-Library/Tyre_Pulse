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
  Tv, Loader2, Copy, Check, ExternalLink, Lock, Clock, ShieldCheck, AlertCircle,
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { createWorkshopShare, buildWorkshopTvUrl } from '../../lib/api/reportShares'
import { toUserMessage } from '../../lib/safeError'
import Modal from '../ui/Modal'

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
        className={`inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 min-h-[44px] text-sm font-semibold text-[var(--text-primary)] hover:opacity-90 ${className}`}
      >
        <Tv size={16} aria-hidden="true" />
        <span>Share TV board</span>
      </button>

      <Modal
        open={open}
        onClose={close}
        size="sm"
        title={<span className="flex items-center gap-2"><Tv size={20} className="text-indigo-500" aria-hidden="true" /> Share workshop TV board</span>}
      >
        {minted ? (
          <div className="space-y-4">
            <div role="status" className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-[var(--text-primary)]">
              <ShieldCheck size={18} className="mt-0.5 shrink-0 text-emerald-500" aria-hidden="true" />
              <span>Read-only link created. Copy it now; it opens the live board with no login. Revoke it any time from Report Sharing.</span>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2">
              <input readOnly value={minted.url} onFocus={(e) => e.target.select()} className="flex-1 min-w-0 bg-transparent px-2 text-sm text-[var(--text-primary)] outline-none" aria-label="Share link" />
              <button type="button" onClick={copyLink} className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-3 min-h-[44px] text-sm font-semibold text-white hover:bg-indigo-500">
                {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
                <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <a href={minted.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 min-h-[44px] text-sm font-semibold text-indigo-500 hover:text-indigo-400">
                <ExternalLink size={15} aria-hidden="true" /> Open board
              </a>
              <button type="button" onClick={close} className="btn-secondary px-3 min-h-[44px] text-sm font-semibold">Done</button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-[var(--text-secondary)]">Board name</span>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full min-h-[44px] rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-indigo-400"
                placeholder="Workshop live board"
              />
            </label>

            <label className="block">
              <span className="mb-1 flex items-center gap-1 text-sm font-medium text-[var(--text-secondary)]"><Clock size={14} aria-hidden="true" /> Refresh every (seconds)</span>
              <input
                type="number" min={REFRESH_SEC_MIN} max={REFRESH_SEC_MAX}
                value={form.refreshSeconds}
                onChange={(e) => setForm((f) => ({ ...f, refreshSeconds: e.target.value }))}
                className="w-full min-h-[44px] rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-indigo-400"
              />
              <span className="mt-1 block text-xs text-[var(--text-muted)]">The board reloads its numbers on this cadence ({REFRESH_SEC_MIN} to {REFRESH_SEC_MAX} seconds).</span>
            </label>

            <label className="block">
              <span className="mb-1 flex items-center gap-1 text-sm font-medium text-[var(--text-secondary)]"><Lock size={14} aria-hidden="true" /> Viewer password (optional)</span>
              <input
                type="text" autoComplete="off"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                className="w-full min-h-[44px] rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-indigo-400"
                placeholder="Leave blank for no password"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-[var(--text-secondary)]">Expires on (optional)</span>
              <input
                type="date"
                value={form.expires}
                onChange={(e) => setForm((f) => ({ ...f, expires: e.target.value }))}
                className="w-full min-h-[44px] rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-indigo-400"
              />
            </label>

            {error && (
              <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-[var(--text-primary)]">
                <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-500" aria-hidden="true" /> <span>{error}</span>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={close} className="btn-secondary px-4 min-h-[44px] text-sm font-semibold">Cancel</button>
              <button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 min-h-[44px] text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60">
                {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Tv size={16} aria-hidden="true" />}
                <span>{busy ? 'Creating...' : 'Create link'}</span>
              </button>
            </div>
          </form>
        )}
      </Modal>
    </>
  )
}
