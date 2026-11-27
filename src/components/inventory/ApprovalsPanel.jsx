/**
 * Approvals queue (Controls > Approvals), the shared "Request approval" button
 * and the approval status line shown beside every posting button.
 *
 * Adjustment posting, opening-batch approval, recount assignment and cost
 * reconciliation each need an APPROVED request first (inv_request_approval ->
 * inv_approval_decide -> the posting call consumes it). Whether this person may
 * decide a request is the SERVER's answer (v_inv_pending_approvals.can_decide /
 * blocked_reason): the Decide action is shown only when can_decide is true, and
 * otherwise the server's reason is shown as written. A refusal on submit is also
 * shown as written.
 */
import { useEffect, useState } from 'react'
import { Send, ArrowRight, CheckCircle2, XCircle, Lock } from 'lucide-react'
import SideDrawer from '../ui/SideDrawer'
import { useLanguage } from '../../contexts/LanguageContext'
import {
  listPendingApprovals, requestApproval, decideApproval, getApprovalState, newIdempotencyKey,
  APPROVAL_ENTITY_TYPES, APPROVAL_TARGET,
} from '../../lib/api/inventory'
import { normaliseApproval } from '../../lib/inventory/integrationView'
import { toUserMessage } from '../../lib/inventory/errorText'
import { useInvQuery, PagedTable, Note, ErrorNote, StatusPill, SectionCard, Field, fmtDateTime } from './InvUi'

const STATE_TONE = { pending: 'warning', approved: 'good', consumed: 'muted', rejected: 'bad' }

/**
 * Sends one record for approval. One idempotency key per button life, so a
 * retry after a timeout cannot raise a second request. `proposal`, `reason`
 * and `evidence` are passed through (recount: {counter_id}; cost:
 * {resolution, unit_cost}). `validate` may return a message to block sending.
 */
export function RequestApprovalButton({ entityType, entityId, proposal, reason, evidence, onDone, disabled, label }) {
  const { t } = useLanguage()
  const [key, setKey] = useState(() => newIdempotencyKey())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(null)
  // A changed proposal is a different request: new key, button usable again.
  const sig = JSON.stringify(proposal || null)
  useEffect(() => { setKey(newIdempotencyKey()); setDone(null); setErr('') }, [sig, entityId])
  const send = async () => {
    setBusy(true); setErr('')
    try {
      const res = await requestApproval({ entityType, entityId, proposal, reason, evidence }, key)
      setDone(res?.replayed ? 'replayed' : 'sent')
      onDone?.(res)
    } catch (e) { setErr(toUserMessage(e)) } finally { setBusy(false) }
  }
  return (
    <div className="inv-hub" style={{ gap: 6 }}>
      <div className="inv-actions">
        <button type="button" className="cc-btn-ghost" disabled={busy || disabled || !entityId || !!done} onClick={send}>
          <Send size={14} aria-hidden="true" /> {busy ? t('inventory.actions.saving') : (label || t('inventory.approvals.request'))}
        </button>
      </div>
      {done && <Note tone="good">{t(done === 'replayed' ? 'inventory.approvals.alreadyRequested' : 'inventory.approvals.requested')}</Note>}
      {err && <ErrorNote error={err} />}
    </div>
  )
}

/** "Approval: pending | approved | rejected | none" for one record (best effort). */
export function ApprovalState({ entityType, entityId, refreshKey }) {
  const { t } = useLanguage()
  const [state, setState] = useState(undefined)
  useEffect(() => {
    let live = true
    setState(undefined)
    getApprovalState(entityType, entityId).then((s) => { if (live) setState(s) })
    return () => { live = false }
  }, [entityType, entityId, refreshKey])
  if (state === undefined) return null
  const status = state?.status || 'none'
  return (
    <p className="cc-card-sub">
      {t('inventory.approvals.stateLabel')}{' '}
      <StatusPill value={status} tone={STATE_TONE[status] || 'muted'} label={t(`inventory.approvals.state.${status}`)} />
    </p>
  )
}

function DecideDrawer({ row, onClose, onDone }) {
  const { t } = useLanguage()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [keys] = useState(() => ({ approve: newIdempotencyKey(), reject: newIdempotencyKey() }))
  const decide = async (decision) => {
    setBusy(true); setErr('')
    try {
      await decideApproval({ requestId: row.id, decision, note }, keys[decision])
      onDone()
    } catch (e) { setErr(toUserMessage(e)) } finally { setBusy(false) }
  }
  return (
    <SideDrawer className="cc inv-panel" open onClose={() => !busy && onClose()} busy={busy} size="md"
      title={t('inventory.approvals.decideTitle')} subtitle={`${t(`inventory.approvals.types.${row.entityType}`)} | ${row.entityRef || String(row.entityId).slice(0, 8)}`}
      closeLabel={t('inventory.actions.close')}>
      <div className="inv-hub" style={{ gap: 12 }}>
        <dl className="inv-dl">
          <dt>{t('inventory.approvals.stage')}</dt>
          <dd>{row.stageName || t('wmsfloor.common.na')}{row.stageCount ? ` (${(row.stageIndex ?? 0) + 1} / ${row.stageCount})` : ''}</dd>
          <dt>{t('inventory.approvals.requestedAt')}</dt><dd>{fmtDateTime(row.requestedAt)}</dd>
          {row.reason && (<><dt>{t('inventory.approvals.summary')}</dt><dd>{row.reason}</dd></>)}
          {row.proposal && Object.keys(row.proposal).length > 0 && (
            <><dt>{t('inventory.approvals.proposal')}</dt><dd className="inv-mono">{Object.entries(row.proposal).map(([k, v]) => `${k}: ${v ?? t('wmsfloor.common.na')}`).join(' | ')}</dd></>
          )}
        </dl>
        <Note>{t('inventory.approvals.decideRule')}</Note>
        <Field label={t('inventory.disc.decisionNote')} full>
          <textarea className="inv-input" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div className="inv-actions">
          <button type="button" className="cc-btn-primary" disabled={busy} onClick={() => decide('approve')}>
            <CheckCircle2 size={14} aria-hidden="true" /> {t('inventory.disc.approve')}
          </button>
          <button type="button" className="cc-btn-ghost" disabled={busy || !note.trim()} onClick={() => decide('reject')}>
            <XCircle size={14} aria-hidden="true" /> {t('inventory.disc.reject')}
          </button>
        </div>
        {!note.trim() && <p className="cc-card-sub">{t('inventory.approvals.rejectNeedsNote')}</p>}
        {err && <ErrorNote error={err} />}
      </div>
    </SideDrawer>
  )
}

export default function ApprovalsPanel({ scope, onNavigate }) {
  const { t } = useLanguage()
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)
  const [type, setType] = useState('all')
  const [open, setOpen] = useState(null)
  const q = useInvQuery(() => listPendingApprovals({ ...scope, page, pageSize, entityType: type }),
    [scope.country, scope.site, page, pageSize, type])
  const shaped = q.data ? { ...q.data, rows: (q.data.rows || []).map(normaliseApproval) } : q.data
  const query = { ...q, data: shaped }

  const columns = [
    { key: 'entityType', header: t('inventory.approvals.type'), cell: (r) => (r.entityType ? t(`inventory.approvals.types.${r.entityType}`) : <span className="cc-na">{t('wmsfloor.common.na')}</span>) },
    { key: 'entityRef', header: t('inventory.approvals.record'), cell: (r) => <span className="inv-mono">{r.entityRef || (r.entityId ? String(r.entityId).slice(0, 8) : t('wmsfloor.common.na'))}</span> },
    { key: 'stageName', header: t('inventory.approvals.stage'), cell: (r) => r.stageName || <span className="cc-na">{t('wmsfloor.common.na')}</span> },
    { key: 'requestedAt', header: t('inventory.approvals.requestedAt'), cell: (r) => fmtDateTime(r.requestedAt) },
    { key: 'decide', header: t('inventory.approvals.decision'), cell: (r) => (r.canDecide ? (
      <button type="button" className="cc-btn-primary" onClick={(e) => { e.stopPropagation(); setOpen(r) }}>
        {t('inventory.approvals.decide')}
      </button>
    ) : (
      <span className="cc-card-sub" title={r.blockedReason || ''}>
        <Lock size={12} aria-hidden="true" /> {r.blockedReason || t('inventory.approvals.cannotDecide')}
      </span>
    )) },
    { key: 'go', header: '', cell: (r) => (APPROVAL_TARGET[r.entityType] ? (
      <button type="button" className="cc-btn-ghost" onClick={(e) => { e.stopPropagation(); onNavigate?.(APPROVAL_TARGET[r.entityType].section, APPROVAL_TARGET[r.entityType].tab) }}>
        {t('inventory.approvals.open')} <ArrowRight size={14} aria-hidden="true" className="rtl-flip" />
      </button>
    ) : null) },
  ]

  return (
    <div className="inv-hub">
      <Note>{t('inventory.approvals.rule')}</Note>
      <SectionCard title={t('inventory.approvals.queue')} sub={t('inventory.approvals.queueSub')}>
        <label className="cc-field" style={{ maxWidth: 260, marginBottom: 10 }}>
          <span>{t('inventory.approvals.type')}</span>
          <select className="cc-select" value={type} onChange={(e) => { setType(e.target.value); setPage(0) }}>
            <option value="all">{t('inventory.common.all')}</option>
            {APPROVAL_ENTITY_TYPES.map((x) => <option key={x} value={x}>{t(`inventory.approvals.types.${x}`)}</option>)}
          </select>
        </label>
        <PagedTable query={query} columns={columns} page={page} pageSize={pageSize} onPage={setPage}
          onPageSize={(s) => { setPageSize(s); setPage(0) }} empty={t('inventory.approvals.empty')}
          what={t('inventory.approvals.queue')} noun={t('inventory.approvals.noun')} />
      </SectionCard>
      {open && <DecideDrawer row={open} onClose={() => setOpen(null)} onDone={() => { setOpen(null); q.retry() }} />}
    </div>
  )
}
