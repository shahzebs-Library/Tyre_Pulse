import { useCallback, useEffect, useMemo, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { Check, Loader2, Search, X } from 'lucide-react'
import { useLanguage } from '../../contexts/LanguageContext'
import { toUserMessage } from '../../lib/safeError'
import { getOemPdfSignedUrl } from '../../lib/api/oemPartsCatalog'
import { NOT_PROVISIONED, adjustFigureCrop, decideReviewItems, listCorrections, listReviewItems, publishApproved, saveCategoryRule, updateReviewPayload } from '../../lib/api/oemCatalogAdmin'
import { STANDARD_CATEGORIES, headingKey } from '../../lib/oemCatalog/taxonomy'
import OemFigure from './OemFigure'
import './oemCatalog.css'

const PAGE_SIZE = 25

/** Admin-only workspace: queued records beside their PDF evidence, edit, classify, approve, publish. */
export default function OemReviewWorkspace({ manual }) {
  const { t } = useLanguage()
  const [status, setStatus] = useState('pending')
  const [search, setSearch] = useState('')
  const [maxConf, setMaxConf] = useState('')
  const [page, setPage] = useState(0)
  const [data, setData] = useState({ items: [], total: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [picked, setPicked] = useState(new Set())
  const [active, setActive] = useState(null)
  const [draft, setDraft] = useState(null)
  const [pdfDoc, setPdfDoc] = useState(null)
  const [history, setHistory] = useState([])
  const [crop, setCrop] = useState(null)
  const [notice, setNotice] = useState('')
  const figures = manual?.import_summary?.figures || {}

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      setData(await listReviewItems({ manualId: manual.id, status, search, maxConfidence: maxConf === '' ? undefined : Number(maxConf) / 100, page, pageSize: PAGE_SIZE }))
      setNotProvisioned(false)
    } catch (e) {
      if (e.code === NOT_PROVISIONED) setNotProvisioned(true)
      else setError(toUserMessage(e, t('oemcatalog.review.loadError')))
    } finally { setLoading(false) }
  }, [manual.id, status, search, maxConf, page, t])
  useEffect(() => { const h = setTimeout(load, 250); return () => clearTimeout(h) }, [load])
  useEffect(() => { setPage(0) }, [status, search, maxConf])
  useEffect(() => () => pdfDoc?.destroy?.(), [pdfDoc])

  const open = async (item) => {
    setActive(item); setDraft({ ...item.payload }); setNotice('')
    const geo = figures[item.figure_id]?.geometry
    setCrop(geo?.crop ? { ...geo.crop } : null)
    listCorrections(item.entry_id).then(setHistory).catch(() => setHistory([]))
    if (!pdfDoc && manual.storage_path) {
      try { setPdfDoc(await pdfjsLib.getDocument({ url: await getOemPdfSignedUrl(manual.id) }).promise) } catch (e) { setError(toUserMessage(e, t('oemcatalog.review.pdfError'))) }
    }
  }

  const run = async (fn, okMsg) => {
    setError(''); setNotice('')
    try { await fn(); setNotice(okMsg); await load() } catch (e) { setError(toUserMessage(e, t('oemcatalog.review.saveError'))) }
  }
  const ids = useMemo(() => [...picked], [picked])
  const toggle = (id) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const geo = active ? figures[active.figure_id]?.geometry : null
  const stdCategory = active ? figures[active.figure_id]?.hierarchy?.category : null

  if (notProvisioned) return <p className="oem-note" role="status">{t('oemcatalog.review.notProvisioned')}</p>

  return (
    <div className="oem-review">
      <section className="oem-card oem-review-list" aria-label={t('oemcatalog.review.title')}>
        <header className="oem-card-head">
          <h2>{t('oemcatalog.review.title')}</h2>
          <span className="oem-count">{t('oemcatalog.review.total', { count: data.total })}</span>
        </header>
        <div className="oem-review-filters">
          <label className="oem-search"><Search size={14} aria-hidden="true" /><input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('oemcatalog.review.search')} aria-label={t('oemcatalog.review.search')} /></label>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t('oemcatalog.review.status')}>
            {['pending', 'approved', 'rejected', 'published', 'all'].map((s) => <option key={s} value={s}>{t(`oemcatalog.review.s.${s}`)}</option>)}
          </select>
          <label>{t('oemcatalog.review.maxConf')} <input type="number" min="0" max="100" value={maxConf} onChange={(e) => setMaxConf(e.target.value)} /></label>
        </div>
        <div className="oem-actions oem-sticky-bar">
          <button type="button" className="oem-secondary" disabled={!ids.length} onClick={() => run(() => decideReviewItems(ids, 'approved').then(() => setPicked(new Set())), t('oemcatalog.review.approved'))}><Check size={15} aria-hidden="true" />{t('oemcatalog.review.approve', { count: ids.length })}</button>
          <button type="button" className="oem-secondary" disabled={!ids.length} onClick={() => run(() => decideReviewItems(ids, 'rejected').then(() => setPicked(new Set())), t('oemcatalog.review.rejected'))}><X size={15} aria-hidden="true" />{t('oemcatalog.review.reject', { count: ids.length })}</button>
          <button type="button" className="oem-primary" onClick={() => run(async () => { const n = await publishApproved(manual.id); setNotice(t('oemcatalog.review.published', { count: n })) }, '')}>{t('oemcatalog.review.publish')}</button>
        </div>
        <div className="oem-scroll">
          {loading && <div className="oem-loading"><Loader2 className="oem-spin" size={18} aria-hidden="true" />{t('oemcatalog.loading')}</div>}
          {!loading && data.items.length === 0 && <p className="oem-note">{t('oemcatalog.review.empty')}</p>}
          <ul className="oem-list oem-review-rows">
            {data.items.map((it) => (
              <li key={it.id} data-active={active?.id === it.id ? 'true' : undefined}>
                <input type="checkbox" checked={picked.has(it.id)} onChange={() => toggle(it.id)} aria-label={t('oemcatalog.review.pick', { part: it.part_no })} />
                <button type="button" onClick={() => open(it)}>
                  <span className="oem-pn" dir="ltr">{it.part_no}</span>
                  <small>{it.figure_id} · {Math.round((it.confidence ?? 0) * 100)}% · {t(`oemcatalog.review.s.${it.status}`)}</small>
                  <small>{(it.reasons || []).join('; ')}</small>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="oem-actions">
          <div className="oem-pager" role="group" aria-label={t('oemcatalog.parts.pager')}>
            <button type="button" disabled={page === 0} onClick={() => setPage((p) => p - 1)} aria-label={t('oemcatalog.parts.prevPage')}>&lsaquo;</button>
            <span>{page + 1} / {Math.max(1, Math.ceil(data.total / PAGE_SIZE))}</span>
            <button type="button" disabled={(page + 1) * PAGE_SIZE >= data.total} onClick={() => setPage((p) => p + 1)} aria-label={t('oemcatalog.parts.nextPage')}>&rsaquo;</button>
          </div>
        </div>
      </section>

      <section className="oem-card oem-review-detail" aria-label={t('oemcatalog.review.detail')}>
        <header className="oem-card-head"><h2>{t('oemcatalog.review.detail')}</h2></header>
        {!active ? <div className="oem-empty">{t('oemcatalog.review.pickEmpty')}</div> : (
          <div className="oem-scroll oem-review-body">
            {error && <p role="alert" className="oem-note oem-note-error">{error}</p>}
            {notice && <p role="status" className="oem-note">{notice}</p>}
            {active.pdf_page && pdfDoc && geo?.pdf_page && (
              <div className="oem-review-figure"><OemFigure pdfDoc={pdfDoc} pageNo={geo.pdf_page} rows={[]} selectedIndex={String(Number(draft?.index_no || 0))} onSelectIndex={() => {}} figureLabel={active.figure_id} position={active.figure_id} geometry={{ ...geo, crop: crop || geo.crop }} /></div>
            )}
            <form className="oem-form" onSubmit={(e) => { e.preventDefault(); run(() => updateReviewPayload(active.id, draft), t('oemcatalog.review.saved')) }}>
              {[['part_no', 'partNo'], ['description', 'description'], ['quantity', 'qty'], ['remark', 'remark']].map(([f, k]) => (
                <label key={f}>{t(`oemcatalog.review.f.${k}`)}<input value={draft?.[f] ?? ''} onChange={(e) => setDraft((d) => ({ ...d, [f]: f === 'quantity' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value }))} dir={f === 'part_no' ? 'ltr' : undefined} /></label>
              ))}
              <button type="submit" className="oem-secondary">{t('oemcatalog.review.save')}</button>
            </form>
            <label className="oem-form-row">{t('oemcatalog.review.category')}
              <select value={stdCategory || ''} onChange={(e) => { const c = STANDARD_CATEGORIES.find(([code]) => code === e.target.value); if (c) run(() => saveCategoryRule({ heading: figures[active.figure_id]?.heading || '', headingKey: headingKey(figures[active.figure_id]?.heading), category: c[0], system: c[1], manufacturer: manual.manufacturer || '' }), t('oemcatalog.review.ruleSaved')) }}>
                <option value="">{t('oemcatalog.category.uncategorised')}</option>
                {STANDARD_CATEGORIES.map(([code]) => <option key={code} value={code}>{t(`oemcatalog.category.${code}`)}</option>)}
              </select>
            </label>
            {crop && (
              <fieldset className="oem-form-row"><legend>{t('oemcatalog.review.bounds')}</legend>
                {['x0', 'y0', 'x1', 'y1'].map((k) => <label key={k}>{k}<input type="number" value={Math.round(crop[k])} onChange={(e) => setCrop((c) => ({ ...c, [k]: Number(e.target.value) }))} dir="ltr" /></label>)}
                <button type="button" className="oem-secondary" onClick={() => run(() => adjustFigureCrop(manual.id, active.figure_id, crop), t('oemcatalog.review.boundsSaved'))}>{t('oemcatalog.review.saveBounds')}</button>
              </fieldset>
            )}
            <h3>{t('oemcatalog.review.history')}</h3>
            {history.length ? <ul className="oem-list">{history.map((h) => <li key={h.id}>{h.field}: {String(h.old_value)} {'->'} {String(h.new_value)} <small>{new Date(h.corrected_at).toLocaleString()}</small></li>)}</ul> : <p className="oem-empty-val">{t('oemcatalog.detail.notRecorded')}</p>}
          </div>
        )}
      </section>
    </div>
  )
}
