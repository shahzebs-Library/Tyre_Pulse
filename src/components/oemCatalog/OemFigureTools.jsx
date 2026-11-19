import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useLanguage } from '../../contexts/LanguageContext'
import { toUserMessage } from '../../lib/safeError'
import { NOT_PROVISIONED, adjustFigureCrop, listEntriesWithFigure, listFigures, mergeFigures, reassignEntries, splitFigure } from '../../lib/api/oemCatalogAdmin'
import { figureId as deriveFigureId } from '../../lib/oemCatalog/pageNumbering'
import { mergeProblem, reassignProblem, splitCrop, splitProblem } from '../../lib/oemCatalog/figureTools'
import './oemCatalog.css'

/** Admin tools to fix figure/table links by hand: re-assign parts, merge two figures, split one. */
export default function OemFigureTools({ manual }) {
  const { t } = useLanguage()
  const [figs, setFigs] = useState({})
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [figure, setFigure] = useState('')
  const [picked, setPicked] = useState(new Set())
  const [target, setTarget] = useState('')
  const [newName, setNewName] = useState('')
  const [axis, setAxis] = useState('x')
  const [ratio, setRatio] = useState(50)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [f, e] = await Promise.all([listFigures(manual.id), listEntriesWithFigure(manual.id)])
      const map = {}
      for (const r of f) map[r.figure_id] = { ...r, geometry: { pdf_page: r.pdf_page, crop: r.crop } }
      setFigs(map); setEntries(e); setNotProvisioned(f.length === 0 && Object.keys(manual.import_summary?.figures || {}).length > 0)
    } catch (err) {
      if (err.code === NOT_PROVISIONED) setNotProvisioned(true); else setError(toUserMessage(err, t('oemcatalog.tools.loadError')))
    } finally { setLoading(false) }
  }, [manual.id, manual.import_summary, t])
  useEffect(() => { load() }, [load])

  const figureOf = (e) => e.figure_id || deriveFigureId(e.printed_page, e.source_pdf_page)
  const ids = useMemo(() => Object.keys(figs).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), [figs])
  const rows = useMemo(() => entries.filter((e) => figureOf(e) === figure), [entries, figure])
  const picks = [...picked]
  const toggle = (id) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const run = async (problem, fn, okMsg) => {
    setError(''); setNotice('')
    if (problem) { setError(problem); return }
    try { const n = await fn(); setNotice(t(okMsg, { count: n })); setPicked(new Set()); await load() } catch (err) { setError(toUserMessage(err, t('oemcatalog.tools.saveError'))) }
  }

  if (loading) return <div className="oem-loading"><Loader2 className="oem-spin" size={18} aria-hidden="true" />{t('oemcatalog.loading')}</div>
  if (notProvisioned) return <p className="oem-note" role="status">{t('oemcatalog.review.notProvisioned')}</p>

  return (
    <section className="oem-card oem-tools" aria-label={t('oemcatalog.tools.title')}>
      <header className="oem-card-head"><h2>{t('oemcatalog.tools.title')}</h2></header>
      <div className="oem-scroll oem-review-body">
        <p className="oem-note">{t('oemcatalog.tools.help')}</p>
        {error && <p role="alert" className="oem-note oem-note-error">{error}</p>}
        {notice && <p role="status" className="oem-note">{notice}</p>}
        <label className="oem-form-row">{t('oemcatalog.tools.figure')}
          <select value={figure} onChange={(e) => { setFigure(e.target.value); setPicked(new Set()) }}>
            <option value="">-</option>
            {ids.map((id) => <option key={id} value={id}>{id}{figs[id].caption ? ` · ${figs[id].caption}` : ''}</option>)}
          </select>
        </label>
        {figure && (
          <>
            <ul className="oem-list oem-review-rows">
              {rows.map((r) => (
                <li key={r.id}>
                  <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} aria-label={t('oemcatalog.review.pick', { part: r.part_no })} />
                  <span><span className="oem-pn" dir="ltr">{r.part_no}</span> <small>{r.index_no ? `#${r.index_no} · ` : ''}{r.description}</small></span>
                </li>
              ))}
              {!rows.length && <li><small>{t('oemcatalog.tools.noParts')}</small></li>}
            </ul>
            <div className="oem-form">
              <h3>{t('oemcatalog.tools.reassign')}</h3>
              <label>{t('oemcatalog.tools.moveTo')}<select value={target} onChange={(e) => setTarget(e.target.value)}><option value="">-</option>{ids.filter((i) => i !== figure).map((i) => <option key={i} value={i}>{i}</option>)}</select></label>
              <button type="button" className="oem-secondary" onClick={() => run(reassignProblem(figs, target, picks), () => reassignEntries(manual.id, picks, target), 'oemcatalog.tools.moved')}>{t('oemcatalog.tools.moveBtn', { count: picks.length })}</button>
            </div>
            <div className="oem-form">
              <h3>{t('oemcatalog.tools.merge')}</h3>
              <label>{t('oemcatalog.tools.mergeInto')}<select value={target} onChange={(e) => setTarget(e.target.value)}><option value="">-</option>{ids.filter((i) => i !== figure).map((i) => <option key={i} value={i}>{i}</option>)}</select></label>
              <button type="button" className="oem-secondary" onClick={() => run(mergeProblem(figs, figure, target), () => mergeFigures(manual.id, figure, target), 'oemcatalog.tools.merged')}>{t('oemcatalog.tools.mergeBtn')}</button>
            </div>
            <div className="oem-form">
              <h3>{t('oemcatalog.tools.split')}</h3>
              <label>{t('oemcatalog.tools.newName')}<input value={newName} onChange={(e) => setNewName(e.target.value)} dir="ltr" /></label>
              <label>{t('oemcatalog.tools.axis')}<select value={axis} onChange={(e) => setAxis(e.target.value)}><option value="x">{t('oemcatalog.tools.axisX')}</option><option value="y">{t('oemcatalog.tools.axisY')}</option></select></label>
              <label>{t('oemcatalog.tools.ratio')}<input type="number" min="10" max="90" value={ratio} onChange={(e) => setRatio(Number(e.target.value))} dir="ltr" /></label>
              <button type="button" className="oem-secondary" onClick={() => {
                const halves = splitCrop(figs[figure]?.crop, axis, ratio / 100)
                run(splitProblem(figs, figure, newName, picks) || (halves ? null : t('oemcatalog.tools.noCrop')), async () => {
                  const n = await splitFigure(manual.id, figure, newName.trim(), halves[1], picks)
                  await adjustFigureCrop(manual.id, figure, halves[0])
                  return n
                }, 'oemcatalog.tools.splitDone')
              }}>{t('oemcatalog.tools.splitBtn', { count: picks.length })}</button>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
