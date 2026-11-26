/**
 * Phone receipts waiting for approval (inv_store_receipt_requests).
 *
 * A store keeper records what arrived against an open PO line on the phone.
 * Stock moves only when a DIFFERENT person holding "receive" approves here;
 * the server refuses a self-decision and posts the GRN through
 * inv_receive_goods at the PO line price. Renders nothing when there is
 * nothing waiting or the migration is not applied yet.
 */
import { useCallback, useEffect, useState } from 'react'
import { Loader2, Smartphone } from 'lucide-react'
import { toUserMessage } from '../../lib/safeError'
import { useAuth } from '../../contexts/AuthContext'
import { listPendingStoreReceipts, decideStoreReceipt } from '../../lib/api/procurementChain'

const fmt = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? 'N/A' : Number(v).toLocaleString())

export default function PhoneReceiptsPanel({ country, onDecided }) {
  const { profile } = useAuth() || {}
  const [rows, setRows] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [notes, setNotes] = useState({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setRows(await listPendingStoreReceipts({ country }))
      setError('')
    } catch (e) {
      setError(toUserMessage(e, 'Phone receipts could not be loaded.'))
    } finally {
      setLoading(false)
    }
  }, [country])

  useEffect(() => { load() }, [load])

  const decide = async (row, decision) => {
    setBusyId(row.id)
    setError('')
    try {
      await decideStoreReceipt(row.id, decision, notes[row.id])
      await load()
      onDecided?.()
    } catch (e) {
      setError(toUserMessage(e, 'The receipt could not be decided.'))
    } finally {
      setBusyId(null)
    }
  }

  if (loading && !rows.length) return null
  if (!rows.length && !error) return null

  return (
    <section className="card p-4 space-y-3" aria-labelledby="phone-receipts-title">
      <div className="flex items-center gap-2">
        <Smartphone size={16} aria-hidden="true" />
        <h2 id="phone-receipts-title" className="font-semibold">Phone receipts waiting for approval ({rows.length})</h2>
      </div>
      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
        Recorded by a store keeper on the phone. Approving posts the goods receipt into stock at the purchase order price.
        The person who recorded a receipt cannot decide it.
      </p>
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      <ul className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
        {rows.map((r) => {
          const own = profile?.id && r.submitted_by === profile.id
          const po = r.purchase_orders || {}
          const item = r.material_master || {}
          return (
            <li key={r.id} className="py-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div className="text-sm">
                <div className="font-medium">
                  {po.po_number || 'PO'} · {[item.item_code, item.item_name].filter(Boolean).join(' ') || 'Item'}
                </div>
                <div style={{ color: 'var(--text-secondary)' }}>
                  {r.site} · {r.inventory_locations?.code || 'Location'} · received {fmt(r.qty_received)}
                  {Number(r.qty_rejected) > 0 ? `, rejected ${fmt(r.qty_rejected)} (${r.rejection_reason || 'no reason'})` : ''}
                  {r.delivery_note_no ? ` · DN ${r.delivery_note_no}` : ''}
                  {r.delivery_note_path ? ' · photo attached' : ''}
                </div>
              </div>
              {own ? (
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>You recorded this; another person must decide.</span>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <label className="sr-only" htmlFor={`sr-note-${r.id}`}>Reason or note</label>
                  <input
                    id={`sr-note-${r.id}`}
                    className="input text-sm min-h-[44px]"
                    placeholder="Reason (needed to reject)"
                    value={notes[r.id] || ''}
                    onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                  />
                  <button type="button" className="btn-primary text-sm min-h-[44px]" disabled={busyId === r.id}
                    onClick={() => decide(r, 'approve')}>
                    {busyId === r.id ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : 'Approve'}
                  </button>
                  <button type="button" className="btn-secondary text-sm min-h-[44px]" disabled={busyId === r.id || !(notes[r.id] || '').trim()}
                    onClick={() => decide(r, 'reject')}>
                    Reject
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
