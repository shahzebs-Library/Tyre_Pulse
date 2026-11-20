/**
 * Stock flows through the ledger: receive goods, reserve, issue, transfer.
 *
 * Every write goes through one inv_* RPC (inv_receive_goods, inv_reserve,
 * inv_issue, inv_transfer_dispatch, inv_transfer_receive). Each form mints ONE
 * idempotency key when it opens and reuses it on retry, so a timeout can never
 * post a movement twice. Stock never goes negative: a shortage answers
 * `refused_shortage`, posts nothing, and the screen says so. A refusal written
 * by the server (missing permission, wrong scope) is shown as written.
 */
import { useEffect, useMemo, useState } from 'react'
import { PackageCheck, Lock, PackageMinus, Truck, Plus, Trash2, Inbox } from 'lucide-react'
import SideDrawer from '../ui/SideDrawer'
import { useLanguage } from '../../contexts/LanguageContext'
import {
  receiveGoods, reserveStock, issueStock, dispatchTransfer, receiveTransfer, listTransfers, listLocations,
  listBalances, searchItems, newIdempotencyKey,
} from '../../lib/api/inventory'
import { openTransferLines } from '../../lib/inventory/integrationView'
import { formatQty } from '../../lib/inventory/inventoryMoney'
import { toUserMessage } from '../../lib/inventory/errorText'
import { useInvQuery, PagedTable, Field, ErrorNote, Note, StatusPill, SectionCard, fmtDateTime } from './InvUi'

/** Result of a posting -> a note. A refused shortage is reported, never hidden. */
function ResultNote({ result }) {
  const { t } = useLanguage()
  if (!result) return null
  if (result.status === 'refused_shortage') return <Note tone="warn" title={t('inventory.flows.shortageTitle')}>{t('inventory.flows.shortageBody')}</Note>
  return <Note tone="good">{t(result.replayed ? 'inventory.flows.replayed' : 'inventory.flows.posted')}</Note>
}

function useLocations(scope) {
  const q = useInvQuery(() => listLocations(scope), [scope.country, scope.site])
  return { ...q, rows: q.data?.rows || [] }
}

function LocationSelect({ label, value, onChange, locations, exclude }) {
  const { t } = useLanguage()
  return (
    <Field label={label}>
      <select className="cc-select" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t('inventory.common.choose')}</option>
        {locations.filter((l) => l.active !== false && l.id !== exclude).map((l) => (
          <option key={l.id} value={l.id}>{[l.site, l.code, l.name].filter(Boolean).join(' / ')}</option>
        ))}
      </select>
    </Field>
  )
}

/** Type-ahead over the item master (20 rows max). */
function ItemPicker({ label, value, onPick, country }) {
  const { t } = useLanguage()
  const [term, setTerm] = useState(value?.item_code || '')
  const [hits, setHits] = useState([])
  const [err, setErr] = useState('')
  useEffect(() => {
    if (!term || term.length < 2 || term === value?.item_code) { setHits([]); return undefined }
    let live = true
    const id = setTimeout(() => {
      searchItems(term, { country }).then((r) => { if (live) { setHits(r); setErr('') } }).catch((e) => { if (live) setErr(toUserMessage(e)) })
    }, 250)
    return () => { live = false; clearTimeout(id) }
  }, [term, country, value?.item_code])
  return (
    <Field label={label}>
      <input className="inv-input" value={term} maxLength={80} placeholder={t('inventory.flows.itemSearch')}
        onChange={(e) => { setTerm(e.target.value); if (value) onPick(null) }} />
      {hits.length > 0 && (
        <ul className="inv-picklist">
          {hits.map((h) => (
            <li key={h.id}><button type="button" onClick={() => { onPick(h); setTerm(h.item_code); setHits([]) }}>
              <span className="inv-mono">{h.item_code}</span> {h.item_name}
            </button></li>
          ))}
        </ul>
      )}
      {err && <p className="inv-err" role="alert">{err}</p>}
    </Field>
  )
}

/** Type-ahead over the balance lines in scope (one stock line = item x location x condition x ownership). */
function StockPicker({ label, value, onPick, scope }) {
  const { t } = useLanguage()
  const [term, setTerm] = useState('')
  const q = useInvQuery(() => (term.length >= 2 ? listBalances({ ...scope, search: term, pageSize: 20 }) : Promise.resolve({ status: 'ok', rows: [], total: 0 })), [term, scope.country, scope.site])
  const rows = q.data?.rows || []
  return (
    <Field label={label}>
      <input className="inv-input" value={value ? `${value.item_code || value.description} @ ${value.location_code || value.site}` : term}
        maxLength={80} placeholder={t('inventory.flows.stockSearch')}
        onChange={(e) => { onPick(null); setTerm(e.target.value) }} />
      {!value && rows.length > 0 && (
        <ul className="inv-picklist">
          {rows.map((r) => (
            <li key={r.id}><button type="button" onClick={() => { onPick(r); setTerm('') }}>
              <span className="inv-mono">{r.item_code || r.description}</span> {r.location_code || r.site}
              {' | '}{t('inventory.flows.available')}: {formatQty(Number(r.qty_on_hand || 0) - Number(r.qty_reserved || 0))}
            </button></li>
          ))}
        </ul>
      )}
      {q.data?.status === 'not_provisioned' && <p className="inv-err">{t('inventory.state.notSetUpBody')}</p>}
    </Field>
  )
}

const EMPTY_LINE = () => ({ item: null, location_id: '', qty_received: '', qty_rejected: '', unit_cost: '', currency: '', rejection_reason: '' })

export function ReceiveGoodsPanel({ scope, can }) {
  const { t } = useLanguage()
  const locs = useLocations(scope)
  const [form, setForm] = useState(() => ({ grnNo: '', site: scope.site !== 'all' ? scope.site : '', lines: [EMPTY_LINE()], key: newIdempotencyKey() }))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [result, setResult] = useState(null)
  if (!can('receive')) return null
  const setLine = (i, patch) => setForm((f) => ({ ...f, lines: f.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }))
  const submit = async () => {
    setBusy(true); setErr(''); setResult(null)
    try {
      const res = await receiveGoods({
        country: scope.country, site: form.site || null, grnNo: form.grnNo || null,
        lines: form.lines.map((l) => ({ ...l, item_id: l.item?.id })),
      }, form.key)
      setResult(res || { status: 'posted' })
      setForm({ grnNo: '', site: form.site, lines: [EMPTY_LINE()], key: newIdempotencyKey() })
    } catch (e) { setErr(toUserMessage(e)) } finally { setBusy(false) }
  }
  return (
    <SectionCard title={t('inventory.flows.receiveTitle')} sub={t('inventory.flows.receiveSub')}>
      {locs.data?.status === 'not_provisioned' ? <Note tone="warn">{t('inventory.state.notSetUpBody')}</Note> : (
        <div className="inv-hub" style={{ gap: 10 }}>
          <div className="inv-form">
            <Field label={t('inventory.supply.grn')}><input className="inv-input" maxLength={60} value={form.grnNo} onChange={(e) => setForm((f) => ({ ...f, grnNo: e.target.value }))} /></Field>
            <Field label={t('inventory.scope.site')}><input className="inv-input" maxLength={80} value={form.site} onChange={(e) => setForm((f) => ({ ...f, site: e.target.value }))} /></Field>
          </div>
          <div className="inv-lines">
            {form.lines.map((l, i) => (
              <div key={i} className="inv-line" data-testid="receive-line">
                <ItemPicker label={t('inventory.common.item')} value={l.item} country={scope.country} onPick={(item) => setLine(i, { item })} />
                <LocationSelect label={t('inventory.common.location')} value={l.location_id} locations={locs.rows} onChange={(v) => setLine(i, { location_id: v })} />
                <Field label={t('inventory.supply.received')}><input className="inv-input inv-num" type="number" min="0" step="any" value={l.qty_received} onChange={(e) => setLine(i, { qty_received: e.target.value })} /></Field>
                <Field label={t('inventory.supply.rejected')}><input className="inv-input inv-num" type="number" min="0" step="any" value={l.qty_rejected} onChange={(e) => setLine(i, { qty_rejected: e.target.value })} /></Field>
                {can('view_value') && <Field label={t('inventory.opening.unitCost')}><input className="inv-input inv-num" type="number" min="0" step="any" value={l.unit_cost} placeholder={t('inventory.flows.costUnknown')} onChange={(e) => setLine(i, { unit_cost: e.target.value })} /></Field>}
                {can('view_value') && <Field label={t('inventory.common.currency')}><input className="inv-input" maxLength={3} value={l.currency} onChange={(e) => setLine(i, { currency: e.target.value.toUpperCase() })} /></Field>}
                {form.lines.length > 1 && (
                  <button type="button" className="cc-icon-btn" aria-label={t('inventory.flows.removeLine')} onClick={() => setForm((f) => ({ ...f, lines: f.lines.filter((_, j) => j !== i) }))}><Trash2 size={14} aria-hidden="true" /></button>
                )}
              </div>
            ))}
          </div>
          <p className="cc-card-sub">{t('inventory.flows.blankCost')}</p>
          <div className="inv-actions">
            <button type="button" className="cc-btn-ghost" onClick={() => setForm((f) => ({ ...f, lines: [...f.lines, EMPTY_LINE()] }))}><Plus size={14} aria-hidden="true" /> {t('inventory.flows.addLine')}</button>
            <button type="button" className="cc-btn-primary" disabled={busy} onClick={submit}><PackageCheck size={14} aria-hidden="true" /> {busy ? t('inventory.actions.saving') : t('inventory.flows.receive')}</button>
          </div>
          <ResultNote result={result} />
          {err && <ErrorNote error={err} />}
        </div>
      )}
    </SectionCard>
  )
}

export function ReserveIssuePanel({ scope, can }) {
  const { t } = useLanguage()
  const [stock, setStock] = useState(null)
  const [form, setForm] = useState(() => ({ qty: '', doc: '', reason: '', reservationId: '', reserveKey: newIdempotencyKey(), issueKey: newIdempotencyKey() }))
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [result, setResult] = useState(null)
  if (!can('issue')) return null
  const run = async (kind) => {
    setBusy(kind); setErr(''); setResult(null)
    try {
      const res = kind === 'reserve'
        ? await reserveStock({ stockId: stock?.id, qty: form.qty, sourceDocType: 'job_card', sourceDocId: form.doc || null }, form.reserveKey)
        : await issueStock({ stockId: stock?.id, qty: form.qty, reservationId: form.reservationId || null, reason: form.reason || null, referenceNo: form.doc || null }, form.issueKey)
      setResult(res || { status: 'posted' })
      if (kind === 'reserve' && res?.reservation_id) setForm((f) => ({ ...f, reservationId: res.reservation_id }))
      setForm((f) => ({ ...f, [kind === 'reserve' ? 'reserveKey' : 'issueKey']: newIdempotencyKey() }))
    } catch (e) { setErr(toUserMessage(e)) } finally { setBusy('') }
  }
  return (
    <SectionCard title={t('inventory.flows.reserveIssueTitle')} sub={t('inventory.flows.reserveIssueSub')}>
      <div className="inv-hub" style={{ gap: 10 }}>
        <div className="inv-form">
          <StockPicker label={t('inventory.flows.stockLine')} value={stock} onPick={setStock} scope={scope} />
          <Field label={t('inventory.flows.qty')}><input className="inv-input inv-num" type="number" min="0" step="any" value={form.qty} onChange={(e) => setForm((f) => ({ ...f, qty: e.target.value }))} /></Field>
          <Field label={t('inventory.flows.document')}><input className="inv-input" maxLength={80} value={form.doc} placeholder="GCKR/JC/..." onChange={(e) => setForm((f) => ({ ...f, doc: e.target.value }))} /></Field>
          <Field label={t('inventory.movements.reason')}><input className="inv-input" maxLength={200} value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} /></Field>
        </div>
        {stock && (
          <p className="cc-card-sub">
            {t('inventory.register.onHand')}: {formatQty(stock.qty_on_hand)} | {t('inventory.flows.reserved')}: {formatQty(stock.qty_reserved)}
            {form.reservationId && <> | {t('inventory.flows.reservationRef')}: <span className="inv-mono">{String(form.reservationId).slice(0, 8)}</span></>}
          </p>
        )}
        <div className="inv-actions">
          <button type="button" className="cc-btn-ghost" disabled={!!busy} onClick={() => run('reserve')}><Lock size={14} aria-hidden="true" /> {busy === 'reserve' ? t('inventory.actions.saving') : t('inventory.flows.reserve')}</button>
          <button type="button" className="cc-btn-primary" disabled={!!busy} onClick={() => run('issue')}><PackageMinus size={14} aria-hidden="true" /> {busy === 'issue' ? t('inventory.actions.saving') : t('inventory.flows.issue')}</button>
        </div>
        <p className="cc-card-sub">{t('inventory.flows.noNegative')}</p>
        <ResultNote result={result} />
        {err && <ErrorNote error={err} />}
      </div>
    </SectionCard>
  )
}

const TRANSFER_TONE = { dispatched: 'info', in_transit: 'info', partially_received: 'warning', completed: 'good', cancelled: 'muted' }

export function TransfersPanel({ scope, can }) {
  const { t } = useLanguage()
  const locs = useLocations(scope)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)
  const [status, setStatus] = useState('open')
  const q = useInvQuery(() => listTransfers({ ...scope, page, pageSize, status }), [scope.country, scope.site, page, pageSize, status])
  const locName = useMemo(() => {
    const m = new Map(locs.rows.map((l) => [l.id, [l.site, l.code].filter(Boolean).join(' / ')]))
    return (id) => m.get(id) || (id ? String(id).slice(0, 8) : 'N/A')
  }, [locs.rows])
  const [dispatch, setDispatch] = useState(null)
  const [receiving, setReceiving] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [result, setResult] = useState(null)
  const canTransfer = can('transfer')

  const openDispatch = () => { setErr(''); setResult(null); setDispatch({ from: '', to: '', remarks: '', lines: [{ stock: null, qty: '' }], key: newIdempotencyKey() }) }
  const sendDispatch = async () => {
    setBusy(true); setErr('')
    try {
      const res = await dispatchTransfer({
        fromLocationId: dispatch.from, toLocationId: dispatch.to, remarks: dispatch.remarks,
        lines: dispatch.lines.map((l) => ({ stock_id: l.stock?.id, qty: l.qty })),
      }, dispatch.key)
      setResult(res || { status: 'posted' })
      if (res?.status !== 'refused_shortage') { setDispatch(null); q.retry() }
    } catch (e) { setErr(toUserMessage(e)) } finally { setBusy(false) }
  }
  const openReceive = (tr) => {
    setErr(''); setResult(null)
    setReceiving({ tr, lines: openTransferLines(tr).map((l) => ({ line_id: l.id, label: l.itm?.item_code || l.item_id, outstanding: l.outstanding, received_qty: String(l.outstanding), condition: 'good' })), key: newIdempotencyKey() })
  }
  const sendReceive = async () => {
    setBusy(true); setErr('')
    try {
      const res = await receiveTransfer({ transferId: receiving.tr.id, lines: receiving.lines }, receiving.key)
      setResult(res || { status: 'posted' }); setReceiving(null); q.retry()
    } catch (e) { setErr(toUserMessage(e)) } finally { setBusy(false) }
  }
  const scopeForFrom = dispatch?.from ? { ...scope, site: locs.rows.find((l) => l.id === dispatch.from)?.site || scope.site } : scope

  return (
    <div className="inv-hub">
      <Note>{t('inventory.flows.transferRule')}</Note>
      <div className="cc-filters">
        <label className="cc-field">
          <span>{t('inventory.common.status')}</span>
          <select className="cc-select" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0) }}>
            <option value="open">{t('inventory.flows.openTransfers')}</option>
            <option value="all">{t('inventory.common.all')}</option>
            {Object.keys(TRANSFER_TONE).map((s) => <option key={s} value={s}>{t(`inventory.flows.transferStatus.${s}`)}</option>)}
          </select>
        </label>
        {canTransfer && q.data?.status !== 'not_provisioned' && (
          <button type="button" className="cc-btn-primary" onClick={openDispatch}><Truck size={14} aria-hidden="true" /> {t('inventory.flows.newTransfer')}</button>
        )}
      </div>
      <ResultNote result={!dispatch && !receiving ? result : null} />
      <PagedTable query={q} page={page} pageSize={pageSize} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(0) }}
        empty={t('inventory.flows.noTransfers')} what={t('inventory.flows.transfers')} noun={t('inventory.flows.transfersNoun')}
        columns={[
          { key: 'ref', header: t('inventory.audits.ref'), cell: (r) => <span className="inv-mono">{r.ref || String(r.id).slice(0, 8)}</span> },
          { key: 'from', header: t('inventory.flows.from'), cell: (r) => locName(r.from_location_id) },
          { key: 'to', header: t('inventory.flows.to'), cell: (r) => locName(r.to_location_id) },
          { key: 'lines', header: t('inventory.flows.lines'), numeric: true, cell: (r) => formatQty((r.lines || []).length) },
          { key: 'status', header: t('inventory.common.status'), cell: (r) => <StatusPill value={r.status} tone={TRANSFER_TONE[r.status]} label={t(`inventory.flows.transferStatus.${r.status}`)} /> },
          { key: 'dispatched_at', header: t('inventory.flows.dispatchedAt'), cell: (r) => fmtDateTime(r.dispatched_at) },
          { key: 'act', header: '', cell: (r) => (canTransfer && openTransferLines(r).length > 0 ? (
            <button type="button" className="cc-btn-ghost" onClick={(e) => { e.stopPropagation(); openReceive(r) }}><Inbox size={14} aria-hidden="true" /> {t('inventory.flows.receiveTransfer')}</button>
          ) : null) },
        ]} />

      <SideDrawer className="cc inv-panel" open={!!dispatch} onClose={() => !busy && setDispatch(null)} busy={busy} size="lg"
        title={t('inventory.flows.newTransfer')} subtitle={t('inventory.flows.dispatchSub')} closeLabel={t('inventory.actions.close')}>
        {dispatch && (
          <div className="inv-hub" style={{ gap: 12 }}>
            <div className="inv-form">
              <LocationSelect label={t('inventory.flows.from')} value={dispatch.from} locations={locs.rows} onChange={(v) => setDispatch((d) => ({ ...d, from: v }))} />
              <LocationSelect label={t('inventory.flows.to')} value={dispatch.to} locations={locs.rows} exclude={dispatch.from} onChange={(v) => setDispatch((d) => ({ ...d, to: v }))} />
            </div>
            <div className="inv-lines">
              {dispatch.lines.map((l, i) => (
                <div key={i} className="inv-line">
                  <StockPicker label={t('inventory.flows.stockLine')} value={l.stock} scope={scopeForFrom}
                    onPick={(s) => setDispatch((d) => ({ ...d, lines: d.lines.map((x, j) => (j === i ? { ...x, stock: s } : x)) }))} />
                  <Field label={t('inventory.flows.qty')}><input className="inv-input inv-num" type="number" min="0" step="any" value={l.qty}
                    onChange={(e) => setDispatch((d) => ({ ...d, lines: d.lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)) }))} /></Field>
                </div>
              ))}
            </div>
            <Field label={t('inventory.flows.remarks')} full><textarea className="inv-input" maxLength={500} value={dispatch.remarks} onChange={(e) => setDispatch((d) => ({ ...d, remarks: e.target.value }))} /></Field>
            <div className="inv-actions">
              <button type="button" className="cc-btn-ghost" onClick={() => setDispatch((d) => ({ ...d, lines: [...d.lines, { stock: null, qty: '' }] }))}><Plus size={14} aria-hidden="true" /> {t('inventory.flows.addLine')}</button>
              <button type="button" className="cc-btn-primary" disabled={busy} onClick={sendDispatch}><Truck size={14} aria-hidden="true" /> {busy ? t('inventory.actions.saving') : t('inventory.flows.dispatch')}</button>
            </div>
            <ResultNote result={result} />
            {err && <ErrorNote error={err} />}
          </div>
        )}
      </SideDrawer>

      <SideDrawer className="cc inv-panel" open={!!receiving} onClose={() => !busy && setReceiving(null)} busy={busy} size="md"
        title={t('inventory.flows.receiveTransfer')} subtitle={receiving?.tr?.ref || ''} closeLabel={t('inventory.actions.close')}>
        {receiving && (
          <div className="inv-hub" style={{ gap: 12 }}>
            <p className="cc-card-sub">{t('inventory.flows.receiveTransferSub')}</p>
            {receiving.lines.map((l, i) => (
              <div key={l.line_id} className="inv-line">
                <Field label={t('inventory.common.item')}><span className="inv-mono">{l.label}</span></Field>
                <Field label={t('inventory.flows.outstanding')}><span className="inv-num">{formatQty(l.outstanding)}</span></Field>
                <Field label={t('inventory.supply.received')}><input className="inv-input inv-num" type="number" min="0" max={l.outstanding} step="any" value={l.received_qty}
                  onChange={(e) => setReceiving((r) => ({ ...r, lines: r.lines.map((x, j) => (j === i ? { ...x, received_qty: e.target.value } : x)) }))} /></Field>
                <Field label={t('inventory.flows.condition')}>
                  <select className="cc-select" value={l.condition} onChange={(e) => setReceiving((r) => ({ ...r, lines: r.lines.map((x, j) => (j === i ? { ...x, condition: e.target.value } : x)) }))}>
                    {['good', 'damaged', 'quarantine'].map((c) => <option key={c} value={c}>{t(`inventory.flows.conditions.${c}`)}</option>)}
                  </select>
                </Field>
              </div>
            ))}
            <div className="inv-actions">
              <button type="button" className="cc-btn-primary" disabled={busy} onClick={sendReceive}><Inbox size={14} aria-hidden="true" /> {busy ? t('inventory.actions.saving') : t('inventory.flows.confirmReceipt')}</button>
            </div>
            {err && <ErrorNote error={err} />}
          </div>
        )}
      </SideDrawer>
    </div>
  )
}
