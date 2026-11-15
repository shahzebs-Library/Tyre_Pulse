import { useEffect, useState } from 'react'
import { Loader2, Save, Settings2 } from 'lucide-react'
import Modal from '../ui/Modal'
import { getClosureReviewConfig, saveClosureReviewConfig } from '../../lib/api/closureReview'
import { toUserMessage } from '../../lib/safeError'

const toList = (text) => String(text || '').split(',').map((x) => x.trim()).filter(Boolean)
const toText = (list) => (Array.isArray(list) ? list.join(', ') : '')
const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]'

/**
 * Who reviews and closes corrective actions in THIS company. Administrators only:
 * the button is not offered to anyone else and the database refuses the save
 * for anyone else. Not offered at all until the review drafts are applied.
 */
export default function ClosureReviewSettings({ canEdit }) {
  const [open, setOpen] = useState(false)
  const [provisioned, setProvisioned] = useState(false)
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)

  useEffect(() => {
    let live = true
    if (!canEdit) return undefined
    getClosureReviewConfig().then((r) => {
      if (!live) return
      setProvisioned(r.provisioned)
      setForm({
        reviewers: toText(r.config.ca_reviewer_roles),
        exceptions: toText(r.config.exception_roles),
        finalSigners: toText(r.config.checklist_final_signer_roles),
        selfReview: r.config.ca_allow_self_review,
        directClose: r.config.ca_allow_direct_close,
        minPhotos: r.config.ca_min_photos,
        selfAck: r.config.checklist_allow_self_ack,
      })
    }).catch(() => { if (live) setProvisioned(false) })
    return () => { live = false }
  }, [canEdit])

  if (!canEdit || !provisioned || !form) return null

  async function save(e) {
    e.preventDefault()
    setBusy(true); setMessage(null)
    try {
      await saveClosureReviewConfig({
        ca_reviewer_roles: toList(form.reviewers),
        exception_roles: toList(form.exceptions),
        checklist_final_signer_roles: toList(form.finalSigners),
        ca_allow_self_review: !!form.selfReview,
        ca_allow_direct_close: !!form.directClose,
        ca_min_photos: Number(form.minPhotos) || 0,
        checklist_allow_self_ack: !!form.selfAck,
      })
      setMessage({ ok: true, text: 'Saved. The new rules apply from the next review.' })
    } catch (err) {
      setMessage({ ok: false, text: toUserMessage(err, 'The settings could not be saved.') })
    } finally { setBusy(false) }
  }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className={`btn-secondary inline-flex items-center gap-2 text-sm min-h-[44px] sm:min-h-[36px] ${FOCUS}`}>
        <Settings2 size={14} aria-hidden="true" /> Review rules
      </button>
      <Modal open={open} onClose={() => setOpen(false)} size="md" title="Who reviews and closes actions"
        footer={(
          <div className="flex gap-3 justify-end">
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Close</button>
            <button type="submit" form="closure-review-settings" disabled={busy} className="btn-primary inline-flex items-center gap-2 disabled:opacity-50">
              {busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Save size={15} aria-hidden="true" />} Save
            </button>
          </div>
        )}>
        <form id="closure-review-settings" onSubmit={save} className="space-y-3">
          {message && <p role={message.ok ? 'status' : 'alert'} className={`text-sm ${message.ok ? 'text-green-400' : 'text-red-400'}`}>{message.text}</p>}
          <div>
            <label className="label" htmlFor="crs-reviewers">Roles that review and close corrective actions</label>
            <input id="crs-reviewers" className="input" value={form.reviewers} onChange={set('reviewers')} />
            <p className="text-xs text-[var(--text-muted)] mt-1">Role names separated by commas, exactly as they appear in Access Control.</p>
          </div>
          <div>
            <label className="label" htmlFor="crs-exceptions">Roles that may close with a documented exception</label>
            <input id="crs-exceptions" className="input" value={form.exceptions} onChange={set('exceptions')} />
          </div>
          <div>
            <label className="label" htmlFor="crs-final">Extra roles that give the final checklist signature</label>
            <input id="crs-final" className="input" value={form.finalSigners} onChange={set('finalSigners')} />
            <p className="text-xs text-[var(--text-muted)] mt-1">Added to the fixed final signers. Each person still signs only within their own sites.</p>
          </div>
          <div>
            <label className="label" htmlFor="crs-photos">Photographs required with a completion (0 to 6)</label>
            <input id="crs-photos" type="number" min="0" max="6" className="input" value={form.minPhotos} onChange={set('minPhotos')} />
          </div>
          <label className="flex items-start gap-2 text-sm text-[var(--text-primary)]">
            <input type="checkbox" className="mt-1" checked={!!form.directClose} onChange={set('directClose')} />
            <span>Reviewers may still close an action directly from the status list (recorded in the history)</span>
          </label>
          <label className="flex items-start gap-2 text-sm text-[var(--text-primary)]">
            <input type="checkbox" className="mt-1" checked={!!form.selfReview} onChange={set('selfReview')} />
            <span>A reviewer may approve an action they submitted themselves</span>
          </label>
          <label className="flex items-start gap-2 text-sm text-[var(--text-primary)]">
            <input type="checkbox" className="mt-1" checked={!!form.selfAck} onChange={set('selfAck')} />
            <span>A signer may acknowledge a checklist they submitted themselves</span>
          </label>
        </form>
      </Modal>
    </>
  )
}
