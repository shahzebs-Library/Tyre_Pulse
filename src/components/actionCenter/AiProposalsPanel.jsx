/**
 * AI proposals panel - mounted in the Action Center.
 *
 * Shows findings the deterministic detector (src/lib/aiProposals.js) prepared,
 * and lets an Admin / Manager / Director accept or reject each one. Accepting
 * records the decision and, only when ticked, opens ONE corrective action that
 * then appears in the Action Center queue. Nothing else is changed: no purchase,
 * no source-record edit, no safety approval, no inspection closure, no warranty
 * submission.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Sparkles, RefreshCw, Check, X, AlertTriangle, History } from 'lucide-react'
import Modal from '../ui/Modal'
import {
  listAiProposals, scanProposals, decideAiProposal, listProposalEvents,
} from '../../lib/api/aiProposals'
import { PROPOSAL_TYPE_LABEL, summarizeProposals } from '../../lib/aiProposals'
import { toUserMessage } from '../../lib/safeError'

const SEV_BADGE = {
  critical: 'bg-red-500/15 text-red-300 border-red-500/40',
  high: 'bg-orange-500/15 text-orange-300 border-orange-500/40',
  medium: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  low: 'bg-sky-500/15 text-sky-300 border-sky-500/40',
}
const SEV_LABEL = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' }
const EVENT_LABEL = { created: 'Proposed', refreshed: 'Evidence refreshed', accepted: 'Accepted', rejected: 'Rejected', expired: 'Expired' }

const fmtWhen = (v) => (v ? String(v).slice(0, 16).replace('T', ' ') : 'N/A')

export default function AiProposalsPanel({ country, onActionCreated }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [error, setError] = useState('')
  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState(null)
  const [typeFilter, setTypeFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [deciding, setDeciding] = useState(null) // { row, decision }
  const [note, setNote] = useState('')
  const [createAction, setCreateAction] = useState(true)
  const [saving, setSaving] = useState(false)
  const [decideError, setDecideError] = useState('')
  const [history, setHistory] = useState(null) // { row, events, error }

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await listAiProposals({ country })
      setRows(res.rows)
      setNotProvisioned(res.notProvisioned)
    } catch (e) {
      setError(toUserMessage(e, 'Could not load AI proposals.'))
    } finally {
      setLoading(false)
    }
  }, [country])

  useEffect(() => { load() }, [load])

  const runScan = async () => {
    setScanning(true)
    setError('')
    setScanResult(null)
    try {
      const res = await scanProposals({ country })
      if (res.notProvisioned) setNotProvisioned(true)
      setScanResult(res)
      await load()
    } catch (e) {
      setError(toUserMessage(e, 'The scan could not be completed.'))
    } finally {
      setScanning(false)
    }
  }

  const openDecide = (row, decision) => {
    setDeciding({ row, decision })
    setNote('')
    setCreateAction(decision === 'accepted')
    setDecideError('')
  }

  const submitDecision = async () => {
    if (!deciding) return
    setSaving(true)
    setDecideError('')
    try {
      const res = await decideAiProposal(deciding.row.id, deciding.decision, { note, createAction })
      setDeciding(null)
      await load()
      if (res?.corrective_action_id && onActionCreated) onActionCreated()
    } catch (e) {
      setDecideError(toUserMessage(e, 'Could not record the decision.'))
    } finally {
      setSaving(false)
    }
  }

  const openHistory = async (row) => {
    setHistory({ row, events: null, error: '' })
    try {
      const events = await listProposalEvents(row.id)
      setHistory({ row, events, error: '' })
    } catch (e) {
      setHistory({ row, events: [], error: toUserMessage(e, 'Could not load the history.') })
    }
  }

  const types = useMemo(() => [...new Set(rows.map((r) => r.proposal_type))].sort(), [rows])
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => (typeFilter === 'all' || r.proposal_type === typeFilter)
      && (!q || `${r.title} ${r.summary} ${r.entity_refs?.asset_no || ''}`.toLowerCase().includes(q)))
  }, [rows, typeFilter, search])
  const summary = useMemo(() => summarizeProposals(rows), [rows])

  return (
    <section className="card" aria-labelledby="ai-proposals-heading">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <h2 id="ai-proposals-heading" className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <Sparkles size={15} aria-hidden="true" /> AI proposals
            {!loading && !notProvisioned && <span className="text-[var(--text-muted)] font-normal">({summary.total} awaiting a decision)</span>}
          </h2>
          <p className="text-xs text-[var(--text-muted)] mt-1 max-w-2xl">
            Prepared from your data by fixed rules. Each one needs a person to accept or reject it. Accepting never buys,
            edits a record, approves safety, closes an inspection or submits a warranty claim; it can only open a
            corrective action when you tick that box.
          </p>
        </div>
        <button type="button" onClick={runScan} disabled={scanning || notProvisioned} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]">
          <RefreshCw size={14} className={scanning ? 'animate-spin' : ''} aria-hidden="true" />
          {scanning ? 'Scanning...' : 'Scan for proposals'}
        </button>
      </div>

      {notProvisioned && (
        <p className="text-sm text-amber-300 flex items-start gap-2" role="status">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          AI proposals are not enabled on this database yet (migration 20261112102000_ai_proposals.sql). Nothing has been lost.
        </p>
      )}

      {error && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-red-300 mb-2" role="alert">
          <span>{error}</span>
          <button type="button" onClick={load} className="btn-secondary text-xs min-h-[44px]">Retry</button>
        </div>
      )}

      {scanResult && scanResult.ok && (
        <p className="text-xs text-[var(--text-muted)] mb-2" role="status">
          Scan found {scanResult.detected} finding{scanResult.detected === 1 ? '' : 's'}: {scanResult.created || 0} new,
          {' '}{scanResult.refreshed || 0} refreshed, {scanResult.skipped || 0} unchanged or recently rejected.
          {Object.entries(scanResult.sources || {}).filter(([, s]) => !s.ok).length > 0 && (
            <> Not checked: {Object.entries(scanResult.sources).filter(([, s]) => !s.ok).map(([k]) => k.replace(/_/g, ' ')).join(', ')}.</>
          )}
        </p>
      )}

      {!notProvisioned && (
        <>
          <div className="flex flex-wrap gap-2 mb-3">
            <input
              type="search" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search proposals" aria-label="Search proposals"
              className="input text-sm min-h-[44px] flex-1 min-w-[180px]"
            />
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Filter by proposal type" className="input text-sm min-h-[44px]">
              <option value="all">All types</option>
              {types.map((t) => <option key={t} value={t}>{PROPOSAL_TYPE_LABEL[t] || t}</option>)}
            </select>
          </div>

          {loading ? (
            <div className="h-24 bg-[var(--input-bg)] rounded animate-pulse" />
          ) : shown.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">
              {rows.length ? 'No proposals match these filters.' : 'No proposals waiting. Run a scan to check the latest data.'}
            </p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {shown.map((r) => (
                <li key={r.id} className="py-3 flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded border ${SEV_BADGE[r.severity] || SEV_BADGE.low}`}>{SEV_LABEL[r.severity] || r.severity}</span>
                      <span className="text-xs text-[var(--text-muted)]">{PROPOSAL_TYPE_LABEL[r.proposal_type] || r.proposal_type}</span>
                      {r.country && <span className="text-xs text-[var(--text-muted)]">{r.country}{r.site ? ` / ${r.site}` : ''}</span>}
                    </div>
                    <p className="text-sm font-medium text-[var(--text-primary)] mt-1">{r.title}</p>
                    {r.summary && <p className="text-sm text-[var(--text-secondary)] mt-0.5">{r.summary}</p>}
                    {r.recommended_action && <p className="text-xs text-[var(--text-muted)] mt-1">Suggested: {r.recommended_action}</p>}
                    <p className="text-xs text-[var(--text-dim)] mt-1">
                      Evidence: {r.evidence_total || (Array.isArray(r.evidence) ? r.evidence.length : 0)} record(s) | first seen {fmtWhen(r.created_at)} | last seen {fmtWhen(r.last_seen_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => openHistory(r)} className="btn-secondary text-xs min-h-[44px] inline-flex items-center gap-1" aria-label={`History for ${r.title}`}>
                      <History size={13} aria-hidden="true" /> History
                    </button>
                    <button type="button" onClick={() => openDecide(r, 'rejected')} className="btn-secondary text-xs min-h-[44px] inline-flex items-center gap-1">
                      <X size={13} aria-hidden="true" /> Reject
                    </button>
                    <button type="button" onClick={() => openDecide(r, 'accepted')} className="btn-primary text-xs min-h-[44px] inline-flex items-center gap-1">
                      <Check size={13} aria-hidden="true" /> Accept
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <Modal
        open={!!deciding}
        onClose={() => !saving && setDeciding(null)}
        closeOnBackdrop={!saving}
        title={deciding?.decision === 'accepted' ? 'Accept proposal' : 'Reject proposal'}
        subtitle={deciding?.row?.title}
        size="md"
        footer={(
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary min-h-[44px]" onClick={() => setDeciding(null)} disabled={saving}>Cancel</button>
            <button type="button" className="btn-primary min-h-[44px]" onClick={submitDecision} disabled={saving || (deciding?.decision === 'rejected' && !note.trim())}>
              {saving ? 'Saving...' : deciding?.decision === 'accepted' ? 'Accept' : 'Reject'}
            </button>
          </div>
        )}
      >
        <div className="space-y-3">
          {deciding?.decision === 'accepted' && (
            <label className="flex items-start gap-2 text-sm text-[var(--text-secondary)]">
              <input type="checkbox" checked={createAction} onChange={(e) => setCreateAction(e.target.checked)} className="mt-1" />
              <span>Open a corrective action for this finding. It will appear in the Action Center queue. No other record is changed.</span>
            </label>
          )}
          <label className="block text-sm text-[var(--text-secondary)]">
            {deciding?.decision === 'rejected' ? 'Reason (required)' : 'Note (optional)'}
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000} className="input w-full mt-1 text-sm" />
          </label>
          {decideError && <p className="text-sm text-red-300" role="alert">{decideError}</p>}
        </div>
      </Modal>

      <Modal open={!!history} onClose={() => setHistory(null)} title="Proposal history" subtitle={history?.row?.title} size="md">
        {history?.events == null ? (
          <div className="h-16 bg-[var(--input-bg)] rounded animate-pulse" />
        ) : history.error ? (
          <p className="text-sm text-red-300" role="alert">{history.error}</p>
        ) : history.events.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No history recorded.</p>
        ) : (
          <ol className="space-y-2">
            {history.events.map((e) => (
              <li key={e.id} className="text-sm">
                <span className="text-[var(--text-primary)]">{EVENT_LABEL[e.event] || e.event}</span>
                <span className="text-[var(--text-muted)]"> | {fmtWhen(e.at)}</span>
                {e.note && <p className="text-xs text-[var(--text-secondary)]">{e.note}</p>}
              </li>
            ))}
          </ol>
        )}
      </Modal>
    </section>
  )
}
