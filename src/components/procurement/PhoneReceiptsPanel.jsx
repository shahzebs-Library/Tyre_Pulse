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
import { useLanguage } from '../../contexts/LanguageContext'
import { listPendingStoreReceipts, decideStoreReceipt } from '../../lib/api/procurementChain'

const fmt = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? 'N/A' : Number(v).toLocaleString())

export default function PhoneReceiptsPanel({ country, onDecided }) {
  const { profile } = useAuth() || {}
  const { t } = useLanguage()
  const k = (key, vars) => t(`procurement.phoneReceipts.${key}`, vars)
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
      setError(toUserMessage(e, t('procurement.phoneReceipts.loadFailed')))
    } finally {
      setLoading(false)
    }
  }, [country, t])

  useEffect(() => { load() }, [load])

  const decide = async (row, decision) => {
    setBusyId(row.id)
    setError('')
    try {
      await decideStoreReceipt(row.id, decision, notes[row.id])
      await load()
      onDecided?.()
    } catch (e) {
      setError(toUserMessage(e, k('decideFailed')))
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
        <h2 id="phone-receipts-title" className="font-semibold">{k('title', { count: rows.length })}</h2>
      </div>
      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
        {k('intro')}
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
                  {po.po_number || k('po')} · {[item.item_code, item.item_name].filter(Boolean).join(' ') || k('item')}
                </div>
                <div style={{ color: 'var(--text-secondary)' }}>
                  {r.site} · {r.inventory_locations?.code || k('location')} · {k('received', { qty: fmt(r.qty_received) })}
                  {Number(r.qty_rejected) > 0 ? ` · ${k('rejected', { qty: fmt(r.qty_rejected), reason: r.rejection_reason || k('noReason') })}` : ''}
                  {r.delivery_note_no ? ` · ${k('deliveryNote', { no: r.delivery_note_no })}` : ''}
                  {r.delivery_note_path ? ` · ${k('photo')}` : ''}
                </div>
              </div>
              {own ? (
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{k('ownReceipt')}</span>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <label className="sr-only" htmlFor={`sr-note-${r.id}`}>{k('noteLabel')}</label>
                  <input
                    id={`sr-note-${r.id}`}
                    className="input text-sm min-h-[44px]"
                    placeholder={k('notePlaceholder')}
                    value={notes[r.id] || ''}
                    onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                  />
                  <button type="button" className="btn-primary text-sm min-h-[44px]" disabled={busyId === r.id}
                    onClick={() => decide(r, 'approve')}>
                    {busyId === r.id ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : k('approve')}
                  </button>
                  <button type="button" className="btn-secondary text-sm min-h-[44px]" disabled={busyId === r.id || !(notes[r.id] || '').trim()}
                    onClick={() => decide(r, 'reject')}>
                    {k('reject')}
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
