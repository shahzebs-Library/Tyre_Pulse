/**
 * The stored-PDF state of one document: Ready / Preparing / Update available / Failed,
 * View PDF, Regenerate (managers; an approved revision needs an administrator and a
 * reason) and the previous stored versions.
 *
 * Renders nothing until the PDF cache is set up in the database, so it is safe to ship
 * before the migration.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Eye, RefreshCw, FileCheck2 } from 'lucide-react'
import * as api from '../../lib/api/pdfCache'
import { displayStatus, reasonMessage } from '../../lib/pdfCache/state'
import { templateVersionFor } from '../../lib/pdfCache/templates'
import { viewStoredPdf } from '../../lib/pdfCache/service'
import { toUserMessage } from '../../lib/safeError'

const TONE = { good: '#15803d', info: '#2563eb', warn: '#b45309', bad: '#dc2626', muted: 'var(--text-muted)' }
const fmt = (v) => { const d = v ? new Date(v) : null; return d && !Number.isNaN(d.getTime()) ? d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'N/A' }
const kb = (n) => (n ? `${Math.max(1, Math.round(n / 1024))} KB` : '')

/**
 * @param {() => Promise<object>} props.buildRequest  resolves { type, sourceId, brandingRev, clientRev }
 * @param {any} props.refreshKey                      the ONLY re-read trigger: change it when the document, its
 *                                                    printed content or the stored copy may have changed
 * @param {boolean} [props.canRegenerate]             manager, director or administrator
 * @param {boolean} [props.isAdmin]
 * @param {(opts: {reason: string|null}) => Promise<void>} [props.onRegenerate]
 */
export default function StoredPdfPanel({ buildRequest, refreshKey, canRegenerate = false, isAdmin = false, onRegenerate }) {
  const [state, setState] = useState({ status: 'loading', look: null, versions: [], error: '' })
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState('')
  const [askReason, setAskReason] = useState(false)
  const [msg, setMsg] = useState('')

  // Only refreshKey triggers a re-read: callers usually pass a new buildRequest function on every render.
  const buildRef = useRef(buildRequest)
  buildRef.current = buildRequest
  const load = useCallback(async () => {
    try {
      const r = await buildRef.current()
      if (!r?.sourceId) { setState({ status: 'hidden', look: null, versions: [], error: '' }); return }
      const req = { ...r, template: templateVersionFor(r.type) }
      const [look, versions] = await Promise.all([api.lookupPdf(req), api.listPdfVersions(r.type, r.sourceId)])
      setState({ status: 'ok', look, versions, error: '' })
    } catch (err) {
      if (api.isPdfCacheNotProvisioned(err)) setState({ status: 'hidden', look: null, versions: [], error: '' })
      else setState({ status: 'error', look: null, versions: [], error: toUserMessage(err, 'Could not check the stored report.') })
    }
  }, [])
  useEffect(() => { load() }, [load, refreshKey])

  if (state.status === 'hidden' || state.status === 'loading') return null
  if (state.status === 'error') {
    return (
      <section className="rounded-lg border p-3 text-sm" style={{ borderColor: 'var(--border)' }} aria-label="Stored PDF">
        <p role="alert" style={{ color: TONE.bad }}>{state.error}</p>
        <button type="button" className="btn-secondary mt-2 min-h-[36px] text-xs" onClick={load}>Retry</button>
      </section>
    )
  }
  const { look, versions } = state
  if (!look?.ok) return null
  const ds = displayStatus(look)
  const current = look.state === 'ready' ? look.file : null
  const previous = versions.filter((v) => !current || v.id !== current.id)
  const regenerate = async (withReason) => {
    setBusy(true); setMsg('')
    try { await onRegenerate({ reason: withReason || null }); setAskReason(false); setReason(''); await load() }
    catch (err) { setMsg(err?.reason ? reasonMessage(err.reason) : toUserMessage(err, 'Could not regenerate the report. Retry.')) }
    finally { setBusy(false) }
  }
  const view = async (file) => {
    setMsg('')
    try { await viewStoredPdf({ id: file.id, path: file.path || file.storage_path }) }
    catch (err) { setMsg(toUserMessage(err, 'The stored report could not be opened. Retry.')) }
  }

  return (
    <section className="rounded-lg border p-3 text-sm" style={{ borderColor: 'var(--border)' }} aria-label="Stored PDF">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FileCheck2 size={16} aria-hidden />
          <span className="font-medium">Stored PDF</span>
          <span className="rounded-full border px-2 py-0.5 text-xs" style={{ color: TONE[ds.tone], borderColor: TONE[ds.tone] }}>{ds.label}</span>
          {current?.immutable && <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Approved revision, locked</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {current && (
            <button type="button" className="btn-secondary inline-flex min-h-[36px] items-center gap-1 text-xs" onClick={() => view(current)}>
              <Eye size={14} aria-hidden /> View PDF
            </button>
          )}
          {canRegenerate && onRegenerate && (!current?.immutable || isAdmin) && (
            <button type="button" className="btn-secondary inline-flex min-h-[36px] items-center gap-1 text-xs" disabled={busy}
              onClick={() => (current?.immutable ? setAskReason(true) : regenerate(null))}>
              <RefreshCw size={14} aria-hidden /> {busy ? 'Preparing...' : 'Regenerate latest'}
            </button>
          )}
        </div>
      </div>
      <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
        {ds.key === 'ready' && `Saved ${fmt(current.completed_at)}${current.bytes ? `, ${kb(current.bytes)}` : ''}. Downloads use this copy.`}
        {ds.key === 'update_available' && 'The record changed after the last stored copy. The next download prepares the current version. The older copy is listed below and is not current.'}
        {ds.key === 'not_prepared' && 'No copy is stored yet. The first download prepares and saves it.'}
        {ds.key === 'preparing' && 'A copy is being prepared now.'}
        {ds.key === 'retrying' && 'The last attempt did not finish. It will be prepared again on the next download.'}
        {ds.key === 'failed' && 'The report could not be prepared. Use Download to retry.'}
      </p>
      {askReason && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="flex-1 text-xs">
            Reason for replacing the approved copy
            <input className="input mt-1 w-full text-sm" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
          </label>
          <button type="button" className="btn-secondary min-h-[36px] text-xs" disabled={busy || reason.trim().length < 5} onClick={() => regenerate(reason.trim())}>Replace</button>
          <button type="button" className="btn-secondary min-h-[36px] text-xs" disabled={busy} onClick={() => setAskReason(false)}>Cancel</button>
        </div>
      )}
      {msg && <p role="alert" className="mt-2 text-xs" style={{ color: TONE.bad }}>{msg}</p>}
      {previous.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Previous stored versions ({previous.length}), not current</p>
          <ul className="mt-1 space-y-1">
            {previous.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span>{fmt(v.completed_at)}{v.immutable ? ', approved revision' : ', working copy'}{v.bytes ? `, ${kb(v.bytes)}` : ''}</span>
                <button type="button" className="underline min-h-[32px]" onClick={() => view(v)}>View</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
