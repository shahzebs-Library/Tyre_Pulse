/**
 * Discrepancies: every variance the reconciliation raised, investigated with
 * a category, notes, evidence and a proposed correction, then decided by an
 * approver who is NOT the counter, recounter or audit creator (approve /
 * reject / recount / hold). An approved adjustment posts a ledger movement
 * through inv_adjustment_approve; nothing here edits a balance directly.
 */
import { useEffect, useState } from 'react'
import { Save, CheckCircle2, XCircle, RotateCcw, PauseCircle } from 'lucide-react'
import SideDrawer from '../ui/SideDrawer'
import { useLanguage } from '../../contexts/LanguageContext'
import {
  listDiscrepancies, updateDiscrepancy, decideAdjustment, getAudit, newIdempotencyKey,
} from '../../lib/api/inventory'
import {
  DISCREPANCY_CATEGORIES, DISCREPANCY_STATUSES, nextDiscrepancyStatuses, discrepancyReadyForApproval, canApproveAdjustment,
} from '../../lib/inventory/auditView'
import { formatMoney, formatQty } from '../../lib/inventory/inventoryMoney'
import { toUserMessage } from '../../lib/safeError'
import { useInvQuery, PagedTable, SearchBox, Field, ErrorNote, Note, StatusPill, fmtDateTime } from './InvUi'

const TONE = { open: 'bad', investigating: 'warning', proposed: 'info', approved: 'good', rejected: 'muted', posted: 'good', closed: 'muted' }

export default function DiscrepanciesSection({ scope, can, userId }) {
  const { t } = useLanguage()
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)
  const [status, setStatus] = useState('open')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(null)
  const [audit, setAudit] = useState(null)
  const [edit, setEdit] = useState(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [keys, setKeys] = useState({})
  const showValue = can('view_value')
  const canReview = can('discrepancy_review')

  const q = useInvQuery(() => listDiscrepancies({ ...scope, page, pageSize, status, search }),
    [scope.country, scope.site, page, pageSize, status, search])

  useEffect(() => {
    if (!open?.audit_id) { setAudit(null); return undefined }
    let live = true
    getAudit(open.audit_id).then((a) => { if (live) setAudit(a) }).catch(() => { if (live) setAudit(null) })
    return () => { live = false }
  }, [open])

  const openRow = (d) => {
    setOpen(d); setErr(''); setNote('')
    setEdit({ category: d.category || '', investigation_notes: d.investigation_notes || '', proposed_qty: d.proposed_qty ?? '', proposed_action: d.proposed_action || '', status: d.status })
    setKeys({ save: newIdempotencyKey(), decide: newIdempotencyKey() })
  }

  const columns = [
    { key: 'created_at', header: t('inventory.disc.raised'), cell: (d) => fmtDateTime(d.created_at) },
    { key: 'audit_ref', header: t('inventory.audits.ref'), cell: (d) => <span className="inv-mono">{d.audit_ref || 'N/A'}</span> },
    { key: 'item_code', header: t('inventory.common.item'), cell: (d) => d.item_code || d.serial_no || <span className="cc-na">N/A</span> },
    { key: 'location_code', header: t('inventory.common.location'), cell: (d) => d.location_code || <span className="cc-na">N/A</span> },
    { key: 'variance_qty', header: t('inventory.recon.variance'), numeric: true, cell: (d) => formatQty(d.variance_qty) },
    ...(showValue ? [{ key: 'value_impact', header: t('inventory.recon.valueImpact'), numeric: true, cell: (d) => formatMoney(d.value_impact, d.currency) }] : []),
    { key: 'category', header: t('inventory.disc.category'), cell: (d) => (d.category ? t(`inventory.discCategories.${d.category}`) : <span className="cc-na">{t('inventory.disc.uncategorised')}</span>) },
    { key: 'status', header: t('inventory.common.status'), cell: (d) => <StatusPill value={d.status} tone={TONE[d.status]} label={t(`inventory.discStatus.${d.status}`)} /> },
  ]

  const run = async (fn) => {
    setBusy(true); setErr('')
    try { await fn(); setOpen(null); q.retry() } catch (e) { setErr(toUserMessage(e)) } finally { setBusy(false) }
  }

  const approval = open ? canApproveAdjustment({ audit, adjustment: { counted_by: open.counted_by, created_by: open.created_by }, userId, can }) : null
  const ready = open ? discrepancyReadyForApproval({ ...open, ...edit }) : null
  const decide = (decision) => run(() => decideAdjustment({ discrepancyId: open.id, decision, note }, keys.decide))

  return (
    <div className="inv-hub">
      <div className="cc-filters">
        <SearchBox value={search} onChange={(v) => { setSearch(v); setPage(0) }} placeholder={t('inventory.disc.search')} />
        <label className="cc-field">
          <span>{t('inventory.common.status')}</span>
          <select className="cc-select" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0) }}>
            <option value="open">{t('inventory.disc.openOnly')}</option>
            <option value="all">{t('inventory.common.all')}</option>
            {DISCREPANCY_STATUSES.map((s) => <option key={s} value={s}>{t(`inventory.discStatus.${s}`)}</option>)}
          </select>
        </label>
      </div>
      <PagedTable query={q} columns={columns} page={page} pageSize={pageSize} onPage={setPage}
        onPageSize={(s) => { setPageSize(s); setPage(0) }} empty={t('inventory.disc.empty')}
        what={t('inventory.objects.inventory_discrepancies')} noun={t('inventory.disc.noun')} onRowClick={openRow} />

      <SideDrawer className="cc inv-panel" open={!!open} onClose={() => setOpen(null)} busy={busy} size="lg"
        title={t('inventory.disc.drawerTitle')} subtitle={open ? `${open.item_code || open.serial_no || ''} | ${open.location_code || ''}` : ''}
        closeLabel={t('inventory.actions.close')}>
        {open && edit && (
          <div className="inv-hub" style={{ gap: 12 }}>
            <dl className="inv-dl">
              <dt>{t('inventory.recon.expected')}</dt><dd className="inv-num">{formatQty(open.expected_qty)}</dd>
              <dt>{t('inventory.recon.counted')}</dt><dd className="inv-num">{formatQty(open.counted_qty)}</dd>
              <dt>{t('inventory.recon.variance')}</dt><dd className="inv-num">{formatQty(open.variance_qty)}</dd>
              {showValue && (<><dt>{t('inventory.recon.valueImpact')}</dt><dd className="inv-num">{formatMoney(open.value_impact, open.currency)}</dd></>)}
              <dt>{t('inventory.common.status')}</dt><dd><StatusPill value={open.status} tone={TONE[open.status]} label={t(`inventory.discStatus.${open.status}`)} /></dd>
            </dl>

            <h4 className="cc-card-title">{t('inventory.disc.investigation')}</h4>
            {!canReview && <Note>{t('inventory.disc.readOnly')}</Note>}
            <div className="inv-form">
              <Field label={t('inventory.disc.category')}>
                <select className="cc-select" disabled={!canReview} value={edit.category} onChange={(e) => setEdit((x) => ({ ...x, category: e.target.value }))}>
                  <option value="">{t('inventory.common.choose')}</option>
                  {DISCREPANCY_CATEGORIES.map((c) => <option key={c} value={c}>{t(`inventory.discCategories.${c}`)}</option>)}
                </select>
              </Field>
              <Field label={t('inventory.disc.proposedQty')}>
                <input className="inv-input inv-num" type="number" min="0" step="any" disabled={!canReview} value={edit.proposed_qty}
                  onChange={(e) => setEdit((x) => ({ ...x, proposed_qty: e.target.value }))} />
              </Field>
              <Field label={t('inventory.disc.notes')} full>
                <textarea className="inv-input" disabled={!canReview} maxLength={4000} value={edit.investigation_notes}
                  onChange={(e) => setEdit((x) => ({ ...x, investigation_notes: e.target.value }))} />
              </Field>
              <Field label={t('inventory.disc.proposedAction')} full>
                <input className="inv-input" disabled={!canReview} maxLength={300} value={edit.proposed_action}
                  onChange={(e) => setEdit((x) => ({ ...x, proposed_action: e.target.value }))} />
              </Field>
              <Field label={t('inventory.disc.moveTo')}>
                <select className="cc-select" disabled={!canReview} value={edit.status} onChange={(e) => setEdit((x) => ({ ...x, status: e.target.value }))}>
                  <option value={open.status}>{t(`inventory.discStatus.${open.status}`)}</option>
                  {nextDiscrepancyStatuses(open.status).map((s) => <option key={s} value={s}>{t(`inventory.discStatus.${s}`)}</option>)}
                </select>
              </Field>
            </div>
            {canReview && (
              <div className="inv-actions">
                <button type="button" className="cc-btn-primary" disabled={busy}
                  onClick={() => run(() => updateDiscrepancy(open.id, { ...edit, proposed_qty: edit.proposed_qty === '' ? null : Number(edit.proposed_qty) }, keys.save))}>
                  <Save size={14} aria-hidden="true" /> {t('inventory.actions.save')}
                </button>
              </div>
            )}

            <h4 className="cc-card-title">{t('inventory.disc.approval')}</h4>
            {open.status !== 'proposed' ? <Note>{t('inventory.disc.notProposed')}</Note> : approval?.ok ? (
              <>
                {!ready.ok && <Note tone="warn">{t('inventory.disc.incomplete', { fields: ready.missing.map((m) => t(`inventory.disc.field.${m}`)).join(', ') })}</Note>}
                <Field label={t('inventory.disc.decisionNote')} full>
                  <textarea className="inv-input" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
                </Field>
                <div className="inv-actions">
                  <button type="button" className="cc-btn-primary" disabled={busy || !ready.ok} onClick={() => decide('approve')}><CheckCircle2 size={14} aria-hidden="true" /> {t('inventory.disc.approve')}</button>
                  <button type="button" className="cc-btn-ghost" disabled={busy || !note.trim()} onClick={() => decide('reject')}><XCircle size={14} aria-hidden="true" /> {t('inventory.disc.reject')}</button>
                  <button type="button" className="cc-btn-ghost" disabled={busy} onClick={() => decide('recount')}><RotateCcw size={14} aria-hidden="true" /> {t('inventory.disc.recount')}</button>
                  <button type="button" className="cc-btn-ghost" disabled={busy || !note.trim()} onClick={() => decide('hold')}><PauseCircle size={14} aria-hidden="true" /> {t('inventory.disc.hold')}</button>
                </div>
                <p className="cc-card-sub">{t('inventory.disc.noteRequired')}</p>
              </>
            ) : <Note tone="warn">{t(approval?.reason || 'inventory.approve.noCapability')}</Note>}
            {err && <ErrorNote error={err} />}
          </div>
        )}
      </SideDrawer>
    </div>
  )
}
