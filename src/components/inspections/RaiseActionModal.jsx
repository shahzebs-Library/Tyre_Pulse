import { useState } from 'react'
import Modal from '../ui/Modal'
import { useLanguage } from '../../contexts/LanguageContext'
import { actionPriority } from '../../lib/inspectionsAnalytics'

/**
 * Confirm the title of a corrective action raised from an observation. The
 * write itself stays with the page (raiseAction), unchanged.
 */
export default function RaiseActionModal({ row, onConfirm, onClose }) {
  const { t } = useLanguage()
  const [title, setTitle] = useState(`Action: ${row.title}`)
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    try { await onConfirm(title) } finally { setBusy(false) }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={t('inspections.raiseModal.title')}
      size="md"
      footer={(
        <div className="flex gap-3 w-full">
          <button type="button" onClick={onClose} className="btn-secondary flex-1 min-h-[44px]">{t('common.cancel')}</button>
          <button type="button" onClick={submit} disabled={busy || !title.trim()} className="btn-primary flex-1 min-h-[44px] disabled:opacity-50">
            {busy ? t('common.saving') : t('inspections.raiseModal.raiseAction')}
          </button>
        </div>
      )}
    >
      <p className="text-[var(--text-secondary)] text-sm mb-4">{t('inspections.raiseModal.desc')}</p>
      <div className="mb-4">
        <label className="label" htmlFor="raise-action-title">{t('inspections.raiseModal.actionTitle')}</label>
        <input id="raise-action-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <dl className="bg-[var(--surface-2)] rounded-lg p-3 text-xs text-[var(--text-secondary)] space-y-1">
        <div className="flex gap-1"><dt className="text-[var(--text-muted)]">{t('inspections.raiseModal.site')}</dt><dd>{row.site || 'N/A'}</dd></div>
        <div className="flex gap-1"><dt className="text-[var(--text-muted)]">{t('inspections.raiseModal.asset')}</dt><dd>{row.asset_no || 'N/A'}</dd></div>
        <div className="flex gap-1"><dt className="text-[var(--text-muted)]">{t('inspections.raiseModal.priority')}</dt><dd>{actionPriority(row.severity)}</dd></div>
        {row.findings && (
          <div className="flex gap-1">
            <dt className="text-[var(--text-muted)]">{t('inspections.raiseModal.findings')}</dt>
            <dd>{row.findings.slice(0, 100)}{row.findings.length > 100 ? '...' : ''}</dd>
          </div>
        )}
      </dl>
    </Modal>
  )
}
