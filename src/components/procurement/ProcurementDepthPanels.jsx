/**
 * Procurement depth panels (migration 20261124130000). Each panel is
 * self-contained with props { scope, can, userId, onNavigate }:
 *
 *   SupplierApprovalPanel      approved supplier list (second person approves)
 *   RfqPanel                   request quotes -> compare per currency -> award -> Draft PO
 *   BackorderPanel             ordered vs received vs outstanding per PO line
 *   SupplierReturnsPanel       send rejected or defective goods back against a GRN
 *   ThreeWayMatchPanel         PO line vs GRN vs supplier invoice (finance view)
 *   SupplierPerformancePanel   on-time %, short / split deliveries, rejects, returns
 *   EmergencyPurchasesPanel    emergency orders waiting for after-the-fact approval
 *
 * The database is the boundary: every write is a SECURITY DEFINER RPC that
 * re-checks company, country, site, capability and separation of duties.
 * `can()` only hides buttons. Money is shown in its own currency and never
 * added across currencies; a missing price reads "No price", never 0.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, CheckCircle2, ClipboardList, FileCheck2, Gauge, Loader2, PackageMinus, Plus, RefreshCw, Siren, Trash2, Truck, BadgeCheck,
} from 'lucide-react'
import { toUserMessage } from '../../lib/safeError'
import { MaterialPicker } from './ProcurementChainPanels'
import {
  NOT_SET_UP, newIdempotencyKey, listSuppliersForApproval, setSupplierApproval, listRfqs, createRfq, recordQuote, awardRfq, cancelRfq,
  listBackorders, listEmergencyPurchases, approveEmergencyPurchase, listReturnableReceipts, listSupplierReturns, postSupplierReturn,
  listSupplierInvoices, createSupplierInvoice, matchSupplierInvoice, listPoLinesForInvoice, listInvoiceablePurchaseOrders,
  listSupplierPerformance,
} from '../../lib/api/procurementDepth'
import {
  compareQuotes, awardNeedsReason, summariseBackorders, rateSupplier, returnableQty, MATCH_STATUS, REJECTION_CODES, formatMoneyIn,
} from '../../lib/procurement/procurementDepth'
import { EMERGENCY_EXPORT_HEADERS, emergencyExportValues, categoryLabel, impactText, estimateText } from '../../lib/procurement/emergencyJustification'
import { EmergencyJustificationView } from './EmergencyJustification'

const fmtNum = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? 'N/A' : Number(v).toLocaleString('en-US'))
const fmtDate = (v) => {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}
const canDo = (can, cap) => (typeof can === 'function' ? !!can(cap) : false)
const COUNTRY_CURRENCY = { KSA: 'SAR', UAE: 'AED', EGYPT: 'EGP' }

/** Load once per scope; { loading, error, notSetUp, rows, reload }. */
function useLoad(loader, deps) {
  const [st, setSt] = useState({ loading: true, error: '', notSetUp: false, rows: [] })
  const reload = useCallback(() => {
    let live = true
    setSt((s) => ({ ...s, loading: true, error: '' }))
    loader().then((r) => {
      if (!live) return
      setSt({ loading: false, error: '', notSetUp: r?.status === 'not_provisioned', rows: r?.rows || [] })
    }).catch((e) => { if (live) setSt({ loading: false, error: toUserMessage(e, 'Could not load this list.'), notSetUp: false, rows: [] }) })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => reload(), [reload])
  return { ...st, reload }
}

function Frame({ icon: Icon, title, sub, action, children }) {
  return (
    <section className="card space-y-3 min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          {Icon && <Icon size={16} className="mt-0.5 shrink-0" aria-hidden="true" />}
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h2>
            {sub && <p className="text-xs text-[var(--text-muted)]">{sub}</p>}
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function States({ st, empty, children }) {
  if (st.loading && !st.rows.length) return <div className="space-y-2" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="cc-skel" style={{ height: 30 }} />)}</div>
  if (st.notSetUp) return <p className="text-xs text-amber-300" role="note">{NOT_SET_UP}</p>
  if (st.error) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-red-300">
        <AlertTriangle size={15} aria-hidden="true" />{st.error}
        <button type="button" className="underline min-h-[44px]" onClick={st.reload}>Try again</button>
      </div>
    )
  }
  if (!st.rows.length) return <p className="text-sm text-[var(--text-muted)]">{empty}</p>
  return children
}

function Pill({ tone = 'muted', children }) { return <span className={`cc-pill ${tone}`}>{children}</span> }
function Msg({ error, ok }) {
  if (error) return <p role="alert" className="flex items-start gap-2 text-sm text-red-300"><AlertTriangle size={15} className="mt-0.5 shrink-0" />{error}</p>
  if (ok) return <p role="status" className="text-sm text-green-300">{ok}</p>
  return null
}
const Reload = ({ onClick }) => (
  <button type="button" className="cc-btn-ghost inline-flex items-center gap-1 min-h-[44px]" onClick={onClick} aria-label="Refresh">
    <RefreshCw size={14} aria-hidden="true" /> Refresh
  </button>
)
const Table = ({ children }) => <div className="overflow-x-auto -mx-1"><table className="w-full text-sm min-w-[560px]">{children}</table></div>
const Th = ({ children, right }) => <th className={`py-2 pr-2 text-xs font-medium text-[var(--text-muted)] ${right ? 'text-right' : 'text-left'}`}>{children}</th>
const Td = ({ children, right, mono }) => <td className={`py-2 pr-2 align-top ${right ? 'text-right tabular-nums' : ''} ${mono ? 'font-mono text-xs' : ''}`}>{children}</td>

// ── Approved supplier list ──────────────────────────────────────────────────

export function SupplierApprovalPanel({ scope = {}, can, userId }) {
  const st = useLoad(() => listSuppliersForApproval({ country: scope.country }), [scope.country])
  const [busy, setBusy] = useState(''); const [msg, setMsg] = useState({})
  const allowed = canDo(can, 'procure')
  const decide = async (s, approved) => {
    setBusy(s.id); setMsg({})
    try {
      await setSupplierApproval({ supplierId: s.id, approved }, newIdempotencyKey())
      setMsg({ ok: `${s.supplier_name} ${approved ? 'is now approved for purchasing' : 'was removed from the approved list'}.` })
      st.reload()
    } catch (e) { setMsg({ error: toUserMessage(e, 'Could not change the approval.') }) } finally { setBusy('') }
  }
  const approvedCount = st.rows.filter((r) => r.approved_for_purchasing).length
  return (
    <Frame icon={BadgeCheck} title="Approved supplier list" action={<Reload onClick={st.reload} />}
      sub={`Quotations can be requested only from approved suppliers. A supplier is approved by a buyer other than the person who added it. ${approvedCount} of ${st.rows.length} approved.`}>
      <Msg {...msg} />
      <States st={st} empty="No suppliers yet. Add suppliers in the supplier register first.">
        <Table>
          <thead><tr><Th>Supplier</Th><Th>Country</Th><Th>Status</Th><Th>Approved for purchasing</Th><Th>Action</Th></tr></thead>
          <tbody>
            {st.rows.map((s) => {
              const own = userId && s.created_by === userId
              return (
                <tr key={s.id} className="border-t border-[var(--hairline)]">
                  <Td>{s.supplier_name}{s.supplier_code && <span className="block font-mono text-xs text-[var(--text-muted)]">{s.supplier_code}</span>}</Td>
                  <Td>{s.country || 'All'}</Td>
                  <Td>{s.status || 'N/A'}</Td>
                  <Td>{s.approved_for_purchasing ? <Pill tone="good">Approved {fmtDate(s.approved_at)}</Pill> : <Pill>Not approved</Pill>}</Td>
                  <Td>
                    {!allowed ? <span className="text-xs text-[var(--text-muted)]">Needs procure rights</span>
                      : s.approved_for_purchasing
                        ? <button type="button" className="cc-btn-ghost min-h-[44px]" disabled={busy === s.id} onClick={() => decide(s, false)}>Remove</button>
                        : own ? <span className="text-xs text-[var(--text-muted)]">You added this supplier; another buyer approves it</span>
                          : <button type="button" className="cc-btn min-h-[44px]" disabled={busy === s.id || String(s.status).toLowerCase() !== 'active'} onClick={() => decide(s, true)}>
                            {busy === s.id ? <Loader2 size={14} className="animate-spin" /> : 'Approve'}
                          </button>}
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      </States>
    </Frame>
  )
}

// ── RFQ ─────────────────────────────────────────────────────────────────────

function NewRfqForm({ scope, onCreated }) {
  const [lines, setLines] = useState([{ item: null, description: '', qty: '' }])
  const [title, setTitle] = useState(''); const [neededBy, setNeededBy] = useState('')
  const [picked, setPicked] = useState([]); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState({})
  // One key per request: minted when the form opens, reused by every retry of
  // the same request, renewed after a success or when the request changes.
  const [key, setKey] = useState(() => newIdempotencyKey())
  const sup = useLoad(() => listSuppliersForApproval({ country: scope.country }), [scope.country])
  const approved = sup.rows.filter((s) => s.approved_for_purchasing && String(s.status).toLowerCase() === 'active')
  const setLine = (i, patch) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  useEffect(() => { setKey(newIdempotencyKey()) }, [lines, title, neededBy, picked])
  const submit = async () => {
    setMsg({})
    if (!scope.country) { setMsg({ error: 'Choose one country at the top of the page first.' }); return }
    const clean = lines.filter((l) => (l.item || l.description.trim()) && Number(l.qty) > 0)
    if (!clean.length) { setMsg({ error: 'Add at least one line with an item and a quantity.' }); return }
    if (!picked.length) { setMsg({ error: 'Choose at least one approved supplier.' }); return }
    setBusy(true)
    try {
      const r = await createRfq({
        country: scope.country, site: scope.site, title, neededBy, supplierIds: picked,
        lines: clean.map((l) => ({ item_id: l.item?.id || null, description: l.item ? `${l.item.item_code} ${l.item.item_name || ''}`.trim() : l.description, qty: l.qty })),
      }, key)
      setMsg({ ok: `Quotation request ${r?.rfq_no || ''} created.` })
      setLines([{ item: null, description: '', qty: '' }]); setPicked([]); setTitle(''); setNeededBy('')
      onCreated?.()
    } catch (e) { setMsg({ error: toUserMessage(e, 'Could not create the quotation request.') }) } finally { setBusy(false) }
  }
  return (
    <div className="rounded-lg border border-[var(--hairline)] p-3 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><label className="label" htmlFor="rfq-title">Title (optional)</label>
          <input id="rfq-title" className="input w-full min-h-[44px]" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div><label className="label" htmlFor="rfq-needed">Needed by (optional)</label>
          <input id="rfq-needed" type="date" className="input w-full min-h-[44px]" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} /></div>
      </div>
      {lines.map((l, i) => (
        <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_120px_44px] gap-2 items-end">
          <MaterialPicker id={`rfq-item-${i}`} country={scope.country} value={l.item} onPick={(it) => setLine(i, { item: it })} />
          <div><label className="label" htmlFor={`rfq-qty-${i}`}>Quantity</label>
            <input id={`rfq-qty-${i}`} type="number" min="0" step="any" className="input w-full min-h-[44px]" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} /></div>
          <button type="button" className="cc-btn-ghost min-h-[44px]" aria-label={`Remove line ${i + 1}`} disabled={lines.length === 1}
            onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
        </div>
      ))}
      <button type="button" className="cc-btn-ghost inline-flex items-center gap-1 min-h-[44px]" onClick={() => setLines((ls) => [...ls, { item: null, description: '', qty: '' }])}>
        <Plus size={14} /> Add line
      </button>
      <fieldset>
        <legend className="label">Ask these approved suppliers</legend>
        {sup.loading ? <p className="text-xs text-[var(--text-muted)]">Loading suppliers</p>
          : approved.length === 0 ? <p className="text-xs text-amber-300">No approved, active supplier for this country yet. Approve one in the approved supplier list.</p>
            : <div className="flex flex-wrap gap-2">{approved.map((s) => (
              <label key={s.id} className="inline-flex items-center gap-2 text-sm min-h-[44px]">
                <input type="checkbox" checked={picked.includes(s.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, s.id] : p.filter((x) => x !== s.id)))} />
                {s.supplier_name}
              </label>
            ))}</div>}
      </fieldset>
      <Msg {...msg} />
      <div className="flex justify-end">
        <button type="button" className="btn-primary min-h-[44px] inline-flex items-center gap-2" disabled={busy} onClick={submit}>
          {busy && <Loader2 size={14} className="animate-spin" />} Send for quotation
        </button>
      </div>
    </div>
  )
}

function QuoteEntry({ rfq, onSaved }) {
  const [supplierId, setSupplierId] = useState(''); const [currency, setCurrency] = useState(COUNTRY_CURRENCY[String(rfq.country).toUpperCase()] || '')
  const [lead, setLead] = useState(''); const [validUntil, setValidUntil] = useState(''); const [ref, setRef] = useState('')
  const [prices, setPrices] = useState({}); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState({})
  const sup = useLoad(() => listSuppliersForApproval({ country: rfq.country }), [rfq.country])
  const approved = sup.rows.filter((s) => s.approved_for_purchasing && String(s.status).toLowerCase() === 'active')
  const save = async () => {
    setMsg({})
    if (!supplierId) { setMsg({ error: 'Choose the supplier who quoted.' }); return }
    if (!/^[A-Za-z]{3}$/.test(currency)) { setMsg({ error: 'Enter the quote currency as a 3-letter code.' }); return }
    setBusy(true)
    try {
      await recordQuote({
        rfqId: rfq.id, supplierId, currency, leadTimeDays: lead, validUntil, quoteRef: ref,
        lines: rfq.lines.map((l) => ({ rfq_line_id: l.id, unit_price: prices[l.id] ?? null })),
      }, newIdempotencyKey())
      setMsg({ ok: 'Quote saved.' }); setPrices({}); setSupplierId(''); setRef(''); setLead(''); setValidUntil('')
      onSaved?.()
    } catch (e) { setMsg({ error: toUserMessage(e, 'Could not save the quote.') }) } finally { setBusy(false) }
  }
  return (
    <div className="rounded-lg border border-[var(--hairline)] p-3 space-y-2">
      <h3 className="text-xs font-semibold text-[var(--text-secondary)]">Record a supplier quote</h3>
      <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
        <div className="sm:col-span-2"><label className="label" htmlFor={`q-sup-${rfq.id}`}>Supplier</label>
          <select id={`q-sup-${rfq.id}`} className="input w-full min-h-[44px]" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">{sup.loading ? 'Loading' : 'Choose'}</option>
            {approved.map((s) => <option key={s.id} value={s.id}>{s.supplier_name}</option>)}
          </select></div>
        <div><label className="label" htmlFor={`q-cur-${rfq.id}`}>Currency</label>
          <input id={`q-cur-${rfq.id}`} className="input w-full min-h-[44px] uppercase" maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} /></div>
        <div><label className="label" htmlFor={`q-lead-${rfq.id}`}>Lead time (days)</label>
          <input id={`q-lead-${rfq.id}`} type="number" min="0" className="input w-full min-h-[44px]" value={lead} onChange={(e) => setLead(e.target.value)} /></div>
        <div><label className="label" htmlFor={`q-valid-${rfq.id}`}>Valid until</label>
          <input id={`q-valid-${rfq.id}`} type="date" className="input w-full min-h-[44px]" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></div>
      </div>
      <div><label className="label" htmlFor={`q-ref-${rfq.id}`}>Supplier quote reference (optional)</label>
        <input id={`q-ref-${rfq.id}`} className="input w-full min-h-[44px]" maxLength={60} value={ref} onChange={(e) => setRef(e.target.value)} /></div>
      {rfq.lines.map((l) => (
        <div key={l.id} className="grid grid-cols-[1fr_130px] gap-2 items-center">
          <span className="text-sm min-w-0 truncate">{l.item_code && <span className="font-mono text-xs">{l.item_code} </span>}{l.item_name} x {fmtNum(l.qty)}</span>
          <input aria-label={`Unit price ${l.item_code || l.line_no}`} type="number" min="0" step="any" placeholder="No bid" className="input min-h-[44px]"
            value={prices[l.id] ?? ''} onChange={(e) => setPrices((p) => ({ ...p, [l.id]: e.target.value }))} />
        </div>
      ))}
      <Msg {...msg} />
      <div className="flex justify-end"><button type="button" className="cc-btn min-h-[44px]" disabled={busy} onClick={save}>{busy ? <Loader2 size={14} className="animate-spin" /> : 'Save quote'}</button></div>
    </div>
  )
}

function RfqDetail({ rfq, allowed, onChanged, onNavigate }) {
  const cmp = useMemo(() => compareQuotes(rfq.lines, rfq.quotes), [rfq])
  const [choice, setChoice] = useState(''); const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState({})
  const needReason = choice && awardNeedsReason(cmp, choice)
  const award = async () => {
    setMsg({})
    if (needReason && !reason.trim()) { setMsg({ error: 'Give a reason: this is not the lowest full quote in one currency.' }); return }
    setBusy(true)
    try {
      const r = await awardRfq({ rfqId: rfq.id, quoteId: choice, reason }, newIdempotencyKey())
      setMsg({ ok: `Awarded. Draft purchase order ${r?.po_number || ''} created for ${formatMoneyIn(r?.total, r?.currency)}. It still needs approval by another person.` })
      onChanged?.()
    } catch (e) { setMsg({ error: toUserMessage(e, 'Could not award the quote.') }) } finally { setBusy(false) }
  }
  const cancel = async () => {
    const why = window.prompt('Why cancel this quotation request?')
    if (!why) return
    setBusy(true); setMsg({})
    try { await cancelRfq({ rfqId: rfq.id, reason: why }, newIdempotencyKey()); onChanged?.() } catch (e) { setMsg({ error: toUserMessage(e, 'Could not cancel.') }) } finally { setBusy(false) }
  }
  return (
    <div className="space-y-3">
      {cmp.mixedCurrency && (
        <p className="text-xs text-amber-300" role="note">Quotes are in more than one currency ({cmp.currencies.join(', ')}). Totals are compared only within the same currency; awarding needs a reason.</p>
      )}
      {rfq.quotes.length === 0 ? <p className="text-sm text-[var(--text-muted)]">No quotes recorded yet.</p> : (
        <Table>
          <thead><tr><Th>Line</Th>{cmp.quotes.map((q) => <Th key={q.id} right>{q.supplier_name}<span className="block">{q.currency}{q.lead_time_days != null ? `, ${q.lead_time_days} days` : ''}</span></Th>)}</tr></thead>
          <tbody>
            {rfq.lines.map((l) => (
              <tr key={l.id} className="border-t border-[var(--hairline)]">
                <Td>{l.item_code && <span className="font-mono text-xs">{l.item_code} </span>}{l.item_name} x {fmtNum(l.qty)}</Td>
                {cmp.quotes.map((q) => {
                  const c = q.cells.find((x) => x.rfq_line_id === l.id)
                  const best = cmp.lineBest[l.id]?.[q.currency] === q.id
                  return <Td key={q.id} right>{c?.unit_price == null ? <span className="cc-na">No bid</span> : <span className={best ? 'text-green-300 font-semibold' : ''}>{formatMoneyIn(c.unit_price, q.currency)}</span>}</Td>
                })}
              </tr>
            ))}
            <tr className="border-t border-[var(--hairline)] font-semibold">
              <Td>Total (own currency)</Td>
              {cmp.quotes.map((q) => <Td key={q.id} right>{formatMoneyIn(q.total, q.currency)}{!q.complete && <span className="block text-xs text-amber-300">Not every line priced</span>}{q.isLowest && <span className="block"><Pill tone="good">Lowest {q.currency}</Pill></span>}</Td>)}
            </tr>
          </tbody>
        </Table>
      )}
      {rfq.status === 'open' && allowed && (
        <>
          <QuoteEntry rfq={rfq} onSaved={onChanged} />
          {rfq.quotes.length > 0 && (
            <div className="rounded-lg border border-[var(--hairline)] p-3 space-y-2">
              <h3 className="text-xs font-semibold text-[var(--text-secondary)]">Choose the winner</h3>
              <select aria-label="Winning quote" className="input w-full min-h-[44px]" value={choice} onChange={(e) => setChoice(e.target.value)}>
                <option value="">Choose a quote</option>
                {cmp.quotes.filter((q) => q.status === 'received').map((q) => <option key={q.id} value={q.id}>{q.supplier_name}: {formatMoneyIn(q.total, q.currency)}{q.isLowest ? ' (lowest)' : ''}</option>)}
              </select>
              {needReason && <textarea aria-label="Reason for choosing this quote" className="input w-full" rows={2} maxLength={500} placeholder="Why this supplier (faster delivery, genuine parts, warranty)" value={reason} onChange={(e) => setReason(e.target.value)} />}
              <div className="flex flex-wrap justify-end gap-2">
                <button type="button" className="cc-btn-ghost min-h-[44px]" disabled={busy} onClick={cancel}>Cancel request</button>
                <button type="button" className="btn-primary min-h-[44px]" disabled={busy || !choice} onClick={award}>{busy ? <Loader2 size={14} className="animate-spin" /> : 'Award and create PO'}</button>
              </div>
            </div>
          )}
        </>
      )}
      {rfq.status === 'awarded' && (
        <p className="text-sm text-[var(--text-secondary)]">Awarded {fmtDate(rfq.awarded_at)}{rfq.award_reason ? `. Reason: ${rfq.award_reason}` : ''}.
          {onNavigate && <button type="button" className="underline ml-1 min-h-[44px]" onClick={() => onNavigate('procurement')}>Open purchase orders</button>}</p>
      )}
      <Msg {...msg} />
    </div>
  )
}

export function RfqPanel({ scope = {}, can, onNavigate }) {
  const [status, setStatus] = useState('open'); const [open, setOpen] = useState(null); const [showNew, setShowNew] = useState(false)
  const st = useLoad(() => listRfqs({ country: scope.country, site: scope.site, status: status || undefined }), [scope.country, scope.site, status])
  const allowed = canDo(can, 'procure')
  return (
    <Frame icon={ClipboardList} title="Quotation requests (RFQ)"
      sub="Ask approved suppliers for prices, compare them per currency, then award one quote to create a Draft purchase order."
      action={<div className="flex flex-wrap gap-2">
        <select aria-label="Status" className="input min-h-[44px]" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="open">Open</option><option value="awarded">Awarded</option><option value="cancelled">Cancelled</option><option value="">All</option>
        </select>
        {allowed && <button type="button" className="cc-btn min-h-[44px] inline-flex items-center gap-1" onClick={() => setShowNew((v) => !v)}><Plus size={14} /> New request</button>}
        <Reload onClick={st.reload} />
      </div>}>
      {showNew && allowed && <NewRfqForm scope={scope} onCreated={() => { setShowNew(false); st.reload() }} />}
      <States st={st} empty={status === 'open' ? 'No open quotation requests.' : 'No quotation requests in this view.'}>
        <ul className="space-y-2">
          {st.rows.map((r) => (
            <li key={r.id} className="rounded-lg border border-[var(--hairline)]">
              <button type="button" className="w-full text-left p-3 min-h-[44px] flex flex-wrap items-center justify-between gap-2" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>
                <span className="min-w-0"><span className="font-mono text-xs">{r.rfq_no}</span> {r.title || r.lines.map((l) => l.item_code || l.item_name).slice(0, 2).join(', ')}
                  <span className="block text-xs text-[var(--text-muted)]">{r.country}{r.site ? ` / ${r.site}` : ''} | {r.lines.length} lines | {r.quotes.length} quotes{r.needed_by ? ` | needed by ${fmtDate(r.needed_by)}` : ''}</span></span>
                <Pill tone={r.status === 'open' ? 'info' : r.status === 'awarded' ? 'good' : 'muted'}>{r.status}</Pill>
              </button>
              {open === r.id && <div className="p-3 pt-0"><RfqDetail rfq={r} allowed={allowed} onChanged={st.reload} onNavigate={onNavigate} /></div>}
            </li>
          ))}
        </ul>
      </States>
    </Frame>
  )
}

// ── Backorders ──────────────────────────────────────────────────────────────

export function BackorderPanel({ scope = {} }) {
  const [onlyOverdue, setOnlyOverdue] = useState(false)
  const st = useLoad(() => listBackorders({ country: scope.country, site: scope.site }), [scope.country, scope.site])
  const sum = useMemo(() => summariseBackorders(st.rows), [st.rows])
  const rows = onlyOverdue ? st.rows.filter((r) => r.is_overdue) : st.rows
  return (
    <Frame icon={Truck} title="Backorders and partial deliveries" action={<Reload onClick={st.reload} />}
      sub="Every purchase order line with quantity still to come: ordered, received, accepted, rejected, returned and outstanding.">
      {!st.loading && !st.error && !st.notSetUp && st.rows.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs">
          <Pill tone="info">{sum.openLines} open lines on {sum.openPos} POs</Pill>
          <Pill tone={sum.overdueLines ? 'bad' : 'good'}>{sum.overdueLines} overdue{sum.maxDaysOverdue ? `, oldest ${sum.maxDaysOverdue} days` : ''}</Pill>
          {Object.entries(sum.valueByCurrency).map(([c, v]) => <Pill key={c}>{formatMoneyIn(v, c)} outstanding</Pill>)}
          {sum.unvaluedLines > 0 && <Pill tone="warn">{sum.unvaluedLines} lines without a price</Pill>}
          <label className="inline-flex items-center gap-2 min-h-[44px]"><input type="checkbox" checked={onlyOverdue} onChange={(e) => setOnlyOverdue(e.target.checked)} /> Overdue only</label>
        </div>
      )}
      <States st={{ ...st, rows }} empty={onlyOverdue ? 'Nothing is overdue.' : 'Nothing is outstanding. Every ordered quantity has been received.'}>
        <Table>
          <thead><tr><Th>PO</Th><Th>Supplier</Th><Th>Item</Th><Th right>Ordered</Th><Th right>Received</Th><Th right>Rejected</Th><Th right>Returned</Th><Th right>Outstanding</Th><Th>Due</Th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.po_line_id} className="border-t border-[var(--hairline)]">
                <Td mono>{r.po_number}{r.is_emergency && <span className="block"><Pill tone="warn">Emergency</Pill></span>}</Td>
                <Td>{r.supplier_name || 'N/A'}</Td>
                <Td>{r.item_code && <span className="font-mono text-xs">{r.item_code} </span>}{r.item_name || 'N/A'}</Td>
                <Td right>{fmtNum(r.qty_ordered)}</Td><Td right>{fmtNum(r.qty_received)}</Td><Td right>{fmtNum(r.qty_rejected)}</Td>
                <Td right>{fmtNum(r.returned_qty)}</Td><Td right><strong>{fmtNum(r.qty_outstanding)}</strong></Td>
                <Td>{r.expected_delivery ? fmtDate(r.expected_delivery) : 'No date'}{r.is_overdue && <span className="block"><Pill tone="bad">{r.days_overdue} days late</Pill></span>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </States>
    </Frame>
  )
}

// ── Supplier returns ────────────────────────────────────────────────────────

export function SupplierReturnsPanel({ scope = {}, can }) {
  const grns = useLoad(() => listReturnableReceipts({ country: scope.country, site: scope.site }), [scope.country, scope.site])
  const rets = useLoad(() => listSupplierReturns({ country: scope.country, site: scope.site }), [scope.country, scope.site])
  const [grnId, setGrnId] = useState(''); const [reason, setReason] = useState(''); const [entries, setEntries] = useState({})
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState({}); const [key, setKey] = useState(() => newIdempotencyKey())
  const allowed = canDo(can, 'receive')
  const grn = grns.rows.find((g) => g.id === grnId) || null
  const returnedLines = useMemo(() => rets.rows.flatMap((r) => r.lines || []), [rets.rows])
  const setE = (id, patch) => setEntries((e) => ({ ...e, [id]: { source: 'rejected', ...e[id], ...patch } }))
  const submit = async () => {
    setMsg({})
    if (!reason.trim()) { setMsg({ error: 'Give a reason for the return.' }); return }
    setBusy(true)
    try {
      const r = await postSupplierReturn({
        grnId, reason, lines: Object.entries(entries).map(([id, e]) => ({ grn_line_id: id, source: e.source || 'rejected', qty: e.qty, reason_code: e.reason_code })),
      }, key)
      setMsg({ ok: r?.replayed ? 'This return was already posted.' : `Return ${r?.return_no || ''} posted.` })
      setKey(newIdempotencyKey()); setEntries({}); setReason('')
      rets.reload(); grns.reload()
    } catch (e) { setMsg({ error: toUserMessage(e, 'Could not post the return.') }) } finally { setBusy(false) }
  }
  return (
    <Frame icon={PackageMinus} title="Supplier returns" action={<Reload onClick={() => { grns.reload(); rets.reload() }} />}
      sub="Send rejected goods back, or return accepted goods found defective (this takes them out of stock through the ledger). You can never return more than was received.">
      {allowed ? (
        <States st={grns} empty="No goods receipts yet.">
          <div className="space-y-3">
            <div><label className="label" htmlFor="sret-grn">Goods receipt</label>
              <select id="sret-grn" className="input w-full min-h-[44px]" value={grnId} onChange={(e) => { setGrnId(e.target.value); setEntries({}) }}>
                <option value="">Choose a receipt</option>
                {grns.rows.map((g) => <option key={g.id} value={g.id}>{g.grn_no} | {g.supplier || 'No supplier'} | {fmtDate(g.received_date)}</option>)}
              </select></div>
            {grn && (
              <>
                <Table>
                  <thead><tr><Th>Item</Th><Th right>Rejected left</Th><Th right>Accepted left</Th><Th>Return from</Th><Th>Qty</Th><Th>Reason</Th></tr></thead>
                  <tbody>
                    {(grn.lines || []).map((l) => {
                      const left = returnableQty(l, returnedLines)
                      const e = entries[l.id] || {}
                      return (
                        <tr key={l.id} className="border-t border-[var(--hairline)]">
                          <Td><span className="font-mono text-xs">{l.item?.item_code || 'N/A'}</span> {l.item?.item_name}{l.rejection_code && <span className="block text-xs text-[var(--text-muted)]">Rejected: {l.rejection_code.replace('_', ' ')}</span>}</Td>
                          <Td right>{fmtNum(left.rejected)}</Td><Td right>{fmtNum(left.accepted)}</Td>
                          <Td><select aria-label="Return from" className="input min-h-[40px]" value={e.source || 'rejected'} onChange={(ev) => setE(l.id, { source: ev.target.value })}>
                            <option value="rejected">Rejected goods</option><option value="accepted">Accepted, defective</option></select></Td>
                          <Td><input aria-label="Quantity to return" type="number" min="0" step="any" max={(e.source || 'rejected') === 'accepted' ? left.accepted : left.rejected}
                            className="input w-24 min-h-[40px]" value={e.qty ?? ''} onChange={(ev) => setE(l.id, { qty: ev.target.value })} /></Td>
                          <Td><select aria-label="Reason code" className="input min-h-[40px]" value={e.reason_code || ''} onChange={(ev) => setE(l.id, { reason_code: ev.target.value })}>
                            <option value="">As received</option>{REJECTION_CODES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></Td>
                        </tr>
                      )
                    })}
                  </tbody>
                </Table>
                <div><label className="label" htmlFor="sret-reason">Reason for the return</label>
                  <input id="sret-reason" className="input w-full min-h-[44px]" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
                <Msg {...msg} />
                <div className="flex justify-end"><button type="button" className="btn-primary min-h-[44px]" disabled={busy} onClick={submit}>{busy ? <Loader2 size={14} className="animate-spin" /> : 'Post return'}</button></div>
              </>
            )}
          </div>
        </States>
      ) : <p className="text-xs text-[var(--text-muted)]">Posting a return needs receiving rights.</p>}
      <h3 className="text-xs font-semibold text-[var(--text-secondary)] pt-2">Recent returns</h3>
      <States st={rets} empty="No supplier returns yet.">
        <Table>
          <thead><tr><Th>Return</Th><Th>Supplier</Th><Th>Date</Th><Th right>Rejected sent back</Th><Th right>Defective returned</Th><Th>Reason</Th></tr></thead>
          <tbody>{rets.rows.map((r) => {
            const sumOf = (src) => (r.lines || []).filter((l) => l.source === src).reduce((s, l) => s + Number(l.qty || 0), 0)
            return (
              <tr key={r.id} className="border-t border-[var(--hairline)]">
                <Td mono>{r.return_no}</Td><Td>{r.supplier?.supplier_name || 'N/A'}</Td><Td>{fmtDate(r.created_at)}</Td>
                <Td right>{fmtNum(sumOf('rejected'))}</Td><Td right>{fmtNum(sumOf('accepted'))}</Td><Td>{r.reason}</Td>
              </tr>
            )
          })}</tbody>
        </Table>
      </States>
    </Frame>
  )
}

// ── Three-way match ─────────────────────────────────────────────────────────

function NewInvoiceForm({ scope, onSaved }) {
  const pos = useLoad(() => listInvoiceablePurchaseOrders({ country: scope.country }), [scope.country])
  const [poId, setPoId] = useState(''); const [invoiceNo, setInvoiceNo] = useState(''); const [invoiceDate, setInvoiceDate] = useState('')
  const [tol, setTol] = useState('2'); const [entries, setEntries] = useState({}); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState({})
  // Keys minted when the form opens and reused by retries, so a retry after a
  // lost response replays the same invoice instead of creating a second one.
  // A saved invoice id is kept so a failed match retries only the match.
  const [keys, setKeys] = useState(() => ({ create: newIdempotencyKey(), match: newIdempotencyKey() }))
  const [savedId, setSavedId] = useState(null)
  const renew = () => { setKeys({ create: newIdempotencyKey(), match: newIdempotencyKey() }); setSavedId(null) }
  // Changing what the invoice says makes it a new request, so it gets a new key.
  useEffect(() => { if (!savedId) setKeys((k) => ({ ...k, create: newIdempotencyKey() })) }, [invoiceDate, tol, entries, savedId])
  const po = pos.rows.find((p) => p.id === poId) || null
  const lines = useLoad(() => listPoLinesForInvoice(poId), [poId])
  const save = async () => {
    setMsg({})
    if (!po || !invoiceNo.trim()) { setMsg({ error: 'Choose a PO and enter the supplier invoice number.' }); return }
    setBusy(true)
    try {
      let id = savedId
      if (!id) {
        const r = await createSupplierInvoice({
          country: po.country, supplierId: po.supplier_id, invoiceNo, invoiceDate, currency: po.currency, poId: po.id, tolerancePct: tol,
          lines: lines.rows.map((l) => ({ po_line_id: l.po_line_id, item_id: l.item_id, qty: entries[l.po_line_id]?.qty, unit_price: entries[l.po_line_id]?.price })),
        }, keys.create)
        id = r?.id || r
        setSavedId(id)
      }
      const m = await matchSupplierInvoice(id, keys.match)
      setMsg({ ok: `Invoice saved. Match result: ${MATCH_STATUS[m?.match_status]?.label || m?.match_status || 'checked'}.` })
      setEntries({}); setInvoiceNo(''); renew(); onSaved?.()
    } catch (e) { setMsg({ error: toUserMessage(e, 'Could not save the invoice.') }) } finally { setBusy(false) }
  }
  return (
    <div className="rounded-lg border border-[var(--hairline)] p-3 space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
        <div className="sm:col-span-2"><label className="label" htmlFor="inv-po">Purchase order</label>
          <select id="inv-po" className="input w-full min-h-[44px]" value={poId} disabled={!!savedId} onChange={(e) => { setPoId(e.target.value); setEntries({}); renew() }}>
            <option value="">{pos.loading ? 'Loading' : pos.rows.length ? 'Choose a PO' : 'No ordered POs with a supplier'}</option>
            {pos.rows.map((p) => <option key={p.id} value={p.id}>{p.po_number} | {p.supplier_name} | {p.currency || 'No currency'}</option>)}
          </select></div>
        <div><label className="label" htmlFor="inv-no">Invoice number</label><input id="inv-no" className="input w-full min-h-[44px]" maxLength={60} value={invoiceNo} disabled={!!savedId} onChange={(e) => { setInvoiceNo(e.target.value); renew() }} /></div>
        <div><label className="label" htmlFor="inv-date">Invoice date</label><input id="inv-date" type="date" className="input w-full min-h-[44px]" value={invoiceDate} disabled={!!savedId} onChange={(e) => setInvoiceDate(e.target.value)} /></div>
      </div>
      <div className="max-w-[200px]"><label className="label" htmlFor="inv-tol">Price tolerance (%)</label><input id="inv-tol" type="number" min="0" step="any" className="input w-full min-h-[44px]" value={tol} disabled={!!savedId} onChange={(e) => setTol(e.target.value)} /></div>
      {po && !po.currency && <p className="text-xs text-amber-300">This PO has no currency, so an invoice cannot be matched against it.</p>}
      {po && (lines.loading ? <p className="text-xs text-[var(--text-muted)]">Loading PO lines</p> : (
        <Table>
          <thead><tr><Th>Item</Th><Th right>Ordered</Th><Th right>Accepted</Th><Th right>PO price</Th><Th>Invoiced qty</Th><Th>Invoice price</Th></tr></thead>
          <tbody>{lines.rows.map((l) => (
            <tr key={l.po_line_id} className="border-t border-[var(--hairline)]">
              <Td>{l.item_code && <span className="font-mono text-xs">{l.item_code} </span>}{l.item_name}</Td>
              <Td right>{fmtNum(l.qty_ordered)}</Td><Td right>{fmtNum(l.qty_accepted)}</Td><Td right>{formatMoneyIn(l.unit_price, l.currency)}</Td>
              <Td><input aria-label="Invoiced quantity" type="number" min="0" step="any" className="input w-24 min-h-[40px]" value={entries[l.po_line_id]?.qty ?? ''} disabled={!!savedId} onChange={(e) => setEntries((x) => ({ ...x, [l.po_line_id]: { ...x[l.po_line_id], qty: e.target.value } }))} /></Td>
              <Td><input aria-label="Invoice unit price" type="number" min="0" step="any" className="input w-28 min-h-[40px]" value={entries[l.po_line_id]?.price ?? ''} disabled={!!savedId} onChange={(e) => setEntries((x) => ({ ...x, [l.po_line_id]: { ...x[l.po_line_id], price: e.target.value } }))} /></Td>
            </tr>
          ))}</tbody>
        </Table>
      ))}
      {savedId && <p role="status" className="text-xs text-[var(--text-secondary)]">The invoice is saved with the values shown; only the match check is retried. To correct a value, record the invoice again from the invoice list once this one is matched or cancelled.</p>}
      <Msg {...msg} />
      <div className="flex justify-end"><button type="button" className="btn-primary min-h-[44px]" disabled={busy || !po?.currency} onClick={save}>{busy ? <Loader2 size={14} className="animate-spin" /> : 'Save and check match'}</button></div>
    </div>
  )
}

export function ThreeWayMatchPanel({ scope = {}, can }) {
  const st = useLoad(() => listSupplierInvoices({ country: scope.country }), [scope.country])
  const [showNew, setShowNew] = useState(false); const [open, setOpen] = useState(null); const [busy, setBusy] = useState(''); const [msg, setMsg] = useState({})
  const allowed = canDo(can, 'procure') || canDo(can, 'financial_post')
  const recheck = async (id) => {
    setBusy(id); setMsg({})
    try { await matchSupplierInvoice(id, newIdempotencyKey()); st.reload() } catch (e) { setMsg({ error: toUserMessage(e, 'Could not check the match.') }) } finally { setBusy('') }
  }
  return (
    <Frame icon={FileCheck2} title="Three-way match (PO, receipt, invoice)"
      sub="Checks each supplier invoice line against the PO price (within the tolerance, same currency) and the quantity accepted into stock, net of returns and earlier invoices. Nothing is posted to accounting."
      action={<div className="flex gap-2">{allowed && <button type="button" className="cc-btn min-h-[44px] inline-flex items-center gap-1" onClick={() => setShowNew((v) => !v)}><Plus size={14} /> Record invoice</button>}<Reload onClick={st.reload} /></div>}>
      {showNew && allowed && <NewInvoiceForm scope={scope} onSaved={() => { setShowNew(false); st.reload() }} />}
      <Msg {...msg} />
      <States st={st} empty="No supplier invoices recorded yet.">
        <Table>
          <thead><tr><Th>Invoice</Th><Th>Supplier</Th><Th>PO</Th><Th right>Amount</Th><Th>Match</Th><Th>Action</Th></tr></thead>
          <tbody>{st.rows.map((i) => {
            const m = MATCH_STATUS[i.match_status] || MATCH_STATUS.pending
            return [
              <tr key={i.id} className="border-t border-[var(--hairline)]">
                <Td mono>{i.invoice_no}<span className="block text-[var(--text-muted)]">{fmtDate(i.invoice_date)}</span></Td>
                <Td>{i.supplier?.supplier_name || 'N/A'}</Td><Td mono>{i.po?.po_number || 'None'}</Td>
                <Td right>{formatMoneyIn(i.total_amount, i.currency)}</Td>
                <Td><Pill tone={m.tone}>{m.label}</Pill></Td>
                <Td><div className="flex flex-wrap gap-1">
                  <button type="button" className="cc-btn-ghost min-h-[44px]" aria-expanded={open === i.id} onClick={() => setOpen(open === i.id ? null : i.id)}>Lines</button>
                  {allowed && <button type="button" className="cc-btn-ghost min-h-[44px]" disabled={busy === i.id} onClick={() => recheck(i.id)}>Re-check</button>}
                </div></Td>
              </tr>,
              open === i.id && (
                <tr key={`${i.id}-d`}><td colSpan={6} className="pb-3">
                  {(i.match_details || []).length === 0 ? <p className="text-xs text-[var(--text-muted)]">Not checked yet.</p> : (
                    <Table>
                      <thead><tr><Th>Line</Th><Th right>Invoiced</Th><Th right>Accepted net</Th><Th right>Earlier invoices</Th><Th right>Invoice price</Th><Th right>PO price</Th><Th>Result</Th></tr></thead>
                      <tbody>{i.match_details.map((d) => (
                        <tr key={d.line_no} className="border-t border-[var(--hairline)]">
                          <Td>{d.line_no}</Td><Td right>{fmtNum(d.invoice_qty)}</Td><Td right>{fmtNum(d.received_accepted_qty)}</Td><Td right>{fmtNum(d.previously_invoiced_qty)}</Td>
                          <Td right>{formatMoneyIn(d.invoice_price, i.currency)}</Td><Td right>{formatMoneyIn(d.po_price, i.currency)}</Td>
                          <Td><Pill tone={(MATCH_STATUS[d.status] || MATCH_STATUS.pending).tone}>{(MATCH_STATUS[d.status] || MATCH_STATUS.pending).label}</Pill></Td>
                        </tr>
                      ))}</tbody>
                    </Table>
                  )}
                </td></tr>
              ),
            ]
          })}</tbody>
        </Table>
      </States>
    </Frame>
  )
}

// ── Supplier performance ────────────────────────────────────────────────────

export function SupplierPerformancePanel({ scope = {} }) {
  const st = useLoad(() => listSupplierPerformance({ country: scope.country }), [scope.country])
  const rows = st.rows.filter((r) => Number(r.orders_placed) > 0 || Number(r.qty_received) > 0 || r.approved_for_purchasing)
  return (
    <Frame icon={Gauge} title="Supplier delivery performance" action={<Reload onClick={st.reload} />}
      sub="Measured from real purchase orders and goods receipts. On-time means the last receipt of a fully received order arrived by its expected date. Rates read N/A until something is measurable.">
      <States st={{ ...st, rows }} empty="No supplier has orders or receipts yet, so nothing can be measured.">
        <Table>
          <thead><tr><Th>Supplier</Th><Th right>Orders</Th><Th right>On time</Th><Th right>Late</Th><Th right>On-time %</Th><Th right>Open overdue</Th><Th right>Short</Th><Th right>Split</Th><Th right>Reject %</Th><Th right>Returned</Th><Th>Rating</Th></tr></thead>
          <tbody>{rows.map((r) => {
            const rt = rateSupplier(r)
            return (
              <tr key={r.supplier_id} className="border-t border-[var(--hairline)]">
                <Td>{r.supplier_name}{r.approved_for_purchasing && <span className="block"><Pill tone="good">Approved</Pill></span>}</Td>
                <Td right>{fmtNum(r.orders_placed)}</Td><Td right>{fmtNum(r.on_time)}</Td><Td right>{fmtNum(r.late)}</Td>
                <Td right>{r.on_time_pct == null ? 'N/A' : `${r.on_time_pct}%`}</Td><Td right>{fmtNum(r.open_overdue)}</Td>
                <Td right>{fmtNum(r.short_deliveries)}</Td><Td right>{fmtNum(r.split_deliveries)}</Td>
                <Td right>{r.reject_pct == null ? 'N/A' : `${r.reject_pct}%`}</Td><Td right>{r.qty_returned == null ? '0' : fmtNum(r.qty_returned)}</Td>
                <Td><Pill tone={rt.tone}>{rt.label}</Pill></Td>
              </tr>
            )
          })}</tbody>
        </Table>
      </States>
    </Frame>
  )
}

// ── Emergency purchases ─────────────────────────────────────────────────────

export function EmergencyPurchasesPanel({ scope = {}, can, userId }) {
  const st = useLoad(() => listEmergencyPurchases({ country: scope.country, site: scope.site }), [scope.country, scope.site])
  const [busy, setBusy] = useState(''); const [msg, setMsg] = useState({})
  // One key per purchase order for the life of this panel, so a retry after a
  // lost response replays the same approval instead of posting a second one.
  const [approveKeys] = useState(() => new Map())
  const keyFor = (id) => { if (!approveKeys.has(id)) approveKeys.set(id, newIdempotencyKey()); return approveKeys.get(id) }
  // Overrun reason per PO; a changed reason is a new request, so it gets a new key.
  const [reasons, setReasons] = useState({})
  const setReason = (id, v) => { setReasons((r) => ({ ...r, [id]: v })); approveKeys.delete(id) }
  const allowed = canDo(can, 'procure')
  const waiting = st.rows.filter((r) => !r.emergency_approved_at)
  const approve = async (po) => {
    setBusy(po.id); setMsg({})
    try { await approveEmergencyPurchase(po.id, keyFor(po.id), reasons[po.id]); setMsg({ ok: `${po.po_number} approved after the fact.` }); st.reload() }
    catch (e) { setMsg({ error: toUserMessage(e, 'Could not approve.') }) } finally { setBusy('') }
  }
  const age = (d) => (d ? Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 3600000)) : null)
  const [open, setOpen] = useState('')
  const [exporting, setExporting] = useState(false)
  const exportRows = async () => {
    setExporting(true); setMsg({})
    try {
      const { exportToExcel } = await import('../../lib/exportUtils')
      const head = ['PO', 'Supplier', 'Country', 'Site', 'Status', 'Order value', 'Currency']
      const rows = st.rows.map((p) => ({
        'PO': p.po_number, 'Supplier': p.supplier_name || p.vendor_name || '', 'Country': p.country || '', 'Site': p.site || '',
        'Status': p.status, 'Order value': Number(p.total_amount) > 0 ? formatMoneyIn(p.total_amount, p.currency) : '', 'Currency': p.currency || '',
        ...emergencyExportValues(p),
      }))
      const cols = [...head, ...EMERGENCY_EXPORT_HEADERS]
      await exportToExcel(rows, cols, cols, 'Emergency purchases', 'Emergency purchases')
    } catch (e) { setMsg({ error: toUserMessage(e, 'Could not export.') }) } finally { setExporting(false) }
  }
  return (
    <Frame icon={Siren} title="Emergency purchases"
      action={<div className="flex flex-wrap gap-2">
        <button type="button" className="cc-btn-ghost min-h-[44px]" disabled={!st.rows.length || exporting} onClick={exportRows}>
          {exporting ? <Loader2 size={14} className="animate-spin" /> : 'Export Excel'}
        </button>
        <Reload onClick={st.reload} />
      </div>}
      sub="An emergency order may be placed before approval, but it must be approved afterwards by someone other than the buyer, within the same approval limits.">
      {!st.loading && !st.notSetUp && !st.error && (
        <p className="text-xs"><Pill tone={waiting.length ? 'bad' : 'good'}>{waiting.length} waiting for approval</Pill></p>
      )}
      <Msg {...msg} />
      <States st={st} empty="No emergency purchases.">
        <Table>
          <thead><tr><Th>PO</Th><Th>Supplier</Th><Th>Status</Th><Th right>Value</Th><Th>Justification</Th><Th>Approval</Th></tr></thead>
          <tbody>{st.rows.map((p) => {
            const own = userId && (p.created_by === userId || p.emergency_declared_by === userId)
            const hrs = age(p.emergency_declared_at)
            return (
              <tr key={p.id} className="border-t border-[var(--hairline)]">
                <Td mono>{p.po_number}<span className="block text-[var(--text-muted)]">{fmtDate(p.emergency_declared_at)}</span></Td>
                <Td>{p.supplier_name || p.vendor_name || 'N/A'}</Td><Td>{p.status}</Td>
                <Td right>{formatMoneyIn(Number(p.total_amount) > 0 ? p.total_amount : null, p.currency)}</Td>
                <Td>
                  <span className="block">{categoryLabel(p.emergency_category)}{p.emergency_asset_no ? `, ${p.emergency_asset_no}` : ''}{p.emergency_job_card_no ? `, ${p.emergency_job_card_no}` : ''}</span>
                  <span className="block text-xs text-[var(--text-muted)]">{impactText(p)}. Estimate {estimateText(p)}.</span>
                  <button type="button" className="underline text-xs min-h-[44px]" aria-expanded={open === p.id}
                    onClick={() => setOpen(open === p.id ? '' : p.id)}>{open === p.id ? 'Hide full justification' : 'Show full justification'}</button>
                  {open === p.id && <div className="mt-1 max-w-[420px]"><EmergencyJustificationView po={p} compact /></div>}
                </Td>
                <Td>{p.emergency_approved_at ? <Pill tone="good"><CheckCircle2 size={12} aria-hidden="true" /> {p.emergency_approved_by} {fmtDate(p.emergency_approved_at)}</Pill>
                  : ['Draft', 'Submitted'].includes(p.status) ? <span className="text-xs text-[var(--text-muted)]">Use the normal approval</span>
                    : !allowed ? <Pill tone="bad">Waiting {hrs != null ? `${hrs} h` : ''}</Pill>
                      : own ? <span className="text-xs text-[var(--text-muted)]">Waiting {hrs != null ? `${hrs} h` : ''}; another buyer approves</span>
                        : <div className="flex flex-col gap-1 min-w-[200px]">
                          <label className="text-xs text-[var(--text-muted)]" htmlFor={`overrun-${p.id}`}>Reason if more than 10% over the estimate</label>
                          <textarea id={`overrun-${p.id}`} rows={2} maxLength={1000} className="cc-input text-sm"
                            value={reasons[p.id] || ''} onChange={(e) => setReason(p.id, e.target.value)} />
                          <button type="button" className="cc-btn min-h-[44px]" disabled={busy === p.id} onClick={() => approve(p)}>{busy === p.id ? <Loader2 size={14} className="animate-spin" /> : 'Approve now'}</button>
                        </div>}</Td>
              </tr>
            )
          })}</tbody>
        </Table>
      </States>
    </Frame>
  )
}
