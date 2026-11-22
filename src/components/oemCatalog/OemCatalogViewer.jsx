import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, CheckCircle2, Info, ChevronLeft, ChevronRight, ExternalLink, Loader2, PackagePlus, Plus, AlertTriangle } from 'lucide-react'
import { useLanguage } from '../../contexts/LanguageContext'
import OemFigure, { normalizeIndex } from './OemFigure'
import { CoveragePanel, FigureSummary, PartDrawer } from './OemInsightPanels'
import { groupFigureId, resolveFigures } from '../../lib/oemCatalog/figureLinks'
import './oemCatalog.css'

const PAGE_SIZE = 40
const AREA_ORDER = ['chassis', 'upper', 'other']

/**
 * Illustrated parts viewer: machine and fitment header, breadcrumb, assemblies
 * grouped by chassis / upper body / other, exploded drawing and the parts table
 * with two-way selection (click a callout or a row).
 */
export default function OemCatalogViewer({
  manual, manualOptions, onChooseManual, asset, fitment, groups, activeGroup, onOpenGroup,
  pdfDoc, allRows = [], figureRows = null, selectedIndex, onSelectIndex, selectedKeys, onAddRows, onRequestSelected, onOpenSource, loading, error,
}) {
  const { t } = useLanguage()
  const [pageNo, setPageNo] = useState(0)
  const [navQuery, setNavQuery] = useState('')
  const [detail, setDetail] = useState(null)
  // One specific part chosen from the table. A callout groups every row that
  // shares its number (often several variants); choosing a row picks exactly
  // that part instead of the whole group.
  const [pickedRowId, setPickedRowId] = useState(null)
  const rowRefs = useRef(new Map())
  const navRef = useRef(null)
  const [navTop, setNavTop] = useState(0)
  // Saved figures (oem_figures) carry admin corrections; the import snapshot is a legacy fallback.
  const figures = useMemo(() => resolveFigures(figureRows, manual?.import_summary?.figures), [figureRows, manual])

  const meta = (group) => {
    const id = groupFigureId(group)
    return (id && figures[id]) || null
  }

  const areaOf = (group) => meta(group)?.area || 'other'
  const grouped = useMemo(() => {
    const needle = navQuery.trim().toLowerCase()
    const by = { chassis: [], upper: [], other: [] }
    for (const g of groups) {
      if (needle && ![g.label, ...g.printedPages, g.page].join(' ').toLowerCase().includes(needle)) continue
      by[areaOf(g)].push(g)
    }
    return by
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, navQuery, figures])
  const hasAreas = Object.keys(figures).length > 0
  // Windowing for very large manuals: only the nav items near the scroll position are mounted.
  const ITEM_H = 49
  const windowed = (list, top, all, area) => {
    if (list.length < 80) return list
    const offset = AREA_ORDER.slice(0, AREA_ORDER.indexOf(area)).reduce((n, k) => n + all[k].length * ITEM_H + (all[k].length ? 30 : 0), 0) + 30
    const first = Math.max(0, Math.floor((top - offset) / ITEM_H) - 8)
    const last = Math.min(list.length, first + 40)
    return [first > 0 && { spacer: first * ITEM_H, key: 'top' }, ...list.slice(first, last), last < list.length && { spacer: (list.length - last) * ITEM_H, key: 'bottom' }].filter(Boolean)
  }

  const flat = useMemo(() => AREA_ORDER.flatMap((a) => grouped[a]), [grouped])
  const activeAt = flat.findIndex((g) => g === activeGroup)
  const goto = (d) => { const g = flat[activeAt + d]; if (g) onOpenGroup(g) }

  const rows = useMemo(() => activeGroup?.rows || [], [activeGroup])
  useEffect(() => { setPageNo(0); setPickedRowId(null) }, [activeGroup])
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  // Selecting a row on another table page (via a callout) jumps to that page.
  useEffect(() => {
    if (!selectedIndex) return
    const at = rows.findIndex((r) => normalizeIndex(r.index_no || r.parent_index) === selectedIndex)
    if (at >= 0) setPageNo(Math.floor(at / PAGE_SIZE))
  }, [selectedIndex, rows])
  const visible = rows.slice(pageNo * PAGE_SIZE, (pageNo + 1) * PAGE_SIZE)
  const indexOf = (r) => normalizeIndex(r.index_no || r.parent_index)
  // A picked row only counts while its callout is still the selected one.
  const pickedRow = rows.find((r) => r.id === pickedRowId && indexOf(r) === selectedIndex) || null
  useEffect(() => {
    const target = pickedRow || rows.find((r) => indexOf(r) === selectedIndex)
    if (target) rowRefs.current.get(target.id)?.scrollIntoView?.({ block: 'nearest' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIndex, rows, pageNo, pickedRow])

  const groupRows = rows.filter((r) => selectedIndex && indexOf(r) === selectedIndex)
  const selectedRows = pickedRow ? [pickedRow] : groupRows
  const pickRow = (row) => { setPickedRowId(row.id); onSelectIndex(indexOf(row)) }
  // Asset and location come from the vehicle chosen on the page (vehicle_fleet.asset_no or
  // fleet_number, and vehicle_fleet.site). An OEM book row carries neither, so nothing is
  // shown that the record does not hold.
  const assetCode = asset?.asset_no || asset?.fleet_number || ''
  const assetSite = asset?.site || ''
  const assetLabel = assetCode || t('oemcatalog.parts.noAsset')
  const siteLabel = assetSite || t('oemcatalog.parts.noLocation')
  const activeMeta = activeGroup ? meta(activeGroup) : null
  const area = activeMeta?.area || 'other'
  const printed = activeGroup?.printedPages[0] || ''
  const crumbs = [`${manual?.manufacturer || ''} ${manual?.model || ''}`.trim(), hasAreas ? t(`oemcatalog.area.${area}`) : null, activeGroup?.label].filter(Boolean)
  const fitmentLabel = {
    exact: t('oemcatalog.fitment.exact'),
    model: t('oemcatalog.fitment.model'),
    unconfirmed: t('oemcatalog.fitment.unconfirmed'),
  }[fitment] || t('oemcatalog.fitment.unconfirmed')

  return (
    <div className="oem-viewer">
      <div className="oem-topbar">
        <label className="oem-field">
          <span>{t('oemcatalog.machine')}</span>
          <select value={manual?.id || ''} onChange={(e) => onChooseManual(manualOptions.find((m) => m.id === e.target.value))}>
            {manualOptions.map((m) => <option key={m.id} value={m.id}>{m.manufacturer} {m.model}{m.generation ? ` · ${m.generation}` : ''}</option>)}
          </select>
        </label>
        <div className="oem-field">
          <span>{t('oemcatalog.asset')}</span>
          <strong className="oem-asset" dir="ltr">{asset?.chassis_no || asset?.serial_no || asset?.asset_no || manual?.equipment_no || t('oemcatalog.notSelected')}</strong>
        </div>
        <span className={`oem-chip oem-chip-${fitment === 'exact' ? 'ok' : 'warn'}`}>
          {fitment === 'exact' ? <CheckCircle2 size={14} aria-hidden="true" /> : <AlertTriangle size={14} aria-hidden="true" />}{fitmentLabel}
        </span>
        {activeMeta && activeMeta.confidence < 0.7 && <span className="oem-chip oem-chip-warn"><AlertTriangle size={14} aria-hidden="true" />{t('oemcatalog.needsReview')}</span>}
      </div>

      <CoveragePanel manual={manual} />
      <nav className="oem-crumbs" aria-label={t('oemcatalog.breadcrumb')}>
        <ol>{crumbs.map((c, i) => <li key={`${c}-${i}`} aria-current={i === crumbs.length - 1 ? 'page' : undefined}>{c}</li>)}</ol>
      </nav>

      {error && <p role="alert" className="oem-note oem-note-error">{error}</p>}
      {loading && <div className="oem-loading"><Loader2 className="oem-spin" size={20} aria-hidden="true" />{t('oemcatalog.loading')}</div>}

      {!loading && groups.length > 0 && (
        <div className="oem-grid">
          <aside className="oem-card oem-nav" aria-label={t('oemcatalog.assemblies.title')}>
            <header className="oem-card-head"><h2>{t('oemcatalog.assemblies.title')}</h2></header>
            <div className="oem-nav-search"><input type="search" value={navQuery} onChange={(e) => setNavQuery(e.target.value)} placeholder={t('oemcatalog.assemblies.search')} aria-label={t('oemcatalog.assemblies.search')} /></div>
            <div className="oem-scroll" onScroll={(e) => setNavTop(e.currentTarget.scrollTop)} ref={navRef}>
              {AREA_ORDER.map((a) => grouped[a].length > 0 && (
                <div key={a} className="oem-nav-group">
                  {hasAreas && <h3>{t(`oemcatalog.area.${a}`)} <span>{grouped[a].length}</span></h3>}
                  {windowed(grouped[a], navTop, grouped, a).map((g) => g.spacer ? <div key={g.key} style={{ height: g.spacer }} aria-hidden="true" /> : (
                    <button key={g.key || `${g.page}-${g.printedPages[0]}`} type="button" className="oem-nav-item" aria-current={g === activeGroup ? 'true' : undefined} onClick={() => onOpenGroup(g)}>
                      <span>{g.label}</span>
                      <small dir="ltr">{g.printedPages[0] || (g.page ? `PDF ${g.page}` : t('oemcatalog.assemblies.unlinked'))} · {g.rows.length}</small>
                    </button>
                  ))}
                </div>
              ))}
              {flat.length === 0 && <p className="oem-note">{t('oemcatalog.assemblies.none')}</p>}
            </div>
          </aside>

          {activeGroup ? (
            <>
              {activeGroup.page && pdfDoc ? (
                <OemFigure
                  pdfDoc={pdfDoc}
                  pageNo={activeGroup.page}
                  rows={rows}
                  selectedIndex={selectedIndex}
                  onSelectIndex={(v) => { setPickedRowId(null); onSelectIndex(normalizeIndex(v)) }}
                  figureLabel={activeGroup.label}
                  geometry={activeMeta?.geometry}
                  position={`${printed || activeGroup.page} · ${activeAt + 1}/${flat.length}`}
                  onPrev={activeAt > 0 ? () => goto(-1) : undefined}
                  onNext={activeAt >= 0 && activeAt < flat.length - 1 ? () => goto(1) : undefined}
                />
              ) : (
                <section className="oem-card oem-figure">
                  <header className="oem-card-head"><h2>{t('oemcatalog.figure.title')}</h2></header>
                  <div className="oem-empty">{activeGroup.page ? <><Loader2 className="oem-spin" size={18} aria-hidden="true" />{t('oemcatalog.figure.opening')}</> : t('oemcatalog.figure.unlinked')}</div>
                </section>
              )}

              <section className="oem-card oem-parts" aria-label={t('oemcatalog.parts.title')}>
                <header className="oem-card-head">
                  <h2>{t('oemcatalog.parts.title')}</h2>
                  <span className="oem-count">{t('oemcatalog.parts.count', { count: rows.length })}</span>
                </header>
                <FigureSummary group={activeGroup} geometry={activeMeta?.geometry} />
                {selectedRows.length > 0 && (
                  <div className="oem-picked" role="status" aria-live="polite" data-testid="oem-picked">
                    <strong>{pickedRow ? t('oemcatalog.parts.pickedOne') : t('oemcatalog.parts.pickedGroup', { index: selectedIndex, count: groupRows.length })}</strong>
                    <ul>
                      {selectedRows.map((r) => (
                        <li key={r.id}>
                          <span className="oem-pn" dir="ltr">{r.part_no}</span> {r.description}
                          <small>
                            {t('oemcatalog.parts.assetLine', { asset: assetLabel })} · {t('oemcatalog.parts.locationLine', { location: siteLabel })}
                            {selectedKeys.has(`${manual.id}:${r.id}`) ? ` · ${t('oemcatalog.parts.added')}` : ''}
                          </small>
                        </li>
                      ))}
                    </ul>
                    {!pickedRow && groupRows.length > 1 && <small>{t('oemcatalog.parts.pickHint')}</small>}
                  </div>
                )}
                <div className="oem-scroll oem-table-wrap" tabIndex={0} aria-label={t('oemcatalog.parts.title')}>
                  <table className="oem-table">
                    <thead><tr>
                      <th scope="col">{t('oemcatalog.col.index')}</th>
                      <th scope="col">{t('oemcatalog.col.partNo')}</th>
                      <th scope="col">{t('oemcatalog.col.description')}</th>
                      <th scope="col" className="oem-num">{t('oemcatalog.col.qty')}</th>
                      <th scope="col"><span className="oem-sr">{t('oemcatalog.col.add')}</span></th>
                    </tr></thead>
                    <tbody>
                      {visible.map((row) => {
                        const idx = indexOf(row)
                        const inGroup = Boolean(idx) && selectedIndex === idx
                        const picked = pickedRow?.id === row.id
                        const sel = picked || (inGroup && !pickedRow)
                        const added = selectedKeys.has(`${manual.id}:${row.id}`)
                        return (
                          <tr key={row.id} ref={(el) => { if (el) rowRefs.current.set(row.id, el); else rowRefs.current.delete(row.id) }} data-selected={sel ? 'true' : undefined} data-picked={picked ? 'true' : undefined} onClick={() => pickRow(row)}>
                            <td className="oem-idx"><button type="button" onClick={(e) => { e.stopPropagation(); pickRow(row) }} aria-pressed={picked} aria-label={t('oemcatalog.parts.selectPart', { index: idx || '-', part: row.part_no || '-' })}>{row.index_no || (row.parent_index ? `${row.parent_index}*` : '-')}</button></td>
                            <td className="oem-pn" dir="ltr">{row.part_no}</td>
                            <td>{row.description}{row.remark && <small>{row.remark}</small>}<small className="oem-where">{assetLabel} · {siteLabel}</small></td>
                            <td className="oem-num">{row.quantity ?? '-'}</td>
                            <td className="oem-add"><button type="button" onClick={(e) => { e.stopPropagation(); setDetail(row) }} aria-label={t('oemcatalog.detail.title')} title={t('oemcatalog.detail.title')}><Info size={15} aria-hidden="true" /></button><button type="button" disabled={added} onClick={(e) => { e.stopPropagation(); onAddRows([row]) }} aria-label={t('oemcatalog.parts.addOne', { part: row.part_no })} title={added ? t('oemcatalog.parts.added') : t('oemcatalog.parts.add')}>{added ? <CheckCircle2 size={15} aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />}</button></td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="oem-actions">
                  <button type="button" className="oem-primary" disabled={!selectedRows.length} onClick={() => onRequestSelected(selectedRows)}>
                    <PackagePlus size={16} aria-hidden="true" />{t('oemcatalog.parts.addSelected')}
                  </button>
                  <div className="oem-pager" role="group" aria-label={t('oemcatalog.parts.pager')}>
                    <button type="button" onClick={() => setPageNo((p) => Math.max(0, p - 1))} disabled={pageNo === 0} aria-label={t('oemcatalog.parts.prevPage')}><ChevronLeft size={15} className="oem-flip" aria-hidden="true" /></button>
                    <span>{pageNo + 1} / {pages}</span>
                    <button type="button" onClick={() => setPageNo((p) => Math.min(pages - 1, p + 1))} disabled={pageNo >= pages - 1} aria-label={t('oemcatalog.parts.nextPage')}><ChevronRight size={15} className="oem-flip" aria-hidden="true" /></button>
                  </div>
                  {onOpenSource && <button type="button" className="oem-secondary" onClick={onOpenSource}><ExternalLink size={15} aria-hidden="true" />{t('oemcatalog.parts.openPdf')}</button>}
                </div>
                <footer className="oem-source">
                  {t('oemcatalog.parts.source', { brand: manual?.manufacturer || '', page: printed || '-' })}
                </footer>
              </section>
            </>
          ) : (
            <section className="oem-card oem-empty oem-span2">
              <BookOpen size={28} aria-hidden="true" />
              <h2>{t('oemcatalog.choose.title')}</h2>
              <p>{t('oemcatalog.choose.body')}</p>
            </section>
          )}
        </div>
      )}
      {detail && <PartDrawer row={detail} rows={allRows} manual={manual} figures={figures} added={selectedKeys.has(`${manual.id}:${detail.id}`)} onAdd={(r) => onAddRows([r])} onClose={() => setDetail(null)} onGoToFigure={(w) => { const g = groups.find((x) => x.rows.some((r) => r.id === w.id)); if (g) { onOpenGroup(g); onSelectIndex(normalizeIndex(w.callout)); setDetail(null) } }} />}
    </div>
  )
}
