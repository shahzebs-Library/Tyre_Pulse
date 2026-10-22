import { useEffect, useState } from 'react'
import { supabase } from '../../lib/api/_client'
import { toUserMessage } from '../../lib/safeError'
import { listBroadcastPushQueue } from '../../lib/api/teamMessaging'
import { summarizeDelivery, DELIVERY_LABELS, DELIVERY_HELP, DELIVERY_STATES } from '../../lib/teamDeliveryStates'

/** Manager-facing recipient engagement, based only on actual persisted events. */
export default function MessageEngagement({ history = [] }) {
  const [messageId, setMessageId] = useState('')
  const [receipts, setReceipts] = useState([])
  const [replies, setReplies] = useState([])
  const [pushEvents, setPushEvents] = useState([])
  const [queueRows, setQueueRows] = useState([])
  const [queueError, setQueueError] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const selected = history.find((h) => h.id === messageId)
  useEffect(() => {
    if (!messageId) { setReceipts([]); setReplies([]); setPushEvents([]); setQueueRows([]); setQueueError(''); return }
    let active = true
    setLoading(true); setError('')
    Promise.all([
      supabase.from('broadcast_recipient_receipts')
        .select('recipient_id,read_at,acknowledged_at')
        .eq('broadcast_id', messageId).limit(5000),
      supabase.from('broadcast_replies')
        .select('id,author_id,body,created_at')
        .eq('broadcast_id', messageId).order('created_at', { ascending: true }).limit(500),
      supabase.from('team_push_device_events')
        .select('user_id,event_type,occurred_at')
        .eq('entity_id', messageId).limit(5000),
      listBroadcastPushQueue(messageId).then((rows) => ({ rows }), (e) => ({ failed: e })),
    ]).then(([r, m, p, q]) => {
      if (!active) return
      if (r.error || m.error || p.error) throw r.error || m.error || p.error
      setReceipts(r.data || [])
      setReplies(m.data || [])
      setPushEvents(p.data || [])
      setQueueRows(q.rows || [])
      setQueueError(q.failed ? 'Push queue status could not be loaded; delivery states below are incomplete.' : '')
    }).catch((e) => { if (active) { setError(toUserMessage(e, 'Could not load message engagement.')); setReceipts([]); setReplies([]); setPushEvents([]); setQueueRows([]) } })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [messageId, refresh])
  const read = receipts.filter((r) => !!r.read_at).length
  const acknowledged = receipts.filter((r) => !!r.acknowledged_at).length
  const delivery = summarizeDelivery(queueRows, pushEvents)
  const foregroundReceived = new Set(pushEvents.filter((e) => e.event_type === 'received_foreground').map((e) => e.user_id)).size
  const openedFromPush = new Set(pushEvents.filter((e) => e.event_type === 'opened_by_user').map((e) => e.user_id)).size
  return <section className="card space-y-4" aria-label="Recipient engagement">
    <div className="flex flex-wrap justify-between gap-3">
      <div>
        <h3 className="font-semibold text-[var(--text-primary)]">Recipient acknowledgements & replies</h3>
        <p className="text-xs text-[var(--text-muted)]">Verified employee actions only. Queued phone pushes are not delivery confirmations.</p>
      </div>
      <button type="button" className="btn-ghost text-xs" onClick={() => setRefresh((v) => v + 1)} disabled={!messageId || loading}>Refresh</button>
    </div>
    <label className="block space-y-1">
      <span className="text-xs font-semibold text-[var(--text-muted)]">Sent communication</span>
      <select className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-primary)]"
        value={messageId} onChange={(e) => setMessageId(e.target.value)}>
        <option value="">Select a message</option>
        {history.slice(0, 200).map((m) => <option key={m.id} value={m.id}>{m.title || 'Untitled'} · {new Date(m.sent_at || m.created_at).toLocaleDateString()}</option>)}
      </select>
    </label>
    {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    {loading && <p role="status" className="text-xs text-[var(--text-muted)]">Loading recipient activity…</p>}
    {messageId && !error && !loading && <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {[
          ['Addressed', selected?.recipient_count ?? 'N/A'],
          ['Receipts recorded', receipts.length],
          ['Read by employee', read],
          ['Acknowledged', acknowledged],
          ['Foreground received (device-reported)', foregroundReceived],
          ['Opened via push', openedFromPush],
        ].map(([label, value]) => <div key={label} className="rounded-lg border border-[var(--border-subtle)] p-3">
          <p className="text-xs text-[var(--text-muted)]">{label}</p>
          <p className="mt-1 text-xl font-semibold text-[var(--text-primary)]">{value}</p>
        </div>)}
      </div>
      <div className="rounded-lg border border-[var(--border-subtle)] p-3" aria-label="Push delivery states">
        <p className="text-xs font-semibold text-[var(--text-muted)]">Push status: <span className="text-[var(--text-primary)]" data-testid="delivery-headline">{DELIVERY_LABELS[delivery.headline]}</span></p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">{DELIVERY_HELP[delivery.headline]}</p>
        <dl className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
          {DELIVERY_STATES.map((k) => <div key={k}>
            <dt className="text-xs text-[var(--text-muted)]">{DELIVERY_LABELS[k]}</dt>
            <dd className="text-lg font-semibold text-[var(--text-primary)]">{delivery.counts[k]}</dd>
          </div>)}
        </dl>
        {delivery.acceptedDevices > 0 && <p className="mt-1 text-xs text-[var(--text-muted)]">{delivery.acceptedDevices} device message(s) accepted by the provider. Acceptance is not proof the phone displayed it.</p>}
        {delivery.lastError && <p className="mt-1 text-xs text-red-400">Last error: {delivery.lastError}</p>}
        {queueError && <p role="alert" className="mt-1 text-xs text-amber-400">{queueError}</p>}
      </div>
      <p className="text-xs text-[var(--text-secondary)]">{replies.length} {replies.length === 1 ? 'reply' : 'replies'} recorded. No claim of phone delivery is made.</p>
      {replies.length ? <div className="max-h-80 space-y-2 overflow-y-auto">
        {replies.map((r) => <div key={r.id} className="rounded-lg border border-[var(--border-subtle)] p-3">
          <p className="whitespace-pre-wrap text-sm text-[var(--text-primary)]">{r.body}</p>
          <p className="mt-2 text-xs text-[var(--text-muted)]">{r.author_id} · {new Date(r.created_at).toLocaleString()}</p>
        </div>)}
      </div> : <p className="text-xs text-[var(--text-muted)]">No employee replies yet.</p>}
    </>}
  </section>
}
