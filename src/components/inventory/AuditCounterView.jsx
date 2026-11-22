/**
 * Blind count screen. The counter sees WHAT to count and WHERE, never how
 * many the system expects. The lines come from inv_audit_counter_view (which
 * does not return expected figures) and are stripped again client-side.
 *
 * A blank quantity is NOT a zero: to record "nothing on the shelf" the counter
 * ticks "Confirmed zero". Unexpected items found on the shelf are added as
 * extra lines and flagged `unexpected` for the reviewer.
 */
import { useMemo, useRef, useState } from 'react'
import { Plus, Send } from 'lucide-react'
import { useLanguage } from '../../contexts/LanguageContext'
import { getCounterView, submitCount, newIdempotencyKey, lookupCode } from '../../lib/api/inventory'
import { resolveLocationCode, pickItem, payloadSignature, splitSubmitResult } from '../../lib/inventory/countSubmit'
import { toUserMessage } from '../../lib/inventory/errorText'
import { useInvQuery, ErrorNote, NotSetUp, Note, Field } from './InvUi'

const CONDITIONS = ['new', 'used_serviceable', 'damaged', 'repairable', 'scrap']

export default function AuditCounterView({ audit, round = 1, onSubmitted }) {
  const { t } = useLanguage()
  const q = useInvQuery(() => getCounterView(audit.id), [audit.id])
  const [values, setValues] = useState({})
  const [extras, setExtras] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [confirm, setConfirm] = useState(false)
  // Lines already stored by the server (accepted / duplicate): never resent.
  const [done, setDone] = useState(() => new Set())
  // Per-line server refusals and per-extra resolution problems, by client_uuid.
  const [rejected, setRejected] = useState(() => new Map())
  const [extraErr, setExtraErr] = useState(() => new Map())
  const [notice, setNotice] = useState('')
  // One client_uuid per line for the life of this screen, and one request key
  // per distinct payload: a retry resends the IDENTICAL payload, so the server
  // replays it instead of refusing a "different" request.
  const uuids = useRef(new Map())
  const reqKey = useRef({ sig: null, key: null })
  const lines = useMemo(() => q.data?.lines || [], [q.data])

  const set = (k, field, v) => setValues((s) => ({ ...s, [k]: { ...(s[k] || {}), [field]: v } }))
  const keyOf = (l, i) => l.id || `${l.location_id || ''}|${l.item_id || ''}|${l.serial_no || ''}|${i}`
  const uuidOf = (k) => {
    if (!uuids.current.has(k)) uuids.current.set(k, newIdempotencyKey())
    return uuids.current.get(k)
  }
  const keyFor = (payload) => {
    const sig = payloadSignature(payload)
    if (reqKey.current.sig !== sig) reqKey.current = { sig, key: newIdempotencyKey() }
    return reqKey.current.key
  }

  const counted = lines.filter((l, i) => {
    const v = values[keyOf(l, i)]
    return v?.confirmed_zero || (v?.counted_qty !== undefined && v.counted_qty !== '')
  }).length

  const submit = async () => {
    setErr(''); setNotice('')
    const out = []
    for (const [i, l] of lines.entries()) {
      const k = keyOf(l, i)
      const v = values[k] || {}
      const hasQty = v.counted_qty !== undefined && v.counted_qty !== ''
      if (!hasQty && !v.confirmed_zero) continue
      const client_uuid = uuidOf(k)
      if (done.has(client_uuid)) continue
      const qty = v.confirmed_zero ? 0 : Number(v.counted_qty)
      if (!Number.isFinite(qty) || qty < 0) { setErr(t('inventory.count.badQty')); return }
      out.push({ ...l, client_uuid, counted_qty: qty, confirmed_zero: !!v.confirmed_zero, condition: v.condition || null, remarks: v.remarks || null })
    }
    const pending = extras.filter((x) => x.item_code.trim() && !done.has(x.id))
    for (const x of pending) {
      const qty = Number(x.counted_qty)
      if (!Number.isFinite(qty) || qty <= 0) { setErr(t('inventory.count.badExtra')); return }
    }
    if (!out.length && !pending.length) { setErr(t('inventory.count.nothing')); return }
    if (!confirm) { setConfirm(true); return }
    setBusy(true)
    try {
      // Extras are typed as codes; the server takes ids. Resolve each one, and
      // send nothing while any of them cannot be matched (never a silent drop).
      const problems = new Map()
      for (const x of pending) {
        const loc = resolveLocationCode(x.location_code, q.data?.locations || [])
        const found = await lookupCode(x.item_code.trim())
        const item = pickItem(x.item_code, found.items, audit.country)
        const e = item.error || loc.error
        if (e) { problems.set(x.id, e); continue }
        out.push({ client_uuid: x.id, item_id: item.id, location_id: loc.id, counted_qty: Number(x.counted_qty), unexpected: true, remarks: x.remarks || null })
      }
      setExtraErr(problems)
      if (problems.size) { setErr(t('inventory.count.extraUnresolved')); return }
      const res = await submitCount({ auditId: audit.id, lines: out, round }, keyFor(out))
      const split = splitSubmitResult(res, out)
      setDone((d) => new Set([...d, ...split.done]))
      setRejected(split.rejected)
      if (split.allDone) { onSubmitted?.(); return }
      setNotice(t('inventory.count.partialRejected', { done: out.length - split.rejected.size, rejected: split.rejected.size }))
    } catch (e) { setErr(toUserMessage(e)) } finally { setBusy(false); setConfirm(false) }
  }
  const reasonFor = (uuid) => {
    if (!rejected.has(uuid)) return null
    const r = rejected.get(uuid)
    return r ? t('inventory.count.rejectedReason', { reason: r }) : t('inventory.count.rejectedNoReason')
  }

  if (q.error) return <ErrorNote error={q.error} onRetry={q.retry} />
  if (q.data?.status === 'not_provisioned') return <NotSetUp what={t('inventory.objects.inventory_audits')} />
  if (q.loading && !q.data) return <div className="cc-skel" style={{ height: 160 }} />

  return (
    <div className="inv-hub" style={{ gap: 10 }}>
      <Note title={t('inventory.count.blindTitle')}>{t('inventory.count.blindBody')}</Note>
      <p className="cc-card-sub" aria-live="polite">{t('inventory.count.progress', { done: counted, total: lines.length })}</p>
      {lines.length === 0 && <div className="cc-empty">{t('inventory.count.noLines')}</div>}
      {lines.map((l, i) => {
        const k = keyOf(l, i)
        const v = values[k] || {}
        const u = uuids.current.get(k)
        const saved = !!u && done.has(u)
        const why = u ? reasonFor(u) : null
        return (
          <div key={k} className="inv-count-row">
            <div style={{ minWidth: 0 }}>
              <b style={{ color: 'var(--cc-ink)' }}>{l.item_code || l.serial_no || t('inventory.count.unnamed')}</b>
              <div className="cc-card-sub">{[l.description, l.location_code, l.serial_no && `${t('inventory.common.serial')} ${l.serial_no}`].filter(Boolean).join(' | ')}</div>
              {why && <div className="cc-card-sub" role="alert" style={{ color: 'var(--cc-bad, #b91c1c)' }}>{why}</div>}
            </div>
            <input className="inv-input inv-num" inputMode="decimal" type="number" min="0" step="any"
              aria-label={t('inventory.count.qtyFor', { item: l.item_code || l.serial_no || '' })}
              value={v.confirmed_zero ? '' : (v.counted_qty ?? '')} disabled={!!v.confirmed_zero || saved}
              onChange={(e) => set(k, 'counted_qty', e.target.value)} />
            <div className="inv-actions">
              <label className="inv-check">
                <input type="checkbox" checked={!!v.confirmed_zero} disabled={saved} onChange={(e) => set(k, 'confirmed_zero', e.target.checked)} />
                {t('inventory.count.confirmedZero')}
              </label>
              <select className="cc-select" aria-label={t('inventory.count.condition')} value={v.condition || ''} onChange={(e) => set(k, 'condition', e.target.value)}>
                <option value="">{t('inventory.count.condition')}</option>
                {CONDITIONS.map((c) => <option key={c} value={c}>{t(`inventory.conditions.${c}`)}</option>)}
              </select>
            </div>
          </div>
        )
      })}

      <h4 className="cc-card-title" style={{ marginTop: 8 }}>{t('inventory.count.extrasTitle')}</h4>
      <p className="cc-card-sub">{t('inventory.count.extrasBody')}</p>
      {extras.map((x, i) => (
        <div key={x.id} className="inv-form" aria-disabled={done.has(x.id) || undefined}>
          <Field label={t('inventory.common.item')}><input className="inv-input" value={x.item_code} onChange={(e) => setExtras((xs) => xs.map((y, j) => (j === i ? { ...y, item_code: e.target.value } : y)))} /></Field>
          <Field label={t('inventory.common.location')}><input className="inv-input" value={x.location_code} onChange={(e) => setExtras((xs) => xs.map((y, j) => (j === i ? { ...y, location_code: e.target.value } : y)))} /></Field>
          <Field label={t('inventory.count.qty')}><input className="inv-input" type="number" min="0" step="any" value={x.counted_qty} onChange={(e) => setExtras((xs) => xs.map((y, j) => (j === i ? { ...y, counted_qty: e.target.value } : y)))} /></Field>
          <Field label={t('inventory.count.remarks')}><input className="inv-input" value={x.remarks} onChange={(e) => setExtras((xs) => xs.map((y, j) => (j === i ? { ...y, remarks: e.target.value } : y)))} /></Field>
          {(extraErr.get(x.id) || reasonFor(x.id)) && (
            <div className="cc-card-sub" role="alert" style={{ color: 'var(--cc-bad, #b91c1c)' }}>
              {extraErr.get(x.id) ? t(extraErr.get(x.id)) : reasonFor(x.id)}
            </div>
          )}
        </div>
      ))}
      <div className="inv-actions">
        <button type="button" className="cc-btn-ghost" onClick={() => setExtras((xs) => [...xs, { id: newIdempotencyKey(), item_code: '', location_code: '', counted_qty: '', remarks: '' }])}>
          <Plus size={14} aria-hidden="true" /> {t('inventory.count.addExtra')}
        </button>
        <button type="button" className="cc-btn-primary" onClick={submit} disabled={busy}>
          <Send size={14} aria-hidden="true" /> {busy ? t('inventory.actions.saving') : confirm ? t('inventory.count.confirmSubmit') : t('inventory.count.submit')}
        </button>
      </div>
      {confirm && !busy && <Note tone="warn">{t('inventory.count.confirmBody')}</Note>}
      {notice && <Note tone="warn">{notice}</Note>}
      {err && <ErrorNote error={err} />}
    </div>
  )
}
