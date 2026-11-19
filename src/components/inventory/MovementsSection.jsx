/**
 * Movements: the append-only ledger. Rows are never edited or deleted; a
 * mistake is corrected by a REVERSAL movement that points at the original
 * (`reverses_movement_id`), posted by the inv_reverse_movement RPC.
 */
import { useState } from 'react'
import { Undo2 } from 'lucide-react'
import Modal from '../ui/Modal'
import { useLanguage } from '../../contexts/LanguageContext'
import { listMovements, reverseMovement, newIdempotencyKey } from '../../lib/api/inventory'
import { formatMoney, formatQty } from '../../lib/inventory/inventoryMoney'
import { toUserMessage } from '../../lib/safeError'
import { useInvQuery, PagedTable, SearchBox, Field, ErrorNote, StatusPill, fmtDateTime } from './InvUi'
import DateField from '../ui/DateField'

export const MOVEMENT_FILTER_TYPES = [
  'receipt', 'issue', 'return', 'transfer_out', 'transfer_in', 'adjustment_up', 'adjustment_down',
  'count_adjustment', 'opening_balance', 'scrap', 'reservation', 'release', 'reversal',
]

const inflow = new Set(['receipt', 'return', 'transfer_in', 'adjustment_up', 'opening_balance'])

export default function MovementsSection({ scope, can }) {
  const { t } = useLanguage()
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)
  const [type, setType] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [search, setSearch] = useState('')
  const [reversing, setReversing] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const showValue = can('view_value')
  const canReverse = can('adjustment_approve')

  const q = useInvQuery(() => listMovements({ ...scope, page, pageSize, type, from, to, search }),
    [scope.country, scope.site, page, pageSize, type, from, to, search])
  const reset = (fn) => (v) => { fn(v); setPage(0) }

  const columns = [
    { key: 'posted_at', header: t('inventory.movements.posted'), cell: (m) => fmtDateTime(m.posted_at || m.created_at) },
    { key: 'movement_type', header: t('inventory.movements.type'), cell: (m) => (
      <StatusPill value={m.movement_type} tone={m.reverses_movement_id ? 'muted' : inflow.has(m.movement_type) ? 'good' : 'warning'} />
    ) },
    { key: 'item_code', header: t('inventory.common.item'), cell: (m) => m.item_code || <span className="cc-na">N/A</span> },
    { key: 'location_code', header: t('inventory.common.location'), cell: (m) => m.location_code || m.site || <span className="cc-na">N/A</span> },
    { key: 'qty_change', header: t('inventory.movements.qty'), numeric: true, cell: (m) => <span className="inv-num">{Number(m.qty_change) > 0 ? '+' : ''}{formatQty(m.qty_change)}</span> },
    { key: 'qty_after', header: t('inventory.movements.after'), numeric: true, cell: (m) => <span className="inv-num">{formatQty(m.qty_after)}</span> },
    ...(showValue ? [{ key: 'value_change', header: t('inventory.movements.value'), numeric: true, cell: (m) => formatMoney(m.value_change, m.currency) }] : []),
    { key: 'source', header: t('inventory.movements.source'), cell: (m) => [m.source_doc_type, m.source_doc_id || m.reference_no].filter(Boolean).join(' ') || <span className="cc-na">N/A</span> },
    { key: 'reason', header: t('inventory.movements.reason'), cell: (m) => m.reason || <span className="cc-na">N/A</span> },
    ...(canReverse ? [{ key: 'act', header: '', sortable: false, cell: (m) => (m.reverses_movement_id ? null : (
      <button type="button" className="cc-icon-btn" aria-label={t('inventory.movements.reverse')} title={t('inventory.movements.reverse')}
        onClick={(e) => { e.stopPropagation(); setErr(''); setReversing({ m, reason: '', key: newIdempotencyKey() }) }}>
        <Undo2 size={14} aria-hidden="true" />
      </button>
    )) }] : []),
  ]

  const confirmReverse = async () => {
    if (!reversing.reason.trim()) { setErr(t('inventory.movements.reasonRequired')); return }
    setBusy(true); setErr('')
    try {
      await reverseMovement({ movementId: reversing.m.id, reason: reversing.reason.trim() }, reversing.key)
      setReversing(null); q.retry()
    } catch (e) { setErr(toUserMessage(e)) } finally { setBusy(false) }
  }

  return (
    <div className="inv-hub">
      <div className="cc-filters">
        <SearchBox value={search} onChange={reset(setSearch)} placeholder={t('inventory.movements.search')} />
        <label className="cc-field">
          <span>{t('inventory.movements.type')}</span>
          <select className="cc-select" value={type} onChange={(e) => reset(setType)(e.target.value)}>
            <option value="all">{t('inventory.common.all')}</option>
            {MOVEMENT_FILTER_TYPES.map((ty) => <option key={ty} value={ty}>{ty.replace(/_/g, ' ')}</option>)}
          </select>
        </label>
        <label className="cc-field"><span>{t('inventory.common.from')}</span><DateField value={from} onChange={reset(setFrom)} /></label>
        <label className="cc-field"><span>{t('inventory.common.to')}</span><DateField value={to} onChange={reset(setTo)} /></label>
      </div>
      <p className="cc-card-sub">{t('inventory.movements.appendOnly')}</p>
      <PagedTable query={q} columns={columns} page={page} pageSize={pageSize} onPage={setPage}
        onPageSize={(s) => { setPageSize(s); setPage(0) }} empty={t('inventory.movements.empty')}
        what={t('inventory.objects.ledger')} noun={t('inventory.movements.noun')} />

      <Modal open={!!reversing} onClose={() => !busy && setReversing(null)} size="sm" title={t('inventory.movements.reverseTitle')}
        footer={(
          <div className="inv-actions">
            <button type="button" className="cc-btn-ghost" onClick={() => setReversing(null)} disabled={busy}>{t('inventory.actions.cancel')}</button>
            <button type="button" className="cc-btn-primary" onClick={confirmReverse} disabled={busy}>{busy ? t('inventory.actions.saving') : t('inventory.movements.reverse')}</button>
          </div>
        )}>
        <p className="cc-card-sub">{t('inventory.movements.reverseBody')}</p>
        <Field label={t('inventory.movements.reason')} full>
          <textarea className="inv-input" value={reversing?.reason || ''} maxLength={500}
            onChange={(e) => setReversing((r) => ({ ...r, reason: e.target.value }))} />
        </Field>
        {err && <ErrorNote error={err} />}
      </Modal>
    </div>
  )
}
