/**
 * Scrap for non-tyre stock, governed end to end (migration 20261124133000):
 *   propose (with reason) -> engineering evaluation by someone else ->
 *   approval by someone with scrap_approve (not the proposer) ->
 *   post (the stock leaves through the ledger, approval reference stamped) ->
 *   disposal with the recovery value in the line's own currency (or unknown).
 * The server enforces every step and every separation of duties; the buttons
 * only show what the server would accept.
 */
import { useMemo, useState } from 'react'
import { KitTable } from '../commandCenter/kit'
import Modal from '../ui/Modal'
import { useInvQuery, ErrorNote, Note, SectionCard, StatusPill, Field, fmtDate, alignNumeric } from '../inventory/InvUi'
import { newIdempotencyKey } from '../../lib/api/inventory'
import { listScrapRequests, requestScrap, cancelScrap, evaluateScrap, decideScrap, postScrap, disposeScrap } from '../../lib/api/warehouseAssets'
import { scrapProposal } from '../../lib/inventory/warehouseAssets'
import { SCRAP_STATUS, scrapNextAction, recoverySummary, currencyForCountry } from '../../lib/warehouseClasses/specialClasses'
import { formatMoney, formatQty } from '../../lib/inventory/inventoryMoney'
import { toUserMessage } from '../../lib/inventory/errorText'

const ACTION_LABEL = { evaluate: 'Evaluate', decide: 'Approve or reject', post: 'Post write-off', dispose: 'Record disposal', cancel: 'Cancel' }

export function ScrapRequestsSection({ scope, can = () => false, userId, stockById, reloadKey }) {
  const q = useInvQuery(() => listScrapRequests(scope), [scope.country, scope.site, reloadKey])
  const [acting, setActing] = useState(null)
  const rows = useMemo(() => q.data?.rows || [], [q.data])
  const rec = recoverySummary(rows)
  const notSetUp = q.data?.status === 'not_provisioned'
  const waiting = rows.filter((r) => scrapNextAction(r, userId, can) && scrapNextAction(r, userId, can) !== 'cancel').length

  return (
    <SectionCard title="Scrap requests"
      sub={notSetUp ? null : `${waiting} waiting for you. Recovered: ${Object.keys(rec.totals).length
        ? Object.entries(rec.totals).map(([c, v]) => formatMoney(v, c)).join(' | ') : 'none recorded'}${rec.unknown ? ` (${rec.unknown} disposal${rec.unknown === 1 ? '' : 's'} with unknown recovery)` : ''}.`}>
      {q.error && <ErrorNote error={q.error} onRetry={q.retry} />}
      {notSetUp && (
        <Note tone="warn" title="Scrap requests are not set up yet">
          The governed scrap flow (proposal, engineering evaluation, approval, write-off, disposal) is migration
          20261124133000 and is not applied. Until then, scrap goes through a stock audit adjustment that a second person approves.
        </Note>
      )}
      {!notSetUp && (
        <div className="inv-scroll">
          <KitTable compact loading={q.loading && !q.data} rows={rows} empty="No scrap request yet. Use Propose scrap on a stock line."
            columns={alignNumeric([
              { key: 'proposed_at', header: 'Proposed', cell: (r) => fmtDate(r.proposed_at) },
              { key: 'item', header: 'Stock line', cell: (r) => {
                const s = stockById?.get(r.stock_id)
                return s ? `${s.item_code || 'No code'}: ${s.description || ''}` : (r.site || 'Stock line')
              } },
              { key: 'qty', header: 'Quantity', numeric: true, cell: (r) => formatQty(r.qty) },
              { key: 'reason', header: 'Reason' },
              { key: 'status', header: 'Status', cell: (r) => <StatusPill value={r.status} tone={SCRAP_STATUS[r.status]?.tone} label={SCRAP_STATUS[r.status]?.label || r.status} /> },
              { key: 'eval', header: 'Engineering', cell: (r) => (r.evaluation_result ? `${r.evaluation_result.replace(/_/g, ' ')}: ${r.evaluation_note || ''}` : '') },
              { key: 'recovery', header: 'Recovery', numeric: true, cell: (r) => (r.status !== 'disposed' ? ''
                : r.recovery_value === null || r.recovery_value === undefined ? 'Unknown' : formatMoney(r.recovery_value, r.recovery_currency)) },
              { key: 'act', header: '', sortable: false, cell: (r) => {
                const a = scrapNextAction(r, userId, can)
                return a ? <button type="button" className="cc-btn-ghost" onClick={() => setActing({ req: r, action: a })}>{ACTION_LABEL[a]}</button> : null
              } },
            ])} />
        </div>
      )}
      {acting && <ScrapActionModal acting={acting} onClose={() => setActing(null)} onDone={() => { setActing(null); q.retry() }} />}
    </SectionCard>
  )
}

export function ScrapProposeModal({ stock, onClose, onDone }) {
  const [form, setForm] = useState({ qty: '', reason: '' })
  const [key] = useState(() => newIdempotencyKey())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function submit() {
    const check = scrapProposal(stock, form)
    if (check.error) { setError(check.error); return }
    setBusy(true); setError(null)
    try {
      await requestScrap(check.proposal, key)
      onDone()
    } catch (err) {
      setError(toUserMessage(err, 'The scrap request could not be saved.'))
    } finally { setBusy(false) }
  }

  return (
    <Modal className="cc inv-panel" open={!!stock} onClose={() => !busy && onClose()} size="md" title="Propose scrap"
      subtitle={stock ? `${stock.item_code || 'No code'}: ${stock.description || ''} (${formatQty(stock.qty_on_hand)} on hand)` : null}
      footer={(
        <div className="inv-actions">
          <button type="button" className="cc-btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="cc-btn" onClick={submit} disabled={busy}>{busy ? 'Saving...' : 'Send for evaluation'}</button>
        </div>
      )}>
      <div className="inv-form">
        {error && <p className="inv-err" role="alert">{error}</p>}
        <Field label="Quantity" id="sp-qty">
          <input id="sp-qty" className="cc-input" type="number" min="0" step="any" value={form.qty} onChange={set('qty')} />
        </Field>
        <Field label="Reason" id="sp-reason" full>
          <textarea id="sp-reason" className="cc-input" rows={3} value={form.reason} onChange={set('reason')} maxLength={1000} />
        </Field>
        <p className="cc-card-sub">Nothing leaves stock yet. An engineer evaluates it, a second person approves, then it is written off.</p>
      </div>
    </Modal>
  )
}

function ScrapActionModal({ acting, onClose, onDone }) {
  const { req, action } = acting
  const expected = currencyForCountry(req.country)
  const [form, setForm] = useState({ result: 'scrap', note: '', decision: 'approve', disposal_method: '', disposal_ref: '', recovery_value: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function submit() {
    setBusy(true); setError(null)
    try {
      if (action === 'evaluate') {
        if (form.note.trim().length < 5) throw Object.assign(new Error('Write the engineering finding.'), { local: true })
        await evaluateScrap({ request_id: req.id, result: form.result, note: form.note.trim() })
      } else if (action === 'decide') {
        if (form.decision === 'reject' && !form.note.trim()) throw Object.assign(new Error('Give the reason for rejecting.'), { local: true })
        await decideScrap({ request_id: req.id, decision: form.decision, note: form.note.trim() || null })
      } else if (action === 'post') {
        const r = await postScrap({ request_id: req.id })
        if (r?.status === 'refused_shortage') throw Object.assign(new Error('Not enough free stock on this line to write it off now.'), { local: true })
      } else if (action === 'dispose') {
        if (!form.disposal_method) throw Object.assign(new Error('Choose how it was disposed.'), { local: true })
        const v = form.recovery_value === '' ? null : Number(form.recovery_value)
        if (v !== null && (!Number.isFinite(v) || v < 0)) throw Object.assign(new Error('Recovery value must be a number of zero or more.'), { local: true })
        await disposeScrap({ request_id: req.id, disposal_method: form.disposal_method, disposal_ref: form.disposal_ref.trim() || null,
          recovery_value: v, recovery_currency: v === null ? null : expected })
      } else if (action === 'cancel') {
        await cancelScrap({ request_id: req.id, note: form.note.trim() || null })
      }
      onDone()
    } catch (err) {
      setError(err?.local ? err.message : toUserMessage(err, 'That could not be saved.'))
    } finally { setBusy(false) }
  }

  return (
    <Modal className="cc inv-panel" open onClose={() => !busy && onClose()} size="md" title={ACTION_LABEL[action]}
      subtitle={`${formatQty(req.qty)} units: ${req.reason}`}
      footer={(
        <div className="inv-actions">
          <button type="button" className="cc-btn-ghost" onClick={onClose} disabled={busy}>Close</button>
          <button type="button" className="cc-btn" onClick={submit} disabled={busy}>{busy ? 'Saving...' : 'Confirm'}</button>
        </div>
      )}>
      <div className="inv-form">
        {error && <p className="inv-err" role="alert">{error}</p>}
        {action === 'evaluate' && (
          <>
            <Field label="Engineering finding" id="sa-res" full>
              <select id="sa-res" className="cc-select" value={form.result} onChange={set('result')}>
                <option value="scrap">Scrap: cannot be used or repaired</option>
                <option value="repair">Repair it instead</option>
                <option value="return_to_supplier">Return to the supplier</option>
                <option value="reuse">Still usable</option>
              </select>
            </Field>
            <Field label="Finding (what was checked)" id="sa-note" full>
              <textarea id="sa-note" className="cc-input" rows={3} value={form.note} onChange={set('note')} maxLength={1000} />
            </Field>
          </>
        )}
        {action === 'decide' && (
          <>
            <Field label="Decision" id="sa-dec" full>
              <select id="sa-dec" className="cc-select" value={form.decision} onChange={set('decision')}>
                <option value="approve">Approve the write-off</option>
                <option value="reject">Reject</option>
              </select>
            </Field>
            <Field label="Note" id="sa-dnote" full>
              <textarea id="sa-dnote" className="cc-input" rows={2} value={form.note} onChange={set('note')} maxLength={1000} />
            </Field>
            {req.evaluation_note && <p className="cc-card-sub">Engineering said: {req.evaluation_note}</p>}
          </>
        )}
        {action === 'post' && <p>This removes {formatQty(req.qty)} units from stock at their recorded cost. Units with no cost leave as unvalued.</p>}
        {action === 'dispose' && (
          <>
            <Field label="How it was disposed" id="sa-meth" full>
              <select id="sa-meth" className="cc-select" value={form.disposal_method} onChange={set('disposal_method')}>
                <option value="">Choose</option>
                <option value="sold_as_scrap">Sold as scrap</option>
                <option value="returned_to_supplier">Returned to the supplier</option>
                <option value="recycled">Recycled</option>
                <option value="destroyed">Destroyed</option>
                <option value="other">Other</option>
              </select>
            </Field>
            <Field label="Reference (receipt, note)" id="sa-ref">
              <input id="sa-ref" className="cc-input" value={form.disposal_ref} onChange={set('disposal_ref')} maxLength={120} />
            </Field>
            <Field label={`Recovery value${expected ? ` (${expected})` : ''}`} id="sa-val">
              <input id="sa-val" className="cc-input" type="number" min="0" step="any" value={form.recovery_value} onChange={set('recovery_value')} />
            </Field>
            <p className="cc-card-sub">Leave the value empty when it is not known. It is then reported as unknown, never as zero.</p>
          </>
        )}
        {action === 'cancel' && (
          <Field label="Why cancel (optional)" id="sa-cnote" full>
            <textarea id="sa-cnote" className="cc-input" rows={2} value={form.note} onChange={set('note')} maxLength={1000} />
          </Field>
        )}
      </div>
    </Modal>
  )
}
