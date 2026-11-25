import { useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { Loader2 } from 'lucide-react'
import { useLanguage } from '../../contexts/LanguageContext'
import { toUserMessage } from '../../lib/safeError'
import { openOemPdfDocument } from '../../lib/api/oemPartsCatalog'
import { NOT_PROVISIONED, listCategoryRules, listEntriesWithFigure, saveReviewItems } from '../../lib/api/oemCatalogAdmin'
import { extractOemPartsDocument } from '../../lib/oemPartsExtractor'
import { processExtraction } from '../../lib/oemCatalog/pipeline'
import { reprocessAgainstStored } from '../../lib/oemCatalog/reprocess'
import './oemCatalog.css'

const rowKey = (r) => `${r.figure_id}|${r.index_no || r.parent_index || ''}|${r.part_no}`

/**
 * Re-run the extraction on the stored PDF and show what WOULD change. Nothing is written until the
 * admin queues the genuinely new parts for review; stored parts are never overwritten here.
 */
export default function OemReprocessPanel({ manual }) {
  const { t } = useLanguage()
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const run = async () => {
    setBusy(true); setError(''); setNotice(''); setResult(null)
    try {
      const doc = await openOemPdfDocument(manual.id, pdfjsLib)
      const extraction = await extractOemPartsDocument(doc, setProgress, { ops: pdfjsLib.OPS })
      const rules = await listCategoryRules().catch(() => [])
      const pipeline = processExtraction(extraction, { model: manual.model, manufacturer: manual.manufacturer, corrections: rules })
      const entries = await listEntriesWithFigure(manual.id)
      const preview = reprocessAgainstStored({ entries, pipeline, manual })
      const raw = new Map([...pipeline.publish, ...pipeline.review].map((r) => [rowKey(r), r]))
      const fresh = preview.newParts.map((p) => raw.get(`${p.figure_id}|${p.callout || p.parent_callout || ''}|${p.part_no}`)).filter(Boolean)
      setResult({ preview, fresh })
      doc.destroy?.()
    } catch (e) { setError(toUserMessage(e, t('oemcatalog.reprocess.error'))) } finally { setBusy(false) }
  }

  const queue = async () => {
    setError('')
    try { const n = await saveReviewItems(manual.id, result.fresh); setNotice(t('oemcatalog.reprocess.queued', { count: n })) }
    catch (e) { setError(e.code === NOT_PROVISIONED ? t('oemcatalog.review.notProvisioned') : toUserMessage(e, t('oemcatalog.reprocess.error'))) }
  }

  const p = result?.preview
  const stat = (key, n) => <li key={key}><strong>{n}</strong> {t(`oemcatalog.reprocess.${key}`)}</li>
  return (
    <section className="oem-card oem-tools" aria-label={t('oemcatalog.reprocess.title')}>
      <header className="oem-card-head"><h2>{t('oemcatalog.reprocess.title')}</h2></header>
      <div className="oem-scroll oem-review-body">
        <p className="oem-note">{t('oemcatalog.reprocess.help')}</p>
        <div className="oem-actions">
          <button type="button" className="oem-primary" disabled={busy || !manual.storage_path} onClick={run}>{busy ? <Loader2 className="oem-spin" size={15} aria-hidden="true" /> : null}{t('oemcatalog.reprocess.run')}</button>
          {busy && progress?.pageCount > 0 && <small>{progress.pageNumber} / {progress.pageCount}</small>}
        </div>
        {error && <p role="alert" className="oem-note oem-note-error">{error}</p>}
        {notice && <p role="status" className="oem-note">{notice}</p>}
        {p && (
          <>
            <ul className="oem-list">
              {stat('newParts', p.newParts.length)}{stat('changed', p.changed.length)}{stat('protectedRecords', p.protectedRecords.length)}
              {stat('unchanged', p.unchanged)}{stat('missingNow', p.missingNow.length)}{stat('uncertain', p.uncertain.length)}
              {stat('categoryChanges', p.categoryChanges.length)}{stat('duplicates', p.duplicateCandidates.length)}
            </ul>
            <p className="oem-note">{t('oemcatalog.reprocess.safe')}</p>
            <button type="button" className="oem-secondary" disabled={!result.fresh.length} onClick={queue}>{t('oemcatalog.reprocess.queue', { count: result.fresh.length })}</button>
          </>
        )}
      </div>
    </section>
  )
}
