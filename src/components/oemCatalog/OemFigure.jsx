import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2, Maximize2, Minimize2, Minus, Plus, RotateCcw } from 'lucide-react'
import { useLanguage } from '../../contexts/LanguageContext'
import { toUserMessage } from '../../lib/safeError'

export function normalizeIndex(value) {
  const raw = String(value || '').trim().replace(/[.)]$/, '')
  if (/^\d+$/.test(raw)) return String(Number(raw))
  return raw.toUpperCase()
}

const ZOOM_STEPS = [0.6, 0.8, 1, 1.25, 1.6, 2, 2.6, 3.2]

/**
 * The exploded OEM drawing: renders one PDF page, overlays clickable callouts,
 * zoom, fullscreen, figure paging and an overview thumbnail with a green box
 * showing the part of the drawing currently in view.
 */
export default function OemFigure({ pdfDoc, pageNo, rows, selectedIndex, onSelectIndex, figureLabel, position, onPrev, onNext, calloutNote, geometry }) {
  const { t } = useLanguage()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [zoom, setZoom] = useState(2)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [callouts, setCallouts] = useState([])
  const [view, setView] = useState({ x: 0, y: 0, w: 1, h: 1 })
  const [full, setFull] = useState(false)
  const canvasRef = useRef(null)
  const thumbRef = useRef(null)
  const hostRef = useRef(null)
  const cardRef = useRef(null)
  const zoomValue = ZOOM_STEPS[zoom]
  const drag = useRef(null)
  const onPointerDown = (e) => {
    if (e.target.closest('button')) return
    drag.current = { x: e.clientX, y: e.clientY, sl: hostRef.current.scrollLeft, st: hostRef.current.scrollTop }
    hostRef.current.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e) => {
    if (!drag.current) return
    hostRef.current.scrollLeft = drag.current.sl - (e.clientX - drag.current.x)
    hostRef.current.scrollTop = drag.current.st - (e.clientY - drag.current.y)
  }
  const onPointerUp = () => { drag.current = null }

  useEffect(() => {
    let cancelled = false
    let task
    async function draw() {
      if (!pdfDoc || !canvasRef.current || !hostRef.current || !pageNo) return
      setBusy(true); setError('')
      try {
        const page = await pdfDoc.getPage(pageNo)
        const crop = geometry?.crop
        const natural = page.getViewport({ scale: 1 })
        // Crop in PDF user space -> viewport space, so it survives rotation and zoom.
        const probe = page.getViewport({ scale: 1 })
        const corners = crop ? [probe.convertToViewportPoint(crop.x0, crop.y0), probe.convertToViewportPoint(crop.x1, crop.y1)] : null
        const cx0 = corners ? Math.min(corners[0][0], corners[1][0]) : 0
        const cy0 = corners ? Math.min(corners[0][1], corners[1][1]) : 0
        const cw = corners ? Math.abs(corners[1][0] - corners[0][0]) : natural.width
        const ch = corners ? Math.abs(corners[1][1] - corners[0][1]) : natural.height
        const fit = Math.max(0.2, (hostRef.current.clientWidth - 24) / cw)
        const scale = Math.min(6, fit * zoomValue)
        const viewport = page.getViewport({ scale, offsetX: -cx0 * scale, offsetY: -cy0 * scale })
        const ratio = Math.min(window.devicePixelRatio || 1, 2)
        const canvas = canvasRef.current
        const outW = cw * scale; const outH = ch * scale
        canvas.width = Math.floor(outW * ratio)
        canvas.height = Math.floor(outH * ratio)
        canvas.style.width = `${outW}px`
        canvas.style.height = `${outH}px`
        setSize({ width: outW, height: outH })
        const markers = []
        if (geometry?.callouts?.length) {
          for (const c of geometry.callouts) {
            const [x, y] = viewport.convertToViewportPoint(c.x, c.y)
            markers.push({ id: `${c.index}-${Math.round(x)}-${Math.round(y)}`, index: c.index, x, y, estimated: c.status !== 'verified' })
          }
        } else {
          const text = await page.getTextContent()
          const usable = new Set(rows.map((row) => normalizeIndex(row.index_no || row.parent_index)).filter(Boolean))
          const seen = new Set()
          for (const item of text.items || []) {
            const index = normalizeIndex(item.str)
            if (!index || !usable.has(index)) continue
            const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5])
            const id = `${index}-${Math.round(x)}-${Math.round(y)}`
            if (seen.has(id)) continue
            seen.add(id)
            markers.push({ id, index, x, y, estimated: true })
          }
        }
        if (!cancelled) setCallouts(markers)
        task = page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport, transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0] })
        await task.promise
        const thumb = thumbRef.current
        if (thumb && !cancelled) {
          const tw = 140
          thumb.width = tw
          thumb.height = Math.round(tw * (canvas.height / canvas.width))
          thumb.getContext('2d').drawImage(canvas, 0, 0, thumb.width, thumb.height)
        }
      } catch (err) {
        if (err?.name !== 'RenderingCancelledException' && !cancelled) setError(toUserMessage(err, t('oemcatalog.figure.error')))
      } finally { if (!cancelled) setBusy(false) }
    }
    draw()
    return () => { cancelled = true; task?.cancel() }
  }, [pdfDoc, pageNo, rows, zoomValue, t, geometry])

  const updateView = useCallback(() => {
    const el = hostRef.current
    if (!el || !size.width) return
    setView({
      x: Math.min(1, el.scrollLeft / (size.width + 24)),
      y: Math.min(1, el.scrollTop / (size.height + 24)),
      w: Math.min(1, el.clientWidth / (size.width + 24)),
      h: Math.min(1, el.clientHeight / (size.height + 24)),
    })
  }, [size])
  useEffect(updateView, [updateView])

  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === cardRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])
  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen?.()
    else cardRef.current?.requestFullscreen?.()
  }

  // Keep the selected callout in view when it is chosen from the parts table.
  useEffect(() => {
    const el = hostRef.current
    const marker = callouts.find((c) => c.index === selectedIndex)
    if (!el || !marker) return
    const pad = 60
    if (marker.x < el.scrollLeft + pad || marker.x > el.scrollLeft + el.clientWidth - pad || marker.y < el.scrollTop + pad || marker.y > el.scrollTop + el.clientHeight - pad) {
      el.scrollTo({ left: Math.max(0, marker.x - el.clientWidth / 2), top: Math.max(0, marker.y - el.clientHeight / 2), behavior: 'smooth' })
    }
  }, [selectedIndex, callouts])

  const stepZoom = (d) => setZoom((z) => Math.max(0, Math.min(ZOOM_STEPS.length - 1, z + d)))
  const showThumb = pdfDoc && pageNo && !error

  return (
    <section ref={cardRef} className="oem-card oem-figure" aria-label={t('oemcatalog.figure.title')}>
      <header className="oem-card-head">
        <h2>{t('oemcatalog.figure.title')}</h2>
        <div className="oem-toolbar" role="toolbar" aria-label={t('oemcatalog.figure.tools')}>
          <button type="button" className="oem-tool" onClick={() => stepZoom(-1)} disabled={zoom === 0} aria-label={t('oemcatalog.figure.zoomOut')}><Minus size={15} aria-hidden="true" /></button>
          <span className="oem-zoom" aria-live="polite">{Math.round(zoomValue * 100)}%</span>
          <button type="button" className="oem-tool" onClick={() => stepZoom(1)} disabled={zoom === ZOOM_STEPS.length - 1} aria-label={t('oemcatalog.figure.zoomIn')}><Plus size={15} aria-hidden="true" /></button>
          <button type="button" className="oem-tool" onClick={() => setZoom(2)} aria-label={t('oemcatalog.figure.zoomReset')}><RotateCcw size={14} aria-hidden="true" /></button>
          <button type="button" className="oem-tool" onClick={toggleFull} aria-label={full ? t('oemcatalog.figure.exitFull') : t('oemcatalog.figure.full')}>{full ? <Minimize2 size={15} aria-hidden="true" /> : <Maximize2 size={15} aria-hidden="true" />}</button>
          <span className="oem-sep" aria-hidden="true" />
          <button type="button" className="oem-tool" onClick={onPrev} disabled={!onPrev} aria-label={t('oemcatalog.figure.prev')}><ChevronLeft size={16} className="oem-flip" aria-hidden="true" /></button>
          <span className="oem-pos" dir="ltr">{position}</span>
          <button type="button" className="oem-tool" onClick={onNext} disabled={!onNext} aria-label={t('oemcatalog.figure.next')}><ChevronRight size={16} className="oem-flip" aria-hidden="true" /></button>
        </div>
      </header>
      <div className="oem-figure-body">
        <div ref={hostRef} className="oem-canvas-host" dir="ltr" onScroll={updateView} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} tabIndex={0} aria-label={figureLabel}>
          {busy && <Loader2 className="oem-spin" size={18} aria-label={t('oemcatalog.loading')} />}
          <div className="oem-canvas-stage" style={{ width: size.width || '100%', height: size.height || 'auto' }}>
            <canvas ref={canvasRef} />
            {callouts.map((m) => (
              <button
                key={m.id}
                type="button"
                className="oem-callout"
                data-selected={selectedIndex === m.index ? 'true' : undefined}
                data-estimated={m.estimated ? 'true' : undefined}
                aria-pressed={selectedIndex === m.index}
                aria-label={t('oemcatalog.figure.callout', { index: m.index })}
                title={t('oemcatalog.figure.callout', { index: m.index })}
                onClick={() => onSelectIndex(m.index)}
                style={{ left: m.x, top: m.y }}
              >{m.index}</button>
            ))}
          </div>
        </div>
        {showThumb && (
          <div className="oem-thumb" aria-hidden="true">
            <canvas ref={thumbRef} />
            <span className="oem-thumb-box" style={{ left: `${view.x * 100}%`, top: `${view.y * 100}%`, width: `${view.w * 100}%`, height: `${view.h * 100}%` }} />
          </div>
        )}
      </div>
      {error && <p role="alert" className="oem-note oem-note-error">{error}</p>}
      {!busy && !error && callouts.length > 0 && <p className="oem-note">{geometry?.status === 'verified' ? t('oemcatalog.figure.estimatedMatched') : t('oemcatalog.figure.estimated')}</p>}
      {!busy && !error && callouts.length === 0 && <p className="oem-note">{calloutNote || t('oemcatalog.figure.noCallouts')}</p>}
    </section>
  )
}
