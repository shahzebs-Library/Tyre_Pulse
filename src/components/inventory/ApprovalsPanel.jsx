/**
 * Approvals queue (Controls > Approvals) and the shared "Request approval"
 * button.
 *
 * Adjustments, recounts, opening batches and cost reconciliations need an
 * APPROVED approval before the server acts on them (inv_request_approval;
 * queue = v_inv_pending_approvals). The decision itself is taken where the
 * evidence is (Discrepancies, Audits, Opening balances, Valuation), so each row
 * links there. Separation of duties is enforced by the server: when it refuses
 * ("the approver cannot be the requester"), that sentence is shown as written.
 */
import { useState } from 'react'
import { Send, ArrowRight } from 'lucide-react'
import { useLanguage } from '../../contexts/LanguageContext'
import {
  listPendingApprovals, requestApproval, newIdempotencyKey, APPROVAL_ENTITY_TYPES, APPROVAL_TARGET,
} from '../../lib/api/inventory'
import { normaliseApproval } from '../../lib/inventory/integrationView'
import { toUserMessage } from '../../lib/inventory/errorText'
import { useInvQuery, PagedTable, Note, ErrorNote, StatusPill, SectionCard, Field, fmtDateTime } from './InvUi'

/**
 * Sends one record for approval. One idempotency key per button life, so a
 * retry after a timeout cannot raise a second request.
 */
export function RequestApprovalButton({ entityType, entityId, onDone, disabled }) {
  const { t } = useLanguage()
  const [key] = useState(() => newIdempotencyKey())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(null)
  const send = async () => {
    setBusy(true); setErr('')
    try {
      const res = await requestApproval({ entityType, entityId }, key)
      setDone(res?.replayed ? 'replayed' : 'sent')
      onDone?.(res)
    } catch (e) { setErr(toUserMessage(e)) } finally { setBusy(false) }
  }
  return (
    <div className="inv-hub" style={{ gap: 6 }}>
      <div className="inv-actions">
        <button type="button" className="cc-btn-ghost" disabled={busy || disabled || !entityId || !!done} onClick={send}>
          <Send size={14} aria-hidden="true" /> {busy ? t('inventory.actions.saving') : t('inventory.approvals.request')}
        </button>
      </div>
      {done && <Note tone="good">{t(done === 'replayed' ? 'inventory.approvals.alreadyRequested' : 'inventory.approvals.requested')}</Note>}
      {err && <ErrorNote error={err} />}
    </div>
  )
}

export default function ApprovalsPanel({ scope, can, onNavigate }) {
  const { t } = useLanguage()
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)
  const [type, setType] = useState('all')
  const [form, setForm] = useState({ entityType: 'adjustment', entityId: '' })
  const q = useInvQuery(() => listPendingApprovals({ ...scope, page, pageSize, entityType: type }),
    [scope.country, scope.site, page, pageSize, type])
  const shaped = q.data ? { ...q.data, rows: (q.data.rows || []).map((r) => ({ ...normaliseApproval(r), _raw: r })) } : q.data
  const query = { ...q, data: shaped }

  const columns = [
    { key: 'entityType', header: t('inventory.approvals.type'), cell: (r) => (r.entityType ? t(`inventory.approvals.types.${r.entityType}`) : <span className="cc-na">N/A</span>) },
    { key: 'entityRef', header: t('inventory.approvals.record'), cell: (r) => <span className="inv-mono">{r.entityRef || (r.entityId ? String(r.entityId).slice(0, 8) : 'N/A')}</span> },
    { key: 'summary', header: t('inventory.approvals.summary'), cell: (r) => r.summary || <span className="cc-na">N/A</span> },
    { key: 'requestedBy', header: t('inventory.approvals.requestedBy'), cell: (r) => r.requestedBy || <span className="cc-na">N/A</span> },
    { key: 'requestedAt', header: t('inventory.approvals.requestedAt'), cell: (r) => fmtDateTime(r.requestedAt) },
    { key: 'status', header: t('inventory.common.status'), cell: (r) => <StatusPill value={r.status} tone="warning" /> },
    { key: 'go', header: '', cell: (r) => (APPROVAL_TARGET[r.entityType] ? (
      <button type="button" className="cc-btn-ghost" onClick={(e) => { e.stopPropagation(); onNavigate?.(APPROVAL_TARGET[r.entityType].section) }}>
        {t('inventory.approvals.open')} <ArrowRight size={14} aria-hidden="true" />
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
      {can('view') && (
        <SectionCard title={t('inventory.approvals.requestTitle')} sub={t('inventory.approvals.requestSub')}>
          <div className="inv-form">
            <Field label={t('inventory.approvals.type')}>
              <select className="cc-select" value={form.entityType} onChange={(e) => setForm((f) => ({ ...f, entityType: e.target.value }))}>
                {APPROVAL_ENTITY_TYPES.map((x) => <option key={x} value={x}>{t(`inventory.approvals.types.${x}`)}</option>)}
              </select>
            </Field>
            <Field label={t('inventory.approvals.recordId')}>
              <input className="inv-input inv-mono" value={form.entityId} maxLength={40}
                onChange={(e) => setForm((f) => ({ ...f, entityId: e.target.value.trim() }))} />
            </Field>
          </div>
          <RequestApprovalButton key={`${form.entityType}:${form.entityId}`} entityType={form.entityType} entityId={form.entityId}
            onDone={() => q.retry()} />
        </SectionCard>
      )}
    </div>
  )
}
