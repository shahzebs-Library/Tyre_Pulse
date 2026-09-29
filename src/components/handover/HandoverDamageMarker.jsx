/**
 * HandoverDamageMarker - the 360 damage marking surface of the Vehicle
 * Handover wizard.
 *
 * Shows the asset's own five-view picture (the same boards the Flutter app
 * uses, public/vehicle-views), a view switcher with arrows and thumbnails, and
 * numbered markers dropped by clicking the picture. Each marker carries its
 * side, x/y as a percentage of the image, damage type, level, note and an
 * optional photo link. Pure model logic lives in src/lib/vehicleHandoverMarks.js.
 *
 * `onChange` null = read-only (handover detail, review step).
 *
 * When the asset has no approved drawing the side is drawn as a plain outline
 * and markers still work; another vehicle's picture is never borrowed.
 */
import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Crosshair, ImageOff, Trash2, Camera } from 'lucide-react'
import {
  DAMAGE_TYPES, DAMAGE_LEVELS, DAMAGE_NOTE_MAX, viewImageUrl, viewName, damageTypeName, levelName,
  newMarker, normalizeMarker, numberMarks, markCountByView, percentFromClick,
} from '../../lib/vehicleHandoverMarks'
import { safeHref } from '../../lib/safeUrl'

function MarkerPin({ mark, selected, onSelect, readOnly }) {
  const common = {
    className: `vhm-pin vhm-lv-${mark.level}${selected ? ' on' : ''}`,
    style: { left: `${mark.x}%`, top: `${mark.y}%` },
    'data-testid': `handover-marker-${mark.number}`,
  }
  if (readOnly) return <span {...common} aria-hidden="true">{mark.number}</span>
  return (
    <button
      type="button"
      {...common}
      aria-label={`Marker ${mark.number}: ${damageTypeName(mark.type)}, ${levelName(mark.level)}`}
      onClick={(e) => { e.stopPropagation(); onSelect(mark.id) }}
    >
      {mark.number}
    </button>
  )
}

export default function HandoverDamageMarker({ stem, views, marks = [], onChange = null, compact = false }) {
  const readOnly = typeof onChange !== 'function'
  const viewList = useMemo(() => (views && views.length ? views : ['front', 'rear', 'left', 'right', 'top']), [views])
  const numbered = useMemo(() => numberMarks(marks), [marks])
  const counts = useMemo(() => markCountByView(marks), [marks])
  const firstMarked = viewList.find((v) => counts[v]) || viewList[0]
  const [view, setView] = useState(readOnly ? firstMarked : viewList[0])
  const [selectedId, setSelectedId] = useState(null)
  const [imgFailed, setImgFailed] = useState({})

  useEffect(() => { if (!viewList.includes(view)) setView(viewList[0]) }, [viewList, view])

  const idx = Math.max(0, viewList.indexOf(view))
  const url = viewImageUrl(stem, view)
  const hasArt = !!url && !imgFailed[view]
  const onView = numbered.filter((m) => m.view === view && m.x != null && m.y != null)

  const go = (d) => setView(viewList[(idx + d + viewList.length) % viewList.length])
  const commit = (next) => onChange(next.map(normalizeMarker).filter(Boolean))
  const drop = (pos) => {
    if (readOnly || !pos) return
    const m = newMarker({ view, x: pos.x, y: pos.y })
    if (!m) return
    commit([...marks, m])
    setSelectedId(m.id)
  }
  const onSurfaceClick = (e) => drop(percentFromClick(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect()))
  const update = (id, patch) => commit(marks.map((m) => (m.id === id ? { ...m, ...patch } : m)))
  const remove = (id) => { commit(marks.filter((m) => m.id !== id)); if (selectedId === id) setSelectedId(null) }

  return (
    <div className={`vhm${compact ? ' compact' : ''}`}>
      <div className="vhm-bar">
        <button type="button" className="cc-icon-btn" onClick={() => go(-1)} aria-label="Previous side"><ChevronLeft size={16} /></button>
        <div className="vhm-bar-title">
          <b>{viewName(view)}</b>
          <span>Side {idx + 1} of {viewList.length}{counts[view] ? `, ${counts[view]} marked` : ''}</span>
        </div>
        <button type="button" className="cc-icon-btn" onClick={() => go(1)} aria-label="Next side"><ChevronRight size={16} /></button>
      </div>

      <div
        className={`vhm-surface${readOnly ? '' : ' editable'}${hasArt ? '' : ' plain'}`}
        onClick={readOnly ? undefined : onSurfaceClick}
        data-testid="handover-damage-surface"
        data-surface={hasArt ? 'artwork' : 'no-artwork'}
      >
        {hasArt ? (
          <img
            src={url}
            alt={`${viewName(view)} view of the vehicle`}
            draggable={false}
            onError={() => setImgFailed((f) => ({ ...f, [view]: true }))}
          />
        ) : (
          <div className="vhm-plain">
            <ImageOff size={20} aria-hidden="true" />
            <span>No approved drawing for this asset. {readOnly ? '' : 'Click inside this outline to mark the '}{readOnly ? `${viewName(view)} side.` : `${viewName(view).toLowerCase()} side.`}</span>
          </div>
        )}
        {onView.map((m) => (
          <MarkerPin key={m.id} mark={m} selected={selectedId === m.id} onSelect={setSelectedId} readOnly={readOnly} />
        ))}
      </div>

      {!readOnly && (
        <div className="vhm-hint">
          <span>Click the picture where the damage is to drop a numbered marker.</span>
          <button type="button" className="cc-btn-ghost" onClick={() => drop({ x: 50, y: 50 })}>
            <Crosshair size={14} aria-hidden="true" /> Add marker at centre
          </button>
        </div>
      )}

      <div className="vhm-thumbs" role="tablist" aria-label="Vehicle sides">
        {viewList.map((v) => {
          const t = viewImageUrl(stem, v)
          return (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={v === view}
              className={`vhm-thumb${v === view ? ' on' : ''}`}
              onClick={() => setView(v)}
            >
              {t && !imgFailed[v] ? <img src={t} alt="" loading="lazy" /> : <span className="vhm-thumb-plain" aria-hidden="true" />}
              <small>{viewName(v)}</small>
              {counts[v] ? <em>{counts[v]}</em> : null}
            </button>
          )
        })}
      </div>

      <div className="vhm-list">
        {numbered.length === 0 ? (
          <p className="cc-na">{readOnly ? 'No damage marked.' : 'No damage marked yet. The vehicle is recorded as clean on every side.'}</p>
        ) : numbered.map((m) => {
          const placed = m.x != null && m.y != null
          const link = safeHref(m.photo_url)
          return (
            <div key={m.id} className={`vhm-row${selectedId === m.id ? ' on' : ''}`}>
              <span className={`vhm-num vhm-lv-${m.level}`}>{m.number}</span>
              <div className="vhm-row-main">
                <button type="button" className="vhm-row-side" onClick={() => { setView(m.view); setSelectedId(m.id) }}>
                  {viewName(m.view)}{placed ? '' : ', position not recorded'}{m.legacy ? ' (earlier side check)' : ''}
                </button>
                {readOnly ? (
                  <p>
                    {damageTypeName(m.type)}, {levelName(m.level)}{m.note ? `: ${m.note}` : ''}
                    {link && <> <a href={link} target="_blank" rel="noopener noreferrer"><Camera size={12} aria-hidden="true" /> Photo</a></>}
                  </p>
                ) : (
                  <div className="vhm-row-edit">
                    <select className="vh-input" aria-label={`Marker ${m.number} damage type`} value={m.type} onChange={(e) => update(m.id, { type: e.target.value })}>
                      {DAMAGE_TYPES.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
                    </select>
                    <select className="vh-input" aria-label={`Marker ${m.number} level`} value={m.level} onChange={(e) => update(m.id, { level: e.target.value })}>
                      {DAMAGE_LEVELS.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
                    </select>
                    <input className="vh-input" aria-label={`Marker ${m.number} note`} placeholder="Note (optional)" maxLength={DAMAGE_NOTE_MAX} value={m.note} onChange={(e) => update(m.id, { note: e.target.value })} />
                    <input className="vh-input" type="url" aria-label={`Marker ${m.number} photo link`} placeholder="Photo link https:// (optional)" maxLength={2000} defaultValue={m.photo_url} onBlur={(e) => update(m.id, { photo_url: e.target.value })} />
                    <button type="button" className="cc-icon-btn" onClick={() => remove(m.id)} aria-label={`Delete marker ${m.number}`}><Trash2 size={14} /></button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
