import { Search, X } from 'lucide-react'
import { useLanguage } from '../../contexts/LanguageContext'
import './oemCatalog.css'

const BTN = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-[var(--input-border)] px-2.5 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--panel-2)] disabled:opacity-60'
const ACCENT = 'text-[var(--oem-accent-text)]'

/** Parts the user has collected across assemblies, with request quantity and source details. */
export function SelectedPartsTable({ items, onQty, onRemove, stock = {} }) {
  const { t } = useLanguage()
  return (
    <div className="max-h-[65vh] overflow-auto rounded-lg border border-[var(--input-border)]">
      <table className="w-full min-w-[900px] text-start text-xs">
        <thead className="sticky top-0 bg-[var(--panel-2)] text-[var(--text-muted)]"><tr>
          {['partDesc', 'model', 'figure', 'fitment', 'stock', 'source', 'qty', 'remove'].map((k) => <th key={k} scope="col" className="px-3 py-2 text-start">{t(`oemcatalog.selected.col.${k}`)}</th>)}
        </tr></thead>
        <tbody>{items.map((item) => (
          <tr key={item.key} className="border-t border-[var(--input-border)] align-top">
            <td className="px-3 py-3"><div className={`font-mono font-semibold ${ACCENT}`} dir="ltr">{item.row.part_no}</div><div className="mt-1 max-w-[280px] whitespace-normal text-[var(--text-primary)]">{item.row.description}</div>{item.row.remark && <div className="mt-1 text-[var(--text-muted)]">{item.row.remark}</div>}</td>
            <td className="px-3 py-3 text-[var(--text-primary)]">{item.manual.manufacturer} · {item.manual.model}{item.manual.generation ? ` · ${item.manual.generation}` : ''}<div className="mt-1 text-[10px] text-[var(--text-muted)]">{item.manual.model_code || t('oemcatalog.selected.noCode')}</div></td>
            <td className="px-3 py-3 text-[var(--text-primary)]">{item.figureLabel}<div className="mt-1 text-[10px] text-[var(--text-muted)]">{t('oemcatalog.selected.figureLine', { page: item.figurePage || t('oemcatalog.selected.notLinked'), index: item.row.index_no || item.row.parent_index || '-' })}</div></td>
            <td className="px-3 py-3"><span className={`oem-chip oem-chip-${item.fitment === 'confirmed' ? 'ok' : 'warn'}`}>{t(`oemcatalog.compat.${item.fitment || 'unverified'}`)}</span></td>
            <td className="px-3 py-3 text-[var(--text-primary)]">{(() => { const sk = stock[String(item.row.part_no || '').toUpperCase().replace(/[^A-Z0-9]/g, '')]; return sk ? <>{t('oemcatalog.basket.onHand', { qty: sk.on_hand_qty ?? '-' })}<div className="mt-1 text-[10px] text-[var(--text-muted)]">{t('oemcatalog.basket.sameNumber')}</div></> : <span className="oem-empty-val">{t('oemcatalog.basket.noStock')}</span> })()}<div className="mt-1 text-[10px] text-[var(--text-muted)]">{t('oemcatalog.basket.reservedNote')}</div></td>
            <td className="px-3 py-3 text-[var(--text-primary)]">{item.manual.source_file_name || t('oemcatalog.selected.savedCatalog')}<div className="mt-1 text-[10px] text-[var(--text-muted)]">{t('oemcatalog.selected.sourceLine', { list: item.row.source_pdf_page || '-', printed: item.row.printed_page || '-', asset: item.assetNo || t('oemcatalog.selected.notLinked') })}</div></td>
            <td className="px-3 py-3"><input aria-label={t('oemcatalog.selected.qtyFor', { part: item.row.part_no })} type="number" min="1" step="1" value={item.requestedQty} onChange={(e) => onQty(item.key, e.target.value)} className="min-h-9 w-20 rounded-lg border border-[var(--input-border)] bg-[var(--panel)] px-2 text-[var(--text-primary)]" /><div className="mt-1 text-[10px] text-[var(--text-muted)]">{t('oemcatalog.selected.oemQty', { qty: item.row.quantity ?? '-' })} · {t('oemcatalog.basket.unit')}: {t('oemcatalog.detail.notRecorded')}</div></td>
            <td className="px-3 py-3"><button type="button" aria-label={t('oemcatalog.selected.removeOne', { part: item.row.part_no })} onClick={() => onRemove(item.key)} className="grid min-h-9 min-w-9 place-items-center rounded-lg text-[var(--text-muted)] hover:bg-red-500/10 hover:text-red-300"><X size={15} aria-hidden="true" /></button></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  )
}

/** Direct part-number / description search results across all saved manuals. */
export function SearchResultsTable({ entries, selectedKeys, onView, onAdd }) {
  const { t } = useLanguage()
  return (
    <div className="max-h-[70vh] overflow-auto">
      <table className="w-full min-w-[900px] text-start text-xs">
        <thead className="sticky top-0 bg-[var(--panel-2)] text-[var(--text-muted)]"><tr>
          {['model', 'partNo', 'desc', 'index', 'qty', 'pages', 'actions'].map((k) => <th key={k} scope="col" className="px-3 py-3 text-start font-semibold">{t(`oemcatalog.results.col.${k}`)}</th>)}
        </tr></thead>
        <tbody>{entries.map((row) => {
          const added = selectedKeys.has(`${row.manual_id}:${row.id}`)
          return (
            <tr key={row.id} className="border-t border-[var(--input-border)]">
              <td className="px-3 py-3"><div className="font-medium text-[var(--text-primary)]">{row.manual?.manufacturer} {row.manual?.model}</div><div className="mt-1 text-[var(--text-muted)]">{row.manual?.equipment_no || row.manual?.model_code || t('oemcatalog.results.noEquipment')}</div></td>
              <td className="px-3 py-3"><div className={`font-mono font-semibold ${ACCENT}`} dir="ltr">{row.part_no}</div>{row._why && <div className="oem-why">{row._why.slice(0, 3).map((w) => <span key={w}>{t(`oemcatalog.why.${w}`)}</span>)}</div>}{row._compat && <span className={`oem-chip oem-chip-${row._compat === 'confirmed' ? 'ok' : 'warn'}`}>{t(`oemcatalog.compat.${row._compat}`)}</span>}</td>
              <td className="max-w-[380px] whitespace-normal px-3 py-3"><div className="text-[var(--text-primary)]">{row.description}</div>{row.assembly_heading && <div className="mt-1 text-[var(--text-muted)]">{row.assembly_heading}</div>}{row.remark && <div className="mt-1 text-[var(--text-muted)]">{t('oemcatalog.results.variant', { remark: row.remark })}</div>}</td>
              <td className="px-3 py-3 text-[var(--text-primary)]">{row.index_no || row.parent_index || '-'}</td>
              <td className="px-3 py-3 tabular-nums text-[var(--text-primary)]">{row.quantity ?? '-'}</td>
              <td className="px-3 py-3 text-[var(--text-secondary)]">{row.illustration_pdf_page ? t('oemcatalog.results.drawing', { page: row.illustration_pdf_page }) : t('oemcatalog.results.list', { page: row.source_pdf_page })}</td>
              <td className="px-3 py-3"><div className="flex gap-2">
                <button type="button" className={BTN} onClick={() => onView(row)}><Search size={14} aria-hidden="true" />{row.illustration_pdf_page ? t('oemcatalog.results.viewFigure') : t('oemcatalog.results.showEntry')}</button>
                <button type="button" disabled={added} onClick={() => onAdd(row)} className={BTN}>{added ? t('oemcatalog.parts.added') : t('oemcatalog.parts.add')}</button>
              </div></td>
            </tr>
          )
        })}</tbody>
      </table>
    </div>
  )
}

/** First rows read from an uploaded PDF, so the admin can eyeball the extraction. */
export function ExtractionPreviewTable({ rows }) {
  const { t } = useLanguage()
  return (
    <div className="overflow-auto rounded-lg border border-[var(--input-border)]">
      <table className="w-full min-w-[560px] text-start text-xs">
        <thead className="bg-[var(--panel-2)] text-[var(--text-muted)]"><tr>
          {['page', 'index', 'partNo', 'desc', 'qty'].map((k) => <th key={k} scope="col" className="px-3 py-2 text-start">{t(`oemcatalog.import.col.${k}`)}</th>)}
        </tr></thead>
        <tbody>{rows.map((row, i) => (
          <tr key={`${row.source_pdf_page}-${row.row_order}-${i}`} className="border-t border-[var(--input-border)]">
            <td className="px-3 py-2">{row.source_pdf_page}</td><td className="px-3 py-2">{row.index_no || '-'}</td>
            <td className={`px-3 py-2 font-mono ${ACCENT}`} dir="ltr">{row.part_no}</td>
            <td className="max-w-[240px] whitespace-normal px-3 py-2">{row.description}{row.remark ? ` · ${row.remark}` : ''}</td>
            <td className="px-3 py-2">{row.quantity ?? '-'}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  )
}

/** What the automatic pipeline decided: areas, published vs review rows, orphan callouts, review queue. */
export function ImportReviewPanel({ result }) {
  const { t } = useLanguage()
  if (!result) return null
  const s = result.summary
  const queue = result.review.slice(0, 25)
  return (
    <div className="space-y-3" data-testid="oem-import-review">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[['published', s.published], ['review', s.reviewRows], ['figures', s.figureCount], ['dupes', s.duplicatesDropped]].map(([k, v]) => (
          <div key={k} className="rounded-lg bg-[var(--panel-2)] p-3"><div className="text-lg font-bold text-[var(--text-primary)]">{Number(v).toLocaleString()}</div><div className="text-[11px] text-[var(--text-muted)]">{t(`oemcatalog.import.stat.${k}`)}</div></div>
        ))}
      </div>
      <p className="text-xs text-[var(--text-secondary)]">
        {['chassis', 'upper', 'other'].map((a) => `${t(`oemcatalog.area.${a}`)}: ${s.areaCounts[a] || 0}`).join(' · ')}
      </p>
      {s.orphanCallouts.length > 0 && <p className="text-xs text-[var(--oem-accent-text)]">{t('oemcatalog.import.orphans', { count: s.orphanCallouts.reduce((n, o) => n + o.indexes.length, 0) })}</p>}
      {queue.length > 0 && (
        <div>
          <h3 className="mb-1 text-xs font-semibold text-[var(--text-primary)]">{t('oemcatalog.import.queueTitle')}</h3>
          <p className="mb-2 text-[11px] text-[var(--text-muted)]">{t('oemcatalog.import.queueHelp')}</p>
          <ul className="max-h-56 space-y-1 overflow-auto rounded-lg border border-[var(--input-border)] p-2 text-[11px]">
            {queue.map((r, i) => (
              <li key={`${r.figure_id}-${r.row_order}-${i}`} className="text-[var(--text-secondary)]"><span className="font-mono text-[var(--text-primary)]" dir="ltr">{r.part_no}</span> · {t('oemcatalog.import.queueItem', { figure: r.figure_id, pct: Math.round(r.confidence * 100) })} · {r.issues.map((x) => x.message).join('; ')}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
