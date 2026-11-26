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
import { useLanguage } from '../../contexts/LanguageContext'
import { useInvQuery, ErrorNote, Note, SectionCard, StatusPill, Field, fmtDate, alignNumeric } from '../inventory/InvUi'
import { newIdempotencyKey } from '../../lib/api/inventory'
import { listScrapRequests, requestScrap, cancelScrap, evaluateScrap, decideScrap, postScrap, disposeScrap } from '../../lib/api/warehouseAssets'
import { scrapProposal } from '../../lib/inventory/warehouseAssets'
import { SCRAP_STATUS, scrapNextAction, recoverySummary, currencyForCountry } from '../../lib/warehouseClasses/specialClasses'
import { formatMoney, formatQty } from '../../lib/inventory/inventoryMoney'
import { toUserMessage } from '../../lib/inventory/errorText'

const EVAL_RESULTS = ['scrap', 'repair', 'return_to_supplier', 'reuse']

export function ScrapRequestsSection({ scope, can = () => false, userId, stockById, reloadKey }) {
  const { t } = useLanguage()
  const q = useInvQuery(() => listScrapRequests(scope), [scope.country, scope.site, reloadKey])
  const [acting, setActing] = useState(null)
  const rows = useMemo(() => q.data?.rows || [], [q.data])
  const rec = recoverySummary(rows)
  const notSetUp = q.data?.status === 'not_provisioned'
  const waiting = rows.filter((r) => scrapNextAction(r, userId, can) && scrapNextAction(r, userId, can) !== 'cancel').length

  return (
    <SectionCard title={t('wmsparts.scrap.title')}
      sub={notSetUp ? null : `${t('wmsparts.scrap.sub', {
        waiting,
        recovered: Object.keys(rec.totals).length ? Object.entries(rec.totals).map(([c, v]) => formatMoney(v, c)).join(' | ') : t('wmsparts.scrap.noneRecorded'),
      })}${rec.unknown ? ` ${t(rec.unknown === 1 ? 'wmsparts.scrap.unknownOne' : 'wmsparts.scrap.unknownMany', { n: rec.unknown })}` : ''}`}>
      {q.error && <ErrorNote error={q.error} onRetry={q.retry} />}
      {notSetUp && (
        <Note tone="warn" title={t('wmsparts.scrap.notSetUpTitle')}>{t('wmsparts.scrap.notSetUpBody')}</Note>
      )}
      {!notSetUp && (
        <div className="inv-scroll">
          <KitTable compact loading={q.loading && !q.data} rows={rows} empty={t('wmsparts.scrap.empty')}
            columns={alignNumeric([
              { key: 'proposed_at', header: t('wmsparts.scrap.proposed'), cell: (r) => fmtDate(r.proposed_at) },
              { key: 'item', header: t('wmsparts.scrap.stockLine'), cell: (r) => {
                const s = stockById?.get(r.stock_id)
                return s ? `${s.item_code || t('wmsparts.common.noCode')}: ${s.description || ''}` : (r.site || t('wmsparts.scrap.stockLine'))
              } },
              { key: 'qty', header: t('wmsparts.common.quantity'), numeric: true, cell: (r) => formatQty(r.qty) },
              { key: 'reason', header: t('wmsparts.common.reason') },
              { key: 'status', header: t('wmsparts.common.status'), cell: (r) => <StatusPill value={r.status} tone={SCRAP_STATUS[r.status]?.tone} label={SCRAP_STATUS[r.status] ? t(`wmsparts.scrap.status.${r.status}`) : r.status} /> },
              { key: 'eval', header: t('wmsparts.scrap.engineering'), cell: (r) => (r.evaluation_result ? `${EVAL_RESULTS.includes(r.evaluation_result) ? t(`wmsparts.scrap.result.${r.evaluation_result}`) : r.evaluation_result.replace(/_/g, ' ')}: ${r.evaluation_note || ''}` : '') },
              { key: 'recovery', header: t('wmsparts.scrap.recovery'), numeric: true, cell: (r) => (r.status !== 'disposed' ? ''
                : r.recovery_value === null || r.recovery_value === undefined ? t('wmsparts.common.unknown') : formatMoney(r.recovery_value, r.recovery_currency)) },
              { key: 'act', header: '', sortable: false, cell: (r) => {
                const a = scrapNextAction(r, userId, can)
                return a ? <button type="button" className="cc-btn-ghost" onClick={() => setActing({ req: r, action: a })}>{t(`wmsparts.scrap.action.${a}`)}</button> : null
              } },
            ])} />
        </div>
      )}
      {acting && <ScrapActionModal acting={acting} onClose={() => setActing(null)} onDone={() => { setActing(null); q.retry() }} />}
    </SectionCard>
  )
}

export function ScrapProposeModal({ stock, onClose, onDone }) {
  const { t } = useLanguage()
  const [form, setForm] = useState({ qty: '', reason: '' })
  const [key] = useState(() => newIdempotencyKey())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function submit() {
    const check = scrapProposal(stock, form, t)
    if (check.error) { setError(check.error); return }
    setBusy(true); setError(null)
    try {
      await requestScrap(check.proposal, key)
      onDone()
    } catch (err) {
      setError(toUserMessage(err, t('wmsparts.scrap.saveFailed')))
    } finally { setBusy(false) }
  }

  return (
    <Modal className="cc inv-panel" open={!!stock} onClose={() => !busy && onClose()} size="md" title={t('wmsparts.scrap.proposeTitle')}
      subtitle={stock ? `${stock.item_code || t('wmsparts.common.noCode')}: ${stock.description || ''} (${t('wmsparts.scrap.onHandQty', { qty: formatQty(stock.qty_on_hand) })})` : null}
      footer={(
        <div className="inv-actions">
          <button type="button" className="cc-btn-ghost" onClick={onClose} disabled={busy}>{t('wmsparts.common.cancel')}</button>
          <button type="button" className="cc-btn" onClick={submit} disabled={busy}>{busy ? t('wmsparts.common.saving') : t('wmsparts.scrap.sendForEval')}</button>
        </div>
      )}>
      <div className="inv-form">
        {error && <p className="inv-err" role="alert">{error}</p>}
        <Field label={t('wmsparts.common.quantity')} id="sp-qty">
          <input id="sp-qty" className="cc-input" type="number" min="0" step="any" value={form.qty} onChange={set('qty')} />
        </Field>
        <Field label={t('wmsparts.common.reason')} id="sp-reason" full>
          <textarea id="sp-reason" className="cc-input" rows={3} value={form.reason} onChange={set('reason')} maxLength={1000} />
        </Field>
        <p className="cc-card-sub">{t('wmsparts.scrap.proposeFoot')}</p>
      </div>
    </Modal>
  )
}

function ScrapActionModal({ acting, onClose, onDone }) {
  const { t } = useLanguage()
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
        if (form.note.trim().length < 5) throw Object.assign(new Error(t('wmsparts.scrap.err.finding')), { local: true })
        await evaluateScrap({ request_id: req.id, result: form.result, note: form.note.trim() })
      } else if (action === 'decide') {
        if (form.decision === 'reject' && !form.note.trim()) throw Object.assign(new Error(t('wmsparts.scrap.err.rejectReason')), { local: true })
        await decideScrap({ request_id: req.id, decision: form.decision, note: form.note.trim() || null })
      } else if (action === 'post') {
        const r = await postScrap({ request_id: req.id })
        if (r?.status === 'refused_shortage') throw Object.assign(new Error(t('wmsparts.scrap.err.shortage')), { local: true })
      } else if (action === 'dispose') {
        if (!form.disposal_method) throw Object.assign(new Error(t('wmsparts.scrap.err.method')), { local: true })
        const v = form.recovery_value === '' ? null : Number(form.recovery_value)
        if (v !== null && (!Number.isFinite(v) || v < 0)) throw Object.assign(new Error(t('wmsparts.scrap.err.value')), { local: true })
        await disposeScrap({ request_id: req.id, disposal_method: form.disposal_method, disposal_ref: form.disposal_ref.trim() || null,
          recovery_value: v, recovery_currency: v === null ? null : expected })
      } else if (action === 'cancel') {
        await cancelScrap({ request_id: req.id, note: form.note.trim() || null })
      }
      onDone()
    } catch (err) {
      setError(err?.local ? err.message : toUserMessage(err, t('wmsparts.scrap.err.generic')))
    } finally { setBusy(false) }
  }

  return (
    <Modal className="cc inv-panel" open onClose={() => !busy && onClose()} size="md" title={t(`wmsparts.scrap.action.${action}`)}
      subtitle={t('wmsparts.scrap.unitsReason', { qty: formatQty(req.qty), reason: req.reason })}
      footer={(
        <div className="inv-actions">
          <button type="button" className="cc-btn-ghost" onClick={onClose} disabled={busy}>{t('wmsparts.common.close')}</button>
          <button type="button" className="cc-btn" onClick={submit} disabled={busy}>{busy ? t('wmsparts.common.saving') : t('wmsparts.common.confirm')}</button>
        </div>
      )}>
      <div className="inv-form">
        {error && <p className="inv-err" role="alert">{error}</p>}
        {action === 'evaluate' && (
          <>
            <Field label={t('wmsparts.scrap.findingLabel')} id="sa-res" full>
              <select id="sa-res" className="cc-select" value={form.result} onChange={set('result')}>
                <option value="scrap">{t('wmsparts.scrap.opt.scrap')}</option>
                <option value="repair">{t('wmsparts.scrap.opt.repair')}</option>
                <option value="return_to_supplier">{t('wmsparts.scrap.opt.return_to_supplier')}</option>
                <option value="reuse">{t('wmsparts.scrap.opt.reuse')}</option>
              </select>
            </Field>
            <Field label={t('wmsparts.scrap.findingNote')} id="sa-note" full>
              <textarea id="sa-note" className="cc-input" rows={3} value={form.note} onChange={set('note')} maxLength={1000} />
            </Field>
          </>
        )}
        {action === 'decide' && (
          <>
            <Field label={t('wmsparts.scrap.decision')} id="sa-dec" full>
              <select id="sa-dec" className="cc-select" value={form.decision} onChange={set('decision')}>
                <option value="approve">{t('wmsparts.scrap.approveWriteOff')}</option>
                <option value="reject">{t('wmsparts.common.reject')}</option>
              </select>
            </Field>
            <Field label={t('wmsparts.common.note')} id="sa-dnote" full>
              <textarea id="sa-dnote" className="cc-input" rows={2} value={form.note} onChange={set('note')} maxLength={1000} />
            </Field>
            {req.evaluation_note && <p className="cc-card-sub">{t('wmsparts.scrap.engineeringSaid', { note: req.evaluation_note })}</p>}
          </>
        )}
        {action === 'post' && <p>{t('wmsparts.scrap.postBody', { qty: formatQty(req.qty) })}</p>}
        {action === 'dispose' && (
          <>
            <Field label={t('wmsparts.scrap.method')} id="sa-meth" full>
              <select id="sa-meth" className="cc-select" value={form.disposal_method} onChange={set('disposal_method')}>
                <option value="">{t('wmsparts.common.choose')}</option>
                <option value="sold_as_scrap">{t('wmsparts.scrap.disp.sold_as_scrap')}</option>
                <option value="returned_to_supplier">{t('wmsparts.scrap.disp.returned_to_supplier')}</option>
                <option value="recycled">{t('wmsparts.scrap.disp.recycled')}</option>
                <option value="destroyed">{t('wmsparts.scrap.disp.destroyed')}</option>
                <option value="other">{t('wmsparts.scrap.disp.other')}</option>
              </select>
            </Field>
            <Field label={t('wmsparts.scrap.reference')} id="sa-ref">
              <input id="sa-ref" className="cc-input" value={form.disposal_ref} onChange={set('disposal_ref')} maxLength={120} />
            </Field>
            <Field label={`${t('wmsparts.scrap.recoveryValue')}${expected ? ` (${expected})` : ''}`} id="sa-val">
              <input id="sa-val" className="cc-input" type="number" min="0" step="any" value={form.recovery_value} onChange={set('recovery_value')} />
            </Field>
            <p className="cc-card-sub">{t('wmsparts.scrap.valueFoot')}</p>
          </>
        )}
        {action === 'cancel' && (
          <Field label={t('wmsparts.scrap.whyCancel')} id="sa-cnote" full>
            <textarea id="sa-cnote" className="cc-input" rows={2} value={form.note} onChange={set('note')} maxLength={1000} />
          </Field>
        )}
      </div>
    </Modal>
  )
}
