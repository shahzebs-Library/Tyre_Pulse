/**
 * Blind count screen. The counter sees WHAT to count and WHERE, never how
 * many the system expects. The lines come from inv_audit_counter_view (which
 * does not return expected figures) and are stripped again client-side.
 *
 * A blank quantity is NOT a zero: to record "nothing on the shelf" the counter
 * ticks "Confirmed zero". Unexpected items found on the shelf are added as
 * extra lines and flagged `unexpected` for the reviewer.
 */
import { useMemo, useState } from 'react'
import { Plus, Send } from 'lucide-react'
import { useLanguage } from '../../contexts/LanguageContext'
import { getCounterView, submitCount, newIdempotencyKey } from '../../lib/api/inventory'
import { toUserMessage } from '../../lib/safeError'
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
  const [key] = useState(() => newIdempotencyKey())
  const lines = useMemo(() => q.data?.lines || [], [q.data])

  const set = (k, field, v) => setValues((s) => ({ ...s, [k]: { ...(s[k] || {}), [field]: v } }))
  const keyOf = (l, i) => l.id || `${l.location_id || ''}|${l.item_id || ''}|${l.serial_no || ''}|${i}`

  const counted = lines.filter((l, i) => {
    const v = values[keyOf(l, i)]
    return v?.confirmed_zero || (v?.counted_qty !== undefined && v.counted_qty !== '')
  }).length

  const submit = async () => {
    setErr('')
    const out = []
    for (const [i, l] of lines.entries()) {
      const v = values[keyOf(l, i)] || {}
      const hasQty = v.counted_qty !== undefined && v.counted_qty !== ''
      if (!hasQty && !v.confirmed_zero) continue
      const qty = v.confirmed_zero ? 0 : Number(v.counted_qty)
      if (!Number.isFinite(qty) || qty < 0) { setErr(t('inventory.count.badQty')); return }
      out.push({ ...l, counted_qty: qty, confirmed_zero: !!v.confirmed_zero, condition: v.condition || null, remarks: v.remarks || null })
    }
    for (const x of extras) {
      if (!x.item_code.trim()) continue
      const qty = Number(x.counted_qty)
      if (!Number.isFinite(qty) || qty <= 0) { setErr(t('inventory.count.badExtra')); return }
      out.push({ item_code: x.item_code.trim(), location_code: x.location_code.trim() || null, counted_qty: qty, unexpected: true, remarks: x.remarks || null })
    }
    if (!out.length) { setErr(t('inventory.count.nothing')); return }
    if (!confirm) { setConfirm(true); return }
    setBusy(true)
    try {
      await submitCount({ auditId: audit.id, lines: out, round }, key)
      onSubmitted?.()
    } catch (e) { setErr(toUserMessage(e)) } finally { setBusy(false); setConfirm(false) }
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
        return (
          <div key={k} className="inv-count-row">
            <div style={{ minWidth: 0 }}>
              <b style={{ color: 'var(--cc-ink)' }}>{l.item_code || l.serial_no || t('inventory.count.unnamed')}</b>
              <div className="cc-card-sub">{[l.description, l.location_code, l.serial_no && `${t('inventory.common.serial')} ${l.serial_no}`].filter(Boolean).join(' | ')}</div>
            </div>
            <input className="inv-input inv-num" inputMode="decimal" type="number" min="0" step="any"
              aria-label={t('inventory.count.qtyFor', { item: l.item_code || l.serial_no || '' })}
              value={v.confirmed_zero ? '' : (v.counted_qty ?? '')} disabled={!!v.confirmed_zero}
              onChange={(e) => set(k, 'counted_qty', e.target.value)} />
            <div className="inv-actions">
              <label className="inv-check">
                <input type="checkbox" checked={!!v.confirmed_zero} onChange={(e) => set(k, 'confirmed_zero', e.target.checked)} />
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
        <div key={x.id} className="inv-form">
          <Field label={t('inventory.common.item')}><input className="inv-input" value={x.item_code} onChange={(e) => setExtras((xs) => xs.map((y, j) => (j === i ? { ...y, item_code: e.target.value } : y)))} /></Field>
          <Field label={t('inventory.common.location')}><input className="inv-input" value={x.location_code} onChange={(e) => setExtras((xs) => xs.map((y, j) => (j === i ? { ...y, location_code: e.target.value } : y)))} /></Field>
          <Field label={t('inventory.count.qty')}><input className="inv-input" type="number" min="0" step="any" value={x.counted_qty} onChange={(e) => setExtras((xs) => xs.map((y, j) => (j === i ? { ...y, counted_qty: e.target.value } : y)))} /></Field>
          <Field label={t('inventory.count.remarks')}><input className="inv-input" value={x.remarks} onChange={(e) => setExtras((xs) => xs.map((y, j) => (j === i ? { ...y, remarks: e.target.value } : y)))} /></Field>
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
      {err && <ErrorNote error={err} />}
    </div>
  )
}
