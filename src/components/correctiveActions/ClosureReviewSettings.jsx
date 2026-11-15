import { useEffect, useState } from 'react'
import { Loader2, Save, Settings2 } from 'lucide-react'
import Modal from '../ui/Modal'
import { getClosureReviewConfig, saveClosureReviewConfig } from '../../lib/api/closureReview'
import { toUserMessage } from '../../lib/safeError'
import { closureText } from '../../lib/closureText'
import { useLanguage } from '../../contexts/LanguageContext'

const toList = (text) => String(text || '').split(',').map((x) => x.trim()).filter(Boolean)
const toText = (list) => (Array.isArray(list) ? list.join(', ') : '')
const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]'

/**
 * Who reviews and closes corrective actions in THIS company. Administrators only:
 * the button is not offered to anyone else and the database refuses the save
 * for anyone else. Not offered at all until the review drafts are applied.
 */
export default function ClosureReviewSettings({ canEdit }) {
  const { t } = useLanguage()
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
      setMessage({ ok: true, text: t('closure.settings.saved') })
    } catch (err) {
      setMessage({ ok: false, text: closureText(t, toUserMessage(err, t('closure.settings.saveFailed'))) })
    } finally { setBusy(false) }
  }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className={`btn-secondary inline-flex items-center gap-2 text-sm min-h-[44px] sm:min-h-[36px] ${FOCUS}`}>
        <Settings2 size={14} aria-hidden="true" /> {t('closure.settings.button')}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} size="md" title={t('closure.settings.title')}
        footer={(
          <div className="flex gap-3 justify-end">
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>{t('closure.settings.close')}</button>
            <button type="submit" form="closure-review-settings" disabled={busy} className="btn-primary inline-flex items-center gap-2 disabled:opacity-50">
              {busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Save size={15} aria-hidden="true" />} {t('closure.settings.save')}
            </button>
          </div>
        )}>
        <form id="closure-review-settings" onSubmit={save} className="space-y-3">
          {message && <p role={message.ok ? 'status' : 'alert'} className={`text-sm ${message.ok ? 'text-green-400' : 'text-red-400'}`}>{message.text}</p>}
          <div>
            <label className="label" htmlFor="crs-reviewers">{t('closure.settings.reviewers')}</label>
            <input id="crs-reviewers" className="input" value={form.reviewers} onChange={set('reviewers')} />
            <p className="text-xs text-[var(--text-muted)] mt-1">{t('closure.settings.reviewersHint')}</p>
          </div>
          <div>
            <label className="label" htmlFor="crs-exceptions">{t('closure.settings.exceptions')}</label>
            <input id="crs-exceptions" className="input" value={form.exceptions} onChange={set('exceptions')} />
            <p className="text-xs text-[var(--text-muted)] mt-1">{t('closure.settings.exceptionsHint')}</p>
          </div>
          <div>
            <label className="label" htmlFor="crs-final">{t('closure.settings.finalSigners')}</label>
            <input id="crs-final" className="input" value={form.finalSigners} onChange={set('finalSigners')} />
            <p className="text-xs text-[var(--text-muted)] mt-1">{t('closure.settings.finalSignersHint')}</p>
          </div>
          <div>
            <label className="label" htmlFor="crs-photos">{t('closure.settings.photos')}</label>
            <input id="crs-photos" type="number" min="0" max="6" className="input" value={form.minPhotos} onChange={set('minPhotos')} />
          </div>
          <label className="flex items-start gap-2 text-sm text-[var(--text-primary)]">
            <input type="checkbox" className="mt-1" checked={!!form.directClose} onChange={set('directClose')} />
            <span>{t('closure.settings.directClose')}</span>
          </label>
          <label className="flex items-start gap-2 text-sm text-[var(--text-primary)]">
            <input type="checkbox" className="mt-1" checked={!!form.selfReview} onChange={set('selfReview')} />
            <span>{t('closure.settings.selfReview')}</span>
          </label>
          <label className="flex items-start gap-2 text-sm text-[var(--text-primary)]">
            <input type="checkbox" className="mt-1" checked={!!form.selfAck} onChange={set('selfAck')} />
            <span>{t('closure.settings.selfAck')}</span>
          </label>
        </form>
      </Modal>
    </>
  )
}
