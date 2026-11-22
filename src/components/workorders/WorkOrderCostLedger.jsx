/**
 * Cost ledger of one work order: the imported cost, approved additional costs,
 * approved adjustments and refunds, and the calculated total, with unapproved
 * entries shown apart (never in a total). Renders nothing when the ledger is not
 * installed on the database, so the screen is unchanged until the draft is applied.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  listCostEntries, addCostEntry, submitCostEntry, decideCostEntry, withdrawCostEntry, reverseCostEntry,
} from '../../lib/api/workOrderCosts'
import {
  summarizeWorkOrderCosts, COST_STATUS_LABEL, COST_RECON_LABEL, COST_SOURCE_LABEL, COST_SOURCES, COST_UNAPPROVED,
} from '../../lib/workOrderCosts'
import { toUserMessage } from '../../lib/safeError'

const SAFE_CODES = new Set(['42501', '22023', 'PT409'])
// The ledger functions raise plain sentences with these codes; anything else is sanitised.
const errText = (e) => (SAFE_CODES.has(String(e?.code)) && e?.cause?.message ? e.cause.message : toUserMessage(e))
const when = (v) => {
  const d = v ? new Date(v) : null
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'N/A'
}

export default function WorkOrderCostLedger({ order, currency, userId, canAdd, canApprove, names = {}, onChanged }) {
  const [state, setState] = useState({ available: false, entries: null, loaded: false })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [form, setForm] = useState({ description: '', itemCode: '', amount: '', source: 'manual', reason: '' })
  const orderId = order?.id

  const load = useCallback(async () => {
    const res = await listCostEntries(orderId)
    setState({ ...res, loaded: true })
  }, [orderId])
  useEffect(() => { setState({ available: false, entries: null, loaded: false }); setMsg(null); load() }, [load])

  const sum = useMemo(() => summarizeWorkOrderCosts(order, state.entries), [order, state.entries])
  if (!state.loaded || !state.available) return null

  const money = (n) => (n === null || n === undefined ? 'N/A' : `${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency || ''}`.trim())
  const who = (id) => names[id] || (id === userId ? 'You' : 'Another person')
  const run = async (fn, ok) => {
    setBusy(true); setMsg(null)
    try { await fn(); setMsg({ ok: true, text: ok }); await load(); onChanged?.() }
    catch (e) { setMsg({ ok: false, text: errText(e) }) }
    finally { setBusy(false) }
  }
  const add = () => run(async () => {
    const entry = await addCostEntry(orderId, {
      description: form.description, itemCode: form.itemCode, amount: Number(form.amount), source: form.source, reason: form.reason,
    })
    if (entry?.id) await submitCostEntry(entry.id)
    setForm({ description: '', itemCode: '', amount: '', source: 'manual', reason: '' })
  }, 'Cost entered. It counts only after it is approved.')
  const ask = (label) => window.prompt(label) || ''

  const row = 'flex justify-between gap-3 text-sm'
  const dim = { color: 'var(--text-secondary)' }
  const ink = { color: 'var(--text-primary)' }
  const field = 'rounded-lg border px-2 min-h-[40px] text-sm bg-[var(--surface-1)] border-[var(--border-dim)] text-[var(--text-primary)]'

  return (
    <section className="bg-[var(--surface-2)] rounded-xl p-4 space-y-3" aria-label="Cost ledger">
      <p className="text-xs" style={dim}>Cost ledger</p>
      {state.entries === null ? (
        <p role="alert" className="text-sm text-red-500">The cost entries could not be read. The figures below are the imported cost only.</p>
      ) : null}
      <div className="space-y-1.5">
        <div className={row}><span style={dim}>Imported cost (as stored)</span><span style={ink}>{money(sum.imported)}</span></div>
        <div className={row}><span style={dim}>Additional costs, approved</span><span style={ink}>{money(sum.additionalApproved)}</span></div>
        <div className={row}><span style={dim}>Adjustments, approved</span><span style={ink}>{money(sum.adjustmentsApproved)}</span></div>
        <div className={row}><span style={dim}>Refunds, approved</span><span style={ink}>{money(sum.refundsApproved === null ? null : -sum.refundsApproved)}</span></div>
        <div className={`${row} border-t border-[var(--border-bright)] pt-2`}>
          <span className="font-semibold" style={ink}>Calculated total</span>
          <span className="font-bold text-green-500">{money(sum.calculatedTotal)}</span>
        </div>
        {sum.unapprovedCount > 0 && (
          <div className={row}>
            <span className="text-amber-500">Not approved yet, not in any total ({sum.unapprovedCount})</span>
            <span className="text-amber-500">{money(sum.unapprovedAmount)}</span>
          </div>
        )}
      </div>

      {(state.entries || []).length > 0 && (
        <ul className="space-y-2">
          {state.entries.map((e) => {
            const open = COST_UNAPPROVED.includes(e.status)
            const waiting = e.status === 'pending_approval' || e.status === 'pending_reconciliation'
            return (
              <li key={e.id} className="rounded-lg border border-[var(--border-dim)] p-2.5 text-xs space-y-1">
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="font-medium text-sm break-words" style={ink}>{e.description}{e.item_code ? ` (${e.item_code})` : ''}</span>
                  <span className="font-semibold" style={ink}>{e.entry_kind === 'refund' ? '-' : ''}{money(e.amount).replace(currency || '', e.currency || '')}</span>
                </div>
                <p style={dim}>{COST_STATUS_LABEL[e.status] || e.status} | {COST_RECON_LABEL[e.reconciliation] || 'N/A'} | {COST_SOURCE_LABEL[e.source] || e.source}{e.source_ref ? ` ${e.source_ref}` : ''}</p>
                <p style={dim}>Entered by {who(e.created_by)} on {when(e.created_at)}. Why: {e.reason}</p>
                {e.decided_at && <p style={dim}>{e.status === 'rejected' ? 'Rejected' : 'Approved'} by {who(e.decided_by)} on {when(e.decided_at)}{e.decision_note ? `. ${e.decision_note}` : ''}</p>}
                {e.status === 'rejected' && !e.decided_at && e.decision_note && <p style={dim}>{e.decision_note}</p>}
                {e.reversed_at && <p style={dim}>Reversed by {who(e.reversed_by)} on {when(e.reversed_at)}. {e.reversal_reason}</p>}
                <div className="flex flex-wrap gap-2 pt-1">
                  {e.status === 'draft' && e.created_by === userId && (
                    <button type="button" disabled={busy} className="btn-secondary text-xs px-3 min-h-[36px]" onClick={() => run(() => submitCostEntry(e.id), 'Sent for approval.')}>Send for approval</button>
                  )}
                  {open && e.created_by === userId && (
                    <button type="button" disabled={busy} className="btn-secondary text-xs px-3 min-h-[36px]" onClick={() => run(() => withdrawCostEntry(e.id), 'Withdrawn.')}>Withdraw</button>
                  )}
                  {waiting && canApprove && e.created_by !== userId && (
                    <>
                      <button type="button" disabled={busy} className="btn-primary text-xs px-3 min-h-[36px]"
                        onClick={() => {
                          const note = e.status === 'pending_reconciliation' ? ask('How was this cost checked against the imported amount?') : ''
                          if (e.status === 'pending_reconciliation' && !note.trim()) return
                          run(() => decideCostEntry(e.id, 'approved', note), 'Cost approved.')
                        }}>Approve</button>
                      <button type="button" disabled={busy} className="btn-secondary text-xs px-3 min-h-[36px]"
                        onClick={() => { const note = ask('Why is this cost rejected?'); if (note.trim()) run(() => decideCostEntry(e.id, 'rejected', note), 'Cost rejected.') }}>Reject</button>
                    </>
                  )}
                  {waiting && canApprove && e.created_by === userId && <span style={dim}>You entered this cost, so another person has to decide it.</span>}
                  {e.status === 'approved' && canApprove && (
                    <button type="button" disabled={busy} className="btn-secondary text-xs px-3 min-h-[36px]"
                      onClick={() => { const r = ask('Why is this approved cost reversed?'); if (r.trim()) run(() => reverseCostEntry(e.id, r), 'Cost reversed.') }}>Reverse</button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {canAdd && (
        <div className="space-y-2 border-t border-[var(--border-dim)] pt-3">
          <p className="text-xs" style={dim}>Add a cost (draft until approved)</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input aria-label="What the cost is" placeholder="What the cost is" className={field} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <input aria-label="Item code, if known" placeholder="Item code, if known" className={field} value={form.itemCode} onChange={(e) => setForm({ ...form, itemCode: e.target.value })} />
            <input aria-label={`Amount in ${currency || 'the work order currency'}`} placeholder={`Amount (${currency || 'currency'})`} type="number" min="0" step="0.01" className={field} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            <select aria-label="Source" className={field} value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
              {COST_SOURCES.map((s) => <option key={s} value={s}>{COST_SOURCE_LABEL[s]}</option>)}
            </select>
            <input aria-label="Why it is added" placeholder="Why it is added" className={`${field} sm:col-span-2`} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </div>
          <button type="button" className="btn-primary text-sm px-4 min-h-[40px] disabled:opacity-50"
            disabled={busy || !form.description.trim() || !form.reason.trim() || !(Number(form.amount) > 0)} onClick={add}>Add cost</button>
        </div>
      )}
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`text-sm ${msg.ok ? 'text-green-600' : 'text-red-500'}`}>{msg.text}</p>}
    </section>
  )
}
