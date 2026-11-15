/**
 * Stored PDF settings of one company (administrator): how many reports one bulk download
 * may hold, how long superseded working copies are kept (never less than 90 days) and
 * whether managers may regenerate an approved report (off unless switched on here).
 *
 * Everyone else sees nothing. Renders nothing until the PDF cache is set up in the
 * database. The server enforces every rule again; this form only explains them.
 */
import { useEffect, useState } from 'react'
import { Settings2 } from 'lucide-react'
import * as api from '../../lib/api/pdfCache'
import { reasonMessage } from '../../lib/pdfCache/state'
import { toUserMessage } from '../../lib/safeError'

export default function PdfSettingsPanel({ onChange }) {
  const [s, setS] = useState(null)
  const [form, setForm] = useState({ bulk: '', days: '', managers: false })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState({ tone: '', text: '' })

  useEffect(() => {
    let live = true
    api.getPdfSettings().then((v) => {
      if (!live || !v) return
      setS(v)
      setForm({ bulk: String(v.bulk_limit), days: String(v.retention_days), managers: !!v.manager_regenerate_approved })
    })
    return () => { live = false }
  }, [])

  if (!s?.can_edit) return null
  const minDays = s.retention_min_days || 90
  const maxBulk = s.bulk_limit_max || 500
  const bulk = Math.floor(Number(form.bulk))
  const days = Math.floor(Number(form.days))
  const problem = !(bulk >= 1 && bulk <= maxBulk) ? `Enter a bulk limit from 1 to ${maxBulk}.`
    : !(days >= minDays && days <= 3650) ? `Retention must be at least ${minDays} days (and at most 3650).` : ''

  const save = async (e) => {
    e.preventDefault()
    if (problem) { setMsg({ tone: 'bad', text: problem }); return }
    setBusy(true); setMsg({ tone: '', text: '' })
    try {
      const r = await api.updatePdfSettings({ bulkLimit: bulk, retentionDays: days, managerRegenerate: form.managers })
      if (!r?.ok) { setMsg({ tone: 'bad', text: reasonMessage(r?.reason, 'The settings could not be saved. Retry.') }); return }
      setS({ ...s, ...r })
      setMsg({ tone: 'good', text: 'Saved.' })
      onChange?.(r)
    } catch (err) { setMsg({ tone: 'bad', text: toUserMessage(err, 'The settings could not be saved. Retry.') }) }
    finally { setBusy(false) }
  }

  return (
    <details className="rounded-lg border p-3 text-sm" style={{ borderColor: 'var(--border)' }}>
      <summary className="flex min-h-[36px] cursor-pointer items-center gap-2 font-medium">
        <Settings2 size={16} aria-hidden /> Stored PDF settings
      </summary>
      <form onSubmit={save} noValidate className="mt-3 grid gap-3 sm:grid-cols-3">
        <label className="text-xs">
          Reports in one bulk download
          <input className="input mt-1 w-full text-sm" type="number" inputMode="numeric" min={1} max={maxBulk} value={form.bulk}
            onChange={(e) => setForm({ ...form, bulk: e.target.value })} />
        </label>
        <label className="text-xs">
          Keep superseded copies for (days, minimum {minDays})
          <input className="input mt-1 w-full text-sm" type="number" inputMode="numeric" min={minDays} max={3650} value={form.days}
            onChange={(e) => setForm({ ...form, days: e.target.value })} />
        </label>
        <label className="flex items-start gap-2 text-xs">
          <input type="checkbox" className="mt-0.5" checked={form.managers} onChange={(e) => setForm({ ...form, managers: e.target.checked })} />
          <span>Managers and directors may regenerate an approved report. A reason is always required and the approved original is always kept.</span>
        </label>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
          <button type="submit" className="btn-secondary min-h-[36px] text-xs" disabled={busy}>{busy ? 'Saving...' : 'Save settings'}</button>
          {msg.text && <span role={msg.tone === 'bad' ? 'alert' : 'status'} className="text-xs" style={{ color: msg.tone === 'bad' ? '#dc2626' : '#15803d' }}>{msg.text}</span>}
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Approved report revisions are never removed by retention.</span>
        </div>
      </form>
    </details>
  )
}
