import { CheckCircle2, Info, Plus } from 'lucide-react'
import SideDrawer from '../ui/SideDrawer'
import { useLanguage } from '../../contexts/LanguageContext'
import { figureSummary, manualCoverage, partInsight } from '../../lib/oemCatalog/insight'

function Row({ label, ltr, children }) {
  const { t } = useLanguage()
  const empty = children == null || children === '' || (Array.isArray(children) && !children.length)
  return (
    <div className="oem-kv"><dt>{label}</dt><dd className={empty ? 'oem-empty-val' : undefined}>{empty ? t('oemcatalog.detail.notRecorded') : ltr ? <span dir="ltr">{children}</span> : children}</dd></div>
  )
}

/** Everything shown here is read from the extracted row, its figure geometry or other rows of the same manual. */
export function PartDrawer({ row, rows, manual, figures, added, onAdd, onClose, onGoToFigure }) {
  const { t } = useLanguage()
  if (!row) return null
  const i = partInsight(row, rows, figures, manual)
  const f = i.fitment
  const where = (found) => (found.length ? found.map((x) => x.heading || x.figure).join(', ') : null)
  const years = f.yearFrom || f.yearTo ? `${f.yearFrom || '-'} - ${f.yearTo || '-'}` : null
  const serial = f.chassisFrom || f.chassisTo ? `${f.chassisFrom || '-'} - ${f.chassisTo || '-'}` : null
  const remarkSerial = f.remarkSerialFrom ? `${f.remarkSerialFrom}${f.remarkSerialTo ? ` - ${f.remarkSerialTo}` : ''}` : null
  const status = i.evidence?.status
  return (
    <SideDrawer
      open
      onClose={onClose}
      title={<span dir="ltr" className="oem-pn">{row.part_no}</span>}
      subtitle={row.description}
      size="md"
      closeLabel={t('oemcatalog.detail.close')}
      footer={<button type="button" className="oem-primary" disabled={added} onClick={() => onAdd(row)}>{added ? <CheckCircle2 size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}{added ? t('oemcatalog.parts.added') : t('oemcatalog.detail.add')}</button>}
    >
      <div className="oem-drawer">
        <section>
          <h3>{t('oemcatalog.detail.part')}</h3>
          <dl>
            <Row label={t('oemcatalog.detail.callout')}>{i.callout ? (i.isVariant ? t('oemcatalog.detail.variantOf', { index: i.callout }) : i.callout) : null}</Row>
            <Row label={t('oemcatalog.detail.qty')}>{i.quantity}</Row>
            <Row label={t('oemcatalog.detail.uom')}>{i.uom}</Row>
            <Row label={t('oemcatalog.detail.category')}>{i.category ? t(`oemcatalog.category.${i.category}`) : null}</Row>
            <Row label={t('oemcatalog.detail.remark')}>{f.remark}</Row>
          </dl>
        </section>
        <section>
          <h3>{t('oemcatalog.detail.fitment')}</h3>
          <dl>
            <Row label={t('oemcatalog.detail.equipment')} ltr>{f.equipmentNo}</Row>
            <Row label={t('oemcatalog.detail.model')}>{f.modelCode}</Row>
            <Row label={t('oemcatalog.detail.generation')}>{f.generation}</Row>
            <Row label={t('oemcatalog.detail.years')}>{years}</Row>
            <Row label={t('oemcatalog.detail.serial')} ltr>{serial}</Row>
            <Row label={t('oemcatalog.detail.remarkSerial')} ltr>{remarkSerial}</Row>
          </dl>
        </section>
        <section>
          <h3>{t('oemcatalog.detail.chain')}</h3>
          <dl>
            <Row label={t('oemcatalog.detail.supersedes')}>{i.supersedes.length ? i.supersedes.map((s) => <div key={s.no}><span dir="ltr" className="oem-pn">{s.no}</span> {s.found.length ? t('oemcatalog.detail.inCatalog', { where: where(s.found) }) : t('oemcatalog.detail.notInCatalog')}</div>) : null}</Row>
            <Row label={t('oemcatalog.detail.supersededBy')}>{i.supersededBy.length ? i.supersededBy.map((s) => <div key={s.no}><span dir="ltr" className="oem-pn">{s.no}</span> {s.found.length ? t('oemcatalog.detail.inCatalog', { where: where(s.found) }) : t('oemcatalog.detail.notInCatalog')}</div>) : null}</Row>
          </dl>
        </section>
        <section>
          <h3>{t('oemcatalog.detail.whereUsed')}</h3>
          {i.whereUsed.length ? (
            <ul className="oem-list">{i.whereUsed.map((w) => (
              <li key={w.id}><button type="button" onClick={() => onGoToFigure(w)}>{w.heading || w.figure}<small dir="ltr"> {w.printed_page || ''} · {t('oemcatalog.detail.calloutShort', { index: w.callout || '-' })} · {t('oemcatalog.detail.qtyShort', { qty: w.quantity ?? '-' })}</small></button></li>
            ))}</ul>
          ) : <p className="oem-empty-val">{t('oemcatalog.detail.whereUsedNone')}</p>}
        </section>
        <section>
          <h3>{t('oemcatalog.detail.source')}</h3>
          <dl>
            <Row label={t('oemcatalog.detail.listPage')}>{i.source.pdfPage}</Row>
            <Row label={t('oemcatalog.detail.printedPage')}>{i.source.printedPage}</Row>
            <Row label={t('oemcatalog.detail.figurePage')}>{i.source.figurePdfPage}</Row>
            <Row label={t('oemcatalog.detail.seePage')}>{i.source.seePage}</Row>
          </dl>
        </section>
        <section>
          <h3>{t('oemcatalog.detail.evidence')}</h3>
          {i.evidence ? (
            <dl>
              <Row label={t('oemcatalog.detail.matchStatus')}>{t(`oemcatalog.detail.status.${status}`)}</Row>
              <Row label={t('oemcatalog.detail.why')}>{i.evidence.reason}</Row>
              <Row label={t('oemcatalog.detail.onDrawing')}>{i.evidence.calloutOnDrawing == null ? null : i.evidence.calloutOnDrawing ? t('oemcatalog.detail.yes') : t('oemcatalog.detail.no')}</Row>
              <Row label={t('oemcatalog.detail.missingCallouts')}>{i.evidence.missing.length ? i.evidence.missing.join(', ') : null}</Row>
              <Row label={t('oemcatalog.detail.figuresOnPage')}>{i.evidence.figuresOnPage}</Row>
              <Row label={t('oemcatalog.detail.crop')}>{i.evidence.hasCrop ? t('oemcatalog.detail.cropStored') : null}</Row>
            </dl>
          ) : <p className="oem-empty-val">{t('oemcatalog.detail.evidenceNone')}</p>}
        </section>
        {i.related.length > 0 && (
          <section>
            <h3>{t('oemcatalog.detail.related')}</h3>
            <ul className="oem-list">{i.related.map((x) => <li key={x.id}><span dir="ltr" className="oem-pn">{x.part_no}</span> {x.description}</li>)}</ul>
          </section>
        )}
        <section>
          <h3>{t('oemcatalog.detail.stock')}</h3>
          <p className="oem-note oem-note-flat"><Info size={14} aria-hidden="true" /> {t('oemcatalog.detail.stockNote')}</p>
        </section>
      </div>
    </SideDrawer>
  )
}

/** One line of derived facts under the figure header. */
export function FigureSummary({ group, geometry }) {
  const { t } = useLanguage()
  const s = figureSummary(group, geometry)
  return (
    <div className="oem-summary" role="status">
      <span>{t('oemcatalog.summary.counts', { parts: s.parts, callouts: s.callouts })}</span>
      {s.status && <span className={`oem-chip oem-chip-${s.status === 'verified' ? 'ok' : 'warn'}`}>{t(`oemcatalog.detail.status.${s.status}`)}</span>}
      {s.absentCallouts.length > 0 && <span className="oem-chip oem-chip-warn">{t('oemcatalog.summary.absent', { list: s.absentCallouts.join(', ') })}</span>}
      {s.unmatchedNumerals > 0 && <span className="oem-muted">{t('oemcatalog.summary.ignored', { count: s.unmatchedNumerals })}</span>}
    </div>
  )
}

/** Import coverage from the stored record. Accuracy is stated as unmeasured, never estimated. */
export function CoveragePanel({ manual }) {
  const { t } = useLanguage()
  const c = manualCoverage(manual)
  const line = (key, vars, show = true) => (show ? <li key={key}>{t(`oemcatalog.coverage.${key}`, vars)}</li> : null)
  return (
    <details className="oem-coverage">
      <summary>{t('oemcatalog.coverage.title')}</summary>
      <ul>
        {line('pages', { parsed: c.parsedPages ?? '-', pages: c.pages ?? '-' }, c.pages != null)}
        {line('image', { count: c.imageOnlyPages }, c.imageOnlyPages > 0)}
        {line('unparsed', { count: c.unparsedTablePages }, c.unparsedTablePages > 0)}
        {line('published', { count: c.published ?? '-' }, c.published != null)}
        {line('queued', { count: c.queued ?? '-' }, c.queued != null)}
        {line('truncated', {}, c.queueTruncated)}
        {line('figures', { matched: c.figuresMatched ?? '-', total: c.figures ?? '-' }, c.figures != null)}
        {line('ambiguous', { count: c.figuresAmbiguous ?? 0 }, (c.figuresAmbiguous ?? 0) > 0)}
        {line('derived', { count: c.derivedCategories ?? 0 }, (c.derivedCategories ?? 0) > 0)}
        {line('accuracy', {}, !c.accuracyMeasured)}
      </ul>
    </details>
  )
}
