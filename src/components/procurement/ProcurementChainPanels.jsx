/**
 * Procurement chain building blocks shared by Requisitions, Procurement, Goods
 * Receipt and Suppliers:
 *
 *   useProcurementCaps   the server's own answer to "may I procure / receive / delete"
 *   MaterialPicker       type-ahead over the Material Master (material_master)
 *   SupplierPicker       type-ahead over the supplier master (suppliers)
 *   RaisePoModal         approved requisition -> purchase order with a real line (retry-safe)
 *   ReceiveAgainstPoPanel  PO lines -> inv_receive_goods (GRN + ledger movement)
 *   SupplierRegister     the supplier master list with add / edit
 *
 * Nothing here writes stock directly: receiving goes through inv_receive_goods,
 * PO lines through inv_po_add_line. Money stays in the record's own currency.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, PackageCheck, Plus, Save, Search, ShoppingCart, Truck, AlertTriangle, Pencil, Building2 } from 'lucide-react'
import Modal from '../ui/Modal'
import { toUserMessage } from '../../lib/safeError'
import { listLocations } from '../../lib/api/inventory'
import {
  getProcurementCaps, listSuppliers, createSupplier, updateSupplier, createPurchaseOrderWithLines, addPurchaseOrderLines,
  listPurchaseOrderLines, listReceivablePurchaseOrders, receiveAgainstPo, linkRequisitionToPo,
  searchItems, newIdempotencyKey, SUPPLIER_STATUSES,
} from '../../lib/api/procurementChain'
import {
  requisitionPoDraft, requisitionMaterial, receiptPlan, outstandingQty, currencyForCountry, scopedCountry,
} from '../../lib/procurementChain'
import { REJECTION_CODES, rejectionReasonText } from '../../lib/procurement/procurementDepth'
import { findOpenRfqForRequisition } from '../../lib/api/procurementDepth'

const fmtNum = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? 'N/A' : Number(v).toLocaleString())
const fmtMoney = (v, cur) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))
  ? 'No cost recorded'
  : `${cur || ''} ${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim())

/** Server-decided procurement rights. `loading` stays true until the answer lands. */
export function useProcurementCaps() {
  const [caps, setCaps] = useState({ procure: false, receive: false, adminDelete: false, loading: true })
  useEffect(() => {
    let live = true
    getProcurementCaps()
      .then((c) => { if (live) setCaps({ ...c, loading: false }) })
      .catch(() => { if (live) setCaps({ procure: false, receive: false, adminDelete: false, loading: false }) })
    return () => { live = false }
  }, [])
  return caps
}

function useDebounced(value, ms = 250) {
  const [v, setV] = useState(value)
  useEffect(() => { const id = setTimeout(() => setV(value), ms); return () => clearTimeout(id) }, [value, ms])
  return v
}

/** Type-ahead over the Material Master. `value` = { id, item_code, item_name }. */
export function MaterialPicker({ value, onPick, country, label = 'Item (Material Master)', id = 'proc-material' }) {
  const [term, setTerm] = useState(value ? value.item_code : '')
  const q = useDebounced(term)
  const [hits, setHits] = useState([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!q || q.length < 2 || (value && q === value.item_code)) { setHits([]); return undefined }
    let live = true
    setBusy(true)
    searchItems(q, { country: scopedCountry(country) || undefined })
      .then((r) => { if (live) { setHits(r); setErr('') } })
      .catch((e) => { if (live) setErr(toUserMessage(e, 'Could not search the Material Master.')) })
      .finally(() => { if (live) setBusy(false) })
    return () => { live = false }
  }, [q, country, value])
  return (
    <div className="relative">
      <label className="label" htmlFor={id}>{label}</label>
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
        <input id={id} className="input w-full pl-8" maxLength={80} placeholder="Type an item code or name"
          value={term} onChange={(e) => { setTerm(e.target.value); if (value) onPick(null) }} autoComplete="off" />
      </div>
      {value && <p className="text-xs text-[var(--text-muted)] mt-1"><span className="font-mono">{value.item_code}</span> {value.item_name}</p>}
      {busy && <p className="text-xs text-[var(--text-muted)] mt-1">Searching</p>}
      {!busy && q.length >= 2 && !value && hits.length === 0 && !err && <p className="text-xs text-[var(--text-muted)] mt-1">No Material Master item matches.</p>}
      {hits.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full max-h-56 overflow-auto rounded-lg border border-[var(--input-border)] bg-[var(--panel)] shadow-lg">
          {hits.map((h) => (
            <li key={h.id}>
              <button type="button" className="w-full text-left px-3 py-2 min-h-[44px] text-sm hover:bg-[var(--input-bg)]"
                onClick={() => { onPick(h); setTerm(h.item_code); setHits([]) }}>
                <span className="font-mono text-xs">{h.item_code}</span> {h.item_name}
                {h.country ? <span className="text-[var(--text-muted)]"> | {h.country}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
      {err && <p role="alert" className="text-xs text-red-300 mt-1">{err}</p>}
    </div>
  )
}

/** Type-ahead over the supplier master. `value` = supplier row. */
export function SupplierPicker({ value, onPick, country, id = 'proc-supplier' }) {
  const [term, setTerm] = useState(value?.supplier_name || '')
  const q = useDebounced(term)
  const [hits, setHits] = useState([])
  const [err, setErr] = useState('')
  useEffect(() => {
    if (value && q === value.supplier_name) { setHits([]); return undefined }
    let live = true
    listSuppliers({ country: scopedCountry(country) || undefined, search: q, limit: 20 })
      .then((r) => { if (live) { setHits(r.filter((s) => s.status !== 'inactive')); setErr('') } })
      .catch((e) => { if (live) setErr(toUserMessage(e, 'Could not load suppliers.')) })
    return () => { live = false }
  }, [q, country, value])
  return (
    <div className="relative">
      <label className="label" htmlFor={id}>Supplier</label>
      <input id={id} className="input w-full" maxLength={200} placeholder="Search the supplier list" autoComplete="off"
        value={term} onChange={(e) => { setTerm(e.target.value); if (value) onPick(null) }} />
      {!value && hits.length > 0 && term !== '' && (
        <ul className="absolute z-20 mt-1 w-full max-h-56 overflow-auto rounded-lg border border-[var(--input-border)] bg-[var(--panel)] shadow-lg">
          {hits.map((s) => (
            <li key={s.id}>
              <button type="button" className="w-full text-left px-3 py-2 min-h-[44px] text-sm hover:bg-[var(--input-bg)]"
                onClick={() => { onPick(s); setTerm(s.supplier_name); setHits([]) }}>
                {s.supplier_name}{s.supplier_code ? <span className="font-mono text-xs text-[var(--text-muted)]"> {s.supplier_code}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
      {!value && term.length >= 2 && hits.length === 0 && !err && (
        <p className="text-xs text-amber-300 mt-1">No supplier matches. Add it under Suppliers, Supplier register first.</p>
      )}
      {err && <p role="alert" className="text-xs text-red-300 mt-1">{err}</p>}
    </div>
  )
}

/**
 * Approved requisition -> PO header, then link the requisition, then add the
 * catalogued line. Each step remembers its result, so a retry after a failure
 * reuses the PO already created and never raises a second PO for the same
 * requisition; only the step that failed runs again. The line keeps one
 * idempotency key (renewed only when the item or price changes), so retrying a
 * line replays it instead of adding it twice. A requisition that already has a
 * PO, or an open quotation request, cannot be raised here.
 */
export function RaisePoModal({ requisition, onClose, onDone }) {
  const [supplier, setSupplier] = useState(null)
  const [material, setMaterial] = useState(() => requisitionMaterial(requisition))
  const [unitPrice, setUnitPrice] = useState(requisition?.est_cost ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [warning, setWarning] = useState('')
  const [createdPo, setCreatedPo] = useState(null)
  const [linked, setLinked] = useState(false)
  // One line key for the modal. Item and price lock after the first line
  // attempt, so a retry after a lost response replays that line instead of
  // adding a second one under a new key.
  const [lineKey] = useState(() => newIdempotencyKey())
  const [lineTried, setLineTried] = useState(false)
  const [block, setBlock] = useState({ state: 'checking', reason: '' })
  useEffect(() => {
    let alive = true
    if (!requisition) return undefined
    if (requisition.po_ref) {
      setBlock({ state: 'blocked', reason: `This requisition already has purchase order ${requisition.po_ref}.` })
      return undefined
    }
    findOpenRfqForRequisition(requisition.id)
      .then((rfq) => {
        if (!alive) return
        setBlock(rfq
          ? { state: 'blocked', reason: `Quotation request ${rfq.rfq_no || ''} is open for this requisition. Award or cancel it instead of raising a PO directly.` }
          : { state: 'ok', reason: '' })
      })
      .catch((e) => { if (alive) setBlock({ state: 'error', reason: toUserMessage(e, 'Could not check for an open quotation request.') }) })
    return () => { alive = false }
  }, [requisition])
  if (!requisition) return null
  const currency = currencyForCountry(requisition.country)
  const draft = requisitionPoDraft(requisition, { supplier, material, unitPrice, country: requisition.country })
  const submit = async () => {
    setError(''); setWarning('')
    // Once this modal created the PO, its own link sets po_ref; do not block the retry on it.
    if (!createdPo && block.state !== 'ok') { setError(block.reason || 'This requisition cannot be raised as a PO right now.'); return }
    if (draft.errors.length) { setError(draft.errors.join(' ')); return }
    setBusy(true)
    let po = createdPo
    try {
      if (!po) {
        const res = await createPurchaseOrderWithLines(draft.header, [])
        po = res.po
        setCreatedPo(po)
      }
      if (!linked) {
        await linkRequisitionToPo(requisition.id, po.po_number)
        setLinked(true)
      }
      setLineTried(true)
      const { failedLines } = await addPurchaseOrderLines(po.id, [{ ...draft.line, idempotency_key: lineKey }])
      if (failedLines.length) setWarning(`PO ${po.po_number} is created and linked, but its line did not save: ${failedLines[0].message} Press Retry line to try again.`)
      else onDone?.(po)
    } catch (e) {
      const why = toUserMessage(e, 'Could not raise the purchase order.')
      setError(po ? `PO ${po.po_number} was created. ${why} Press the button again to finish: the same PO is reused.` : why)
    } finally { setBusy(false) }
  }
  const started = !!createdPo
  return (
    <Modal open onClose={busy ? undefined : (started ? () => onDone?.(createdPo) : onClose)} size="md" title={(
      <span className="inline-flex items-center gap-2"><ShoppingCart size={18} aria-hidden="true" /> Raise purchase order</span>
    )}>
      <div className="space-y-4">
        <p className="text-sm text-[var(--text-muted)]">
          From requisition <span className="font-mono">{requisition.requisition_no || 'without a number'}</span>: {requisition.item}, quantity {fmtNum(requisition.quantity)}.
          {!requisition.country && ' This requisition has no country, so the PO currency cannot be set.'}
        </p>
        {block.state === 'checking' && <p role="status" className="text-sm text-[var(--text-muted)] inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Checking for an open quotation request</p>}
        {(block.state === 'blocked' || block.state === 'error') && (
          <div role="alert" className="flex items-start gap-2 text-sm text-amber-300"><AlertTriangle size={15} className="mt-0.5 shrink-0" />{block.reason}</div>
        )}
        {started && <p role="status" className="text-sm text-[var(--text-secondary)]">Purchase order <span className="font-mono">{createdPo.po_number}</span> {linked ? 'is linked to this requisition.' : 'is created. The requisition is not linked yet.'}</p>}
        {/* The supplier is on the PO header, which already exists once created. */}
        {!started && <SupplierPicker value={supplier} onPick={setSupplier} country={requisition.country} />}
        {lineTried ? (
          <p className="text-sm text-[var(--text-secondary)]">
            Line: {[material?.item_code, material?.item_name].filter(Boolean).join(' ') || requisition.item}, unit price {unitPrice === '' ? 'not set' : unitPrice} {currency || ''}.
            Locked so a retry cannot add a second line.
          </p>
        ) : <>
        <MaterialPicker value={material} onPick={setMaterial} country={requisition.country} />
        <div>
          <label className="label" htmlFor="raise-po-price">Unit price {currency ? `(${currency})` : ''}</label>
          <input id="raise-po-price" className="input w-full" type="number" min="0" step="0.01" placeholder="Leave blank if not agreed yet"
            value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
        </div>
        </>}
        {error && <div role="alert" className="flex items-start gap-2 text-sm text-red-300"><AlertTriangle size={15} className="mt-0.5 shrink-0" />{error}</div>}
        {warning && <div role="status" className="text-sm text-amber-300">{warning}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary text-sm min-h-[44px]" onClick={started ? () => onDone?.(createdPo) : onClose} disabled={busy}>{started ? 'Close' : 'Cancel'}</button>
          <button type="button" className="btn-primary text-sm inline-flex items-center gap-2 min-h-[44px]" onClick={submit}
            disabled={busy || (!started && block.state !== 'ok')}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <ShoppingCart size={15} />} {warning ? 'Retry line' : started ? 'Finish' : 'Create PO'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/** Receive goods against an approved / ordered PO into stock locations. */
export function ReceiveAgainstPoPanel({ country, onReceived }) {
  const caps = useProcurementCaps()
  const [pos, setPos] = useState(null)
  const [poErr, setPoErr] = useState('')
  const [poId, setPoId] = useState('')
  const [lines, setLines] = useState(null)
  const [linesErr, setLinesErr] = useState('')
  const [locs, setLocs] = useState([])
  const [site, setSite] = useState('')
  const [grnNo, setGrnNo] = useState('')
  const [supplierOwned, setSupplierOwned] = useState(false)
  const [entries, setEntries] = useState({})
  const [key, setKey] = useState(() => newIdempotencyKey())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(null)

  const loadPos = useCallback(() => {
    setPoErr(''); setPos(null)
    listReceivablePurchaseOrders({ country: scopedCountry(country) || undefined })
      .then(setPos).catch((e) => { setPoErr(toUserMessage(e, 'Could not load purchase orders.')); setPos([]) })
  }, [country])
  useEffect(() => { if (caps.receive) loadPos() }, [caps.receive, loadPos])

  const po = useMemo(() => (pos || []).find((p) => p.id === poId) || null, [pos, poId])
  useEffect(() => {
    setLines(null); setLinesErr(''); setEntries({}); setDone(null); setError('')
    if (!po) return undefined
    let live = true
    setSite(po.site || '')
    listPurchaseOrderLines(po.id).then((r) => { if (live) setLines(r) })
      .catch((e) => { if (live) { setLinesErr(toUserMessage(e, 'Could not load the PO lines.')); setLines([]) } })
    listLocations({ country: po.country || undefined }).then((r) => { if (live) setLocs((r.rows || []).filter((l) => l.active !== false)) })
      .catch(() => { if (live) setLocs([]) })
    return () => { live = false }
  }, [po])

  const siteKey = (s) => String(s || '').trim().toUpperCase()
  const siteLocs = locs.filter((l) => site && siteKey(l.site) === siteKey(site))
  const sites = [...new Set(locs.map((l) => l.site).filter(Boolean))].sort()
  const setEntry = (id, patch) => setEntries((e) => ({ ...e, [id]: { ...e[id], ...patch } }))

  if (caps.loading) return <div className="card text-sm text-[var(--text-muted)]">Checking receiving rights</div>
  if (!caps.receive) return null

  const submit = async () => {
    setError('')
    if (!site) { setError('Choose the receiving site.'); return }
    if (supplierOwned && !po?.supplier_id) { setError('Supplier-owned stock needs a PO linked to a supplier record.'); return }
    const withReasons = Object.fromEntries(Object.entries(entries).map(([id, e]) => [id, {
      ...e, rejection_reason: Number(e.qty_rejected) > 0 && e.rejection_code ? rejectionReasonText(e.rejection_code, e.rejection_note) : null,
    }]))
    const plan = receiptPlan(lines || [], withReasons)
    if (plan.errors.length) { setError(plan.errors.join(' ')); return }
    if (supplierOwned) plan.lines = plan.lines.map((l) => ({ ...l, ownership: 'consignment', owner_supplier_id: po.supplier_id }))
    setBusy(true)
    try {
      const res = await receiveAgainstPo({ po, site, grnNo: grnNo || null, lines: plan.lines }, key)
      setDone(res); setKey(newIdempotencyKey()); setEntries({}); setGrnNo(''); setSupplierOwned(false)
      const fresh = await listPurchaseOrderLines(po.id).catch(() => null)
      if (fresh) setLines(fresh)
      onReceived?.(res)
      loadPos()
    } catch (e) { setError(toUserMessage(e, 'Could not receive the goods.')) } finally { setBusy(false) }
  }

  return (
    <div className="card space-y-3">
      <div className="flex items-center gap-2">
        <Truck size={16} aria-hidden="true" />
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">Receive against a purchase order</h2>
      </div>
      <p className="text-xs text-[var(--text-muted)]">
        Posts the receipt to stock through the movement ledger. Rejected quantity never enters stock and needs a reason; it can be sent back from Supplier returns. A line cannot receive more than is still outstanding.
      </p>
      {poErr && <p role="alert" className="text-xs text-red-300">{poErr} <button type="button" className="underline" onClick={loadPos}>Retry</button></p>}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="label" htmlFor="rcv-po">Purchase order</label>
          <select id="rcv-po" className="input w-full min-h-[44px]" value={poId} onChange={(e) => setPoId(e.target.value)} disabled={pos === null}>
            <option value="">{pos === null ? 'Loading' : pos.length ? 'Choose a PO' : 'No approved or ordered POs'}</option>
            {(pos || []).map((p) => <option key={p.id} value={p.id}>{p.po_number} | {p.supplier_name || p.vendor_name} | {p.status}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="rcv-site">Receiving site</label>
          <select id="rcv-site" className="input w-full min-h-[44px]" value={site} onChange={(e) => setSite(e.target.value)} disabled={!po}>
            <option value="">Choose a site</option>
            {[...new Set([...(po?.site ? [po.site] : []), ...sites])].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="rcv-grn">GRN number (optional)</label>
          <input id="rcv-grn" className="input w-full min-h-[44px]" maxLength={60} value={grnNo} onChange={(e) => setGrnNo(e.target.value)} disabled={!po} />
        </div>
      </div>
      {po && (
        <label className="flex items-start gap-2 text-xs text-[var(--text-secondary)]">
          <input type="checkbox" className="mt-0.5" checked={supplierOwned} onChange={(e) => setSupplierOwned(e.target.checked)} />
          <span>Supplier-owned (consignment) stock. It is counted on hand but not in our stock value, and needs an active consignment agreement with this supplier.</span>
        </label>
      )}
      {po && lines === null && <p className="text-xs text-[var(--text-muted)]">Loading PO lines</p>}
      {linesErr && <p role="alert" className="text-xs text-red-300">{linesErr}</p>}
      {po && lines && lines.length === 0 && !linesErr && (
        <p className="text-xs text-amber-300">This PO has no catalogued lines, so nothing can be received into stock against it. Add lines with Material Master items on the PO first.</p>
      )}
      {po && site && siteLocs.length === 0 && (
        <p className="text-xs text-amber-300">No active stock location exists at {site}. Set one up under Inventory, Locations.</p>
      )}
      {lines && lines.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-[var(--text-muted)]">
              <th className="py-2 pr-2">Item</th><th className="pr-2 text-right">Ordered</th><th className="pr-2 text-right">Outstanding</th>
              <th className="pr-2">Received</th><th className="pr-2">Rejected</th><th className="pr-2">Location</th>
            </tr></thead>
            <tbody>
              {lines.map((l) => {
                const out = outstandingQty(l)
                const e = entries[l.id] || {}
                return (
                  <tr key={l.id} className="border-t border-[var(--hairline)]">
                    <td className="py-2 pr-2"><span className="font-mono text-xs">{l.item_code || 'Not catalogued'}</span> {l.item_name || l.description}</td>
                    <td className="pr-2 text-right tabular-nums">{fmtNum(l.qty_ordered)}</td>
                    <td className="pr-2 text-right tabular-nums">{fmtNum(out)}</td>
                    <td className="pr-2"><input aria-label={`Received ${l.item_code || ''}`} className="input w-24 min-h-[40px]" type="number" min="0" step="any" disabled={!out} value={e.qty_received ?? ''} onChange={(ev) => setEntry(l.id, { qty_received: ev.target.value })} /></td>
                    <td className="pr-2">
                      <input aria-label={`Rejected ${l.item_code || ''}`} className="input w-24 min-h-[40px]" type="number" min="0" step="any" disabled={!out} value={e.qty_rejected ?? ''} onChange={(ev) => setEntry(l.id, { qty_rejected: ev.target.value })} />
                      {Number(e.qty_rejected) > 0 && (
                        <div className="mt-1 grid gap-1">
                          <select aria-label={`Rejection reason ${l.item_code || ''}`} className="input min-h-[40px]" value={e.rejection_code || ''} onChange={(ev) => setEntry(l.id, { rejection_code: ev.target.value })}>
                            <option value="">Why rejected?</option>
                            {REJECTION_CODES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                          </select>
                          <input aria-label={`Rejection note ${l.item_code || ''}`} className="input min-h-[40px]" maxLength={200} placeholder="Note (optional)" value={e.rejection_note || ''} onChange={(ev) => setEntry(l.id, { rejection_note: ev.target.value })} />
                        </div>
                      )}
                    </td>
                    <td className="pr-2">
                      <select aria-label={`Location ${l.item_code || ''}`} className="input min-h-[40px]" disabled={!out} value={e.location_id || ''} onChange={(ev) => setEntry(l.id, { location_id: ev.target.value })}>
                        <option value="">Choose</option>
                        {siteLocs.map((loc) => <option key={loc.id} value={loc.id}>{[loc.code, loc.name].filter(Boolean).join(' / ')}</option>)}
                      </select>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {error && <div role="alert" className="flex items-start gap-2 text-sm text-red-300"><AlertTriangle size={15} className="mt-0.5 shrink-0" />{error}</div>}
      {done && <p role="status" className="text-sm text-green-300">{done.replayed ? 'This receipt was already posted.' : `Received into stock as ${done.grn_no || 'a new GRN'} (${done.lines || 0} lines).`}</p>}
      {po && lines && lines.length > 0 && (
        <div className="flex justify-end">
          <button type="button" className="btn-primary text-sm inline-flex items-center gap-2 min-h-[44px]" onClick={submit} disabled={busy}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <PackageCheck size={15} />} Receive into stock
          </button>
        </div>
      )}
    </div>
  )
}

const EMPTY_SUPPLIER = { supplier_name: '', supplier_code: '', supplier_type: '', contact_person: '', phone: '', email: '', site: '', region: '', status: 'active', notes: '' }

/** The supplier master (the `suppliers` table POs and GRNs link to). */
export function SupplierRegister({ country }) {
  const caps = useProcurementCaps()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const q = useDebounced(search)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_SUPPLIER)
  const [busy, setBusy] = useState(false)
  const [formErr, setFormErr] = useState('')

  const load = useCallback(() => {
    setError('')
    listSuppliers({ country: scopedCountry(country) || undefined, search: q, limit: 200 })
      .then(setRows).catch((e) => { setError(toUserMessage(e, 'Could not load suppliers.')); setRows([]) })
  }, [country, q])
  useEffect(() => { load() }, [load])

  const open = (row) => { setEditing(row || {}); setForm(row ? { ...EMPTY_SUPPLIER, ...row } : EMPTY_SUPPLIER); setFormErr('') }
  const save = async () => {
    setBusy(true); setFormErr('')
    try {
      const values = { ...form, country: form.country || scopedCountry(country) }
      if (editing?.id) await updateSupplier(editing.id, values)
      else await createSupplier(values)
      setEditing(null); load()
    } catch (e) { setFormErr(toUserMessage(e, 'Could not save the supplier.')) } finally { setBusy(false) }
  }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Building2 size={16} aria-hidden="true" />
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">Supplier register</h2>
        <span className="text-xs text-[var(--text-muted)]">The suppliers purchase orders and goods receipts are raised against.</span>
        <div className="ml-auto flex gap-2">
          <input className="input min-h-[44px]" aria-label="Search suppliers" placeholder="Search suppliers" value={search} onChange={(e) => setSearch(e.target.value)} />
          {caps.procure && <button type="button" className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px]" onClick={() => open(null)}><Plus size={15} /> Add supplier</button>}
        </div>
      </div>
      {error && <p role="alert" className="text-xs text-red-300">{error} <button type="button" className="underline" onClick={load}>Retry</button></p>}
      {rows === null && !error && <p className="text-xs text-[var(--text-muted)]">Loading suppliers</p>}
      {rows && rows.length === 0 && !error && (
        <p className="text-sm text-[var(--text-muted)]">{q ? 'No supplier matches this search.' : 'No suppliers recorded yet.'}{!q && caps.procure ? ' Add the first one to start raising purchase orders.' : ''}</p>
      )}
      {rows && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-[var(--text-muted)]">
              <th className="py-2 pr-2">Supplier</th><th className="pr-2">Code</th><th className="pr-2">Contact</th><th className="pr-2">Country</th><th className="pr-2">Status</th><th />
            </tr></thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className="border-t border-[var(--hairline)]">
                  <td className="py-2 pr-2 font-medium">{s.supplier_name}</td>
                  <td className="pr-2 font-mono text-xs">{s.supplier_code || 'N/A'}</td>
                  <td className="pr-2">{[s.contact_person, s.phone, s.email].filter(Boolean).join(' | ') || 'N/A'}</td>
                  <td className="pr-2">{s.country || 'All'}</td>
                  <td className="pr-2">{s.status}</td>
                  <td className="text-right">{caps.procure && (
                    <button type="button" aria-label={`Edit ${s.supplier_name}`} className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg hover:bg-[var(--input-bg)]" onClick={() => open(s)}><Pencil size={15} /></button>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <Modal open onClose={busy ? undefined : () => setEditing(null)} size="md" title={editing.id ? 'Edit supplier' : 'Add supplier'}>
          <div className="space-y-3">
            {[
              ['supplier_name', 'Supplier name *', 200], ['supplier_code', 'Supplier code', 60], ['supplier_type', 'Type (e.g. tyres, spares)', 60],
              ['contact_person', 'Contact person', 200], ['phone', 'Phone', 60], ['email', 'Email', 200], ['site', 'Site', 120], ['region', 'Region', 120],
            ].map(([k, l, n]) => (
              <div key={k}>
                <label className="label" htmlFor={`sup-${k}`}>{l}</label>
                <input id={`sup-${k}`} className="input w-full" maxLength={n} value={form[k] || ''} onChange={(e) => set(k, e.target.value)} />
              </div>
            ))}
            <div>
              <label className="label" htmlFor="sup-status">Status</label>
              <select id="sup-status" className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                {SUPPLIER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <p className="text-xs text-[var(--text-muted)]">Country: {form.country || scopedCountry(country) || 'not set (visible in every country)'}</p>
            {formErr && <p role="alert" className="text-sm text-red-300">{formErr}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary text-sm min-h-[44px]" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
              <button type="button" className="btn-primary text-sm inline-flex items-center gap-2 min-h-[44px]" onClick={save} disabled={busy}>
                {busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save supplier
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

export { fmtMoney as formatProcurementMoney }
